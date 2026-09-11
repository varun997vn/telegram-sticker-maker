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

  // Sampling runs over source time, so a sped-up clip is sampled more sparsely
  // than it will be played back. For a selection that already fits, the two
  // rates are the same.
  filters.push(`fps=${formatRate(plan.samplingRate)}`);

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
    // The span of source to read, which is longer than the playback duration
    // whenever the selection had to be sped up to fit.
    '-t',
    seconds(plan.sourceSpanMs),
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
 * VP9 is not encoded here.
 *
 * The libvpx inside @ffmpeg/core 0.12.10 traps with "memory access out of
 * bounds" on any non-trivial input: `-crf` alone crashes it, `-cpu-used` of 2
 * or more crashes it, `-deadline realtime` crashes it, and at 512x512 with
 * real content even plain defaults crash. Flat single-colour frames encode
 * fine, which is why the fault only appears once real video reaches it.
 *
 * Telegram's video stickers are therefore encoded by the browser's own
 * VideoEncoder and muxed by `formats/webmWriter.ts`. See `encode/vp9Encoder.ts`.
 */

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
