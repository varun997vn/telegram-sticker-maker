import { formatBytes } from '../budget.ts';
import { getSpec } from '../specs.ts';
import type { StickerSpec, StickerTargetId } from '../specs.ts';

/** A finished sticker, kept in memory so several can be shipped together. */
export interface PackSticker {
  readonly id: string;
  readonly targetId: StickerTargetId;
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** Emoji the platforms associate with the sticker; at least one. */
  readonly emojis: readonly string[];
  /** Where it came from, for the gallery label. */
  readonly sourceName: string;
}

export interface StickerPack {
  readonly name: string;
  readonly publisher: string;
  readonly stickers: readonly PackSticker[];
}

export const PACK_LIMITS = {
  /** WhatsApp will not install a pack outside this range. */
  minStickers: 3,
  maxStickers: 30,
  nameLength: 128,
  publisherLength: 128,
  maxEmojisPerSticker: 3,
} as const;

export const DEFAULT_EMOJI = '😀';

export const EMPTY_PACK: StickerPack = {
  name: 'My stickers',
  publisher: 'Sticker Maker',
  stickers: [],
};

let counter = 0;

export function resetPackIds(): void {
  counter = 0;
}

function nextId(): string {
  counter += 1;
  return `sticker-${counter}`;
}

export interface NewSticker {
  readonly targetId: StickerTargetId;
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly sourceName: string;
  readonly emojis?: readonly string[];
}

export function addSticker(pack: StickerPack, sticker: NewSticker): StickerPack {
  return {
    ...pack,
    stickers: [
      ...pack.stickers,
      {
        id: nextId(),
        targetId: sticker.targetId,
        bytes: sticker.bytes,
        width: sticker.width,
        height: sticker.height,
        emojis: sticker.emojis ?? [DEFAULT_EMOJI],
        sourceName: sticker.sourceName,
      },
    ],
  };
}

export function removeSticker(pack: StickerPack, id: string): StickerPack {
  return { ...pack, stickers: pack.stickers.filter((sticker) => sticker.id !== id) };
}

export function moveSticker(
  pack: StickerPack,
  id: string,
  direction: 'up' | 'down',
): StickerPack {
  const index = pack.stickers.findIndex((sticker) => sticker.id === id);
  if (index === -1) return pack;

  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= pack.stickers.length) return pack;

  const stickers = [...pack.stickers];
  const [moved] = stickers.splice(index, 1);
  stickers.splice(target, 0, moved as PackSticker);
  return { ...pack, stickers };
}

/** Split a free-text field into individual emoji, capped at the platform limit. */
export function parseEmojis(input: string): string[] {
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(input)]
    .map((entry) => entry.segment.trim())
    .filter((segment) => segment.length > 0);

  return segments.slice(0, PACK_LIMITS.maxEmojisPerSticker);
}

export function setStickerEmojis(pack: StickerPack, id: string, input: string): StickerPack {
  const emojis = parseEmojis(input);
  return {
    ...pack,
    stickers: pack.stickers.map((sticker) =>
      sticker.id === id
        ? { ...sticker, emojis: emojis.length > 0 ? emojis : [DEFAULT_EMOJI] }
        : sticker,
    ),
  };
}

export type PackIssueCode =
  | 'too-few'
  | 'too-many'
  | 'mixed-kinds'
  | 'mixed-platforms'
  | 'name-too-long'
  | 'publisher-too-long'
  | 'missing-name'
  | 'sticker-too-large';

export interface PackIssue {
  readonly code: PackIssueCode;
  readonly message: string;
  /** Blocking for WhatsApp installation, or merely worth knowing. */
  readonly severity: 'error' | 'warning';
}

function specsIn(pack: StickerPack): StickerSpec[] {
  return pack.stickers.map((sticker) => getSpec(sticker.targetId));
}

/**
 * What is wrong with a pack, if anything.
 *
 * Reported rather than enforced: a single sticker is a perfectly reasonable
 * thing to export, even though WhatsApp will not install a pack of one.
 */
export function validatePack(pack: StickerPack): PackIssue[] {
  const issues: PackIssue[] = [];
  const specs = specsIn(pack);

  if (pack.name.trim().length === 0) {
    issues.push({ code: 'missing-name', message: 'The pack needs a name', severity: 'error' });
  }
  if (pack.name.length > PACK_LIMITS.nameLength) {
    issues.push({
      code: 'name-too-long',
      message: `The pack name must be ${PACK_LIMITS.nameLength} characters or fewer`,
      severity: 'error',
    });
  }
  if (pack.publisher.length > PACK_LIMITS.publisherLength) {
    issues.push({
      code: 'publisher-too-long',
      message: `The publisher name must be ${PACK_LIMITS.publisherLength} characters or fewer`,
      severity: 'error',
    });
  }

  if (pack.stickers.length < PACK_LIMITS.minStickers) {
    issues.push({
      code: 'too-few',
      message: `WhatsApp needs at least ${PACK_LIMITS.minStickers} stickers in a pack; this one has ${pack.stickers.length}`,
      severity: 'warning',
    });
  }
  if (pack.stickers.length > PACK_LIMITS.maxStickers) {
    issues.push({
      code: 'too-many',
      message: `A pack can hold at most ${PACK_LIMITS.maxStickers} stickers; this one has ${pack.stickers.length}`,
      severity: 'error',
    });
  }

  const kinds = new Set(specs.map((spec) => spec.kind));
  if (kinds.size > 1) {
    issues.push({
      code: 'mixed-kinds',
      message: 'WhatsApp packs must be all still or all animated, not a mixture',
      severity: 'warning',
    });
  }

  const platforms = new Set(specs.map((spec) => spec.platform));
  if (platforms.size > 1) {
    issues.push({
      code: 'mixed-platforms',
      message: 'This pack mixes Telegram and WhatsApp stickers; each platform will ignore the other’s files',
      severity: 'warning',
    });
  }

  for (const sticker of pack.stickers) {
    const spec = getSpec(sticker.targetId);
    if (sticker.bytes.byteLength > spec.maxBytes) {
      issues.push({
        code: 'sticker-too-large',
        message: `"${sticker.sourceName}" is ${formatBytes(sticker.bytes.byteLength)}, over the ${formatBytes(spec.maxBytes)} limit for ${spec.label}`,
        severity: 'error',
      });
    }
  }

  return issues;
}

export function packIsInstallable(pack: StickerPack): boolean {
  return validatePack(pack).every((issue) => issue.severity !== 'error');
}
