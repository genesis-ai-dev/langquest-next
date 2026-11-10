import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addCatalog, currentLanguage, showLanguage, t } from '../src/i18n';
import { formatClock, formatDay, formatNumber } from '../src/i18n/format';
import { catalogFor, pickLanguage, UI_LANGUAGES } from '../src/i18n/languages';
import { fallbackRule } from '../src/i18n/plurals';
import { appFiles, findModuleScopeT, findUiText, keysNamed } from './uiText';

// The app's words (LAN-42, decisions.md 81): none written into the code,
// every key used and defined, and every language holding the same keys as
// English, with the plural forms that language needs. The Android phone's
// disguise keeps its words apart (src/disguise/i18n, decisions.md 171), so
// that an iPhone build carries none of them, and nearby sync keeps its own
// apart (src/nearby/i18n, decision 228), so that the web need not carry them
// on every visit; both are held to the same rules.

const ROOT = join(import.meta.dirname, '..');
const DIR = join(ROOT, 'src/i18n');
const DISGUISE_DIR = join(ROOT, 'src/disguise/i18n');
const NEARBY_DIR = join(ROOT, 'src/nearby/i18n');
type Tree = { [k: string]: string | Tree };
const catalog = (code: string, dir = DIR): Tree => JSON.parse(readFileSync(join(dir, `${code}.json`), 'utf8')) as Tree;

function leaves(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === 'string') out.set(prefix + k, v);
    else for (const [kk, vv] of leaves(v, `${prefix}${k}.`)) out.set(kk, vv);
  }
  return out;
}

const PLURAL = /_(zero|one|two|few|many|other)$/;
/** English keys with plural forms folded: "map.passages_one" and "_other" are "map.passages". */
const basesOf = (keys: Map<string, string>) => new Set([...keys.keys()].map((k) => k.replace(PLURAL, '')));
const pluralsOf = (keys: Map<string, string>) => new Set([...keys.keys()].filter((k) => PLURAL.test(k)).map((k) => k.replace(PLURAL, '')));
const en = leaves(catalog('en'));
const enBases = basesOf(en);
const disguiseEn = leaves(catalog('en', DISGUISE_DIR));
const disguiseBases = basesOf(disguiseEn);
const nearbyEn = leaves(catalog('en', NEARBY_DIR));
const nearbyBases = basesOf(nearbyEn);
const placeholders = (s: string) => new Set([...s.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((m) => m[1]!));
const tags = (s: string) => [...s.matchAll(/<\/?(\w+)\s*\/?>/g)].map((m) => m[0]).sort();

// Every test here reads or parses each app file, so they grow with the app: on a shared CI
// runner under coverage they took over the 5 s default.
describe('the app writes no words into its code (LAN-42)', { timeout: 30_000 }, () => {
  const files = appFiles(ROOT);

  it('every word on screen comes from a catalog', () => {
    const found = files.flatMap((path) => findUiText(path, readFileSync(path, 'utf8'), path.slice(ROOT.length + 1)));
    // `npx tsx apps/mobile/test/uiText.ts` lists them. Put each in src/i18n/en.json and use t();
    // a string that is not for people gets an `i18n-ignore` comment saying why.
    expect(found.map((f) => `${f.file}:${f.line} ${f.text}`)).toEqual([]);
  });

  it('draws text through src/ui/text.tsx, so iOS lays it out in the reading direction', () => {
    const direct = files.filter((path) => !path.endsWith('src/ui/text.tsx') && /import\s*\{[^}]*(?<![\w.])Text(?![\w])[^}]*\}\s*from\s*'react-native'/.test(readFileSync(path, 'utf8')));
    expect(direct.map((p) => p.slice(ROOT.length + 1))).toEqual([]);
  });

  it('never calls t() at module scope, before the language is known', () => {
    const found = files.flatMap((path) => findModuleScopeT(path, readFileSync(path, 'utf8'), path.slice(ROOT.length + 1)));
    expect(found.map((f) => `${f.file}:${f.line} ${f.text}`)).toEqual([]);
  });

  it('defines every key the code uses, and uses every key it defines', () => {
    const literals = new Set<string>();
    const prefixes = new Set<string>();
    // The i18n module itself uses keys too (format.ts: time.*, units.*).
    const i18nFiles = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.d.ts')).map((f) => join(DIR, f));
    for (const path of [...files, ...i18nFiles]) {
      const named = keysNamed(path, readFileSync(path, 'utf8'));
      named.literals.forEach((k) => literals.add(k));
      named.prefixes.forEach((p) => prefixes.add(p));
    }
    // A string literal that is a key is a use (t('a.b'), or a key kept in a table and passed to t later).
    // `native.*` is read by iOS from apps/mobile/locales (checked below), not by the code.
    const unused = [...enBases, ...disguiseBases, ...nearbyBases].filter((k) => !k.startsWith('native.') && !literals.has(k) && ![...prefixes].some((p) => k.startsWith(p)));
    expect(unused).toEqual([]);
    // Every `t('…')` names a key English has (the typecheck says so too, unless a key is built at run time).
    const tCalls = files.flatMap((path) => [...readFileSync(path, 'utf8').matchAll(/\bt\(\s*'([^'$]+)'/g)].map((m) => m[1]!));
    expect(tCalls.filter((k) => !enBases.has(k) && !disguiseBases.has(k) && !nearbyBases.has(k))).toEqual([]);
    // The disguise's words are used only where an iPhone build never goes (disguiseIphone.test.ts).
    const disguiseUsers = files.filter((path) => [...readFileSync(path, 'utf8').matchAll(/\bt\(\s*'([^'$]+)'/g)].some((m) => disguiseBases.has(m[1]!)));
    expect(disguiseUsers.map((p) => p.slice(ROOT.length + 1)).filter((p) => !p.startsWith('src/disguise/'))).toEqual([]);
  });
});

describe('the catalogs', () => {
  it('has a catalog for each language and a loader for each catalog', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
    expect(files).toEqual(UI_LANGUAGES.map((l) => l.code).sort());
    const loaders = readFileSync(join(DIR, 'catalogs.ts'), 'utf8');
    for (const l of UI_LANGUAGES) if (l.code !== 'en') expect(loaders).toContain(`case '${l.code}': return require('./${l.code}.json');`);
  });

  it("has the disguise's words for each language too, and a loader for each", () => {
    const files = readdirSync(DISGUISE_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
    expect(files).toEqual(UI_LANGUAGES.map((l) => l.code).sort());
    const loaders = readFileSync(join(ROOT, 'src/disguise/disguiseWords.ts'), 'utf8');
    for (const l of UI_LANGUAGES) if (l.code !== 'en') expect(loaders).toContain(`case '${l.code}': return require('./i18n/${l.code}.json');`);
    // None of them is in the app's own catalogs, which every build carries.
    for (const l of UI_LANGUAGES) expect([...leaves(catalog(l.code)).keys()].filter((k) => disguiseBases.has(k.replace(PLURAL, ''))), l.code).toEqual([]);
  });

  it("has nearby sync's words for each language too, a loader for each, and none in the catalogs every visit carries", () => {
    const files = readdirSync(NEARBY_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
    expect(files).toEqual(UI_LANGUAGES.map((l) => l.code).sort());
    const loaders = readFileSync(join(ROOT, 'src/nearby/nearbyWords.ts'), 'utf8');
    for (const l of UI_LANGUAGES) if (l.code !== 'en') expect(loaders).toContain(`case '${l.code}': return require('./i18n/${l.code}.json');`);
    for (const l of UI_LANGUAGES) expect([...leaves(catalog(l.code)).keys()].filter((k) => nearbyBases.has(k.replace(PLURAL, ''))), l.code).toEqual([]);
    // A phone loads them with its catalogs; the web, with the nearby screens only.
    expect(readFileSync(join(ROOT, 'src/shell/wiring.ts'), 'utf8')).toContain("import '../nearby/nearbyWordsAtStart';");
    expect(readFileSync(join(ROOT, 'src/nearby/nearbyWordsAtStart.ts'), 'utf8')).toContain("import './nearbyWords';");
    expect(readFileSync(join(ROOT, 'src/nearby/nearbyWordsAtStart.web.ts'), 'utf8')).not.toContain('import');
    expect(readFileSync(join(ROOT, 'src/screens/nearby.tsx'), 'utf8')).toContain("import '../nearby/nearbyWords';");
  });

  it('gives iOS the microphone and camera questions in each language (scripts/native-locales.mjs)', () => {
    const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')).expo as { locales?: Record<string, string>; ios: { infoPlist: Record<string, string> } };
    const english = catalog('en').native as Tree;
    expect(app.ios.infoPlist.NSMicrophoneUsageDescription).toBe(english.microphone);
    for (const lang of UI_LANGUAGES.filter((l) => l.code !== 'en')) {
      const name = ({ pt: 'pt-BR', tl: 'fil' } as Record<string, string>)[lang.code] ?? lang.code;
      expect(app.locales?.[name], name).toBe(`./locales/${name}.json`);
      const native = catalog(lang.code).native as Tree;
      expect(JSON.parse(readFileSync(join(ROOT, 'locales', `${name}.json`), 'utf8')), name)
        .toEqual({ ios: { NSMicrophoneUsageDescription: native.microphone, NSCameraUsageDescription: native.camera } });
    }
  });

  const sources = [
    { where: 'src/i18n', dir: DIR, en, enBases, pluralBases: pluralsOf(en) },
    { where: 'src/disguise/i18n', dir: DISGUISE_DIR, en: disguiseEn, enBases: disguiseBases, pluralBases: pluralsOf(disguiseEn) },
    { where: 'src/nearby/i18n', dir: NEARBY_DIR, en: nearbyEn, enBases: nearbyBases, pluralBases: pluralsOf(nearbyEn) }
  ];
  for (const { where, dir, en, enBases, pluralBases } of sources) for (const lang of UI_LANGUAGES.filter((l) => l.code !== 'en')) {
    describe(`${lang.english} (${lang.code}) in ${where}`, () => {
      const tr = leaves(catalog(lang.code, dir));
      const categories = new Intl.PluralRules(lang.locale).resolvedOptions().pluralCategories;

      it('holds every English key, and no others', () => {
        const expected = new Set<string>();
        for (const base of enBases) {
          if (pluralBases.has(base)) for (const c of categories) expected.add(`${base}_${c}`);
          else expected.add(base);
        }
        expect([...expected].filter((k) => !tr.has(k)).slice(0, 50)).toEqual([]);
        expect([...tr.keys()].filter((k) => !expected.has(k)).slice(0, 50)).toEqual([]);
      });

      it('keeps the placeholders and tags English has', () => {
        const wrong: string[] = [];
        for (const [key, text] of tr) {
          const base = key.replace(PLURAL, '');
          // A plural form answers to English's form of the same name ("_one"), else to "_other".
          const form = /_(zero|one|two|few|many|other)$/.exec(key)?.[1];
          const source = pluralBases.has(base) ? (en.get(`${base}_${form}`) ?? en.get(`${base}_other`)) : en.get(key);
          if (source === undefined) continue;
          const want = placeholders(source);
          const have = placeholders(text);
          // Any placeholder English uses in some form of the key may appear ("{{part}}" or "{{parts}}").
          const known = pluralBases.has(base)
            ? new Set([...en].filter(([k]) => k.replace(PLURAL, '') === base).flatMap(([, v]) => [...placeholders(v)]))
            : placeholders(source);
          // A plural form may leave the number out ("one passage" said as a word).
          if (pluralBases.has(base)) want.delete('count');
          if ([...want].some((p) => !have.has(p)) || [...have].some((p) => !known.has(p))) wrong.push(`${key}: ${text}`);
          if (tags(source).join() !== tags(text).join()) wrong.push(`${key} (tags): ${text}`);
          if (!text.trim()) wrong.push(`${key}: empty`);
        }
        expect(wrong.slice(0, 50)).toEqual([]);
      });
    });
  }
});

describe('choosing the language', () => {
  it('maps the phone’s language tags to catalogs', () => {
    expect(catalogFor('pt-BR')).toBe('pt');
    expect(catalogFor('pt-PT')).toBe('pt');
    expect(catalogFor('zh-Hans-CN')).toBe('zh-Hans');
    expect(catalogFor('zh-CN')).toBe('zh-Hans');
    expect(catalogFor('zh-TW')).toBeNull();
    expect(catalogFor('zh-Hant-HK')).toBeNull();
    expect(catalogFor('ar-EG')).toBe('ar');
    expect(catalogFor('in-ID')).toBe('id');
    // Phones call Tagalog Filipino; older Android phones say tl.
    expect(catalogFor('fil-PH')).toBe('tl');
    expect(catalogFor('fil')).toBe('tl');
    expect(catalogFor('tl-PH')).toBe('tl');
    expect(catalogFor('de-DE')).toBeNull();
  });

  it('follows a choice made on the device, else an approved phone language, else English', () => {
    expect(pickLanguage('fr', ['es-MX'])).toBe('fr');
    expect(pickLanguage(null, ['de-DE', 'en-GB'])).toBe('en');
    expect(pickLanguage(null, ['es-MX'])).toBe('es');
    expect(pickLanguage('xx', [])).toBe('en');
    // A draft (not approved) is picked by hand only: a phone in its language stays in English.
    const es = UI_LANGUAGES.find((l) => l.code === 'es')! as { approved: unknown };
    const approved = es.approved;
    es.approved = null;
    try {
      expect(pickLanguage(null, ['es-MX'])).toBe('en');
      expect(pickLanguage('es', ['es-MX'])).toBe('es');
    } finally {
      es.approved = approved;
    }
  });
});

describe('plurals, dates and numbers', () => {
  it('chooses plural forms as Node’s Intl does, for engines without it', () => {
    const samples = [0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 14, 16, 19, 20, 21, 99, 100, 101, 102, 103, 111, 1000, 1001, 1_000_000, 2_000_000, 1_000_001, 0.4, 0.5, 1.5, 1.6, 2.5];
    for (const lang of UI_LANGUAGES) {
      const rule = fallbackRule(lang.locale);
      const intl = new Intl.PluralRules(lang.locale);
      expect(rule.resolvedOptions().pluralCategories.sort(), lang.code).toEqual([...intl.resolvedOptions().pluralCategories].sort());
      for (const n of samples) expect(`${lang.code} ${n} ${rule.select(n)}`).toBe(`${lang.code} ${n} ${intl.select(n)}`);
    }
  });

  it('formats in the language showing, and comes back to English', () => {
    expect(currentLanguage()).toBe('en');
    expect(formatNumber(1234)).toBe('1,234');
    expect(formatClock(74_500)).toBe('1:15');
    expect(formatDay(new Date(2026, 9, 1))).toBe('Oct 1');
    addCatalog('fr', catalog('fr'));
    showLanguage('fr');
    try {
      expect(formatNumber(1234)).toBe('1 234');
      expect(formatDay(new Date(2026, 9, 1))).toBe('1 oct.');
    } finally {
      showLanguage('en');
    }
    expect(t('common.done')).toBe('Done');
  });
});
