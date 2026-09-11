import { describe, expect, it } from 'vitest';
import { FormatParseError } from '@/core/formats/errors.ts';
import { isWebP, parseWebP } from '@/core/formats/webp.ts';
import {
  buildAnimatedWebP,
  buildLosslessWebP,
  buildSimpleLossyWebP,
  chunk,
  riff,
  vp8Payload,
  vp8xPayload,
} from '../helpers/webpFixtures.ts';

describe('isWebP', () => {
  it('accepts a real WebP header', () => {
    expect(isWebP(buildSimpleLossyWebP(512, 512))).toBe(true);
  });

  it.each([
    ['an empty buffer', new Uint8Array(0)],
    ['a truncated header', new Uint8Array(8)],
    ['a PNG signature', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])],
  ])('rejects %s', (_label, bytes) => {
    expect(isWebP(bytes)).toBe(false);
  });
});

describe('parseWebP on still images', () => {
  it('reads dimensions from a simple lossy file', () => {
    const info = parseWebP(buildSimpleLossyWebP(512, 288));
    expect(info.width).toBe(512);
    expect(info.height).toBe(288);
    expect(info.isAnimated).toBe(false);
    expect(info.isLossless).toBe(false);
    expect(info.frameCount).toBe(1);
    expect(info.durationMs).toBe(0);
  });

  it('reads dimensions and alpha from a lossless file', () => {
    const info = parseWebP(buildLosslessWebP(512, 512, true));
    expect(info.width).toBe(512);
    expect(info.height).toBe(512);
    expect(info.isLossless).toBe(true);
    expect(info.hasAlpha).toBe(true);
  });

  it('reports no alpha for a lossless file that declares none', () => {
    expect(parseWebP(buildLosslessWebP(96, 96, false)).hasAlpha).toBe(false);
  });

  it('detects alpha carried in a separate ALPH chunk', () => {
    const bytes = riff([
      chunk('VP8X', vp8xPayload({ width: 512, height: 512, hasAlpha: true })),
      chunk('ALPH', new Uint8Array(16)),
      chunk('VP8 ', vp8Payload(512, 512)),
    ]);
    expect(parseWebP(bytes).hasAlpha).toBe(true);
  });

  it('prefers the VP8X canvas size over the frame size', () => {
    const bytes = riff([
      chunk('VP8X', vp8xPayload({ width: 512, height: 400 })),
      chunk('VP8 ', vp8Payload(256, 200)),
    ]);
    const info = parseWebP(bytes);
    expect(info.width).toBe(512);
    expect(info.height).toBe(400);
  });

  it('reports the full file length, including the RIFF header', () => {
    const bytes = buildSimpleLossyWebP(512, 512);
    expect(parseWebP(bytes).byteLength).toBe(bytes.byteLength);
  });

  it('lists the chunks it walked', () => {
    const info = parseWebP(buildSimpleLossyWebP(512, 512));
    expect(info.chunks.map((c) => c.fourCC)).toEqual(['VP8 ']);
  });

  it('walks past the pad byte of an odd-length chunk', () => {
    const bytes = riff([
      chunk('ICCP', new Uint8Array(7)), // odd payload, so a pad byte follows
      chunk('VP8 ', vp8Payload(512, 512)),
    ]);
    expect(parseWebP(bytes).chunks.map((c) => c.fourCC)).toEqual(['ICCP', 'VP8 ']);
  });
});

describe('parseWebP on animations', () => {
  const frames = [{ durationMs: 33 }, { durationMs: 33 }, { durationMs: 34 }];

  it('counts frames and sums their delays', () => {
    const info = parseWebP(buildAnimatedWebP({ width: 512, height: 512, frames }));
    expect(info.isAnimated).toBe(true);
    expect(info.frameCount).toBe(3);
    expect(info.durationMs).toBe(100);
  });

  it('reads the canvas size and alpha flag from VP8X', () => {
    const info = parseWebP(buildAnimatedWebP({ width: 512, height: 512, frames, hasAlpha: true }));
    expect(info.width).toBe(512);
    expect(info.height).toBe(512);
    expect(info.hasAlpha).toBe(true);
  });

  it('reads the loop count, where zero means forever', () => {
    expect(parseWebP(buildAnimatedWebP({ width: 512, height: 512, frames, loopCount: 0 })).loopCount).toBe(0);
    expect(parseWebP(buildAnimatedWebP({ width: 512, height: 512, frames, loopCount: 5 })).loopCount).toBe(5);
  });

  it('handles a 90-frame animation, the maximum a 3 s 30 fps export produces', () => {
    const many = Array.from({ length: 90 }, () => ({ durationMs: 33 }));
    const info = parseWebP(buildAnimatedWebP({ width: 512, height: 512, frames: many }));
    expect(info.frameCount).toBe(90);
    expect(info.durationMs).toBe(2970);
  });
});

describe('parseWebP error handling', () => {
  it.each([
    ['a buffer that is too short', new Uint8Array(4)],
    ['a missing RIFF signature', new Uint8Array(32)],
  ])('rejects %s', (_label, bytes) => {
    expect(() => parseWebP(bytes)).toThrow(FormatParseError);
  });

  it('rejects a file whose chunk runs past the end', () => {
    const bytes = buildSimpleLossyWebP(512, 512);
    // Inflate the VP8 chunk size so it claims more data than exists.
    new DataView(bytes.buffer).setUint32(16, 0xffff, true);
    expect(() => parseWebP(bytes)).toThrow(/claims/);
  });

  it('rejects a lossy frame with a corrupt start code', () => {
    const payload = vp8Payload(512, 512);
    payload[3] = 0x00;
    expect(() => parseWebP(riff([chunk('VP8 ', payload)]))).toThrow(/start code/);
  });

  it('rejects a file that never declares its dimensions', () => {
    expect(() => parseWebP(riff([chunk('EXIF', new Uint8Array(8))]))).toThrow(/dimensions/);
  });

  it('accepts an ArrayBuffer as well as a Uint8Array', () => {
    const bytes = buildSimpleLossyWebP(512, 512);
    const copy = bytes.slice().buffer;
    expect(parseWebP(copy).width).toBe(512);
  });
});
