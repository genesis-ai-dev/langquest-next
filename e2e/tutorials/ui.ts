// The app's own words in the language a film is made in (TUTORIAL_LANGUAGE,
// English when not set), from its catalogs, so a script finds what is on the
// screen in any of the app's languages.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const FILM_LANGUAGE = process.env['TUTORIAL_LANGUAGE'] ?? 'en';

type Catalog = { [key: string]: string | Catalog };
const read = (code: string): Catalog => JSON.parse(readFileSync(path.join('apps', 'mobile', 'src', 'i18n', `${code}.json`), 'utf8')) as Catalog;
const catalogs = { film: read(FILM_LANGUAGE), en: FILM_LANGUAGE === 'en' ? null : read('en') };

function lookUp(catalog: Catalog, key: string): string | undefined {
  let at: string | Catalog | undefined = catalog;
  for (const part of key.split('.')) at = typeof at === 'object' ? at[part] : undefined;
  return typeof at === 'string' ? at : undefined;
}

/** The line as the app has it, falling back to English as the app does. */
function template(key: string): string {
  const line = lookUp(catalogs.film, key) ?? (catalogs.en ? lookUp(catalogs.en, key) : undefined);
  if (line === undefined) throw new Error(`No catalog line ${key}`);
  return line;
}

/** The words exactly, with these values put in. */
export function uiText(key: string, values: Record<string, string> = {}): string {
  return template(key).replace(/\{\{\s*(\w+)[^}]*\}\}/g, (_, name: string) => values[name] ?? '');
}

/** The whole line, with these values put in and anything in the other places. */
export function uiPattern(key: string, values: Record<string, string> = {}): RegExp {
  const parts = template(key).split(/(\{\{\s*\w+[^}]*\}\})/);
  const source = parts.map((p) => {
    const name = /^\{\{\s*(\w+)/.exec(p)?.[1];
    const literal = name === undefined ? p : values[name];
    return literal === undefined ? '.+?' : literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return new RegExp(`^${source}$`);
}
