import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Size } from '../core/geometry.ts';
import type { FitMode } from '../core/geometry.ts';
import type { DrawableSource } from '../core/render/composite.ts';
import { get2dContext, resizeCanvas } from '../core/render/canvas.ts';
import { drawStickerFrame } from '../core/render/sticker.ts';
import { layoutBounds, layoutTextLayer } from '../core/text/layout.ts';
import type { TextLayer } from '../core/text/model.ts';
import { contextMeasurer } from '../core/text/render.ts';

/**
 * The layout surface, always square.
 *
 * Text positions are normalised, so arranging them on a square works for every
 * target; the per-target cards below show exactly how each one lands.
 */
export const DESIGN_SIZE: Size = { width: 512, height: 512 };

interface TextCanvasProps {
  readonly source: DrawableSource;
  readonly fit: FitMode;
  readonly layers: readonly TextLayer[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly onMove: (id: string, x: number, y: number) => void;
}

interface DragState {
  readonly pointerId: number;
  readonly id: string;
  /** Offset from the layer centre to the grab point, in normalised units. */
  readonly grabX: number;
  readonly grabY: number;
}

export function TextCanvas({
  source,
  fit,
  layers,
  selectedId,
  onSelect,
  onMove,
}: TextCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    resizeCanvas(canvas, DESIGN_SIZE);
    drawStickerFrame(get2dContext(canvas), { source, size: DESIGN_SIZE, fit, layers });
  }, [source, fit, layers]);

  /** Normalised canvas coordinates for a pointer event. */
  const normalise = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  }, []);

  /** The topmost layer whose rotated bounds contain the point. */
  const hitTest = useCallback(
    (x: number, y: number): TextLayer | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;

      const measure = contextMeasurer(get2dContext(canvas));
      const pointX = x * DESIGN_SIZE.width;
      const pointY = y * DESIGN_SIZE.height;

      for (let i = layers.length - 1; i >= 0; i -= 1) {
        const layer = layers[i] as TextLayer;
        const bounds = layoutBounds(layoutTextLayer(layer, DESIGN_SIZE, measure));
        // A minimum grab area keeps very small or empty layers selectable.
        const padX = Math.max(0, 24 - bounds.width) / 2;
        const padY = Math.max(0, 24 - bounds.height) / 2;

        if (
          pointX >= bounds.x - padX &&
          pointX <= bounds.x + bounds.width + padX &&
          pointY >= bounds.y - padY &&
          pointY <= bounds.y + bounds.height + padY
        ) {
          return layer;
        }
      }
      return null;
    },
    [layers],
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = normalise(event);
    const hit = hitTest(point.x, point.y);

    if (!hit) {
      onSelect(null);
      return;
    }

    onSelect(hit.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      pointerId: event.pointerId,
      id: hit.id,
      grabX: point.x - hit.x,
      grabY: point.y - hit.y,
    });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = normalise(event);
    onMove(drag.id, point.x - drag.grabX, point.y - drag.grabY);
  };

  const endDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDrag(null);
  };

  return (
    <canvas
      ref={canvasRef}
      className={`design__canvas${drag ? ' design__canvas--dragging' : ''}`}
      data-testid="design-canvas"
      data-selected={selectedId ?? ''}
      width={DESIGN_SIZE.width}
      height={DESIGN_SIZE.height}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  );
}
