import type { FitMode, Size } from '../geometry.ts';
import { drawTextLayers } from '../text/render.ts';
import type { TextLayer } from '../text/model.ts';
import type { AnyContext2D } from './canvas.ts';
import { drawComposite } from './composite.ts';
import type { DrawableSource } from './composite.ts';

export interface StickerFrameOptions {
  readonly source: DrawableSource;
  readonly size: Size;
  readonly fit: FitMode;
  readonly background?: string | null;
  readonly layers?: readonly TextLayer[];
}

/**
 * The single definition of what a sticker frame looks like.
 *
 * The preview and the encoder both go through here, so what is on screen
 * cannot drift from what is exported.
 */
export function drawStickerFrame(context: AnyContext2D, options: StickerFrameOptions): void {
  const { source, size, fit, background = null, layers = [] } = options;

  drawComposite(context, source, { size, fit, background });
  drawTextLayers(context, layers, size);
}
