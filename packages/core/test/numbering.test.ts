import fs from 'node:fs';
import path from 'node:path';
import { convertWay, earlierSections, numberingOf, templateBooks, type TemplateDocV2 } from '../src/index';
import { missingMappings, paratextMappings, sharedVerses, parseRef, type VersificationDoc } from '../src/versification';

const dir = path.resolve(__dirname, '../../../library/versifications');
const H = (c: string) => c.repeat(64);

/** A source numbering as the seed builds it: the JSON file, plus the Paratext lines it lost. */
function load(code: string): VersificationDoc {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, `${code}.json`), 'utf8'));
  const doc: VersificationDoc = {
    format: 'versification@1', code, name: code,
    maxVerses: Object.fromEntries(Object.entries(raw.maxVerses as Record<string, string[]>).map(([b, vs]) => [b, vs.map(Number)])),
    mappedVerses: raw.mappedVerses ?? {}, excludedVerses: raw.excludedVerses ?? []
  };
  const more = missingMappings(doc, paratextMappings(fs.readFileSync(path.join(dir, 'paratext', `${code}.vrs`), 'utf8')));
  return more.length ? { ...doc, moreMappedVerses: more } : doc;
}
/** A numbering offered to admins: the source file with only one tradition's books (scripts/library-seed.ts `numberings`). */
const only = (doc: VersificationDoc, books: string[]): VersificationDoc => numberingOf(doc, books);
const eng = load('eng');
const org = load('org');
const vul = only(load('vul'), ['JDG', 'DAN', 'PSA']);

const way = (books: TemplateDocV2['bible'] extends infer B ? B extends { books: infer X } ? X : never : never): TemplateDocV2 => ({
  format: 'template@2', name: 'FIA passages', description: '', structure: 'bible', levels: [{ name: 'Book' }, { name: 'Passage' }],
  bible: { versification: H('e'), books }, goesWith: { pattern: 'FIA' }, deps: []
});
const passagesOf = (d: TemplateDocV2, book: string) => templateBooks(d).find((b) => b.book === book)?.passages?.map((p) => p.ref);
const to = (doc: VersificationDoc, books: string[]) => ({ doc, hash: H(doc.code[0]!), books: books.map((b) => ({ book: b, name: b })) });

describe('the numbering files carry every Paratext line (decision 80)', () => {
  it('finds the lines a JSON object could not keep', () => {
    const lost = ['eng', 'org', 'lxx', 'vul', 'rsc', 'rso'].map((c) => {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, `${c}.json`), 'utf8'));
      return missingMappings({ format: 'versification@1', code: c, name: c, maxVerses: {}, mappedVerses: raw.mappedVerses ?? {} },
        paratextMappings(fs.readFileSync(path.join(dir, 'paratext', `${c}.vrs`), 'utf8'))).length;
    });
    expect(lost.reduce((a, b) => a + b, 0)).toBe(96);
    // English Acts 19:40-41 is one verse in the Original numbering.
    expect(sharedVerses({ doc: eng, range: parseRef('ACT 19:41')! }, { doc: org, range: parseRef('ACT 19:40')! })).toBe(1);
  });
});

describe('a way of dividing in another numbering', () => {
  it("makes uncovered verses their own section: Luther's Psalm 51 heading (rule 1)", () => {
    const d = convertWay(way([{ book: 'PSA', name: 'Psalms', divide: 'passages', part: 'Passage', passages: [{ ref: 'PSA 51:1-19' }] }]), eng, to(org, ['PSA']));
    const ps51 = passagesOf(d, 'PSA')!.filter((r) => r.startsWith('PSA 51:'));
    expect(ps51).toEqual(['PSA 51:1-2', 'PSA 51:3-21']);
    expect(d.goesWith).toEqual({ pattern: 'FIA' });
  });

  it('splits a section around inserted verses, and gives uncovered chapters a section each: Catholic Daniel (rules 2 and 4)', () => {
    const chapters = Array.from({ length: 12 }, (_, i) => i + 1).filter((c) => c !== 3).map((c) => ({ ref: `DAN ${c}` }));
    const d = convertWay(way([{ book: 'DAN', name: 'Daniel', divide: 'passages', part: 'Passage', passages: [
      { ref: 'DAN 3:1-18' }, { ref: 'DAN 3:19-30', name: 'The fiery furnace' }, ...chapters
    ] }]), eng, to(vul, ['DAN']));
    const refs = passagesOf(d, 'DAN')!;
    expect(refs).toEqual(expect.arrayContaining(['DAN 3:19-23', 'DAN 3:24-90', 'DAN 13:1-65', 'DAN 14:1-41']));
    expect(refs.some((r) => /^DAN 3:91-/.test(r))).toBe(true);
    const named = templateBooks(d).find((b) => b.book === 'DAN')!.passages!.filter((p) => p.name === 'The fiery furnace');
    expect(named.length).toBe(2);
  });

  it('gives a verse two sections reach to the earlier one, and drops a section left empty: Douay Judges 21 (rule 3)', () => {
    const d = convertWay(way([{ book: 'JDG', name: 'Judges', divide: 'passages', part: 'Chunk', passages: [
      { ref: 'JDG 21:1-19' }, { ref: 'JDG 21:20-21' }, { ref: 'JDG 21:22' }, { ref: 'JDG 21:23-24' }, { ref: 'JDG 21:25' }
    ] }]), eng, to(vul, ['JDG']));
    const refs = passagesOf(d, 'JDG')!.filter((r) => r.startsWith('JDG 21:'));
    expect(refs[refs.length - 1]).toBe('JDG 21:23-24');
    expect(refs).not.toContain('JDG 21:25');
  });

  it("divides by the target's own chapters, keeps books it does not cover waiting, and changes nothing in the same numbering", () => {
    const d = convertWay(way([{ book: 'MAL', name: 'Malachi', divide: 'chapters', part: 'Chapter' }, { book: 'RUT', name: 'Ruth', divide: 'passages', passages: [{ ref: 'RUT 1:1-7' }, { ref: 'RUT 1:8-4:22' }] }]),
      eng, to(org, ['MAL', 'RUT', 'TOB']));
    expect(templateBooks(d).find((b) => b.book === 'MAL')?.divide).toBe('chapters');
    expect(templateBooks(d).find((b) => b.book === 'TOB')?.divide).toBeUndefined();
    const same = convertWay(way([{ book: 'RUT', name: 'Ruth', divide: 'passages', passages: [{ ref: 'RUT 1:1-7' }, { ref: 'RUT 1:8-19a' }, { ref: 'RUT 1:19b-2:2' }] }]),
      eng, { doc: eng, hash: H('e'), books: [{ book: 'RUT', name: 'Ruth' }] });
    expect(passagesOf(same, 'RUT')).toEqual(['RUT 1:1-7', 'RUT 1:8-19a', 'RUT 1:19b-2:2']);
  });
});

describe('earlier sections', () => {
  it('finds the current section an expired one overlaps, read in the numbering it was made in', () => {
    const found = earlierSections({
      current: ['t/MAL.3.1-18', 't/MAL.3.19-24'],
      expired: ['t/MAL.4'],
      currentNumbering: org,
      numberingOf: (u) => (u === 't/MAL.4' ? eng : null)
    });
    expect(found.get('t/MAL.3.19-24')).toEqual(['t/MAL.4']);
    expect(found.has('t/MAL.3.1-18')).toBe(false);
  });
});
