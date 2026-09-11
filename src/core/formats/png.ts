import { FormatParseError } from './errors.ts';

/** Just enough PNG parsing to verify tray icons. */

export interface PNGInfo {
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly hasAlpha: boolean;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPNG(bytes: Uint8Array): boolean {
  if (bytes.byteLength < SIGNATURE.length) return false;
  return SIGNATURE.every((byte, index) => bytes[index] === byte);
}

export function parsePNG(input: Uint8Array | ArrayBuffer): PNGInfo {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

  if (!isPNG(bytes)) {
    throw new FormatParseError('Missing PNG signature');
  }
  if (bytes.byteLength < 33) {
    throw new FormatParseError('PNG is too short to contain an IHDR chunk');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ihdrType = String.fromCharCode(bytes[12] as number, bytes[13] as number, bytes[14] as number, bytes[15] as number);
  if (ihdrType !== 'IHDR') {
    throw new FormatParseError(`Expected IHDR as the first chunk, found "${ihdrType}"`);
  }

  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  const bitDepth = bytes[24] as number;
  const colorType = bytes[25] as number;

  return {
    byteLength: bytes.byteLength,
    width,
    height,
    bitDepth,
    colorType,
    // Colour types 4 (grey+alpha) and 6 (RGB+alpha) carry an alpha channel.
    hasAlpha: colorType === 4 || colorType === 6,
  };
}
