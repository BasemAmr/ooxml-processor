import {
  createCaret,
  createCollapsed,
  createCompositionState,
  createHistory,
  createRange,
  deleteRange,
  extendSelection,
  InputProxy,
  insertText,
  LatencyTracker,
  moveByWord,
  moveHorizontal,
  moveToDocumentEdge,
  moveToLineEdge,
  moveVertical,
  normalizeSelection,
  onCompositionEnd,
  onCompositionStart,
  onCompositionUpdate,
  PaintScheduler,
  relayout,
  splitParagraph,
  type Caret,
  type CompositionState,
  type DocumentModel,
  type LayoutIndex,
  type PageLayoutRecord,
  type PaintSchedulerDelegate,
  type RelayoutContext,
  type Selection,
  type Transaction,
} from '@ooxml/editor';
import type { Rect } from '@ooxml/editor';

export interface EditorControllerOptions {
  model: DocumentModel;
  initialSelection: Selection;
  container?: HTMLElement;
  relayoutContext?: RelayoutContext;
  layoutIndex?: LayoutIndex;
  paintDelegate?: PaintSchedulerDelegate;
  caretRect?: () => Rect | null;
  onSelectionChange?: (selection: Selection) => void;
  onCompositionChange?: (state: CompositionState) => void;
  onRelayout?: (repaint: ReturnType<typeof relayout>) => void;
  onError?: (error: unknown) => void;
}

/**
 * Owns the edit-side event loop. The document model remains the source of truth;
 * selection and composition are transient UI state and are never serialized.
 */
export class EditorController {
  readonly history = createHistory();
  readonly latency = new LatencyTracker();
  readonly scheduler: PaintScheduler | null;
  readonly input: InputProxy | null;
  private readonly options: EditorControllerOptions;
  private selection: Selection;
  private composition = createCompositionState();
  private disposed = false;

  constructor(options: EditorControllerOptions) {
    this.options = options;
    this.selection = normalizeSelection(options.initialSelection);
    this.scheduler = options.paintDelegate ? new PaintScheduler(options.paintDelegate) : null;
    this.input = options.container
      ? new InputProxy({
          container: options.container,
          onInput: (text) => this.typeChar(text),
          onKeyDown: (event) => this.handleKeyDown(event),
          onCompositionStart: () => this.beginComposition(),
          onCompositionUpdate: (text) => this.updateComposition(text),
          onCompositionEnd: (text) => this.endComposition(text),
          onPaste: (data) => this.handlePaste(data),
          onCopy: () => null,
          onCut: () => null,
        })
      : null;
    this.positionInput();
  }

  get currentSelection(): Selection { return this.selection; }
  get compositionState(): CompositionState { return this.composition; }

  setLayoutIndex(index: LayoutIndex): void {
    this.options.layoutIndex = index;
    this.positionInput();
  }

  setSelection(selection: Selection): void {
    this.selection = normalizeSelection(selection);
    this.options.onSelectionChange?.(this.selection);
    this.positionInput();
  }

  focus(): void { this.input?.focus(); }

  typeChar(text: string): Transaction | null {
    if (this.disposed || text.length === 0) return null;
    const t0 = this.now();
    try {
      // A range must be removed before insertion; combining both command lists preserves one undo step.
      let tx: Transaction;
      if (this.selection.kind === 'collapsed') {
        tx = insertText(this.options.model, this.selection.caret.pos, text, this.selection);
      } else {
        const removal = deleteRange(this.options.model, this.selection);
        const insertionPos = removal.selAfter.kind === 'collapsed' ? removal.selAfter.caret.pos : null;
        if (!insertionPos) return null;
        const insertion = insertText(this.options.model, insertionPos, text, removal.selAfter);
        tx = { ...insertion, commands: [...removal.commands, ...insertion.commands], effects: [...removal.effects, ...insertion.effects], selBefore: this.selection };
      }
      const t1 = this.now();
      this.history.push(tx);
      this.finishMutation(tx, t0, t1);
      return tx;
    } catch (error) {
      this.options.onError?.(error);
      return null;
    }
  }

  deleteBack(): Transaction | null { return this.delete('back'); }
  deleteForward(): Transaction | null { return this.delete('fwd'); }

  private delete(direction: 'back' | 'fwd'): Transaction | null {
    const t0 = this.now();
    try {
      const tx = deleteRange(this.options.model, this.selection, direction);
      if (tx.commands.length === 0) { this.setSelection(tx.selAfter); return tx; }
      const t1 = this.now();
      this.history.push(tx);
      this.finishMutation(tx, t0, t1);
      return tx;
    } catch (error) { this.options.onError?.(error); return null; }
  }

  splitParagraph(): Transaction | null {
    if (this.selection.kind !== 'collapsed') return null;
    const caret = this.selection.caret;
    const selection = this.selection;
    return this.applyTransaction(() => splitParagraph(this.options.model, caret.pos, selection));
  }

  undo(): Transaction | null { return this.historyAction('undo'); }
  redo(): Transaction | null { return this.historyAction('redo'); }

  private historyAction(action: 'undo' | 'redo'): Transaction | null {
    const t0 = this.now();
    try {
      const tx = this.history[action](this.options.model);
      if (!tx) return null;
      this.setSelection(action === 'undo' ? tx.selBefore : tx.selAfter);
      const t1 = this.now();
      this.relayoutAndPaint(tx, t0, t1);
      return tx;
    } catch (error) { this.options.onError?.(error); return null; }
  }

  moveHorizontal(direction: 'left' | 'right', extend = false): void {
    if (this.selection.kind !== 'collapsed' && !extend) {
      const pos = direction === 'left' ? this.selectionStart() : this.selectionEnd();
      if (pos) this.setSelection(createCollapsed(createCaret(pos)));
      return;
    }
    const caret = this.collapsedCaret();
    if (!caret) return;
    const next = moveHorizontal(caret, direction, this.options.model.getText(caret.pos.node));
    this.setSelection(extend ? extendSelection(this.selection, next) : createCollapsed(next));
  }

  moveVertical(direction: 'up' | 'down', extend = false): void {
    const index = this.options.layoutIndex;
    const caret = this.collapsedCaret();
    if (!index || !caret) return; // Safe no-op: vertical movement requires transient layout coordinates.
    const next = moveVertical(caret, direction, index);
    this.setSelection(extend ? extendSelection(this.selection, next) : createCollapsed(next));
  }

  moveByWord(direction: 'left' | 'right', extend = false): void {
    const caret = this.collapsedCaret();
    if (!caret) return;
    const next = moveByWord(caret, direction, this.options.model.getText(caret.pos.node));
    this.setSelection(extend ? extendSelection(this.selection, next) : createCollapsed(next));
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); this.undo(); return; }
    if (mod && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) { event.preventDefault(); this.redo(); return; }
    switch (event.key) {
      case 'Backspace': event.preventDefault(); this.deleteBack(); break;
      case 'Delete': event.preventDefault(); this.deleteForward(); break;
      case 'Enter': event.preventDefault(); this.splitParagraph(); break;
      case 'ArrowLeft': event.preventDefault(); this.moveHorizontal('left', event.shiftKey); break;
      case 'ArrowRight': event.preventDefault(); this.moveHorizontal('right', event.shiftKey); break;
      case 'ArrowUp': event.preventDefault(); this.moveVertical('up', event.shiftKey); break;
      case 'ArrowDown': event.preventDefault(); this.moveVertical('down', event.shiftKey); break;
      case 'Home': event.preventDefault(); this.moveEdge('home', event.shiftKey); break;
      case 'End': event.preventDefault(); this.moveEdge('end', event.shiftKey); break;
    }
  }

  private moveEdge(edge: 'home' | 'end', extend: boolean): void {
    const caret = this.collapsedCaret();
    const index = this.options.layoutIndex;
    if (!caret || !index) return;
    const next = moveToLineEdge(caret, edge, index);
    this.setSelection(extend ? extendSelection(this.selection, next) : createCollapsed(next));
  }

  private beginComposition(): void {
    const caret = this.collapsedCaret();
    if (!caret) return;
    this.composition = onCompositionStart(this.composition, caret);
    this.options.onCompositionChange?.(this.composition);
  }
  private updateComposition(text: string): void {
    this.composition = onCompositionUpdate(this.composition, text);
    this.options.onCompositionChange?.(this.composition);
    this.scheduler?.scheduleOverlayOnly();
  }
  private endComposition(text: string): void {
    const result = onCompositionEnd(this.composition, text);
    this.composition = result.state;
    this.options.onCompositionChange?.(this.composition);
    if (result.commitText) this.typeChar(result.commitText);
  }

  private handlePaste(data: DataTransfer): void {
    const text = data.getData('text/plain');
    if (text) this.typeChar(text);
  }

  private applyTransaction(factory: () => Transaction): Transaction | null {
    const t0 = this.now();
    try { const tx = factory(); const t1 = this.now(); this.history.push(tx); this.finishMutation(tx, t0, t1); return tx; }
    catch (error) { this.options.onError?.(error); return null; }
  }

  private finishMutation(tx: Transaction, t0: number, t1: number): void {
    this.setSelection(tx.selAfter);
    this.relayoutAndPaint(tx, t0, t1);
  }

  private relayoutAndPaint(tx: Transaction, t0: number, t1: number): void {
    const context = this.options.relayoutContext;
    let repaint: ReturnType<typeof relayout> = { rects: [], pages: new Set(), paginationRuns: 0 };
    if (context) {
      const dirty = { paragraphs: new Set(tx.effects.flatMap((effect) => effect.textEdits.map((edit) => edit.node))), pages: new Set<number>(), globalFields: false };
      repaint = relayout(dirty, context);
      this.options.onRelayout?.(repaint);
      this.scheduler?.scheduleRepaint(repaint.rects);
    } else {
      // Without a context the model is still changed, but repaint cannot be invented safely.
      this.scheduler?.scheduleOverlayOnly();
    }
    const t2 = this.now();
    this.scheduler?.flush();
    this.latency.record(t0, t1, t2, this.now());
    this.positionInput();
  }

  private collapsedCaret(): Caret | null { return this.selection.kind === 'collapsed' ? this.selection.caret : null; }
  private selectionStart(): { node: any; offset: number } | null { return this.selection.kind === 'range' ? (this.selection.anchor.offset <= this.selection.focus.offset ? this.selection.anchor : this.selection.focus) : null; }
  private selectionEnd(): { node: any; offset: number } | null { return this.selection.kind === 'range' ? (this.selection.anchor.offset >= this.selection.focus.offset ? this.selection.anchor : this.selection.focus) : null; }
  private positionInput(): void {
    const rect = this.options.caretRect?.();
    if (rect) this.input?.positionAt(rect);
  }
  private now(): number { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.input?.dispose(); this.scheduler?.dispose(); }
}
