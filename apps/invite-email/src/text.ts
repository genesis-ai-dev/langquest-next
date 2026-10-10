// The emails' words in the language of the person who sent them (LAN-42,
// docs/localization.md): an invite goes out in the inviter's app language,
// since the people they invite usually share it. The catalogs beside this
// file hold the same keys as English; a missing word falls back to English.
import am from './i18n/am.json';
import ar from './i18n/ar.json';
import bn from './i18n/bn.json';
import en from './i18n/en.json';
import es from './i18n/es.json';
import fr from './i18n/fr.json';
import ha from './i18n/ha.json';
import hi from './i18n/hi.json';
import id from './i18n/id.json';
import my from './i18n/my.json';
import ne from './i18n/ne.json';
import pt from './i18n/pt.json';
import sw from './i18n/sw.json';
import th from './i18n/th.json';
import zhHans from './i18n/zh-Hans.json';

export type EmailText = typeof en;
type Partial2 = { [K in keyof EmailText]?: Partial<EmailText[K]> };

export const EMAIL_CATALOGS: Record<string, Partial2> = {
  en, es, pt, fr, ar, sw, ha, am, hi, bn, ne, id, 'zh-Hans': zhHans, th, my
};

/** BCP 47 tags for dates, by catalog. */
const DATE_LOCALE: Record<string, string> = { pt: 'pt-BR', 'zh-Hans': 'zh-Hans' };
const RTL = new Set(['ar']);

/** The catalog for a language code the app sent ("pt", "zh-Hans"), else English. */
export function emailLanguage(code: unknown): string {
  return typeof code === 'string' && code in EMAIL_CATALOGS ? code : 'en';
}

export function emailText(code: string): EmailText {
  const own = EMAIL_CATALOGS[emailLanguage(code)] ?? {};
  return {
    invite: { ...en.invite, ...own.invite },
    reset: { ...en.reset, ...own.reset }
  };
}

export function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => values[k] ?? m);
}

export function formatEmailDate(iso: string, code: string): string {
  const lang = emailLanguage(code);
  try {
    return new Intl.DateTimeFormat(DATE_LOCALE[lang] ?? lang, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function emailDir(code: string): 'rtl' | 'ltr' {
  return RTL.has(emailLanguage(code)) ? 'rtl' : 'ltr';
}
