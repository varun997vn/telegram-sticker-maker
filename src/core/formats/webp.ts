import { FormatParseError } from './errors.ts';

/**
 * A reader for the parts of the WebP container the exporter cares about.
 *
 * Both platforms accept WebP but disagree on almost everything else, so tests
 * need to assert canvas size, alpha, animation length and frame count against
 * the bytes that were actually produced rather than against encoder settings
 * that may or may not have been honoured.
 *
 * Format reference: https://developers.google.com/speed/webp/docs/riff_container
 */

export interface WebPChunk {
  readonly fourCC: string;
  readonly offset: number;
  readonly byteLength: number;
}

export interface WebPInfo {
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly isAnimated: boolean;
  readonly hasAlpha: boolean;
  readonly isLossless: boolean;
  /** 1 for a still image, otherwise the number of ANMF frames. */
  readonly frameCount: number;
  /** Sum of the per-frame delays; 0 for a still image. */
  readonly durationMs: number;
  /** 0 means loop forever. */
  readonly loopCount: number;
  readonly chunks: readonly WebPChunk[];
}

const VP8X_ALPHA_FLAG = 0x10;
const VP8X_ANIMATION_FLAG = 0x02;

function readFourCC(bytes: Uint8Array, offset: number): string {
  let out = '';
  for (let i = 0; i < 4; i += 1) {
    out += String.fromCharCode(bytes[offset + i] as number);
  }
  return out;
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] as number) |
    ((bytes[offset + 1] as number) << 8) |
    ((bytes[offset + 2] as number) << 16)
  );
}

export function isWebP(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 12 && readFourCC(bytes, 0) === 'RIFF' && readFourCC(bytes, 8) === 'WEBP'
  );
}

export function parseWebP(input: Uint8Array | ArrayBuffer): WebPInfo {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

  if (bytes.byteLength < 12) {
    throw new FormatParseError(`Too short to be a WebP file: ${bytes.byteLength} bytes`);
  }
  if (!isWebP(bytes)) {
    throw new FormatParseError('Missing RIFF/WEBP signature');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffSize = view.getUint32(4, true);
  const end = Math.min(bytes.byteLength, riffSize + 8);

  const chunks: WebPChunk[] = [];
  let width = 0;
  let height = 0;
  let isAnimated = false;
  let hasAlpha = false;
  let isLossless = false;
  let frameCount = 0;
  let durationMs = 0;
  let loopCount = 0;

  let offset = 12;
  while (offset + 8 <= end) {
    const fourCC = readFourCC(bytes, offset);
    const payloadSize = view.getUint32(offset + 4, true);
    const payload = offset + 8;

    if (payload + payloadSize > bytes.byteLength) {
      throw new FormatParseError(
        `Chunk "${fourCC}" at offset ${offset} claims ${payloadSize} bytes but the file ends at ${bytes.byteLength}`,
      );
    }

    chunks.push({ fourCC, offset, byteLength: payloadSize });

    switch (fourCC) {
      case 'VP8X': {
        if (payloadSize < 10) throw new FormatParseError('VP8X chunk is truncated');
        const flags = bytes[payload] as number;
        hasAlpha = (flags & VP8X_ALPHA_FLAG) !== 0;
        isAnimated = (flags & VP8X_ANIMATION_FLAG) !== 0;
        // The canvas size is stored minus one, in 24-bit little-endian fields.
        width = readUint24LE(bytes, payload + 4) + 1;
        height = readUint24LE(bytes, payload + 7) + 1;
        break;
      }
      case 'ANIM': {
        if (payloadSize < 6) throw new FormatParseError('ANIM chunk is truncated');
        loopCount = view.getUint16(payload + 4, true);
        break;
      }
      case 'ANMF': {
        if (payloadSize < 16) throw new FormatParseError('ANMF chunk is truncated');
        frameCount += 1;
        durationMs += readUint24LE(bytes, payload + 12);
        break;
      }
      case 'ALPH': {
        hasAlpha = true;
        break;
      }
      case 'VP8 ': {
        // Simple lossy file: a keyframe header carries the real dimensions.
        if (payloadSize >= 10 && width === 0) {
          const startCodeOk =
            bytes[payload + 3] === 0x9d &&
            bytes[payload + 4] === 0x01 &&
            bytes[payload + 5] === 0x2a;
          if (!startCodeOk) throw new FormatParseError('VP8 keyframe start code is missing');
          width = view.getUint16(payload + 6, true) & 0x3fff;
          height = view.getUint16(payload + 8, true) & 0x3fff;
        }
        break;
      }
      case 'VP8L': {
        isLossless = true;
        if (payloadSize >= 5) {
          if (bytes[payload] !== 0x2f) throw new FormatParseError('VP8L signature byte is missing');
          const bits = view.getUint32(payload + 1, true);
          if (width === 0) {
            width = (bits & 0x3fff) + 1;
            height = ((bits >>> 14) & 0x3fff) + 1;
          }
          // Bit 28 marks the presence of a meaningful alpha channel.
          if (((bits >>> 28) & 1) === 1) hasAlpha = true;
        }
        break;
      }
      default:
        break;
    }

    // Chunk payloads are padded to an even length.
    offset = payload + payloadSize + (payloadSize % 2);
  }

  if (width === 0 || height === 0) {
    throw new FormatParseError('No chunk in the file declared the image dimensions');
  }

  return {
    byteLength: bytes.byteLength,
    width,
    height,
    isAnimated,
    hasAlpha,
    isLossless,
    frameCount: isAnimated ? frameCount : 1,
    durationMs: isAnimated ? durationMs : 0,
    loopCount,
    chunks,
  };
}
