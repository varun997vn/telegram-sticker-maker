import { describe, expect, it } from 'vitest';
import { FormatParseError } from '@/core/formats/errors.ts';
import { isPNG, parsePNG } from '@/core/formats/png.ts';

function pngHeader(width: number, height: number, colorType: number, chunkType = 'IHDR'): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  bytes.set([...chunkType].map((c) => c.charCodeAt(0)), 12);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  bytes[24] = 8;
  bytes[25] = colorType;
  return bytes;
}

describe('isPNG', () => {
  it('accepts a PNG signature', () => {
    expect(isPNG(pngHeader(96, 96, 6))).toBe(true);
  });

  it.each([
    ['an empty buffer', new Uint8Array(0)],
    ['a RIFF header', Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0])],
  ])('rejects %s', (_label, bytes) => {
    expect(isPNG(bytes)).toBe(false);
  });
});

describe('parsePNG', () => {
  it('reads dimensions from IHDR', () => {
    const info = parsePNG(pngHeader(96, 96, 6));
    expect(info.width).toBe(96);
    expect(info.height).toBe(96);
    expect(info.bitDepth).toBe(8);
  });

  it.each([
    [6, true, 'RGB with alpha'],
    [4, true, 'greyscale with alpha'],
    [2, false, 'RGB without alpha'],
    [0, false, 'greyscale without alpha'],
  ])('colour type %i reports hasAlpha=%s (%s)', (colorType, expected) => {
    expect(parsePNG(pngHeader(96, 96, colorType)).hasAlpha).toBe(expected);
  });

  it('rejects a file whose first chunk is not IHDR', () => {
    expect(() => parsePNG(pngHeader(96, 96, 6, 'sRGB'))).toThrow(/IHDR/);
  });

  it.each([
    ['a bad signature', new Uint8Array(40)],
    ['a truncated file', pngHeader(96, 96, 6).slice(0, 20)],
  ])('rejects %s', (_label, bytes) => {
    expect(() => parsePNG(bytes)).toThrow(FormatParseError);
  });
});
