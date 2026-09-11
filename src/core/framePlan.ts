import type { StickerSpec } from './specs.ts';

/**
 * Frame rates the encoder walks down when an animation will not fit its byte
 * budget. Dropping frames buys far more than dropping quality does at these
 * sizes, so frame rate is tried first.
 */
export const FRAME_RATE_LADDER = [30, 24, 20, 15, 12, 10] as const;

/**
 * Hard ceiling on frames per export. 3 s at 30 fps is 90 frames; the extra
 * headroom absorbs rounding without letting a pathological input queue
 * thousands of single-threaded wasm encodes.
 */
export const MAX_FRAMES = 120;

/**
 * Shortest delay libwebp will honour between animation frames. Delays below
 * this are silently clamped by decoders, which desynchronises the intended
 * duration from the real one.
 */
export const MIN_FRAME_DELAY_MS = 10;

export interface FramePlanInput {
  /** Length of the source media in milliseconds. */
  readonly sourceDurationMs: number;
  /** Requested trim window; clamped into the source and into the spec limits. */
  readonly trimStartMs?: number;
  readonly trimEndMs?: number;
  /** Requested frame rate; clamped to the spec's ceiling. */
  readonly frameRate: number;
  /** Animation length ceiling, in milliseconds. */
  readonly maxDurationMs: number;
  /** Frame rate ceiling. */
  readonly maxFrameRate: number;
  readonly maxFrames?: number;
}

export interface FramePlan {
  /** Offset into the source at which extraction starts. */
  readonly startMs: number;
  /** How much of the source the selection covers, before any speed-up. */
  readonly sourceSpanMs: number;
  /** How long the finished animation plays for; never over the target's cap. */
  readonly durationMs: number;
  /**
   * How much faster the sticker plays than the source did. 1 when the
   * selection already fits the cap, above 1 when it had to be compressed.
   */
  readonly speed: number;
  /** Playback frame rate, after every clamp has been applied. */
  readonly frameRate: number;
  /** Frames of *source* time sampled per second; `frameRate / speed`. */
  readonly samplingRate: number;
  readonly frameCount: number;
  /** Per-frame delay for container formats that store one, such as WebP. */
  readonly frameDelayMs: number;
  /** Source timestamps to sample, spread across the whole selection. */
  readonly timestampsMs: readonly number[];
}

function requirePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number, got ${value}`);
  }
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Turn a trim selection into a concrete list of source timestamps to sample.
 *
 * Every limit is applied by clamping rather than by rejecting, so the UI can
 * hand over raw slider values. The one exception is structurally impossible
 * input — a non-positive duration or frame rate — which throws.
 */
export function planFrames(input: FramePlanInput): FramePlan {
  const sourceDurationMs = requirePositive(input.sourceDurationMs, 'sourceDurationMs');
  requirePositive(input.frameRate, 'frameRate');
  requirePositive(input.maxDurationMs, 'maxDurationMs');
  requirePositive(input.maxFrameRate, 'maxFrameRate');
  const maxFrames = Math.max(1, Math.floor(input.maxFrames ?? MAX_FRAMES));

  const rawStart = clamp(input.trimStartMs ?? 0, 0, sourceDurationMs);
  const rawEnd = clamp(input.trimEndMs ?? sourceDurationMs, 0, sourceDurationMs);

  // A collapsed or inverted selection means "from here to the end".
  const startMs = rawEnd > rawStart ? rawStart : 0;
  const endMs = rawEnd > rawStart ? rawEnd : sourceDurationMs;

  const sourceSpanMs = endMs - startMs;

  // A selection longer than the cap is not cut short: the whole of it is kept
  // and played faster. Truncating would silently throw away the part of the
  // clip the user chose, which is rarely what they meant by selecting it.
  const durationMs = Math.min(sourceSpanMs, input.maxDurationMs);
  const speed = sourceSpanMs / durationMs;
  const requestedRate = Math.min(input.frameRate, input.maxFrameRate);

  // Frames cover [start, start + duration), so a 1 s window at 30 fps is 30
  // frames, not 31 — the frame that would land on the end boundary is the
  // first frame of the next loop.
  let frameCount = Math.max(1, Math.round((durationMs / 1000) * requestedRate));
  let frameRate = requestedRate;

  if (frameCount > maxFrames) {
    frameCount = maxFrames;
    frameRate = frameCount / (durationMs / 1000);
  }

  // Samples are spread over the whole selection, so a ten second clip becomes
  // three seconds covering all ten rather than the first three.
  const step = sourceSpanMs / frameCount;
  const timestampsMs: number[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    timestampsMs.push(startMs + i * step);
  }

  return {
    startMs,
    sourceSpanMs,
    durationMs,
    speed,
    frameRate,
    samplingRate: frameRate / speed,
    frameCount,
    frameDelayMs: Math.max(MIN_FRAME_DELAY_MS, Math.round(1000 / frameRate)),
    timestampsMs,
  };
}

/**
 * How much faster a selection has to play to fit the cap.
 *
 * The UI needs this before any encoding happens, so it can say what the
 * selection will actually produce.
 */
export function speedForSelection(sourceSpanMs: number, maxDurationMs: number): number {
  if (!Number.isFinite(sourceSpanMs) || sourceSpanMs <= 0) return 1;
  if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0) return 1;
  return Math.max(1, sourceSpanMs / Math.min(sourceSpanMs, maxDurationMs));
}

export interface SpecFramePlanInput {
  readonly sourceDurationMs: number;
  readonly trimStartMs?: number;
  readonly trimEndMs?: number;
  readonly frameRate?: number;
  readonly maxFrames?: number;
}

/** `planFrames` with the ceilings taken from a sticker spec. */
export function planFramesForSpec(spec: StickerSpec, input: SpecFramePlanInput): FramePlan {
  if (spec.maxDurationMs === null || spec.maxFrameRate === null) {
    throw new TypeError(`Sticker target "${spec.id}" is not animated and cannot be frame-planned`);
  }

  return planFrames({
    sourceDurationMs: input.sourceDurationMs,
    ...(input.trimStartMs !== undefined ? { trimStartMs: input.trimStartMs } : {}),
    ...(input.trimEndMs !== undefined ? { trimEndMs: input.trimEndMs } : {}),
    frameRate: input.frameRate ?? spec.maxFrameRate,
    maxDurationMs: spec.maxDurationMs,
    maxFrameRate: spec.maxFrameRate,
    ...(input.maxFrames !== undefined ? { maxFrames: input.maxFrames } : {}),
  });
}

/**
 * Evenly spaced indices for resampling a frame sequence to a lower count.
 *
 * Lowering the frame rate during a budget search must not mean extracting and
 * compositing the whole video again. Picking a subset of the frames already in
 * hand gives the same result for a fraction of the work, and spreads the
 * chosen frames across the whole clip rather than truncating it.
 */
export function selectFrameIndices(sourceCount: number, targetCount: number): number[] {
  if (!Number.isInteger(sourceCount) || sourceCount < 1) {
    throw new RangeError(`sourceCount must be a positive integer, got ${sourceCount}`);
  }
  if (!Number.isInteger(targetCount) || targetCount < 1) {
    throw new RangeError(`targetCount must be a positive integer, got ${targetCount}`);
  }

  const wanted = Math.min(targetCount, sourceCount);
  const indices: number[] = [];

  for (let i = 0; i < wanted; i += 1) {
    indices.push(Math.min(sourceCount - 1, Math.round((i * sourceCount) / wanted)));
  }
  return indices;
}

/** The next rate down the ladder from the one given, or null at the bottom. */
export function nextFrameRateDown(frameRate: number): number | null {
  const lower = FRAME_RATE_LADDER.filter((rate) => rate < frameRate);
  return lower[0] ?? null;
}

/**
 * The highest ladder rate expected to fit, given a measured size at a known
 * rate. Output size scales roughly with frame count, so this usually lands on
 * the right rung immediately instead of walking down one at a time — and each
 * rung costs several seconds of single-threaded encoding.
 */
export function estimateFrameRateForBudget(
  measuredRate: number,
  measuredBytes: number,
  budgetBytes: number,
): number | null {
  if (measuredBytes <= 0) return null;

  // Aim slightly under the budget: the relationship is approximate, and
  // overshooting costs another whole round of encoding.
  const target = measuredRate * (budgetBytes / measuredBytes) * 0.9;

  // The ladder runs fastest first, so the first rung at or below the estimate
  // is the highest rate that should fit.
  const lower = FRAME_RATE_LADDER.filter((rate) => rate < measuredRate);
  if (lower.length === 0) return null;

  // A target below every rung means even the slowest rate is a stretch; go
  // there rather than stepping down one rung at a time towards it.
  return lower.find((rate) => rate <= target) ?? (lower.at(-1) as number);
}

/** Frame rates worth trying for a target, best first, never above its ceiling. */
export function frameRateLadderFor(spec: StickerSpec): readonly number[] {
  const ceiling = spec.maxFrameRate ?? FRAME_RATE_LADDER[0];
  return FRAME_RATE_LADDER.filter((rate) => rate <= ceiling);
}
