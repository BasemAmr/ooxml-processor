import {
  createCollapsed,
  createRange,
  hitTest,
  hitTestParagraph,
  hitTestWord,
  normalizeSelection,
  type Caret,
  type LayoutIndex,
  type Selection,
} from '@ooxml/editor';
import type { DocPos, NodeId } from '@ooxml/wml';

export interface InteractionManagerOptions {
  readonly canvas: HTMLCanvasElement;
  readonly layoutIndex: LayoutIndex;
  readonly textProvider?: (node: NodeId) => string | undefined;
  readonly onCaret?: (caret: Caret) => void;
  readonly onSelection?: (selection: Selection) => void;
  readonly onPointerState?: (active: boolean) => void;
  readonly zoom?: number;
}

/** Routes canvas pointer gestures to the editor's public hit-testing APIs. */
export class InteractionManager {
  private readonly canvas: HTMLCanvasElement;
  private index: LayoutIndex;
  private readonly textProvider: ((node: NodeId) => string | undefined) | undefined;
  private readonly onCaret: ((caret: Caret) => void) | undefined;
  private readonly onSelection: ((selection: Selection) => void) | undefined;
  private readonly onPointerState: ((active: boolean) => void) | undefined;
  private zoom: number;
  private anchor: Caret | null = null;
  private dragging = false;

  constructor(options: InteractionManagerOptions) {
    this.canvas = options.canvas;
    this.index = options.layoutIndex;
    this.textProvider = options.textProvider;
    this.onCaret = options.onCaret;
    this.onSelection = options.onSelection;
    this.onPointerState = options.onPointerState;
    this.zoom = options.zoom ?? 1;
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('mouseup', this.handleMouseUp);
    this.canvas.addEventListener('dblclick', this.handleDoubleClick);
    this.canvas.addEventListener('click', this.handleClick);
    this.canvas.addEventListener('click', this.handleTripleClick);
  }

  setLayout(index: LayoutIndex, zoom = this.zoom): void { this.index = index; this.zoom = zoom; }

  onMouseDown(event: MouseEvent): void {
    const caret = hitTest(this.point(event), this.index);
    if (caret === null) return;
    this.anchor = caret;
    this.dragging = true;
    this.onPointerState?.(true);
    this.onCaret?.(caret);
    this.onSelection?.(createCollapsed(caret));
  }

  onMouseMove(event: MouseEvent): void {
    if (!this.dragging || this.anchor === null) return;
    const focus = hitTest(this.point(event), this.index);
    if (focus === null) return;
    this.onSelection?.(normalizeSelection(createRange(this.anchor.pos, focus.pos, focus.affinity)));
  }

  onMouseUp(event: MouseEvent): void {
    if (!this.dragging) return;
    this.onMouseMove(event);
    this.dragging = false;
    this.onPointerState?.(false);
  }

  dispose(): void {
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mouseup', this.handleMouseUp);
    this.canvas.removeEventListener('dblclick', this.handleDoubleClick);
    this.canvas.removeEventListener('click', this.handleClick);
    this.canvas.removeEventListener('click', this.handleTripleClick);
  }

  private handleMouseDown = (event: MouseEvent): void => this.onMouseDown(event);
  private handleMouseMove = (event: MouseEvent): void => this.onMouseMove(event);
  private handleMouseUp = (event: MouseEvent): void => this.onMouseUp(event);

  private handleClick = (event: MouseEvent): void => {
    if (event.detail !== 1 || this.dragging) return;
    const caret = hitTest(this.point(event), this.index);
    if (caret !== null) {
      this.anchor = caret;
      this.onCaret?.(caret);
      this.onSelection?.(createCollapsed(caret));
    }
  };

  private handleDoubleClick = (event: MouseEvent): void => {
    if (event.detail !== 2) return;
    const range = hitTestWord(this.point(event), this.index, this.textProvider);
    if (range !== null) this.onSelection?.(normalizeSelection(createRange(range.start, range.end)));
  };

  /** Triple click is intentionally handled from detail so the browser's dblclick does not win. */
  private handleTripleClick = (event: MouseEvent): void => {
    if (event.detail !== 3) return;
    const range = hitTestParagraph(this.point(event), this.index, (node) => this.textProvider?.(node)?.length);
    if (range !== null) this.onSelection?.(normalizeSelection(createRange(range.start, range.end)));
  };

  private point(event: MouseEvent): { x: number; y: number } {
    const bounds = this.canvas.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) / this.zoom, y: (event.clientY - bounds.top) / this.zoom };
  }
}
