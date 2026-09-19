import type { RawNode } from '@ooxml/schema';

export interface MceSelection {
  readonly selected: 'choice' | 'fallback' | 'none';
  readonly children: readonly RawNode[];
  readonly source: RawNode;
}

function attr(node: RawNode, name: string): string | undefined {
  return node.attrs.find((value) => value.localName === name)?.value;
}
function elementChildren(node: RawNode): RawNode[] {
  return node.children.filter((child): child is RawNode => !('kind' in child));
}

export function isAlternateContent(node: RawNode): boolean {
  return (
    (node.localName === 'AlternateContent' && /markup-compatibility/i.test(node.uri)) ||
    node.localName === 'AlternateContent'
  );
}

/** Selects the first supported mc:Choice and retains the original node verbatim. */
export function selectMceBranch(node: RawNode, supported: ReadonlySet<string>): MceSelection {
  const branches = elementChildren(node);
  for (const choice of branches.filter((child) => child.localName === 'Choice')) {
    const requires = (attr(choice, 'Requires') ?? '').split(/\s+/).filter(Boolean);
    const supportedChoice = requires.every(
      (name) =>
        supported.has(name) ||
        [...choice.nsDeclarations.entries(), ...node.nsDeclarations.entries()].some(
          ([prefix, uri]) => prefix === name && supported.has(uri),
        ),
    );
    if (supportedChoice)
      return { selected: 'choice', children: elementChildren(choice), source: node };
  }
  const fallback = branches.find((child) => child.localName === 'Fallback');
  if (fallback !== undefined)
    return { selected: 'fallback', children: elementChildren(fallback), source: node };
  return { selected: 'none', children: [], source: node };
}
