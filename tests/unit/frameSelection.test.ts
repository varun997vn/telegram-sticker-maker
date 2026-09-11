import { describe, expect, it } from 'vitest';
import {
  FRAME_RATE_LADDER,
  estimateFrameRateForBudget,
  nextFrameRateDown,
  selectFrameIndices,
} from '@/core/framePlan.ts';

describe('selectFrameIndices', () => {
  it('keeps every frame when nothing needs dropping', () => {
    expect(selectFrameIndices(5, 5)).toEqual([0, 1, 2, 3, 4]);
  });

  it('takes every other frame when halving', () => {
    expect(selectFrameIndices(8, 4)).toEqual([0, 2, 4, 6]);
  });

  it('spreads an uneven reduction across the whole clip', () => {
    const indices = selectFrameIndices(90, 24);
    expect(indices).toHaveLength(24);
    expect(indices[0]).toBe(0);
    // The last frame chosen must be near the end, not near the start.
    expect(indices.at(-1)).toBeGreaterThan(80);
  });

  it('never repeats or reverses', () => {
    for (const [source, target] of [
      [90, 24],
      [90, 15],
      [75, 30],
      [37, 11],
      [100, 99],
    ] as const) {
      const indices = selectFrameIndices(source, target);
      expect(new Set(indices).size, `${source} -> ${target}`).toBe(indices.length);
      expect([...indices]).toEqual([...indices].sort((a, b) => a - b));
    }
  });

  it('stays inside the source range', () => {
    for (const target of [1, 7, 23, 89]) {
      const indices = selectFrameIndices(90, target);
      expect(Math.min(...indices)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...indices)).toBeLessThan(90);
    }
  });

  it('cannot ask for more frames than exist', () => {
    expect(selectFrameIndices(3, 10)).toHaveLength(3);
  });

  it('reduces to a single frame', () => {
    expect(selectFrameIndices(90, 1)).toEqual([0]);
  });

  it.each([
    [0, 5],
    [5, 0],
    [-1, 5],
    [5.5, 5],
  ])('rejects sourceCount %s with targetCount %s', (source, target) => {
    expect(() => selectFrameIndices(source, target)).toThrow(RangeError);
  });
});

describe('nextFrameRateDown', () => {
  it('steps down the ladder', () => {
    expect(nextFrameRateDown(30)).toBe(24);
    expect(nextFrameRateDown(24)).toBe(20);
  });

  it('returns null at the bottom', () => {
    expect(nextFrameRateDown(FRAME_RATE_LADDER.at(-1) as number)).toBeNull();
  });

  it('handles a rate that is not on the ladder', () => {
    expect(nextFrameRateDown(28)).toBe(24);
  });
});

describe('estimateFrameRateForBudget', () => {
  it('jumps straight to a rate that should fit, rather than stepping once', () => {
    // Four times over budget at 30 fps means roughly a quarter of the frames.
    expect(estimateFrameRateForBudget(30, 1_000_000, 250_000)).toBeLessThanOrEqual(10);
  });

  it('steps down one rung when the overshoot is small', () => {
    expect(estimateFrameRateForBudget(30, 270_000, 256_000)).toBe(24);
  });

  it('never suggests a rate at or above the one already measured', () => {
    for (const measured of FRAME_RATE_LADDER) {
      const suggestion = estimateFrameRateForBudget(measured, 300_000, 256_000);
      if (suggestion !== null) expect(suggestion).toBeLessThan(measured);
    }
  });

  it('returns null once the ladder is exhausted', () => {
    expect(estimateFrameRateForBudget(FRAME_RATE_LADDER.at(-1) as number, 999_999, 1)).toBeNull();
  });

  it('refuses to guess from a zero-byte measurement', () => {
    expect(estimateFrameRateForBudget(30, 0, 256_000)).toBeNull();
  });

  it('aims under the budget rather than exactly at it', () => {
    // Exactly twice over at 30 fps: aiming at 15 would likely still overshoot.
    expect(estimateFrameRateForBudget(30, 512_000, 256_000)).toBeLessThanOrEqual(15);
  });
});
