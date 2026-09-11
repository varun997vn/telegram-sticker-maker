import type { Rect, Size } from '../geometry.ts';
import type { FramePlan } from '../framePlan.ts';

/**
 * Argument builders for every ffmpeg invocation the app makes.
 *
 * Keeping these pure means the command lines can be asserted exactly in unit
 * tests, which is worth far more than it sounds: a wrong filter order or a
 * missing `-an` shows up as a rejected sticker much later, in a stage where
 * each run costs seconds of single-threaded wasm.
 */

export const INPUT_FILE = 'input';
export const FRAME_PATTERN = 'frame-%04d.png';

/** Filenames ffmpeg writes for a frame sequence, in order. */
export function frameFileNames(frameCount: number): string[] {
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new RangeError(`frameCount must be a positive integer, got ${frameCount}`);
  }
  return Array.from({ length: frameCount }, (_, index) =>
    FRAME_PATTERN.replace('%04d', String(index + 1).padStart(4, '0')),
  );
}

/** Format a millisecond offset as the seconds value ffmpeg expects. */
export function seconds(milliseconds: number): string {
  return (milliseconds / 1000).toFixed(3);
}

export interface ExtractFramesOptions {
  readonly inputFile?: string;
  readonly plan: FramePlan;
  /** Dimensions each extracted frame should have. */
  readonly size: Size;
  /** Region of the source to keep, in source pixels; omit to scale the whole frame. */
  readonly crop?: Rect | null;
  /** Pad the scaled image out to `size` instead of stretching it. */
  readonly pad?: boolean;
}

/**
 * Extract the planned frames as a PNG sequence.
 *
 * PNG rather than raw RGBA because the sequence is handed straight to a canvas
 * for compositing, and because it keeps the alpha channel intact without the
 * app having to know the decoded frame stride.
 */
export function buildExtractFramesArgs(options: ExtractFramesOptions): string[] {
  const { plan, size, crop = null, pad = false, inputFile = INPUT_FILE } = options;

  const filters: string[] = [];

  if (crop) {
    // Rounded to whole pixels: ffmpeg's crop filter rejects fractional values.
    filters.push(
      `crop=${Math.round(crop.width)}:${Math.round(crop.height)}:${Math.round(crop.x)}:${Math.round(crop.y)}`,
    );
  }

  filters.push(`fps=${formatRate(plan.frameRate)}`);

  if (pad) {
    // `force_original_aspect_ratio=decrease` then centre in a transparent box.
    filters.push(`scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease`);
    filters.push(`pad=${size.width}:${size.height}:-1:-1:color=#00000000`);
  } else {
    filters.push(`scale=${size.width}:${size.height}`);
  }

  return [
    // Seeking before the input is the fast path: ffmpeg jumps to the nearest
    // keyframe rather than decoding everything that precedes the trim point.
    '-ss',
    seconds(plan.startMs),
    '-t',
    seconds(plan.durationMs),
    '-i',
    inputFile,
    '-an',
    '-vf',
    filters.join(','),
    '-frames:v',
    String(plan.frameCount),
    '-f',
    'image2',
    FRAME_PATTERN,
  ];
}

/** ffmpeg accepts fractional rates, but whole numbers keep the command tidy. */
export function formatRate(frameRate: number): string {
  return Number.isInteger(frameRate) ? String(frameRate) : frameRate.toFixed(3);
}

/**
 * The fastest `-cpu-used` that is safe alongside `-deadline realtime`.
 *
 * Above this, libvpx's realtime speed features take a code path that traps in
 * this wasm build — ffmpeg dies with "memory access out of bounds" partway
 * through the first frame. Measured against @ffmpeg/core 0.12.10: realtime at
 * cpu-used 0 and 2 encode fine, 4 through 8 all crash, and `-deadline good` is
 * unaffected at every speed. Requests above the limit are clamped rather than
 * rejected: the caller wanted "as fast as possible", and this is it.
 */
export const MAX_REALTIME_CPU_USED = 2;

export interface EncodeWebMOptions {
  readonly frameRate: number;
  /** Constant-quality level; lower is better, 0-63 for VP9. */
  readonly crf: number;
  /**
   * How long libvpx may think about each frame. `good` is the default
   * trade-off; `realtime` is dramatically faster, which matters a great deal
   * when the encoder is single-threaded wasm.
   */
  readonly deadline?: 'best' | 'good' | 'realtime';
  /** Speed/quality dial, 0-8 for VP9; higher is faster and worse. */
  readonly cpuUsed?: number;
  readonly outputFile?: string;
  readonly inputPattern?: string;
}

/**
 * Encode a PNG sequence to the VP9 WebM Telegram expects.
 *
 * `yuva420p` keeps the alpha channel, `-b:v 0` puts libvpx into constant
 * quality mode so `-crf` is the only size control, and `-an` guarantees no
 * audio stream — Telegram rejects a video sticker that has one.
 */
export function buildEncodeWebMArgs(options: EncodeWebMOptions): string[] {
  const {
    frameRate,
    crf,
    deadline = 'good',
    cpuUsed = 4,
    outputFile = 'output.webm',
    inputPattern = FRAME_PATTERN,
  } = options;

  const safeCpuUsed =
    deadline === 'realtime' ? Math.min(cpuUsed, MAX_REALTIME_CPU_USED) : cpuUsed;

  // Everything before the output filename applies to that output. Appending
  // options after it makes ffmpeg read them as settings for a second output
  // that does not exist.
  return [
    '-framerate',
    formatRate(frameRate),
    '-i',
    inputPattern,
    '-c:v',
    'libvpx-vp9',
    '-pix_fmt',
    'yuva420p',
    '-b:v',
    '0',
    '-crf',
    String(crf),
    '-deadline',
    deadline,
    '-cpu-used',
    String(safeCpuUsed),
    '-an',
    '-loop',
    '0',
    outputFile,
  ];
}

export interface EncodeAnimatedWebPOptions {
  readonly frameRate: number;
  /** libwebp quality, 0-100, higher is better. */
  readonly quality: number;
  /** Compression effort, 0-6; higher is slower but smaller. */
  readonly compressionLevel?: number;
  readonly outputFile?: string;
  readonly inputPattern?: string;
}

/** Encode a PNG sequence to the animated WebP WhatsApp expects. */
export function buildEncodeAnimatedWebPArgs(options: EncodeAnimatedWebPOptions): string[] {
  const {
    frameRate,
    quality,
    compressionLevel = 4,
    outputFile = 'output.webp',
    inputPattern = FRAME_PATTERN,
  } = options;

  return [
    '-framerate',
    formatRate(frameRate),
    '-i',
    inputPattern,
    '-c:v',
    'libwebp_anim',
    '-lossless',
    '0',
    '-quality',
    String(quality),
    '-compression_level',
    String(compressionLevel),
    '-pix_fmt',
    'yuva420p',
    '-loop',
    '0',
    '-an',
    outputFile,
  ];
}
