import { describe, expect, it } from 'vitest';
import { createSpikeFixture } from './fixture.js';
import { CandidateAPieceTable } from './candidate-a.js';
import { CandidateBImmutableTree } from './candidate-b.js';
import { CandidateCMutableTree } from './candidate-c.js';

describe('ADR 0003 Spike Verification', () => {
  const fixture = createSpikeFixture(500);

  describe('Operation 1: Insert one character mid-paragraph in a 500-paragraph document', () => {
    it('Candidate A handles mid-paragraph insertion', () => {
      const model = new CandidateAPieceTable(fixture);
      const initLen = model.getLength();
      const mid = Math.floor(initLen / 2);

      model.insertText(mid, 'Z');
      expect(model.getLength()).toBe(initLen + 1);
      expect(model.getText()[mid]).toBe('Z');
    });

    it('Candidate B handles mid-paragraph insertion', () => {
      const model = new CandidateBImmutableTree(fixture);
      const initLen = model.getLength();
      const mid = Math.floor(initLen / 2);

      model.insertText(mid, 'Z');
      expect(model.getLength()).toBe(initLen + 1);
      expect(model.getText()[mid]).toBe('Z');
    });

    it('Candidate C handles mid-paragraph insertion', () => {
      const model = new CandidateCMutableTree(fixture);
      const initLen = model.getLength();
      const mid = Math.floor(initLen / 2);

      model.insertText(mid, 'Z');
      expect(model.getLength()).toBe(initLen + 1);
      expect(model.getText()[mid]).toBe('Z');
    });
  });

  describe('Operation 2: Resolve formatting properties across run boundaries', () => {
    it('Candidate A resolves run properties', () => {
      const model = new CandidateAPieceTable(fixture);
      // At position 0, text is normal
      const props0 = model.resolveRunProps(5);
      expect(props0?.b).toBeFalsy();

      // Find a bold run position
      const boldOffset = model.getText().indexOf('Key bold assertion');
      expect(boldOffset).toBeGreaterThan(0);
      const boldProps = model.resolveRunProps(boldOffset + 2);
      expect(boldProps?.b).toBe(true);
    });

    it('Candidate B resolves run properties', () => {
      const model = new CandidateBImmutableTree(fixture);
      const boldOffset = model.getText().indexOf('Key bold assertion');
      expect(boldOffset).toBeGreaterThan(0);
      const boldProps = model.resolveRunProps(boldOffset + 2);
      expect(boldProps?.b).toBe(true);
    });

    it('Candidate C resolves run properties', () => {
      const model = new CandidateCMutableTree(fixture);
      const boldOffset = model.getText().indexOf('Key bold assertion');
      expect(boldOffset).toBeGreaterThan(0);
      const boldProps = model.resolveRunProps(boldOffset + 2);
      expect(boldProps?.b).toBe(true);
    });
  });

  describe('Operation 3: Bookmark range preservation under paragraph insert and delete', () => {
    it('Candidate A preserves bookmark span after interior insertion and deletion', () => {
      const model = new CandidateAPieceTable(fixture);
      const initialBm = model.getBookmarks().find((b) => b.name === 'TargetRangeBookmark')!;
      const initialSpan = initialBm.endPos - initialBm.startPos;

      model.insertParagraph(250, 'Inserted temporary paragraph.');
      const expandedBm = model.getBookmarks().find((b) => b.name === 'TargetRangeBookmark')!;
      expect(expandedBm.endPos - expandedBm.startPos).toBeGreaterThan(initialSpan);

      model.deleteParagraph(250);
      const restoredBm = model.getBookmarks().find((b) => b.name === 'TargetRangeBookmark')!;
      expect(restoredBm.endPos - restoredBm.startPos).toBe(initialSpan);
      expect(restoredBm.startPos).toBe(initialBm.startPos);
    });

    it('Candidate B preserves bookmark span after interior insertion and deletion', () => {
      const model = new CandidateBImmutableTree(fixture);
      const initialBm = model.getBookmarks().find((b) => b.name === 'TargetRangeBookmark')!;
      const initialSpan = initialBm.endPos - initialBm.startPos;

      model.insertParagraph(250, 'Inserted temporary paragraph.');
      const expandedBm = model.getBookmarks().find((b) => b.name === 'TargetRangeBookmark')!;
      expect(expandedBm.endPos - expandedBm.startPos).toBeGreaterThan(initialSpan);

      model.deleteParagraph(250);
      const restoredBm = model.getBookmarks().find((b) => b.name === 'TargetRangeBookmark')!;
      expect(restoredBm.endPos - restoredBm.startPos).toBe(initialSpan);
      expect(restoredBm.startPos).toBe(initialBm.startPos);
    });

    it('Candidate C preserves bookmark span after interior insertion and deletion', () => {
      const model = new CandidateCMutableTree(fixture);
      const initialBm = model.getBookmarks().find((b) => b.name === 'TargetRangeBookmark')!;
      const initialSpan = initialBm.endPos - initialBm.startPos;

      model.insertParagraph(250, 'Inserted temporary paragraph.');
      const expandedBm = model.getBookmarks().find((b) => b.name === 'TargetRangeBookmark')!;
      expect(expandedBm.endPos - expandedBm.startPos).toBeGreaterThan(initialSpan);

      model.deleteParagraph(250);
      const restoredBm = model.getBookmarks().find((b) => b.name === 'TargetRangeBookmark')!;
      expect(restoredBm.endPos - restoredBm.startPos).toBe(initialSpan);
      expect(restoredBm.startPos).toBe(initialBm.startPos);
    });
  });

  describe('Fidelity Gate Check: Unknowns and round-trip preservation', () => {
    it('Candidate C preserves unknown attributes and raw XML elements', () => {
      const model = new CandidateCMutableTree(fixture);
      const xml = model.serialize();
      expect(xml).toContain('customMetaTag="meta-0"');
      expect(xml).toContain('customBlockExtension');
      expect(xml).toContain('Custom raw data for p0');
      expect(xml).toContain('Table Cell 50-1 Header');
    });

    it('Candidate A drops unknown markup', () => {
      const model = new CandidateAPieceTable(fixture);
      const xml = model.serialize();
      // Candidate A drops unknown attributes and elements because piece tables flatten content
      expect(xml.includes('customMetaTag')).toBe(false);
      expect(xml.includes('customBlockExtension')).toBe(false);
    });
  });
});
