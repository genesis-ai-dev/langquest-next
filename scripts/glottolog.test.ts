import { describe, expect, it } from 'vitest';
import { parseCsv, stageGlottolog } from './glottolog';

const languages = `ID,Name,Macroarea,Latitude,Longitude,Glottocode,ISO639P3code,Level,Countries,Family_ID,Language_ID,Closest_ISO369P3code,First_Year_Of_Documentation,Last_Year_Of_Documentation,Is_Isolate
nilo1247,Nilotic,Africa,,,nilo1247,,family,,,,,,,
dink1262,Dinka,Africa,7.0,30.0,dink1262,din,language,SD;SS,nilo1247,,din,,,false
"padd1234","Padang, ""North""",Africa,,,padd1234,,dialect,SS,nilo1247,dink1262,,,,
`;

const values = `ID,Language_ID,Parameter_ID,Value,Code_ID,Comment,Source,codeReference
dink1262-classification,dink1262,classification,nilo1247,,,,
padd1234-classification,padd1234,classification,nilo1247/dink1262,,,,
dink1262-category,dink1262,category,Spoken L1 Language,category-Spoken_L1_Language,,,
dink1262-subclassification,dink1262,subclassification,"(a:1,b:1)dink1262:1;",,,,
`;

const names = `ID,Language_ID,Name,Provider,lang
1,dink1262,Thuɔŋjäŋ,wals,
2,dink1262,Thuɔŋjäŋ,multitree,
3,dink1262,Dinka,lexvo,en
4,dink1262,not specified,ruhlen (1987),
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
      category: 'Spoken L1 Language',
      iso639_3: 'din',
      latitude: 7,
      countries: ['SD', 'SS'],
      macroareas: ['Africa']
    });
    expect(by['padd1234']).toMatchObject({ parent_glottocode: 'dink1262', name: 'Padang, "North"', iso639_3: null, latitude: null });
  });

  it('merges providers of the same name and drops placeholders and unknown languoids', () => {
    expect(staged.names).toEqual([
      { glottocode: 'dink1262', name: 'Thuɔŋjäŋ', lang: null, providers: ['multitree', 'wals'] },
      { glottocode: 'dink1262', name: 'Dinka', lang: 'en', providers: ['lexvo'] }
    ]);
  });

  it('rejects a level it does not know', () => {
    expect(() => stageGlottolog({ languages: languages.replace(',dialect,', ',variety,'), values, names })).toThrow(/unknown level/);
  });
});
