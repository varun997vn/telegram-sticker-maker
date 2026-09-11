import type { StickerSpec } from './specs.ts';

const TRAILING_EXTENSION = /\.[a-z0-9]{1,5}$/i;
const UNSAFE_CHARACTERS = /[^a-z0-9._-]+/gi;

/** The part of a file name before its extension, safe for use in a download. */
export function baseName(fileName: string): string {
  const withoutExtension = fileName.replace(TRAILING_EXTENSION, '');
  const cleaned = withoutExtension
    .replace(UNSAFE_CHARACTERS, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 48);

  return cleaned.length > 0 ? cleaned : 'sticker';
}

/** e.g. `holiday-photo-telegram-sticker.webp` */
export function stickerFileName(sourceFileName: string, spec: StickerSpec): string {
  return `${baseName(sourceFileName)}-${spec.id}.${spec.fileExtension}`;
}
