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

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Cancelled');
  }
}

export async function runFFmpeg(options: RunFFmpegOptions): Promise<RunFFmpegResult> {
  const {
    inputs,
    args,
    outputs,
    allowMissingOutputs = false,
    signal,
    onProgress,
    failureMessage = 'ffmpeg failed',
  } = options;

  const ffmpeg = await loadFFmpeg({
    ...(options.onLoadProgress ? { onLoadProgress: options.onLoadProgress } : {}),
    ...(signal ? { signal } : {}),
  });
  throwIfAborted(signal);

  const handleProgress = ({ progress }: { progress: number }) => {
    onProgress?.({ ratio: Number.isFinite(progress) ? progress : null });
  };

  const written = new Set<string>();
  const produced: FFmpegInput[] = [];

  try {
    for (const input of inputs) {
      await ffmpeg.writeFile(input.name, input.data);
      written.add(input.name);
      throwIfAborted(signal);
    }

    ffmpeg.on('progress', handleProgress);
    const code = await ffmpeg.exec([...args]);
    throwIfAborted(signal);

    if (code !== 0) {
      throw new FFmpegRunError(`${failureMessage} (exit code ${code})`, code);
    }

    for (const name of outputs) {
      let data: Uint8Array;
      try {
        data = (await ffmpeg.readFile(name)) as Uint8Array;
      } catch (error) {
        if (allowMissingOutputs) break;
        throw new FFmpegRunError(
          `${failureMessage}: expected output "${name}" was not produced`,
          0,
          recentLogs(),
        );
      }

      written.add(name);
      produced.push({ name, data });
      throwIfAborted(signal);
    }

    return { files: produced };
  } finally {
    ffmpeg.off('progress', handleProgress);
    for (const name of written) {
      await ffmpeg.deleteFile(name).catch(() => undefined);
    }
  }
}
