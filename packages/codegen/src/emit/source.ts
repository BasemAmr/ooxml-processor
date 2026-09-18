/**
 * A tiny TypeScript source builder.
 *
 * Every emitter writes through this rather than concatenating strings, for one
 * reason: generated output is gated on `git diff --exit-code`, so imports have
 * to be collected, deduplicated, aliased and sorted deterministically. Doing
 * that ad hoc in four emitters is how drift gets in.
 *
 * It is not a pretty-printer. Output is formatted well enough to read and then
 * handed to Prettier, which is the actual formatter — `packages/schema/src/generated`
 * is in `.prettierignore` precisely so that the committed bytes are ours and
 * not whatever Prettier version happened to run.
 */

/** Reserved words that cannot be used as a bare identifier. */
const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while',
  'with', 'implements', 'interface', 'let', 'package', 'private', 'protected',
  'public', 'static', 'yield', 'await',
]);

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Whether a name can appear bare as an object/interface property.
 *
 * Reserved words are legal property names in both JS and TS — `{ default: 1 }`
 * parses fine — so only the character shape matters. OOXML element names are
 * NCNames, which permit `-` and `.`; those must be quoted.
 */
export function isBareProperty(name: string): boolean {
  return IDENTIFIER.test(name);
}

/** A property name, quoted only if it has to be. */
export function propertyKey(name: string): string {
  return isBareProperty(name) ? name : JSON.stringify(name);
}

/** A binding identifier. Reserved words and odd characters are escaped. */
export function identifier(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_$]/g, '_');
  const prefixed = /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
  return RESERVED.has(prefixed) ? `${prefixed}_` : prefixed;
}

/** A single-quoted string literal, matching the project's Prettier config. */
export function stringLiteral(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

interface ImportedName {
  readonly local: string;
  readonly typeOnly: boolean;
}

/** The owner recorded for names the module itself declares (see {@link SourceFile.reserveLocal}). */
const OWN_MODULE = '';

export class SourceFile {
  private readonly lines: string[] = [];
  private depth = 0;

  /** module specifier → imported name → local alias. */
  private readonly imports = new Map<string, Map<string, ImportedName>>();

  /** Local alias → the module it came from, so collisions can be detected. */
  private readonly localNames = new Map<string, string>();

  constructor(private readonly banner: string) {}

  // -- imports --------------------------------------------------------------

  /**
   * Mark a name as declared by THIS module.
   *
   * Generated modules declare their own top-level functions — `parseST_Foo`,
   * `readCT_Foo` — and two namespaces can define the same type name
   * (`dml-main#ST_Percentage` and `shared-types#ST_Percentage`), where one
   * legitimately imports the other's parser for a union member. Without this
   * reservation the import would silently take the same local name as the
   * local declaration and fail the generated module's compile (TS2440). Call
   * before emitting bodies: imports are registered as the body is emitted.
   */
  reserveLocal(name: string): void {
    if (!this.localNames.has(name)) this.localNames.set(name, OWN_MODULE);
  }

  /**
   * Request `name` from `module`, returning the local identifier to use.
   *
   * Two namespaces can legitimately export the same type name — `CT_Extension`
   * exists in `dml-chart`, `pml` and `sml`. When that happens the second import
   * is aliased after its module, which is stable because the alias derives from
   * the module path rather than from import order.
   */
  importName(module: string, name: string, typeOnly = true): string {
    const existing = this.imports.get(module)?.get(name);
    if (existing) return existing.local;

    let local = name;
    const owner = this.localNames.get(local);
    if (owner !== undefined && owner !== module) {
      const disambiguator = identifier(module.replace(/^.*\/([^/]+)\/[^/]+$/, '$1'));
      local = `${disambiguator}_${name}`;
    }

    let bucket = this.imports.get(module);
    if (!bucket) {
      bucket = new Map();
      this.imports.set(module, bucket);
    }
    bucket.set(name, { local, typeOnly });
    this.localNames.set(local, module);
    return local;
  }

  // -- body -----------------------------------------------------------------

  line(text = ''): this {
    this.lines.push(text.length === 0 ? '' : '  '.repeat(this.depth) + text);
    return this;
  }

  /** A `//`-prefixed comment, wrapped to a readable width. */
  comment(text: string): this {
    for (const l of wrap(text, 96 - this.depth * 2)) this.line(`// ${l}`);
    return this;
  }

  /** A JSDoc block. Empty input emits nothing rather than an empty comment. */
  doc(text: string | undefined): this {
    if (!text) return this;
    const paragraphs = text
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter((p) => p.length > 0);
    if (paragraphs.length === 0) return this;

    const body = paragraphs.flatMap((p, i) => (i === 0 ? wrap(p, 92) : ['', ...wrap(p, 92)]));
    if (body.length === 1) return this.line(`/** ${body[0]} */`);

    this.line('/**');
    for (const l of body) this.line(l.length === 0 ? ' *' : ` * ${l}`);
    return this.line(' */');
  }

  /** Run `body` one indentation level deeper. */
  indent(body: () => void): this {
    this.depth += 1;
    body();
    this.depth -= 1;
    return this;
  }

  /** `open` … indented body … `close`. */
  block(open: string, body: () => void, close = '}'): this {
    this.line(open);
    this.indent(body);
    return this.line(close);
  }

  blank(): this {
    if (this.lines.length > 0 && this.lines[this.lines.length - 1] !== '') this.lines.push('');
    return this;
  }

  // -- output ---------------------------------------------------------------

  toString(): string {
    const out: string[] = [this.banner.trimEnd(), ''];

    for (const module of [...this.imports.keys()].sort()) {
      const bucket = this.imports.get(module);
      if (!bucket || bucket.size === 0) continue;

      const names = [...bucket.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const allTypeOnly = names.every(([, v]) => v.typeOnly);
      const clauses = names.map(([imported, v]) => {
        const prefix = allTypeOnly || !v.typeOnly ? '' : 'type ';
        return imported === v.local ? `${prefix}${imported}` : `${prefix}${imported} as ${v.local}`;
      });

      const keyword = allTypeOnly ? 'import type' : 'import';
      const single = `${keyword} { ${clauses.join(', ')} } from '${module}';`;
      if (single.length <= 100) {
        out.push(single);
      } else {
        out.push(`${keyword} {`);
        for (const c of clauses) out.push(`  ${c},`);
        out.push(`} from '${module}';`);
      }
    }

    if (this.imports.size > 0) out.push('');
    out.push(...this.lines);

    // Exactly one trailing newline, no trailing blank lines: byte-stability
    // depends on this being the same every run.
    return `${out.join('\n').replace(/\n+$/, '')}\n`;
  }
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length === 0) current = word;
    else if (current.length + 1 + word.length <= width) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/**
 * The header every generated file carries.
 *
 * `@generated` makes the file findable, and the ESLint/Prettier ignores plus
 * `linguist-generated=true` in `.gitattributes` keep it out of review diffs.
 */
export function generatedBanner(sourceDescription: string): string {
  return [
    '/**',
    ' * @generated by @ooxml/codegen — do not edit.',
    ' *',
    ` * Source: ${sourceDescription}`,
    ' *',
    ' * Regenerate with `pnpm gen`. CI fails if this file differs from a fresh run,',
    ' * so hand edits will be reverted by the next build.',
    ' */',
  ].join('\n');
}
