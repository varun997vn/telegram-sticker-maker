import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createZip, crc32 } from '@/core/pack/zip.ts';

/**
 * The archives are checked with the system `unzip`, not with a reader written
 * alongside the writer. An independent implementation accepting the output is
 * a far stronger claim than self-consistency.
 */

let workDir: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'sticker-zip-'));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function unzipTo(bytes: Uint8Array, name: string): string {
  const archive = join(workDir, `${name}.zip`);
  const target = join(workDir, name);
  writeFileSync(archive, bytes);
  execFileSync('unzip', ['-qq', '-o', archive, '-d', target]);
  return target;
}

function listEntries(bytes: Uint8Array, name: string): string[] {
  const archive = join(workDir, `${name}.zip`);
  writeFileSync(archive, bytes);
  return execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort();
}

const text = (value: string) => new TextEncoder().encode(value);

describe('crc32', () => {
  it.each([
    ['', 0],
    ['a', 0xe8b7be43],
    ['123456789', 0xcbf43926],
  ])('matches the known checksum for %o', (input, expected) => {
    expect(crc32(text(input))).toBe(expected);
  });
});

describe('createZip', () => {
  it('produces an archive the system unzip reports as valid', () => {
    const bytes = createZip([{ name: 'hello.txt', data: text('hello') }]);
    const archive = join(workDir, 'valid.zip');
    writeFileSync(archive, bytes);

    // `unzip -t` fails loudly on a malformed archive.
    expect(() => execFileSync('unzip', ['-t', archive], { stdio: 'pipe' })).not.toThrow();
  });

  it('round-trips file contents exactly', () => {
    const payload = new Uint8Array(4096);
    for (let i = 0; i < payload.length; i += 1) payload[i] = (i * 31) % 256;

    const extracted = unzipTo(
      createZip([
        { name: 'text.txt', data: text('hello, stickers') },
        { name: 'binary.bin', data: payload },
      ]),
      'roundtrip',
    );

    expect(readFileSync(join(extracted, 'text.txt'), 'utf8')).toBe('hello, stickers');
    expect(new Uint8Array(readFileSync(join(extracted, 'binary.bin')))).toEqual(payload);
  });

  it('keeps files in nested directories', () => {
    const extracted = unzipTo(
      createZip([
        { name: 'contents.json', data: text('{}') },
        { name: 'stickers/01.webp', data: text('one') },
        { name: 'stickers/02.webp', data: text('two') },
      ]),
      'nested',
    );

    expect(readFileSync(join(extracted, 'stickers/02.webp'), 'utf8')).toBe('two');
  });

  it('lists every entry it was given', () => {
    const entries = listEntries(
      createZip([
        { name: 'a.txt', data: text('a') },
        { name: 'b/c.txt', data: text('c') },
      ]),
      'listing',
    );
    expect(entries).toEqual(['a.txt', 'b/c.txt']);
  });

  it('stores a non-ASCII name as UTF-8 and flags it as such', () => {
    // What the extractor then calls the file on disk depends on its locale —
    // Info-ZIP escapes names it cannot map under a C locale — so this checks
    // the bytes in the archive rather than the name the filesystem ends up
    // with. Bit 11 of the general purpose flags is what tells a reader the
    // name is UTF-8 rather than the legacy code page.
    const name = 'héllo-🐱.txt';
    const bytes = createZip([{ name, data: text('ok') }]);

    const flags = new DataView(bytes.buffer, bytes.byteOffset).getUint16(6, true);
    expect(flags & 0x0800).toBe(0x0800);

    const encoded = new TextEncoder().encode(name);
    const nameLength = new DataView(bytes.buffer, bytes.byteOffset).getUint16(26, true);
    expect(nameLength).toBe(encoded.byteLength);
    expect([...bytes.slice(30, 30 + encoded.byteLength)]).toEqual([...encoded]);
  });

  it('extracts a non-ASCII entry whatever the extractor names it', () => {
    const archive = join(workDir, 'unicode.zip');
    const target = join(workDir, 'unicode');
    writeFileSync(archive, createZip([{ name: 'héllo-🐱.txt', data: text('ok') }]));
    execFileSync('unzip', ['-qq', '-o', archive, '-d', target]);

    const written = readdirSync(target);
    expect(written).toHaveLength(1);
    expect(readFileSync(join(target, written[0] as string), 'utf8')).toBe('ok');
  });

  it('handles an empty file', () => {
    const extracted = unzipTo(
      createZip([
        { name: 'empty.txt', data: new Uint8Array(0) },
        { name: 'other.txt', data: text('x') },
      ]),
      'empty-entry',
    );
    expect(readFileSync(join(extracted, 'empty.txt')).byteLength).toBe(0);
  });

  it('handles many entries', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      name: `sticker-${String(i + 1).padStart(2, '0')}.webp`,
      data: text(`sticker ${i}`),
    }));
    expect(listEntries(createZip(many), 'many')).toHaveLength(30);
  });

  it('is byte-identical for the same input', () => {
    const entries = [{ name: 'a.txt', data: text('a') }];
    expect(createZip(entries)).toEqual(createZip(entries));
  });

  it('rejects an empty archive', () => {
    expect(() => createZip([])).toThrow(RangeError);
  });

  it('rejects duplicate names', () => {
    expect(() =>
      createZip([
        { name: 'a.txt', data: text('one') },
        { name: 'a.txt', data: text('two') },
      ]),
    ).toThrow(/Duplicate/);
  });

  it.each([
    ['an empty name', ''],
    ['an absolute path', '/etc/passwd'],
    ['a backslash path', 'dir\\file.txt'],
    ['a parent traversal', '../escape.txt'],
    ['a nested traversal', 'stickers/../../escape.txt'],
  ])('rejects %s', (_label, name) => {
    expect(() => createZip([{ name, data: text('x') }])).toThrow(RangeError);
  });
});
