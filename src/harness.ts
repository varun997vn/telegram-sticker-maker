/**
 * A browser entry point for driving the encoding core directly from tests.
 *
 * Frame extraction and encoding have no UI of their own yet, and even once
 * they do, a test that has to click through the editor to reach them cannot
 * make precise assertions about frame counts and timings. This page exposes
 * the core functions so the browser suite can call them with exact inputs.
 *
 * It is excluded from production builds: only a build with
 * INCLUDE_TEST_HARNESS set emits it. See vite.config.ts.
 */
import { encodeAnimatedSticker } from './core/encode/animatedSticker.ts';
import { encodeVp9WebM } from './core/encode/vp9Encoder.ts';
import { buildEncodeAnimatedWebPArgs, frameFileNames } from './core/ffmpeg/args.ts';
import { extractFrames, releaseFrames } from './core/ffmpeg/extractFrames.ts';
import { coreUrls, isFFmpegLoaded, loadFFmpeg, recentLogs, unloadFFmpeg } from './core/ffmpeg/loader.ts';
import { runFFmpeg } from './core/ffmpeg/run.ts';
import { planFrames } from './core/framePlan.ts';
import type { FramePlan } from './core/framePlan.ts';
import type { Size } from './core/geometry.ts';
import { getSpec } from './core/specs.ts';
import type { StickerTargetId } from './core/specs.ts';
import type { TextLayer } from './core/text/model.ts';
import { createTextLayer } from './core/text/operations.ts';
import { loadVideoSource } from './core/videoSource.ts';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The centre pixel of a frame, for checking frames arrive in order. */
function centrePixel(frame: ImageBitmap): [number, number, number, number] {
  const canvas = new OffscreenCanvas(frame.width, frame.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2D context available');
  context.drawImage(frame, 0, 0);

  const { data } = context.getImageData(Math.floor(frame.width / 2), Math.floor(frame.height / 2), 1, 1);
  return [data[0] as number, data[1] as number, data[2] as number, data[3] as number];
}

export interface HarnessApi {
  coreUrls(): { coreURL: string; wasmURL: string };
  isLoaded(): boolean;
  load(): Promise<{ loadedBytes: number | null }>;
  unload(): void;
  planFrames: typeof planFrames;
  /** Encode base64 PNG frames into a video, returning it as base64. */
  encodeFixture(options: {
    frames: string[];
    frameRate: number;
    format: 'webm' | 'webp';
    quality?: number;
  }): Promise<{ base64: string; byteLength: number }>;
  /** Run an arbitrary command line, reporting ffmpeg's own log on failure. */
  execRaw(options: {
    inputs: { name: string; base64: string }[];
    args: string[];
    outputs: string[];
  }): Promise<{ ok: boolean; error: string | null; outputs: { name: string; base64: string }[]; logs: string[] }>;
  /** Probe a base64 video the way the app probes a user's file. */
  probe(options: {
    base64: string;
    fileName: string;
    mimeType: string;
  }): Promise<{ width: number; height: number; durationMs: number }>;
  /** Run a full animated export and report what the encoder produced. */
  encodeAnimated(options: {
    base64: string;
    fileName: string;
    mimeType: string;
    targetId: StickerTargetId;
    fit?: 'contain' | 'cover';
    trimStartMs?: number;
    trimEndMs?: number;
    frameRate?: number;
    text?: Partial<Omit<TextLayer, 'id'>>;
  }): Promise<{
    base64: string;
    byteLength: number;
    maxBytes: number;
    width: number;
    height: number;
    frameRate: number;
    frameCount: number;
    quality: number;
    attempts: number;
    withinBudget: boolean;
    compliant: boolean;
    issues: string[];
    phases: string[];
    /** Frame rates the budget search actually tried, in order. */
    ratesTried: number[];
  }>;
  /** Extract frames from a base64 video and report what came back. */
  extract(options: {
    base64: string;
    fileName: string;
    mimeType: string;
    plan: FramePlan;
    size: Size;
    pad?: boolean;
    crop?: { x: number; y: number; width: number; height: number } | null;
  }): Promise<{
    frameCount: number;
    width: number;
    height: number;
    centres: [number, number, number, number][];
    stages: string[];
  }>;
}

const api: HarnessApi = {
  coreUrls: () => coreUrls(),
  isLoaded: () => isFFmpegLoaded(),

  async load() {
    let loadedBytes: number | null = null;
    await loadFFmpeg({ onLoadProgress: ({ loaded }) => (loadedBytes = loaded) });
    return { loadedBytes };
  },

  unload: () => unloadFFmpeg(),
  planFrames,

  async encodeFixture({ frames, frameRate, format, quality = 80 }) {
    const decoded = frames.map(fromBase64);

    if (format === 'webm') {
      // Built with the app's own encoder and muxer. ffmpeg then has to decode
      // the result during extraction, which is a strong check on the muxer.
      const first = await createImageBitmap(new Blob([decoded[0] as BlobPart], { type: 'image/png' }));
      const { width, height } = first;
      first.close();

      const data = await encodeVp9WebM({
        frames: decoded,
        width,
        height,
        frameRate,
        bitrate: 1_500_000,
      });
      return { base64: toBase64(data), byteLength: data.byteLength };
    }

    const names = frameFileNames(frames.length);
    const { files } = await runFFmpeg({
      inputs: names.map((name, index) => ({ name, data: decoded[index] as Uint8Array })),
      args: buildEncodeAnimatedWebPArgs({ frameRate, quality, outputFile: 'fixture.webp' }),
      outputs: ['fixture.webp'],
      failureMessage: 'Fixture encode failed',
    });

    const data = files[0]?.data;
    if (!data) throw new Error('Fixture encode produced nothing');
    return { base64: toBase64(data), byteLength: data.byteLength };
  },

  async execRaw({ inputs, args, outputs }) {
    try {
      const result = await runFFmpeg({
        inputs: inputs.map(({ name, base64 }) => ({ name, data: fromBase64(base64) })),
        args,
        outputs,
      });
      return {
        ok: true,
        error: null,
        outputs: result.files.map(({ name, data }) => ({ name, base64: toBase64(data) })),
        logs: [...recentLogs(60)],
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        outputs: [],
        logs: [...recentLogs(60)],
      };
    }
  },

  async probe({ base64, fileName, mimeType }) {
    const file = new File([fromBase64(base64) as BlobPart], fileName, { type: mimeType });
    const source = await loadVideoSource(file);
    return { width: source.width, height: source.height, durationMs: source.durationMs };
  },

  async encodeAnimated({
    base64,
    fileName,
    mimeType,
    targetId,
    fit = 'contain',
    trimStartMs,
    trimEndMs,
    frameRate,
    text,
  }) {
    const file = new File([fromBase64(base64) as BlobPart], fileName, { type: mimeType });
    const spec = getSpec(targetId);
    const source = await loadVideoSource(file);
    const phases: string[] = [];
    const ratesTried: number[] = [];

    const result = await encodeAnimatedSticker({
      source,
      spec,
      fit,
      layers: text ? [createTextLayer(text)] : [],
      ...(trimStartMs === undefined ? {} : { trimStartMs }),
      ...(trimEndMs === undefined ? {} : { trimEndMs }),
      ...(frameRate === undefined ? {} : { frameRate }),
      onProgress: ({ phase, frameRate: rate }) => {
        if (phases.at(-1) !== phase) phases.push(phase);
        if (rate !== undefined && ratesTried.at(-1) !== rate) ratesTried.push(rate);
      },
    });

    return {
      base64: toBase64(result.bytes),
      byteLength: result.byteLength,
      maxBytes: spec.maxBytes,
      width: result.size.width,
      height: result.size.height,
      frameRate: result.frameRate,
      frameCount: result.frameCount,
      quality: result.quality,
      attempts: result.attempts,
      withinBudget: result.withinBudget,
      compliant: result.compliance.ok,
      issues: result.compliance.issues.map((issue) => issue.message),
      phases,
      ratesTried,
    };
  },

  async extract({ base64, fileName, mimeType, plan, size, pad = false, crop = null }) {
    const file = new File([fromBase64(base64) as BlobPart], fileName, { type: mimeType });
    const stages: string[] = [];

    const result = await extractFrames({
      file,
      plan,
      size,
      pad,
      crop,
      onProgress: ({ stage }) => {
        if (stages.at(-1) !== stage) stages.push(stage);
      },
    });

    try {
      return {
        frameCount: result.frames.length,
        width: result.frames[0]?.width ?? 0,
        height: result.frames[0]?.height ?? 0,
        centres: result.frames.map(centrePixel),
        stages,
      };
    } finally {
      releaseFrames(result.frames);
    }
  },
};

declare global {
  interface Window {
    __sticker?: HarnessApi;
  }
}

window.__sticker = api;
document.getElementById('status')!.textContent = 'ready';
