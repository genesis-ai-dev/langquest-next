// The languages the app's own words come in (LAN-42, decisions.md 72), and
// the rule for which one a phone shows. Pure, so the rule is tested without
// a phone. The catalogs are in this folder, one JSON file for each code.

/** Each language under its own name, so a person finds theirs without reading English. */
export const LOCALES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'pt', name: 'Português' },
  { code: 'fr', name: 'Français' },
  { code: 'ar', name: 'العربية' },
  { code: 'sw', name: 'Kiswahili' },
  { code: 'ha', name: 'Hausa' },
  { code: 'am', name: 'አማርኛ' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'bn', name: 'বাংলা' },
  { code: 'ne', name: 'नेपाली' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'zh-Hans', name: '简体中文' }
] as const;

export type LocaleCode = (typeof LOCALES)[number]['code'];

export const SOURCE_LOCALE: LocaleCode = 'en';

const RTL: ReadonlySet<LocaleCode> = new Set(['ar']);

export function isLocale(code: string | null | undefined): code is LocaleCode {
  return LOCALES.some((l) => l.code === code);
}

export function isRtl(code: LocaleCode): boolean {
  return RTL.has(code);
}

export function localeName(code: LocaleCode): string {
  return LOCALES.find((l) => l.code === code)?.name ?? code;
}

/**
 * One device language tag ("pt-BR", "zh-Hans-CN", "ne-NP") to a catalog, or
 * null. A region falls back to its language; Chinese is Simplified unless the
 * tag says Traditional (or a Traditional region), which has no catalog yet.
 */
export function matchTag(tag: string): LocaleCode | null {
  const parts = tag.replace(/_/g, '-').split('-');
  const lang = (parts[0] ?? '').toLowerCase();
  if (lang === 'zh') {
    const rest = parts.slice(1).map((p) => p.toLowerCase());
    const traditional = rest.includes('hant') || (!rest.includes('hans') && rest.some((p) => p === 'tw' || p === 'hk' || p === 'mo'));
    return traditional ? null : 'zh-Hans';
  }
  // "in" is the old code for Indonesian; some Android versions still report it.
  if (lang === 'in') return 'id';
  return isLocale(lang) ? lang : null;
}

/**
 * The language the app shows: the person's choice in Settings, else the first
 * device language with a catalog, else English.
 */
export function pickLocale(deviceTags: readonly string[], chosen?: string | null): LocaleCode {
  if (isLocale(chosen)) return chosen;
  for (const tag of deviceTags) {
    const match = matchTag(tag);
    if (match) return match;
  }
  return SOURCE_LOCALE;
}
