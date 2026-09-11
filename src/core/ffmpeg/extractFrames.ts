import type { FramePlan } from '../framePlan.ts';
import type { Rect, Size } from '../geometry.ts';
import { inputExtension } from '../videoSource.ts';
import { INPUT_FILE, buildExtractFramesArgs, frameFileNames } from './args.ts';
import type { LoadProgressHandler } from './loader.ts';
import { runFFmpeg } from './run.ts';

/**
 * Pulling the planned frames out of a video, already scaled and cropped.
 *
 * ffmpeg does the scaling rather than the canvas because it is the step that
 * has to read the source at all; the canvas then only ever draws text onto a
 * frame that is already the right size.
 */

export type ExtractStage = 'reading' | 'extracting' | 'decoding';

export interface ExtractProgress {
  readonly stage: ExtractStage;
  /** 0 to 1 within the stage, or null when the stage cannot report it. */
  readonly ratio: number | null;
}

export interface ExtractFramesOptions {
  readonly file: File;
  readonly plan: FramePlan;
  readonly size: Size;
  readonly crop?: Rect | null;
  readonly pad?: boolean;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ExtractProgress) => void;
  readonly onLoadProgress?: LoadProgressHandler;
}

export interface ExtractedFrames {
  /** Decoded frames, ready to draw. The caller owns them and must close them. */
  readonly frames: readonly ImageBitmap[];
  readonly size: Size;
  /** The plan as executed; `frameCount` may be lower if the source ran out. */
  readonly plan: FramePlan;
}

export function releaseFrames(frames: readonly ImageBitmap[]): void {
  for (const frame of frames) frame.close();
}

export async function extractFrames(options: ExtractFramesOptions): Promise<ExtractedFrames> {
  const { file, plan, size, crop = null, pad = false, signal, onProgress } = options;

  const inputFile = `${INPUT_FILE}${inputExtension(file.name)}`;

  onProgress?.({ stage: 'reading', ratio: null });
  const data = new Uint8Array(await file.arrayBuffer());

  onProgress?.({ stage: 'extracting', ratio: 0 });
  const { files } = await runFFmpeg({
    inputs: [{ name: inputFile, data }],
    args: buildExtractFramesArgs({ inputFile, plan, size, crop, pad }),
    outputs: frameFileNames(plan.frameCount),
    // A shorter source simply stops producing frames; that is not a failure.
    allowMissingOutputs: true,
    ...(signal ? { signal } : {}),
    ...(options.onLoadProgress ? { onLoadProgress: options.onLoadProgress } : {}),
    onProgress: ({ ratio }) => onProgress?.({ stage: 'extracting', ratio }),
    failureMessage:
      'Could not read this video. It may use a codec the in-browser decoder does not support',
  });

  if (files.length === 0) {
    throw new Error('ffmpeg produced no frames from this video');
  }

  onProgress?.({ stage: 'decoding', ratio: 0 });
  const frames: ImageBitmap[] = [];

  try {
    for (const [index, file_] of files.entries()) {
      frames.push(
        await createImageBitmap(new Blob([file_.data as BlobPart], { type: 'image/png' })),
      );
      onProgress?.({ stage: 'decoding', ratio: (index + 1) / files.length });
    }
  } catch (error) {
    releaseFrames(frames);
    throw error;
  }

  // A source that ran out early yields fewer frames, so the playback duration
  // has to shrink with them or the container would claim a length it does not
  // have.
  return {
    frames,
    size,
    plan: {
      ...plan,
      frameCount: frames.length,
      durationMs: (frames.length / plan.frameRate) * 1000,
      timestampsMs: plan.timestampsMs.slice(0, frames.length),
    },
  };
}
