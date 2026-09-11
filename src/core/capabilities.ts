import { isVp9EncodingSupported } from './encode/vp9Encoder.ts';
import { canvasToBlob, createRenderCanvas, get2dContext } from './render/canvas.ts';

/**
 * What this browser can actually do, checked once at startup.
 *
 * Every export path depends on something the browser may not have. Finding
 * that out when the user presses Generate — after a 32 MB download and a
 * minute of work — is the worst possible moment, so the answers are collected
 * up front and the affected controls explain themselves instead of failing.
 */

export interface Capabilities {
  /** Canvas WebP encoding, which every still sticker depends on. */
  readonly webpEncode: boolean;
  /** WebCodecs VP9, which Telegram video stickers depend on. */
  readonly vp9Encode: boolean;
  /** Not required, but its absence means encoding competes with the UI thread. */
  readonly offscreenCanvas: boolean;
}

export const ASSUME_CAPABLE: Capabilities = {
  webpEncode: true,
  vp9Encode: true,
  offscreenCanvas: true,
};

async function canEncodeWebP(): Promise<boolean> {
  try {
    const canvas = createRenderCanvas({ width: 2, height: 2 });
    // An OffscreenCanvas that has never been given a rendering context throws
    // InvalidStateError from convertToBlob, so the probe has to draw first or
    // it reports failure on every browser.
    get2dContext(canvas).clearRect(0, 0, 2, 2);

    const blob = await canvasToBlob(canvas, 'image/webp', 0.8);
    // A browser that cannot encode WebP silently produces a PNG instead.
    return blob.type === 'image/webp';
  } catch {
    return false;
  }
}

export async function detectCapabilities(): Promise<Capabilities> {
  const [webpEncode, vp9Encode] = await Promise.all([
    canEncodeWebP(),
    isVp9EncodingSupported({ width: 512, height: 512 }),
  ]);

  return {
    webpEncode,
    vp9Encode,
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
  };
}

/** Why a target cannot be produced here, or null if it can. */
export function unsupportedReason(
  capabilities: Capabilities,
  container: 'webp' | 'webm' | 'png',
): string | null {
  if (container === 'webm' && !capabilities.vp9Encode) {
    return 'This browser cannot encode VP9 video. Telegram video stickers need WebCodecs — try a recent Chrome, Edge or Firefox.';
  }
  if (container === 'webp' && !capabilities.webpEncode) {
    return 'This browser cannot encode WebP images, which both platforms require.';
  }
  return null;
}
