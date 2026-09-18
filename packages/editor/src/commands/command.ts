import type { NodeId, IdTable, DocPos } from '@ooxml/wml';
import type { Selection } from '../selection/model.js';

export interface Effect {
  nodesAdded: NodeId[];
  nodesRemoved: { id: NodeId; kind: string; serialized: string }[];
  textEdits: { node: NodeId; start: number; removed: string; inserted: string }[];
  propEdits: { node: NodeId; property: string; before: unknown; after: unknown }[];
  annotationEdits: { kind: string; id: string; before: unknown; after: unknown }[];
}

export interface DirtySet {
  paragraphs: Set<NodeId>;
  pages: Set<number>;
  globalFields: boolean;
}

export interface Command {
  readonly type: string;
  apply(model: DocumentModel): Effect;
  invert(effect: Effect): Command;
  dirty(effect: Effect): DirtySet;
}

export interface Transaction {
  commands: Command[];
  effects: Effect[];
  label: string;
  selBefore: Selection;
  selAfter: Selection;
  mergeKey: string | null;
  seq: number;
  timestamp: number;
}

export interface DocumentModel {
  idTable: IdTable;
  getText(node: NodeId): string;
  setText(node: NodeId, text: string): void;
  getProperty(node: NodeId, property: string): unknown;
  setProperty(node: NodeId, property: string, value: unknown): void;
  insertNode(node: NodeId, kind: string, parent: NodeId, offset: number): void;
  removeNode(node: NodeId): void;
}

export function createEffect(): Effect {
  return {
    nodesAdded: [],
    nodesRemoved: [],
    textEdits: [],
    propEdits: [],
    annotationEdits: [],
  };
}

export function mergeEffects(a: Effect, b: Effect): Effect {
  return {
    nodesAdded: [...a.nodesAdded, ...b.nodesAdded],
    nodesRemoved: [...a.nodesRemoved, ...b.nodesRemoved],
    textEdits: [...a.textEdits, ...b.textEdits],
    propEdits: [...a.propEdits, ...b.propEdits],
    annotationEdits: [...a.annotationEdits, ...b.annotationEdits],
  };
}

export function createDirtySet(): DirtySet {
  return {
    paragraphs: new Set(),
    pages: new Set(),
    globalFields: false,
  };
}

export class InsertTextCommand implements Command {
  readonly type = 'insert-text';
  constructor(public readonly pos: DocPos, public readonly text: string) {}

  apply(model: DocumentModel): Effect {
    const effect = createEffect();
    const currentText = model.getText(this.pos.node);
    const newText = currentText.slice(0, this.pos.offset) + this.text + currentText.slice(this.pos.offset);
    model.setText(this.pos.node, newText);
    effect.textEdits.push({
      node: this.pos.node,
      start: this.pos.offset,
      removed: '',
      inserted: this.text,
    });
    return effect;
  }

  invert(effect: Effect): Command {
    // Inverse is DeleteTextCommand for the exact inserted string
    const edit = effect.textEdits[0];
    if (!edit) throw new Error("No text edit in effect");
    return new DeleteTextCommand({ node: edit.node, offset: edit.start }, edit.inserted);
  }

  dirty(effect: Effect): DirtySet {
    const set = createDirtySet();
    for (const edit of effect.textEdits) {
      set.paragraphs.add(edit.node);
    }
    return set;
  }
}

export class DeleteTextCommand implements Command {
  readonly type = 'delete-text';
  constructor(public readonly pos: DocPos, public readonly text: string) {}

  apply(model: DocumentModel): Effect {
    const effect = createEffect();
    const currentText = model.getText(this.pos.node);
    // Determine what is actually being removed from model.
    const removed = currentText.slice(this.pos.offset, this.pos.offset + this.text.length);
    const newText = currentText.slice(0, this.pos.offset) + currentText.slice(this.pos.offset + this.text.length);
    model.setText(this.pos.node, newText);
    effect.textEdits.push({
      node: this.pos.node,
      start: this.pos.offset,
      removed,
      inserted: '',
    });
    return effect;
  }

  invert(effect: Effect): Command {
    const edit = effect.textEdits[0];
    if (!edit) throw new Error("No text edit in effect");
    return new InsertTextCommand({ node: edit.node, offset: edit.start }, edit.removed);
  }

  dirty(effect: Effect): DirtySet {
    const set = createDirtySet();
    for (const edit of effect.textEdits) {
      set.paragraphs.add(edit.node);
    }
    return set;
  }
}

export class ApplyPropertyCommand implements Command {
  readonly type = 'apply-property';
  constructor(
    public readonly node: NodeId,
    public readonly property: string,
    public readonly value: unknown
  ) {}

  apply(model: DocumentModel): Effect {
    const effect = createEffect();
    const before = model.getProperty(this.node, this.property);
    model.setProperty(this.node, this.property, this.value);
    effect.propEdits.push({
      node: this.node,
      property: this.property,
      before,
      after: this.value,
    });
    return effect;
  }

  invert(effect: Effect): Command {
    const edit = effect.propEdits[0];
    if (!edit) throw new Error("No property edit in effect");
    return new ApplyPropertyCommand(edit.node, edit.property, edit.before);
  }

  dirty(effect: Effect): DirtySet {
    const set = createDirtySet();
    for (const edit of effect.propEdits) {
      set.paragraphs.add(edit.node);
    }
    return set;
  }
}

export class SplitParagraphCommand implements Command {
  readonly type = 'split-paragraph';
  constructor(public readonly pos: DocPos) {}

  apply(model: DocumentModel): Effect {
    const effect = createEffect();
    const newId = model.idTable.mint('paragraph');
    // Simplified for minimal interface:
    model.insertNode(newId, 'paragraph', this.pos.node, this.pos.offset);
    effect.nodesAdded.push(newId);
    return effect;
  }

  invert(effect: Effect): Command {
    // Would merge paragraphs back. For now, returning a dummy or specific command.
    // The requirement only explicitly says 'SplitParagraphCommand'.
    return new MergeParagraphCommand(effect.nodesAdded[0]!);
  }

  dirty(effect: Effect): DirtySet {
    const set = createDirtySet();
    set.paragraphs.add(this.pos.node);
    for (const n of effect.nodesAdded) {
      set.paragraphs.add(n);
    }
    return set;
  }
}

export class MergeParagraphCommand implements Command {
  readonly type = 'merge-paragraph';
  constructor(public readonly node: NodeId) {}

  apply(model: DocumentModel): Effect {
    const effect = createEffect();
    model.removeNode(this.node);
    effect.nodesRemoved.push({ id: this.node, kind: 'paragraph', serialized: '' });
    return effect;
  }

  invert(effect: Effect): Command {
    return new SplitParagraphCommand({ node: this.node, offset: 0 });
  }

  dirty(effect: Effect): DirtySet {
    const set = createDirtySet();
    set.paragraphs.add(this.node);
    return set;
  }
}
