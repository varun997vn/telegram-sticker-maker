import { FFmpeg } from '@ffmpeg/ffmpeg';

/**
 * Lazy, single-instance access to ffmpeg.wasm.
 *
 * The core is roughly 32 MB, so it is never fetched until an export actually
 * needs it — still stickers go through the canvas and never touch this at all.
 * It is served from our own origin (see scripts/sync-ffmpeg-core.mjs) rather
 * than the CDN the library defaults to.
 *
 * The single-threaded core is deliberate: the multi-threaded one needs
 * SharedArrayBuffer, which needs COOP/COEP response headers, which GitHub
 * Pages cannot set.
 */

export interface FFmpegProgress {
  /** 0 to 1 for the current operation, as reported by ffmpeg. */
  readonly ratio: number;
}

export interface LoadProgress {
  /** Bytes of the core downloaded so far, when the server reports a length. */
  readonly loaded: number;
  readonly total: number | null;
  readonly ratio: number | null;
}

export type LoadProgressHandler = (progress: LoadProgress) => void;

/** Where the synced core files live, relative to the deployed base path. */
export function coreUrls(base: string = import.meta.env.BASE_URL): {
  coreURL: string;
  wasmURL: string;
} {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return {
    coreURL: `${prefix}ffmpeg/ffmpeg-core.js`,
    wasmURL: `${prefix}ffmpeg/ffmpeg-core.wasm`,
  };
}

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;
const logLines: string[] = [];

/** The last lines ffmpeg logged, for diagnosing a failed run. */
export function recentLogs(count = 40): readonly string[] {
  return logLines.slice(-count);
}

export function isFFmpegLoaded(): boolean {
  return instance !== null;
}

/**
 * Fetch the wasm ourselves so download progress can be reported. The library
 * would otherwise fetch it opaquely, leaving a 32 MB wait with no feedback.
 */
async function fetchWasm(url: string, onProgress?: LoadProgressHandler): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download the video engine (${response.status} from ${url})`);
  }

  const declared = response.headers.get('content-length');
  const total = declared === null ? null : Number(declared);

  if (!response.body || total === null || !Number.isFinite(total)) {
    const buffer = await response.arrayBuffer();
    onProgress?.({ loaded: buffer.byteLength, total: null, ratio: null });
    return URL.createObjectURL(new Blob([buffer], { type: 'application/wasm' }));
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.({ loaded, total, ratio: loaded / total });
  }

  return URL.createObjectURL(new Blob(chunks as BlobPart[], { type: 'application/wasm' }));
}

export interface LoadOptions {
  readonly onLoadProgress?: LoadProgressHandler;
  readonly signal?: AbortSignal;
}

/**
 * Load ffmpeg once and reuse it.
 *
 * Concurrent callers share a single load; a failed load is discarded so the
 * next attempt can retry rather than being stuck with a rejected promise.
 */
export async function loadFFmpeg(options: LoadOptions = {}): Promise<FFmpeg> {
  if (instance) return instance;
  if (loading) return await loading;

  loading = (async () => {
    const { coreURL, wasmURL } = coreUrls();
    const ffmpeg = new FFmpeg();

    ffmpeg.on('log', ({ message }) => {
      logLines.push(message);
      if (logLines.length > 200) logLines.splice(0, logLines.length - 200);
    });

    const wasmBlobUrl = await fetchWasm(wasmURL, options.onLoadProgress);

    try {
      await ffmpeg.load(
        { coreURL, wasmURL: wasmBlobUrl },
        options.signal ? { signal: options.signal } : {},
      );
    } finally {
      URL.revokeObjectURL(wasmBlobUrl);
    }

    instance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await loading;
  } catch (error) {
    // Let the next caller try again instead of caching the failure forever.
    loading = null;
    throw error;
  } finally {
    if (instance) loading = null;
  }
}

/** Drop the instance, so the next call starts from a clean core. */
export function unloadFFmpeg(): void {
  instance?.terminate();
  instance = null;
  loading = null;
  logLines.length = 0;
}
