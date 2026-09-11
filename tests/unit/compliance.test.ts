import { describe, expect, it } from 'vitest';
import { checkCompliance, probeOutput } from '@/core/compliance.ts';
import type { ComplianceCode } from '@/core/compliance.ts';
import { STICKER_SPECS } from '@/core/specs.ts';
import {
  buildAnimatedWebP,
  buildLosslessWebP,
  buildSimpleLossyWebP,
} from '../helpers/webpFixtures.ts';
import { buildWebM } from '../helpers/webmFixtures.ts';

const telegramStatic = STICKER_SPECS['telegram-static'];
const telegramVideo = STICKER_SPECS['telegram-video'];
const whatsappStatic = STICKER_SPECS['whatsapp-static'];
const whatsappAnimated = STICKER_SPECS['whatsapp-animated'];
const tray = STICKER_SPECS['whatsapp-tray'];

function codes(issues: readonly { code: ComplianceCode }[]): ComplianceCode[] {
  return issues.map((issue) => issue.code);
}

/** A 90-frame, 3 s animation: the largest export the app will ever produce. */
function maximalAnimation(size = 512) {
  return buildAnimatedWebP({
    width: size,
    height: size,
    frames: Array.from({ length: 90 }, () => ({ durationMs: 33 })),
  });
}

function pngFixture(width: number, height: number, colorType = 6): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false); // IHDR length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  bytes[24] = 8; // bit depth
  bytes[25] = colorType;
  return bytes;
}

describe('probeOutput', () => {
  it('normalises a still WebP', () => {
    const probe = probeOutput(buildSimpleLossyWebP(512, 288), telegramStatic);
    expect(probe).toMatchObject({ width: 512, height: 288, isAnimated: false, frameCount: 1, durationMs: null });
  });

  it('normalises an animated WebP, deriving its frame rate', () => {
    const probe = probeOutput(maximalAnimation(), whatsappAnimated);
    expect(probe.isAnimated).toBe(true);
    expect(probe.frameCount).toBe(90);
    expect(probe.durationMs).toBe(2970);
    expect(probe.frameRate).toBeCloseTo(30.3, 1);
  });

  it('normalises a WebM', () => {
    const probe = probeOutput(buildWebM({ width: 512, height: 288 }), telegramVideo);
    expect(probe).toMatchObject({ width: 512, height: 288, codec: 'V_VP9', hasAudio: false });
  });

  it('normalises a PNG', () => {
    expect(probeOutput(pngFixture(96, 96), tray)).toMatchObject({ width: 96, height: 96, codec: 'PNG' });
  });
});

describe('checkCompliance: passing cases', () => {
  it('accepts a Telegram static sticker with one side at 512', () => {
    const report = checkCompliance(buildSimpleLossyWebP(512, 288), telegramStatic);
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('accepts a square WhatsApp static sticker', () => {
    const report = checkCompliance(buildLosslessWebP(512, 512), whatsappStatic);
    expect(report.ok).toBe(true);
  });

  it('accepts a 3 s 30 fps Telegram video sticker', () => {
    const report = checkCompliance(
      buildWebM({
        width: 512,
        height: 288,
        durationMs: 3000,
        frameDurationNs: 33_333_333,
        frameTimecodesMs: Array.from({ length: 90 }, (_, i) => Math.round((i * 1000) / 30)),
      }),
      telegramVideo,
    );
    expect(report.issues).toEqual([]);
  });

  it('accepts a maximal WhatsApp animated sticker', () => {
    expect(checkCompliance(maximalAnimation(), whatsappAnimated).ok).toBe(true);
  });

  it('accepts a 96x96 tray icon', () => {
    expect(checkCompliance(pngFixture(96, 96), tray).ok).toBe(true);
  });
});

describe('checkCompliance: dimension rules', () => {
  it('rejects a WhatsApp sticker that is not square', () => {
    const report = checkCompliance(buildSimpleLossyWebP(512, 288), whatsappStatic);
    expect(codes(report.issues)).toContain('bad-dimensions');
  });

  it('rejects a Telegram sticker with no side at exactly 512', () => {
    const report = checkCompliance(buildSimpleLossyWebP(500, 280), telegramStatic);
    expect(codes(report.issues)).toContain('bad-dimensions');
  });

  it('rejects a Telegram sticker whose short side is over 512', () => {
    const report = checkCompliance(buildSimpleLossyWebP(512, 600), telegramStatic);
    expect(codes(report.issues)).toContain('bad-dimensions');
  });

  it('rejects odd dimensions in a VP9 file', () => {
    const report = checkCompliance(buildWebM({ width: 512, height: 287 }), telegramVideo);
    expect(codes(report.issues)).toContain('odd-dimensions');
  });

  it('allows even non-square dimensions in a VP9 file', () => {
    const report = checkCompliance(buildWebM({ width: 512, height: 288 }), telegramVideo);
    expect(codes(report.issues)).not.toContain('odd-dimensions');
  });
});

describe('checkCompliance: size, animation and stream rules', () => {
  it('rejects a file over the byte limit and names both numbers', () => {
    const oversized = buildAnimatedWebP({
      width: 512,
      height: 512,
      frames: Array.from({ length: 4 }, () => ({ durationMs: 100 })),
    });
    const tinyLimit = { ...whatsappAnimated, maxBytes: 10 };
    const report = checkCompliance(oversized, tinyLimit);

    expect(codes(report.issues)).toContain('file-too-large');
    expect(report.issues[0]?.message).toMatch(/exceeds/);
  });

  it('rejects an animation longer than 3 seconds', () => {
    const tooLong = buildAnimatedWebP({
      width: 512,
      height: 512,
      frames: Array.from({ length: 100 }, () => ({ durationMs: 40 })), // 4 s
    });
    expect(codes(checkCompliance(tooLong, whatsappAnimated).issues)).toContain('too-long');
  });

  it('rejects a frame rate above the ceiling', () => {
    const fast = buildAnimatedWebP({
      width: 512,
      height: 512,
      frames: Array.from({ length: 60 }, () => ({ durationMs: 10 })), // 100 fps
    });
    expect(codes(checkCompliance(fast, whatsappAnimated).issues)).toContain('frame-rate-too-high');
  });

  it('tolerates the rounding error in a nominally 30 fps animation', () => {
    // 90 frames of 33 ms is 30.30 fps once rounded into the container.
    expect(codes(checkCompliance(maximalAnimation(), whatsappAnimated).issues)).not.toContain(
      'frame-rate-too-high',
    );
  });

  it('rejects a still image submitted to an animated target', () => {
    expect(codes(checkCompliance(buildLosslessWebP(512, 512), whatsappAnimated).issues)).toContain(
      'not-animated',
    );
  });

  it('rejects an animation submitted to a still target', () => {
    expect(codes(checkCompliance(maximalAnimation(), whatsappStatic).issues)).toContain(
      'unexpectedly-animated',
    );
  });

  it('rejects a video sticker carrying an audio track', () => {
    expect(codes(checkCompliance(buildWebM({ withAudioTrack: true }), telegramVideo).issues)).toContain(
      'audio-present',
    );
  });

  it('rejects a video sticker encoded as VP8', () => {
    expect(codes(checkCompliance(buildWebM({ codecId: 'V_VP8' }), telegramVideo).issues)).toContain(
      'wrong-codec',
    );
  });
});

describe('checkCompliance: unreadable input', () => {
  it('reports a container mismatch when a WebM is offered as a WebP', () => {
    const report = checkCompliance(buildWebM(), whatsappStatic);
    expect(codes(report.issues)).toEqual(['container-mismatch']);
    expect(report.probe).toBeNull();
  });

  it('reports a mismatch when a WebP is offered as a WebM', () => {
    expect(codes(checkCompliance(buildSimpleLossyWebP(512, 512), telegramVideo).issues)).toEqual([
      'container-mismatch',
    ]);
  });

  it('reports unreadable rather than throwing on a corrupt file', () => {
    const bytes = buildSimpleLossyWebP(512, 512);
    new DataView(bytes.buffer).setUint32(16, 0xffff, true); // chunk runs past EOF
    const report = checkCompliance(bytes, telegramStatic);

    expect(codes(report.issues)).toEqual(['unreadable']);
    expect(report.ok).toBe(false);
  });

  it('collects every violation rather than stopping at the first', () => {
    const report = checkCompliance(buildWebM({ width: 300, height: 287, withAudioTrack: true, codecId: 'V_VP8' }), telegramVideo);
    expect(codes(report.issues)).toEqual(
      expect.arrayContaining(['bad-dimensions', 'odd-dimensions', 'audio-present', 'wrong-codec']),
    );
  });
});
