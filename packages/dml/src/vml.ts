import type { RawChild, RawNode } from '@ooxml/schema';
type WrapMode = 'none' | 'square' | 'tight' | 'through' | 'topAndBottom';

export type VmlUnit = 'pt' | 'px' | 'in' | 'mm' | 'cm' | 'pc' | 'twip' | 'emu';

export interface VmlStyle {
  readonly properties: Readonly<Record<string, string>>;
  readonly position?: string;
  readonly left?: number;
  readonly top?: number;
  readonly width?: number;
  readonly height?: number;
  readonly zIndex?: number;
  readonly rotation?: number;
  readonly horizontalRelative?: string;
  readonly verticalRelative?: string;
}

const LENGTHS = /^(?<number>[+-]?(?:\d+\.?\d*|\.\d+))(?:\s*)(?<unit>pt|px|in|mm|cm|pc|twip|emu)?$/i;

export function parseVmlLength(value: string | number, bareUnit: VmlUnit = 'pt'): number {
  if (typeof value === 'number') return value;
  const match = LENGTHS.exec(value.trim());
  if (!match?.groups) return Number.NaN;
  const amount = Number(match.groups.number);
  const unit = (match.groups.unit?.toLowerCase() as VmlUnit | undefined) ?? bareUnit;
  switch (unit) {
    case 'px':
      return (amount * 72) / 96;
    case 'in':
      return amount * 72;
    case 'mm':
      return (amount * 72) / 25.4;
    case 'cm':
      return (amount * 72) / 2.54;
    case 'pc':
      return amount * 12;
    case 'twip':
      return amount / 20;
    case 'emu':
      return amount / 12700;
    case 'pt':
    default:
      return amount;
  }
}

export function parseVmlStyle(style: string | undefined, bareUnit: VmlUnit = 'pt'): VmlStyle {
  const properties: Record<string, string> = {};
  for (const declaration of (style ?? '').split(';')) {
    const separator = declaration.indexOf(':');
    if (separator <= 0) continue;
    const name = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (name.length > 0) properties[name] = value;
  }
  const number = (name: string): number | undefined => {
    const value = properties[name];
    if (value === undefined) return undefined;
    const parsed = parseVmlLength(value, bareUnit);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const integer = (name: string): number | undefined => {
    const value = properties[name];
    if (value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const result: {
    properties: Readonly<Record<string, string>>;
    position?: string;
    left?: number;
    top?: number;
    width?: number;
    height?: number;
    zIndex?: number;
    rotation?: number;
    horizontalRelative?: string;
    verticalRelative?: string;
  } = { properties };
  if (properties.position !== undefined) result.position = properties.position;
  if (properties['mso-position-horizontal-relative'] !== undefined)
    result.horizontalRelative = properties['mso-position-horizontal-relative'];
  if (properties['mso-position-vertical-relative'] !== undefined)
    result.verticalRelative = properties['mso-position-vertical-relative'];
  const left = number('left');
  if (left !== undefined) result.left = left;
  const top = number('top');
  if (top !== undefined) result.top = top;
  const width = number('width');
  if (width !== undefined) result.width = width;
  const height = number('height');
  if (height !== undefined) result.height = height;
  const zIndex = integer('z-index');
  if (zIndex !== undefined) result.zIndex = zIndex;
  const rotation = number('rotation');
  if (rotation !== undefined) result.rotation = rotation;
  return result;
}

export type VmlPathCommand =
  | { readonly op: 'moveTo' | 'lineTo' | 'cubicTo'; readonly values: readonly number[] }
  | { readonly op: 'close' | 'end' | 'arcTo'; readonly values: readonly number[] };

/** Parses VML's compact m/l/c/x/e path grammar into path-builder commands. */
export function parseVmlPath(path: string | undefined): VmlPathCommand[] {
  if (path === undefined) return [];
  const tokens = path.match(/[a-z]+|[+-]?(?:\d+\.?\d*|\.\d+)/gi) ?? [];
  const commands: VmlPathCommand[] = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index++]!.toLowerCase();
    const take = (count: number): number[] => {
      const values: number[] = [];
      while (values.length < count && index < tokens.length && !/^[a-z]+$/i.test(tokens[index]!))
        values.push(Number(tokens[index++]));
      return values;
    };
    switch (token) {
      case 'm': {
        const values = take(2);
        if (values.length === 2) commands.push({ op: 'moveTo', values });
        break;
      }
      case 'l': {
        const values = take(2);
        if (values.length === 2) commands.push({ op: 'lineTo', values });
        break;
      }
      case 'c': {
        const values = take(6);
        if (values.length === 6) commands.push({ op: 'cubicTo', values });
        break;
      }
      case 'x':
        commands.push({ op: 'close', values: [] });
        break;
      case 'e':
        commands.push({ op: 'end', values: [] });
        break;
      case 'ae':
      case 'at': {
        const values = take(6);
        commands.push({ op: 'arcTo', values });
        break;
      }
      default:
        break;
    }
  }
  return commands;
}

export function vmlAttr(node: RawNode, localName: string): string | undefined {
  return node.attrs.find((attr) => attr.localName === localName)?.value;
}

export function mapVmlWrap(type: string | undefined): WrapMode {
  switch ((type ?? '').toLowerCase()) {
    case 'none':
      return 'none';
    case 'through':
      return 'through';
    case 'tight':
      return 'tight';
    case 'topandbottom':
      return 'topAndBottom';
    default:
      return 'square';
  }
}

export interface VmlTextboxResult<T> {
  readonly content?: T;
  readonly truncated: boolean;
  readonly depth: number;
}

/** Re-enters WML layout for v:textbox content, with a hard recursion bound. */
export function layoutVmlTextbox<T>(
  node: RawNode,
  layout: (children: readonly RawChild[], depth: number) => T,
  depth = 0,
  maxDepth = 8,
): VmlTextboxResult<T> {
  if (depth >= maxDepth) return { truncated: true, depth };
  const content = node.children.find(
    (child): child is RawNode => !('kind' in child) && child.localName === 'txbxContent',
  );
  if (content === undefined) return { truncated: false, depth };
  return { content: layout(content.children, depth + 1), truncated: false, depth };
}
