import { describe, expect, it } from 'vitest';
import {
  IMAGE_ACCEPT,
  SUPPORTED_IMAGE_EXTENSIONS,
  SUPPORTED_IMAGE_TYPES,
  isSupportedImageType,
} from '@/core/imageSource.ts';

describe('isSupportedImageType', () => {
  it.each(SUPPORTED_IMAGE_TYPES)('accepts the %s MIME type', (type) => {
    expect(isSupportedImageType(type)).toBe(true);
  });

  it.each(SUPPORTED_IMAGE_EXTENSIONS)('accepts a file named with %s when the type is missing', (extension) => {
    expect(isSupportedImageType('', `photo${extension}`)).toBe(true);
  });

  it('is case insensitive about extensions', () => {
    expect(isSupportedImageType('', 'PHOTO.PNG')).toBe(true);
  });

  it.each([
    ['video/mp4', 'clip.mp4'],
    ['application/pdf', 'doc.pdf'],
    ['', 'archive.zip'],
    ['', 'notanimage'],
  ])('rejects %s / %s', (type, name) => {
    expect(isSupportedImageType(type, name)).toBe(false);
  });
});

describe('IMAGE_ACCEPT', () => {
  it('lists both MIME types and extensions for the file picker', () => {
    expect(IMAGE_ACCEPT).toContain('image/png');
    expect(IMAGE_ACCEPT).toContain('.png');
  });
});
