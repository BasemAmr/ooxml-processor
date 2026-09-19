import { parseXsdDocument, type XsdNode } from '../loader.js';
import { generatedBanner } from './source.js';

export interface GeneratedModule {
  readonly path: string;
  readonly contents: string;
}

interface GeometryNode {
  readonly name: string;
  readonly avLst: readonly { name: string; formula: string }[];
  readonly gdLst: readonly { name: string; formula: string }[];
  readonly ahLst: readonly GeometryHandleNode[];
  readonly cxnLst: readonly GeometryConnectionNode[];
  readonly rect?: { l: string; t: string; r: string; b: string };
  readonly pathLst: readonly GeometryPathNode[];
}

interface GeometryHandleNode {
  readonly kind: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly pos?: { x: string; y: string };
}

interface GeometryConnectionNode {
  readonly ang?: string;
  readonly pos?: { x: string; y: string };
}

interface GeometryPathNode {
  readonly w?: string;
  readonly h?: string;
  readonly fill?: string;
  readonly stroke?: string;
  readonly extrusionOk?: string;
  readonly commands: readonly GeometryCommandNode[];
}

type GeometryCommandNode =
  | {
      readonly op: 'moveTo' | 'lnTo' | 'quadBezTo' | 'cubicBezTo';
      readonly points: readonly { x: string; y: string }[];
    }
  | {
      readonly op: 'arcTo';
      readonly wR: string;
      readonly hR: string;
      readonly stAng: string;
      readonly swAng: string;
    }
  | { readonly op: 'close' };

function child(node: XsdNode, local: string): XsdNode | undefined {
  return node.children.find((entry) => entry.local === local);
}

function children(node: XsdNode, local: string): readonly XsdNode[] {
  return node.children.filter((entry) => entry.local === local);
}

function attr(node: XsdNode, name: string): string | undefined {
  return node.attrs.get(name);
}

function readGuides(container: XsdNode | undefined): readonly { name: string; formula: string }[] {
  if (!container) return [];
  return children(container, 'gd')
    .map((gd) => ({ name: attr(gd, 'name'), formula: attr(gd, 'fmla') }))
    .filter(
      (gd): gd is { name: string; formula: string } =>
        gd.name !== undefined && gd.formula !== undefined,
    );
}

function readPoint(node: XsdNode): { x: string; y: string } | undefined {
  const x = attr(node, 'x');
  const y = attr(node, 'y');
  return x === undefined || y === undefined ? undefined : { x, y };
}

function readAttrs(node: XsdNode): Readonly<Record<string, string>> {
  return Object.fromEntries([...node.attrs.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function readHandles(container: XsdNode | undefined): readonly GeometryHandleNode[] {
  if (!container) return [];
  return container.children
    .filter((node) => node.local === 'ahXY' || node.local === 'ahPolar')
    .map((node) => {
      const posNode = child(node, 'pos');
      const pos = posNode ? readPoint(posNode) : undefined;
      return { kind: node.local, attrs: readAttrs(node), ...(pos === undefined ? {} : { pos }) };
    });
}

function readConnections(container: XsdNode | undefined): readonly GeometryConnectionNode[] {
  if (!container) return [];
  return children(container, 'cxn').map((node) => {
    const posNode = child(node, 'pos');
    const pos = posNode ? readPoint(posNode) : undefined;
    const ang = attr(node, 'ang');
    return { ...(ang === undefined ? {} : { ang }), ...(pos === undefined ? {} : { pos }) };
  });
}

function readCommands(path: XsdNode): readonly GeometryCommandNode[] {
  const commands: GeometryCommandNode[] = [];
  for (const node of path.children) {
    switch (node.local) {
      case 'moveTo':
      case 'lnTo':
      case 'quadBezTo':
      case 'cubicBezTo': {
        const points = children(node, 'pt')
          .map(readPoint)
          .filter((point): point is { x: string; y: string } => point !== undefined);
        commands.push({ op: node.local, points });
        break;
      }
      case 'arcTo': {
        const wR = attr(node, 'wR');
        const hR = attr(node, 'hR');
        const stAng = attr(node, 'stAng');
        const swAng = attr(node, 'swAng');
        if (wR !== undefined && hR !== undefined && stAng !== undefined && swAng !== undefined)
          commands.push({ op: 'arcTo', wR, hR, stAng, swAng });
        break;
      }
      case 'close':
        commands.push({ op: 'close' });
        break;
      default:
        break;
    }
  }
  return commands;
}

function readShape(node: XsdNode): GeometryNode {
  const avLst = readGuides(child(node, 'avLst'));
  const gdLst = readGuides(child(node, 'gdLst'));
  const ahLst = readHandles(child(node, 'ahLst'));
  const cxnLst = readConnections(child(node, 'cxnLst'));
  const rectNode = child(node, 'rect');
  const l = rectNode && attr(rectNode, 'l');
  const t = rectNode && attr(rectNode, 't');
  const r = rectNode && attr(rectNode, 'r');
  const b = rectNode && attr(rectNode, 'b');
  const rect =
    l !== undefined && t !== undefined && r !== undefined && b !== undefined
      ? { l, t, r, b }
      : undefined;
  const pathList = child(node, 'pathLst');
  const pathLst = pathList
    ? children(pathList, 'path').map((path) => {
        let result: GeometryPathNode = { commands: readCommands(path) };
        for (const name of ['w', 'h', 'fill', 'stroke', 'extrusionOk'] as const) {
          const value = attr(path, name);
          if (value !== undefined) result = { ...result, [name]: value };
        }
        return result;
      })
    : [];
  return {
    name: node.local,
    avLst,
    gdLst,
    ahLst,
    cxnLst,
    ...(rect === undefined ? {} : { rect }),
    pathLst,
  };
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/"([^"\\]+)":/gu, '$1:');
}

/** Emits the static DrawingML preset geometry table from the vendored asset. */
export function emitPresetGeometries(xml: string): GeneratedModule {
  const root = parseXsdDocument(xml, 'geometries/presetShapeDefinitions.xml');
  const shapes = root.children.filter((node) => node.local !== '').map(readShape);
  const byName = new Map<string, GeometryNode>();
  for (const shape of shapes) if (!byName.has(shape.name)) byName.set(shape.name, shape);
  const contents = [
    generatedBanner('DrawingML preset shape geometries from presetShapeDefinitions.xml'),
    '/** Source order is retained in PRESET_GEOMETRY_ENTRIES; duplicate source names are intentional. */',
    `export const PRESET_GEOMETRY_ENTRIES = ${json(shapes)} as const;`,
    '',
    `export const PRESET_GEOMETRIES = ${json(Object.fromEntries([...byName].sort(([a], [b]) => a.localeCompare(b))))} as const;`,
    '',
  ].join('\n');
  return { path: 'generated/presets.ts', contents };
}
