import type { Transaction, DocumentModel } from './command.js';

export interface UndoHistoryOptions {
  maxUndo?: number;
  coalesceWindowMs?: number;
}

export interface UndoHistory {
  push(tx: Transaction): void;
  undo(model: DocumentModel): Transaction | null;
  redo(model: DocumentModel): Transaction | null;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
  readonly undoCount: number;
  readonly redoCount: number;
}

function areSelectionsAdjacent(prev: Transaction['selAfter'], next: Transaction['selBefore']): boolean {
  if (prev.kind === 'collapsed' && next.kind === 'collapsed') {
    return prev.caret.pos.node === next.caret.pos.node &&
      (prev.caret.pos.offset === next.caret.pos.offset ||
       prev.caret.pos.offset + 1 === next.caret.pos.offset ||
       prev.caret.pos.offset - 1 === next.caret.pos.offset);
  }
  return false;
}

export function createHistory(options: UndoHistoryOptions = {}): UndoHistory {
  const maxUndo = options.maxUndo ?? 100;
  const coalesceWindowMs = options.coalesceWindowMs ?? 500;

  const undoStack: Transaction[] = [];
  const redoStack: Transaction[] = [];

  return {
    push(tx: Transaction): void {
      // Any new edit clears the redo stack
      redoStack.length = 0;

      // Check for coalescing with the previous transaction on the undo stack
      const prev = undoStack[undoStack.length - 1];
      if (
        prev &&
        prev.mergeKey !== null &&
        prev.mergeKey === tx.mergeKey &&
        areSelectionsAdjacent(prev.selAfter, tx.selBefore) &&
        tx.timestamp - prev.timestamp < coalesceWindowMs
      ) {
        // Coalesce: append commands and effects, keep initial selBefore and update to latest selAfter
        prev.commands.push(...tx.commands);
        prev.effects.push(...tx.effects);
        prev.selAfter = tx.selAfter;
        prev.timestamp = tx.timestamp;
        return;
      }

      undoStack.push(tx);
      if (undoStack.length > maxUndo) {
        undoStack.shift(); // drop oldest
      }
    },

    undo(model: DocumentModel): Transaction | null {
      const tx = undoStack.pop();
      if (!tx) return null;

      // Invert commands in reverse order and apply to model
      for (let i = tx.commands.length - 1; i >= 0; i--) {
        const cmd = tx.commands[i]!;
        const effect = tx.effects[i]!;
        const inverse = cmd.invert(effect);
        inverse.apply(model);
      }

      redoStack.push(tx);
      return tx;
    },

    redo(model: DocumentModel): Transaction | null {
      const tx = redoStack.pop();
      if (!tx) return null;

      // Re-apply commands in forward order
      tx.effects = [];
      for (const cmd of tx.commands) {
        const effect = cmd.apply(model);
        tx.effects.push(effect);
      }

      undoStack.push(tx);
      return tx;
    },

    canUndo(): boolean {
      return undoStack.length > 0;
    },

    canRedo(): boolean {
      return redoStack.length > 0;
    },

    clear(): void {
      undoStack.length = 0;
      redoStack.length = 0;
    },

    get undoCount(): number {
      return undoStack.length;
    },

    get redoCount(): number {
      return redoStack.length;
    },
  };
}
