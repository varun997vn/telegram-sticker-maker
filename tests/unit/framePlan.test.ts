import { describe, expect, it } from 'vitest';
import {
  FRAME_RATE_LADDER,
  MAX_FRAMES,
  MIN_FRAME_DELAY_MS,
  frameRateLadderFor,
  planFrames,
  planFramesForSpec,
  speedForSelection,
} from '@/core/framePlan.ts';
import { STICKER_SPECS } from '@/core/specs.ts';

const telegramVideo = STICKER_SPECS['telegram-video'];
const whatsappAnimated = STICKER_SPECS['whatsapp-animated'];
const telegramStatic = STICKER_SPECS['telegram-static'];

const base = { maxDurationMs: 3000, maxFrameRate: 30 } as const;

describe('planFrames', () => {
  it('samples a whole second at 30 fps as 30 frames, not 31', () => {
    const plan = planFrames({ sourceDurationMs: 1000, frameRate: 30, ...base });
    expect(plan.frameCount).toBe(30);
    expect(plan.timestampsMs[0]).toBe(0);
    expect(plan.timestampsMs.at(-1)).toBeCloseTo(1000 - 1000 / 30, 6);
  });

  it('keeps every sampled timestamp strictly inside the trim window', () => {
    const plan = planFrames({
      sourceDurationMs: 10_000,
      trimStartMs: 2000,
      trimEndMs: 4500,
      frameRate: 24,
      ...base,
    });
    const end = plan.startMs + plan.durationMs;
    for (const timestamp of plan.timestampsMs) {
      expect(timestamp).toBeGreaterThanOrEqual(plan.startMs);
      expect(timestamp).toBeLessThan(end);
    }
  });

  it('caps playback at the target limit however long the selection is', () => {
    const plan = planFrames({ sourceDurationMs: 60_000, trimStartMs: 1000, trimEndMs: 55_000, frameRate: 30, ...base });
    expect(plan.startMs).toBe(1000);
    expect(plan.durationMs).toBe(3000);
  });

  it('keeps the whole selection by speeding it up rather than cutting it short', () => {
    const plan = planFrames({
      sourceDurationMs: 60_000,
      trimStartMs: 0,
      trimEndMs: 30_000,
      frameRate: 30,
      ...base,
    });

    expect(plan.sourceSpanMs).toBe(30_000);
    expect(plan.durationMs).toBe(3000);
    expect(plan.speed).toBe(10);

    // The last sample has to come from the end of the selection, not from
    // three seconds in, or the rest of the clip is silently discarded.
    expect(plan.timestampsMs.at(-1)).toBeGreaterThan(29_000);
  });

  it('spreads samples evenly across a long selection', () => {
    const plan = planFrames({ sourceDurationMs: 60_000, trimEndMs: 30_000, frameRate: 30, ...base });
    const gaps = plan.timestampsMs.slice(1).map((time, i) => time - (plan.timestampsMs[i] as number));

    for (const gap of gaps) {
      expect(gap).toBeCloseTo(gaps[0] as number, 6);
    }
  });

  it('samples source time more sparsely than it plays back, by exactly the speed-up', () => {
    const plan = planFrames({ sourceDurationMs: 60_000, trimEndMs: 12_000, frameRate: 30, ...base });
    expect(plan.speed).toBe(4);
    expect(plan.samplingRate).toBeCloseTo(30 / 4, 6);
  });

  it('leaves a selection that already fits at normal speed', () => {
    const plan = planFrames({ sourceDurationMs: 10_000, trimStartMs: 1000, trimEndMs: 3500, frameRate: 30, ...base });
    expect(plan.speed).toBe(1);
    expect(plan.samplingRate).toBe(plan.frameRate);
    expect(plan.sourceSpanMs).toBe(plan.durationMs);
  });

  it('still fills the limit when the whole source is shorter than it', () => {
    const plan = planFrames({ sourceDurationMs: 1200, frameRate: 30, ...base });
    expect(plan.speed).toBe(1);
    expect(plan.durationMs).toBe(1200);
  });

  it('clamps a requested frame rate above the target ceiling', () => {
    const plan = planFrames({ sourceDurationMs: 2000, frameRate: 60, ...base });
    expect(plan.frameRate).toBe(30);
  });

  it('clamps a trim window that runs past the end of the source', () => {
    const plan = planFrames({ sourceDurationMs: 1500, trimStartMs: 500, trimEndMs: 9000, frameRate: 30, ...base });
    expect(plan.startMs).toBe(500);
    expect(plan.durationMs).toBe(1000);
  });

  it.each([
    ['inverted', 800, 200],
    ['collapsed', 400, 400],
  ])('treats an %s selection as the whole source', (_label, start, end) => {
    const plan = planFrames({ sourceDurationMs: 2000, trimStartMs: start, trimEndMs: end, frameRate: 10, ...base });
    expect(plan.startMs).toBe(0);
    expect(plan.durationMs).toBe(2000);
  });

  it('lowers the frame rate rather than exceeding the frame cap', () => {
    const plan = planFrames({
      sourceDurationMs: 3000,
      frameRate: 30,
      maxDurationMs: 3000,
      maxFrameRate: 30,
      maxFrames: 45,
    });
    expect(plan.frameCount).toBe(45);
    expect(plan.frameRate).toBe(15);
    expect(plan.timestampsMs).toHaveLength(45);
  });

  it('never plans fewer than one frame', () => {
    const plan = planFrames({ sourceDurationMs: 5, frameRate: 1, ...base });
    expect(plan.frameCount).toBe(1);
    expect(plan.timestampsMs).toEqual([0]);
  });

  it('stays within the global frame cap at the maximum settings', () => {
    const plan = planFrames({ sourceDurationMs: 10_000, frameRate: 30, ...base });
    expect(plan.frameCount).toBe(90);
    expect(plan.frameCount).toBeLessThanOrEqual(MAX_FRAMES);
  });

  it('derives a frame delay that never drops below the decoder minimum', () => {
    expect(planFrames({ sourceDurationMs: 1000, frameRate: 30, ...base }).frameDelayMs).toBe(33);
    const fast = planFrames({ sourceDurationMs: 1000, frameRate: 200, maxDurationMs: 3000, maxFrameRate: 200 });
    expect(fast.frameDelayMs).toBe(MIN_FRAME_DELAY_MS);
  });

  it.each([
    ['sourceDurationMs', { sourceDurationMs: 0, frameRate: 30 }],
    ['frameRate', { sourceDurationMs: 1000, frameRate: 0 }],
    ['a non-finite duration', { sourceDurationMs: Number.NaN, frameRate: 30 }],
  ])('rejects %s', (_label, overrides) => {
    expect(() => planFrames({ ...base, ...overrides })).toThrow(RangeError);
  });
});

describe('planFramesForSpec', () => {
  it.each([telegramVideo, whatsappAnimated])('produces a $id plan inside its limits', (spec) => {
    const plan = planFramesForSpec(spec, { sourceDurationMs: 12_000 });
    expect(plan.durationMs).toBeLessThanOrEqual(spec.maxDurationMs as number);
    expect(plan.frameRate).toBeLessThanOrEqual(spec.maxFrameRate as number);
    expect(plan.frameCount).toBe(plan.timestampsMs.length);
  });

  it('defaults to the target ceiling when no frame rate is requested', () => {
    expect(planFramesForSpec(telegramVideo, { sourceDurationMs: 3000 }).frameRate).toBe(30);
  });

  it('refuses to frame-plan a still target', () => {
    expect(() => planFramesForSpec(telegramStatic, { sourceDurationMs: 3000 })).toThrow(TypeError);
  });
});

describe('speedForSelection', () => {
  it('is 1 for a selection that already fits', () => {
    expect(speedForSelection(2000, 3000)).toBe(1);
    expect(speedForSelection(3000, 3000)).toBe(1);
  });

  it('is the ratio for a selection that does not', () => {
    expect(speedForSelection(30_000, 3000)).toBe(10);
    expect(speedForSelection(4500, 3000)).toBe(1.5);
  });

  it('never reports a slowdown', () => {
    for (const span of [1, 100, 2999, 3000, 3001, 100_000]) {
      expect(speedForSelection(span, 3000)).toBeGreaterThanOrEqual(1);
    }
  });

  it.each([
    ['a zero span', 0, 3000],
    ['a negative span', -5, 3000],
    ['a non-finite span', Number.NaN, 3000],
    ['a zero cap', 3000, 0],
  ])('falls back to normal speed for %s', (_label, span, cap) => {
    expect(speedForSelection(span, cap)).toBe(1);
  });

  it('agrees with the planner', () => {
    const plan = planFrames({ sourceDurationMs: 60_000, trimEndMs: 18_000, frameRate: 30, ...base });
    expect(speedForSelection(18_000, 3000)).toBeCloseTo(plan.speed, 6);
  });
});

describe('frameRateLadderFor', () => {
  it('is ordered best first and respects the target ceiling', () => {
    const ladder = frameRateLadderFor(telegramVideo);
    expect(ladder[0]).toBe(30);
    expect([...ladder]).toEqual([...ladder].sort((a, b) => b - a));
    expect(Math.max(...ladder)).toBeLessThanOrEqual(telegramVideo.maxFrameRate as number);
  });

  it('falls back to the full ladder for a target with no ceiling', () => {
    expect(frameRateLadderFor(telegramStatic)).toEqual([...FRAME_RATE_LADDER]);
  });
});
