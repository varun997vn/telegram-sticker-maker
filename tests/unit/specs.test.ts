import { describe, expect, it } from 'vitest';
import {
  ALL_SPECS,
  MAX_ANIMATION_MS,
  STICKER_SPECS,
  STICKER_TARGET_IDS,
  USER_SELECTABLE_TARGETS,
  getSpec,
  isStickerTargetId,
  specsForKind,
} from '@/core/specs.ts';

describe('sticker specs', () => {
  it('exposes one spec per declared target id', () => {
    expect(ALL_SPECS).toHaveLength(STICKER_TARGET_IDS.length);
    for (const id of STICKER_TARGET_IDS) {
      expect(getSpec(id).id).toBe(id);
    }
  });

  it.each(ALL_SPECS)('$id has internally consistent limits', (spec) => {
    expect(spec.maxBytes).toBeGreaterThan(0);
    expect(spec.side).toBeGreaterThan(0);
    expect(spec.allowsAudio).toBe(false);

    if (spec.kind === 'animated') {
      expect(spec.maxDurationMs).toBeGreaterThan(0);
      expect(spec.maxFrameRate).toBeGreaterThan(0);
    } else {
      expect(spec.maxDurationMs).toBeNull();
      expect(spec.maxFrameRate).toBeNull();
    }
  });

  it('matches the published platform limits', () => {
    expect(STICKER_SPECS['telegram-static'].maxBytes).toBe(512_000);
    expect(STICKER_SPECS['telegram-video'].maxBytes).toBe(256_000);
    expect(STICKER_SPECS['whatsapp-static'].maxBytes).toBe(100_000);
    expect(STICKER_SPECS['whatsapp-animated'].maxBytes).toBe(500_000);
    expect(STICKER_SPECS['whatsapp-tray'].maxBytes).toBe(50_000);
  });

  it('caps every animated target at the shared 3 second limit', () => {
    for (const spec of specsForKind('animated')) {
      expect(spec.maxDurationMs).toBe(MAX_ANIMATION_MS);
    }
  });

  it('requires even dimensions only for the VP9 target', () => {
    const evenOnly = ALL_SPECS.filter((spec) => spec.requireEvenDimensions).map((spec) => spec.id);
    expect(evenOnly).toEqual(['telegram-video']);
  });

  it('lets Telegram keep the source aspect ratio and pins WhatsApp to a square', () => {
    expect(STICKER_SPECS['telegram-static'].sizing).toBe('longest-side');
    expect(STICKER_SPECS['telegram-video'].sizing).toBe('longest-side');
    expect(STICKER_SPECS['whatsapp-static'].sizing).toBe('exact');
    expect(STICKER_SPECS['whatsapp-animated'].sizing).toBe('exact');
  });

  it('hides the tray icon from the user-facing target list', () => {
    expect(USER_SELECTABLE_TARGETS).not.toContain('whatsapp-tray');
    expect(USER_SELECTABLE_TARGETS).toHaveLength(STICKER_TARGET_IDS.length - 1);
  });

  it('narrows arbitrary strings to target ids', () => {
    expect(isStickerTargetId('telegram-video')).toBe(true);
    expect(isStickerTargetId('signal-static')).toBe(false);
  });
});
