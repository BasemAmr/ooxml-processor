import { describe, expect, it } from 'vitest';
import { PRESET_GEOMETRIES, PRESET_GEOMETRY_ENTRIES, buildPresetGeometry } from './presets.js';
import { buildGeometryPaths, type GeometryDefinition } from './path.js';

describe('DrawingML preset and custom geometry paths', () => {
  it('keeps all 187 source entries and exposes the unique name lookup', () => {
    expect(PRESET_GEOMETRY_ENTRIES).toHaveLength(187);
    expect(Object.keys(PRESET_GEOMETRIES)).toHaveLength(186);
    expect(PRESET_GEOMETRY_ENTRIES.filter((entry) => entry.name === 'upDownArrow')).toHaveLength(2);
  });

  it.each([
    'rect',
    'roundRect',
    'ellipse',
    'triangle',
    'star5',
    'rightArrow',
    'wedgeRoundRectCallout',
  ])('builds the %s preset', (name) => {
    const paths = buildPresetGeometry(name, { width: 200, height: 100 });
    expect(paths).toBeDefined();
    expect(paths?.length).toBeGreaterThan(0);
    expect(paths?.[0]?.commands.length).toBeGreaterThan(0);
  });

  it('maps the rectangle control points exactly', () => {
    const commands = buildPresetGeometry('rect', { width: 200, height: 100 })?.[0]?.commands;
    expect(commands).toEqual([
      { op: 'moveTo', x: 0, y: 0 },
      { op: 'lineTo', x: 200, y: 0 },
      { op: 'lineTo', x: 200, y: 100 },
      { op: 'lineTo', x: 0, y: 100 },
      { op: 'closePath' },
    ]);
  });

  it('scales a custom path local coordinate space onto the shape extent', () => {
    const definition: GeometryDefinition = {
      pathLst: [
        {
          w: '10',
          h: '20',
          fill: 'none',
          stroke: 'true',
          commands: [
            { op: 'moveTo', points: [{ x: '0', y: '0' }] },
            { op: 'lnTo', points: [{ x: '10', y: '20' }] },
          ],
        },
      ],
    };
    const path = buildGeometryPaths(definition, { width: 100, height: 50 })[0];
    expect(path?.fill).toBe(false);
    expect(path?.stroke).toBe(true);
    expect(path?.commands).toEqual([
      { op: 'moveTo', x: 0, y: 0 },
      { op: 'lineTo', x: 100, y: 50 },
    ]);
  });

  it('derives an arc centre from the current point', () => {
    const definition: GeometryDefinition = {
      pathLst: [
        {
          commands: [
            { op: 'moveTo', points: [{ x: '10', y: '0' }] },
            { op: 'arcTo', wR: '10', hR: '10', stAng: '0', swAng: '5400000' },
          ],
        },
      ],
    };
    const command = buildGeometryPaths(definition, { width: 100, height: 100 })[0]?.commands[1];
    expect(command).toMatchObject({ op: 'ellipse', cx: 0, cy: 0, rx: 10, ry: 10 });
    if (command?.op === 'ellipse') expect(command.sweepAngle).toBeCloseTo(Math.PI / 2);
  });
});
