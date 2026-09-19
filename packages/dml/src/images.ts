import { imageCrop } from './fills.js';

export type ImageKind = 'png' | 'jpeg' | 'gif' | 'bmp' | 'emf' | 'wmf' | 'unknown';
export interface ImagePart {
  readonly name: string;
  readonly bytes?: ArrayBuffer | Uint8Array;
  readonly mimeType?: string;
  readonly width?: number;
  readonly height?: number;
  readonly altText?: string;
}
export interface ImageResolution {
  readonly kind: ImageKind;
  readonly part?: ImagePart;
  readonly external: boolean;
  readonly placeholder?: string;
}
export interface ImageSource {
  readonly partKey: string;
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  readonly placeholder?: string;
}

const kindFrom = (part: ImagePart): ImageKind => {
  const mime = String(part.mimeType ?? '').toLowerCase();
  const name = part.name.toLowerCase();
  if (mime.includes('png') || name.endsWith('.png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg') || /\.jpe?g$/.test(name)) return 'jpeg';
  if (mime.includes('gif') || name.endsWith('.gif')) return 'gif';
  if (mime.includes('bmp') || name.endsWith('.bmp')) return 'bmp';
  if (mime.includes('emf') || name.endsWith('.emf')) return 'emf';
  if (mime.includes('wmf') || name.endsWith('.wmf')) return 'wmf';
  return 'unknown';
};

export function resolveBlipImage(
  blip: { embed?: string; link?: string },
  parts: ReadonlyMap<string, ImagePart>,
): ImageResolution {
  if (blip.link)
    return { kind: 'unknown', external: true, placeholder: `External image blocked: ${blip.link}` };
  if (!blip.embed)
    return { kind: 'unknown', external: false, placeholder: 'Missing image relationship' };
  const part = parts.get(blip.embed);
  if (!part)
    return { kind: 'unknown', external: false, placeholder: `Missing image part: ${blip.embed}` };
  const kind = kindFrom(part);
  if (kind === 'emf' || kind === 'wmf')
    return { kind, part, external: false, placeholder: part.altText ?? part.name };
  return { kind, part, external: false };
}

export function imageSource(
  blipFill: {
    blip?: { embed?: string; link?: string };
    srcRect?: { l?: number; t?: number; r?: number; b?: number };
  },
  parts: ReadonlyMap<string, ImagePart>,
  width: number,
  height: number,
): ImageSource | undefined {
  const blip = blipFill.blip;
  if (!blip) return undefined;
  const resolved = resolveBlipImage(blip, parts);
  const key = blip.embed ?? `external:${blip.link ?? 'missing'}`;
  const crop = imageCrop(blipFill as never, width, height);
  return {
    partKey: key,
    ...crop,
    ...(resolved.placeholder ? { placeholder: resolved.placeholder } : {}),
  };
}

export class ImageBitmapCache<T> {
  private readonly values = new Map<string, T>();
  get(part: string, effectKey = ''): T | undefined {
    return this.values.get(`${part}|${effectKey}`);
  }
  set(part: string, value: T, effectKey = ''): void {
    this.values.set(`${part}|${effectKey}`, value);
  }
  get size(): number {
    return this.values.size;
  }
  clear(): void {
    this.values.clear();
  }
}
