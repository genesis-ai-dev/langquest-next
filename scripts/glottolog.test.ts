import { describe, expect, it } from 'vitest';
import { buildGlottolog, linkSource, matchV2, parseCsv, parseIni, type GlottologFile } from './glottolog';

const ini = (core: string, rest = '') => `# -*- coding: utf-8 -*-\r\n[core]\r\n${core}\r\n${rest}`;

// A small tree: a family, a language with two dialects, French to label names, and an artificial language.
const files: GlottologFile[] = [
  { glottocode: 'nilo1247', parent: null, ini: ini('name = Nilotic\nlevel = family') },
  {
    glottocode: 'dink1262', parent: 'nilo1247',
    ini: ini(
      'name = Dinka\nlevel = language\nhid = din\niso639-3 = din\nlatitude = 7.0\nlongitude = 30.0\nmacroareas = \n\tAfrica\ncountries = \n\tSD\n\tSS\nlinks = \n\t[Dinka](https://wals.info/languoid/lect/wals_code_din)\n\thttps://www.wikidata.org/entity/Q56466\n\thttps://en.wikipedia.org/wiki/Dinka_language',
      '[altnames]\nmultitree = \n\tJieng\nwals = \n\tJieng\nlexvo = \n\tDinka [fr]\n\tThuɔŋjäŋ [din]\nruhlen (1987) = \n\tnot specified\n[identifier]\nwals = din\n'
    )
  },
  { glottocode: 'padd1234', parent: 'dink1262', ini: ini('name = Padang\nlevel = dialect\ncountries = \n\tSS') },
  { glottocode: 'stan1290', parent: null, ini: ini('name = French\nlevel = language\niso639-3 = fra') },
  { glottocode: 'espe1235', parent: null, ini: ini('name = Esperanto\nlevel = language\niso639-3 = epo', '[altnames]\nlexvo = \n\tEsperanto [en]\n') }
];
const values = `ID,Language_ID,Parameter_ID,Value,Code_ID,Comment,Source,codeReference
dink1262-category,dink1262,category,Spoken_L1_Language,,,,
espe1235-category,espe1235,category,Artificial_Language,,,,
`;
const languages = `ID,Name,Macroarea
padd1234,Padang,Africa
`;

describe('parseIni', () => {
  it('reads sections, keys and continued values, with Windows line ends', () => {
    expect(parseIni('[core]\r\nname = Dinka\r\nmacroareas = \r\n\tAfrica\r\n\tEurasia\r\n[altnames]\r\nwals = \r\n\tJieng')).toEqual({
      core: { name: ['Dinka'], macroareas: ['Africa', 'Eurasia'] },
      altnames: { wals: ['Jieng'] }
    });
  });
});

describe('parseCsv', () => {
  it('reads quoted commas, doubled quotes and newlines', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi""\nthere"\r\n1,\n')).toEqual([
      { a: 'x, y', b: 'say "hi"\nthere' },
      { a: '1', b: '' }
    ]);
  });
});

describe('linkSource', () => {
  it('names a link by its site, as v2 did, and takes the last path segment', () => {
    expect(linkSource('[Dinka](https://wals.info/languoid/lect/wals_code_din)')).toEqual({ name: 'wals', unique_identifier: 'din', url: 'https://wals.info/languoid/lect/wals_code_din' });
    expect(linkSource('https://en.wikipedia.org/wiki/Dinka_language')).toMatchObject({ name: 'wikipedia', unique_identifier: 'Dinka_language' });
    expect(linkSource('https://www.endangeredlanguages.com/lang/1234')).toMatchObject({ name: 'elcat', unique_identifier: '1234' });
    expect(linkSource('https://example.org/a/b/')).toMatchObject({ name: 'example.org', unique_identifier: 'b' });
  });
});

describe('buildGlottolog', () => {
  const t = buildGlottolog({ files, values, languages, release: 'v5.3' });
  const of = <T extends { glottocode: string }>(rows: T[], g: string) => rows.filter((r) => r.glottocode === g);

  it('builds the tree from the folders', () => {
    expect(t.languoids.find((l) => l.glottocode === 'padd1234')).toEqual({ glottocode: 'padd1234', parent_glottocode: 'dink1262', name: 'Padang', level: 'dialect', latitude: null, longitude: null });
    expect(t.languoids.find((l) => l.glottocode === 'dink1262')).toMatchObject({ latitude: 7, longitude: 30 });
  });

  it('keeps the glottocode with its release, the ISO code and every link as sources', () => {
    expect(of(t.sources, 'dink1262').map((s) => [s.name, s.unique_identifier, s.version])).toEqual([
      ['glottolog', 'dink1262', 'v5.3'], ['iso639-3', 'din', null], ['wals', 'din', null], ['wikidata', 'Q56466', null], ['wikipedia', 'Dinka_language', null]
    ]);
  });

  it('keeps hid and category as properties; coordinates go on the languoid and macroareas become region links', () => {
    expect(of(t.properties, 'dink1262').map((p) => [p.key, p.value])).toEqual([['hid', 'din'], ['category', 'Spoken L1 Language']]);
    expect(of(t.languoidRegions, 'padd1234')).toContainEqual({ glottocode: 'padd1234', region_key: 'continent:Africa' });
  });

  it('labels a name only when the source says its language; endonym when that is the languoid itself', () => {
    const dinka = of(t.aliases, 'dink1262');
    expect(dinka).toHaveLength(3);
    expect(dinka).toEqual(expect.arrayContaining([
      { glottocode: 'dink1262', label_glottocode: 'dink1262', name: 'Thuɔŋjäŋ', alias_type: 'endonym', source_names: ['lexvo'] },
      { glottocode: 'dink1262', label_glottocode: 'stan1290', name: 'Dinka', alias_type: 'exonym', source_names: ['lexvo'] },
      { glottocode: 'dink1262', label_glottocode: null, name: 'Jieng', alias_type: null, source_names: ['multitree', 'wals'] }
    ]));
  });

  it('keeps one row for names that differ only in capital letters, in the spelling most providers give', () => {
    const files2 = [files[0]!, { glottocode: 'dink1262', parent: 'nilo1247', ini: ini('name = Dinka\nlevel = language', '[altnames]\nmultitree = \n\tJieng\nwals = \n\tJieng\nelcat = \n\tjieng\n') }];
    expect(buildGlottolog({ files: files2, values, languages, release: 'v5.3' }).aliases).toEqual([
      { glottocode: 'dink1262', label_glottocode: null, name: 'Jieng', alias_type: null, source_names: ['elcat', 'multitree', 'wals'] }
    ]);
  });

  it('leaves out names whose tag it cannot resolve, placeholders, and the names of artificial languages', () => {
    const t2 = buildGlottolog({ files: [...files, { glottocode: 'xxxx1234', parent: null, ini: ini('name = X\nlevel = language', '[altnames]\nlexvo = \n\tIks [qu]\n') }], values, languages, release: 'v5.3' });
    expect(t2.unlabelled).toEqual({ qu: 1 });
    expect(t.aliases.some((a) => a.name === 'not specified' || a.glottocode === 'espe1235')).toBe(false);
  });

  it('makes continents and nations, and links each languoid to them', () => {
    expect(t.regions).toEqual([
      { key: 'continent:Africa', name: 'Africa', level: 'continent', iso3166_1: null },
      { key: 'iso3166-1:SD', name: 'Sudan', level: 'nation', iso3166_1: 'SD' },
      { key: 'iso3166-1:SS', name: 'South Sudan', level: 'nation', iso3166_1: 'SS' }
    ]);
    expect(of(t.languoidRegions, 'padd1234').map((x) => x.region_key)).toEqual(['continent:Africa', 'iso3166-1:SS']);
  });

  it('rejects a level it does not know', () => {
    const bad = [{ glottocode: 'xxxx1234', parent: null, ini: ini('name = X\nlevel = variety') }];
    expect(() => buildGlottolog({ files: bad, values, languages, release: 'v5.3' })).toThrow(/unknown level/);
  });
});

describe('matchV2', () => {
  const gl = [
    { glottocode: 'nilo1247', parent_glottocode: null, name: 'Nilotic', level: 'family', iso639_3: null },
    { glottocode: 'dink1262', parent_glottocode: 'nilo1247', name: 'Dinka', level: 'language', iso639_3: 'din' },
    { glottocode: 'padd1234', parent_glottocode: 'dink1262', name: 'Padang', level: 'dialect', iso639_3: null },
    { glottocode: 'padd9999', parent_glottocode: null, name: 'Padang', level: 'dialect', iso639_3: null }
  ];
  const v2 = [
    { id: 'v-nilotic', parent_id: null, name: 'Nilotic', level: 'family', iso639_3: null },
    { id: 'v-dinka', parent_id: 'v-nilotic', name: 'Dinka (old name)', level: 'language', iso639_3: 'din' },
    { id: 'v-padang', parent_id: 'v-dinka', name: 'Padang', level: 'dialect', iso639_3: null }
  ];
  const m = matchV2(v2, gl);

  it('matches by ISO code, then by name path, then by a unique name and level', () => {
    expect(m.get('dink1262')).toEqual({ id: 'v-dinka', matched_on: 'iso639-3' });
    expect(m.get('nilo1247')).toEqual({ id: 'v-nilotic', matched_on: 'name path' });
  });

  it('leaves a languoid unmatched when its name could be either of two', () => {
    // v2's Padang sits under "Dinka (old name)", so its path matches nothing, and two Glottolog dialects are called Padang.
    expect(m.has('padd1234')).toBe(false);
    expect(m.has('padd9999')).toBe(false);
  });
});
