import { readFileSync } from 'node:fs';
import { report, surveyOne, type Survey } from './bible-survey';
import { chapterKey, chaptersToRead, expected, fits, lastVerseOf, lastVersesOf, SYSTEMS, verdict, type LastVerses, type System } from './bibleSurvey';

const systems = Object.fromEntries(SYSTEMS.map((s) => [
  s, lastVersesOf(JSON.parse(readFileSync(new URL(`../library/versifications/${s}.json`, import.meta.url), 'utf8')).maxVerses)
])) as Record<System, LastVerses>;

const booksOf = (s: System, only?: (book: string) => boolean) =>
  Object.entries(systems[s]).filter(([b]) => !only || only(b)).map(([book, list]) => ({ book, chapters: list.length }));
const NT = new Set(['MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV']);

/** What a Bible numbered exactly like `s` shows in the chapters the survey reads. */
function seenAs(s: System, books = booksOf(s)) {
  const lastVerse = Object.fromEntries(chaptersToRead(systems, books).map((c) => [chapterKey(c.book, c.chapter), expected(systems[s], c.book, c.chapter)]));
  return { books, lastVerse, partial: false };
}

describe('the Bible Brain numbering survey', () => {
  it('reads about forty chapters of a whole Bible, and any two numberings part in at least four of them', () => {
    const books = booksOf('eng');
    const plan = chaptersToRead(systems, books);
    expect(plan.length).toBeLessThanOrEqual(45);
    for (const [i, a] of SYSTEMS.entries()) {
      for (const b of SYSTEMS.slice(i + 1)) {
        const apart = plan.filter((c) => systems[a][c.book] && systems[b][c.book] && expected(systems[a], c.book, c.chapter) !== expected(systems[b], c.book, c.chapter));
        expect(apart.length, `${a} and ${b}`).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('names each standard numbering from its own chapters, and nothing else fits', () => {
    for (const s of SYSTEMS) expect(verdict(fits(systems, seenAs(s)))).toEqual({ numbering: s });
  });

  it('says a New Testament alone fits the Hebrew and the Greek numbering alike, and names the commoner', () => {
    expect(verdict(fits(systems, seenAs('eng', booksOf('eng', (b) => NT.has(b)))))).toEqual({ numbering: 'eng' });
    expect(verdict(fits(systems, seenAs('org', booksOf('org', (b) => NT.has(b)))))).toEqual({ numbering: 'org', alsoFits: ['lxx'] });
    expect(verdict(fits(systems, seenAs('rso', booksOf('rso', (b) => NT.has(b)))))).toEqual({ numbering: 'rsc', alsoFits: ['rso'] });
  });

  it('calls a Bible that parts from every numbering custom, with the nearest and where it parts', () => {
    const seen = seenAs('eng');
    const at = Object.keys(seen.lastVerse).find((k) => k.startsWith('PSA '))!;
    seen.lastVerse[at]! += 1;
    expect(verdict(fits(systems, seen))).toEqual({
      numbering: 'custom', nearest: 'eng', differences: [{ at, saw: systems.eng.PSA![Number(at.split(' ')[1]) - 1]! + 1, expected: systems.eng.PSA![Number(at.split(' ')[1]) - 1] }]
    });
    // Malachi with 3 chapters is not English numbering, whatever the verses say.
    const three = seenAs('eng');
    three.books = three.books.map((b) => (b.book === 'MAL' ? { ...b, chapters: 3 } : b));
    expect(verdict(fits(systems, three))).toMatchObject({ numbering: 'custom', nearest: 'eng', differences: [{ at: 'MAL', saw: 3, expected: 4 }] });
  });

  it('takes a missing chapter or a short book in a partial text for missing text, not for a numbering', () => {
    const seen = { ...seenAs('org'), partial: true };
    seen.lastVerse[Object.keys(seen.lastVerse)[0]!] = 0;
    seen.books = seen.books.map((b) => (b.book === 'GEN' ? { ...b, chapters: 10 } : b));
    expect(verdict(fits(systems, seen))).toEqual({ numbering: 'org' });
  });

  it('takes a bridge (38–39) as reaching its last verse', () => {
    expect(lastVerseOf([[1, 1, 'a'], [38, 39, 'b']])).toBe(39);
    expect(lastVerseOf([])).toBe(0);
  });

  it('surveys one Bible from Bible Brain: its book list and book names, then the chapters chosen, from its text', async () => {
    const calls: string[] = [];
    const get = async (path: string) => {
      calls.push(path);
      if (path === '/bibles/HINOVB/book') {
        return { status: 200, body: { data: Object.entries(systems.eng).slice(0, 66).map(([book, list]) => ({ book_id: book, name: book === 'GEN' ? 'उत्पत्ति' : book, chapters: list.map((_, i) => i + 1), testament: NT.has(book) ? 'NT' : 'OT' })) } };
      }
      const m = /^\/bibles\/filesets\/(\w+)\/(\w{3})\/(\d+)$/.exec(path);
      if (!m) return { status: 404, body: null };
      const n = expected(systems.eng, m[2]!, Number(m[3]));
      return { status: 200, body: { data: Array.from({ length: n }, (_, i) => ({ verse_start: i + 1, verse_end: i + 1, verse_text: 'x' })) } };
    };
    const row = {
      abbr: 'HINOVB', name: 'Hindi O.V.', vname: 'पवित्र बाइबिल', iso: 'hin', language: 'Hindi',
      filesets: { 'dbp-prod': [{ id: 'HINOVBO_ET', type: 'text_plain', size: 'OT' }, { id: 'HINOVBN_ET', type: 'text_plain', size: 'NT' }, { id: 'HINOVBN1DA', type: 'audio', size: 'NT' }] }
    };
    const s = await surveyOne(get, row, systems, false);
    expect(s).toMatchObject({ bibleId: 'HINOVB', vname: 'पवित्र बाइबिल', iso: 'hin', numbering: 'eng', partial: false, books: 66, deuterocanon: false, missing: 0 });
    // Its book names, in its own language, come with the book list.
    expect(s!.bookNames!['GEN']).toBe('उत्पत्ति');
    expect(Object.keys(s!.bookNames!)).toHaveLength(66);
    expect(calls.filter((c) => c.includes('/HINOVBN_ET/')).length).toBeGreaterThan(0);
    expect(calls.filter((c) => c.includes('/HINOVBO_ET/')).length).toBeGreaterThan(0);
    expect(await surveyOne(get, { abbr: 'XYZAUD', filesets: { 'dbp-prod': [{ id: 'XYZN1DA', type: 'audio', size: 'NT' }] } }, systems, false)).toBeNull();
  });

  it('reports how many Bibles have each numbering, the app\'s languages, and where custom ones part, alone and in groups', () => {
    const bible = { text: {}, partial: false, books: 27, deuterocanon: false, read: 13, missing: 0 };
    const rev = [{ at: 'REV 12', saw: 17, expected: 18 }];
    const survey: Survey = {
      startedAt: '2026-10-30T19:00:00Z', done: true, listed: 5, withoutText: 1,
      bibles: [
        { ...bible, bibleId: 'ENGKJV', name: 'King James', iso: 'eng', language: 'English', numbering: 'eng' },
        { ...bible, bibleId: 'HINOVB', name: 'Hindi O.V.', iso: 'hin', language: 'Hindi', numbering: 'custom', nearest: 'eng', differences: rev },
        { ...bible, bibleId: 'XYZABC', name: 'Xyz', iso: 'xyz', language: 'Xyz', numbering: 'custom', nearest: 'eng', differences: rev },
        { ...bible, bibleId: 'XYZDEF', name: 'Xyz 2', iso: 'xyz', language: 'Xyz', numbering: 'custom', nearest: 'eng', differences: [...rev, { at: '2CO 13', saw: 13, expected: 14 }], partial: true }
      ]
    };
    const text = report(survey);
    expect(text).toContain('| eng | 1 |');
    expect(text).toContain('| custom | 3 |');
    expect(text).toContain('| Hindi | 1 | custom 1 |');
    expect(text).toContain('| Hausa | 0 |  |');
    expect(text).toContain('| REV 12 17 not 18 (eng) | 3 |');
    expect(text).toContain('| eng | REV 12 17 not 18 | 2 | HINOVB, XYZABC |');
    expect(text).toContain('| eng | 2CO 13 13 not 14, REV 12 17 not 18 | 1 | XYZDEF |');
    expect(text).toContain('- XYZDEF Xyz 2 (Xyz, xyz, partial): nearest eng; REV 12 17 not 18, 2CO 13 13 not 14');
  });
});
