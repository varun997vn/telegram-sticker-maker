import type { Size } from '../geometry.ts';

/**
 * Canvas plumbing that works with both the on-screen canvas used for previews
 * and the OffscreenCanvas used for encoding.
 */

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type AnyContext2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function supportsOffscreenCanvas(): boolean {
  return typeof OffscreenCanvas !== 'undefined';
}

/** An off-screen drawing surface, falling back to a detached DOM canvas. */
export function createRenderCanvas(size: Size): AnyCanvas {
  if (supportsOffscreenCanvas()) {
    return new OffscreenCanvas(size.width, size.height);
  }

  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  return canvas;
}

export function resizeCanvas(canvas: AnyCanvas, size: Size): void {
  if (canvas.width !== size.width) canvas.width = size.width;
  if (canvas.height !== size.height) canvas.height = size.height;
}

export function get2dContext(canvas: AnyCanvas): AnyContext2D {
  // `alpha` must stay on: stickers are transparent, and `willReadFrequently`
  // would force a software backend we do not want for scaling.
  const context = canvas.getContext('2d', { alpha: true }) as AnyContext2D | null;
  if (!context) {
    throw new Error('This browser did not provide a 2D canvas context');
  }
  return context;
}

/** `toBlob` for a DOM canvas, `convertToBlob` for an offscreen one. */
export async function canvasToBlob(
  canvas: AnyCanvas,
  type: string,
  quality?: number,
): Promise<Blob> {
  if (canvas instanceof OffscreenCanvas) {
    return await canvas.convertToBlob(quality === undefined ? { type } : { type, quality });
  }

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`This browser could not encode a canvas as ${type}`));
      },
      type,
      quality,
    );
  });
}

export async function canvasToBytes(
  canvas: AnyCanvas,
  type: string,
  quality?: number,
): Promise<Uint8Array> {
  const blob = await canvasToBlob(canvas, type, quality);
  return new Uint8Array(await blob.arrayBuffer());
}
