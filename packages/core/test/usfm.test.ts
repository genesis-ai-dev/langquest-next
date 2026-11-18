import { describe, expect, it } from 'vitest';
import { checkUsfm, usfmProblemText, checkUsfmFiles, cleanVerseText, validateDoc, withDeps, type UsfmBibleDoc, type UsfmBookDoc } from '../src';

const GOOD = `\\id RUT Test Bible
\\h Ruth
\\toc2 Rut
\\c 1
\\p
\\v 1 In the days \\w when|lemma="x"\\w* the judges ruled,\\f + \\fr 1.1 \\ft a note\\f* there was a famine.
\\q1
\\v 2-3 A man went
\\c 2
\\v 1 Naomi had a relative.
`;

describe('checkUsfm', () => {
  it('reads a good book', () => {
    const c = checkUsfm('08-RUT.usfm', GOOD);
    expect(c.errors).toEqual([]);
    expect(c.book).toBe('RUT');
    expect(c.name).toBe('Rut');
    expect(c.chapters.map((x) => x.chapter)).toEqual([1, 2]);
    expect(c.chapters[0]!.verses).toEqual([[1, 1, 'In the days when the judges ruled, there was a famine.'], [2, 3, 'A man went']]);
    expect(c.verseCount).toBe(3);
  });
  it('says in plain words what is wrong', () => {
    expect(checkUsfm('a.usfm', '').errors[0]!.code).toBe('empty');
    expect(checkUsfm('a.usfm', '\\c 1\n\\v 1 x').errors.map((e) => e.code)).toContain('noId');
    expect(checkUsfm('a.usfm', '\\id ZZZ\n\\c 1\n\\v 1 x').errors.map((e) => e.code)).toContain('unknownCode');
    expect(checkUsfm('a.usfm', '\\id FRT\n\\c 1\n\\v 1 x').errors.map((e) => e.code)).toContain('frontBack');
    expect(checkUsfm('a.usfm', '\\id RUT\n\\h Ruth').errors.map((e) => e.code)).toContain('noChapters');
    expect(checkUsfm('a.usfm', '\\id RUT\n\\c 1\n\\p').errors.map((e) => e.code)).toContain('noVerses');
    expect(checkUsfm('a.usfm', '\\id RUT\n\\v 1 x\n\\c 1\n\\v 1 y').errors.map((e) => e.code)).toContain('strayVerse');
    expect(checkUsfm('a.usfm', '\\id RUT\n\\c 1\n\\v 2 x\n\\v 1 y').errors.map((e) => e.code)).toContain('outOfOrder');
    expect(checkUsfm('a.usfm', '\\id RUT\n\\c 1\n\\v 1 x\n\\c 1\n\\v 1 y').errors.map((e) => e.code)).toContain('chapterTwice');
    expect(checkUsfm('a.usfm', 'hello world').errors.map((e) => e.code)).toContain('notUsfm');
  });
  it('keeps every message short and never shows a path', () => {
    for (const t of ['', 'x', '\\id ZZZ', '\\id RUT\n\\c 1']) for (const e of checkUsfm('f.usfm', t).errors) expect(usfmProblemText(e).split(/\s+/).length).toBeLessThanOrEqual(20);
  });
  it('refuses a book given twice', () => {
    const [a, b] = checkUsfmFiles([{ name: 'a.usfm', text: GOOD }, { name: 'b.usfm', text: GOOD }]);
    expect(a!.errors).toEqual([]);
    expect(b!.errors.map((e) => e.code)).toContain('duplicateBook');
  });
  it('cleans markup', () => {
    expect(cleanVerseText('\\nd Lord\\nd* said \\add to\\add* you ~ now')).toBe('Lord said to you now');
  });
});

describe('usfmBible@1 and usfmBook@1', () => {
  const h = 'a'.repeat(64);
  const book: UsfmBookDoc = { format: 'usfmBook@1', book: 'RUT', name: 'Rut', chapters: [{ chapter: 1, verses: [[1, 1, 'x']] }], usfm: GOOD, deps: [] };
  const bible: UsfmBibleDoc = withDeps({
    format: 'usfmBible@1', name: 'Our Bible', abbreviation: 'OB', language: 'hin', versification: h, copyright: '© Team', rightsConfirmed: true,
    books: [{ book: 'RUT', name: 'Rut', doc: 'b'.repeat(64), chapters: 1, verses: 1 }], deps: []
  });
  it('validates', () => {
    expect(validateDoc(withDeps(book))).toBeNull();
    expect(validateDoc(bible)).toBeNull();
  });
  it('refuses what is not safe to publish', () => {
    expect(validateDoc({ ...bible, rightsConfirmed: false })).toContain('confirm');
    expect(validateDoc({ ...bible, books: [] })).toContain('at least one');
    expect(validateDoc({ ...bible, language: 'Hindi!' })).toContain('language');
    expect(validateDoc({ ...bible, deps: [] })).toContain('deps');
    expect(validateDoc({ ...book, chapters: [] })).toContain('chapters');
  });
});

describe('size', () => {
  it('refuses a book too big for one library document', () => {
    const big = `\\id PSA\n\\c 1\n\\v 1 ${'x'.repeat(1_900_000)}`;
    expect(checkUsfm('big.usfm', big).errors.map((e) => e.code)).toEqual(['tooBig']);
  });
});

it('flags broken letters', () => {
  expect(checkUsfm('a.usfm', '\\id RUT\n\\c 1\n\\v 1 a�b').errors.map((e) => e.code)).toContain('brokenLetters');
});
