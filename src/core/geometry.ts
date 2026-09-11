import type { StickerSpec } from './specs.ts';

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * How a source image is placed inside the sticker canvas.
 *
 * - `contain`: the whole source is visible, padded with transparency.
 * - `cover`: the canvas is filled edge to edge and the overflow is cropped.
 */
export type FitMode = 'contain' | 'cover';

export function isValidSize(size: Size): boolean {
  return (
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0
  );
}

function assertValidSize(size: Size, label: string): void {
  if (!isValidSize(size)) {
    throw new RangeError(`${label} must have positive finite dimensions, got ${size.width}x${size.height}`);
  }
}

/** Nearest even integer, never below 2. */
export function toEven(value: number): number {
  return Math.max(2, 2 * Math.round(value / 2));
}

/**
 * The pixel dimensions the encoder should produce for this source and target.
 *
 * For `longest-side` targets the longest side is pinned to the spec's side
 * length exactly — Telegram requires one side to be precisely 512 — and the
 * other side follows the source aspect ratio.
 */
export function outputSize(source: Size, spec: StickerSpec): Size {
  assertValidSize(source, 'source');

  if (spec.sizing === 'exact') {
    return { width: spec.side, height: spec.side };
  }

  const { side } = spec;
  const longest = Math.max(source.width, source.height);
  const shortestRatio = Math.min(source.width, source.height) / longest;

  let shortest = Math.round(side * shortestRatio);
  if (spec.requireEvenDimensions) {
    shortest = toEven(shortest);
  }
  shortest = Math.min(Math.max(shortest, 1), side);

  return source.width >= source.height
    ? { width: side, height: shortest }
    : { width: shortest, height: side };
}

/**
 * Where to draw the source inside a box of the given size.
 *
 * Returned in destination coordinates and deliberately not rounded: canvas
 * `drawImage` takes floats and rounding here would visibly shift the image.
 * Under `cover` the rect overflows the box, which is what crops it.
 */
export function fitRect(source: Size, box: Size, mode: FitMode): Rect {
  assertValidSize(source, 'source');
  assertValidSize(box, 'box');

  const scaleX = box.width / source.width;
  const scaleY = box.height / source.height;
  const scale = mode === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);

  const width = source.width * scale;
  const height = source.height * scale;

  return {
    x: (box.width - width) / 2,
    y: (box.height - height) / 2,
    width,
    height,
  };
}

/**
 * The region of the source that survives a `cover` fit, in source pixels.
 *
 * Useful for encoders that crop before scaling instead of drawing an
 * overflowing rect — ffmpeg's `crop` filter, for instance.
 */
export function coverCrop(source: Size, box: Size): Rect {
  assertValidSize(source, 'source');
  assertValidSize(box, 'box');

  const scale = Math.max(box.width / source.width, box.height / source.height);
  const width = box.width / scale;
  const height = box.height / scale;

  return {
    x: (source.width - width) / 2,
    y: (source.height - height) / 2,
    width,
    height,
  };
}

export function aspectRatio(size: Size): number {
  assertValidSize(size, 'size');
  return size.width / size.height;
}

export function sizesEqual(a: Size, b: Size): boolean {
  return a.width === b.width && a.height === b.height;
}
