import { describe, expect, it } from 'vitest';
import { parseCsv, stageGlottolog } from './glottolog';

const languages = `ID,Name,Macroarea,Latitude,Longitude,Glottocode,ISO639P3code,Level,Countries,Family_ID,Language_ID,Closest_ISO369P3code,First_Year_Of_Documentation,Last_Year_Of_Documentation,Is_Isolate
nilo1247,Nilotic,Africa,,,nilo1247,,family,,,,,,,
dink1262,Dinka,Africa,7.0,30.0,dink1262,din,language,SD;SS,nilo1247,,din,,,false
"padd1234","Padang, ""North""",Africa,,,padd1234,,dialect,SS,nilo1247,dink1262,,,,
espe1235,Esperanto,,,,espe1235,epo,language,,,,epo,,,
`;

const values = `ID,Language_ID,Parameter_ID,Value,Code_ID,Comment,Source,codeReference
dink1262-classification,dink1262,classification,nilo1247,,,,
padd1234-classification,padd1234,classification,nilo1247/dink1262,,,,
dink1262-category,dink1262,category,Spoken_L1_Language,category-Spoken_L1_Language,,,
esper123-category,espe1235,category,Artificial_Language,category-Artificial_Language,,,
dink1262-subclassification,dink1262,subclassification,"(a:1,b:1)dink1262:1;",,,,
`;

const names = `ID,Language_ID,Name,Provider,lang
1,dink1262,Thuɔŋjäŋ,wals,
2,dink1262,Thuɔŋjäŋ,multitree,
3,dink1262,Dinka,lexvo,en
6,dink1262,Dinka,lexvo,fr
4,dink1262,not specified,ruhlen (1987),
7,espe1235,Esperanto,lexvo,en
5,gone1234,Nobody,wals,
`;

describe('parseCsv', () => {
  it('reads quoted commas, doubled quotes and newlines', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi""\nthere"\r\n1,\n')).toEqual([
      { a: 'x, y', b: 'say "hi"\nthere' },
      { a: '1', b: '' }
    ]);
  });
});

describe('stageGlottolog', () => {
  const staged = stageGlottolog({ languages, values, names });

  it('takes the parent from the end of the classification path', () => {
    const by = Object.fromEntries(staged.languoids.map((l) => [l.glottocode, l]));
    expect(by['nilo1247']!.parent_glottocode).toBeNull();
    expect(by['dink1262']).toMatchObject({
      parent_glottocode: 'nilo1247',
      iso639_3: 'din',
      latitude: 7,
      countries: ['SD', 'SS'],
      macroareas: ['Africa']
    });
    expect(by['padd1234']).toMatchObject({ parent_glottocode: 'dink1262', name: 'Padang, "North"', iso639_3: null, latitude: null });
  });

  it('writes categories as v2 did', () => {
    expect(staged.languoids.find((l) => l.glottocode === 'dink1262')!.category).toBe('Spoken L1 Language');
  });

  it('labels each name with its language as an ISO 639-3 code, English when untagged, as v2 did', () => {
    expect(staged.names).toEqual([
      { glottocode: 'dink1262', name: 'Thuɔŋjäŋ', label_iso639_3: 'eng', providers: ['multitree', 'wals'] },
      { glottocode: 'dink1262', name: 'Dinka', label_iso639_3: 'eng', providers: ['lexvo'] },
      { glottocode: 'dink1262', name: 'Dinka', label_iso639_3: 'fra', providers: ['lexvo'] }
    ]);
  });

  it('gives artificial languages no names, and drops placeholders and unknown languoids', () => {
    expect(staged.names.some((n) => n.glottocode === 'espe1235' || n.name === 'not specified' || n.glottocode === 'gone1234')).toBe(false);
  });

  it('refuses a language tag it cannot label', () => {
    expect(() => stageGlottolog({ languages, values, names: names.replace(',lexvo,fr', ',lexvo,xx-unknown') })).toThrow(/no ISO 639-3 code/);
  });

  it('rejects a level it does not know', () => {
    expect(() => stageGlottolog({ languages: languages.replace(',dialect,', ',variety,'), values, names })).toThrow(/unknown level/);
  });
});
