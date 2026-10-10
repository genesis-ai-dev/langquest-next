// The languages the app's own words are in (LAN-42). English is the source;
// every other catalog starts as a machine draft and stays marked so until a
// fluent speaker has read the whole of it in the app and signed it off here.
// A draft can be picked in Me → Language, but the phone's language never
// switches someone into a draft on its own.

export type UiLanguage =
  | 'en' | 'es' | 'pt' | 'fr' | 'ar' | 'sw' | 'ha' | 'am' | 'hi' | 'bn' | 'ne' | 'id' | 'zh-Hans' | 'th' | 'my';

export interface UiLanguageInfo {
  code: UiLanguage;
  /** The language's name in itself, as the picker shows it to someone who reads only that language. */
  name: string;
  /** Its name in English, for developers and the store listing. */
  english: string;
  dir: 'ltr' | 'rtl';
  /** BCP 47 tag for Intl (dates, numbers, plurals). */
  locale: string;
  /** Who read the whole catalog in the app and when; null while it is a machine draft. */
  reviewed: { by: string; date: string } | null;
}

export const UI_LANGUAGES: readonly UiLanguageInfo[] = [
  { code: 'en', name: 'English', english: 'English', dir: 'ltr', locale: 'en', reviewed: { by: 'source', date: '2026-10-09' } },
  { code: 'es', name: 'Español', english: 'Spanish', dir: 'ltr', locale: 'es', reviewed: null },
  { code: 'pt', name: 'Português (Brasil)', english: 'Portuguese (Brazil)', dir: 'ltr', locale: 'pt-BR', reviewed: null },
  { code: 'fr', name: 'Français', english: 'French', dir: 'ltr', locale: 'fr', reviewed: null },
  { code: 'ar', name: 'العربية', english: 'Arabic', dir: 'rtl', locale: 'ar', reviewed: null },
  { code: 'sw', name: 'Kiswahili', english: 'Swahili', dir: 'ltr', locale: 'sw', reviewed: null },
  { code: 'ha', name: 'Hausa', english: 'Hausa', dir: 'ltr', locale: 'ha', reviewed: null },
  { code: 'am', name: 'አማርኛ', english: 'Amharic', dir: 'ltr', locale: 'am', reviewed: null },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi', dir: 'ltr', locale: 'hi', reviewed: null },
  { code: 'bn', name: 'বাংলা', english: 'Bengali', dir: 'ltr', locale: 'bn', reviewed: null },
  { code: 'ne', name: 'नेपाली', english: 'Nepali', dir: 'ltr', locale: 'ne', reviewed: null },
  { code: 'id', name: 'Bahasa Indonesia', english: 'Indonesian', dir: 'ltr', locale: 'id', reviewed: null },
  { code: 'zh-Hans', name: '简体中文', english: 'Chinese (Simplified)', dir: 'ltr', locale: 'zh-Hans', reviewed: null },
  { code: 'th', name: 'ไทย', english: 'Thai', dir: 'ltr', locale: 'th', reviewed: null },
  { code: 'my', name: 'မြန်မာ', english: 'Burmese', dir: 'ltr', locale: 'my', reviewed: null }
];

export const SOURCE_LANGUAGE: UiLanguage = 'en';

export function languageInfo(code: UiLanguage): UiLanguageInfo {
  return UI_LANGUAGES.find((l) => l.code === code) ?? UI_LANGUAGES[0]!;
}

export function isUiLanguage(code: string | null | undefined): code is UiLanguage {
  return !!code && UI_LANGUAGES.some((l) => l.code === code);
}

/**
 * The catalog for a BCP 47 tag the phone reports ("pt-BR", "zh-Hans-CN",
 * "zh-CN", "ar-EG"), or null. Chinese is Simplified unless the tag says
 * Traditional (Hant, or Taiwan, Hong Kong and Macau without a script).
 */
export function catalogFor(tag: string): UiLanguage | null {
  const parts = tag.replace(/_/g, '-').split('-');
  const lang = parts[0]!.toLowerCase();
  if (lang === 'zh') {
    const rest = parts.slice(1).map((p) => p.toLowerCase());
    if (rest.includes('hant') || (!rest.includes('hans') && rest.some((p) => p === 'tw' || p === 'hk' || p === 'mo'))) return null;
    return 'zh-Hans';
  }
  if (lang === 'in') return 'id'; // Android's old code for Indonesian
  return isUiLanguage(lang) ? lang : null;
}

/**
 * Which catalog to show: the person's own choice on this device, else the
 * first of the phone's languages that has a reviewed catalog, else English.
 */
export function pickLanguage(chosen: string | null, deviceTags: readonly string[]): UiLanguage {
  if (isUiLanguage(chosen)) return chosen;
  for (const tag of deviceTags) {
    const code = catalogFor(tag);
    if (code && languageInfo(code).reviewed) return code;
  }
  return SOURCE_LANGUAGE;
}
