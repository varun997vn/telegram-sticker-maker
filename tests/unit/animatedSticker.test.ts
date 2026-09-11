import { describe, expect, it } from 'vitest';
import {
  MAX_RATE_ATTEMPTS,
  WEBP_QUALITY_LADDER,
  encodeAnimatedSticker,
  extractionFit,
} from '@/core/encode/animatedSticker.ts';
import { bitrateLadder, hasVideoEncoder } from '@/core/encode/vp9Encoder.ts';
import { STICKER_SPECS } from '@/core/specs.ts';
import type { VideoSource } from '@/core/videoSource.ts';

const telegramVideo = STICKER_SPECS['telegram-video'];
const whatsappAnimated = STICKER_SPECS['whatsapp-animated'];
const telegramStatic = STICKER_SPECS['telegram-static'];

describe('quality ladders', () => {
  it('orders WebP quality from best to worst, which means descending', () => {
    expect(WEBP_QUALITY_LADDER[0]).toBe(85);
    expect(WEBP_QUALITY_LADDER.at(-1)).toBe(20);
    expect([...WEBP_QUALITY_LADDER]).toEqual([...WEBP_QUALITY_LADDER].sort((a, b) => b - a));
  });

  it('stays inside libwebp`s accepted range', () => {
    expect(WEBP_QUALITY_LADDER.every((quality) => quality >= 0 && quality <= 100)).toBe(true);
  });

  it('bounds the total encodes a search can perform', () => {
    // Three rates, each a binary search over seven candidates.
    const perRate = Math.floor(Math.log2(WEBP_QUALITY_LADDER.length)) + 1;
    expect(MAX_RATE_ATTEMPTS * perRate).toBeLessThanOrEqual(12);
  });
});

describe('bitrateLadder', () => {
  const budget = 256_000;
  const duration = 3000;

  it('starts just under the rate that would exactly fill the budget', () => {
    // 256 KB over three seconds is about 683 kbit/s.
    const nominal = (budget * 8) / (duration / 1000);
    expect(bitrateLadder(budget, duration)[0]).toBeLessThan(nominal);
    expect(bitrateLadder(budget, duration)[0]).toBeGreaterThan(nominal * 0.8);
  });

  it('descends', () => {
    const ladder = bitrateLadder(budget, duration);
    expect([...ladder]).toEqual([...ladder].sort((a, b) => b - a));
  });

  it('scales with the budget', () => {
    const small = bitrateLadder(100_000, duration)[0] as number;
    const large = bitrateLadder(500_000, duration)[0] as number;
    expect(large).toBeGreaterThan(small * 4);
  });

  it('scales inversely with duration', () => {
    const short = bitrateLadder(budget, 1000)[0] as number;
    const long = bitrateLadder(budget, 3000)[0] as number;
    expect(short).toBeGreaterThan(long * 2.5);
  });

  it('never drops below a floor that would be unwatchable', () => {
    expect(Math.min(...bitrateLadder(1000, 10_000))).toBeGreaterThanOrEqual(24_000);
  });

  it.each([
    ['a zero budget', 0, 3000],
    ['a negative budget', -1, 3000],
    ['a zero duration', 256_000, 0],
  ])('rejects %s', (_label, bytes, ms) => {
    expect(() => bitrateLadder(bytes, ms)).toThrow(RangeError);
  });
});

describe('hasVideoEncoder', () => {
  it('reports false in a plain Node environment, where WebCodecs is absent', () => {
    expect(hasVideoEncoder()).toBe(false);
  });
});

describe('extractionFit', () => {
  const wide = { width: 1920, height: 1080 };
  const tall = { width: 1080, height: 1920 };

  it('neither crops nor pads an aspect-preserving target', () => {
    expect(extractionFit(wide, telegramVideo, 'contain')).toEqual({
      size: { width: 512, height: 288 },
      crop: null,
      pad: false,
    });
  });

  it('ignores the fit mode for an aspect-preserving target, which has nothing to fit', () => {
    expect(extractionFit(wide, telegramVideo, 'cover')).toEqual(
      extractionFit(wide, telegramVideo, 'contain'),
    );
  });

  it('pads a square target under contain', () => {
    const result = extractionFit(wide, whatsappAnimated, 'contain');
    expect(result.size).toEqual({ width: 512, height: 512 });
    expect(result.pad).toBe(true);
    expect(result.crop).toBeNull();
  });

  it('crops a square target under cover, in source pixels', () => {
    const result = extractionFit(wide, whatsappAnimated, 'cover');
    expect(result.pad).toBe(false);
    expect(result.crop).toEqual({ x: 420, y: 0, width: 1080, height: 1080 });
  });

  it('crops the other axis for a tall source', () => {
    const result = extractionFit(tall, whatsappAnimated, 'cover');
    expect(result.crop?.x).toBe(0);
    expect(result.crop?.y).toBe(420);
  });
});

describe('encodeAnimatedSticker', () => {
  it('refuses a still target', async () => {
    const source = { durationMs: 1000, width: 100, height: 100 } as VideoSource;
    await expect(
      encodeAnimatedSticker({ source, spec: telegramStatic, fit: 'contain' }),
    ).rejects.toThrow(TypeError);
  });
});
