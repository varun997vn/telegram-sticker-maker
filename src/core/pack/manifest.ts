import { baseName } from '../fileNames.ts';
import { getSpec } from '../specs.ts';
import type { PackSticker, StickerPack } from './model.ts';

/**
 * The metadata files that go into a pack archive.
 *
 * WhatsApp's `contents.json` follows the layout its sample sticker app
 * expects. Telegram has no file-based import for third-party tools — packs are
 * created by sending the files to @Stickers — so `telegram.json` is written as
 * a convenience index rather than a format Telegram ingests, and the README
 * says so plainly.
 */

/** A stable, file-system-safe identifier derived from the pack name. */
export function packIdentifier(pack: StickerPack): string {
  const slug = baseName(pack.name).toLowerCase();
  return slug.length > 0 ? slug : 'sticker-pack';
}

export function stickerFileNameInPack(sticker: PackSticker, index: number): string {
  const spec = getSpec(sticker.targetId);
  return `${String(index + 1).padStart(2, '0')}-${spec.id}.${spec.fileExtension}`;
}

export const TRAY_FILE_NAME = 'tray.png';
export const WHATSAPP_MANIFEST_NAME = 'contents.json';
export const TELEGRAM_MANIFEST_NAME = 'telegram.json';
export const README_NAME = 'README.txt';

export interface WhatsAppSticker {
  readonly image_file: string;
  readonly emojis: readonly string[];
}

export interface WhatsAppPack {
  readonly identifier: string;
  readonly name: string;
  readonly publisher: string;
  readonly tray_image_file: string;
  readonly image_data_version: string;
  readonly avoid_cache: boolean;
  readonly publisher_email: string;
  readonly publisher_website: string;
  readonly privacy_policy_website: string;
  readonly license_agreement_website: string;
  readonly animated_sticker_pack: boolean;
  readonly stickers: readonly WhatsAppSticker[];
}

export interface WhatsAppContents {
  readonly android_play_store_link: string;
  readonly ios_app_store_link: string;
  readonly sticker_packs: readonly WhatsAppPack[];
}

export function buildWhatsAppContents(pack: StickerPack): WhatsAppContents {
  const whatsappStickers = pack.stickers.filter(
    (sticker) => getSpec(sticker.targetId).platform === 'whatsapp',
  );

  const animated = whatsappStickers.some(
    (sticker) => getSpec(sticker.targetId).kind === 'animated',
  );

  return {
    android_play_store_link: '',
    ios_app_store_link: '',
    sticker_packs: [
      {
        identifier: packIdentifier(pack),
        name: pack.name,
        publisher: pack.publisher,
        tray_image_file: TRAY_FILE_NAME,
        image_data_version: '1',
        avoid_cache: false,
        publisher_email: '',
        publisher_website: '',
        privacy_policy_website: '',
        license_agreement_website: '',
        animated_sticker_pack: animated,
        stickers: whatsappStickers.map((sticker) => ({
          image_file: stickerFileNameInPack(sticker, pack.stickers.indexOf(sticker)),
          emojis: sticker.emojis,
        })),
      },
    ],
  };
}

export interface TelegramManifestSticker {
  readonly file: string;
  readonly emojis: readonly string[];
  readonly format: 'static' | 'video';
}

export interface TelegramManifest {
  readonly name: string;
  readonly author: string;
  readonly software: string;
  readonly note: string;
  readonly stickers: readonly TelegramManifestSticker[];
}

export function buildTelegramManifest(pack: StickerPack): TelegramManifest {
  const telegramStickers = pack.stickers.filter(
    (sticker) => getSpec(sticker.targetId).platform === 'telegram',
  );

  return {
    name: pack.name,
    author: pack.publisher,
    software: 'Sticker Maker',
    note: 'An index of the Telegram files in this archive. Telegram packs are created by sending these files to @Stickers; there is no file-based import for third-party tools.',
    stickers: telegramStickers.map((sticker) => ({
      file: stickerFileNameInPack(sticker, pack.stickers.indexOf(sticker)),
      emojis: sticker.emojis,
      format: getSpec(sticker.targetId).kind === 'animated' ? 'video' : 'static',
    })),
  };
}

export function buildReadme(pack: StickerPack): string {
  const telegram = pack.stickers.filter(
    (sticker) => getSpec(sticker.targetId).platform === 'telegram',
  );
  const whatsapp = pack.stickers.filter(
    (sticker) => getSpec(sticker.targetId).platform === 'whatsapp',
  );

  const lines = [
    pack.name,
    '='.repeat(pack.name.length),
    '',
    `${pack.stickers.length} sticker${pack.stickers.length === 1 ? '' : 's'} by ${pack.publisher}.`,
    'Made with Sticker Maker. Everything here was produced in the browser.',
    '',
  ];

  if (telegram.length > 0) {
    lines.push(
      'Telegram',
      '--------',
      `${telegram.length} file${telegram.length === 1 ? '' : 's'}, listed in ${TELEGRAM_MANIFEST_NAME}.`,
      '',
      'Open a chat with @Stickers in Telegram and send /newpack (still stickers)',
      'or /newvideo (video stickers), then send each file as a FILE rather than',
      'as a photo or video, so Telegram does not recompress it. Telegram asks',
      'for an emoji after each one.',
      '',
    );
  }

  if (whatsapp.length > 0) {
    lines.push(
      'WhatsApp',
      '--------',
      `${whatsapp.length} file${whatsapp.length === 1 ? '' : 's'}, described in ${WHATSAPP_MANIFEST_NAME}.`,
      '',
      'WhatsApp has no direct import for pack archives. Either add the stickers',
      'one at a time through a third-party sticker app, or drop this folder into',
      'the WhatsApp sample sticker app, whose contents.json this file matches.',
      `A pack needs between 3 and 30 stickers, and a ${TRAY_FILE_NAME} tray icon is included.`,
      '',
    );
  }

  return lines.join('\n');
}

/** JSON with stable key order and readable indentation. */
export function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}
