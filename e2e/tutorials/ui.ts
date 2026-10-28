// The app's own words in the language a film is made in (TUTORIAL_LANGUAGE,
// English when not set), from its catalogs, so a script finds what is on the
// screen in any of the app's languages.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';

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

// ---- a script's English, found in the film's language --------------------------------
//
// The scripts find things by the English the app shows ('Save', /^Peer check, /).
// In another language each of those is looked up in the catalogs and swapped
// for what the app shows there: words the app has as they are, a line with
// values in it ("Play Version 1") by the line it comes from with its values
// swapped too, and a pattern by every line it fits. What is not the app's
// words (people's and languages' names, Bible text) stays as written; asIs()
// keeps app words as written where the screen shows them so ("English" as a
// language from the library, not the app's name for it).

type Line = { key: string; en: string; film: string; pattern: RegExp; names: string[]; literal: number };
const flatten = (c: Catalog, prefix = '', into: [string, string][] = []): [string, string][] => {
  for (const [k, v] of Object.entries(c)) typeof v === 'string' ? into.push([prefix + k, v]) : flatten(v, `${prefix}${k}.`, into);
  return into;
};
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const untagged = (s: string) => s.replace(/<\/?\w+\s*\/?>/g, '');
const PLACE = /(\{\{[^}]*\}\})/;
const placeName = (p: string) => /^\{\{\s*(\w+)/.exec(p)?.[1];
let appLines: Line[] | undefined;
function lines(): Line[] {
  if (appLines) return appLines;
  const film = new Map(flatten(catalogs.film));
  appLines = flatten(catalogs.en ?? catalogs.film).flatMap(([key, en]) => {
    const words = untagged(en).trim();
    const theirs = film.get(key);
    if (!words || theirs === undefined) return [];
    const names: string[] = [];
    const source = words.split(PLACE).map((p) => { const n = placeName(p); if (n) { names.push(n); return '(.+?)'; } return escape(p); }).join('');
    return [{ key, en: words, film: untagged(theirs).trim(), pattern: new RegExp(`^${source}$`, 's'), names, literal: words.replace(/\{\{[^}]*\}\}/g, '').trim().length }];
  });
  return appLines;
}
const DIGIT = '[\\d\\u0660-\\u0669\\u06F0-\\u06F9\\u0966-\\u096F\\u09E6-\\u09EF\\u1040-\\u1049\\u0E50-\\u0E59]';
const keptAsIs = new WeakSet<RegExp>();
const made = new WeakSet<RegExp>();

/** Words the screen shows as written in every language. */
export function asIs(words: string): RegExp {
  const r = new RegExp(`^${escape(words)}$`);
  keptAsIs.add(r);
  return r;
}

/** One of several, exactly. */
function oneOf(choices: string[]): string | RegExp {
  const unique = [...new Set(choices)];
  if (unique.length === 1) return unique[0]!;
  const r = new RegExp(`^(?:${unique.map(escape).join('|')})$`);
  made.add(r);
  return r;
}

/** A line of the film's catalog as a pattern, with these values in their places and anything in the others. */
function filmPattern(line: Line, values: Record<string, string | RegExp>): string {
  let film = line.film;
  // A count's line in the film's language has the forms that language needs.
  const plural = /_(zero|one|two|few|many|other)$/.exec(line.key);
  if (plural && typeof values['count'] === 'string' && /^\d+$/.test(values['count'])) {
    const form = new Intl.PluralRules(FILM_LANGUAGE).select(Number(values['count']));
    const base = line.key.slice(0, -plural[0].length);
    film = untagged(lines().find((l) => l.key === `${base}_${form}`)?.film ?? film);
  }
  return film.split(PLACE).map((p) => {
    const n = placeName(p);
    if (!n) return escape(p);
    const v = values[n];
    if (v === undefined || /^[\d.,%\s]+$/.test(typeof v === 'string' ? v : '')) return '.+?';
    return typeof v === 'string' ? escape(v) : `(?:${v.source.replace(/^\^|\$$/g, '')})`;
  }).join('');
}

function inUiText(english: string, depth: number): string | RegExp {
  const words = english.trim();
  const same = lines().filter((l) => !l.names.length && l.en === words);
  if (same.length) return oneOf(same.map((l) => l.film));
  if (depth > 1) return english;
  // A line with values in it: the most particular line it fits.
  const fits = lines().filter((l) => l.names.length && l.literal >= 3 && l.pattern.test(words));
  const best = Math.max(0, ...fits.map((l) => l.literal));
  const chosen = fits.filter((l) => l.literal === best);
  if (!chosen.length) return english;
  const sources = [...new Set(chosen.map((l) => {
    const got = l.pattern.exec(words)!.slice(1);
    const values = Object.fromEntries(l.names.map((n, i) => [n, inUiText(got[i]!, depth + 1)]));
    return filmPattern(l, values);
  }))];
  const r = new RegExp(`^(?:${sources.join('|')})$`, 's');
  made.add(r);
  return r;
}

/** A pattern's plain runs of words, and the rest. */
function runs(source: string): { text: string; plain: boolean }[] {
  const out: { text: string; plain: boolean }[] = [];
  const push = (text: string, plain: boolean) => {
    const last = out.at(-1);
    if (last && last.plain === plain) last.text += text; else out.push({ text, plain });
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (c === '\\') {
      const next = source[i + 1] ?? '';
      i++;
      if (/[dDwWsSbB0-9pPuxk]/.test(next)) { push(c + next, false); continue; }
      if (/[?*+{]/.test(source[i + 1] ?? '')) { push(c + next, false); continue; }
      push(next, true);
      continue;
    }
    if (c === '[') { const end = source.indexOf(']', i + 1); push(source.slice(i, end + 1), false); i = end; continue; }
    if ('^$.*+?(){}|'.includes(c)) {
      // A quantifier takes the letter before it out of the plain run.
      if ('*+?{'.includes(c) && out.at(-1)?.plain) { const last = out.at(-1)!; const letter = last.text.slice(-1); last.text = last.text.slice(0, -1); if (!last.text) out.pop(); push(escape(letter), false); }
      push(c, false);
      continue;
    }
    push(c, true);
  }
  return out;
}

function inUiPattern(english: RegExp): RegExp {
  if (keptAsIs.has(english) || made.has(english)) return english;
  const anchored = english.source.startsWith('^');
  const ended = english.source.endsWith('$') && !english.source.endsWith('\\$');
  // Every line of the app the pattern fits, its values filled with a number or a word.
  const fits = lines().filter((l) => l.literal >= 4 && ['1', 'Ab', '1–2'].some((v) => english.test(l.en.replace(/\{\{[^}]*\}\}/g, v))));
  let source: string;
  if (fits.length && fits.length <= 6) {
    source = `${anchored ? '^' : ''}(?:${[...new Set(fits.map((l) => filmPattern(l, {})))].join('|')})${ended ? '$' : ''}`;
  } else {
    // Otherwise the app's words inside it, swapped one by one.
    source = runs(english.source).map((r) => {
      if (!r.plain) return r.text;
      let text = r.text;
      const known = lines().filter((l) => !l.names.length && l.en.length >= 3 && /^[A-Z]/.test(l.en) && text.includes(l.en)).sort((a, b) => b.en.length - a.en.length);
      const swaps: string[] = [];
      for (const l of known) {
        const films = [...new Set(lines().filter((m) => !m.names.length && m.en === l.en).map((m) => m.film))];
        if (!new RegExp(`(^|\\W)${escape(l.en)}(\\W|$)`).test(text)) continue;
        text = text.replace(l.en, `\u0000${swaps.length}\u0000`);
        swaps.push(films.length === 1 ? escape(films[0]!) : `(?:${films.map(escape).join('|')})`);
      }
      return escape(text).replace(/\u0000(\d+)\u0000/g, (_, i: string) => swaps[Number(i)]!);
    }).join('');
  }
  const r = new RegExp(source.replace(/\\d/g, DIGIT), english.flags);
  made.add(r);
  return r;
}

/** What the screen shows in the film's language for what a script wrote in English. */
export function inUi<T extends string | RegExp>(english: T): string | RegExp {
  if (FILM_LANGUAGE === 'en') return english;
  return typeof english === 'string' ? inUiText(english, 0) : inUiPattern(english);
}

/** Makes every getByText, getByRole name, getByLabel... of this page look for the film language's words. */
export function findInFilmLanguage(page: Page): void {
  if (FILM_LANGUAGE === 'en') return;
  for (const proto of [Object.getPrototypeOf(page.mainFrame()), Object.getPrototypeOf(page.locator('body')), Object.getPrototypeOf(page.frameLocator('iframe'))]) {
    if (proto.inFilmLanguage) continue;
    proto.inFilmLanguage = true;
    for (const m of ['getByText', 'getByLabel', 'getByPlaceholder', 'getByTitle', 'getByAltText']) {
      const find = proto[m];
      proto[m] = function (this: unknown, words: string | RegExp, options?: object) { return find.call(this, inUi(words), options); };
    }
    const byRole = proto.getByRole;
    proto.getByRole = function (this: unknown, role: string, options?: { name?: string | RegExp }) {
      return byRole.call(this, role, options?.name === undefined ? options : { ...options, name: inUi(options.name) });
    };
  }
}
