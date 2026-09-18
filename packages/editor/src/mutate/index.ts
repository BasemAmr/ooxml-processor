import type { DocPos, NodeId } from '@ooxml/wml';
import { isToggleProperty, toOnOffState } from '@ooxml/wml';
import type { Selection } from '../selection/model.js';
import { createCollapsed, selectionStartEnd } from '../selection/model.js';
import { createCaret } from '../position/types.js';
import type { DocumentModel, Transaction, Command, Effect } from '../commands/command.js';
import {
  InsertTextCommand,
  DeleteTextCommand,
  ApplyPropertyCommand,
  SplitParagraphCommand,
} from '../commands/command.js';

let nextTransactionSeq = 1;

export function insertText(
  model: DocumentModel,
  pos: DocPos,
  text: string,
  sel: Selection,
): Transaction {
  const cmd = new InsertTextCommand(pos, text);
  const effect = cmd.apply(model);

  const newOffset = pos.offset + text.length;
  const newCaret = createCaret({ node: pos.node, offset: newOffset }, 'downstream');
  const selAfter = createCollapsed(newCaret);

  return {
    commands: [cmd],
    effects: [effect],
    label: 'Typing',
    selBefore: sel,
    selAfter,
    mergeKey: 'type',
    seq: nextTransactionSeq++,
    timestamp: Date.now(),
  };
}

export function deleteRange(
  model: DocumentModel,
  sel: Selection,
  direction: 'back' | 'fwd' = 'back',
): Transaction {
  const commands: Command[] = [];
  const effects: Effect[] = [];

  let start: DocPos;
  let end: DocPos;
  let isSingleChar = false;

  if (sel.kind === 'collapsed') {
    isSingleChar = true;
    if (direction === 'back') {
      if (sel.caret.pos.offset <= 0) {
        // At start of node - cannot backspace intra-node
        return {
          commands: [],
          effects: [],
          label: 'Delete',
          selBefore: sel,
          selAfter: sel,
          mergeKey: null,
          seq: nextTransactionSeq++,
          timestamp: Date.now(),
        };
      }
      start = { node: sel.caret.pos.node, offset: sel.caret.pos.offset - 1 };
      end = sel.caret.pos;
    } else {
      const currentText = model.getText(sel.caret.pos.node);
      if (sel.caret.pos.offset >= currentText.length) {
        return {
          commands: [],
          effects: [],
          label: 'Delete',
          selBefore: sel,
          selAfter: sel,
          mergeKey: null,
          seq: nextTransactionSeq++,
          timestamp: Date.now(),
        };
      }
      start = sel.caret.pos;
      end = { node: sel.caret.pos.node, offset: sel.caret.pos.offset + 1 };
    }
  } else {
    const range = selectionStartEnd(sel);
    if (!range) {
      return {
        commands: [],
        effects: [],
        label: 'Delete',
        selBefore: sel,
        selAfter: sel,
        mergeKey: null,
        seq: nextTransactionSeq++,
        timestamp: Date.now(),
      };
    }
    start = range.start;
    end = range.end;
  }

  // Intra-node deletion
  if (start.node === end.node) {
    const textToDelete = model.getText(start.node).slice(start.offset, end.offset);
    const cmd = new DeleteTextCommand(start, textToDelete);
    const effect = cmd.apply(model);
    commands.push(cmd);
    effects.push(effect);
  }

  const selAfter = createCollapsed(createCaret(start, 'downstream'));
  const mergeKey = isSingleChar ? (direction === 'back' ? 'delete-back' : 'delete-fwd') : null;

  return {
    commands,
    effects,
    label: 'Delete',
    selBefore: sel,
    selAfter,
    mergeKey,
    seq: nextTransactionSeq++,
    timestamp: Date.now(),
  };
}

export function splitParagraph(
  model: DocumentModel,
  pos: DocPos,
  sel: Selection,
): Transaction {
  const cmd = new SplitParagraphCommand(pos);
  const effect = cmd.apply(model);

  const newParaId = effect.nodesAdded[0]!;
  const selAfter = createCollapsed(createCaret({ node: newParaId, offset: 0 }, 'downstream'));

  return {
    commands: [cmd],
    effects: [effect],
    label: 'Split Paragraph',
    selBefore: sel,
    selAfter,
    mergeKey: null, // Paragraph split never merges
    seq: nextTransactionSeq++,
    timestamp: Date.now(),
  };
}

export function applyRunProperty(
  model: DocumentModel,
  sel: Selection,
  property: string,
  value: unknown,
): Transaction {
  const targetNodes: NodeId[] = [];
  if (sel.kind === 'collapsed') {
    targetNodes.push(sel.caret.pos.node);
  } else if (sel.kind === 'range') {
    targetNodes.push(sel.anchor.node);
    if (sel.focus.node !== sel.anchor.node) {
      targetNodes.push(sel.focus.node);
    }
  }

  const commands: Command[] = [];
  const effects: Effect[] = [];

  for (const node of targetNodes) {
    const cmd = new ApplyPropertyCommand(node, property, value);
    const effect = cmd.apply(model);
    commands.push(cmd);
    effects.push(effect);
  }

  return {
    commands,
    effects,
    label: `Format ${property}`,
    selBefore: sel,
    selAfter: sel,
    mergeKey: null,
    seq: nextTransactionSeq++,
    timestamp: Date.now(),
  };
}

export function toggleRunProperty(
  model: DocumentModel,
  sel: Selection,
  property: string,
): Transaction {
  let targetNode: NodeId;
  if (sel.kind === 'collapsed') {
    targetNode = sel.caret.pos.node;
  } else if (sel.kind === 'range') {
    targetNode = sel.anchor.node;
  } else if (sel.kind === 'tableRect') {
    targetNode = sel.table;
  } else {
    targetNode = sel.ranges[0]?.anchor.node ?? (0 as unknown as NodeId);
  }
  const currentVal = model.getProperty(targetNode, property);

  let nextVal: boolean;
  if (isToggleProperty(property)) {
    const onOff = toOnOffState(currentVal as boolean | undefined);
    nextVal = onOff !== 'true';
  } else {
    nextVal = !currentVal;
  }

  return applyRunProperty(model, sel, property, nextVal);
}
