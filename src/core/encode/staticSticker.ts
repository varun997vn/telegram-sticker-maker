import { qualityLadder, searchWithinBudget } from '../budget.ts';
import { checkCompliance } from '../compliance.ts';
import type { ComplianceReport } from '../compliance.ts';
import { outputSize } from '../geometry.ts';
import type { FitMode, Size } from '../geometry.ts';
import { canvasToBytes, createRenderCanvas, get2dContext } from '../render/canvas.ts';
import { drawComposite } from '../render/composite.ts';
import type { DrawableSource } from '../render/composite.ts';
import type { StickerSpec } from '../specs.ts';

/**
 * Encoding a still sticker straight through the canvas.
 *
 * No ffmpeg is involved: browsers encode WebP natively, which keeps still
 * exports instant and means the 32 MB wasm core is only fetched by users who
 * actually export an animation.
 */

/**
 * Quality steps handed to the budget search, best first.
 *
 * The floor is 30 rather than 0 because a 512x512 sticker below that is
 * visibly mangled; if 30 still will not fit, saying so is more useful than
 * silently shipping something unusable.
 */
export const WEBP_QUALITY_LADDER = qualityLadder(95, 30, 8);

export interface StaticEncodeOptions {
  readonly source: DrawableSource;
  readonly spec: StickerSpec;
  readonly fit: FitMode;
  readonly background?: string | null;
  readonly signal?: AbortSignal;
  /** Overrides the default ladder; mainly a test seam. */
  readonly qualitySteps?: readonly number[];
}

export interface StaticEncodeResult {
  readonly spec: StickerSpec;
  readonly bytes: Uint8Array;
  readonly blob: Blob;
  readonly byteLength: number;
  readonly size: Size;
  /** The WebP quality that was finally used. */
  readonly quality: number;
  /** How many encodes the budget search performed. */
  readonly attempts: number;
  readonly withinBudget: boolean;
  readonly compliance: ComplianceReport;
}

export async function encodeStaticSticker(
  options: StaticEncodeOptions,
): Promise<StaticEncodeResult> {
  const { source, spec, fit, background = null, signal } = options;

  if (spec.kind !== 'static') {
    throw new TypeError(`"${spec.id}" is an animated target and cannot be encoded as a still image`);
  }

  const size = outputSize({ width: source.width, height: source.height }, spec);

  // Composite once and re-encode the same pixels at each quality step.
  const canvas = createRenderCanvas(size);
  const context = get2dContext(canvas);
  drawComposite(context, source, { size, fit, background });

  const candidates = options.qualitySteps ?? WEBP_QUALITY_LADDER;
  const search = await searchWithinBudget<number>({
    candidates,
    maxBytes: spec.maxBytes,
    ...(signal ? { signal } : {}),
    encode: (quality) => canvasToBytes(canvas, spec.mimeType, quality / 100),
  });

  const attempt = search.status === 'fit' ? search.best : search.smallest;
  const bytes = attempt.data;

  return {
    spec,
    bytes,
    blob: new Blob([bytes as BlobPart], { type: spec.mimeType }),
    byteLength: attempt.byteLength,
    size,
    quality: attempt.params,
    attempts: search.attempts.length,
    withinBudget: search.status === 'fit',
    compliance: checkCompliance(bytes, spec),
  };
}
