import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkUsfm, readUsfm, type UsfmLine, type UsfmRead, type UsfmVerse } from '../src';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/usfm/${name}`, import.meta.url), 'utf8');
const verseOf = (r: UsfmRead, c: number, v: number): UsfmVerse => r.chapters.find((x) => x.chapter === c)!.verses.find((x) => x.start <= v && x.end >= v)!;
const linesOf = (v: UsfmVerse) => v.pieces.filter((p): p is UsfmLine => p.kind === 'line');
const headingsOf = (v: UsfmVerse) => v.pieces.flatMap((p) => (p.kind === 'heading' ? [p.text] : []));
const lineWords = (l: UsfmLine) => l.spans.filter((s) => !s.mark).map((s) => s.text).join('');
const book = (body: string) => readUsfm(`\\id RUT\n\\c 1\n${body}`);

/** Every word a person could read in a book. */
const allWords = (r: UsfmRead): string[] => [
  ...Object.values(r.names),
  ...r.chapters.flatMap((c) => [c.label ?? '', ...c.verses.flatMap((v) => [
    v.text,
    ...v.pieces.flatMap((p) => (p.kind === 'heading' ? [p.text] : p.spans.map((s) => s.text))),
    ...v.notes.flatMap((n) => [n.call, n.ref, ...n.spans.map((s) => s.text)])
  ])])
];

describe('a real book: Jonah in the Hindi Indian Revised Version', () => {
  const r = readUsfm(fixture('33-JONhin2017.usfm'));
  it('has its chapters and every verse', () => {
    expect(r.chapters.map((c) => c.verses.length)).toEqual([17, 10, 10, 11]);
    expect(r.problems).toEqual([]);
  });
  it('names the book from the file', () => {
    expect(checkUsfm('33-JON.usfm', fixture('33-JONhin2017.usfm')).name).toBe('योना');
    expect(r.names['h']).toBe('योना');
  });
  it('puts a section heading above its verse, and never in a verse\'s words', () => {
    expect(headingsOf(verseOf(r, 2, 1))).toEqual(['योना की प्रार्थना']);
    expect(verseOf(r, 2, 1).text).not.toContain('योना की प्रार्थना');
    expect(r.chapters.flatMap((c) => c.verses).every((v) => v.text.trim() === v.text && !v.text.includes('\\'))).toBe(true);
  });
  it('keeps poetry as lines', () => {
    const lines = linesOf(verseOf(r, 2, 2));
    expect(lines.map((l) => l.style)).toEqual(['poetry', 'poetry', 'poetry', 'poetry']);
    expect(lineWords(lines[1]!)).toBe('और उसने मेरी सुन ली है;');
  });
  it('keeps a footnote, marked where it falls, with its verse and its words', () => {
    const v = verseOf(r, 2, 2);
    expect(v.notes).toHaveLength(1);
    expect(v.notes[0]!.ref).toBe('2:2');
    expect(v.notes[0]!.spans.map((s) => s.text).join('')).toContain('जल की गहराई');
    const line = linesOf(v)[2]!;
    expect(line.spans.map((s) => (s.mark === 'note' ? `[${s.text}]` : s.text)).join('')).toBe('अधोलोक के उदर में से[a] मैं चिल्ला उठा,');
    expect(line.spans[0]!.style).toBe('italic');
    expect(v.text).not.toContain('जल की गहराई');
  });
  it('leaves the introduction out', () => {
    expect(allWords(r).join(' ')).not.toContain('लेखन तिथि');
  });
  it('shows no marker anywhere', () => {
    expect(allWords(r).filter((w) => /\\|\|/.test(w))).toEqual([]);
  });
});

describe('a real book with word attributes: Jonah in the World English Bible', () => {
  const r = readUsfm(fixture('33-JONengwebp.usfm'));
  it('reads the words and drops their attributes', () => {
    expect(r.problems).toEqual([]);
    expect(verseOf(r, 1, 2).text.startsWith('“Arise, go to Nineveh, that great city')).toBe(true);
    expect(allWords(r).filter((w) => /\\|\||strong=/.test(w))).toEqual([]);
  });
  it('names the book', () => {
    expect(checkUsfm('33-JON.usfm', fixture('33-JONengwebp.usfm')).name).toBe('Jonah');
  });
});

describe('the edge cases other importers got wrong', () => {
  it('a stray \\p at a verse\'s end leaves no empty line and no text (AQU-1465)', () => {
    const r = book('\\p\n\\v 1 One.\n\\p\n\\v 2 Two.\n\\p\n');
    expect(verseOf(r, 1, 1).text).toBe('One.');
    expect(linesOf(verseOf(r, 1, 1))).toHaveLength(1);
    expect(linesOf(verseOf(r, 1, 2))[0]!.gap).toBe(true);
    expect(linesOf(verseOf(r, 1, 2))).toHaveLength(1);
  });
  it('no marker reaches the text (AQU-1363)', () => {
    const r = book('\\p \\v 1 \\add In\\add* the \\nd Lord\\nd*\\va 3\\va*\\vp 1b\\vp* said\\fig a pic|src="a.png"\\fig*\\rq Gen 1\\rq*.\n\\q1 \\v 2 \\+w x|y="z"\\+w* \\unknown more \\ts\\* \\zaln-s |x-strong="H1"\\*\\w word|occ="1"\\w*\\zaln-e\\* \\qt-s |who="A"\\*end\\qt-e\\*\n');
    expect(verseOf(r, 1, 1).text).toBe('In the Lord said.');
    expect(verseOf(r, 1, 2).text).toBe('x more word end');
  });
  it('verses on one line with their paragraph', () => {
    const r = readUsfm('\\id RUT\n\\c 1 \\p \\v 1 One. \\v 2 Two. \\q1 \\v 3 Three.\n');
    expect(r.chapters[0]!.verses.map((v) => v.text)).toEqual(['One.', 'Two.', 'Three.']);
    expect(linesOf(verseOf(r, 1, 3))[0]!.style).toBe('poetry');
  });
  it('split verses are one row, and keep each part\'s number (AQU-1400)', () => {
    const r = book('\\p\n\\v 3 Three.\n\\v 4a Before.\n\\s A heading between\n\\p\n\\v 4b After.\n\\v 5 Five.\n');
    expect(r.problems).toEqual([]);
    expect(r.chapters[0]!.verses.map((v) => [v.start, v.end, v.text])).toEqual([[3, 3, 'Three.'], [4, 4, 'Before. After.'], [5, 5, 'Five.']]);
    const four = verseOf(r, 1, 4);
    expect(four.pieces.map((p) => p.kind)).toEqual(['line', 'heading', 'line']);
    expect(linesOf(four).map((l) => l.spans[0]!.text)).toEqual(['4a', '4b']);
  });
  it('a split that runs over a verse is one row', () => {
    const r = book('\\v 4a A \\v 4b-5a B \\v 5b C \\v 6 D');
    expect(r.problems).toEqual([]);
    expect(r.chapters[0]!.verses.map((v) => [v.start, v.end, v.text])).toEqual([[4, 5, 'A B C'], [6, 6, 'D']]);
  });
  it('a bridge is one row, and a real repeat is a problem', () => {
    expect(book('\\v 3-4 Both.').chapters[0]!.verses[0]).toMatchObject({ start: 3, end: 4, text: 'Both.' });
    expect(book('\\v 3 A \\v 3 B').problems).toEqual([{ code: 'outOfOrder', chapter: 1, verse: 3 }]);
    expect(checkUsfm('a.usfm', '\\id RUT\n\\c 1\n\\v 4a A\n\\v 4b B').errors).toEqual([]);
  });
  it('footnotes and cross references stay, off the verse\'s words (AQU-1295)', () => {
    const r = book('\\v 1 Word\\f + \\fr 1.1 \\fk Word: \\ft A \\+nd note\\+nd*.\\f* next\\x - \\xo 1.1: \\xt Gen 1:1\\x*\\f * \\ft Own mark.\\f* end.');
    const v = verseOf(r, 1, 1);
    expect(v.text).toBe('Word next end.');
    expect(v.notes.map((n) => [n.kind, n.call, n.ref, n.spans.map((s) => s.text).join('')])).toEqual([
      ['footnote', 'a', '1.1', 'Word: A note.'], ['crossref', '', '1.1', 'Gen 1:1'], ['footnote', '*', '', 'Own mark.']
    ]);
    expect(v.notes[0]!.spans[0]).toEqual({ text: 'Word: ', style: 'bold' });
  });
  it('a note left open ends at the next verse', () => {
    const r = book('\\v 1 One\\f + \\ft unclosed\n\\v 2 Two.');
    expect(verseOf(r, 1, 1).text).toBe('One');
    expect(verseOf(r, 1, 2).text).toBe('Two.');
    expect(verseOf(r, 1, 1).notes[0]!.spans[0]!.text).toBe('unclosed');
  });
  it('note letters start again each chapter', () => {
    const r = readUsfm('\\id RUT\n\\c 1\n\\v 1 A\\f + \\ft x\\f* B\\f + \\ft y\\f*\n\\c 2\n\\v 1 C\\f + \\ft z\\f*');
    expect(r.chapters.map((c) => c.verses[0]!.notes.map((n) => n.call))).toEqual([['a', 'b'], ['a']]);
  });
  it('headings of each kind, and a heading before \\c goes with the next chapter', () => {
    const r = readUsfm('\\id PSA\n\\c 1\n\\ms1 BOOK 1\n\\mr Psalms 1–41\n\\s1 Two ways\n\\r (Prov 4)\n\\d A Psalm.\n\\q1\n\\v 1 Blessed.\n\\s1 Next\n\\c 2\n\\cl Psalm 2\n\\sp She\n\\p\n\\v 1 Why?');
    expect(verseOf(r, 1, 1).pieces.flatMap((p) => (p.kind === 'heading' ? [[p.style, p.text]] : []))).toEqual([
      ['major', 'BOOK 1'], ['reference', 'Psalms 1–41'], ['section', 'Two ways'], ['reference', '(Prov 4)'], ['title', 'A Psalm.']
    ]);
    expect(linesOf(verseOf(r, 1, 1))[0]!.style).toBe('poetry');
    expect(headingsOf(verseOf(r, 2, 1))).toEqual(['Next', 'She']);
    expect(r.chapters[1]!.label).toBe('Psalm 2');
  });
  it('a Psalm title that is itself a verse', () => {
    const r = readUsfm('\\id PSA\n\\c 3\n\\d \\v 1 A Psalm of David.\n\\q1 \\v 2 Lord,');
    expect(linesOf(verseOf(r, 3, 1))[0]!.style).toBe('title');
    expect(verseOf(r, 3, 1).text).toBe('A Psalm of David.');
    expect(linesOf(verseOf(r, 3, 2))[0]!.style).toBe('poetry');
  });
  it('indents poetry by its number, and a stanza break makes a space', () => {
    const r = book('\\q1\n\\v 1 One\n\\q2 two\n\\b\n\\q1 three\n\\qs Selah\\qs*');
    expect(linesOf(verseOf(r, 1, 1)).map((l) => [l.indent, l.gap, lineWords(l)])).toEqual([[0, true, 'One'], [1, false, 'two'], [0, true, 'three Selah']]);
  });
  it('sidebars, file notes and an empty \\s5 do not show', () => {
    const r = book('\\v 1 One.\n\\rem not this\n\\s5\n\\esb\n\\ms Sidebar\n\\p Study text.\n\\esbe\n\\p\n\\v 2 Two.');
    expect(verseOf(r, 1, 1).text).toBe('One.');
    expect(verseOf(r, 1, 2).text).toBe('Two.');
    expect(allWords(r).join(' ')).not.toMatch(/not this|Sidebar|Study/);
  });
  it('a chapter that says nothing is still a chapter, and bad ones are problems', () => {
    expect(book('\\p').chapters[0]!.verses).toEqual([]);
    expect(readUsfm('\\c x').problems).toEqual([{ code: 'badChapter', text: 'x' }]);
    expect(readUsfm('\\v 1 x').problems).toEqual([{ code: 'strayVerse' }]);
  });
  it('a backslash and a BOM on their own', () => {
    const r = readUsfm('\uFEFF\\id RUT\r\n\\c 1\r\n\\v 1 a \\ b\\* c\r\n');
    expect(verseOf(r, 1, 1).text).toBe('a b c');
  });
});

describe('any text at all', () => {
  const piece = fc.oneof(
    fc.constantFrom('\\c 1', '\\c 2', '\\c x', '\\v 1', '\\v 2-3', '\\v 4a', '\\v 4b', '\\p', '\\q1', '\\q2', '\\s1 Head', '\\f + ', '\\ft note', '\\f*', '\\x - ', '\\x*', '\\nd', '\\nd*', '\\+w a|b="c"', '\\+w*', '\\zaln-s |x', '\\*', '\\', '\\esb', '\\esbe', '\\b', '\\d', '\\cl', '\\fig', '\\fig*', '|', '~', '//', '\n'),
    fc.string({ maxLength: 8 })
  );
  it('never throws and never shows a backslash', () => {
    fc.assert(fc.property(fc.array(piece, { maxLength: 40 }), (parts) => {
      const r = readUsfm(parts.join(' '));
      expect(allWords(r).filter((w) => w.includes('\\'))).toEqual([]);
      for (const c of r.chapters) for (const v of c.verses) {
        expect(v.text).toBe(v.pieces.flatMap((p) => (p.kind === 'line' ? [p.spans.filter((s) => !s.mark).map((s) => s.text).join('').replace(/ +/g, ' ').trim()] : [])).filter(Boolean).join(' '));
      }
    }));
  });
});
