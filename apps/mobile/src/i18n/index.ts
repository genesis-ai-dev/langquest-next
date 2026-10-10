// The app's words in the person's language (LAN-42, decisions.md 81).
//
// Every word the app shows or says is a key in `en.json` (English is the
// source) and reaches the screen through `t('area.key')`. The other
// catalogs beside it hold the same keys. apps/mobile/test/i18n.test.ts
// fails on a word written straight into the code, a key used but missing,
// a key no code uses, or a catalog that lacks or adds keys.
//
// - Interpolate, never concatenate: `t('passage.byWhom', { name })` with
//   "Recorded by {{name}}", so each language can put the name where it goes.
// - Counts: `t('map.passages', { count })` picks `passages_one`,
//   `passages_other` (Arabic has six forms, Chinese one) and formats the
//   number for the language with `{{count, number}}`.
// - Never call `t` at module scope: the language is known only once the app
//   starts. Wrap fixed lists in a function.
// - Dates and numbers go through `format.ts` (Intl), not hand-made strings.
//
// This module reads nothing from the device, so tests and pure models can
// import it; it starts in English. `start.ts` picks the language on a phone
// or in a browser before the first screen draws.
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import { languageInfo, SOURCE_LANGUAGE, UI_LANGUAGES, type UiLanguage } from './languages';
import { installPluralFallback } from './plurals';

export type Catalog = typeof en;

installPluralFallback();

void i18next.use(initReactI18next).init({
  lng: SOURCE_LANGUAGE,
  fallbackLng: SOURCE_LANGUAGE,
  supportedLngs: UI_LANGUAGES.map((l) => l.code),
  load: 'currentOnly',
  resources: { en: { translation: en } },
  initAsync: false,
  nsSeparator: false,
  returnNull: false,
  returnEmptyString: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false }
});

/** The app's words in the language now showing. */
export const t = i18next.t;

/** The language the app is showing. */
export function currentLanguage(): UiLanguage {
  return (i18next.language as UiLanguage) || SOURCE_LANGUAGE;
}

/** BCP 47 tag for Intl: dates, numbers and sorting in the language showing. */
export function currentLocale(): string {
  return languageInfo(currentLanguage()).locale;
}

export function isRtl(): boolean {
  return languageInfo(currentLanguage()).dir === 'rtl';
}

/** Hands a catalog to i18next; `start.ts` loads it from the bundle, tests from disk. */
export function addCatalog(code: UiLanguage, catalog: object) {
  if (!i18next.hasResourceBundle(code, 'translation')) i18next.addResourceBundle(code, 'translation', catalog, true, true);
}

/** Show the app in this language from now on (its catalog must be added first). */
export function showLanguage(code: UiLanguage) {
  void i18next.changeLanguage(code);
}

export { Trans } from 'react-i18next';
export { UI_LANGUAGES, languageInfo, type UiLanguage } from './languages';
