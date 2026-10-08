import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LOCALES, matchTag, pickLocale } from '../src/i18n/locales';

// The catalogs (decisions.md 72): every language has every key English has,
// with each plural form its language needs, and the same {{placeholders}}.
// A missing key would show English mid-sentence; a lost placeholder drops a
// name or a number from the text.

const DIR = join(__dirname, '../src/i18n');
const PLURAL = /_(zero|one|two|few|many|other)$/;

type Catalog = { [key: string]: string | Catalog };

function load(code: string): Record<string, string> {
  const flat: Record<string, string> = {};
  const walk = (node: Catalog, prefix: string) => {
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string') flat[prefix + k] = v;
      else walk(v, `${prefix}${k}.`);
    }
  };
  walk(JSON.parse(readFileSync(join(DIR, `${code}.json`), 'utf8')) as Catalog, '');
  return flat;
}

const placeholders = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

const en = load('en');
const bases = (cat: Record<string, string>) => new Set(Object.keys(cat).map((k) => k.replace(PLURAL, '')));

describe('catalogs', () => {
  it('one file for each language, and no others', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
    expect(files).toEqual(LOCALES.map((l) => l.code).sort());
  });

  it('include Nepali', () => {
    expect(LOCALES.some((l) => l.code === 'ne')).toBe(true);
  });

  it('every English key is used in the app', () => {
    const src = join(__dirname, '../src');
    const code = (readdirSync(src, { recursive: true }) as string[])
      .filter((f) => /\.tsx?$/.test(f))
      .map((f) => readFileSync(join(src, f), 'utf8')).join('\n');
    // Keys built at run time: the tab names (`tab.${id}`, NavChrome.tsx).
    const dynamic = ['tab.'];
    const unused = [...bases(en)].filter((k) => !dynamic.some((d) => k.startsWith(d)) && !code.includes(`'${k}'`));
    expect(unused).toEqual([]);
  });

  for (const { code } of LOCALES) {
    describe(code, () => {
      const cat = load(code);
      const categories = new Intl.PluralRules(code).resolvedOptions().pluralCategories;

      it('has the same keys as English', () => {
        expect([...bases(cat)].sort()).toEqual([...bases(en)].sort());
      });

      it('has each plural form the language uses, and no others', () => {
        for (const base of bases(en)) {
          if (!Object.keys(en).some((k) => k.startsWith(`${base}_`) && PLURAL.test(k))) continue;
          const forms = Object.keys(cat).filter((k) => k.replace(PLURAL, '') === base && PLURAL.test(k)).map((k) => PLURAL.exec(k)![1]);
          expect(forms.sort(), `${code} ${base}`).toEqual([...categories].sort());
        }
      });

      it('keeps every placeholder', () => {
        for (const [key, text] of Object.entries(cat)) {
          const base = key.replace(PLURAL, '');
          const source = en[key] ?? en[`${base}_other`] ?? en[base]!;
          // A form for exactly one or two may say the number in words.
          const wordy = /_(one|two)$/.test(key);
          const want = placeholders(source).filter((p) => !(wordy && (p === 'n' || p === 'count')));
          expect(placeholders(text).filter((p) => want.includes(p)), `${code} ${key}`).toEqual(want);
          expect(text.trim().length, `${code} ${key}`).toBeGreaterThan(0);
        }
      });
    });
  }
});

describe('which language shows', () => {
  it('the choice in Settings wins', () => {
    expect(pickLocale(['fr-FR'], 'ne')).toBe('ne');
  });

  it('else the first device language with a catalog', () => {
    expect(pickLocale(['de-DE', 'ne-NP', 'en-US'])).toBe('ne');
    expect(pickLocale(['pt-BR'])).toBe('pt');
    expect(pickLocale(['es_419'])).toBe('es');
  });

  it('else English', () => {
    expect(pickLocale(['de-DE'])).toBe('en');
    expect(pickLocale([])).toBe('en');
    expect(pickLocale(['de'], 'xx')).toBe('en');
  });

  it('Chinese is Simplified unless the device says Traditional', () => {
    expect(matchTag('zh-Hans-CN')).toBe('zh-Hans');
    expect(matchTag('zh-CN')).toBe('zh-Hans');
    expect(matchTag('zh')).toBe('zh-Hans');
    expect(matchTag('zh-Hant-TW')).toBeNull();
    expect(matchTag('zh-TW')).toBeNull();
  });

  it('the old Indonesian code still matches', () => {
    expect(matchTag('in-ID')).toBe('id');
  });
});
