import type { Size } from '../geometry.ts';
import { fontShorthand } from './model.ts';
import type { TextLayer } from './model.ts';

/**
 * Turning a text layer into concrete lines and offsets.
 *
 * Measurement is injected rather than taken from a canvas, so the whole layout
 * — wrapping, alignment, block size, anchoring — is testable without a DOM and
 * with exactly known glyph widths.
 */

/** Measures a string rendered in the given CSS `font` shorthand. */
export type MeasureText = (text: string, font: string) => number;

export interface PositionedLine {
  readonly text: string;
  readonly width: number;
  /** Horizontal offset from the block centre, in canvas pixels. */
  readonly x: number;
  /** Baseline offset from the block centre, in canvas pixels. */
  readonly y: number;
}

export interface TextLayout {
  readonly lines: readonly PositionedLine[];
  readonly font: string;
  readonly fontPx: number;
  readonly lineHeightPx: number;
  readonly strokePx: number;
  readonly shadowBlurPx: number;
  /** Where the block centre sits on the canvas, in pixels. */
  readonly centerX: number;
  readonly centerY: number;
  readonly rotationRad: number;
  /** Size of the text block before rotation, in canvas pixels. */
  readonly width: number;
  readonly height: number;
}

/** Font sizes scale with the longest side, which is 512 for every target. */
export function fontReference(size: Size): number {
  return Math.max(size.width, size.height);
}

function wrapLine(
  line: string,
  maxWidth: number,
  font: string,
  measure: MeasureText,
): string[] {
  if (line === '') return [''];

  const words = line.split(/(\s+)/).filter((part) => part.trim().length > 0);
  if (words.length === 0) return [''];

  const wrapped: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (current !== '' && measure(candidate, font) > maxWidth) {
      wrapped.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current !== '') wrapped.push(current);
  // A single word wider than the wrap width stays on its own line and
  // overflows rather than being broken mid-glyph.
  return wrapped.length > 0 ? wrapped : [''];
}

export function layoutTextLayer(layer: TextLayer, size: Size, measure: MeasureText): TextLayout {
  const reference = fontReference(size);
  const fontPx = Math.max(1, layer.fontSize * reference);
  const font = fontShorthand(layer.fontId, fontPx);
  const lineHeightPx = fontPx * layer.lineHeight;
  const maxWidth = Math.max(1, layer.maxWidth * size.width);

  const raw = layer.uppercase ? layer.text.toUpperCase() : layer.text;
  const measured = raw
    .split('\n')
    .flatMap((line) => wrapLine(line, maxWidth, font, measure))
    .map((text) => ({ text, width: measure(text, font) }));

  const blockWidth = measured.reduce((widest, line) => Math.max(widest, line.width), 0);
  const blockHeight = measured.length * lineHeightPx;

  const lines: PositionedLine[] = measured.map((line, index) => {
    // With `textBaseline: middle`, each line's anchor is its vertical centre.
    const y = (index - (measured.length - 1) / 2) * lineHeightPx;

    // Offsets assume the renderer sets `textAlign` to match, so the anchor is
    // the left edge, centre or right edge of the block as appropriate.
    const x = layer.align === 'center' ? 0 : layer.align === 'left' ? -blockWidth / 2 : blockWidth / 2;

    return { text: line.text, width: line.width, x, y };
  });

  return {
    lines,
    font,
    fontPx,
    lineHeightPx,
    strokePx: layer.strokeWidth * fontPx,
    shadowBlurPx: layer.shadowBlur * fontPx,
    centerX: layer.x * size.width,
    centerY: layer.y * size.height,
    rotationRad: (layer.rotation * Math.PI) / 180,
    width: blockWidth,
    height: blockHeight,
  };
}

/**
 * The axis-aligned box the layout occupies once rotated, in canvas pixels.
 * Used to draw the selection outline and to keep a dragged layer reachable.
 */
export function layoutBounds(layout: TextLayout): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const halfWidth = layout.width / 2;
  const halfHeight = layout.height / 2;
  const cos = Math.abs(Math.cos(layout.rotationRad));
  const sin = Math.abs(Math.sin(layout.rotationRad));

  const width = 2 * (halfWidth * cos + halfHeight * sin);
  const height = 2 * (halfWidth * sin + halfHeight * cos);

  return {
    x: layout.centerX - width / 2,
    y: layout.centerY - height / 2,
    width,
    height,
  };
}
