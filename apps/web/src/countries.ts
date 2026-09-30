import countries from 'i18n-iso-countries';

/** Countries as ISO 3166-1 alpha-2 codes; names come from the browser, so no locale table ships. */

const names = new Intl.DisplayNames(['en'], { type: 'region' });

export function countryName(code: string | null): string {
  if (!code) return 'No country set';
  try {
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Every assignable country, by name. */
export const COUNTRY_CODES: string[] = Object.keys(countries.getAlpha2Codes())
  .sort((a, b) => countryName(a).localeCompare(countryName(b)));

/** The map's feature id for a country (ISO 3166-1 numeric, zero-padded), or null. */
export function numericOf(code: string): string | null {
  return countries.alpha2ToNumeric(code)?.padStart(3, '0') ?? null;
}
