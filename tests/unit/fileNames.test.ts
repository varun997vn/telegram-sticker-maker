import { describe, expect, it } from 'vitest';
import { baseName, stickerFileName } from '@/core/fileNames.ts';
import { STICKER_SPECS } from '@/core/specs.ts';

describe('baseName', () => {
  it.each([
    ['photo.png', 'photo'],
    ['holiday photo.JPEG', 'holiday-photo'],
    ['my.cat.webp', 'my.cat'],
    ['no-extension', 'no-extension'],
    ['emoji 🐱 cat.png', 'emoji-cat'],
    ['../../etc/passwd.png', 'etc-passwd'],
    ['a  b   c.gif', 'a-b-c'],
  ])('%s -> %s', (input, expected) => {
    expect(baseName(input)).toBe(expected);
  });

  it('falls back to a default when nothing usable survives', () => {
    expect(baseName('🐱.png')).toBe('sticker');
    expect(baseName('')).toBe('sticker');
    expect(baseName('...')).toBe('sticker');
  });

  it('truncates very long names', () => {
    expect(baseName(`${'a'.repeat(200)}.png`)).toHaveLength(48);
  });

  it('never emits a path separator', () => {
    for (const name of ['a/b.png', 'a\\b.png', '/etc/hosts.png']) {
      expect(baseName(name)).not.toMatch(/[/\\]/);
    }
  });
});

describe('stickerFileName', () => {
  it('names the target and uses the right extension', () => {
    expect(stickerFileName('cat.png', STICKER_SPECS['telegram-static'])).toBe(
      'cat-telegram-static.webp',
    );
    expect(stickerFileName('cat.png', STICKER_SPECS['telegram-video'])).toBe(
      'cat-telegram-video.webm',
    );
    expect(stickerFileName('cat.png', STICKER_SPECS['whatsapp-tray'])).toBe(
      'cat-whatsapp-tray.png',
    );
  });

  it('gives every target a distinct name for the same source', () => {
    const names = Object.values(STICKER_SPECS).map((spec) => stickerFileName('cat.png', spec));
    expect(new Set(names).size).toBe(names.length);
  });
});
