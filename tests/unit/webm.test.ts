import { describe, expect, it } from 'vitest';
import { FormatParseError } from '@/core/formats/errors.ts';
import { isWebM, parseWebM } from '@/core/formats/webm.ts';
import { buildWebM, encodeSize } from '../helpers/webmFixtures.ts';

describe('encodeSize', () => {
  it('uses the shortest representation that is not the reserved all-ones value', () => {
    expect([...(encodeSize(0) as Uint8Array)]).toEqual([0x80]);
    expect([...(encodeSize(1) as Uint8Array)]).toEqual([0x81]);
    // 127 is the reserved "unknown size" pattern for a one-byte vint, so it
    // has to spill into two bytes.
    expect(encodeSize(127).byteLength).toBe(2);
    expect(encodeSize(126).byteLength).toBe(1);
  });
});

describe('isWebM', () => {
  it('accepts an EBML header', () => {
    expect(isWebM(buildWebM())).toBe(true);
  });

  it.each([
    ['an empty buffer', new Uint8Array(0)],
    ['a RIFF header', Uint8Array.from([0x52, 0x49, 0x46, 0x46])],
  ])('rejects %s', (_label, bytes) => {
    expect(isWebM(bytes)).toBe(false);
  });
});

describe('parseWebM', () => {
  it('reads the video track codec and pixel dimensions', () => {
    const info = parseWebM(buildWebM({ width: 512, height: 288, codecId: 'V_VP9' }));
    expect(info.video).not.toBeNull();
    expect(info.video?.codecId).toBe('V_VP9');
    expect(info.video?.width).toBe(512);
    expect(info.video?.height).toBe(288);
  });

  it('reads the duration through the timecode scale', () => {
    expect(parseWebM(buildWebM({ durationMs: 3000 })).durationMs).toBeCloseTo(3000, 3);
  });

  it('honours a non-default timecode scale', () => {
    const info = parseWebM(buildWebM({ durationMs: 2500, timecodeScaleNs: 100_000 }));
    expect(info.timecodeScaleNs).toBe(100_000);
    expect(info.durationMs).toBeCloseTo(2500, 3);
  });

  it('derives the frame rate from DefaultDuration', () => {
    const info = parseWebM(buildWebM({ frameDurationNs: 33_333_333 }));
    expect(info.frameRate).toBeCloseTo(30, 2);
    expect(info.video?.frameDurationMs).toBeCloseTo(33.333, 2);
  });

  it('falls back to frames over duration when DefaultDuration is absent', () => {
    const info = parseWebM(
      buildWebM({
        frameDurationNs: null,
        durationMs: 1000,
        frameTimecodesMs: Array.from({ length: 24 }, (_, i) => Math.round((i * 1000) / 24)),
      }),
    );
    expect(info.video?.frameDurationMs).toBeNull();
    expect(info.frameRate).toBeCloseTo(24, 5);
  });

  it('derives a duration from block timestamps when Info has none', () => {
    const info = parseWebM(
      buildWebM({ durationMs: null, frameTimecodesMs: [0, 33, 66, 99], frameDurationNs: 33_000_000 }),
    );
    expect(info.durationMs).toBeCloseTo(132, 3);
  });

  it('counts the video frames', () => {
    const timecodes = Array.from({ length: 90 }, (_, i) => Math.round((i * 1000) / 30));
    expect(parseWebM(buildWebM({ frameTimecodesMs: timecodes })).videoFrameCount).toBe(90);
  });

  it('reports a clean file as having no audio', () => {
    expect(parseWebM(buildWebM()).hasAudio).toBe(false);
  });

  it('detects a stray audio track', () => {
    expect(parseWebM(buildWebM({ withAudioTrack: true })).hasAudio).toBe(true);
  });

  it('counts only blocks belonging to the video track', () => {
    // The audio track is track 2; its blocks must not inflate the frame count.
    const info = parseWebM(buildWebM({ withAudioTrack: true, frameTimecodesMs: [0, 33, 66] }));
    expect(info.videoFrameCount).toBe(3);
  });

  it('reports the full file length', () => {
    const bytes = buildWebM();
    expect(parseWebM(bytes).byteLength).toBe(bytes.byteLength);
  });

  it('rejects bytes without an EBML signature', () => {
    expect(() => parseWebM(new Uint8Array(64))).toThrow(FormatParseError);
  });

  it('returns what it parsed rather than throwing on a truncated tail', () => {
    const bytes = buildWebM();
    const info = parseWebM(bytes.slice(0, bytes.byteLength - 5));
    expect(info.video?.width).toBe(512);
  });

  it('accepts an ArrayBuffer as well as a Uint8Array', () => {
    const bytes = buildWebM();
    expect(parseWebM(bytes.slice().buffer).video?.codecId).toBe('V_VP9');
  });
});
