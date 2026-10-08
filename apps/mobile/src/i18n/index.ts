// The app's own words in the person's language (LAN-42, decisions.md 72).
// i18next holds the catalogs; locales.ts decides which one shows. Screens
// call `useT()` and pass a key from en.json, which TypeScript checks.
// Library documents (templates, flows, reference material) are content in
// the database and are not translated here.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import * as Updates from 'expo-updates';
import i18n from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import { DevSettings, I18nManager, Platform } from 'react-native';
import { noteExpected } from '../report';
import am from './am.json';
import ar from './ar.json';
import bn from './bn.json';
import en from './en.json';
import es from './es.json';
import fr from './fr.json';
import ha from './ha.json';
import hi from './hi.json';
import id from './id.json';
import ne from './ne.json';
import pt from './pt.json';
import sw from './sw.json';
import zhHans from './zh-Hans.json';
import { isLocale, isRtl, pickLocale, SOURCE_LOCALE, type LocaleCode } from './locales';

export { LOCALES, localeName, type LocaleCode } from './locales';

declare module 'i18next' {
  interface CustomTypeOptions {
    resources: { translation: typeof en };
  }
}

export const CATALOGS: Record<LocaleCode, object> = {
  en, es, pt, fr, ar, sw, ha, am, hi, bn, ne, id, 'zh-Hans': zhHans
};

/** Device key for the person's choice; absent means "use the device's language". */
const CHOICE_KEY = 'ui:language';

function deviceTags(): string[] {
  try {
    return getLocales().map((l) => l.languageTag);
  } catch {
    return [];
  }
}

void i18n.use(initReactI18next).init({
  resources: Object.fromEntries(Object.entries(CATALOGS).map(([code, words]) => [code, { translation: words }])),
  lng: pickLocale(deviceTags()),
  fallbackLng: SOURCE_LOCALE,
  // React escapes text itself.
  interpolation: { escapeValue: false },
  initAsync: false
});
setDirection(current());

// The saved choice is read once at start; until then the device's language shows.
void AsyncStorage.getItem(CHOICE_KEY).then((chosen) => {
  if (isLocale(chosen) && chosen !== current()) void i18n.changeLanguage(chosen).then(() => setDirection(chosen));
}).catch((e: unknown) => noteExpected('read language choice', e));

export function useT() {
  return useTranslation().t;
}

/** For text made outside a component (a toast, an error). */
export const t = i18n.t.bind(i18n);

export function current(): LocaleCode {
  const lng = i18n.language;
  return isLocale(lng) ? lng : SOURCE_LOCALE;
}

/** The tag to format numbers and dates with (`toLocaleString(locale())`). */
export function locale(): string {
  return current();
}

export async function chosenLanguage(): Promise<LocaleCode | null> {
  const chosen = await AsyncStorage.getItem(CHOICE_KEY);
  return isLocale(chosen) ? chosen : null;
}

/** The language the device asks for, when the person has not chosen one. */
export function deviceLanguage(): LocaleCode {
  return pickLocale(deviceTags());
}

/**
 * Show the app in `code`, or in the device's language when null. Kept on
 * this device. Text changes at once; a change of direction (to or from
 * Arabic) restarts the app on a phone, because React Native lays out
 * right to left only from the start.
 */
export async function setLanguage(code: LocaleCode | null): Promise<void> {
  if (code) await AsyncStorage.setItem(CHOICE_KEY, code);
  else await AsyncStorage.removeItem(CHOICE_KEY);
  const next = pickLocale(deviceTags(), code);
  await i18n.changeLanguage(next);
  if (setDirection(next)) {
    await Updates.reloadAsync().catch((e: unknown) => {
      noteExpected('reload for direction', e);
      if (__DEV__) DevSettings.reload();
    });
  }
}

/** Lay out right to left for Arabic. True when a phone must restart to show it. */
function setDirection(code: LocaleCode): boolean {
  const rtl = isRtl(code);
  if (Platform.OS === 'web') {
    if (typeof document !== 'undefined') {
      document.documentElement.dir = rtl ? 'rtl' : 'ltr';
      document.documentElement.lang = code;
    }
    return false;
  }
  if (I18nManager.isRTL === rtl) return false;
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  return true;
}
