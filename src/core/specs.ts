/**
 * The rules every exported sticker has to satisfy.
 *
 * Sources:
 * - Telegram: https://core.telegram.org/stickers
 * - WhatsApp: third-party sticker pack requirements
 *
 * Byte limits are interpreted as decimal kilobytes (1 KB = 1000 bytes) rather
 * than kibibytes. Neither platform says which it means; the decimal reading is
 * the stricter one, so an export that passes here can never be rejected for
 * size. The cost is at most 2.4% of the available budget.
 */

export const STICKER_TARGET_IDS = [
  'telegram-static',
  'telegram-video',
  'whatsapp-static',
  'whatsapp-animated',
  'whatsapp-tray',
] as const;

export type StickerTargetId = (typeof STICKER_TARGET_IDS)[number];

export type Platform = 'telegram' | 'whatsapp';

export type StickerKind = 'static' | 'animated';

export type Container = 'webp' | 'webm' | 'png';

/**
 * How the output dimensions are derived from the source aspect ratio.
 *
 * - `exact`: the output is always `side x side`; a non-square source is padded
 *   with transparency or cropped, depending on the chosen fit mode.
 * - `longest-side`: the longest side is exactly `side` and the other side keeps
 *   the source aspect ratio. Preferred where the platform allows it, because
 *   transparent padding still costs bytes we would rather spend on quality.
 */
export type SizingRule = 'exact' | 'longest-side';

export interface StickerSpec {
  readonly id: StickerTargetId;
  readonly platform: Platform;
  readonly label: string;
  readonly kind: StickerKind;
  readonly container: Container;
  readonly mimeType: string;
  readonly fileExtension: string;
  /** Hard upper bound on the encoded file size, in bytes. */
  readonly maxBytes: number;
  readonly sizing: SizingRule;
  /** The pixel length the sizing rule is expressed in terms of. */
  readonly side: number;
  /** VP9 in a 4:2:0 pixel format cannot encode odd dimensions. */
  readonly requireEvenDimensions: boolean;
  /** Animation length cap in milliseconds; `null` for still images. */
  readonly maxDurationMs: number | null;
  /** Frame rate cap; `null` for still images. */
  readonly maxFrameRate: number | null;
  readonly supportsAlpha: boolean;
  /** No sticker format on either platform carries an audio stream. */
  readonly allowsAudio: false;
}

/**
 * Animation length is capped at 3 s for every animated target, including
 * WhatsApp, which would tolerate longer. Telegram's 3 s limit is the binding
 * one and a single edit should export to both platforms without a second pass.
 */
export const MAX_ANIMATION_MS = 3_000;

export const STICKER_SPECS: { readonly [K in StickerTargetId]: StickerSpec } = {
  'telegram-static': {
    id: 'telegram-static',
    platform: 'telegram',
    label: 'Telegram sticker',
    kind: 'static',
    container: 'webp',
    mimeType: 'image/webp',
    fileExtension: 'webp',
    maxBytes: 512_000,
    sizing: 'longest-side',
    side: 512,
    requireEvenDimensions: false,
    maxDurationMs: null,
    maxFrameRate: null,
    supportsAlpha: true,
    allowsAudio: false,
  },
  'telegram-video': {
    id: 'telegram-video',
    platform: 'telegram',
    label: 'Telegram video sticker',
    kind: 'animated',
    container: 'webm',
    mimeType: 'video/webm',
    fileExtension: 'webm',
    maxBytes: 256_000,
    sizing: 'longest-side',
    side: 512,
    requireEvenDimensions: true,
    maxDurationMs: MAX_ANIMATION_MS,
    maxFrameRate: 30,
    supportsAlpha: true,
    allowsAudio: false,
  },
  'whatsapp-static': {
    id: 'whatsapp-static',
    platform: 'whatsapp',
    label: 'WhatsApp sticker',
    kind: 'static',
    container: 'webp',
    mimeType: 'image/webp',
    fileExtension: 'webp',
    maxBytes: 100_000,
    sizing: 'exact',
    side: 512,
    requireEvenDimensions: false,
    maxDurationMs: null,
    maxFrameRate: null,
    supportsAlpha: true,
    allowsAudio: false,
  },
  'whatsapp-animated': {
    id: 'whatsapp-animated',
    platform: 'whatsapp',
    label: 'WhatsApp animated sticker',
    kind: 'animated',
    container: 'webp',
    mimeType: 'image/webp',
    fileExtension: 'webp',
    maxBytes: 500_000,
    sizing: 'exact',
    side: 512,
    requireEvenDimensions: false,
    maxDurationMs: MAX_ANIMATION_MS,
    maxFrameRate: 30,
    supportsAlpha: true,
    allowsAudio: false,
  },
  'whatsapp-tray': {
    id: 'whatsapp-tray',
    platform: 'whatsapp',
    label: 'WhatsApp tray icon',
    kind: 'static',
    container: 'png',
    mimeType: 'image/png',
    fileExtension: 'png',
    maxBytes: 50_000,
    sizing: 'exact',
    side: 96,
    requireEvenDimensions: false,
    maxDurationMs: null,
    maxFrameRate: null,
    supportsAlpha: true,
    allowsAudio: false,
  },
};

export const ALL_SPECS: readonly StickerSpec[] = STICKER_TARGET_IDS.map((id) => STICKER_SPECS[id]);

export function getSpec(id: StickerTargetId): StickerSpec {
  return STICKER_SPECS[id];
}

export function isStickerTargetId(value: string): value is StickerTargetId {
  return (STICKER_TARGET_IDS as readonly string[]).includes(value);
}

/** The targets a user picks between; the tray icon is generated by pack export. */
export const USER_SELECTABLE_TARGETS: readonly StickerTargetId[] = STICKER_TARGET_IDS.filter(
  (id) => id !== 'whatsapp-tray',
);

export function specsForKind(kind: StickerKind): readonly StickerSpec[] {
  return ALL_SPECS.filter((spec) => spec.kind === kind);
}
