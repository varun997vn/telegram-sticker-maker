import { getSpec } from '../specs.ts';
import {
  README_NAME,
  TELEGRAM_MANIFEST_NAME,
  TRAY_FILE_NAME,
  WHATSAPP_MANIFEST_NAME,
  buildReadme,
  buildTelegramManifest,
  buildWhatsAppContents,
  encodeJson,
  packIdentifier,
  stickerFileNameInPack,
} from './manifest.ts';
import { validatePack } from './model.ts';
import type { PackIssue, StickerPack } from './model.ts';
import { renderTrayIcon } from './trayIcon.ts';
import { createZip } from './zip.ts';
import type { ZipEntry } from './zip.ts';

/** Assembling a pack into a single downloadable archive. */

export interface BuiltPack {
  readonly bytes: Uint8Array;
  readonly blob: Blob;
  readonly fileName: string;
  readonly entryNames: readonly string[];
  readonly issues: readonly PackIssue[];
}

export interface BuildPackOptions {
  readonly pack: StickerPack;
  /** Skip the tray icon, which needs a canvas; used by tests in Node. */
  readonly includeTrayIcon?: boolean;
}

export async function buildPack(options: BuildPackOptions): Promise<BuiltPack> {
  const { pack, includeTrayIcon = true } = options;

  if (pack.stickers.length === 0) {
    throw new RangeError('A pack needs at least one sticker');
  }

  const entries: ZipEntry[] = [];
  const hasWhatsApp = pack.stickers.some(
    (sticker) => getSpec(sticker.targetId).platform === 'whatsapp',
  );
  const hasTelegram = pack.stickers.some(
    (sticker) => getSpec(sticker.targetId).platform === 'telegram',
  );

  for (const [index, sticker] of pack.stickers.entries()) {
    entries.push({ name: stickerFileNameInPack(sticker, index), data: sticker.bytes });
  }

  if (hasWhatsApp) {
    entries.push({ name: WHATSAPP_MANIFEST_NAME, data: encodeJson(buildWhatsAppContents(pack)) });

    if (includeTrayIcon) {
      const first = pack.stickers[0];
      if (first) entries.push({ name: TRAY_FILE_NAME, data: await renderTrayIcon(first) });
    }
  }

  if (hasTelegram) {
    entries.push({ name: TELEGRAM_MANIFEST_NAME, data: encodeJson(buildTelegramManifest(pack)) });
  }

  entries.push({ name: README_NAME, data: new TextEncoder().encode(buildReadme(pack)) });

  const bytes = createZip(entries);

  return {
    bytes,
    blob: new Blob([bytes as BlobPart], { type: 'application/zip' }),
    fileName: `${packIdentifier(pack)}.zip`,
    entryNames: entries.map((entry) => entry.name),
    issues: validatePack(pack),
  };
}
