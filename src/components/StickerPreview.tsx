import { useEffect, useRef } from 'react';
import { outputSize } from '../core/geometry.ts';
import type { FitMode } from '../core/geometry.ts';
import type { ImageSource } from '../core/imageSource.ts';
import { get2dContext, resizeCanvas } from '../core/render/canvas.ts';
import { drawStickerFrame } from '../core/render/sticker.ts';
import type { StickerSpec } from '../core/specs.ts';
import type { TextLayer } from '../core/text/model.ts';

interface StickerPreviewProps {
  readonly source: ImageSource;
  readonly spec: StickerSpec;
  readonly fit: FitMode;
  readonly layers: readonly TextLayer[];
}

/** Draws the composite the encoder will see, at the target's real dimensions. */
export function StickerPreview({ source, spec, fit, layers }: StickerPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = outputSize({ width: source.width, height: source.height }, spec);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    resizeCanvas(canvas, size);
    drawStickerFrame(get2dContext(canvas), { source, size, fit, layers });
  }, [source, fit, layers, size.width, size.height]);

  return (
    <canvas
      ref={canvasRef}
      className="preview__canvas"
      data-testid={`preview-${spec.id}`}
      width={size.width}
      height={size.height}
      role="img"
      aria-label={`${spec.label} preview, ${size.width} by ${size.height} pixels`}
    />
  );
}
