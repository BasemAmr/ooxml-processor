import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchemaSet } from './loader.js';
import { normalize } from './normalize.js';
import { emitTypes } from './emit/types.js';
import { emitReader } from './emit/reader.js';
import { emitWriter } from './emit/writer.js';
import { emitValidator } from './emit/validator.js';
import { emitCoverage } from './emit/coverage.js';
import { emitFixtures } from './emit/fixtures.js';
import { emitNamespaces } from './emit/namespaces.js';
import { emitPresetGeometries } from './emit/geometries.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const assetsDir = process.argv[2] ?? resolve(root, 'assets/schema');
const outDir = process.argv[3] ?? resolve(root, 'packages/schema/src/generated');

const ir = await loadSchemaSet({ assetsDir });
const model = normalize(ir);
if (model.diagnostics.some((d) => d.severity === 'error')) {
  throw new Error(
    model.diagnostics
      .filter((d) => d.severity === 'error')
      .map((d) => d.message)
      .join('\n'),
  );
}

await rm(outDir, { recursive: true, force: true });
const namespaces = new Set<string>();
for (const t of model.complexTypes.values()) namespaces.add(t.name.ns);
for (const t of model.simpleTypes.values()) namespaces.add(t.name.ns);
for (const ns of [...namespaces].sort()) {
  for (const module of [
    emitTypes(model, ns),
    emitReader(model, ns),
    emitWriter(model, ns),
    emitValidator(model, ns),
  ]) {
    const target = resolve(outDir, module.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, module.contents, 'utf8');
  }
}
const coverage = emitCoverage(model);
await mkdir(outDir, { recursive: true });
await writeFile(resolve(outDir, coverage.path), coverage.contents, 'utf8');
const fixtures = emitFixtures(model);
await writeFile(resolve(outDir, fixtures.path), fixtures.contents, 'utf8');

// Emit the namespace binding table (P1-07)
const namespacesModule = emitNamespaces();
await writeFile(resolve(outDir, namespacesModule.path), namespacesModule.contents, 'utf8');

// Preset geometries are static DrawingML data, so they share the build-time
// determinism gate instead of parsing a 2 MB XML document in the browser.
const geometryModule = emitPresetGeometries(
  await readFile(resolve(root, 'assets/schema/geometries/presetShapeDefinitions.xml'), 'utf8'),
);
const geometryTarget = resolve(root, 'packages/dml/src', geometryModule.path);
await mkdir(dirname(geometryTarget), { recursive: true });
await writeFile(geometryTarget, geometryModule.contents, 'utf8');

process.stdout.write(`Generated ${namespaces.size} namespaces into ${outDir}\n`);
