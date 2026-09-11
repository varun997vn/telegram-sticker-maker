import { describe, expect, it } from 'vitest';
import { parsePNG } from '@/core/formats/png.ts';
import { gradientWithAlpha, noise, quadrants } from '../helpers/pngEncoder.ts';

/** The fixture encoder is test infrastructure, so it gets tested too. */

describe('PNG fixture encoder', () => {
  it.each([
    ['gradientWithAlpha', gradientWithAlpha],
    ['noise', noise],
    ['quadrants', quadrants],
  ])('%s produces a parseable RGBA PNG', (_label, build) => {
    const info = parsePNG(build(64, 48));
    expect(info.width).toBe(64);
    expect(info.height).toBe(48);
    expect(info.bitDepth).toBe(8);
    expect(info.colorType).toBe(6);
    expect(info.hasAlpha).toBe(true);
  });

  it('produces byte-identical output for the same seed', () => {
    expect(noise(32, 32, 7)).toEqual(noise(32, 32, 7));
  });

  it('produces different output for different seeds', () => {
    expect(noise(32, 32, 7)).not.toEqual(noise(32, 32, 8));
  });

  it('makes noise nearly incompressible and a gradient compressible', () => {
    // The quality search only gets exercised by input that resists
    // compression, so the two fixtures have to sit on opposite sides of that.
    const raw = 256 * 256 * 4;
    expect(noise(256, 256).byteLength).toBeGreaterThan(raw * 0.75);
    expect(gradientWithAlpha(256, 256).byteLength).toBeLessThan(raw * 0.6);
  });
});
