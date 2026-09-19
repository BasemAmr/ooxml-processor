import type { RawNode } from '@ooxml/schema';
import { parseVmlPath, parseVmlStyle, vmlAttr, type VmlPathCommand, type VmlStyle } from './vml.js';

export interface VmlShapeDescription {
  readonly kind: 'shape' | 'rect' | 'line' | 'oval' | 'roundrect' | 'group';
  readonly style: VmlStyle;
  readonly path: readonly VmlPathCommand[];
  readonly imageRelationship?: string;
  readonly textBox?: RawNode;
}

/** Extracts the paint-relevant VML shape data while retaining the raw node for round-trip. */
export function describeVmlShape(node: RawNode): VmlShapeDescription {
  const kind = (
    node.localName === 'rect' ||
    node.localName === 'line' ||
    node.localName === 'oval' ||
    node.localName === 'roundrect' ||
    node.localName === 'group'
      ? node.localName
      : 'shape'
  ) as VmlShapeDescription['kind'];
  const style = parseVmlStyle(vmlAttr(node, 'style'));
  const path = parseVmlPath(vmlAttr(node, 'path'));
  const image = node.children.find(
    (child): child is RawNode => !('kind' in child) && child.localName === 'imagedata',
  );
  const textBox = node.children.find(
    (child): child is RawNode => !('kind' in child) && child.localName === 'textbox',
  );
  const imageRelationship =
    image === undefined ? undefined : (vmlAttr(image, 'id') ?? vmlAttr(image, 'embed'));
  return imageRelationship === undefined && textBox === undefined
    ? { kind, style, path }
    : {
        kind,
        style,
        path,
        ...(imageRelationship === undefined ? {} : { imageRelationship }),
        ...(textBox === undefined ? {} : { textBox }),
      };
}

/** Finds deferred chart/SmartArt nodes nested in a raw graphic subtree. */
export function findVmlShapes(node: RawNode): VmlShapeDescription[] {
  const out: VmlShapeDescription[] = [];
  const walk = (current: RawNode): void => {
    if (['shape', 'rect', 'line', 'oval', 'roundrect', 'group'].includes(current.localName))
      out.push(describeVmlShape(current));
    for (const child of current.children) if (!('kind' in child)) walk(child);
  };
  walk(node);
  return out;
}
