import {
  IMAGE_ACCEPT,
  isSupportedImageType,
  loadImageSource,
  releaseImageSource,
  UnsupportedFileError,
} from './imageSource.ts';
import type { ImageSource } from './imageSource.ts';
import { VIDEO_ACCEPT, isSupportedVideoType, loadVideoSource } from './videoSource.ts';
import type { VideoSource } from './videoSource.ts';

/** Anything the editor can work from. */
export type StickerSource = ImageSource | VideoSource;

export const SOURCE_ACCEPT = `${IMAGE_ACCEPT},${VIDEO_ACCEPT}`;

export function isSupportedSource(type: string, fileName = ''): boolean {
  return isSupportedImageType(type, fileName) || isSupportedVideoType(type, fileName);
}

export async function loadSource(file: File): Promise<StickerSource> {
  if (isSupportedImageType(file.type, file.name)) {
    return await loadImageSource(file);
  }
  if (isSupportedVideoType(file.type, file.name)) {
    return await loadVideoSource(file);
  }

  throw new UnsupportedFileError(
    `"${file.name}" is not an image or video this tool can read (${file.type || 'unknown type'})`,
  );
}

export function releaseSource(source: StickerSource): void {
  if (source.kind === 'image') releaseImageSource(source);
}

export function isVideo(source: StickerSource): source is VideoSource {
  return source.kind === 'video';
}

/** A one-line description of the loaded file, for the UI. */
export function describeSource(source: StickerSource): string {
  const dimensions = `${source.width}x${source.height}`;
  return source.kind === 'video'
    ? `${source.fileName} — ${dimensions}, ${(source.durationMs / 1000).toFixed(1)}s`
    : `${source.fileName} — ${dimensions}`;
}
