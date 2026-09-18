/**
 * Markup Compatibility and Extensibility (MCE) — ECMA-376 Part 3.
 *
 * MCE is the part of OOXML with no XSD. Part 3 defines it in prose only, so
 * none of it can be generated: this file is the whole implementation, and the
 * generated readers call into it.
 *
 * ## What it is for
 *
 * OOXML is a versioned format that has to be readable by consumers older than
 * the producer. MCE is the mechanism: a producer marks up the parts of a
 * document that a given consumer may not understand, and says what to do about
 * each one. Six constructs, all in
 * `http://schemas.openxmlformats.org/markup-compatibility/2006`:
 *
 * ```xml
 * <w:document mc:Ignorable="w14 w15 wp14">        <!-- you may drop these      -->
 *   <mc:AlternateContent>                          <!-- pick one of these        -->
 *     <mc:Choice Requires="wps"> …modern shape… </mc:Choice>
 *     <mc:Fallback>                 …VML picture… </mc:Fallback>
 *   </mc:AlternateContent>
 *   <w14:wrapper mc:ProcessContent="w14:wrapper">  <!-- drop me, keep my children -->
 *   <w:x mc:MustUnderstand="foo"/>                 <!-- fail if you can't         -->
 *   <… mc:PreserveElements="w14:*" mc:PreserveAttributes="w14:textId"/>
 * ```
 *
 * ## The hard constraint: round-trip
 *
 * Every one of these is a *reading* instruction, and every one of them is a trap
 * for an editor. A viewer can obey `mc:Ignorable` by throwing markup away. An
 * editor cannot: the user opened a document containing a modern shape, changed a
 * word of unrelated text, and saved. If the unselected `mc:Choice` is gone, the
 * document has been silently downgraded — reopened in current Word, the shape is
 * now the VML fallback, permanently.
 *
 * So this implementation never discards. The flow for `mc:AlternateContent` is:
 *
 * 1. `cursor.skipToRaw()` captures the entire `mc:AlternateContent` verbatim —
 *    every branch, in order, with attributes, prefixes and comments intact.
 * 2. {@link McResolver.selectAlternateContent} decides which branch *this*
 *    consumer should read, by inspecting the captured node.
 * 3. The reader consumes the selected branch's children via
 *    `createCursorOverRaw(selection.content)` — ordinary generated readers, no
 *    MCE awareness required.
 * 4. On save, `sink.raw(selection.node)` writes the original node back.
 *
 * Preservation is by construction rather than by discipline: the bytes that go
 * out are the bytes that came in, and there is no code path that could drop a
 * branch because someone forgot to copy it. The same shape applies to ignored
 * elements — they are captured, not skipped, which makes `mc:PreserveElements`
 * and `mc:PreserveAttributes` advisory here rather than load-bearing (we do
 * strictly more than they ask). They are still parsed and exposed, because a
 * consumer that *does* want to drop things needs to know what it may not drop.
 *
 * ## Scoping
 *
 * All five attributes are scoped to the element carrying them and its
 * descendants, and they accumulate: an inner `mc:Ignorable` adds to the outer
 * one, and there is no way to remove a namespace from the set. The lists name
 * *prefixes* (`mc:Ignorable`, `mc:MustUnderstand`, `Requires`) or *qualified
 * names* (`mc:ProcessContent`, `mc:PreserveElements`, `mc:PreserveAttributes`),
 * which means every one of them has to be resolved against the namespace
 * declarations in scope at that element — and resolved *there*, because the same
 * prefix can be rebound further down. {@link McResolver} therefore maintains its
 * own prefix scope stack, fed from `XmlStartElement.nsDeclarations`, and stores
 * resolved URIs rather than prefixes.
 *
 * ## Two places this deviates from Part 3, deliberately
 *
 * - **An element in a namespace that is neither understood nor ignorable.** Part
 *   3 says a conformant consumer shall fail. We return `action: 'process'` with
 *   `understood: false` and let the generated reader capture it as a `RawNode`.
 *   Failing would reject documents that Word itself opens without complaint —
 *   producers under-declare `mc:Ignorable` routinely — and we lose nothing by
 *   being permissive, because we preserve the markup either way.
 * - **An undeclared prefix in `Requires`.** Part 3 makes it an error. We treat it
 *   as "does not resolve, therefore not understood", so that `mc:Choice` is
 *   simply not selected and the `mc:Fallback` is used. That is the outcome the
 *   producer wanted anyway. `mc:MustUnderstand` is the exception and still
 *   throws: there, silence would mean rendering a document we have been told we
 *   cannot render correctly.
 */

import { createCursorOverRaw } from './cursor.js';
import { MC_NAMESPACE, XML_NAMESPACE } from './namespaces.js';
import type { NamespaceUri, RawChild, RawNode, XmlAttr, XmlCursor, XmlStartElement } from './xml.js';

export { MC_NAMESPACE };

/* ------------------------------------------------------------------------- */
/* Names                                                                      */
/* ------------------------------------------------------------------------- */

/**
 * The MCE vocabulary, spelled exactly as Part 3 spells it.
 *
 * Note the capitals. Every MCE attribute is PascalCase — `mc:Ignorable`, not
 * `mc:ignorable` — and `Requires` on `mc:Choice` is both PascalCase **and
 * unprefixed**, so it lives in no namespace at all:
 *
 * ```xml
 * <mc:Choice Requires="wps">
 * ```
 *
 * `mc:Requires` (prefixed) is not the attribute Part 3 defines and is not what
 * Word writes. XML attribute names are case-sensitive, so matching `requires`
 * would silently fail to find the attribute on every real document — the
 * `Requires` list would come back empty, every `mc:Choice` would trivially
 * "require nothing", and the first Choice would always win. That is a wrong
 * rendering, not an error, which is why this is called out here.
 */
export const MC_NAMES = {
  alternateContent: 'AlternateContent',
  choice: 'Choice',
  fallback: 'Fallback',
  requires: 'Requires',
  ignorable: 'Ignorable',
  processContent: 'ProcessContent',
  mustUnderstand: 'MustUnderstand',
  preserveElements: 'PreserveElements',
  preserveAttributes: 'PreserveAttributes',
} as const;

/** True for the `mc:AlternateContent` element in either dialect (the MC URI is shared). */
export function isAlternateContent(uri: NamespaceUri, localName: string): boolean {
  return uri === MC_NAMESPACE && localName === MC_NAMES.alternateContent;
}

/* ------------------------------------------------------------------------- */
/* Errors                                                                     */
/* ------------------------------------------------------------------------- */

/** Why an {@link McError} was raised. */
export type McErrorCode =
  /** `mc:MustUnderstand` named a namespace this consumer does not understand. */
  | 'must-understand'
  /** `mc:AlternateContent` does not have the structure Part 3 requires. */
  | 'malformed-alternate-content'
  /** A prefix in an MCE list is not bound to any namespace in scope. */
  | 'undeclared-prefix';

/** A Markup Compatibility failure. */
export class McError extends Error {
  constructor(
    message: string,
    readonly code: McErrorCode,
  ) {
    super(message);
    this.name = 'McError';
  }
}

/* ------------------------------------------------------------------------- */
/* Qualified-name sets                                                        */
/* ------------------------------------------------------------------------- */

/**
 * A set of qualified names with `prefix:*` wildcard support, as used by
 * `mc:ProcessContent`, `mc:PreserveElements` and `mc:PreserveAttributes`.
 *
 * Stored by resolved namespace URI, never by prefix: `mc:PreserveElements="w14:*"`
 * on an outer element keeps meaning the 2010 wordml namespace even if an inner
 * element rebinds `w14` to something else.
 */
export class QNameSet {
  /** The shared empty set; the overwhelmingly common case, allocated once. */
  static readonly EMPTY = new QNameSet(new Set<NamespaceUri>(), new Set<string>());

  private constructor(
    private readonly wildcards: ReadonlySet<NamespaceUri>,
    /** Keys are `uri + ' ' + localName`; a space occurs in neither a URI nor an NCName. */
    private readonly exact: ReadonlySet<string>,
  ) {}

  static of(entries: Iterable<{ uri: NamespaceUri; localName: string }>): QNameSet {
    const wildcards = new Set<NamespaceUri>();
    const exact = new Set<string>();
    for (const { uri, localName } of entries) {
      if (localName === '*') wildcards.add(uri);
      else exact.add(key(uri, localName));
    }
    return wildcards.size === 0 && exact.size === 0
      ? QNameSet.EMPTY
      : new QNameSet(wildcards, exact);
  }

  get isEmpty(): boolean {
    return this.wildcards.size === 0 && this.exact.size === 0;
  }

  has(uri: NamespaceUri, localName: string): boolean {
    return this.wildcards.has(uri) || this.exact.has(key(uri, localName));
  }

  /** The scoping rule: an inner declaration adds to the outer one, never replaces it. */
  union(other: QNameSet): QNameSet {
    if (other.isEmpty) return this;
    if (this.isEmpty) return other;
    return new QNameSet(
      new Set([...this.wildcards, ...other.wildcards]),
      new Set([...this.exact, ...other.exact]),
    );
  }
}

function key(uri: NamespaceUri, localName: string): string {
  return `${uri} ${localName}`;
}

/* ------------------------------------------------------------------------- */
/* Context                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * What this consumer understands.
 *
 * "Understood" means: there is a generated model for this namespace, so markup
 * in it can be read into the document model and written back out with its
 * meaning intact. It is not the same as "can round-trip" — we round-trip
 * everything — and it is not the same as "is in ECMA-376". A namespace we merely
 * preserve as `RawNode` is *not* understood, and saying otherwise would make us
 * select an `mc:Choice` whose content we cannot actually render.
 *
 * Immutable, and cheap to derive with {@link McContext.with}: the alternate
 * branch of an `mc:AlternateContent` is evaluated against the same context, and
 * a feature-detection test wants to flip one namespace and re-run.
 */
export class McContext {
  readonly understood: ReadonlySet<NamespaceUri>;

  constructor(understood: Iterable<NamespaceUri> = []) {
    const set = new Set(understood);
    // The MC namespace is understood by definition: we are the MCE processor.
    set.add(MC_NAMESPACE);
    // Implicitly bound by the XML specification and always meaningful
    // (`xml:space`, `xml:lang`). Never declared, so never listed by a producer.
    set.add(XML_NAMESPACE);
    this.understood = set;
  }

  understands(uri: NamespaceUri): boolean {
    return this.understood.has(uri);
  }

  /** A context with `additional` also understood. */
  with(...additional: NamespaceUri[]): McContext {
    return new McContext([...this.understood, ...additional]);
  }

  /** A context with `removed` no longer understood. Used in tests and feature probes. */
  without(...removed: NamespaceUri[]): McContext {
    const set = new Set(this.understood);
    for (const uri of removed) set.delete(uri);
    return new McContext(set);
  }
}

/* ------------------------------------------------------------------------- */
/* Scopes                                                                     */
/* ------------------------------------------------------------------------- */

/**
 * The MCE state in effect at one element.
 *
 * `prefixes` is *flattened* — the full prefix→URI map in scope, not just this
 * element's declarations. Flattening costs a map copy per element that declares
 * a namespace, which in practice is the root and almost nothing else (Word
 * declares its fifteen namespaces on `w:document` and none below), and it makes
 * every lookup an O(1) `Map.get` instead of a walk up the stack. Elements that
 * declare nothing share their parent's map object outright, so the common case
 * allocates nothing at all.
 */
interface McScope {
  readonly prefixes: ReadonlyMap<string, NamespaceUri>;
  readonly ignorable: ReadonlySet<NamespaceUri>;
  readonly processContent: QNameSet;
  readonly preserveElements: QNameSet;
  readonly preserveAttributes: QNameSet;
}

const EMPTY_URI_SET: ReadonlySet<NamespaceUri> = new Set<NamespaceUri>();

const ROOT_SCOPE: McScope = {
  // `xml` is bound implicitly by the Namespaces in XML specification and must
  // never be declared, so it has to be seeded rather than discovered.
  prefixes: new Map([['xml', XML_NAMESPACE]]),
  ignorable: EMPTY_URI_SET,
  processContent: QNameSet.EMPTY,
  preserveElements: QNameSet.EMPTY,
  preserveAttributes: QNameSet.EMPTY,
};

/* ------------------------------------------------------------------------- */
/* Decisions                                                                  */
/* ------------------------------------------------------------------------- */

/** What a reader should do with the element it is standing on. */
export type McAction =
  /** Read it normally. */
  | 'process'
  /** `mc:AlternateContent`: capture it whole, then {@link McResolver.selectAlternateContent}. */
  | 'alternateContent'
  /**
   * Ignorable and listed in `mc:ProcessContent`: the element itself is dropped
   * but its children are processed *as if they were children of its parent*.
   * The wrapper must still be captured so that saving reproduces it.
   */
  | 'processContent'
  /** Ignorable and not understood: the whole subtree is dropped (but captured). */
  | 'ignoreSubtree';

/** The result of consulting the resolver at an element. */
export interface McDecision {
  readonly action: McAction;
  /**
   * Whether the element's own namespace is understood. `false` with
   * `action: 'process'` is the deviation documented in the file header: markup
   * we cannot interpret but will not discard.
   */
  readonly understood: boolean;
  /**
   * The attributes the reader should see: MCE's own attributes removed (they are
   * instructions, not content), and attributes in ignorable, not-understood
   * namespaces removed. Identity-equal to `element.attrs` when nothing was
   * filtered, so the common case does not allocate.
   */
  readonly attrs: readonly XmlAttr[];
  /**
   * True when Part 3 explicitly requires this element to survive a round-trip
   * (`mc:PreserveElements`). Informational: this implementation preserves
   * everything regardless, so nothing branches on it — but a consumer that
   * prunes needs it, and losing the information at parse time would be
   * irreversible.
   */
  readonly preserve: boolean;
}

/** The outcome of resolving an `mc:AlternateContent`. */
export interface McSelection {
  /**
   * The captured element, verbatim and complete, including the branches that
   * were *not* selected. Write this back with `sink.raw(node)` and the document
   * is byte-identical to the input for this subtree. This is the field that
   * makes the round-trip guarantee true.
   */
  readonly node: RawNode;
  /** Which kind of branch won. `'none'` means no Choice matched and there was no Fallback. */
  readonly kind: 'choice' | 'fallback' | 'none';
  /** The winning `mc:Choice`/`mc:Fallback` element, or `undefined` when `kind` is `'none'`. */
  readonly branch: RawNode | undefined;
  /** Index of the winning branch among the Choices, or `undefined` for a Fallback. */
  readonly choiceIndex: number | undefined;
  /** The children of the winning branch — the content to actually read. Empty for `'none'`. */
  readonly content: readonly RawChild[];
  /** The `Requires` namespaces of every Choice, in document order. For diagnostics. */
  readonly requirements: readonly (readonly NamespaceUri[])[];
  /**
   * A resolver whose scope is the one *inside* the winning branch, so that MCE
   * attributes nested within the selected content resolve their prefixes
   * against the declarations that were in scope at capture time. Pair it with
   * {@link McSelection.cursor}.
   */
  readonly resolver: McResolver;
  /** A cursor over {@link McSelection.content}, ready for an ordinary reader. */
  cursor(): XmlCursor;
}

/* ------------------------------------------------------------------------- */
/* The resolver                                                               */
/* ------------------------------------------------------------------------- */

/**
 * The MCE state machine, consulted once per element.
 *
 * Usage mirrors the shape of a recursive-descent reader exactly:
 *
 * ```ts
 * const decision = resolver.enter(start);      // cursor is on `start`
 * try {
 *   switch (decision.action) { … }
 * } finally {
 *   resolver.exit();                           // once per enter(), always
 * }
 * ```
 *
 * `enter`/`exit` must be balanced even for an element whose subtree is skipped;
 * `exit()` pops the scope and nothing else, so a `finally` is the right place
 * for it. The resolver holds no reference to the cursor and does not advance it
 * — it answers questions about an element it is shown, which keeps it testable
 * without a document.
 */
export class McResolver {
  readonly context: McContext;
  #stack: McScope[];

  constructor(context: McContext, initialScope: McScope = ROOT_SCOPE) {
    this.context = context;
    this.#stack = [initialScope];
  }

  /** Nesting depth, counting the implicit root scope as 0. */
  get depth(): number {
    return this.#stack.length - 1;
  }

  private get scope(): McScope {
    const top = this.#stack[this.#stack.length - 1];
    /* c8 ignore next */
    if (top === undefined) throw new Error('MCE scope stack underflow');
    return top;
  }

  /** The prefix→URI bindings currently in scope, flattened. */
  get prefixes(): ReadonlyMap<string, NamespaceUri> {
    return this.scope.prefixes;
  }

  /** Namespaces the document has declared ignorable at this point. */
  get ignorable(): ReadonlySet<NamespaceUri> {
    return this.scope.ignorable;
  }

  /** Resolve a prefix against the current scope. `''` is the default namespace. */
  lookupPrefix(prefix: string): NamespaceUri | undefined {
    const uri = this.scope.prefixes.get(prefix);
    // `xmlns=""` binds the default prefix to the empty string, which means "no
    // namespace" and is not the same as "not declared".
    return uri === undefined || uri === '' ? undefined : uri;
  }

  /** Part 3 `mc:PreserveElements`. See {@link McDecision.preserve}. */
  shouldPreserveElement(uri: NamespaceUri, localName: string): boolean {
    return this.scope.preserveElements.has(uri, localName);
  }

  /** Part 3 `mc:PreserveAttributes`. */
  shouldPreserveAttribute(uri: NamespaceUri, localName: string): boolean {
    return this.scope.preserveAttributes.has(uri, localName);
  }

  /**
   * Push the element's scope and decide what to do with it.
   *
   * The element's own MCE attributes are applied *before* the decision, so an
   * element may make itself ignorable. Part 3 does not forbid it and the
   * scoping rule ("this element and its descendants") says it applies, so the
   * literal reading is the one implemented.
   *
   * @throws {McError} with code `'must-understand'` if `mc:MustUnderstand`
   *   names a namespace outside {@link McContext.understood}.
   */
  enter(element: XmlStartElement): McDecision {
    const parent = this.scope;
    const prefixes = extendPrefixes(parent.prefixes, element.nsDeclarations);

    let ignorable = parent.ignorable;
    let processContent = parent.processContent;
    let preserveElements = parent.preserveElements;
    let preserveAttributes = parent.preserveAttributes;
    let sawMcAttribute = false;

    for (const attr of element.attrs) {
      if (attr.uri !== MC_NAMESPACE) continue;
      sawMcAttribute = true;
      switch (attr.localName) {
        case MC_NAMES.ignorable: {
          const added = resolvePrefixList(attr.value, prefixes, 'lenient');
          if (added.length > 0) ignorable = new Set([...ignorable, ...added]);
          break;
        }
        case MC_NAMES.mustUnderstand: {
          // Strict on purpose: see the file header. A namespace we are told we
          // must understand and do not is the one case where continuing means
          // showing the user a document we know to be wrong.
          for (const uri of resolvePrefixList(attr.value, prefixes, 'strict')) {
            if (!this.context.understands(uri)) {
              throw new McError(
                `mc:MustUnderstand requires the namespace ${uri}, which this consumer ` +
                  `does not understand (on <${element.localName}>)`,
                'must-understand',
              );
            }
          }
          break;
        }
        case MC_NAMES.processContent:
          processContent = processContent.union(resolveQNameList(attr.value, prefixes));
          break;
        case MC_NAMES.preserveElements:
          preserveElements = preserveElements.union(resolveQNameList(attr.value, prefixes));
          break;
        case MC_NAMES.preserveAttributes:
          preserveAttributes = preserveAttributes.union(resolveQNameList(attr.value, prefixes));
          break;
        default:
          // An unknown attribute in the MC namespace. Part 3 has no extension
          // point here, but neither refusing nor honouring it is better than
          // ignoring it, and it is still preserved for round-trip.
          break;
      }
    }

    this.#stack.push(
      prefixes === parent.prefixes && !sawMcAttribute
        ? parent
        : { prefixes, ignorable, processContent, preserveElements, preserveAttributes },
    );

    const understood = this.context.understands(element.uri);
    const action = decideAction(element, understood, ignorable, processContent);
    return {
      action,
      understood,
      attrs: filterAttributes(element.attrs, this.context, ignorable),
      preserve: preserveElements.has(element.uri, element.localName),
    };
  }

  /** Pop the scope pushed by the matching {@link McResolver.enter}. */
  exit(): void {
    if (this.#stack.length <= 1) {
      throw new McError(
        'McResolver.exit() called more times than enter(); enter/exit must be balanced',
        'malformed-alternate-content',
      );
    }
    this.#stack.pop();
  }

  /**
   * Choose a branch of a captured `mc:AlternateContent`.
   *
   * The rule, from Part 3 §10.2: take the **first** `mc:Choice` whose every
   * `Requires` prefix resolves to a namespace this consumer understands. If none
   * does, take the `mc:Fallback`. If there is no Fallback, the element
   * contributes nothing — which is a legal outcome, not an error: it is how a
   * producer says "this content only exists for consumers that have the feature".
   *
   * Note what is *not* in the rule: there is no scoring, no "best match", and no
   * preference for the Choice that requires the most. First match wins, so a
   * producer orders its Choices most-capable first. Getting that backwards would
   * make us prefer the degraded rendering on documents that contain both.
   *
   * `node` may be passed with the resolver standing either outside or inside the
   * `mc:AlternateContent` element — the node's own declarations are applied here
   * either way, and applying them twice is idempotent.
   *
   * @throws {McError} with code `'malformed-alternate-content'`.
   */
  selectAlternateContent(node: RawNode): McSelection {
    if (!isAlternateContent(node.uri, node.localName)) {
      throw new McError(
        `expected mc:AlternateContent, got {${node.uri}}${node.localName}`,
        'malformed-alternate-content',
      );
    }

    const outerPrefixes = extendPrefixes(this.scope.prefixes, node.nsDeclarations);

    const choices: RawNode[] = [];
    const requirements: NamespaceUri[][] = [];
    let fallback: RawNode | undefined;

    for (const child of node.children) {
      if ('kind' in child) {
        // Whitespace, comments and PIs between branches are cosmetic. They are
        // still in `node.children` and so still written back verbatim; they just
        // do not participate in selection.
        if (child.kind === 'text' && child.value.trim() !== '') {
          throw new McError(
            'mc:AlternateContent may not contain character data',
            'malformed-alternate-content',
          );
        }
        continue;
      }
      if (child.uri !== MC_NAMESPACE) {
        throw new McError(
          `mc:AlternateContent may only contain mc:Choice and mc:Fallback, found ` +
            `{${child.uri}}${child.localName}`,
          'malformed-alternate-content',
        );
      }
      if (child.localName === MC_NAMES.choice) {
        if (fallback !== undefined) {
          throw new McError(
            'mc:Choice may not follow mc:Fallback',
            'malformed-alternate-content',
          );
        }
        const requires = requiresAttribute(child);
        if (requires === undefined) {
          throw new McError(
            'mc:Choice is missing its required Requires attribute',
            'malformed-alternate-content',
          );
        }
        const prefixes = extendPrefixes(outerPrefixes, child.nsDeclarations);
        // 'lenient': an unresolvable prefix yields no URI, the Choice cannot be
        // fully satisfied, and the next branch is tried. See the file header.
        const needed = resolvePrefixList(requires, prefixes, 'lenient');
        const declared = splitList(requires).length;
        choices.push(child);
        // A prefix that did not resolve is recorded as a requirement that cannot
        // be met, which `satisfied` below detects by count.
        requirements.push(needed.length === declared ? needed : [...needed, UNRESOLVABLE]);
      } else if (child.localName === MC_NAMES.fallback) {
        if (fallback !== undefined) {
          throw new McError(
            'mc:AlternateContent may contain at most one mc:Fallback',
            'malformed-alternate-content',
          );
        }
        fallback = child;
      } else {
        throw new McError(
          `mc:AlternateContent may only contain mc:Choice and mc:Fallback, found mc:${child.localName}`,
          'malformed-alternate-content',
        );
      }
    }

    if (choices.length === 0) {
      throw new McError(
        'mc:AlternateContent requires at least one mc:Choice',
        'malformed-alternate-content',
      );
    }

    for (let i = 0; i < choices.length; i += 1) {
      const needed = requirements[i] ?? [];
      if (needed.every((uri) => uri !== UNRESOLVABLE && this.context.understands(uri))) {
        const branch = choices[i] as RawNode;
        return this.selection(node, outerPrefixes, branch, 'choice', i, requirements);
      }
    }

    if (fallback !== undefined) {
      return this.selection(node, outerPrefixes, fallback, 'fallback', undefined, requirements);
    }

    return {
      node,
      kind: 'none',
      branch: undefined,
      choiceIndex: undefined,
      content: [],
      requirements,
      resolver: new McResolver(this.context, { ...this.scope, prefixes: outerPrefixes }),
      cursor: () => createCursorOverRaw([]),
    };
  }

  private selection(
    node: RawNode,
    outerPrefixes: ReadonlyMap<string, NamespaceUri>,
    branch: RawNode,
    kind: 'choice' | 'fallback',
    choiceIndex: number | undefined,
    requirements: readonly (readonly NamespaceUri[])[],
  ): McSelection {
    // The branch element itself may carry mc:Ignorable etc., and its namespace
    // declarations are in scope for its children. Running the branch through a
    // throwaway resolver applies both without duplicating the logic.
    const inner = new McResolver(this.context, { ...this.scope, prefixes: outerPrefixes });
    inner.enter({
      type: 'startElement',
      uri: branch.uri,
      localName: branch.localName,
      prefix: branch.prefix,
      attrs: branch.attrs,
      nsDeclarations: branch.nsDeclarations,
      selfClosing: branch.children.length === 0,
    });
    const content = branch.children;
    return {
      node,
      kind,
      branch,
      choiceIndex,
      content,
      requirements,
      resolver: inner,
      cursor: () => createCursorOverRaw(content),
    };
  }
}

/** Sentinel URI standing for "this prefix did not resolve". Cannot be a real URI. */
const UNRESOLVABLE: NamespaceUri = ' unresolvable';

/* ------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* ------------------------------------------------------------------------- */

function decideAction(
  element: XmlStartElement,
  understood: boolean,
  ignorable: ReadonlySet<NamespaceUri>,
  processContent: QNameSet,
): McAction {
  if (isAlternateContent(element.uri, element.localName)) return 'alternateContent';
  if (understood) return 'process';
  if (!ignorable.has(element.uri)) {
    // Neither understood nor ignorable. Part 3 says fail; we preserve. See the
    // file header for why.
    return 'process';
  }
  // Part 3 §10.1.2: ProcessContent applies only to elements that are already
  // ignorable, which is why this test is inside the ignorable branch.
  return processContent.has(element.uri, element.localName) ? 'processContent' : 'ignoreSubtree';
}

/**
 * Flatten this element's declarations onto the inherited map.
 *
 * Returns the parent map unchanged when the element declares nothing, which lets
 * {@link McResolver.enter} share the parent scope object outright.
 */
function extendPrefixes(
  parent: ReadonlyMap<string, NamespaceUri>,
  declarations: ReadonlyMap<string, NamespaceUri>,
): ReadonlyMap<string, NamespaceUri> {
  if (declarations.size === 0) return parent;
  const next = new Map(parent);
  for (const [prefix, uri] of declarations) next.set(prefix, uri);
  return next;
}

/** XSD list whitespace: split on any run of whitespace, dropping empties. */
function splitList(value: string): string[] {
  const trimmed = value.trim();
  return trimmed === '' ? [] : trimmed.split(/[\t\n\r ]+/);
}

/**
 * Resolve a whitespace-delimited list of prefixes to namespace URIs.
 *
 * `'strict'` throws on an undeclared prefix; `'lenient'` drops it. The two MCE
 * attributes that take prefix lists want different answers — see the file
 * header.
 */
function resolvePrefixList(
  value: string,
  prefixes: ReadonlyMap<string, NamespaceUri>,
  mode: 'strict' | 'lenient',
): NamespaceUri[] {
  const out: NamespaceUri[] = [];
  for (const prefix of splitList(value)) {
    const uri = prefixes.get(prefix);
    if (uri === undefined || uri === '') {
      if (mode === 'strict') {
        throw new McError(
          `prefix "${prefix}" is not bound to a namespace in scope`,
          'undeclared-prefix',
        );
      }
      continue;
    }
    out.push(uri);
  }
  return out;
}

/**
 * Resolve a whitespace-delimited list of qualified names.
 *
 * `prefix:local` and `prefix:*` are the forms Part 3 defines. An unprefixed name
 * resolves against the default namespace, which is what the XML rules for
 * QNames-in-content say; in a `.docx` the default namespace is normally
 * undeclared, so an unprefixed entry there simply resolves to no namespace and
 * matches nothing. Undeclared prefixes are dropped: these three attributes are
 * advisory, and an entry we cannot resolve cannot match anything either way.
 */
function resolveQNameList(
  value: string,
  prefixes: ReadonlyMap<string, NamespaceUri>,
): QNameSet {
  const entries: { uri: NamespaceUri; localName: string }[] = [];
  for (const token of splitList(value)) {
    const colon = token.indexOf(':');
    const prefix = colon === -1 ? '' : token.slice(0, colon);
    const localName = colon === -1 ? token : token.slice(colon + 1);
    if (localName === '') continue;
    const uri = prefixes.get(prefix);
    if (uri === undefined) continue;
    entries.push({ uri, localName });
  }
  return QNameSet.of(entries);
}

/**
 * The `Requires` attribute of an `mc:Choice`.
 *
 * Part 3 declares it unprefixed, therefore in no namespace, and that is what
 * Word writes. `mc:Requires` is accepted as well: it is not conformant, but some
 * producers emit it, the intent is unambiguous, and rejecting it would mean
 * choosing a branch at random on documents that are otherwise fine.
 */
function requiresAttribute(choice: RawNode): string | undefined {
  let prefixed: string | undefined;
  for (const attr of choice.attrs) {
    if (attr.localName !== MC_NAMES.requires) continue;
    if (attr.uri === '') return attr.value;
    if (attr.uri === MC_NAMESPACE) prefixed = attr.value;
  }
  return prefixed;
}

/**
 * Strip the attributes a reader should not see.
 *
 * Two kinds go: MCE's own attributes, which are processing instructions to us
 * rather than document content, and attributes in an ignorable namespace we do
 * not understand, which Part 3 says to drop. Both are still present on the
 * `XmlStartElement` and on any `RawNode` captured from it, so dropping them here
 * costs nothing on the write path.
 *
 * Returns the input array by identity when nothing is filtered — the case for
 * essentially every element in a document.
 */
function filterAttributes(
  attrs: readonly XmlAttr[],
  context: McContext,
  ignorable: ReadonlySet<NamespaceUri>,
): readonly XmlAttr[] {
  let needsFilter = false;
  for (const attr of attrs) {
    if (attr.uri === MC_NAMESPACE || (ignorable.has(attr.uri) && !context.understands(attr.uri))) {
      needsFilter = true;
      break;
    }
  }
  if (!needsFilter) return attrs;
  return attrs.filter(
    (attr) =>
      attr.uri !== MC_NAMESPACE && !(ignorable.has(attr.uri) && !context.understands(attr.uri)),
  );
}
