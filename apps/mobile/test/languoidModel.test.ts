// The language list's search results as the add-language picker shows them
// (src/languoidModel.ts, docs/languoids.md).
import { describe, expect, it } from 'vitest';
import { hitLine, languoidHits, type LanguoidRow } from '../src/languoidModel';

const row = (r: Partial<LanguoidRow>): LanguoidRow => ({
  id: 'id', name: 'Name', level: 'language', parent_name: null, matched_alias_name: null, matched_alias_type: null, iso_code: null, glottocode: null, ...r
});

describe('language list matches', () => {
  it('goes by its ISO code, else its glottocode', () => {
    // Why: the code is what reports and Bible lookups read; a dialect
    // Glottolog lists without an ISO code still needs one.
    const [iso, glotto] = languoidHits([
      row({ id: 'a', name: 'Southwestern Dinka', iso_code: 'dik', glottocode: 'sout2832', parent_name: 'Dinka', matched_alias_name: 'Rek' }),
      row({ id: 'b', name: 'Rek', level: 'dialect', glottocode: 'rekk1238', parent_name: 'Southwestern Dinka' })
    ]);
    expect(iso).toMatchObject({ code: 'dik', alsoCalled: 'Rek', dialect: false });
    expect(glotto).toMatchObject({ code: 'rekk1238', alsoCalled: null, dialect: true });
    expect(hitLine(iso!)).toBe('DIK · Dinka family · also called Rek');
    expect(hitLine(glotto!)).toBe('REKK1238 · Dialect of Southwestern Dinka');
  });

  it('leaves out a matched code or the name itself as an other name, and rows it cannot link', () => {
    const hits = languoidHits([
      row({ id: 'a', name: 'Hadiyya', iso_code: 'hdy', matched_alias_name: 'hdy', matched_alias_type: 'iso639-3' }),
      row({ id: 'b', name: 'Nuer', iso_code: 'nus', matched_alias_name: 'nuer', matched_alias_type: 'exonym' }),
      row({ id: 'c', name: null, iso_code: 'xxx' }),
      row({ id: 'd', name: 'No code' })
    ]);
    expect(hits.map((h) => [h.id, h.alsoCalled])).toEqual([['a', null], ['b', null]]);
    expect(hitLine(hits[0]!)).toBe('HDY');
  });

  it('names no family for a language Glottolog could not classify', () => {
    const [gelao] = languoidHits([row({ name: 'Gelao', iso_code: 'gio', parent_name: 'Bookkeeping' })]);
    expect(hitLine(gelao!)).toBe('GIO');
  });
});
