import { checkUsfm, mapRange, sourceOf, type UsfmBibleDoc, type UsfmBookDoc, type VersificationDoc } from '@langquest-next/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inSourceNumbering, offersFor, offlineAllowed, type SourceOption } from '../src/sources/model';
import { refKindOf, sourceFacts, booksOf } from '../src/reference/model';
import { missingRuns, renumberedAs, stackOf, usfmRows, versesNotIn } from '../src/usfm/readerModel';

const JONAH = readFileSync(join(import.meta.dirname, '../../../packages/core/test/fixtures/usfm/33-JONhin2017.usfm'), 'utf8');
const check = checkUsfm('33-JON.usfm', JONAH);
const book: UsfmBookDoc = { format: 'usfmBook@1', book: 'JON', name: check.name, chapters: check.chapters, usfm: JONAH, deps: [] };
const h = (c: string) => c.repeat(64);
const bible: UsfmBibleDoc = {
  format: 'usfmBible@1', name: 'पवित्र बाइबल', abbreviation: 'IRV', language: 'hin', versification: h('a'), copyright: '© BCS', rightsConfirmed: true,
  books: [{ book: 'JON', name: 'योना', doc: h('b'), chapters: 4, verses: 48 }], deps: [h('a'), h('b')]
};
const range = (c1: number, v1: number, c2: number, v2: number) => ({ book: 'JON', start: { chapter: c1, verse: v1 }, end: { chapter: c2, verse: v2 } });
const v11n = (over: Partial<VersificationDoc>): VersificationDoc => ({ format: 'versification@1', code: 'x', name: 'x', maxVerses: { JON: [17, 10, 10, 11] }, mappedVerses: {}, ...over });

describe('an uploaded Bible is a Bible', () => {
  const view = sourceOf(bible)!;
  it('reads as text kept on the phone, with no audio', () => {
    expect(view).toMatchObject({ format: 'source@1', name: 'पवित्र बाइबल', abbreviation: 'IRV', language: 'hin', versification: h('a'), provider: { kind: 'library' }, offline: 'allowed', copyright: { text: '© BCS' }, uploaded: true });
    const option: SourceOption = { itemId: 'org.irv', kind: 'library', from: 'organization', name: view.name, abbreviation: view.abbreviation, language: 'hin', doc: view };
    expect(offersFor(option, 'JON')).toEqual({ text: true, audio: false });
    expect(offersFor(option, 'RUT')).toEqual({ text: false, audio: false });
    expect(offlineAllowed(option)).toBe(true);
  });
  it('is the same object every time, so memos hold', () => {
    expect(sourceOf(bible)).toBe(view);
    const source = { format: 'source@1' } as never;
    expect(sourceOf(source)).toBe(source);
    expect(sourceOf(book)).toBeNull();
    expect(sourceOf(null)).toBeNull();
  });
  it('counts where Bibles count', () => {
    expect(refKindOf(bible)).toBe('source');
    expect(booksOf(bible)).toEqual(['JON']);
    const facts = sourceFacts(view, (x) => (x === h('b') ? book : null));
    expect(facts.text.OT).toBe(true);
    expect(facts.audio.OT).toBe(false);
  });
  it('takes its book names from the file', () => {
    expect(view.books[0]!.name).toBe('योना');
    expect(usfmRows(range(1, 1, 1, 1), book)![0]!.usfm!.chapterHead).toBe('योना 1');
  });
});

describe('a passage in an uploaded Bible', () => {
  it('opens at its verses, in plain words and as the file sets them out', () => {
    const rows = usfmRows(range(2, 1, 2, 2), book)!;
    expect(rows.map((r) => r.key)).toEqual(['2:1', '2:2']);
    expect(rows[0]!.text).toBe('तब योना ने महा मच्छ के पेट में से अपने परमेश्वर यहोवा से प्रार्थना करके कहा,');
    const { above, body } = stackOf(rows[0]!.usfm!.verse);
    expect(above.map((x) => x.text)).toEqual(['योना की प्रार्थना']);
    expect(body.map((x) => x.kind)).toEqual(['line']);
    expect(rows[1]!.usfm!.verse.notes[0]!.ref).toBe('2:2');
    expect(rows.every((r) => !/[\\|]/.test(r.text))).toBe(true);
  });
  it('names the chapter only where one starts', () => {
    const rows = usfmRows(range(1, 17, 2, 1), book)!;
    expect(rows.map((r) => r.usfm!.chapterHead)).toEqual(['योना 1', 'योना 2']);
    expect(usfmRows(range(2, 1, 2, 3), book)!.map((r) => r.usfm!.chapterHead)).toEqual(['योना 2', undefined, undefined]);
  });
  it('a bridge is one row, kept whole when it touches the passage', () => {
    const b = { ...book, usfm: '\\id JON\n\\c 1\n\\v 1 A\n\\v 2-3 B\n\\v 4 C' };
    expect(usfmRows(range(1, 3, 1, 3), b)!.map((r) => r.key)).toEqual(['1:2-3']);
  });
  it('a file that lacks a chapter still shows the rest, and says what it lacks', () => {
    const b = { ...book, usfm: '\\id JON\n\\c 1\n\\v 1 A\n\\v 2 B\n\\c 3\n\\v 1 C' };
    const rows = usfmRows(range(1, 2, 3, 1), b)!;
    expect(rows.map((r) => r.key)).toEqual(['1:2', '3:1']);
    expect(usfmRows(range(2, 1, 2, 2), b)).toBeNull();
    const numbering = v11n({ maxVerses: { JON: [2, 2, 1] } });
    expect(versesNotIn(rows, range(1, 2, 3, 1), numbering)).toEqual(['2:1-2']);
    expect(versesNotIn(null, range(2, 1, 2, 2), numbering)).toEqual(['2:1-2']);
    expect(versesNotIn(rows, range(1, 2, 3, 1), null)).toEqual([]);
  });
  it('says each run of missing verses once', () => {
    const rows = usfmRows(range(1, 1, 1, 5), { ...book, usfm: '\\id JON\n\\c 1\n\\v 1 A\n\\v 3-4 B' })!;
    const wanted = [1, 2, 3, 4, 5, 6, 7].map((verse) => ({ book: 'JON', chapter: 1, verse }));
    expect(missingRuns(rows, wanted)).toEqual(['1:2', '1:5-7']);
  });
  it('a Bible numbered otherwise maps to the passage, and says how it numbers it', () => {
    const eng = v11n({ code: 'eng', maxVerses: { JON: [17, 10, 10, 11] }, mappedVerses: { 'JON 1:17': 'JON 2:1', 'JON 2:1': 'JON 2:2', 'JON 2:2': 'JON 2:3' } });
    const org = v11n({ code: 'org', maxVerses: { JON: [16, 11, 10, 11] } });
    const passage = range(1, 17, 2, 1);
    const inBible = inSourceNumbering(passage, eng, org);
    expect(inBible).toEqual(mapRange(eng, org, passage));
    expect(inBible).toEqual(range(2, 1, 2, 2));
    expect(renumberedAs(passage, inBible)).toBe('2:1-2');
    expect(renumberedAs(passage, passage)).toBeNull();
  });
});
