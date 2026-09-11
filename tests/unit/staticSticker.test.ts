import { describe, expect, it, vi } from 'vitest';
import { searchWithinBudget } from '@/core/budget.ts';
import { WEBP_QUALITY_LADDER, encodeStaticSticker } from '@/core/encode/staticSticker.ts';
import { STICKER_SPECS } from '@/core/specs.ts';

/**
 * Encoding itself needs a real canvas, so it is covered by the browser suite.
 * What can be checked here is the contract around it.
 */

describe('WEBP_QUALITY_LADDER', () => {
  it('runs from high to low quality', () => {
    expect(WEBP_QUALITY_LADDER[0]).toBe(95);
    expect(WEBP_QUALITY_LADDER.at(-1)).toBe(30);
    expect([...WEBP_QUALITY_LADDER]).toEqual([...WEBP_QUALITY_LADDER].sort((a, b) => b - a));
  });

  it('stays inside the quality range the encoder accepts', () => {
    expect(WEBP_QUALITY_LADDER.every((quality) => quality >= 0 && quality <= 100)).toBe(true);
  });

  it('is short enough that finding a fit never costs more than four encodes', async () => {
    // Measured rather than asserted from a formula: for every possible
    // outcome, run the real search and count the encodes it performs.
    const counts: number[] = [];

    for (let firstFitting = 0; firstFitting < WEBP_QUALITY_LADDER.length; firstFitting += 1) {
      const encode = vi.fn(async (_quality: number, index: number) =>
        new Uint8Array(index >= firstFitting ? 500 : 5000),
      );
      const result = await searchWithinBudget({
        candidates: WEBP_QUALITY_LADDER,
        maxBytes: 1000,
        encode,
      });

      expect(result.status).toBe('fit');
      counts.push(encode.mock.calls.length);
    }

    expect(Math.max(...counts)).toBeLessThanOrEqual(4);
  });
});

describe('encodeStaticSticker', () => {
  it('refuses an animated target', async () => {
    const source = { width: 512, height: 512, bitmap: {} as CanvasImageSource };
    await expect(
      encodeStaticSticker({ source, spec: STICKER_SPECS['telegram-video'], fit: 'contain' }),
    ).rejects.toThrow(TypeError);
  });
});
