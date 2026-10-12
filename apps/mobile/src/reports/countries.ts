import countries from 'i18n-iso-countries';
import am from 'i18n-iso-countries/langs/am.json';
import ar from 'i18n-iso-countries/langs/ar.json';
import bn from 'i18n-iso-countries/langs/bn.json';
import en from 'i18n-iso-countries/langs/en.json';
import es from 'i18n-iso-countries/langs/es.json';
import fr from 'i18n-iso-countries/langs/fr.json';
import ha from 'i18n-iso-countries/langs/ha.json';
import hi from 'i18n-iso-countries/langs/hi.json';
import id from 'i18n-iso-countries/langs/id.json';
import pt from 'i18n-iso-countries/langs/pt.json';
import sw from 'i18n-iso-countries/langs/sw.json';
import th from 'i18n-iso-countries/langs/th.json';
import zh from 'i18n-iso-countries/langs/zh.json';
import { currentLanguage, currentLocale, t, type UiLanguage } from '../i18n';

/**
 * Countries as ISO 3166-1 alpha-2 codes, named in the language showing from
 * tables that ship with the app: Hermes on a phone has no
 * `Intl.DisplayNames`, which the web dashboard used. The package has no
 * Nepali or Burmese table; those show English names.
 */
for (const table of [en, es, pt, fr, ar, sw, ha, am, hi, bn, id, zh, th]) countries.registerLocale(table);

/** The package's table for a language of the app, or null when it ships none. */
function tableFor(language: UiLanguage): string | null {
  switch (language) {
    case 'en': case 'es': case 'pt': case 'fr': case 'ar': case 'sw': case 'ha': case 'am': case 'hi': case 'bn': case 'id': case 'th':
      return language;
    case 'zh-Hans': return 'zh';
    case 'ne': case 'my': return null;
  }
}

export function countryName(code: string | null): string {
  if (!code) return t('reports.countries.none');
  const table = tableFor(currentLanguage());
  return (table ? countries.getName(code, table) : undefined) ?? countries.getName(code, 'en') ?? code;
}

/** Every assignable country, by name in the language showing. */
export function countryCodes(): string[] {
  const locale = currentLocale();
  return Object.keys(countries.getAlpha2Codes())
    .map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, locale))
    .map((c) => c.code);
}

/** The map's feature id for a country (ISO 3166-1 numeric, zero-padded), or null. */
export function numericOf(code: string): string | null {
  return countries.alpha2ToNumeric(code)?.padStart(3, '0') ?? null;
}
