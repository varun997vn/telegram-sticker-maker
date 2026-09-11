/**
 * Builders that emit real RIFF/WebP byte streams.
 *
 * The image payloads are not decodable pixel data — the parser under test only
 * reads container metadata — but every header, chunk size and padding byte is
 * laid out exactly as the format requires.
 */

function fourCC(tag: string): Uint8Array {
  if (tag.length !== 4) throw new Error(`FourCC must be 4 characters, got "${tag}"`);
  return Uint8Array.from([...tag].map((c) => c.charCodeAt(0)));
}

function uint32LE(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function uint24LE(value: number): Uint8Array {
  return Uint8Array.from([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff]);
}

function uint16LE(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/** A chunk with its FourCC, little-endian size and the odd-length pad byte. */
export function chunk(tag: string, payload: Uint8Array): Uint8Array {
  const padding = payload.byteLength % 2 === 1 ? new Uint8Array(1) : new Uint8Array(0);
  return concat([fourCC(tag), uint32LE(payload.byteLength), payload, padding]);
}

export function riff(chunks: readonly Uint8Array[]): Uint8Array {
  const body = concat(chunks);
  // The RIFF size covers "WEBP" plus every chunk.
  return concat([fourCC('RIFF'), uint32LE(4 + body.byteLength), fourCC('WEBP'), body]);
}

/** A lossy keyframe header: 3 tag bytes, the start code, then 14-bit dimensions. */
export function vp8Payload(width: number, height: number, extraBytes = 8): Uint8Array {
  return concat([
    Uint8Array.from([0x00, 0x00, 0x00]),
    Uint8Array.from([0x9d, 0x01, 0x2a]),
    uint16LE(width & 0x3fff),
    uint16LE(height & 0x3fff),
    new Uint8Array(extraBytes),
  ]);
}

export function vp8lPayload(width: number, height: number, hasAlpha = false): Uint8Array {
  // 0x2f signature, then 14 bits width-1, 14 bits height-1, 1 bit alpha, 3 bits version.
  const bits = (width - 1) | ((height - 1) << 14) | ((hasAlpha ? 1 : 0) << 28);
  const packed = new Uint8Array(4);
  new DataView(packed.buffer).setUint32(0, bits >>> 0, true);
  return concat([Uint8Array.from([0x2f]), packed, new Uint8Array(8)]);
}

export function buildSimpleLossyWebP(width: number, height: number): Uint8Array {
  return riff([chunk('VP8 ', vp8Payload(width, height))]);
}

export function buildLosslessWebP(width: number, height: number, hasAlpha = true): Uint8Array {
  return riff([chunk('VP8L', vp8lPayload(width, height, hasAlpha))]);
}

export interface Vp8xOptions {
  readonly width: number;
  readonly height: number;
  readonly hasAlpha?: boolean;
  readonly isAnimated?: boolean;
}

export function vp8xPayload(options: Vp8xOptions): Uint8Array {
  let flags = 0;
  if (options.hasAlpha) flags |= 0x10;
  if (options.isAnimated) flags |= 0x02;
  return concat([
    Uint8Array.from([flags, 0, 0, 0]),
    uint24LE(options.width - 1),
    uint24LE(options.height - 1),
  ]);
}

export interface AnimatedFrame {
  readonly durationMs: number;
  readonly width?: number;
  readonly height?: number;
}

export interface AnimatedWebPOptions {
  readonly width: number;
  readonly height: number;
  readonly frames: readonly AnimatedFrame[];
  readonly hasAlpha?: boolean;
  readonly loopCount?: number;
}

export function buildAnimatedWebP(options: AnimatedWebPOptions): Uint8Array {
  const { width, height, frames, hasAlpha = true, loopCount = 0 } = options;

  const anim = chunk(
    'ANIM',
    concat([Uint8Array.from([0, 0, 0, 0]), uint16LE(loopCount)]),
  );

  const frameChunks = frames.map((frame) => {
    const frameWidth = frame.width ?? width;
    const frameHeight = frame.height ?? height;
    const header = concat([
      uint24LE(0), // frame x / 2
      uint24LE(0), // frame y / 2
      uint24LE(frameWidth - 1),
      uint24LE(frameHeight - 1),
      uint24LE(frame.durationMs),
      Uint8Array.from([0]), // blend + dispose flags
    ]);
    return chunk('ANMF', concat([header, chunk('VP8 ', vp8Payload(frameWidth, frameHeight))]));
  });

  const alphaFlag = hasAlpha ? { hasAlpha: true } : {};
  return riff([
    chunk('VP8X', vp8xPayload({ width, height, isAnimated: true, ...alphaFlag })),
    anim,
    ...frameChunks,
  ]);
}
