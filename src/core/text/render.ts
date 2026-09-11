import type { Size } from '../geometry.ts';
import type { AnyContext2D } from '../render/canvas.ts';
import { layoutTextLayer } from './layout.ts';
import type { MeasureText, TextLayout } from './layout.ts';
import type { TextLayer } from './model.ts';

/** A measurer backed by a real canvas context. */
export function contextMeasurer(context: AnyContext2D): MeasureText {
  return (text, font) => {
    context.font = font;
    return context.measureText(text).width;
  };
}

function drawLayout(context: AnyContext2D, layer: TextLayer, layout: TextLayout): void {
  context.save();

  context.globalAlpha = layer.opacity;
  context.translate(layout.centerX, layout.centerY);
  context.rotate(layout.rotationRad);

  context.font = layout.font;
  context.textAlign = layer.align;
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.miterLimit = 2;

  for (const line of layout.lines) {
    if (line.text === '') continue;

    // The shadow is painted with the outline pass so it sits behind the glyph
    // rather than showing through the fill; it is then cleared for the fill.
    if (layout.shadowBlurPx > 0) {
      context.shadowColor = layer.shadowColor;
      context.shadowBlur = layout.shadowBlurPx;
    }

    if (layout.strokePx > 0) {
      context.lineWidth = layout.strokePx;
      context.strokeStyle = layer.strokeColor;
      context.strokeText(line.text, line.x, line.y);
    }

    context.shadowColor = 'transparent';
    context.shadowBlur = 0;

    context.fillStyle = layer.color;
    context.fillText(line.text, line.x, line.y);
  }

  context.restore();
}

/** Draw one layer onto a canvas of the given size. */
export function drawTextLayer(context: AnyContext2D, layer: TextLayer, size: Size): TextLayout {
  const layout = layoutTextLayer(layer, size, contextMeasurer(context));
  drawLayout(context, layer, layout);
  return layout;
}

/** Draw the whole stack, earliest first, so later layers sit on top. */
export function drawTextLayers(
  context: AnyContext2D,
  layers: readonly TextLayer[],
  size: Size,
): void {
  for (const layer of layers) {
    drawTextLayer(context, layer, size);
  }
}
