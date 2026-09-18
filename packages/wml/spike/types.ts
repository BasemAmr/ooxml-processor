/**
 * Spike Model Interface for ADR 0003 Document Model Representation.
 *
 * All 3 candidates implement this common contract for the 4 benchmark operations:
 *   1. insertText(pos, text)  — typing keystroke path
 *   2. deleteRange(from, to)  — backspace/selection deletion path
 *   3. resolveRunProps(pos)   — cascade read path per shaped run
 *   4. serialize()            — XML round-trip path
 */

export interface RunProperties {
  b?: boolean;
  i?: boolean;
  color?: string;
  sz?: number;
  [key: string]: unknown;
}

export interface BookmarkSpan {
  id: number;
  name: string;
  startPos: number;
  endPos: number;
}

export interface SpikeDocumentModel {
  /** Inserts text at the given character offset in the document. */
  insertText(pos: number, text: string): void;

  /** Deletes the character range [from, to). */
  deleteRange(from: number, to: number): void;

  /** Resolves the effective run properties for the character at pos. */
  resolveRunProps(pos: number): RunProperties | undefined;

  /** Serializes the entire document back to WordprocessingML XML string. */
  serialize(): string;

  /** Extracts the flattened plain text of the entire document. */
  getText(): string;

  /** Total character length of the document text. */
  getLength(): number;

  /** Returns all active bookmark spans in character offsets. */
  getBookmarks(): BookmarkSpan[];

  /** Inserts a new paragraph with given text at logical paragraph index. */
  insertParagraph(index: number, text: string): void;

  /** Deletes the paragraph at logical paragraph index. */
  deleteParagraph(index: number): void;
}
