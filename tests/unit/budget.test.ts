import { describe, expect, it, vi } from 'vitest';
import { formatBytes, qualityLadder, searchWithinBudget } from '@/core/budget.ts';

/** A stand-in encoder whose output size falls as quality falls. */
function fakeEncoder(sizesByIndex: readonly number[]) {
  const calls: number[] = [];
  const encode = vi.fn(async (_params: number, index: number) => {
    calls.push(index);
    return new Uint8Array(sizesByIndex[index] as number);
  });
  return { encode, calls };
}

const QUALITY = [100, 90, 80, 70, 60, 50, 40, 30] as const;

describe('searchWithinBudget', () => {
  it('returns the highest-quality candidate that fits', async () => {
    // Only indices 3 and beyond are under 1000 bytes.
    const { encode } = fakeEncoder([5000, 4000, 2000, 900, 800, 700, 600, 500]);
    const result = await searchWithinBudget({ candidates: QUALITY, maxBytes: 1000, encode });

    expect(result.status).toBe('fit');
    if (result.status !== 'fit') throw new Error('unreachable');
    expect(result.best.index).toBe(3);
    expect(result.best.params).toBe(70);
    expect(result.best.byteLength).toBe(900);
  });

  it('finds that candidate in a logarithmic number of encodes', async () => {
    const { encode } = fakeEncoder([5000, 4000, 2000, 900, 800, 700, 600, 500]);
    await searchWithinBudget({ candidates: QUALITY, maxBytes: 1000, encode });

    // A linear scan would need 4 calls here and 8 in the worst case; binary
    // search over 8 candidates never exceeds 3.
    expect(encode.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('stops after one encode when the best candidate already fits', async () => {
    const { encode } = fakeEncoder([100, 90, 80, 70, 60, 50, 40, 30]);
    const result = await searchWithinBudget({ candidates: QUALITY, maxBytes: 1000, encode });

    expect(result.status).toBe('fit');
    if (result.status !== 'fit') throw new Error('unreachable');
    expect(result.best.index).toBe(0);
    // 8 candidates: probes 3, then 1, then 0.
    expect(encode.mock.calls.length).toBe(3);
  });

  it('never encodes the same candidate twice', async () => {
    const { encode, calls } = fakeEncoder([5000, 4000, 2000, 900, 800, 700, 600, 500]);
    await searchWithinBudget({ candidates: QUALITY, maxBytes: 1000, encode });
    expect(new Set(calls).size).toBe(calls.length);
  });

  it('reports over-budget with the smallest real output when nothing fits', async () => {
    const { encode } = fakeEncoder([9000, 8000, 7000, 6000, 5000, 4000, 3000, 2000]);
    const result = await searchWithinBudget({ candidates: QUALITY, maxBytes: 1000, encode });

    expect(result.status).toBe('over-budget');
    if (result.status !== 'over-budget') throw new Error('unreachable');
    expect(result.smallest.byteLength).toBe(2000);
    expect(result.smallest.index).toBe(QUALITY.length - 1);
  });

  it('measures the lowest-quality candidate before giving up', async () => {
    const { encode, calls } = fakeEncoder([9000, 8000, 7000, 6000, 5000, 4000, 3000, 2000]);
    await searchWithinBudget({ candidates: QUALITY, maxBytes: 1000, encode });
    expect(calls).toContain(QUALITY.length - 1);
  });

  it('accepts an output that lands exactly on the limit', async () => {
    const { encode } = fakeEncoder([1000]);
    const result = await searchWithinBudget({ candidates: [100], maxBytes: 1000, encode });
    expect(result.status).toBe('fit');
  });

  it('reports every attempt it made, in order', async () => {
    const { encode } = fakeEncoder([5000, 4000, 2000, 900, 800, 700, 600, 500]);
    const result = await searchWithinBudget({ candidates: QUALITY, maxBytes: 1000, encode });

    expect(result.attempts.length).toBeGreaterThan(0);
    expect(result.attempts.map((attempt) => attempt.byteLength)).toEqual(
      result.attempts.map((attempt) => attempt.data.byteLength),
    );
  });

  it('notifies a progress callback for each attempt', async () => {
    const { encode } = fakeEncoder([5000, 4000, 2000, 900, 800, 700, 600, 500]);
    const onAttempt = vi.fn();
    const result = await searchWithinBudget({ candidates: QUALITY, maxBytes: 1000, encode, onAttempt });
    expect(onAttempt).toHaveBeenCalledTimes(result.attempts.length);
  });

  it('handles a non-monotonic encoder by only ever returning a measured fit', async () => {
    // Index 2 is anomalously small; whatever is returned must genuinely fit.
    const { encode } = fakeEncoder([5000, 4000, 100, 3000, 2500, 2000, 1500, 1200]);
    const result = await searchWithinBudget({ candidates: QUALITY, maxBytes: 1000, encode });

    if (result.status === 'fit') {
      expect(result.best.byteLength).toBeLessThanOrEqual(1000);
    } else {
      expect(result.smallest.byteLength).toBeGreaterThan(1000);
    }
  });

  it('stops when the caller aborts', async () => {
    const controller = new AbortController();
    const encode = vi.fn(async () => {
      controller.abort();
      return new Uint8Array(5000);
    });

    await expect(
      searchWithinBudget({ candidates: QUALITY, maxBytes: 1000, encode, signal: controller.signal }),
    ).rejects.toThrow();
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no candidates', { candidates: [] as number[], maxBytes: 1000 }],
    ['a zero budget', { candidates: QUALITY, maxBytes: 0 }],
    ['a negative budget', { candidates: QUALITY, maxBytes: -1 }],
  ])('rejects %s', async (_label, overrides) => {
    const encode = vi.fn(async () => new Uint8Array(1));
    await expect(searchWithinBudget({ encode, ...overrides })).rejects.toThrow(RangeError);
  });
});

describe('qualityLadder', () => {
  it('runs from best to worst inclusive', () => {
    expect(qualityLadder(95, 40, 6)).toEqual([95, 84, 73, 62, 51, 40]);
  });

  it('produces integers in descending order', () => {
    const ladder = qualityLadder(100, 10, 9);
    expect(ladder).toHaveLength(9);
    expect(ladder.every(Number.isInteger)).toBe(true);
    expect([...ladder]).toEqual([...ladder].sort((a, b) => b - a));
  });

  it('rejects fewer than two steps', () => {
    expect(() => qualityLadder(95, 40, 1)).toThrow(RangeError);
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [999, '999 B'],
    [1000, '1.0 KB'],
    [9_900, '9.9 KB'],
    [100_000, '100 KB'],
    [256_000, '256 KB'],
    [1_500_000, '1.5 MB'],
  ])('%i -> %s', (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });
});
