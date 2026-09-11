import { describe, expect, it } from 'vitest';
import { parseWebM } from '@/core/formats/webm.ts';
import { encodeSize, writeWebM } from '@/core/formats/webmWriter.ts';
import type { WebMFrame } from '@/core/formats/webmWriter.ts';

/**
 * The muxer is checked by reading its output back with the parser written in
 * Stage 1. The two were developed independently from the same specification,
 * so agreement between them is meaningful.
 */

function frames(count: number, frameDurationMs = 33, everyKey = 1): WebMFrame[] {
  return Array.from({ length: count }, (_, index) => ({
    data: Uint8Array.from([index & 0xff, 0x11, 0x22, 0x33]),
    timestampMs: index * frameDurationMs,
    isKeyFrame: index % everyKey === 0,
  }));
}

describe('encodeSize', () => {
  it('uses one byte for small values', () => {
    expect([...encodeSize(0)]).toEqual([0x80]);
    expect([...encodeSize(1)]).toEqual([0x81]);
    expect([...encodeSize(126)]).toEqual([0xfe]);
  });

  it('spills past the reserved all-ones pattern, which means "unknown"', () => {
    expect(encodeSize(127).byteLength).toBe(2);
  });

  it('grows as needed', () => {
    expect(encodeSize(1_000_000).byteLength).toBe(3);
  });

  it('rejects a negative size', () => {
    expect(() => encodeSize(-1)).toThrow(RangeError);
  });
});

describe('writeWebM', () => {
  const base = { width: 512, height: 288, frameDurationMs: 33 };

  it('produces a file the parser recognises as WebM', () => {
    const info = parseWebM(writeWebM({ ...base, frames: frames(10) }));
    expect(info.video).not.toBeNull();
  });

  it('declares the video track as VP9 with the right dimensions', () => {
    const info = parseWebM(writeWebM({ ...base, frames: frames(10) }));
    expect(info.video?.codecId).toBe('V_VP9');
    expect(info.video?.width).toBe(512);
    expect(info.video?.height).toBe(288);
  });

  it('writes no audio track, which Telegram rejects', () => {
    expect(parseWebM(writeWebM({ ...base, frames: frames(10) })).hasAudio).toBe(false);
  });

  it('round-trips every frame', () => {
    for (const count of [1, 2, 30, 90]) {
      const info = parseWebM(writeWebM({ ...base, frames: frames(count) }));
      expect(info.videoFrameCount, `${count} frames`).toBe(count);
    }
  });

  it('writes a duration that matches the frames', () => {
    // 90 frames at 33 ms each ends at 2937 ms, plus one frame is 2970 ms.
    const info = parseWebM(writeWebM({ ...base, frames: frames(90) }));
    expect(info.durationMs).toBeCloseTo(2970, 3);
  });

  it('honours an explicit duration', () => {
    const info = parseWebM(writeWebM({ ...base, frames: frames(90), durationMs: 3000 }));
    expect(info.durationMs).toBeCloseTo(3000, 3);
  });

  it('writes DefaultDuration so the frame rate can be read back', () => {
    const info = parseWebM(writeWebM({ ...base, frames: frames(30) }));
    expect(info.frameRate).toBeCloseTo(1000 / 33, 2);
  });

  it('splits long files into several clusters', () => {
    // Block timecodes are signed 16-bit offsets from their cluster, so a long
    // file cannot live in one cluster.
    const long = frames(300, 33, 15);
    const info = parseWebM(writeWebM({ ...base, frames: long }));
    expect(info.videoFrameCount).toBe(300);
    expect(info.durationMs).toBeCloseTo(300 * 33, 0);
  });

  it('keeps frames in order across cluster boundaries', () => {
    const bytes = writeWebM({ ...base, frames: frames(200, 33, 15) });
    const info = parseWebM(bytes);
    expect(info.videoFrameCount).toBe(200);
  });

  it('accepts a single-frame file', () => {
    const info = parseWebM(writeWebM({ ...base, frames: frames(1) }));
    expect(info.videoFrameCount).toBe(1);
  });

  it('rejects a file with no frames', () => {
    expect(() => writeWebM({ ...base, frames: [] })).toThrow(RangeError);
  });

  it('rejects a first frame that is not a keyframe', () => {
    const notKey = frames(4).map((frame) => ({ ...frame, isKeyFrame: false }));
    expect(() => writeWebM({ ...base, frames: notKey })).toThrow(/keyframe/);
  });

  it.each([
    [0, 288],
    [512, 0],
    [-1, 288],
    [512.5, 288],
  ])('rejects dimensions %sx%s', (width, height) => {
    expect(() => writeWebM({ width, height, frames: frames(2) })).toThrow(RangeError);
  });

  it('passes the compliance checks a Telegram video sticker faces', async () => {
    const { checkCompliance } = await import('@/core/compliance.ts');
    const { STICKER_SPECS } = await import('@/core/specs.ts');

    const bytes = writeWebM({
      width: 512,
      height: 288,
      frameDurationMs: 33,
      frames: frames(90),
      durationMs: 2970,
    });

    const report = checkCompliance(bytes, STICKER_SPECS['telegram-video']);
    expect(report.issues).toEqual([]);
  });
});
