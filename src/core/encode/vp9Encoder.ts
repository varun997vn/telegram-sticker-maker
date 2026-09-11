import { writeWebM } from '../formats/webmWriter.ts';
import type { WebMFrame } from '../formats/webmWriter.ts';

/**
 * VP9 encoding through the browser's own WebCodecs encoder.
 *
 * ffmpeg.wasm cannot do this job. The libvpx in @ffmpeg/core 0.12.10 traps
 * with "memory access out of bounds" on any non-trivial input — measured
 * across the whole option space, including plain defaults at 512x512 — so the
 * only working VP9 encoder available to a static site is the browser's.
 *
 * The trade-off is transparency: no browser currently reports support for
 * `alpha: "keep"` on VP9. Telegram's video stickers keep the source aspect
 * ratio rather than being padded into a square, so nothing transparent is
 * added by the app; only a source that is itself transparent loses anything.
 */

/** VP9 profile 0, level 1.0, 8-bit — the widely supported baseline. */
export const VP9_CODEC = 'vp09.00.10.08';

export class Vp9UnsupportedError extends Error {
  override readonly name = 'Vp9UnsupportedError';
}

interface VideoEncoderGlobals {
  VideoEncoder?: typeof VideoEncoder;
  VideoFrame?: typeof VideoFrame;
}

export function hasVideoEncoder(): boolean {
  const globals = globalThis as VideoEncoderGlobals;
  return typeof globals.VideoEncoder !== 'undefined' && typeof globals.VideoFrame !== 'undefined';
}

export interface Vp9SupportQuery {
  readonly width: number;
  readonly height: number;
  readonly bitrate?: number;
  readonly frameRate?: number;
}

export async function isVp9EncodingSupported(query: Vp9SupportQuery): Promise<boolean> {
  if (!hasVideoEncoder()) return false;

  try {
    const support = await VideoEncoder.isConfigSupported({
      codec: VP9_CODEC,
      width: query.width,
      height: query.height,
      bitrate: query.bitrate ?? 500_000,
      framerate: query.frameRate ?? 30,
    });
    return support.supported === true;
  } catch {
    return false;
  }
}

/**
 * Bitrates to try for a byte budget, highest first.
 *
 * The nominal rate that exactly fills the budget is the starting point; the
 * rungs below it absorb the overshoot a variable-bitrate encoder produces.
 */
export function bitrateLadder(budgetBytes: number, durationMs: number, steps = 7): number[] {
  if (!Number.isFinite(budgetBytes) || budgetBytes <= 0) {
    throw new RangeError(`budgetBytes must be positive, got ${budgetBytes}`);
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError(`durationMs must be positive, got ${durationMs}`);
  }
  if (!Number.isInteger(steps) || steps < 2) {
    throw new RangeError(`steps must be an integer of at least 2, got ${steps}`);
  }

  const nominal = (budgetBytes * 8) / (durationMs / 1000);
  const highest = 0.9;
  const lowest = 0.15;

  return Array.from({ length: steps }, (_, index) => {
    const fraction = highest + ((lowest - highest) * index) / (steps - 1);
    // Never go below a rate that would make the sticker unwatchable.
    return Math.max(24_000, Math.round(nominal * fraction));
  });
}

export interface Vp9EncodeOptions {
  /** Composited frames as PNG bytes, in presentation order. */
  readonly frames: readonly Uint8Array[];
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly bitrate: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (ratio: number) => void;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Cancelled');
  }
}

/** Encode composited frames to a complete WebM file. */
export async function encodeVp9WebM(options: Vp9EncodeOptions): Promise<Uint8Array> {
  const { frames, width, height, frameRate, bitrate, signal, onProgress } = options;

  if (!hasVideoEncoder()) {
    throw new Vp9UnsupportedError(
      'This browser cannot encode VP9 video. Telegram video stickers need WebCodecs, available in recent Chrome, Edge and Firefox.',
    );
  }
  if (frames.length === 0) {
    throw new RangeError('Encoding needs at least one frame');
  }

  const frameDurationMs = 1000 / frameRate;
  const encoded: WebMFrame[] = [];
  let failure: Error | null = null;

  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      encoded.push({
        data,
        timestampMs: chunk.timestamp / 1000,
        isKeyFrame: chunk.type === 'key',
      });
    },
    error: (error) => {
      failure = error instanceof Error ? error : new Error(String(error));
    },
  });

  try {
    encoder.configure({
      codec: VP9_CODEC,
      width,
      height,
      bitrate,
      framerate: frameRate,
      // A byte budget is easier to hit when the encoder is not free to spend
      // extra bits on complex frames.
      bitrateMode: 'constant',
      latencyMode: 'quality',
    });

    // A keyframe roughly every second keeps clusters short and lets players
    // start the loop cleanly.
    const keyFrameInterval = Math.max(1, Math.round(frameRate));

    for (const [index, png] of frames.entries()) {
      throwIfAborted(signal);
      if (failure) throw failure;

      const bitmap = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }));
      const frame = new VideoFrame(bitmap, {
        timestamp: Math.round(index * frameDurationMs * 1000),
        duration: Math.round(frameDurationMs * 1000),
      });

      try {
        encoder.encode(frame, { keyFrame: index % keyFrameInterval === 0 });
      } finally {
        frame.close();
        bitmap.close();
      }

      onProgress?.((index + 1) / frames.length);
    }

    await encoder.flush();
    if (failure) throw failure;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }

  if (encoded.length === 0) {
    throw new Error('The VP9 encoder produced no frames');
  }

  // Chunks arrive in encode order, which for this configuration is also
  // presentation order, but sorting makes that independent of the encoder.
  encoded.sort((a, b) => a.timestampMs - b.timestampMs);

  return writeWebM({
    width,
    height,
    frames: encoded,
    frameDurationMs,
    durationMs: frames.length * frameDurationMs,
  });
}
