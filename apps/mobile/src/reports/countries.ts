import countries from 'i18n-iso-countries';
import en from 'i18n-iso-countries/langs/en.json';

/**
 * Countries as ISO 3166-1 alpha-2 codes, named in English from a table that
 * ships with the app: Hermes on a phone has no `Intl.DisplayNames`, which the
 * web dashboard used.
 */
countries.registerLocale(en);

export function countryName(code: string | null): string {
  if (!code) return 'No country set';
  return countries.getName(code, 'en') ?? code;
}

/** Every assignable country, by name. */
export const COUNTRY_CODES: string[] = Object.keys(countries.getAlpha2Codes())
  .sort((a, b) => countryName(a).localeCompare(countryName(b)));

/** The map's feature id for a country (ISO 3166-1 numeric, zero-padded), or null. */
export function numericOf(code: string): string | null {
  return countries.alpha2ToNumeric(code)?.padStart(3, '0') ?? null;
}
