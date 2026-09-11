import { describe, expect, it } from 'vitest';
import {
  aspectRatio,
  coverCrop,
  fitRect,
  isValidSize,
  outputSize,
  sizesEqual,
  toEven,
} from '@/core/geometry.ts';
import { STICKER_SPECS } from '@/core/specs.ts';

const telegramStatic = STICKER_SPECS['telegram-static'];
const telegramVideo = STICKER_SPECS['telegram-video'];
const whatsappStatic = STICKER_SPECS['whatsapp-static'];
const tray = STICKER_SPECS['whatsapp-tray'];

describe('isValidSize', () => {
  it.each([
    [{ width: 1, height: 1 }, true],
    [{ width: 1920, height: 1080 }, true],
    [{ width: 0, height: 100 }, false],
    [{ width: 100, height: -1 }, false],
    [{ width: Number.NaN, height: 100 }, false],
    [{ width: Number.POSITIVE_INFINITY, height: 100 }, false],
  ])('%o -> %s', (size, expected) => {
    expect(isValidSize(size)).toBe(expected);
  });
});

describe('toEven', () => {
  it.each([
    [0, 2],
    [1, 2],
    [3, 4],
    [4, 4],
    [287, 288],
    // Ties round up, matching Math.round.
    [289, 290],
  ])('%i -> %i', (input, expected) => {
    expect(toEven(input)).toBe(expected);
  });
});

describe('outputSize', () => {
  it('returns a square for exact-sizing targets regardless of source shape', () => {
    expect(outputSize({ width: 1920, height: 1080 }, whatsappStatic)).toEqual({ width: 512, height: 512 });
    expect(outputSize({ width: 100, height: 900 }, whatsappStatic)).toEqual({ width: 512, height: 512 });
    expect(outputSize({ width: 640, height: 640 }, tray)).toEqual({ width: 96, height: 96 });
  });

  it('pins the longest side to exactly 512 and keeps the aspect ratio', () => {
    expect(outputSize({ width: 1920, height: 1080 }, telegramStatic)).toEqual({ width: 512, height: 288 });
    expect(outputSize({ width: 1080, height: 1920 }, telegramStatic)).toEqual({ width: 288, height: 512 });
    expect(outputSize({ width: 800, height: 800 }, telegramStatic)).toEqual({ width: 512, height: 512 });
  });

  it('never lets either side exceed the spec side length', () => {
    for (const source of [
      { width: 4000, height: 3 },
      { width: 3, height: 4000 },
      { width: 513, height: 512 },
    ]) {
      const result = outputSize(source, telegramStatic);
      expect(Math.max(result.width, result.height)).toBe(512);
      expect(Math.min(result.width, result.height)).toBeLessThanOrEqual(512);
      expect(Math.min(result.width, result.height)).toBeGreaterThanOrEqual(1);
    }
  });

  it('rounds the free side to an even number for VP9', () => {
    // 512 / (1000/333) = 170.5, which would otherwise round to an odd 171.
    const result = outputSize({ width: 1000, height: 333 }, telegramVideo);
    expect(result.width).toBe(512);
    expect(result.height % 2).toBe(0);
    expect(result.height).toBe(170);
  });

  it('keeps an extreme aspect ratio encodable rather than collapsing to zero', () => {
    const result = outputSize({ width: 4000, height: 1 }, telegramVideo);
    expect(result).toEqual({ width: 512, height: 2 });
  });

  it('rejects a degenerate source', () => {
    expect(() => outputSize({ width: 0, height: 10 }, telegramStatic)).toThrow(RangeError);
  });
});

describe('fitRect', () => {
  const box = { width: 512, height: 512 };

  it('letterboxes a wide source under contain', () => {
    const rect = fitRect({ width: 1920, height: 1080 }, box, 'contain');
    expect(rect.width).toBe(512);
    expect(rect.height).toBeCloseTo(288, 5);
    expect(rect.x).toBe(0);
    expect(rect.y).toBeCloseTo(112, 5);
  });

  it('overflows the box under cover so the excess is cropped', () => {
    const rect = fitRect({ width: 1920, height: 1080 }, box, 'cover');
    expect(rect.height).toBe(512);
    expect(rect.width).toBeCloseTo(910.222, 2);
    expect(rect.x).toBeLessThan(0);
    expect(rect.y).toBe(0);
  });

  it('fills the box exactly when the aspect ratios already match', () => {
    for (const mode of ['contain', 'cover'] as const) {
      const rect = fitRect({ width: 1024, height: 1024 }, box, mode);
      expect(rect).toEqual({ x: 0, y: 0, width: 512, height: 512 });
    }
  });

  it('keeps the source aspect ratio in both modes', () => {
    const source = { width: 1280, height: 720 };
    for (const mode of ['contain', 'cover'] as const) {
      const rect = fitRect(source, box, mode);
      expect(aspectRatio(rect)).toBeCloseTo(aspectRatio(source), 6);
    }
  });

  it('rejects a degenerate box', () => {
    expect(() => fitRect({ width: 10, height: 10 }, { width: 0, height: 512 }, 'contain')).toThrow(
      RangeError,
    );
  });
});

describe('coverCrop', () => {
  it('selects a centred region with the box aspect ratio', () => {
    const crop = coverCrop({ width: 1920, height: 1080 }, { width: 512, height: 512 });
    expect(crop.width).toBeCloseTo(1080, 5);
    expect(crop.height).toBe(1080);
    expect(crop.x).toBeCloseTo(420, 5);
    expect(crop.y).toBe(0);
  });

  it('stays inside the source bounds', () => {
    const source = { width: 640, height: 1136 };
    const crop = coverCrop(source, { width: 512, height: 512 });
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(source.width + 1e-9);
    expect(crop.y + crop.height).toBeLessThanOrEqual(source.height + 1e-9);
  });

  it('is a no-op when the source already matches the box shape', () => {
    const crop = coverCrop({ width: 1024, height: 1024 }, { width: 512, height: 512 });
    expect(crop).toEqual({ x: 0, y: 0, width: 1024, height: 1024 });
  });
});

describe('sizesEqual', () => {
  it('compares by value', () => {
    expect(sizesEqual({ width: 512, height: 288 }, { width: 512, height: 288 })).toBe(true);
    expect(sizesEqual({ width: 512, height: 288 }, { width: 288, height: 512 })).toBe(false);
  });
});
