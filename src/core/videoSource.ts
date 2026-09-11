import type { Size } from './geometry.ts';
import { UnsupportedFileError } from './imageSource.ts';

/** A video the user has loaded, probed for the numbers the planner needs. */
export interface VideoSource {
  readonly kind: 'video';
  readonly file: File;
  readonly width: number;
  readonly height: number;
  readonly durationMs: number;
  readonly fileName: string;
  readonly fileType: string;
  readonly fileSize: number;
}

export const SUPPORTED_VIDEO_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'video/ogg',
  'image/gif',
] as const;

export const SUPPORTED_VIDEO_EXTENSIONS = [
  '.mp4',
  '.m4v',
  '.webm',
  '.mov',
  '.mkv',
  '.ogv',
  '.gif',
] as const;

export const VIDEO_ACCEPT = [...SUPPORTED_VIDEO_TYPES, ...SUPPORTED_VIDEO_EXTENSIONS].join(',');

/**
 * Writing the source into ffmpeg's in-memory filesystem costs its whole size
 * in RAM, so an oversized file is refused up front with a clear reason rather
 * than crashing the tab partway through an export.
 */
export const MAX_VIDEO_BYTES = 120 * 1024 * 1024;

/** How long to wait for a browser to report a video's metadata. */
const METADATA_TIMEOUT_MS = 15_000;

export function isSupportedVideoType(type: string, fileName = ''): boolean {
  if ((SUPPORTED_VIDEO_TYPES as readonly string[]).includes(type)) return true;
  const lower = fileName.toLowerCase();
  return SUPPORTED_VIDEO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Some containers — anything produced by MediaRecorder, most notably — report
 * an infinite duration until the video has been seeked to its end. Nudging the
 * playhead past the end forces the browser to work the real duration out.
 */
function resolveDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) {
    return Promise.resolve(video.duration);
  }

  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('durationchange', onChange);
      video.currentTime = 0;
      resolve(Number.isFinite(video.duration) ? video.duration : 0);
    };

    const onChange = () => {
      if (Number.isFinite(video.duration)) done();
    };

    video.addEventListener('durationchange', onChange);
    video.currentTime = Number.MAX_SAFE_INTEGER;
    setTimeout(done, 3000);
  });
}

async function probe(file: File): Promise<Size & { durationMs: number }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('The browser did not report this video’s details in time')),
        METADATA_TIMEOUT_MS,
      );

      video.addEventListener(
        'loadedmetadata',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      video.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error(video.error?.message ?? 'The browser could not read this video'));
        },
        { once: true },
      );

      video.src = url;
    });

    const durationSeconds = await resolveDuration(video);

    return {
      width: video.videoWidth,
      height: video.videoHeight,
      durationMs: durationSeconds * 1000,
    };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function loadVideoSource(file: File): Promise<VideoSource> {
  if (!isSupportedVideoType(file.type, file.name)) {
    throw new UnsupportedFileError(
      `"${file.name}" is not a video format this tool can read (${file.type || 'unknown type'})`,
    );
  }

  if (file.size > MAX_VIDEO_BYTES) {
    throw new UnsupportedFileError(
      `"${file.name}" is ${(file.size / 1e6).toFixed(0)} MB. Videos up to ${MAX_VIDEO_BYTES / 1e6} MB can be processed in the browser; trim it first.`,
    );
  }

  let details: Size & { durationMs: number };
  try {
    details = await probe(file);
  } catch (error) {
    throw new UnsupportedFileError(
      `Could not read "${file.name}": ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  if (details.width === 0 || details.height === 0) {
    throw new UnsupportedFileError(`"${file.name}" does not contain a video track this browser can read`);
  }
  if (!(details.durationMs > 0)) {
    throw new UnsupportedFileError(`"${file.name}" has no readable duration`);
  }

  return {
    kind: 'video',
    file,
    width: details.width,
    height: details.height,
    durationMs: details.durationMs,
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
  };
}

/** The extension ffmpeg should see, which helps it pick a demuxer. */
export function inputExtension(fileName: string): string {
  const match = /\.([a-z0-9]{1,5})$/i.exec(fileName);
  return match ? `.${match[1]?.toLowerCase()}` : '.bin';
}
