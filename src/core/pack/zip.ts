/**
 * A minimal ZIP writer.
 *
 * Everything a sticker pack contains — WebP, WebM, PNG — is already
 * compressed, so entries are stored rather than deflated. That keeps the
 * writer small enough to be read in one sitting and avoids pulling a
 * compression library into a bundle that is otherwise dependency-light.
 *
 * Output is deterministic: the same inputs produce byte-identical archives,
 * which makes the tests exact rather than approximate.
 */

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

/** Store, i.e. no compression. */
const METHOD_STORED = 0;

/** Bit 11 tells the reader the file name is UTF-8. */
const FLAG_UTF8 = 0x0800;

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

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

export interface ZipOptions {
  /** Modification time written into every entry; fixed by default. */
  readonly modified?: Date;
}

/** ZIP stores time as DOS date and time fields, from 1980, in two seconds. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time:
      (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function encodeName(name: string): Uint8Array {
  return new TextEncoder().encode(name);
}

function validateName(name: string): void {
  if (name.length === 0) throw new RangeError('A zip entry needs a name');
  if (name.startsWith('/')) throw new RangeError(`Entry name must be relative: "${name}"`);
  if (name.includes('\\')) throw new RangeError(`Entry name must use forward slashes: "${name}"`);
  if (name.split('/').includes('..')) {
    throw new RangeError(`Entry name must not escape the archive: "${name}"`);
  }
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

/** The epoch ZIP itself starts at, so archives do not vary run to run. */
const FIXED_MODIFIED = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

export function createZip(entries: readonly ZipEntry[], options: ZipOptions = {}): Uint8Array {
  if (entries.length === 0) throw new RangeError('A zip archive needs at least one entry');

  const seen = new Set<string>();
  for (const entry of entries) {
    validateName(entry.name);
    if (seen.has(entry.name)) throw new RangeError(`Duplicate entry name: "${entry.name}"`);
    seen.add(entry.name);
  }

  const { time, date } = dosDateTime(options.modified ?? FIXED_MODIFIED);

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encodeName(entry.name);
    const checksum = crc32(entry.data);
    const size = entry.data.byteLength;

    const local = new Uint8Array(30 + name.byteLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, LOCAL_HEADER_SIGNATURE, true);
    localView.setUint16(4, 20, true); // version needed
    localView.setUint16(6, FLAG_UTF8, true);
    localView.setUint16(8, METHOD_STORED, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, size, true); // compressed
    localView.setUint32(22, size, true); // uncompressed
    localView.setUint16(26, name.byteLength, true);
    localView.setUint16(28, 0, true); // extra field length
    local.set(name, 30);

    locals.push(local, entry.data);

    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, CENTRAL_HEADER_SIGNATURE, true);
    centralView.setUint16(4, 20, true); // version made by
    centralView.setUint16(6, 20, true); // version needed
    centralView.setUint16(8, FLAG_UTF8, true);
    centralView.setUint16(10, METHOD_STORED, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, size, true);
    centralView.setUint32(24, size, true);
    centralView.setUint16(28, name.byteLength, true);
    centralView.setUint16(30, 0, true); // extra
    centralView.setUint16(32, 0, true); // comment
    centralView.setUint16(34, 0, true); // disk number
    centralView.setUint16(36, 0, true); // internal attributes
    centralView.setUint32(38, 0, true); // external attributes
    centralView.setUint32(42, offset, true);
    central.set(name, 46);

    centrals.push(central);
    offset += local.byteLength + size;
  }

  const centralDirectory = concat(centrals);

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  endView.setUint16(4, 0, true); // disk number
  endView.setUint16(6, 0, true); // disk with central directory
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralDirectory.byteLength, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true); // comment length

  return concat([...locals, centralDirectory, end]);
}
