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
import { buildEncodeAnimatedWebPArgs, buildEncodeWebMArgs, frameFileNames } from './core/ffmpeg/args.ts';
import { extractFrames, releaseFrames } from './core/ffmpeg/extractFrames.ts';
import { coreUrls, isFFmpegLoaded, loadFFmpeg, recentLogs, unloadFFmpeg } from './core/ffmpeg/loader.ts';
import { runFFmpeg } from './core/ffmpeg/run.ts';
import { planFrames } from './core/framePlan.ts';
import type { FramePlan } from './core/framePlan.ts';
import type { Size } from './core/geometry.ts';
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
  /** Run the app's own WebM command line, so its arguments are exercised as shipped. */
  execRawWithWebMArgs(options: {
    inputs: { name: string; base64: string }[];
    frameRate: number;
    crf: number;
    deadline?: 'best' | 'good' | 'realtime';
    cpuUsed?: number;
  }): Promise<{ ok: boolean; error: string | null; outputs: { name: string; base64: string }[]; logs: string[] }>;
  /** Probe a base64 video the way the app probes a user's file. */
  probe(options: {
    base64: string;
    fileName: string;
    mimeType: string;
  }): Promise<{ width: number; height: number; durationMs: number }>;
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
    const names = frameFileNames(frames.length);
    const output = format === 'webm' ? 'fixture.webm' : 'fixture.webp';

    const args =
      format === 'webm'
        ? // `realtime` keeps a fixture encode to seconds rather than minutes;
          // the export path picks its own quality settings.
          buildEncodeWebMArgs({
            frameRate,
            crf: 40,
            deadline: 'realtime',
            cpuUsed: 8,
            outputFile: output,
          })
        : buildEncodeAnimatedWebPArgs({ frameRate, quality, outputFile: output });

    const { files } = await runFFmpeg({
      inputs: names.map((name, index) => ({ name, data: fromBase64(frames[index] as string) })),
      args,
      outputs: [output],
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

  async execRawWithWebMArgs({ inputs, frameRate, crf, deadline, cpuUsed }) {
    return await api.execRaw({
      inputs,
      args: buildEncodeWebMArgs({
        frameRate,
        crf,
        ...(deadline ? { deadline } : {}),
        ...(cpuUsed === undefined ? {} : { cpuUsed }),
        outputFile: 'clamped.webm',
      }),
      outputs: ['clamped.webm'],
    });
  },

  async probe({ base64, fileName, mimeType }) {
    const file = new File([fromBase64(base64) as BlobPart], fileName, { type: mimeType });
    const source = await loadVideoSource(file);
    return { width: source.width, height: source.height, durationMs: source.durationMs };
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
