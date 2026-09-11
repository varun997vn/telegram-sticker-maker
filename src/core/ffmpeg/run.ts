import { loadFFmpeg, recentLogs } from './loader.ts';
import type { LoadProgressHandler } from './loader.ts';

/**
 * One ffmpeg invocation, with its temporary files cleaned up afterwards.
 *
 * ffmpeg.wasm keeps a single in-memory filesystem for the life of the page, so
 * anything left behind both leaks memory across exports and risks being read
 * back as part of the next run. Every path this function writes is deleted in
 * a `finally`, whether the run succeeded, failed or was cancelled.
 */

export class FFmpegRunError extends Error {
  override readonly name = 'FFmpegRunError';
  readonly exitCode: number;
  readonly logs: readonly string[];

  constructor(message: string, exitCode: number, logs: readonly string[] = recentLogs()) {
    super(message);
    this.exitCode = exitCode;
    this.logs = logs;
  }
}

export interface FFmpegInput {
  readonly name: string;
  readonly data: Uint8Array;
}

export interface RunProgress {
  /** 0 to 1, as reported by ffmpeg; null when it cannot tell. */
  readonly ratio: number | null;
}

export interface RunFFmpegOptions {
  readonly inputs: readonly FFmpegInput[];
  readonly args: readonly string[];
  /** Files to read back once the run finishes. */
  readonly outputs: readonly string[];
  /**
   * Treat a missing output as the end of the list rather than an error — what
   * a frame sequence does when the source runs out early.
   */
  readonly allowMissingOutputs?: boolean;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: RunProgress) => void;
  readonly onLoadProgress?: LoadProgressHandler;
  /** Message used when ffmpeg exits non-zero. */
  readonly failureMessage?: string;
}

export interface RunFFmpegResult {
  /** Output files in the order they were requested, missing ones omitted. */
  readonly files: readonly FFmpegInput[];
}

export interface SessionExecOptions {
  readonly args: readonly string[];
  readonly outputs: readonly string[];
  readonly allowMissingOutputs?: boolean;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: RunProgress) => void;
  readonly failureMessage?: string;
}

/**
 * Several ffmpeg runs over one set of input files.
 *
 * The budget search re-encodes the same frames at a handful of quality
 * settings. Writing tens of megabytes of PNG into the in-memory filesystem
 * before each attempt would dominate the time spent actually encoding, so the
 * frames are written once and the session is disposed when the search ends.
 */
export interface FFmpegSession {
  write(inputs: readonly FFmpegInput[]): Promise<void>;
  exec(options: SessionExecOptions): Promise<RunFFmpegResult>;
  /** Delete every path this session wrote or produced. */
  dispose(): Promise<void>;
}

export interface OpenSessionOptions {
  readonly signal?: AbortSignal;
  readonly onLoadProgress?: LoadProgressHandler;
}

export async function openFFmpegSession(options: OpenSessionOptions = {}): Promise<FFmpegSession> {
  const ffmpeg = await loadFFmpeg({
    ...(options.onLoadProgress ? { onLoadProgress: options.onLoadProgress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const written = new Set<string>();
  let disposed = false;

  const assertOpen = () => {
    if (disposed) throw new Error('This ffmpeg session has already been disposed');
  };

  return {
    async write(inputs) {
      assertOpen();
      for (const input of inputs) {
        await ffmpeg.writeFile(input.name, input.data);
        written.add(input.name);
      }
    },

    async exec({
      args,
      outputs,
      allowMissingOutputs = false,
      signal,
      onProgress,
      failureMessage = 'ffmpeg failed',
    }) {
      assertOpen();
      throwIfAborted(signal);

      const handleProgress = ({ progress }: { progress: number }) => {
        onProgress?.({ ratio: Number.isFinite(progress) ? progress : null });
      };

      ffmpeg.on('progress', handleProgress);
      try {
        const code = await ffmpeg.exec([...args]);
        throwIfAborted(signal);

        if (code !== 0) {
          throw new FFmpegRunError(`${failureMessage} (exit code ${code})`, code);
        }

        const produced: FFmpegInput[] = [];
        for (const name of outputs) {
          let data: Uint8Array;
          try {
            data = (await ffmpeg.readFile(name)) as Uint8Array;
          } catch {
            if (allowMissingOutputs) break;
            throw new FFmpegRunError(
              `${failureMessage}: expected output "${name}" was not produced`,
              0,
            );
          }

          written.add(name);
          produced.push({ name, data });
        }

        return { files: produced };
      } finally {
        ffmpeg.off('progress', handleProgress);
      }
    },

    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const name of written) {
        await ffmpeg.deleteFile(name).catch(() => undefined);
      }
      written.clear();
    },
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Cancelled');
  }
}

/** A single ffmpeg run, with its temporary files cleaned up afterwards. */
export async function runFFmpeg(options: RunFFmpegOptions): Promise<RunFFmpegResult> {
  const session = await openFFmpegSession({
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onLoadProgress ? { onLoadProgress: options.onLoadProgress } : {}),
  });

  try {
    await session.write(options.inputs);
    return await session.exec({
      args: options.args,
      outputs: options.outputs,
      ...(options.allowMissingOutputs === undefined
        ? {}
        : { allowMissingOutputs: options.allowMissingOutputs }),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      ...(options.failureMessage ? { failureMessage: options.failureMessage } : {}),
    });
  } finally {
    await session.dispose();
  }
}
