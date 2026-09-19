import { PRESET_GEOMETRIES, PRESET_GEOMETRY_ENTRIES } from '../generated/presets.js';
import {
  buildGeometryPaths,
  type BuiltGeometryPath,
  type GeometryDefinition,
  type GeometryExtent,
} from './path.js';

export { PRESET_GEOMETRIES, PRESET_GEOMETRY_ENTRIES };

type Preset = (typeof PRESET_GEOMETRY_ENTRIES)[number];

function asDefinition(preset: Preset): GeometryDefinition {
  return preset;
}

/** Compiles one named DrawingML preset for the requested shape extent. */
export function buildPresetGeometry(
  name: string,
  extent: GeometryExtent,
  adjustments: Readonly<Record<string, number>> = {},
): readonly BuiltGeometryPath[] | undefined {
  const preset = PRESET_GEOMETRIES[name as keyof typeof PRESET_GEOMETRIES];
  return preset === undefined
    ? undefined
    : buildGeometryPaths(asDefinition(preset), extent, adjustments);
}
