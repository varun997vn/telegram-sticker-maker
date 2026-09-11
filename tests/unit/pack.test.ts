import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildPack } from '@/core/pack/buildPack.ts';
import {
  buildReadme,
  buildTelegramManifest,
  buildWhatsAppContents,
  packIdentifier,
  stickerFileNameInPack,
} from '@/core/pack/manifest.ts';
import {
  DEFAULT_EMOJI,
  EMPTY_PACK,
  PACK_LIMITS,
  addSticker,
  moveSticker,
  packIsInstallable,
  parseEmojis,
  removeSticker,
  resetPackIds,
  setStickerEmojis,
  validatePack,
} from '@/core/pack/model.ts';
import type { StickerPack } from '@/core/pack/model.ts';
import type { StickerTargetId } from '@/core/specs.ts';

let workDir: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'sticker-pack-'));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetPackIds();
});

function withStickers(
  count: number,
  targetId: StickerTargetId = 'whatsapp-static',
  bytes = 1000,
): StickerPack {
  let pack = EMPTY_PACK;
  for (let i = 0; i < count; i += 1) {
    pack = addSticker(pack, {
      targetId,
      bytes: new Uint8Array(bytes).fill(i + 1),
      width: 512,
      height: 512,
      sourceName: `photo-${i + 1}.png`,
    });
  }
  return pack;
}

describe('pack contents', () => {
  it('adds stickers in order, each with a distinct id', () => {
    const pack = withStickers(3);
    expect(pack.stickers).toHaveLength(3);
    expect(new Set(pack.stickers.map((sticker) => sticker.id)).size).toBe(3);
  });

  it('gives a new sticker a default emoji', () => {
    expect(withStickers(1).stickers[0]?.emojis).toEqual([DEFAULT_EMOJI]);
  });

  it('removes by id', () => {
    const pack = withStickers(3);
    const id = pack.stickers[1]?.id as string;
    expect(removeSticker(pack, id).stickers.map((s) => s.sourceName)).toEqual([
      'photo-1.png',
      'photo-3.png',
    ]);
  });

  it('reorders', () => {
    const pack = withStickers(3);
    const last = pack.stickers[2]?.id as string;
    expect(moveSticker(pack, last, 'up').stickers.map((s) => s.sourceName)).toEqual([
      'photo-1.png',
      'photo-3.png',
      'photo-2.png',
    ]);
  });

  it('will not move past either end', () => {
    const pack = withStickers(2);
    expect(moveSticker(pack, pack.stickers[0]!.id, 'up')).toEqual(pack);
    expect(moveSticker(pack, pack.stickers[1]!.id, 'down')).toEqual(pack);
  });

  it('leaves the pack alone for an unknown id', () => {
    const pack = withStickers(2);
    expect(removeSticker(pack, 'nope')).toEqual(pack);
    expect(moveSticker(pack, 'nope', 'up')).toEqual(pack);
  });
});

describe('parseEmojis', () => {
  it('splits a run of emoji into separate entries', () => {
    expect(parseEmojis('😀😂')).toEqual(['😀', '😂']);
  });

  it('keeps a multi-code-point emoji whole', () => {
    // A family emoji is several code points joined by zero-width joiners.
    expect(parseEmojis('👩‍👩‍👧')).toEqual(['👩‍👩‍👧']);
  });

  it('caps at the platform limit', () => {
    expect(parseEmojis('😀😂😍🥳🎉')).toHaveLength(PACK_LIMITS.maxEmojisPerSticker);
  });

  it('drops whitespace', () => {
    expect(parseEmojis(' 😀  😂 ')).toEqual(['😀', '😂']);
  });

  it('returns nothing for an empty string', () => {
    expect(parseEmojis('   ')).toEqual([]);
  });
});

describe('setStickerEmojis', () => {
  it('replaces the emoji for one sticker', () => {
    const pack = withStickers(2);
    const updated = setStickerEmojis(pack, pack.stickers[0]!.id, '🎉🥳');
    expect(updated.stickers[0]?.emojis).toEqual(['🎉', '🥳']);
    expect(updated.stickers[1]?.emojis).toEqual([DEFAULT_EMOJI]);
  });

  it('falls back to the default rather than leaving a sticker with none', () => {
    const pack = withStickers(1);
    expect(setStickerEmojis(pack, pack.stickers[0]!.id, '').stickers[0]?.emojis).toEqual([
      DEFAULT_EMOJI,
    ]);
  });
});

describe('validatePack', () => {
  const codes = (pack: StickerPack) => validatePack(pack).map((issue) => issue.code);

  it('is happy with a well-formed pack', () => {
    expect(validatePack(withStickers(3))).toEqual([]);
    expect(packIsInstallable(withStickers(3))).toBe(true);
  });

  it('warns below the WhatsApp minimum without blocking the download', () => {
    const pack = withStickers(1);
    expect(codes(pack)).toContain('too-few');
    expect(packIsInstallable(pack)).toBe(true);
  });

  it('rejects more stickers than a pack can hold', () => {
    const pack = withStickers(PACK_LIMITS.maxStickers + 1);
    expect(codes(pack)).toContain('too-many');
    expect(packIsInstallable(pack)).toBe(false);
  });

  it('warns when still and animated stickers are mixed', () => {
    let pack = withStickers(2, 'whatsapp-static');
    pack = addSticker(pack, {
      targetId: 'whatsapp-animated',
      bytes: new Uint8Array(2000),
      width: 512,
      height: 512,
      sourceName: 'clip.webm',
    });
    expect(codes(pack)).toContain('mixed-kinds');
  });

  it('warns when platforms are mixed', () => {
    let pack = withStickers(2, 'whatsapp-static');
    pack = addSticker(pack, {
      targetId: 'telegram-static',
      bytes: new Uint8Array(2000),
      width: 512,
      height: 341,
      sourceName: 'photo.png',
    });
    expect(codes(pack)).toContain('mixed-platforms');
  });

  it('rejects a sticker over its own byte limit', () => {
    const pack = withStickers(3, 'whatsapp-static', 200_000);
    expect(codes(pack)).toContain('sticker-too-large');
    expect(packIsInstallable(pack)).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(codes({ ...withStickers(3), name: '  ' })).toContain('missing-name');
  });

  it('rejects an over-long name or publisher', () => {
    const long = 'x'.repeat(PACK_LIMITS.nameLength + 1);
    expect(codes({ ...withStickers(3), name: long })).toContain('name-too-long');
    expect(codes({ ...withStickers(3), publisher: long })).toContain('publisher-too-long');
  });
});

describe('manifests', () => {
  it('derives a file-safe identifier from the pack name', () => {
    expect(packIdentifier({ ...EMPTY_PACK, name: 'My Cat Pack!' })).toBe('my-cat-pack');
    expect(packIdentifier({ ...EMPTY_PACK, name: '🐱' })).toBe('sticker');
  });

  it('names sticker files in order, with their target', () => {
    const pack = withStickers(2);
    expect(stickerFileNameInPack(pack.stickers[0]!, 0)).toBe('01-whatsapp-static.webp');
    expect(stickerFileNameInPack(pack.stickers[1]!, 1)).toBe('02-whatsapp-static.webp');
  });

  it('builds contents.json in the shape WhatsApp expects', () => {
    const contents = buildWhatsAppContents(withStickers(3));
    const whatsappPack = contents.sticker_packs[0]!;

    expect(whatsappPack.identifier).toBe('my-stickers');
    expect(whatsappPack.tray_image_file).toBe('tray.png');
    expect(whatsappPack.stickers).toHaveLength(3);
    expect(whatsappPack.stickers[0]).toEqual({
      image_file: '01-whatsapp-static.webp',
      emojis: [DEFAULT_EMOJI],
    });
  });

  it('marks an animated pack as animated', () => {
    expect(buildWhatsAppContents(withStickers(3, 'whatsapp-animated')).sticker_packs[0]?.animated_sticker_pack).toBe(true);
    expect(buildWhatsAppContents(withStickers(3, 'whatsapp-static')).sticker_packs[0]?.animated_sticker_pack).toBe(false);
  });

  it('lists only WhatsApp files in contents.json', () => {
    let pack = withStickers(2, 'whatsapp-static');
    pack = addSticker(pack, {
      targetId: 'telegram-static',
      bytes: new Uint8Array(10),
      width: 512,
      height: 341,
      sourceName: 'x.png',
    });
    expect(buildWhatsAppContents(pack).sticker_packs[0]?.stickers).toHaveLength(2);
  });

  it('lists only Telegram files in telegram.json, and says what it is for', () => {
    let pack = withStickers(2, 'whatsapp-static');
    pack = addSticker(pack, {
      targetId: 'telegram-video',
      bytes: new Uint8Array(10),
      width: 512,
      height: 288,
      sourceName: 'clip.webm',
    });

    const manifest = buildTelegramManifest(pack);
    expect(manifest.stickers).toHaveLength(1);
    expect(manifest.stickers[0]?.format).toBe('video');
    expect(manifest.note).toMatch(/@Stickers/);
  });

  it('writes a readme that explains both routes when both are present', () => {
    let pack = withStickers(2, 'whatsapp-static');
    pack = addSticker(pack, {
      targetId: 'telegram-static',
      bytes: new Uint8Array(10),
      width: 512,
      height: 341,
      sourceName: 'x.png',
    });

    const readme = buildReadme(pack);
    expect(readme).toContain('@Stickers');
    expect(readme).toContain('contents.json');
    expect(readme).toContain(pack.name);
  });

  it('leaves out a platform section when that platform has no stickers', () => {
    expect(buildReadme(withStickers(2, 'whatsapp-static'))).not.toContain('@Stickers');
  });
});

describe('buildPack', () => {
  function extract(bytes: Uint8Array, name: string): string {
    const archive = join(workDir, `${name}.zip`);
    const target = join(workDir, name);
    writeFileSync(archive, bytes);
    execFileSync('unzip', ['-qq', '-o', archive, '-d', target]);
    return target;
  }

  it('produces an archive containing every sticker and manifest', async () => {
    const built = await buildPack({ pack: withStickers(3), includeTrayIcon: false });

    expect(built.entryNames).toEqual([
      '01-whatsapp-static.webp',
      '02-whatsapp-static.webp',
      '03-whatsapp-static.webp',
      'contents.json',
      'README.txt',
    ]);
  });

  it('writes an archive the system unzip can read back', async () => {
    const built = await buildPack({ pack: withStickers(3), includeTrayIcon: false });
    const dir = extract(built.bytes, 'pack');

    const contents = JSON.parse(readFileSync(join(dir, 'contents.json'), 'utf8')) as {
      sticker_packs: { stickers: { image_file: string }[] }[];
    };
    expect(contents.sticker_packs[0]?.stickers).toHaveLength(3);

    // Each listed file must actually be in the archive.
    for (const sticker of contents.sticker_packs[0]!.stickers) {
      expect(readFileSync(join(dir, sticker.image_file)).byteLength).toBeGreaterThan(0);
    }
  });

  it('names the archive after the pack', async () => {
    const pack = { ...withStickers(3), name: 'Holiday Cats' };
    expect((await buildPack({ pack, includeTrayIcon: false })).fileName).toBe('holiday-cats.zip');
  });

  it('omits contents.json when nothing targets WhatsApp', async () => {
    const built = await buildPack({ pack: withStickers(2, 'telegram-static'), includeTrayIcon: false });
    expect(built.entryNames).not.toContain('contents.json');
    expect(built.entryNames).toContain('telegram.json');
  });

  it('omits telegram.json when nothing targets Telegram', async () => {
    const built = await buildPack({ pack: withStickers(2, 'whatsapp-static'), includeTrayIcon: false });
    expect(built.entryNames).not.toContain('telegram.json');
  });

  it('reports the pack`s issues alongside the archive', async () => {
    const built = await buildPack({ pack: withStickers(1), includeTrayIcon: false });
    expect(built.issues.map((issue) => issue.code)).toContain('too-few');
  });

  it('refuses to build an empty pack', async () => {
    await expect(buildPack({ pack: EMPTY_PACK, includeTrayIcon: false })).rejects.toThrow(RangeError);
  });
});
