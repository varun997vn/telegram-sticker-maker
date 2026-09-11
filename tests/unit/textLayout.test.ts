import { describe, expect, it } from 'vitest';
import { fontReference, layoutBounds, layoutTextLayer } from '@/core/text/layout.ts';
import type { MeasureText } from '@/core/text/layout.ts';
import { DEFAULT_TEXT_LAYER } from '@/core/text/model.ts';
import type { TextLayer } from '@/core/text/model.ts';

/**
 * Glyph widths are injected, so every expectation below is exact arithmetic
 * rather than a guess about whatever font the test machine happens to have.
 */

/** Every character is exactly a tenth of the font size wide. */
function fixedWidthMeasurer(ratio = 0.1): MeasureText {
  return (text, font) => {
    const fontPx = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 0);
    return text.length * fontPx * ratio;
  };
}

const measure = fixedWidthMeasurer();
const square = { width: 512, height: 512 };
const wide = { width: 512, height: 288 };

function layer(overrides: Partial<TextLayer> = {}): TextLayer {
  return { id: 'test', ...DEFAULT_TEXT_LAYER, ...overrides };
}

describe('fontReference', () => {
  it('is the longest side, which is 512 for every sticker target', () => {
    expect(fontReference(square)).toBe(512);
    expect(fontReference(wide)).toBe(512);
    expect(fontReference({ width: 288, height: 512 })).toBe(512);
  });
});

describe('layoutTextLayer', () => {
  it('scales the font from the longest side, so text looks the same on every target', () => {
    const subject = layer({ fontSize: 0.125 });
    expect(layoutTextLayer(subject, square, measure).fontPx).toBe(64);
    // A shorter canvas must not shrink the text.
    expect(layoutTextLayer(subject, wide, measure).fontPx).toBe(64);
  });

  it('places the block centre at the normalised position', () => {
    const layout = layoutTextLayer(layer({ x: 0.25, y: 0.75 }), wide, measure);
    expect(layout.centerX).toBe(128);
    expect(layout.centerY).toBe(216);
  });

  it('derives stroke and shadow from the font size, not the canvas', () => {
    const layout = layoutTextLayer(
      layer({ fontSize: 0.125, strokeWidth: 0.1, shadowBlur: 0.25 }),
      square,
      measure,
    );
    expect(layout.strokePx).toBeCloseTo(6.4, 6);
    expect(layout.shadowBlurPx).toBeCloseTo(16, 6);
  });

  it('converts rotation to radians', () => {
    expect(layoutTextLayer(layer({ rotation: 90 }), square, measure).rotationRad).toBeCloseTo(
      Math.PI / 2,
      9,
    );
  });

  it('uppercases the text when asked, and leaves it alone otherwise', () => {
    expect(layoutTextLayer(layer({ text: 'hello', uppercase: true }), square, measure).lines[0]?.text).toBe('HELLO');
    expect(layoutTextLayer(layer({ text: 'hello', uppercase: false }), square, measure).lines[0]?.text).toBe('hello');
  });

  it('splits on explicit newlines', () => {
    const layout = layoutTextLayer(
      layer({ text: 'one\ntwo\nthree', uppercase: false, maxWidth: 1 }),
      square,
      measure,
    );
    expect(layout.lines.map((line) => line.text)).toEqual(['one', 'two', 'three']);
  });

  it('stacks lines symmetrically about the centre', () => {
    const layout = layoutTextLayer(
      layer({ text: 'a\nb\nc', uppercase: false, fontSize: 0.125, lineHeight: 1 }),
      square,
      measure,
    );
    expect(layout.lineHeightPx).toBe(64);
    expect(layout.lines.map((line) => line.y)).toEqual([-64, 0, 64]);
  });

  it('centres an even number of lines about the middle gap', () => {
    const layout = layoutTextLayer(
      layer({ text: 'a\nb', uppercase: false, fontSize: 0.125, lineHeight: 1 }),
      square,
      measure,
    );
    expect(layout.lines.map((line) => line.y)).toEqual([-32, 32]);
  });

  it('reports the block size from the widest line and the line count', () => {
    const layout = layoutTextLayer(
      layer({ text: 'ab\nabcd', uppercase: false, fontSize: 0.125, lineHeight: 1, maxWidth: 1 }),
      square,
      measure,
    );
    expect(layout.width).toBeCloseTo(4 * 6.4, 6);
    expect(layout.height).toBeCloseTo(128, 6);
  });
});

describe('layoutTextLayer wrapping', () => {
  it('wraps on word boundaries at the wrap width', () => {
    // fontPx is 64 and each character 6.4 wide, so a wrap width of
    // 0.1875 * 512 = 96px holds 15 characters: "aaaaa bbbbb" (70.4) fits but
    // "aaaaa bbbbb ccccc" (108.8) does not.
    const layout = layoutTextLayer(
      layer({ text: 'aaaaa bbbbb ccccc ddddd', uppercase: false, fontSize: 0.125, maxWidth: 0.1875 }),
      square,
      measure,
    );
    expect(layout.lines.map((line) => line.text)).toEqual(['aaaaa bbbbb', 'ccccc ddddd']);
  });

  it('fits as many words on a line as the width allows', () => {
    // The same text at a 128px wrap width takes three words on the first line.
    const layout = layoutTextLayer(
      layer({ text: 'aaaaa bbbbb ccccc ddddd', uppercase: false, fontSize: 0.125, maxWidth: 0.25 }),
      square,
      measure,
    );
    expect(layout.lines.map((line) => line.text)).toEqual(['aaaaa bbbbb ccccc', 'ddddd']);
  });

  it('keeps everything on one line when it fits', () => {
    const layout = layoutTextLayer(
      layer({ text: 'short text', uppercase: false, fontSize: 0.05, maxWidth: 1 }),
      square,
      measure,
    );
    expect(layout.lines).toHaveLength(1);
  });

  it('lets a single word wider than the wrap width overflow rather than breaking it', () => {
    const layout = layoutTextLayer(
      layer({ text: 'supercalifragilistic', uppercase: false, fontSize: 0.125, maxWidth: 0.1 }),
      square,
      measure,
    );
    expect(layout.lines.map((line) => line.text)).toEqual(['supercalifragilistic']);
  });

  it('applies the wrap width after uppercasing', () => {
    // Uppercasing does not change the character count with this measurer, so
    // the wrap points must match the lowercase case exactly.
    const options = { text: 'aaaaa bbbbb ccccc', fontSize: 0.125, maxWidth: 0.25 };
    const lower = layoutTextLayer(layer({ ...options, uppercase: false }), square, measure);
    const upper = layoutTextLayer(layer({ ...options, uppercase: true }), square, measure);
    expect(upper.lines.map((line) => line.text.toLowerCase())).toEqual(
      lower.lines.map((line) => line.text),
    );
  });

  it('handles empty text without producing a broken layout', () => {
    const layout = layoutTextLayer(layer({ text: '' }), square, measure);
    expect(layout.lines).toHaveLength(1);
    expect(layout.width).toBe(0);
  });

  it('collapses runs of whitespace between words', () => {
    const layout = layoutTextLayer(
      layer({ text: 'a    b', uppercase: false, maxWidth: 1, fontSize: 0.05 }),
      square,
      measure,
    );
    expect(layout.lines[0]?.text).toBe('a b');
  });
});

describe('layoutTextLayer alignment', () => {
  const text = 'ab\nabcd';
  const options = { text, uppercase: false, fontSize: 0.125, maxWidth: 1 } as const;

  it('anchors centred text on the block centre', () => {
    const layout = layoutTextLayer(layer({ ...options, align: 'center' }), square, measure);
    expect(layout.lines.every((line) => line.x === 0)).toBe(true);
  });

  it('anchors left-aligned text on the left edge of the block', () => {
    const layout = layoutTextLayer(layer({ ...options, align: 'left' }), square, measure);
    expect(layout.lines.every((line) => line.x === -layout.width / 2)).toBe(true);
  });

  it('anchors right-aligned text on the right edge of the block', () => {
    const layout = layoutTextLayer(layer({ ...options, align: 'right' }), square, measure);
    expect(layout.lines.every((line) => line.x === layout.width / 2)).toBe(true);
  });
});

describe('layoutBounds', () => {
  const flat = layer({ text: 'ab', uppercase: false, fontSize: 0.125, lineHeight: 1, maxWidth: 1 });

  it('matches the block size when the layer is not rotated', () => {
    const layout = layoutTextLayer(flat, square, measure);
    const bounds = layoutBounds(layout);
    expect(bounds.width).toBeCloseTo(layout.width, 6);
    expect(bounds.height).toBeCloseTo(layout.height, 6);
  });

  it('is centred on the layer position', () => {
    const layout = layoutTextLayer(layer({ ...flat, x: 0.25, y: 0.5 }), square, measure);
    const bounds = layoutBounds(layout);
    expect(bounds.x + bounds.width / 2).toBeCloseTo(128, 6);
    expect(bounds.y + bounds.height / 2).toBeCloseTo(256, 6);
  });

  it('swaps width and height at a quarter turn', () => {
    const upright = layoutTextLayer(flat, square, measure);
    const turned = layoutBounds(layoutTextLayer({ ...flat, rotation: 90 }, square, measure));
    expect(turned.width).toBeCloseTo(upright.height, 6);
    expect(turned.height).toBeCloseTo(upright.width, 6);
  });

  it('grows a square block on both axes at 45 degrees', () => {
    // 10 characters at 6.4px wide is a 64x64 block, so neither axis is
    // privileged and the rotation has to enlarge both.
    const squareBlock = layer({
      text: 'abcdefghij',
      uppercase: false,
      fontSize: 0.125,
      lineHeight: 1,
      maxWidth: 1,
    });
    const upright = layoutTextLayer(squareBlock, square, measure);
    const tilted = layoutBounds(layoutTextLayer({ ...squareBlock, rotation: 45 }, square, measure));

    expect(upright.width).toBeCloseTo(upright.height, 6);
    expect(tilted.width).toBeGreaterThan(upright.width);
    expect(tilted.height).toBeGreaterThan(upright.height);
  });

  it('shortens a tall narrow block as it tilts, while widening it', () => {
    // Rotation does not simply inflate the box: a column of text laid on its
    // side is wider and shorter, and the bounds have to say so.
    const upright = layoutTextLayer(flat, square, measure);
    const tilted = layoutBounds(layoutTextLayer({ ...flat, rotation: 45 }, square, measure));

    expect(upright.width).toBeLessThan(upright.height);
    expect(tilted.width).toBeGreaterThan(upright.width);
    expect(tilted.height).toBeLessThan(upright.height);
  });
});
