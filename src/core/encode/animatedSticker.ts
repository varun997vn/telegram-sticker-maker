import { qualityLadder, searchWithinBudget } from '../budget.ts';
import { checkCompliance } from '../compliance.ts';
import type { ComplianceReport } from '../compliance.ts';
import { FRAME_PATTERN, buildEncodeAnimatedWebPArgs, frameFileNames } from '../ffmpeg/args.ts';
import { extractFrames, releaseFrames } from '../ffmpeg/extractFrames.ts';
import { openFFmpegSession } from '../ffmpeg/run.ts';
import {
  FRAME_RATE_LADDER,
  estimateFrameRateForBudget,
  planFramesForSpec,
  selectFrameIndices,
} from '../framePlan.ts';
import type { FramePlan } from '../framePlan.ts';
import { coverCrop, outputSize } from '../geometry.ts';
import type { FitMode, Rect, Size } from '../geometry.ts';
import { canvasToBytes, createRenderCanvas, get2dContext } from '../render/canvas.ts';
import { drawStickerFrame } from '../render/sticker.ts';
import type { StickerSpec } from '../specs.ts';
import type { TextLayer } from '../text/model.ts';
import type { VideoSource } from '../videoSource.ts';
import type { LoadProgressHandler } from '../ffmpeg/loader.ts';
import { bitrateLadder, encodeVp9WebM } from './vp9Encoder.ts';

/**
 * Encoding an animated sticker: extract, composite, encode, repeat until it
 * fits.
 *
 * The frame rate is only lowered once quality has run out, because dropping a
 * caption's legibility hurts a sticker more than dropping a few frames does —
 * but at 256 KB for three seconds of 512x512 video, both dials get used.
 */

/**
 * VP9 is encoded by the browser rather than ffmpeg.
 *
 * The libvpx inside @ffmpeg/core 0.12.10 traps with "memory access out of
 * bounds" on any non-trivial input. That was measured across the whole option
 * space: `-crf` alone crashes, `-cpu-used` of 2 or more crashes,
 * `-deadline realtime` crashes, and at 512x512 with real content even plain
 * defaults crash. Flat single-colour frames encode fine, which is why the
 * problem only surfaces with real video. The browser's own VideoEncoder has
 * none of these problems, so it does the VP9 work; see vp9Encoder.ts.
 */

/** libwebp quality levels, best first. Higher is better, 0-100. */
export const WEBP_QUALITY_LADDER = qualityLadder(85, 20, 7);

/**
 * How many frame rates to try before giving up.
 *
 * This is the length of the frame-rate ladder, not an arbitrary cap: stopping
 * early while rungs remain means handing back a sticker the platform will
 * reject, and frame count is the one dial that reliably shrinks the output.
 * The browser's VP9 encoder treats a target bitrate as a suggestion — asked
 * for 154 kbit/s on dense noise it produced roughly six times that — so
 * quality alone cannot be relied on to reach the budget.
 *
 * The cost is bounded: each rung is a binary search over the quality ladder,
 * and the estimate below usually jumps straight to a rate that fits rather
 * than stepping down one at a time.
 */
export const MAX_RATE_ATTEMPTS = FRAME_RATE_LADDER.length;

export type AnimatedPhase = 'extracting' | 'compositing' | 'encoding';

export interface AnimatedProgress {
  readonly phase: AnimatedPhase;
  /** 0 to 1 within the phase, or null when it cannot be known. */
  readonly ratio: number | null;
  /** Which encode attempt is running, for the encoding phase. */
  readonly attempt?: number;
  readonly frameRate?: number;
}

export interface AnimatedEncodeOptions {
  readonly source: VideoSource;
  readonly spec: StickerSpec;
  readonly fit: FitMode;
  readonly layers?: readonly TextLayer[];
  readonly trimStartMs?: number;
  readonly trimEndMs?: number;
  readonly frameRate?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: AnimatedProgress) => void;
  readonly onLoadProgress?: LoadProgressHandler;
}

export interface AnimatedEncodeResult {
  readonly spec: StickerSpec;
  readonly bytes: Uint8Array;
  readonly blob: Blob;
  readonly byteLength: number;
  readonly size: Size;
  readonly frameRate: number;
  readonly frameCount: number;
  readonly durationMs: number;
  /** The encoder setting that was finally used: CRF for VP9, quality for WebP. */
  readonly quality: number;
  /** Total encodes performed, across every frame rate tried. */
  readonly attempts: number;
  readonly withinBudget: boolean;
  readonly compliance: ComplianceReport;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Cancelled');
  }
}

/**
 * How the source should be fitted into the target box during extraction.
 *
 * A `longest-side` target already carries the source aspect ratio, so nothing
 * needs cropping or padding. A square target has to do one or the other.
 */
export function extractionFit(
  source: Size,
  spec: StickerSpec,
  fit: FitMode,
): { size: Size; crop: Rect | null; pad: boolean } {
  const size = outputSize(source, spec);

  if (spec.sizing !== 'exact') {
    return { size, crop: null, pad: false };
  }

  return fit === 'cover'
    ? { size, crop: coverCrop(source, size), pad: false }
    : { size, crop: null, pad: true };
}

/** Draw the text layers over each extracted frame and re-encode as PNG. */
async function compositeFrames(
  frames: readonly ImageBitmap[],
  size: Size,
  layers: readonly TextLayer[],
  onProgress: (ratio: number) => void,
  signal: AbortSignal | undefined,
): Promise<Uint8Array[]> {
  const canvas = createRenderCanvas(size);
  const context = get2dContext(canvas);
  const composited: Uint8Array[] = [];

  for (const [index, frame] of frames.entries()) {
    throwIfAborted(signal);

    // Frames arrive already scaled to the target, so this is a 1:1 draw with
    // the captions painted on top.
    drawStickerFrame(context, {
      source: { width: frame.width, height: frame.height, bitmap: frame },
      size,
      fit: 'contain',
      layers,
    });

    composited.push(await canvasToBytes(canvas, 'image/png'));
    onProgress((index + 1) / frames.length);
  }

  return composited;
}

interface RateAttempt {
  readonly data: Uint8Array;
  readonly setting: number;
  readonly frameRate: number;
  readonly frameCount: number;
  readonly encodes: number;
  readonly fits: boolean;
}

/** The frames chosen for a given rate, and the names ffmpeg expects. */
function subsetFor(
  frames: readonly Uint8Array[],
  plan: FramePlan,
  frameRate: number,
): { frames: Uint8Array[]; durationMs: number } {
  const targetCount = Math.max(1, Math.round((plan.durationMs / 1000) * frameRate));
  const indices = selectFrameIndices(frames.length, targetCount);
  return {
    frames: indices.map((index) => frames[index] as Uint8Array),
    durationMs: (indices.length / frameRate) * 1000,
  };
}

interface RateEncoder {
  readonly ladder: readonly number[];
  encode(setting: number): Promise<Uint8Array>;
  dispose(): Promise<void>;
}

/** Animated WebP, encoded by ffmpeg; the quality dial is libwebp's 0-100. */
async function webpEncoder(
  frames: readonly Uint8Array[],
  spec: StickerSpec,
  frameRate: number,
  signal: AbortSignal | undefined,
  onLoadProgress: LoadProgressHandler | undefined,
): Promise<RateEncoder> {
  const session = await openFFmpegSession({
    ...(signal ? { signal } : {}),
    ...(onLoadProgress ? { onLoadProgress } : {}),
  });

  const names = frameFileNames(frames.length);
  const outputFile = `out.${spec.fileExtension}`;

  await session.write(
    frames.map((data, index) => ({ name: names[index] as string, data })),
  );

  return {
    ladder: WEBP_QUALITY_LADDER,
    async encode(quality) {
      const { files } = await session.exec({
        args: buildEncodeAnimatedWebPArgs({ frameRate, quality, outputFile }),
        outputs: [outputFile],
        ...(signal ? { signal } : {}),
        failureMessage: `Could not encode the ${spec.label}`,
      });

      const data = files[0]?.data;
      if (!data) throw new Error(`Encoding the ${spec.label} produced no output`);
      return data;
    },
    dispose: () => session.dispose(),
  };
}

/** VP9 WebM, encoded by the browser; the dial is the target bitrate. */
function vp9Encoder(
  frames: readonly Uint8Array[],
  spec: StickerSpec,
  size: Size,
  frameRate: number,
  durationMs: number,
  signal: AbortSignal | undefined,
): RateEncoder {
  return {
    ladder: bitrateLadder(spec.maxBytes, durationMs),
    encode: (bitrate) =>
      encodeVp9WebM({
        frames,
        width: size.width,
        height: size.height,
        frameRate,
        bitrate,
        ...(signal ? { signal } : {}),
      }),
    dispose: async () => undefined,
  };
}

/** Search one frame rate's quality ladder for the best output that fits. */
async function encodeAtRate(
  encoder: RateEncoder,
  spec: StickerSpec,
  frameRate: number,
  frameCount: number,
  signal: AbortSignal | undefined,
  onAttempt: (attempt: number) => void,
): Promise<RateAttempt> {
  let encodes = 0;

  const search = await searchWithinBudget<number>({
    candidates: encoder.ladder,
    maxBytes: spec.maxBytes,
    ...(signal ? { signal } : {}),
    encode: async (setting) => {
      encodes += 1;
      onAttempt(encodes);
      return await encoder.encode(setting);
    },
  });

  const best = search.status === 'fit' ? search.best : search.smallest;
  return {
    data: best.data,
    setting: best.params,
    frameRate,
    frameCount,
    encodes,
    fits: search.status === 'fit',
  };
}

export async function encodeAnimatedSticker(
  options: AnimatedEncodeOptions,
): Promise<AnimatedEncodeResult> {
  const { source, spec, fit, layers = [], signal, onProgress } = options;

  if (spec.kind !== 'animated') {
    throw new TypeError(`"${spec.id}" is a still target and cannot be encoded as an animation`);
  }

  const plan = planFramesForSpec(spec, {
    sourceDurationMs: source.durationMs,
    ...(options.trimStartMs === undefined ? {} : { trimStartMs: options.trimStartMs }),
    ...(options.trimEndMs === undefined ? {} : { trimEndMs: options.trimEndMs }),
    ...(options.frameRate === undefined ? {} : { frameRate: options.frameRate }),
  });

  const { size, crop, pad } = extractionFit(
    { width: source.width, height: source.height },
    spec,
    fit,
  );

  onProgress?.({ phase: 'extracting', ratio: 0 });
  const extracted = await extractFrames({
    file: source.file,
    plan,
    size,
    crop,
    pad,
    ...(signal ? { signal } : {}),
    ...(options.onLoadProgress ? { onLoadProgress: options.onLoadProgress } : {}),
    onProgress: ({ ratio }) => onProgress?.({ phase: 'extracting', ratio }),
  });

  let composited: Uint8Array[];
  try {
    onProgress?.({ phase: 'compositing', ratio: 0 });
    composited = await compositeFrames(
      extracted.frames,
      size,
      layers,
      (ratio) => onProgress?.({ phase: 'compositing', ratio }),
      signal,
    );
  } finally {
    releaseFrames(extracted.frames);
  }

  const effectivePlan = extracted.plan;

  let totalEncodes = 0;
  let best: RateAttempt | null = null;
  let frameRate: number | null = effectivePlan.frameRate;

  for (let round = 0; round < MAX_RATE_ATTEMPTS && frameRate !== null; round += 1) {
    throwIfAborted(signal);

    const rate = frameRate;
    const subset = subsetFor(composited, effectivePlan, rate);

    // A fresh encoder per rate: the WebP path writes a different subset of
    // frames into ffmpeg's filesystem under the same sequential names.
    const encoder =
      spec.container === 'webm'
        ? vp9Encoder(subset.frames, spec, size, rate, subset.durationMs, signal)
        : await webpEncoder(subset.frames, spec, rate, signal, options.onLoadProgress);

    try {
      const attempt = await encodeAtRate(
        encoder,
        spec,
        rate,
        subset.frames.length,
        signal,
        (encode) =>
          onProgress?.({ phase: 'encoding', ratio: null, attempt: totalEncodes + encode, frameRate: rate }),
      );

      totalEncodes += attempt.encodes;
      // Keep whichever attempt produced the smallest file, so a failure still
      // reports the closest the search ever got.
      if (!best || attempt.data.byteLength < best.data.byteLength) best = attempt;
      if (attempt.fits) break;

      frameRate = estimateFrameRateForBudget(rate, attempt.data.byteLength, spec.maxBytes);
    } finally {
      await encoder.dispose();
    }
  }

  if (!best) {
    throw new Error(`Could not encode the ${spec.label}`);
  }

  const durationMs = (best.frameCount / best.frameRate) * 1000;

  return {
    spec,
    bytes: best.data,
    blob: new Blob([best.data as BlobPart], { type: spec.mimeType }),
    byteLength: best.data.byteLength,
    size,
    frameRate: best.frameRate,
    frameCount: best.frameCount,
    durationMs,
    quality: best.setting,
    attempts: totalEncodes,
    withinBudget: best.data.byteLength <= spec.maxBytes,
    compliance: checkCompliance(best.data, spec),
  };
}

export { FRAME_PATTERN };
