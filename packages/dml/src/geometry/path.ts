import { evaluateFormula, evaluateGuides, type GeometryGuide } from './guides.js';

export interface GeometryPointExpression {
  readonly x: string;
  readonly y: string;
}

export type GeometryCommand =
  | {
      readonly op: 'moveTo' | 'lnTo' | 'quadBezTo' | 'cubicBezTo';
      readonly points: readonly GeometryPointExpression[];
    }
  | {
      readonly op: 'arcTo';
      readonly wR: string;
      readonly hR: string;
      readonly stAng: string;
      readonly swAng: string;
    }
  | { readonly op: 'close' };

export interface GeometryPath {
  readonly w?: string;
  readonly h?: string;
  readonly fill?: string;
  readonly stroke?: string;
  readonly extrusionOk?: string;
  readonly commands: readonly GeometryCommand[];
}

export interface GeometryDefinition {
  readonly avLst?: readonly GeometryGuide[];
  readonly gdLst?: readonly GeometryGuide[];
  readonly pathLst: readonly GeometryPath[];
}

export interface GeometryExtent {
  readonly width: number;
  readonly height: number;
}

export type BuiltGeometryCommand =
  | { readonly op: 'moveTo' | 'lineTo'; readonly x: number; readonly y: number }
  | {
      readonly op: 'quadraticCurveTo';
      readonly cpx: number;
      readonly cpy: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly op: 'bezierCurveTo';
      readonly cp1x: number;
      readonly cp1y: number;
      readonly cp2x: number;
      readonly cp2y: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly op: 'ellipse';
      readonly cx: number;
      readonly cy: number;
      readonly rx: number;
      readonly ry: number;
      readonly startAngle: number;
      readonly sweepAngle: number;
    }
  | { readonly op: 'closePath' };

export interface BuiltGeometryPath {
  readonly fill: boolean;
  readonly stroke: boolean;
  readonly commands: readonly BuiltGeometryCommand[];
}

function value(expression: string, values: Readonly<Record<string, number>>): number {
  return evaluateFormula(`val ${expression}`, values);
}

function point(
  expression: GeometryPointExpression,
  values: Readonly<Record<string, number>>,
  sx: number,
  sy: number,
) {
  return { x: value(expression.x, values) * sx, y: value(expression.y, values) * sy };
}

function pathScale(
  path: GeometryPath,
  extent: GeometryExtent,
  values: Readonly<Record<string, number>>,
): { sx: number; sy: number } {
  const localW = path.w === undefined ? extent.width : value(path.w, values);
  const localH = path.h === undefined ? extent.height : value(path.h, values);
  // A malformed zero extent is kept visible at unit scale rather than creating NaN paint commands.
  return {
    sx: localW === 0 ? 1 : extent.width / localW,
    sy: localH === 0 ? 1 : extent.height / localH,
  };
}

function buildPath(
  path: GeometryPath,
  extent: GeometryExtent,
  values: Readonly<Record<string, number>>,
): BuiltGeometryPath {
  const { sx, sy } = pathScale(path, extent, values);
  const commands: BuiltGeometryCommand[] = [];
  let current = { x: 0, y: 0 };
  for (const command of path.commands) {
    switch (command.op) {
      case 'moveTo': {
        const p = command.points[0];
        if (!p) break;
        current = point(p, values, sx, sy);
        commands.push({ op: 'moveTo', ...current });
        break;
      }
      case 'lnTo': {
        const p = command.points[0];
        if (!p) break;
        current = point(p, values, sx, sy);
        commands.push({ op: 'lineTo', ...current });
        break;
      }
      case 'quadBezTo': {
        const control = command.points[0];
        const end = command.points[1];
        if (!control || !end) break;
        const c = point(control, values, sx, sy);
        current = point(end, values, sx, sy);
        commands.push({ op: 'quadraticCurveTo', cpx: c.x, cpy: c.y, ...current });
        break;
      }
      case 'cubicBezTo': {
        const first = command.points[0];
        const second = command.points[1];
        const end = command.points[2];
        if (!first || !second || !end) break;
        const c1 = point(first, values, sx, sy);
        const c2 = point(second, values, sx, sy);
        current = point(end, values, sx, sy);
        commands.push({
          op: 'bezierCurveTo',
          cp1x: c1.x,
          cp1y: c1.y,
          cp2x: c2.x,
          cp2y: c2.y,
          ...current,
        });
        break;
      }
      case 'arcTo': {
        const rx = value(command.wR, values) * sx;
        const ry = value(command.hR, values) * sy;
        const startAngle = (value(command.stAng, values) / 60000) * (Math.PI / 180);
        const sweepAngle = (value(command.swAng, values) / 60000) * (Math.PI / 180);
        // DrawingML gives the current point on the ellipse. Back-computing the
        // centre is required because Canvas's ellipse() takes the centre.
        const cx = current.x - rx * Math.cos(startAngle);
        const cy = current.y - ry * Math.sin(startAngle);
        commands.push({ op: 'ellipse', cx, cy, rx, ry, startAngle, sweepAngle });
        current = {
          x: cx + rx * Math.cos(startAngle + sweepAngle),
          y: cy + ry * Math.sin(startAngle + sweepAngle),
        };
        break;
      }
      case 'close':
        commands.push({ op: 'closePath' });
        break;
    }
  }
  return { fill: path.fill !== 'none', stroke: path.stroke !== 'false', commands };
}

/** Evaluates a preset or inline `a:custGeom` definition into canvas-neutral path commands. */
export function buildGeometryPaths(
  definition: GeometryDefinition,
  extent: GeometryExtent,
  adjustments: Readonly<Record<string, number>> = {},
): readonly BuiltGeometryPath[] {
  const base = evaluateGuides(definition.avLst ?? [], { w: extent.width, h: extent.height });
  const resolvedAdjustments = { ...base, ...adjustments };
  const values = evaluateGuides(definition.gdLst ?? [], {
    w: extent.width,
    h: extent.height,
    adjustments: resolvedAdjustments,
  });
  return definition.pathLst.map((path) => buildPath(path, extent, values));
}
