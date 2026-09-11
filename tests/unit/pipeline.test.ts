import { describe, expect, it } from 'vitest';
import { checkCompliance } from '@/core/compliance.ts';
import { outputSize } from '@/core/geometry.ts';
import { planFramesForSpec } from '@/core/framePlan.ts';
import { ALL_SPECS, STICKER_SPECS, specsForKind } from '@/core/specs.ts';
import { buildAnimatedWebP, buildSimpleLossyWebP } from '../helpers/webpFixtures.ts';
import { buildWebM } from '../helpers/webmFixtures.ts';

/**
 * The geometry, frame-planning and compliance modules each look correct in
 * isolation; what matters is that they agree. These specs take what the
 * planners decide, encode a file with exactly those properties, and assert the
 * compliance checker is happy with it.
 */

const SOURCE_SIZES = [
  { width: 1920, height: 1080 }, // 16:9 video
  { width: 1080, height: 1920 }, // vertical phone video
  { width: 1000, height: 1000 }, // square
  { width: 4032, height: 3024 }, // 4:3 phone photo
  { width: 1000, height: 333 }, // 3:1, the odd-rounding case
  { width: 640, height: 1136 },
  { width: 2000, height: 3 }, // pathological
  { width: 3, height: 2000 },
  { width: 512, height: 512 },
  { width: 17, height: 23 }, // tiny and prime
];

describe('planned output dimensions satisfy every target', () => {
  const stillSpecs = specsForKind('static').filter((spec) => spec.container === 'webp');

  it.each(
    stillSpecs.flatMap((spec) => SOURCE_SIZES.map((source) => [spec.id, source, spec] as const)),
  )('%s accepts a sticker planned from %o', (_id, source, spec) => {
    const size = outputSize(source, spec);
    const report = checkCompliance(buildSimpleLossyWebP(size.width, size.height), spec);
    expect(report.issues).toEqual([]);
  });

  it.each(SOURCE_SIZES)('telegram-video accepts a VP9 file planned from %o', (source) => {
    const spec = STICKER_SPECS['telegram-video'];
    const size = outputSize(source, spec);
    const plan = planFramesForSpec(spec, { sourceDurationMs: 10_000 });

    const report = checkCompliance(
      buildWebM({
        width: size.width,
        height: size.height,
        durationMs: plan.durationMs,
        frameDurationNs: Math.round((1000 / plan.frameRate) * 1_000_000),
        frameTimecodesMs: plan.timestampsMs.map((timestamp) => Math.round(timestamp)),
      }),
      spec,
    );

    expect(report.issues).toEqual([]);
  });

  it.each(SOURCE_SIZES)('whatsapp-animated accepts a WebP animation planned from %o', (source) => {
    const spec = STICKER_SPECS['whatsapp-animated'];
    const size = outputSize(source, spec);
    const plan = planFramesForSpec(spec, { sourceDurationMs: 10_000 });

    const report = checkCompliance(
      buildAnimatedWebP({
        width: size.width,
        height: size.height,
        frames: Array.from({ length: plan.frameCount }, () => ({ durationMs: plan.frameDelayMs })),
      }),
      spec,
    );

    expect(report.issues).toEqual([]);
  });
});

describe('frame plans respect every animated target', () => {
  it.each(
    specsForKind('animated').flatMap((spec) =>
      [100, 900, 3000, 3001, 60_000].map((duration) => [spec.id, duration, spec] as const),
    ),
  )('%s stays within its limits for a %i ms source', (_id, sourceDurationMs, spec) => {
    const plan = planFramesForSpec(spec, { sourceDurationMs });

    expect(plan.durationMs).toBeLessThanOrEqual(spec.maxDurationMs as number);
    expect(plan.frameRate).toBeLessThanOrEqual(spec.maxFrameRate as number);
    expect(plan.frameCount).toBeGreaterThanOrEqual(1);
    expect(plan.timestampsMs).toHaveLength(plan.frameCount);
  });
});

describe('every spec is reachable from a plausible source', () => {
  it.each(ALL_SPECS)('$id produces a usable output size', (spec) => {
    const size = outputSize({ width: 1920, height: 1080 }, spec);
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
    expect(Math.max(size.width, size.height)).toBe(spec.side);
  });
});
