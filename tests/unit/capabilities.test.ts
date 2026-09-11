import { describe, expect, it } from 'vitest';
import { ASSUME_CAPABLE, unsupportedReason } from '@/core/capabilities.ts';
import type { Capabilities } from '@/core/capabilities.ts';

const capable: Capabilities = ASSUME_CAPABLE;
const noVp9: Capabilities = { ...ASSUME_CAPABLE, vp9Encode: false };
const noWebp: Capabilities = { ...ASSUME_CAPABLE, webpEncode: false };

describe('unsupportedReason', () => {
  it('says nothing when everything is available', () => {
    for (const container of ['webp', 'webm', 'png'] as const) {
      expect(unsupportedReason(capable, container)).toBeNull();
    }
  });

  it('explains a missing VP9 encoder, and names what is needed', () => {
    const reason = unsupportedReason(noVp9, 'webm');
    expect(reason).toContain('WebCodecs');
    expect(reason).toMatch(/Chrome|Edge|Firefox/);
  });

  it('does not blame VP9 for the WebP targets', () => {
    expect(unsupportedReason(noVp9, 'webp')).toBeNull();
    expect(unsupportedReason(noVp9, 'png')).toBeNull();
  });

  it('explains a missing WebP encoder', () => {
    expect(unsupportedReason(noWebp, 'webp')).toContain('WebP');
  });

  it('assumes capability until told otherwise, so nothing is disabled while detecting', () => {
    expect(ASSUME_CAPABLE.webpEncode).toBe(true);
    expect(ASSUME_CAPABLE.vp9Encode).toBe(true);
  });
});
