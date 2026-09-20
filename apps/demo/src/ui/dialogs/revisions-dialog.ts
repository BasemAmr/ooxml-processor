import { applyRevisionBatch, type RevisionLike, type RevisionDecision } from '@ooxml/wml';
import type { RevisionDisplay, RevisionsController } from './word-count-dialog.js';

export class RevisionReview implements RevisionsController {
  private readonly revisions: RevisionLike[];
  constructor(revisions: readonly RevisionLike[], private readonly apply?: (edits: ReturnType<typeof applyRevisionBatch>) => void) {
    this.revisions = [...revisions];
  }

  list(): readonly RevisionDisplay[] {
    return this.revisions.map((revision) => ({ id: revision.id, ...(revision.author === undefined ? {} : { author: revision.author }), kind: revision.kind, text: revision.text }));
  }

  decide(id: string, decision: RevisionDecision): void {
    const revision = this.revisions.find((candidate) => candidate.id === id);
    if (!revision) return;
    this.apply?.(applyRevisionBatch([revision], decision));
  }
}

export class RevisionsDialog {
  constructor(private readonly root: HTMLElement, private readonly review: RevisionsController) {}

  show(): void {
    this.root.replaceChildren();
    for (const revision of this.review.list()) {
      const row = document.createElement('div');
      row.textContent = `${revision.author ?? 'Unknown'}: ${revision.text}`;
      for (const decision of ['accept', 'reject'] as const) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = decision;
        button.addEventListener('click', () => this.review.decide(revision.id, decision));
        row.append(button);
      }
      this.root.append(row);
    }
    this.root.hidden = false;
  }

  hide(): void { this.root.hidden = true; }
}
