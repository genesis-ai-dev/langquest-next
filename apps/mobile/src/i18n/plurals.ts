// Plural categories for the app's languages (CLDR cardinal rules), for a
// JavaScript engine without Intl.PluralRules. i18next picks "_one",
// "_few" and so on with Intl.PluralRules; without it every language would
// get English's one/other, so Arabic would say "2 passage" and Chinese would
// look for a "_one" it does not have. apps/mobile/test/i18n.test.ts holds
// these rules to Node's own Intl for every language.

type Category = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

interface Operands { n: number; i: number; v: number }

function operands(value: number): Operands {
  const n = Math.abs(value);
  const s = String(n);
  const dot = s.indexOf('.');
  return { n, i: Math.floor(n), v: dot < 0 || s.includes('e') ? 0 : s.length - dot - 1 };
}

/** "a million of", as Spanish, French and Portuguese say it: a whole number of millions. */
const millions = (o: Operands) => o.v === 0 && o.i !== 0 && o.i % 1_000_000 === 0;

const RULES: Record<string, { categories: Category[]; select: (o: Operands) => Category }> = {
  en: { categories: ['one', 'other'], select: (o) => (o.i === 1 && o.v === 0 ? 'one' : 'other') },
  sw: { categories: ['one', 'other'], select: (o) => (o.i === 1 && o.v === 0 ? 'one' : 'other') },
  es: { categories: ['one', 'many', 'other'], select: (o) => (o.n === 1 ? 'one' : millions(o) ? 'many' : 'other') },
  pt: { categories: ['one', 'many', 'other'], select: (o) => (o.i <= 1 ? 'one' : millions(o) ? 'many' : 'other') },
  fr: { categories: ['one', 'many', 'other'], select: (o) => (o.i <= 1 ? 'one' : millions(o) ? 'many' : 'other') },
  ar: {
    categories: ['zero', 'one', 'two', 'few', 'many', 'other'],
    select: (o) => {
      if (o.n === 0) return 'zero';
      if (o.n === 1) return 'one';
      if (o.n === 2) return 'two';
      const m = o.v === 0 ? o.n % 100 : -1;
      if (m >= 3 && m <= 10) return 'few';
      if (m >= 11 && m <= 99) return 'many';
      return 'other';
    }
  },
  ha: { categories: ['one', 'other'], select: (o) => (o.n === 1 ? 'one' : 'other') },
  ne: { categories: ['one', 'other'], select: (o) => (o.n === 1 ? 'one' : 'other') },
  am: { categories: ['one', 'other'], select: (o) => (o.i === 0 || o.n === 1 ? 'one' : 'other') },
  hi: { categories: ['one', 'other'], select: (o) => (o.i === 0 || o.n === 1 ? 'one' : 'other') },
  bn: { categories: ['one', 'other'], select: (o) => (o.i === 0 || o.n === 1 ? 'one' : 'other') },
  id: { categories: ['other'], select: () => 'other' },
  zh: { categories: ['other'], select: () => 'other' },
  th: { categories: ['other'], select: () => 'other' },
  my: { categories: ['other'], select: () => 'other' }
};

export function fallbackRule(locale: string) {
  const rule = RULES[locale.split('-')[0]!.toLowerCase()] ?? RULES.en!;
  return {
    select: (value: number): Category => rule.select(operands(value)),
    resolvedOptions: () => ({ pluralCategories: [...rule.categories] })
  };
}

/** Whether this engine can choose plurals itself for every app language. */
export function hasNativePlurals(): boolean {
  try {
    const PR = (globalThis as { Intl?: { PluralRules?: new (l: string) => { select: (n: number) => string } } }).Intl?.PluralRules;
    return !!PR && new PR('ar').select(3) === 'few' && new PR('fr').select(0) === 'one';
  } catch {
    return false;
  }
}

/**
 * Give the engine an Intl.PluralRules for cardinal numbers when it has none
 * (or one without CLDR data), so i18next chooses plurals as Node does.
 */
export function installPluralFallback() {
  if (hasNativePlurals()) return;
  class PluralRules {
    private rule: ReturnType<typeof fallbackRule>;
    constructor(locale?: string | string[]) {
      this.rule = fallbackRule((Array.isArray(locale) ? locale[0] : locale) ?? 'en');
    }
    select(n: number) { return this.rule.select(n); }
    resolvedOptions() { return this.rule.resolvedOptions(); }
    static supportedLocalesOf(locales: string | string[]) { return Array.isArray(locales) ? locales : [locales]; }
  }
  const intl = ((globalThis as { Intl?: object }).Intl ?? {}) as Record<string, unknown>;
  intl.PluralRules = PluralRules;
  (globalThis as { Intl?: object }).Intl = intl;
}
