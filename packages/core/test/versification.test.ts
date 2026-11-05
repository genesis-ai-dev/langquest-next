import fs from 'node:fs';
import path from 'node:path';
import {
  formatRef, mapRange, orgVerses, parseRef, refId, sharedVerses, usfmOf, verseFromOrg, verseToOrg, versesInChapter,
  type VersificationDoc
} from '../src/versification';

/** The seed files are Copenhagen JSON with string counts; the library document uses numbers. */
function load(code: string): VersificationDoc {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../library/versifications', `${code}.json`), 'utf8'));
  return {
    format: 'versification@1',
    code,
    name: code,
    maxVerses: Object.fromEntries(Object.entries(raw.maxVerses as Record<string, string[]>).map(([b, vs]) => [b, vs.map(Number)])),
    mappedVerses: raw.mappedVerses ?? {},
    excludedVerses: raw.excludedVerses ?? [],
    partialVerses: raw.partialVerses ?? {}
  };
}

const org = load('org');
const eng = load('eng');
const lxx = load('lxx');
const vul = load('vul');

describe('references', () => {
  it('reads and writes the forms templates and study material use', () => {
    expect(formatRef(parseRef('GEN 1:1-2:3')!)).toBe('GEN 1:1-2:3');
    expect(formatRef(parseRef('GEN 2:4-25')!)).toBe('GEN 2:4-25');
    expect(formatRef(parseRef('GEN.2.4-25')!)).toBe('GEN 2:4-25');
    expect(refId(parseRef('RUT 1:1-16')!)).toBe('RUT.1.1-16');
    expect(parseRef('GEN 3', (b, c) => versesInChapter(eng, b, c))).toEqual({ book: 'GEN', start: { chapter: 3, verse: 1 }, end: { chapter: 3, verse: 24 } });
    expect(parseRef('not a ref')).toBeNull();
  });

  it('maps the app\'s older book ids to USFM', () => {
    expect(usfmOf('gen')).toBe('GEN');
    expect(usfmOf('joh')).toBe('JHN');
    expect(usfmOf('mar')).toBe('MRK');
  });
});

describe('the pivot through org', () => {
  it('carries a shifted chapter boundary (English GEN 31:55 is Hebrew GEN 32:1)', () => {
    // Why: study material numbered one way must land on the passage another
    // team numbered the other way, or a translator studies the wrong verses.
    expect(verseToOrg(eng, { book: 'GEN', chapter: 31, verse: 55 })).toEqual([{ book: 'GEN', chapter: 32, verse: 1 }]);
    expect(verseFromOrg(eng, { book: 'GEN', chapter: 32, verse: 1 })).toEqual([{ book: 'GEN', chapter: 31, verse: 55 }]);
    expect(verseFromOrg(eng, { book: 'GEN', chapter: 32, verse: 33 })).toEqual([{ book: 'GEN', chapter: 32, verse: 32 }]);
    expect(verseFromOrg(eng, { book: 'GEN', chapter: 31, verse: 54 })).toEqual([{ book: 'GEN', chapter: 31, verse: 54 }]);
  });

  it('lines up English Joel 2:28-32 with Hebrew Joel 3:1-5, and not with Hebrew Joel 2', () => {
    const englishJoel = { doc: eng, range: parseRef('JOL 2:28-32')! };
    expect(sharedVerses(englishJoel, { doc: org, range: parseRef('JOL 3:1-5')! })).toBe(5);
    expect(sharedVerses(englishJoel, { doc: org, range: parseRef('JOL 2:1-27')! })).toBe(0);
    expect(mapRange(eng, org, englishJoel.range)).toEqual(parseRef('JOL 3:1-5'));
  });

  it('lines up the Septuagint\'s Psalm numbering with the English', () => {
    // LXX runs one Psalm behind for most of the Psalter.
    const lxx23 = mapRange(lxx, eng, parseRef('PSA 22:1-6', (b, c) => versesInChapter(lxx, b, c))!);
    expect(lxx23?.book).toBe('PSA');
    expect(lxx23?.start.chapter).toBe(23);
    expect(sharedVerses({ doc: lxx, range: parseRef('PSA 22:1-6')! }, { doc: eng, range: parseRef('PSA 23:1-6')! })).toBeGreaterThan(0);
  });

  it('treats identical numbering as plain overlap', () => {
    expect(sharedVerses({ doc: eng, range: parseRef('RUT 1:1-16')! }, { doc: eng, range: parseRef('RUT 1:10-22')! })).toBe(7);
    expect(orgVerses(eng, parseRef('RUT 1:1-3')!).size).toBe(3);
  });

  it('survives merges across books (the Vulgate\'s Daniel additions)', () => {
    expect(() => mapRange(vul, org, parseRef('DAG 3:52-90')!)).not.toThrow();
  });
});
