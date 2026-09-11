import { formatBytes } from './budget.ts';
import { isPNG, isWebM, isWebP, parsePNG, parseWebM, parseWebP } from './formats/index.ts';
import type { StickerSpec } from './specs.ts';

/**
 * Checking an exported file against its target's rules by reading the file
 * itself, not by trusting the settings it was encoded with.
 */

export type ComplianceCode =
  | 'container-mismatch'
  | 'file-too-large'
  | 'bad-dimensions'
  | 'odd-dimensions'
  | 'not-animated'
  | 'unexpectedly-animated'
  | 'too-long'
  | 'frame-rate-too-high'
  | 'audio-present'
  | 'wrong-codec'
  | 'unreadable';

export interface ComplianceIssue {
  readonly code: ComplianceCode;
  readonly message: string;
}

export interface OutputProbe {
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly isAnimated: boolean;
  readonly durationMs: number | null;
  readonly frameCount: number;
  readonly frameRate: number | null;
  readonly hasAudio: boolean;
  readonly codec: string | null;
}

export interface ComplianceReport {
  readonly ok: boolean;
  readonly spec: StickerSpec;
  readonly probe: OutputProbe | null;
  readonly issues: readonly ComplianceIssue[];
}

/** Timecode arithmetic can land a hair over the limit; 1 ms is not a real overrun. */
const DURATION_TOLERANCE_MS = 1;

/** Derived frame rates carry rounding error, so allow half a frame per second. */
const FRAME_RATE_TOLERANCE = 0.5;

export function probeOutput(bytes: Uint8Array, spec: StickerSpec): OutputProbe {
  switch (spec.container) {
    case 'webp': {
      const info = parseWebP(bytes);
      const durationMs = info.isAnimated ? info.durationMs : null;
      return {
        byteLength: info.byteLength,
        width: info.width,
        height: info.height,
        isAnimated: info.isAnimated,
        durationMs,
        frameCount: info.frameCount,
        frameRate:
          durationMs !== null && durationMs > 0 ? (info.frameCount / durationMs) * 1000 : null,
        hasAudio: false,
        codec: info.isLossless ? 'VP8L' : 'VP8',
      };
    }
    case 'webm': {
      const info = parseWebM(bytes);
      return {
        byteLength: info.byteLength,
        width: info.video?.width ?? 0,
        height: info.video?.height ?? 0,
        isAnimated: info.videoFrameCount > 1,
        durationMs: info.durationMs,
        frameCount: info.videoFrameCount,
        frameRate: info.frameRate,
        hasAudio: info.hasAudio,
        codec: info.video?.codecId ?? null,
      };
    }
    case 'png': {
      const info = parsePNG(bytes);
      return {
        byteLength: info.byteLength,
        width: info.width,
        height: info.height,
        isAnimated: false,
        durationMs: null,
        frameCount: 1,
        frameRate: null,
        hasAudio: false,
        codec: 'PNG',
      };
    }
  }
}

function containerMatches(bytes: Uint8Array, spec: StickerSpec): boolean {
  switch (spec.container) {
    case 'webp':
      return isWebP(bytes);
    case 'webm':
      return isWebM(bytes);
    case 'png':
      return isPNG(bytes);
  }
}

function checkDimensions(probe: OutputProbe, spec: StickerSpec, issues: ComplianceIssue[]): void {
  const { width, height } = probe;

  if (width <= 0 || height <= 0) {
    issues.push({
      code: 'bad-dimensions',
      message: `Could not read valid dimensions (got ${width}x${height})`,
    });
    return;
  }

  if (spec.sizing === 'exact') {
    if (width !== spec.side || height !== spec.side) {
      issues.push({
        code: 'bad-dimensions',
        message: `${spec.label} must be exactly ${spec.side}x${spec.side}, got ${width}x${height}`,
      });
    }
  } else {
    const longest = Math.max(width, height);
    if (longest !== spec.side) {
      issues.push({
        code: 'bad-dimensions',
        message: `${spec.label} needs one side to be exactly ${spec.side}px, got ${width}x${height}`,
      });
    }
    if (Math.min(width, height) > spec.side) {
      issues.push({
        code: 'bad-dimensions',
        message: `Neither side may exceed ${spec.side}px, got ${width}x${height}`,
      });
    }
  }

  if (spec.requireEvenDimensions && (width % 2 !== 0 || height % 2 !== 0)) {
    issues.push({
      code: 'odd-dimensions',
      message: `${spec.container.toUpperCase()} needs even dimensions, got ${width}x${height}`,
    });
  }
}

function checkAnimation(probe: OutputProbe, spec: StickerSpec, issues: ComplianceIssue[]): void {
  if (spec.kind === 'static') {
    if (probe.isAnimated) {
      issues.push({
        code: 'unexpectedly-animated',
        message: `${spec.label} must be a still image but the file has ${probe.frameCount} frames`,
      });
    }
    return;
  }

  if (!probe.isAnimated || probe.frameCount < 2) {
    issues.push({
      code: 'not-animated',
      message: `${spec.label} must be animated but the file has ${probe.frameCount} frame(s)`,
    });
  }

  if (spec.maxDurationMs !== null && probe.durationMs !== null) {
    if (probe.durationMs > spec.maxDurationMs + DURATION_TOLERANCE_MS) {
      issues.push({
        code: 'too-long',
        message: `Animation runs ${(probe.durationMs / 1000).toFixed(2)}s, limit is ${(spec.maxDurationMs / 1000).toFixed(2)}s`,
      });
    }
  }

  if (spec.maxFrameRate !== null && probe.frameRate !== null) {
    if (probe.frameRate > spec.maxFrameRate + FRAME_RATE_TOLERANCE) {
      issues.push({
        code: 'frame-rate-too-high',
        message: `Frame rate is ${probe.frameRate.toFixed(1)} fps, limit is ${spec.maxFrameRate} fps`,
      });
    }
  }
}

export function checkCompliance(input: Uint8Array | ArrayBuffer, spec: StickerSpec): ComplianceReport {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const issues: ComplianceIssue[] = [];

  if (!containerMatches(bytes, spec)) {
    return {
      ok: false,
      spec,
      probe: null,
      issues: [
        {
          code: 'container-mismatch',
          message: `${spec.label} must be a ${spec.container.toUpperCase()} file`,
        },
      ],
    };
  }

  let probe: OutputProbe;
  try {
    probe = probeOutput(bytes, spec);
  } catch (error) {
    return {
      ok: false,
      spec,
      probe: null,
      issues: [
        {
          code: 'unreadable',
          message: error instanceof Error ? error.message : 'Could not read the exported file',
        },
      ],
    };
  }

  if (probe.byteLength > spec.maxBytes) {
    issues.push({
      code: 'file-too-large',
      message: `${formatBytes(probe.byteLength)} exceeds the ${formatBytes(spec.maxBytes)} limit for ${spec.label}`,
    });
  }

  checkDimensions(probe, spec, issues);
  checkAnimation(probe, spec, issues);

  if (probe.hasAudio && !spec.allowsAudio) {
    issues.push({ code: 'audio-present', message: 'Sticker files must not contain an audio stream' });
  }

  if (spec.container === 'webm' && probe.codec !== null && !probe.codec.includes('VP9')) {
    issues.push({
      code: 'wrong-codec',
      message: `Telegram video stickers must use VP9, found "${probe.codec}"`,
    });
  }

  return { ok: issues.length === 0, spec, probe, issues };
}
