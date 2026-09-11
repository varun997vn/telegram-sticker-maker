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
  /** Length of the extracted animation. */
  readonly durationMs: number;
  /** Effective frame rate after every clamp has been applied. */
  readonly frameRate: number;
  readonly frameCount: number;
  /** Per-frame delay for container formats that store one, such as WebP. */
  readonly frameDelayMs: number;
  /** Source timestamps to sample, all strictly inside the trim window. */
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

  const durationMs = Math.min(endMs - startMs, input.maxDurationMs);
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

  const step = durationMs / frameCount;
  const timestampsMs: number[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    timestampsMs.push(startMs + i * step);
  }

  return {
    startMs,
    durationMs,
    frameRate,
    frameCount,
    frameDelayMs: Math.max(MIN_FRAME_DELAY_MS, Math.round(1000 / frameRate)),
    timestampsMs,
  };
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

/** Frame rates worth trying for a target, best first, never above its ceiling. */
export function frameRateLadderFor(spec: StickerSpec): readonly number[] {
  const ceiling = spec.maxFrameRate ?? FRAME_RATE_LADDER[0];
  return FRAME_RATE_LADDER.filter((rate) => rate <= ceiling);
}
