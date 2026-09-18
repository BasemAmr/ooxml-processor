/**
 * Well-known relationship type URIs.
 *
 * ## Why every entry is a list
 *
 * A relationship type is matched by exact URI, and the same relationship has
 * **two** URIs depending on the dialect the document was written in:
 *
 * - Transitional (what Word writes):
 *   `http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles`
 * - Strict (ISO/IEC 29500):
 *   `http://purl.oclc.org/ooxml/officeDocument/relationships/styles`
 *
 * ADR-0008 requires reading both, so a lookup that hard-codes one URI silently
 * finds nothing in half the world's documents — and "finds nothing" for
 * `styles` means every paragraph renders with default formatting rather than
 * failing, which is exactly the kind of bug that ships. Every constant here is
 * therefore a tuple of the spellings that mean the same thing, and the lookup
 * helpers take varargs.
 *
 * The *package* relationship types (core properties, thumbnail, digital
 * signatures) have only one spelling: they live in the OPC namespace, which is
 * dialect-neutral.
 *
 * Microsoft's own extension types (`schemas.microsoft.com/office/…`) are
 * included where they name a part we have to be able to find. They are not
 * ECMA-376, they are not optional in practice, and a `.docx` from Word 2013
 * onwards is full of them.
 */

/** Transitional — `schemas.openxmlformats.org`. What Microsoft Word writes. */
const TRANSITIONAL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
/** Strict — `purl.oclc.org`. ISO/IEC 29500 Strict packages. */
const STRICT = 'http://purl.oclc.org/ooxml/officeDocument/relationships/';
/** OPC package relationships. One spelling in both dialects. */
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006/relationships/';
/** Microsoft extensions. */
const MS_2007 = 'http://schemas.microsoft.com/office/2007/relationships/';
const MS_2011 = 'http://schemas.microsoft.com/office/2011/relationships/';

/** Both dialect spellings of an `officeDocument` relationship type. */
function officeDocument(name: string): readonly [string, string] {
  return [`${TRANSITIONAL}${name}`, `${STRICT}${name}`];
}

export const RelationshipTypes = {
  /**
   * The package-level relationship that names the main document part.
   *
   * This is the entry point to a `.docx`: there is no convention that says the
   * main part is called `/word/document.xml`, only this relationship. Files
   * saved by other producers put it at `/document.xml` or `/word/doc.xml`, and
   * a reader that looks up the conventional path instead of following the
   * relationship gets a "not a Word document" error on a perfectly good file.
   */
  officeDocument: officeDocument('officeDocument'),

  styles: officeDocument('styles'),
  /** Word 2010's parallel styles part, carrying effects the base part cannot express. */
  stylesWithEffects: [`${MS_2007}stylesWithEffects`] as const,
  numbering: officeDocument('numbering'),
  settings: officeDocument('settings'),
  webSettings: officeDocument('webSettings'),
  fontTable: officeDocument('fontTable'),
  theme: officeDocument('theme'),
  header: officeDocument('header'),
  footer: officeDocument('footer'),
  footnotes: officeDocument('footnotes'),
  endnotes: officeDocument('endnotes'),
  comments: officeDocument('comments'),
  commentsExtended: [`${MS_2011}commentsExtended`] as const,
  people: [`${MS_2011}people`] as const,
  glossaryDocument: officeDocument('glossaryDocument'),
  customXml: officeDocument('customXml'),
  customXmlProps: officeDocument('customXmlProps'),
  printerSettings: officeDocument('printerSettings'),

  /** External in practice, but not always — a hyperlink may target a bookmark part. */
  hyperlink: officeDocument('hyperlink'),
  image: officeDocument('image'),
  video: officeDocument('video'),
  audio: officeDocument('audio'),
  /** An embedded package (a whole `.docx`/`.xlsx` inside this one). */
  embeddedPackage: officeDocument('package'),
  oleObject: officeDocument('oleObject'),
  chart: officeDocument('chart'),
  diagramData: officeDocument('diagramData'),
  diagramLayout: officeDocument('diagramLayout'),
  diagramQuickStyle: officeDocument('diagramQuickStyle'),
  diagramColors: officeDocument('diagramColors'),

  extendedProperties: officeDocument('extended-properties'),
  customProperties: officeDocument('custom-properties'),

  coreProperties: [`${PACKAGE}metadata/core-properties`] as const,
  thumbnail: [`${PACKAGE}metadata/thumbnail`] as const,
  digitalSignatureOrigin: [`${PACKAGE}digital-signature/origin`] as const,
  digitalSignature: [`${PACKAGE}digital-signature/signature`] as const,
  digitalSignatureCertificate: [`${PACKAGE}digital-signature/certificate`] as const,
} as const satisfies Record<string, readonly string[]>;

export type RelationshipTypeName = keyof typeof RelationshipTypes;

/**
 * Relationship types whose targets are binary media.
 *
 * Used to build the media index. Deliberately not "every part under
 * `/word/media/`": the folder name is a convention, not a rule, and a package
 * can put an image anywhere it likes. Following the relationships is the only
 * reliable way to know a part is an image.
 */
export const MEDIA_RELATIONSHIP_TYPES: readonly string[] = [
  ...RelationshipTypes.image,
  ...RelationshipTypes.video,
  ...RelationshipTypes.audio,
];
