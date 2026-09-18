import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCursor, createReadContext, createStringSink, createWriteContext } from './index.js';
import { NS_BY_TOKEN } from '../generated/namespaces.js';

// Import reader and writer modules for all 27 schema namespaces
import * as bibliographyReader from '../generated/bibliography/reader.js';
import * as bibliographyWriter from '../generated/bibliography/writer.js';
import * as characteristicsReader from '../generated/characteristics/reader.js';
import * as characteristicsWriter from '../generated/characteristics/writer.js';
import * as customXmlReader from '../generated/custom-xml/reader.js';
import * as customXmlWriter from '../generated/custom-xml/writer.js';
import * as dmlChartReader from '../generated/dml-chart/reader.js';
import * as dmlChartWriter from '../generated/dml-chart/writer.js';
import * as dmlChartDrawingReader from '../generated/dml-chartDrawing/reader.js';
import * as dmlChartDrawingWriter from '../generated/dml-chartDrawing/writer.js';
import * as dmlDiagramReader from '../generated/dml-diagram/reader.js';
import * as dmlDiagramWriter from '../generated/dml-diagram/writer.js';
import * as dmlMainReader from '../generated/dml-main/reader.js';
import * as dmlMainWriter from '../generated/dml-main/writer.js';
import * as dmlPictureReader from '../generated/dml-picture/reader.js';
import * as dmlPictureWriter from '../generated/dml-picture/writer.js';
import * as dmlSpreadsheetDrawingReader from '../generated/dml-spreadsheetDrawing/reader.js';
import * as dmlSpreadsheetDrawingWriter from '../generated/dml-spreadsheetDrawing/writer.js';
import * as dmlWordprocessingDrawingReader from '../generated/dml-wordprocessingDrawing/reader.js';
import * as dmlWordprocessingDrawingWriter from '../generated/dml-wordprocessingDrawing/writer.js';
import * as docPropsCustomReader from '../generated/doc-props-custom/reader.js';
import * as docPropsCustomWriter from '../generated/doc-props-custom/writer.js';
import * as docPropsExtendedReader from '../generated/doc-props-extended/reader.js';
import * as docPropsExtendedWriter from '../generated/doc-props-extended/writer.js';
import * as docPropsVtReader from '../generated/doc-props-vt/reader.js';
import * as docPropsVtWriter from '../generated/doc-props-vt/writer.js';
import * as mathReader from '../generated/math/reader.js';
import * as mathWriter from '../generated/math/writer.js';
import * as opcContentTypesReader from '../generated/opc-content-types/reader.js';
import * as opcContentTypesWriter from '../generated/opc-content-types/writer.js';
import * as opcCorePropertiesReader from '../generated/opc-core-properties/reader.js';
import * as opcCorePropertiesWriter from '../generated/opc-core-properties/writer.js';
import * as opcDigitalSignatureReader from '../generated/opc-digital-signature/reader.js';
import * as opcDigitalSignatureWriter from '../generated/opc-digital-signature/writer.js';
import * as opcRelationshipsReader from '../generated/opc-relationships/reader.js';
import * as opcRelationshipsWriter from '../generated/opc-relationships/writer.js';
import * as pmlReader from '../generated/pml/reader.js';
import * as pmlWriter from '../generated/pml/writer.js';
import * as schemaLibraryReader from '../generated/schema-library/reader.js';
import * as schemaLibraryWriter from '../generated/schema-library/writer.js';
import * as smlReader from '../generated/sml/reader.js';
import * as smlWriter from '../generated/sml/writer.js';
import * as vmlReader from '../generated/vml/reader.js';
import * as vmlWriter from '../generated/vml/writer.js';
import * as vmlExcelReader from '../generated/vml-excel/reader.js';
import * as vmlExcelWriter from '../generated/vml-excel/writer.js';
import * as vmlOfficeReader from '../generated/vml-office/reader.js';
import * as vmlOfficeWriter from '../generated/vml-office/writer.js';
import * as vmlPowerpointReader from '../generated/vml-powerpoint/reader.js';
import * as vmlPowerpointWriter from '../generated/vml-powerpoint/writer.js';
import * as vmlWordReader from '../generated/vml-word/reader.js';
import * as vmlWordWriter from '../generated/vml-word/writer.js';
import * as wmlReader from '../generated/wml/reader.js';
import * as wmlWriter from '../generated/wml/writer.js';

interface NamespaceModules {
  readonly readers: Record<string, Function>;
  readonly writers: Record<string, Function>;
}

const MODULES: Record<string, NamespaceModules> = {
  bibliography: { readers: bibliographyReader as any, writers: bibliographyWriter as any },
  characteristics: { readers: characteristicsReader as any, writers: characteristicsWriter as any },
  'custom-xml': { readers: customXmlReader as any, writers: customXmlWriter as any },
  'dml-chart': { readers: dmlChartReader as any, writers: dmlChartWriter as any },
  'dml-chartDrawing': {
    readers: dmlChartDrawingReader as any,
    writers: dmlChartDrawingWriter as any,
  },
  'dml-diagram': { readers: dmlDiagramReader as any, writers: dmlDiagramWriter as any },
  'dml-main': { readers: dmlMainReader as any, writers: dmlMainWriter as any },
  'dml-picture': { readers: dmlPictureReader as any, writers: dmlPictureWriter as any },
  'dml-spreadsheetDrawing': {
    readers: dmlSpreadsheetDrawingReader as any,
    writers: dmlSpreadsheetDrawingWriter as any,
  },
  'dml-wordprocessingDrawing': {
    readers: dmlWordprocessingDrawingReader as any,
    writers: dmlWordprocessingDrawingWriter as any,
  },
  'doc-props-custom': {
    readers: docPropsCustomReader as any,
    writers: docPropsCustomWriter as any,
  },
  'doc-props-extended': {
    readers: docPropsExtendedReader as any,
    writers: docPropsExtendedWriter as any,
  },
  'doc-props-vt': { readers: docPropsVtReader as any, writers: docPropsVtWriter as any },
  math: { readers: mathReader as any, writers: mathWriter as any },
  'opc-content-types': {
    readers: opcContentTypesReader as any,
    writers: opcContentTypesWriter as any,
  },
  'opc-core-properties': {
    readers: opcCorePropertiesReader as any,
    writers: opcCorePropertiesWriter as any,
  },
  'opc-digital-signature': {
    readers: opcDigitalSignatureReader as any,
    writers: opcDigitalSignatureWriter as any,
  },
  'opc-relationships': {
    readers: opcRelationshipsReader as any,
    writers: opcRelationshipsWriter as any,
  },
  pml: { readers: pmlReader as any, writers: pmlWriter as any },
  'schema-library': { readers: schemaLibraryReader as any, writers: schemaLibraryWriter as any },
  sml: { readers: smlReader as any, writers: smlWriter as any },
  vml: { readers: vmlReader as any, writers: vmlWriter as any },
  'vml-excel': { readers: vmlExcelReader as any, writers: vmlExcelWriter as any },
  'vml-office': { readers: vmlOfficeReader as any, writers: vmlOfficeWriter as any },
  'vml-powerpoint': { readers: vmlPowerpointReader as any, writers: vmlPowerpointWriter as any },
  'vml-word': { readers: vmlWordReader as any, writers: vmlWordWriter as any },
  wml: { readers: wmlReader as any, writers: wmlWriter as any },
};

const TRANSITIONAL_URIS: Record<string, string> = {};
for (const [token, binding] of NS_BY_TOKEN) {
  if (binding.transitional) TRANSITIONAL_URIS[token] = binding.transitional;
}

interface FixtureEntry {
  readonly namespace: string;
  readonly type: string;
  readonly minimal: string;
  readonly invalid: string;
}

interface FixturesJson {
  readonly version: number;
  readonly purpose: string;
  readonly note: string;
  readonly entries: Record<string, FixtureEntry>;
}

describe('P1-10 Schema-derived synthetic fixtures', () => {
  const fixturesPath = resolve(__dirname, '../generated/fixtures.json');
  const raw = readFileSync(fixturesPath, 'utf8');
  const fixtures: FixturesJson = JSON.parse(raw);
  const entries = Object.values(fixtures.entries);

  it('declares that it proves internal consistency, not conformance', () => {
    expect(fixtures.purpose).toBe('internal-consistency-only');
    expect(fixtures.note).toContain('not ECMA-376 conformance evidence');
    expect(entries.length).toBeGreaterThan(1400);
  });

  it('demonstrates gen2 === gen3 idempotence across all minimal-valid fixtures', () => {
    const readCtx = createReadContext('transitional', TRANSITIONAL_URIS);
    const writeCtx = createWriteContext('transitional', TRANSITIONAL_URIS);

    let roundTripped = 0;

    for (const entry of entries) {
      const mod = MODULES[entry.namespace];
      if (!mod) continue;

      const readFn = mod.readers[`read${entry.type}`];
      const writeFn = mod.writers[`write${entry.type}`];
      if (!readFn || !writeFn) continue;

      // Gen 1: read the minimal synthetic fixture
      const cur1 = createCursor(entry.minimal);
      const val1 = readFn(cur1, readCtx);

      // Gen 2: serialize to XML
      const { sink: sink2, toString: str2 } = createStringSink();
      writeFn(sink2, val1, writeCtx, entry.type);
      const gen2 = str2();

      // Gen 2 -> read back
      const cur2 = createCursor(gen2);
      const val2 = readFn(cur2, readCtx);

      // Gen 3: serialize again
      const { sink: sink3, toString: str3 } = createStringSink();
      writeFn(sink3, val2, writeCtx, entry.type);
      const gen3 = str3();

      // Invariant A2: idempotence after one pass
      expect(gen3).toBe(gen2);
      roundTripped++;
    }

    expect(roundTripped).toBe(entries.length);
  });

  it('proves readers diagnose without throwing (B4) on deliberately invalid fixtures', () => {
    const readCtx = createReadContext('transitional', TRANSITIONAL_URIS);
    let tested = 0;

    for (const entry of entries) {
      const mod = MODULES[entry.namespace];
      if (!mod) continue;

      const readFn = mod.readers[`read${entry.type}`];
      if (!readFn) continue;

      // Invariant B4: readers must never throw on document content
      const cur = createCursor(entry.invalid);
      expect(() => readFn(cur, readCtx)).not.toThrow();
      tested++;
    }

    expect(tested).toBe(entries.length);
  });
});
