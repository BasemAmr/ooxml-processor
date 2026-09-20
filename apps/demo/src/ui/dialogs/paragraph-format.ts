import {
  ApplyPropertyCommand,
  type DocumentModel,
  type Selection,
  type Transaction,
} from '@ooxml/editor';
import type { NodeId } from '@ooxml/wml';
import type { ST_Jc, CT_Ind, CT_Spacing, CT_NumPr } from '@ooxml/schema';

export type ParagraphAlignment = Extract<ST_Jc, 'start' | 'left' | 'center' | 'right' | 'end' | 'both'>;
export type ListKind = 'bullet' | 'numbered' | 'none';

export interface ParagraphFormatControllerOptions {
  readonly model: DocumentModel;
  readonly getSelection: () => Selection;
  /** Resolves the selected paragraph ids; the editor selection itself can point into a run. */
  readonly getParagraphIds: () => readonly NodeId[];
  /** Host owns history/relayout, so this callback is the only mutation notification. */
  readonly onTransaction?: (transaction: Transaction) => void;
  readonly onError?: (error: unknown) => void;
}

export interface IndentValues {
  readonly left?: number;
  readonly right?: number;
  readonly firstLine?: number;
  readonly hanging?: number;
}

export interface SpacingValues {
  readonly before?: number;
  readonly after?: number;
  readonly line?: number;
  readonly lineRule?: CT_Spacing['lineRule'];
}

/**
 * Paragraph formatting façade. It emits one ApplyPropertyCommand per selected paragraph,
 * preserving the editor's public command/effect shape while leaving history and relayout to the host.
 */
export class ParagraphFormatController {
  private readonly options: ParagraphFormatControllerOptions;

  constructor(options: ParagraphFormatControllerOptions) {
    this.options = options;
  }

  setAlignment(jc: ParagraphAlignment): void {
    if (!['start', 'left', 'center', 'right', 'end', 'both'].includes(jc)) return;
    this.apply('jc', { val: jc });
  }

  setIndent(left: number, firstLine: number): void {
    if (!Number.isFinite(left) || !Number.isFinite(firstLine)) return;
    const ind: CT_Ind = firstLine >= 0
      ? { left: Math.trunc(left), firstLine: Math.trunc(firstLine) }
      : { left: Math.trunc(left), hanging: Math.trunc(Math.abs(firstLine)) };
    this.apply('ind', ind);
  }

  setSpacing(before: number, after: number, line: number): void {
    if (![before, after, line].every(Number.isFinite)) return;
    const spacing: CT_Spacing = {
      before: Math.trunc(Math.max(0, before)),
      after: Math.trunc(Math.max(0, after)),
      line: Math.trunc(line),
      lineRule: 'auto',
    };
    this.apply('spacing', spacing);
  }

  setList(kind: ListKind): void {
    // These are deliberate demo-local IDs; a loaded document's numbering table is not available
    // through this UI contract, so callers can replace them via a future numbering service.
    const numPr: CT_NumPr | undefined = kind === 'none'
      ? undefined
      : { ilvl: { val: 0 }, numId: { val: kind === 'bullet' ? 1 : 2 } };
    this.apply('numPr', numPr);
  }

  setParagraphStyle(styleId: string): void {
    if (!styleId.trim()) return;
    this.apply('pStyle', { val: styleId.trim() });
  }

  private apply(property: string, value: unknown): void {
    try {
      const ids = [...new Set(this.options.getParagraphIds())];
      if (ids.length === 0) return;
      const selection = this.options.getSelection();
      const commands: ApplyPropertyCommand[] = [];
      const effects = [];
      for (const node of ids) {
        const command = new ApplyPropertyCommand(node, property, value);
        commands.push(command);
        effects.push(command.apply(this.options.model));
      }
      const transaction: Transaction = {
        commands,
        effects,
        label: `Format paragraph ${property}`,
        selBefore: selection,
        selAfter: selection,
        mergeKey: null,
        seq: Date.now(),
        timestamp: Date.now(),
      };
      this.options.onTransaction?.(transaction);
    } catch (error) {
      this.options.onError?.(error);
    }
  }
}
