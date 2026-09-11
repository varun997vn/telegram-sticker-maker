import type { Size } from './geometry.ts';

/** An image the user has loaded, decoded and ready to draw. */
export interface ImageSource {
  readonly kind: 'image';
  readonly bitmap: ImageBitmap;
  readonly width: number;
  readonly height: number;
  readonly fileName: string;
  readonly fileType: string;
  readonly fileSize: number;
}

export const SUPPORTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
] as const;

export const SUPPORTED_IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.avif',
  '.bmp',
] as const;

/** The `accept` attribute for the file picker. */
export const IMAGE_ACCEPT = [...SUPPORTED_IMAGE_TYPES, ...SUPPORTED_IMAGE_EXTENSIONS].join(',');

export class UnsupportedFileError extends Error {
  override readonly name = 'UnsupportedFileError';
}

export function isSupportedImageType(type: string, fileName = ''): boolean {
  if ((SUPPORTED_IMAGE_TYPES as readonly string[]).includes(type)) return true;
  // Some browsers hand over an empty type for dragged files; fall back to the
  // extension rather than rejecting a perfectly good PNG.
  const lower = fileName.toLowerCase();
  return SUPPORTED_IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

async function decode(file: File): Promise<ImageBitmap> {
  try {
    // `from-image` applies the EXIF orientation, so a phone photo is not
    // silently rotated 90 degrees in the sticker.
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(file);
  }
}

export async function loadImageSource(file: File): Promise<ImageSource> {
  if (!isSupportedImageType(file.type, file.name)) {
    throw new UnsupportedFileError(
      `"${file.name}" is not an image format this tool can read (${file.type || 'unknown type'})`,
    );
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await decode(file);
  } catch (error) {
    throw new UnsupportedFileError(
      `Could not decode "${file.name}": ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  if (bitmap.width === 0 || bitmap.height === 0) {
    bitmap.close();
    throw new UnsupportedFileError(`"${file.name}" decoded to an empty image`);
  }

  return {
    kind: 'image',
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
  };
}

export function sourceSize(source: ImageSource): Size {
  return { width: source.width, height: source.height };
}

export function releaseImageSource(source: ImageSource): void {
  source.bitmap.close();
}
