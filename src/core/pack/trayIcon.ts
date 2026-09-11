import { searchWithinBudget } from '../budget.ts';
import { fitRect } from '../geometry.ts';
import { canvasToBytes, createRenderCanvas, get2dContext } from '../render/canvas.ts';
import { getSpec } from '../specs.ts';
import type { PackSticker } from './model.ts';

/**
 * The 96x96 PNG WhatsApp shows in its sticker picker.
 *
 * It is generated from the first sticker in the pack rather than asked for
 * separately: a tray icon the user has to supply is one more thing standing
 * between them and a finished pack.
 */

const TRAY_SPEC = getSpec('whatsapp-tray');

/** PNG has no quality dial, so shrinking means fewer colours; scale is the lever. */
const SCALE_LADDER = [1, 0.85, 0.7, 0.55] as const;

export async function renderTrayIcon(sticker: PackSticker): Promise<Uint8Array> {
  const spec = getSpec(sticker.targetId);
  const blob = new Blob([sticker.bytes as BlobPart], { type: spec.mimeType });

  // An animated source decodes to its first frame, which is what a tray icon
  // should show anyway.
  const bitmap = await createImageBitmap(blob);
  const side = TRAY_SPEC.side;

  try {
    const search = await searchWithinBudget<number>({
      candidates: SCALE_LADDER,
      maxBytes: TRAY_SPEC.maxBytes,
      encode: async (scale) => {
        const canvas = createRenderCanvas({ width: side, height: side });
        const context = get2dContext(canvas);
        context.clearRect(0, 0, side, side);
        context.imageSmoothingQuality = 'high';

        const inner = Math.round(side * scale);
        const rect = fitRect(
          { width: bitmap.width, height: bitmap.height },
          { width: inner, height: inner },
          'contain',
        );
        const offset = (side - inner) / 2;
        context.drawImage(bitmap, rect.x + offset, rect.y + offset, rect.width, rect.height);

        return await canvasToBytes(canvas, TRAY_SPEC.mimeType);
      },
    });

    return search.status === 'fit' ? search.best.data : search.smallest.data;
  } finally {
    bitmap.close();
  }
}
