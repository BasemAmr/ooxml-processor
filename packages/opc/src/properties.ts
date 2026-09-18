/**
 * Typed accessors and parsers for package metadata streams:
 * - Core properties (`docProps/core.xml`): Dublin Core + OpenXML metadata
 * - Extended / App properties (`docProps/app.xml`): application metrics
 * - Custom properties (`docProps/custom.xml`): user-defined key-value properties
 *
 * All three parts are optional per ECMA-376 Part 2.
 * Absent is normal, not an error.
 */

import {
  attributeValue,
  forEachChildElement,
  readRootElement,
  type XmlSupport,
} from './xml-support.js';

/* -------------------------------------------------------------------------- */
/* Core Properties (`docProps/core.xml`)                                       */
/* -------------------------------------------------------------------------- */

export interface CoreProperties {
  readonly title?: string | undefined;
  readonly creator?: string | undefined;
  readonly subject?: string | undefined;
  readonly description?: string | undefined;
  readonly keywords?: string | undefined;
  readonly lastModifiedBy?: string | undefined;
  readonly revision?: string | undefined;
  readonly created?: Date | undefined;
  readonly modified?: Date | undefined;
  readonly category?: string | undefined;
  readonly contentStatus?: string | undefined;
  readonly contentType?: string | undefined;
  readonly identifier?: string | undefined;
  readonly language?: string | undefined;
  readonly version?: string | undefined;
  readonly lastPrinted?: Date | undefined;
}

/**
 * Parse Dublin Core and OpenXML core properties from XML text.
 */
export function parseCoreProperties(xml: string, support: XmlSupport): CoreProperties {
  const cursor = support.createCursor(xml);
  const root = readRootElement(cursor);
  if (root === undefined) return {};

  let title: string | undefined;
  let creator: string | undefined;
  let subject: string | undefined;
  let description: string | undefined;
  let keywords: string | undefined;
  let lastModifiedBy: string | undefined;
  let revision: string | undefined;
  let created: Date | undefined;
  let modified: Date | undefined;
  let category: string | undefined;
  let contentStatus: string | undefined;
  let contentType: string | undefined;
  let identifier: string | undefined;
  let language: string | undefined;
  let version: string | undefined;
  let lastPrinted: Date | undefined;

  const parseDateOrUndefined = (str: string): Date | undefined => {
    const trimmed = str.trim();
    if (trimmed === '') return undefined;
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };

  forEachChildElement(cursor, (start, text) => {
    switch (start.localName) {
      case 'title':
        title = text;
        break;
      case 'creator':
        creator = text;
        break;
      case 'subject':
        subject = text;
        break;
      case 'description':
        description = text;
        break;
      case 'keywords':
        keywords = text;
        break;
      case 'lastModifiedBy':
        lastModifiedBy = text;
        break;
      case 'revision':
        revision = text;
        break;
      case 'created':
        created = parseDateOrUndefined(text);
        break;
      case 'modified':
        modified = parseDateOrUndefined(text);
        break;
      case 'category':
        category = text;
        break;
      case 'contentStatus':
        contentStatus = text;
        break;
      case 'contentType':
        contentType = text;
        break;
      case 'identifier':
        identifier = text;
        break;
      case 'language':
        language = text;
        break;
      case 'version':
        version = text;
        break;
      case 'lastPrinted':
        lastPrinted = parseDateOrUndefined(text);
        break;
    }
  });

  return {
    title,
    creator,
    subject,
    description,
    keywords,
    lastModifiedBy,
    revision,
    created,
    modified,
    category,
    contentStatus,
    contentType,
    identifier,
    language,
    version,
    lastPrinted,
  };
}

/* -------------------------------------------------------------------------- */
/* Extended / App Properties (`docProps/app.xml`)                             */
/* -------------------------------------------------------------------------- */

export interface ExtendedProperties {
  readonly application?: string | undefined;
  readonly appVersion?: string | undefined;
  readonly company?: string | undefined;
  readonly manager?: string | undefined;
  readonly template?: string | undefined;
  readonly pages?: number | undefined;
  readonly words?: number | undefined;
  readonly characters?: number | undefined;
  readonly charactersWithSpaces?: number | undefined;
  readonly lines?: number | undefined;
  readonly paragraphs?: number | undefined;
  readonly totalTime?: number | undefined;
  readonly docSecurity?: number | undefined;
  readonly presentationFormat?: string | undefined;
  readonly slides?: number | undefined;
  readonly notes?: number | undefined;
  readonly hiddenSlides?: number | undefined;
  readonly mmClips?: number | undefined;
  readonly scaleCrop?: boolean | undefined;
  readonly linksUpToDate?: boolean | undefined;
  readonly sharedDoc?: boolean | undefined;
  readonly hyperlinksChanged?: boolean | undefined;
  readonly hyperlinkBase?: string | undefined;
}

export type AppProperties = ExtendedProperties;

/**
 * Parse application / extended properties from XML text.
 */
export function parseExtendedProperties(xml: string, support: XmlSupport): ExtendedProperties {
  const cursor = support.createCursor(xml);
  const root = readRootElement(cursor);
  if (root === undefined) return {};

  let application: string | undefined;
  let appVersion: string | undefined;
  let company: string | undefined;
  let manager: string | undefined;
  let template: string | undefined;
  let pages: number | undefined;
  let words: number | undefined;
  let characters: number | undefined;
  let charactersWithSpaces: number | undefined;
  let lines: number | undefined;
  let paragraphs: number | undefined;
  let totalTime: number | undefined;
  let docSecurity: number | undefined;
  let presentationFormat: string | undefined;
  let slides: number | undefined;
  let notes: number | undefined;
  let hiddenSlides: number | undefined;
  let mmClips: number | undefined;
  let scaleCrop: boolean | undefined;
  let linksUpToDate: boolean | undefined;
  let sharedDoc: boolean | undefined;
  let hyperlinksChanged: boolean | undefined;
  let hyperlinkBase: string | undefined;

  const parseIntOrUndefined = (str: string): number | undefined => {
    const trimmed = str.trim();
    if (trimmed === '') return undefined;
    const val = Number.parseInt(trimmed, 10);
    return Number.isNaN(val) ? undefined : val;
  };

  const parseBoolOrUndefined = (str: string): boolean | undefined => {
    const s = str.trim().toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
    return undefined;
  };

  forEachChildElement(cursor, (start, text) => {
    switch (start.localName.toLowerCase()) {
      case 'application':
        application = text;
        break;
      case 'appversion':
        appVersion = text;
        break;
      case 'company':
        company = text;
        break;
      case 'manager':
        manager = text;
        break;
      case 'template':
        template = text;
        break;
      case 'pages':
        pages = parseIntOrUndefined(text);
        break;
      case 'words':
        words = parseIntOrUndefined(text);
        break;
      case 'characters':
        characters = parseIntOrUndefined(text);
        break;
      case 'characterswithspaces':
        charactersWithSpaces = parseIntOrUndefined(text);
        break;
      case 'lines':
        lines = parseIntOrUndefined(text);
        break;
      case 'paragraphs':
        paragraphs = parseIntOrUndefined(text);
        break;
      case 'totaltime':
        totalTime = parseIntOrUndefined(text);
        break;
      case 'docsecurity':
        docSecurity = parseIntOrUndefined(text);
        break;
      case 'presentationformat':
        presentationFormat = text;
        break;
      case 'slides':
        slides = parseIntOrUndefined(text);
        break;
      case 'notes':
        notes = parseIntOrUndefined(text);
        break;
      case 'hiddenslides':
        hiddenSlides = parseIntOrUndefined(text);
        break;
      case 'mmclips':
        mmClips = parseIntOrUndefined(text);
        break;
      case 'scalecrop':
        scaleCrop = parseBoolOrUndefined(text);
        break;
      case 'linksuptodate':
        linksUpToDate = parseBoolOrUndefined(text);
        break;
      case 'shareddoc':
        sharedDoc = parseBoolOrUndefined(text);
        break;
      case 'hyperlinkschanged':
        hyperlinksChanged = parseBoolOrUndefined(text);
        break;
      case 'hyperlinkbase':
        hyperlinkBase = text;
        break;
    }
  });

  return {
    application,
    appVersion,
    company,
    manager,
    template,
    pages,
    words,
    characters,
    charactersWithSpaces,
    lines,
    paragraphs,
    totalTime,
    docSecurity,
    presentationFormat,
    slides,
    notes,
    hiddenSlides,
    mmClips,
    scaleCrop,
    linksUpToDate,
    sharedDoc,
    hyperlinksChanged,
    hyperlinkBase,
  };
}

/* -------------------------------------------------------------------------- */
/* Custom Properties (`docProps/custom.xml`)                                   */
/* -------------------------------------------------------------------------- */

export interface CustomProperty {
  readonly fmtid: string;
  readonly pid: number;
  readonly name?: string | undefined;
  readonly linkTarget?: string | undefined;
  readonly value: boolean | number | string | Date | undefined;
}

/**
 * Parse user-defined custom properties from XML text.
 */
export function parseCustomProperties(xml: string, support: XmlSupport): readonly CustomProperty[] {
  const cursor = support.createCursor(xml);
  const root = readRootElement(cursor);
  if (root === undefined) return [];

  const properties: CustomProperty[] = [];
  let depth = 0;
  let currentProperty:
    | {
        fmtid: string;
        pid: number;
        name?: string | undefined;
        linkTarget?: string | undefined;
      }
    | undefined;
  let currentType: string | undefined;
  let currentText = '';

  for (let event = cursor.next(); event !== undefined; event = cursor.next()) {
    if (event.type === 'startElement') {
      if (depth === 0) {
        if (event.localName === 'property') {
          const fmtid = attributeValue(event, 'fmtid') ?? '';
          const pidRaw = attributeValue(event, 'pid') ?? '0';
          const pid = Number.parseInt(pidRaw, 10);
          const name = attributeValue(event, 'name');
          const linkTarget = attributeValue(event, 'linkTarget');
          currentProperty = { fmtid, pid, name, linkTarget };
          currentType = undefined;
          currentText = '';
        }
      } else if (depth === 1) {
        currentType = event.localName.toLowerCase();
        currentText = '';
      }
      depth += 1;
      continue;
    }

    if (event.type === 'endElement') {
      if (depth === 0) break; // root element closed
      if (depth === 1 && currentProperty !== undefined) {
        let value: boolean | number | string | Date | undefined;
        if (currentType !== undefined) {
          value = convertVariantValue(currentType, currentText);
        }
        properties.push({
          fmtid: currentProperty.fmtid,
          pid: currentProperty.pid,
          name: currentProperty.name,
          linkTarget: currentProperty.linkTarget,
          value,
        });
        currentProperty = undefined;
      }
      depth -= 1;
      continue;
    }

    if (event.type === 'text' && depth === 2) {
      currentText += event.value;
    }
  }

  return properties;
}

function convertVariantValue(
  type: string,
  text: string,
): boolean | number | string | Date | undefined {
  switch (type) {
    case 'bool': {
      const s = text.trim().toLowerCase();
      return s === 'true' || s === '1';
    }
    case 'i1':
    case 'i2':
    case 'i4':
    case 'i8':
    case 'int':
    case 'ui1':
    case 'ui2':
    case 'ui4':
    case 'ui8':
    case 'uint':
    case 'r4':
    case 'r8':
    case 'decimal': {
      const num = Number(text.trim());
      return Number.isNaN(num) ? undefined : num;
    }
    case 'date':
    case 'filetime': {
      const trimmed = text.trim();
      if (trimmed === '') return undefined;
      const d = new Date(trimmed);
      return Number.isNaN(d.getTime()) ? undefined : d;
    }
    case 'empty':
    case 'null':
      return undefined;
    case 'lpwstr':
    case 'lpstr':
    case 'bstr':
    default:
      return text;
  }
}
