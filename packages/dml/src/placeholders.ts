import type { RawNode } from '@ooxml/schema';

export type DeferredGraphicKind = 'chart' | 'smartArt';
export interface GraphicExtent {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface DeferredGraphicPlaceholder {
  readonly kind: DeferredGraphicKind;
  readonly label: string;
  readonly extent: GraphicExtent;
  readonly modelled: true;
  readonly laidOut: true;
  readonly painted: 'placeholder';
}

export function deferredGraphicKind(node: RawNode): DeferredGraphicKind | undefined {
  const name = `${node.prefix}:${node.localName}`.toLowerCase();
  if (name.endsWith(':chart') || node.localName === 'chart') return 'chart';
  if (
    name.endsWith(':wgp') ||
    name.endsWith(':dgm') ||
    node.localName === 'relIds' ||
    node.uri.includes('diagram')
  )
    return 'smartArt';
  return undefined;
}

export function createDeferredGraphicPlaceholder(
  kind: DeferredGraphicKind,
  extent: GraphicExtent,
): DeferredGraphicPlaceholder {
  return {
    kind,
    label: kind === 'chart' ? 'Chart (not rendered)' : 'SmartArt (not rendered)',
    extent,
    modelled: true,
    laidOut: true,
    painted: 'placeholder',
  };
}

export function placeholderCoverage(kind: DeferredGraphicKind): {
  readonly name: string;
  readonly states: {
    readonly modelled: true;
    readonly laidOut: true;
    readonly painted: 'placeholder';
  };
} {
  return {
    name: kind === 'chart' ? 'dml-chart' : 'dml-diagram',
    states: { modelled: true, laidOut: true, painted: 'placeholder' },
  };
}
