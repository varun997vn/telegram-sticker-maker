import { deflateSync } from 'node:zlib';

/**
 * A minimal RGBA PNG encoder, so the browser tests can feed real image files
 * through the pipeline without committing binary fixtures.
 */

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, payload: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from([...type].map((c) => c.charCodeAt(0)));
  const out = new Uint8Array(12 + payload.byteLength);
  const view = new DataView(out.buffer);

  view.setUint32(0, payload.byteLength, false);
  out.set(typeBytes, 4);
  out.set(payload, 8);

  const forCrc = new Uint8Array(4 + payload.byteLength);
  forCrc.set(typeBytes, 0);
  forCrc.set(payload, 4);
  view.setUint32(8 + payload.byteLength, crc32(forCrc), false);

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

export type PixelFn = (x: number, y: number) => readonly [number, number, number, number];

/** Encode RGBA pixels produced by `pixel` as an 8-bit RGBA PNG. */
export function encodePNG(width: number, height: number, pixel: PixelFn): Uint8Array {
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlacing

  // Each scanline is prefixed with its filter type; 0 means "none".
  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const at = rowStart + 1 + x * 4;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
      raw[at + 3] = a;
    }
  }

  return concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** Deterministic pseudo-random values, so fixtures are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A smooth gradient with an opaque disc on a transparent ground: compresses
 * well, and the transparent corners prove alpha survives the round trip.
 */
export function gradientWithAlpha(width: number, height: number): Uint8Array {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.45;

  return encodePNG(width, height, (x, y) => {
    const inside = (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
    if (!inside) return [0, 0, 0, 0];
    return [Math.round((x / width) * 255), Math.round((y / height) * 255), 128, 255];
  });
}

/** Dense noise: close to incompressible, so the quality search has to work. */
export function noise(width: number, height: number, seed = 1): Uint8Array {
  const random = mulberry32(seed);
  return encodePNG(width, height, () => [
    Math.floor(random() * 256),
    Math.floor(random() * 256),
    Math.floor(random() * 256),
    255,
  ]);
}

/** Four flat quadrants: trivially checkable pixel colours. */
export function quadrants(width: number, height: number): Uint8Array {
  return encodePNG(width, height, (x, y) => {
    const right = x >= width / 2;
    const bottom = y >= height / 2;
    if (!right && !bottom) return [255, 0, 0, 255];
    if (right && !bottom) return [0, 255, 0, 255];
    if (!right && bottom) return [0, 0, 255, 255];
    return [255, 255, 0, 255];
  });
}
