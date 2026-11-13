import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { checkUsfmFiles, validateDoc, withDeps } from '@langquest-next/core';
import { describe, expect, it } from 'vitest';
import { bibleDoc, bookDoc, emptyDetails, missingDetail, readyBooks, suggestAbbreviation } from '../src/usfm/model';
import { decode, readZip, ZipError } from '../src/usfm/zipModel';

const RUT = '\\id RUT\n\\c 1\n\\v 1 In the days of the judges.\n';
const MAT = '\\id MAT\n\\c 1\n\\v 1 The book of the genealogy.\n';
const inflate = (raw: Uint8Array) => Promise.resolve(new Uint8Array(inflateRawSync(raw)));

/** A small zip made by hand: names and bodies, each deflated or stored. */
function zip(files: { name: string; body: string; stored?: boolean }[]): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = Buffer.from(f.body);
    const data = f.stored ? raw : deflateRawSync(raw);
    const name = Buffer.from(f.name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(f.stored ? 0 : 8, 8); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(name.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(f.stored ? 0 : 8, 10); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(raw.length, 24); cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42);
    parts.push(head, name, data);
    central.push(cen, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, end]));
}

describe('a zip of USFM files', () => {
  it('opens deflated and stored files, and leaves folders and Mac leftovers out', async () => {
    const files = await readZip(zip([
      { name: 'bible/', body: '' }, { name: '__MACOSX/x', body: 'x' }, { name: 'bible/.DS_Store', body: 'x' },
      { name: 'bible/08-RUT.usfm', body: RUT }, { name: 'bible/40-MAT.usfm', body: MAT, stored: true }
    ]), inflate);
    expect(files.map((f) => f.name)).toEqual(['bible/08-RUT.usfm', 'bible/40-MAT.usfm']);
    expect(new TextDecoder().decode(files[0]!.bytes)).toBe(RUT);
    expect(new TextDecoder().decode(files[1]!.bytes)).toBe(MAT);
  });
  it('says when it is not a zip', async () => {
    await expect(readZip(new Uint8Array(100), inflate)).rejects.toMatchObject({ reason: 'notZip' });
    await expect(readZip(new Uint8Array(100), inflate)).rejects.toBeInstanceOf(ZipError);
  });
});

describe('the Bible an admin publishes', () => {
  const h = 'c'.repeat(64);
  const checks = checkUsfmFiles([{ name: 'mat.usfm', text: MAT }, { name: 'rut.usfm', text: RUT }, { name: 'bad.usfm', text: '\\id ZZZ' }]);

  it('takes the passing books in canon order and waits for the details', () => {
    expect(readyBooks(checks).map((c) => c.book)).toEqual(['RUT', 'MAT']);
    const d = emptyDetails();
    expect(missingDetail([], d)).toBe('books');
    expect(missingDetail(checks, d)).toBe('name');
    d.name = 'Our Bible'; expect(missingDetail(checks, d)).toBe('abbreviation');
    d.abbreviation = 'OB'; expect(missingDetail(checks, d)).toBe('language');
    d.language = 'hin'; expect(missingDetail(checks, d)).toBe('rights');
    d.rights = true; expect(missingDetail(checks, d)).toBeNull();
  });

  it('becomes documents the library accepts', () => {
    const books = new Map(readyBooks(checks).map((c, i) => [c.book!, String(i).repeat(64)]));
    const d = { ...emptyDetails(), name: ' Our Bible ', abbreviation: 'OB', language: 'hin', rights: true };
    for (const c of readyBooks(checks)) expect(validateDoc(withDeps(bookDoc(c, c.book === 'RUT' ? RUT : MAT)))).toBeNull();
    const bible = withDeps(bibleDoc(checks, books, d, h, 'cc-by-sa-4.0'));
    expect(validateDoc(bible)).toBeNull();
    expect(bible.name).toBe('Our Bible');
    expect(bible.books.map((b) => [b.book, b.chapters, b.verses])).toEqual([['RUT', 1, 1], ['MAT', 1, 1]]);
  });

  it('suggests a short name', () => {
    expect(suggestAbbreviation('Our Team Bible')).toBe('OTB');
    expect(suggestAbbreviation('Gondi')).toBe('GOND');
    expect(suggestAbbreviation('  ')).toBe('');
  });
});

describe('reading a file as text', () => {
  it('reads UTF-8 and UTF-16 with its byte-order mark', async () => {
    expect(decode(new TextEncoder().encode(RUT))).toBe(RUT);
    expect(decode(new Uint8Array(Buffer.from(`\uFEFF${RUT}`, 'utf16le')))).toBe(RUT);
  });
});
