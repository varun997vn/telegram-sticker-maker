import { fitRect } from '../geometry.ts';
import type { FitMode, Size } from '../geometry.ts';
import type { AnyContext2D } from './canvas.ts';

export interface CompositeOptions {
  /** The canvas size to draw into. */
  readonly size: Size;
  readonly fit: FitMode;
  /** A CSS colour to fill behind the image; `null` keeps it transparent. */
  readonly background?: string | null;
}

/** Anything drawable that also reports its intrinsic size. */
export interface DrawableSource extends Size {
  readonly bitmap: CanvasImageSource;
}

/**
 * Draw a source into the canvas, replacing whatever was there.
 *
 * Under `cover` the drawn rect deliberately overflows the canvas; the canvas
 * bounds do the cropping.
 */
export function drawComposite(
  context: AnyContext2D,
  source: DrawableSource,
  options: CompositeOptions,
): void {
  const { size, fit, background = null } = options;

  context.clearRect(0, 0, size.width, size.height);

  if (background !== null) {
    context.save();
    context.fillStyle = background;
    context.fillRect(0, 0, size.width, size.height);
    context.restore();
  }

  const rect = fitRect({ width: source.width, height: source.height }, size, fit);

  context.save();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source.bitmap, rect.x, rect.y, rect.width, rect.height);
  context.restore();
}
