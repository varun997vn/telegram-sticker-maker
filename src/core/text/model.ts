/**
 * Text layers are stored in normalised coordinates, not pixels.
 *
 * The same layer has to render onto every target, and those targets are not
 * the same shape: a WhatsApp sticker is always 512x512 while a Telegram one
 * keeps the source aspect ratio. Positions are therefore fractions of the
 * canvas box, and sizes are fractions of its longest side — which is 512 for
 * every sticker target, so text keeps the same apparent size everywhere.
 */

export const FONT_CHOICES = [
  {
    id: 'impact',
    label: 'Impact',
    stack: "Impact, Anton, 'Arial Black', 'Helvetica Neue', sans-serif",
    weight: 400,
  },
  {
    id: 'sans',
    label: 'Sans',
    stack: "system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    weight: 700,
  },
  {
    id: 'serif',
    label: 'Serif',
    stack: "Georgia, 'Times New Roman', Times, serif",
    weight: 700,
  },
  {
    id: 'rounded',
    label: 'Rounded',
    stack: "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif",
    weight: 700,
  },
  {
    id: 'mono',
    label: 'Mono',
    stack: "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace",
    weight: 700,
  },
] as const;

export type FontId = (typeof FONT_CHOICES)[number]['id'];

export type TextAlign = 'left' | 'center' | 'right';

export interface TextLayer {
  readonly id: string;
  readonly text: string;
  /** Horizontal centre of the text block, as a fraction of the canvas width. */
  readonly x: number;
  /** Vertical centre of the text block, as a fraction of the canvas height. */
  readonly y: number;
  readonly fontId: FontId;
  /** Fraction of the canvas's longest side. */
  readonly fontSize: number;
  readonly color: string;
  readonly strokeColor: string;
  /** Outline width, as a fraction of the font size. */
  readonly strokeWidth: number;
  readonly shadowColor: string;
  /** Shadow blur radius, as a fraction of the font size. */
  readonly shadowBlur: number;
  /** Clockwise, in degrees. */
  readonly rotation: number;
  readonly opacity: number;
  readonly align: TextAlign;
  /** Line spacing, as a multiple of the font size. */
  readonly lineHeight: number;
  readonly uppercase: boolean;
  /** Wrap width, as a fraction of the canvas width. */
  readonly maxWidth: number;
}

/**
 * The meme-caption look: heavy white text with a black outline, sat near the
 * bottom. It is what most people want from a sticker caption, and every part
 * of it is adjustable.
 */
export const DEFAULT_TEXT_LAYER: Omit<TextLayer, 'id'> = {
  text: 'Your text',
  x: 0.5,
  y: 0.84,
  fontId: 'impact',
  fontSize: 0.12,
  color: '#ffffff',
  strokeColor: '#000000',
  strokeWidth: 0.08,
  shadowColor: '#000000',
  shadowBlur: 0,
  rotation: 0,
  opacity: 1,
  align: 'center',
  lineHeight: 1.15,
  uppercase: true,
  maxWidth: 0.92,
};

export const TEXT_LIMITS = {
  fontSize: { min: 0.02, max: 0.5 },
  strokeWidth: { min: 0, max: 0.3 },
  shadowBlur: { min: 0, max: 0.5 },
  rotation: { min: -180, max: 180 },
  opacity: { min: 0, max: 1 },
  lineHeight: { min: 0.6, max: 3 },
  maxWidth: { min: 0.1, max: 1 },
  position: { min: -0.5, max: 1.5 },
  textLength: 500,
} as const;

export function getFont(fontId: FontId): (typeof FONT_CHOICES)[number] {
  const choice = FONT_CHOICES.find((font) => font.id === fontId);
  return choice ?? FONT_CHOICES[0];
}

/** A CSS `font` shorthand for the given layer at a concrete pixel size. */
export function fontShorthand(fontId: FontId, fontPx: number): string {
  const font = getFont(fontId);
  return `${font.weight} ${fontPx}px ${font.stack}`;
}
