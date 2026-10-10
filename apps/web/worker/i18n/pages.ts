// Words for the pages the Worker serves itself (a shared review link), in
// the reader's language (LAN-42, docs/localization.md). The reader chose it
// on the page (`?lang=`), or their browser asks for a language whose app
// catalog is approved (apps/mobile/src/i18n/languages.ts); else
// English. A missing word falls back to English.
import { pickLanguage, UI_LANGUAGES, type UiLanguage } from '../../../mobile/src/i18n/languages';
import am from './am.json';
import ar from './ar.json';
import bn from './bn.json';
import en from './en.json';
import es from './es.json';
import fr from './fr.json';
import ha from './ha.json';
import hi from './hi.json';
import id from './id.json';
import my from './my.json';
import ne from './ne.json';
import pt from './pt.json';
import sw from './sw.json';
import th from './th.json';
import zhHans from './zh-Hans.json';

export type PageWords = typeof en;
type Area = keyof PageWords;

export const PAGE_CATALOGS: Record<UiLanguage, { [A in Area]?: Partial<PageWords[A]> }> = {
  en, es, pt, fr, ar, sw, ha, am, hi, bn, ne, id, 'zh-Hans': zhHans, th, my
};

/** The language a page is shown in: `?lang=`, else the browser's languages (approved catalogs only), else English. */
export function pageLanguage(request: Request): UiLanguage {
  const asked = new URL(request.url).searchParams.get('lang');
  const tags = (request.headers.get('accept-language') ?? '').split(',').map((p) => p.split(';')[0]!.trim()).filter(Boolean);
  return pickLanguage(asked, tags);
}

export function pageWords<A extends Area>(code: UiLanguage, area: A): PageWords[A] {
  return { ...en[area], ...(PAGE_CATALOGS[code]?.[area] ?? {}) } as PageWords[A];
}

export function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => values[k] ?? m);
}

/** The picker's choices: each language by its own name. */
export function languageChoices(): { code: UiLanguage; name: string; dir: 'ltr' | 'rtl'; locale: string }[] {
  return UI_LANGUAGES.map((l) => ({ code: l.code, name: l.name, dir: l.dir, locale: l.locale }));
}
