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
export const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
// Where each script's digits start: Arabic, Persian, Devanagari, Bengali, Myanmar, Thai.
const ZEROS = [0x660, 0x6f0, 0x966, 0x9e6, 0x1040, 0xe50];
const DIGIT_OF = (d: string) => `[${d}${ZEROS.map((z) => `\\u${(z + Number(d)).toString(16).padStart(4, '0')}`).join('')}]`;
const keptAsIs = new WeakSet<RegExp>();
const made = new WeakSet<RegExp>();

/** Words the screen shows as written in every language (a string exactly, or a pattern). */
export function asIs(words: string | RegExp): RegExp {
  const r = typeof words === 'string' ? new RegExp(`^${escape(words)}$`) : new RegExp(words.source, words.flags);
  keptAsIs.add(r);
  return r;
}

/** A value as the film language has it, or as written: a name from the library can be either. */
function eitherOf(found: string | RegExp, english: string): string | RegExp {
  if (found === english) return english;
  const r = new RegExp(`^(?:${typeof found === 'string' ? escape(found) : found.source.replace(/^\^/, '').replace(/\$$/, '')}|${escape(english)})$`);
  made.add(r);
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
    if (v === undefined) return '.+?';
    // A number is written in the film language's digits, perhaps grouped ("1.234").
    if (typeof v === 'string' && /^\d[\d.,]*$/.test(v)) return [...v.replace(/[.,]/g, '')].map((d) => `${DIGIT_OF(d)}[.,\\s\u00a0\u202f\u066c]?`).join('');
    return typeof v === 'string' ? escape(v) : `(?:${v.source.replace(/^\^|\$$/g, '')})`;
  }).join('');
}

function inUiText(english: string, depth: number): string | RegExp {
  const words = english.trim();
  const same = lines().filter((l) => !l.names.length && l.en === words);
  if (same.length) return oneOf(same.map((l) => l.film));
  if (depth > 1) return english;
  if (words.includes(' · ')) return piecewise(words);
  // Pieces joined by a comma ("Parts 1–4, 4 parts"), when the app has every piece.
  if (words.includes(', ')) {
    const english = words.split(', ');
    if (english.every((p) => inUiText(p, 1) !== p)) return piecewise(words, ', ');
  }
  // A numbered row ("1. Peer check"): the number, then the row's words.
  const numbered = /^(\d+\. )(.+)$/.exec(words);
  if (numbered) {
    const rest = inUiText(numbered[2]!, depth);
    if (rest === numbered[2]) return english;
    const r = new RegExp(`^${escape(numbered[1]!)}${typeof rest === 'string' ? escape(rest) : `(?:${rest.source.replace(/^\^/, '').replace(/\$$/, '')})`}$`, 's');
    made.add(r);
    return r;
  }
  // A line with values in it: every line it fits ("Open Version 1" is "Open {{version}}"
  // on one screen and "Open Version {{n}}" on another), the most particular first.
  const chosen = lines().filter((l) => l.names.length && l.literal >= 3 && l.pattern.test(words)).sort((a, b) => b.literal - a.literal).slice(0, 8);
  if (!chosen.length) return english;
  const sources = [...new Set(chosen.map((l) => {
    const got = l.pattern.exec(words)!.slice(1);
    const values = Object.fromEntries(l.names.map((n, i) => [n, eitherOf(inUiText(got[i]!, depth + 1), got[i]!)]));
    return filmPattern(l, values);
  }))];
  const r = new RegExp(`^(?:${sources.join('|')})$`, 's');
  made.add(r);
  return r;
}

/** Words in pieces the app puts together ("Translator · Lumari", "Parts 1–4, 4 parts"), each piece looked up by itself. */
function piecewise(words: string, between = ' · '): string | RegExp {
  const english = words.split(between);
  const pieces = english.map((p) => (p.trim() ? inUiText(p, 1) : p));
  if (pieces.every((p, i) => p === english[i])) return words;
  const r = new RegExp(`^${pieces.map((p) => (typeof p === 'string' ? escape(p) : `(?:${p.source.replace(/^\^/, '').replace(/\$$/, '')})`)).join(between)}$`, 's');
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
  // One group of words to choose from ("^Do the consultant (check|review)$"): each choice by itself.
  const group = /^(\^?)((?:[^()|\\]|\\.)*)\((?:\?:)?((?:[^()\\]|\\.)*)\)((?:[^()|\\]|\\.)*?)(\$?)$/.exec(english.source);
  if (group && group[3]!.includes('|') && group[3]!.split('|').every((a) => runs(a).every((r) => r.plain))) {
    const each = group[3]!.split('|').map((a) => inUiPattern(new RegExp(`${group[1]}${group[2]}${a}${group[4]}${group[5]}`, english.flags)));
    const r = new RegExp(each.map((c) => `(?:${c.source})`).join('|'), english.flags);
    made.add(r);
    return r;
  }
  const anchored = english.source.startsWith('^');
  const ended = english.source.endsWith('$') && !english.source.endsWith('\\$');
  // Plain words (the start of a label, say): those words, as the line they come from has them.
  const parts = runs(english.source);
  const inner = parts.filter((r, i) => !((i === 0 && r.text === '^') || (i === parts.length - 1 && r.text === '$')));
  let plain: string | undefined;
  if (inner.length === 1 && inner[0]!.plain) {
    const found = inner[0]!.text.includes(' · ') ? piecewise(inner[0]!.text) : inUiText(inner[0]!.text, 0);
    if (found !== inner[0]!.text) plain = `${anchored ? '^' : ''}${typeof found === 'string' ? escape(found) : found.source.replace(/^\^/, '').replace(/\$$/, '')}${ended ? '$' : ''}`;
  }
  // Words open at an end ("^Block Peter") can also be the start of a longer line.
  const sampled = plain && anchored && ended ? undefined : bySample(english, anchored, ended);
  if (plain || sampled) {
    const r = new RegExp([plain, sampled].filter(Boolean).map((x) => `(?:${x})`).join('|').replace(/\\d/g, DIGIT), english.flags);
    made.add(r);
    return r;
  }
  // Every line of the app the pattern fits, its values filled with a number or a word,
  // with the values the pattern holds to ("Step 2 of \d+") kept.
  const fills = [...new Set(['1', 'Ab', '1–2', ...(english.source.match(/(?<!\\)\d+/g) ?? [])])];
  const fill = (l: Line, values: string[]) => { let i = 0; return l.en.replace(/\{\{[^}]*\}\}/g, () => values[i++]!); };
  const fits = lines().flatMap((l) => {
    if (l.literal < 4) return [];
    const c = fills.find((v) => english.test(fill(l, l.names.map(() => v))));
    if (c === undefined) return [];
    const values = Object.fromEntries(l.names.flatMap((n, i) => {
      const held = ['7', 'Zq', ''].every((other) => other === c || !english.test(fill(l, l.names.map((_, j) => (j === i ? other : c)))));
      return held ? [[n, c]] : [];
    }));
    return [filmPattern(l, values)];
  });
  let source: string;
  if (fits.length && fits.length <= 6) {
    source = `${anchored ? '^' : ''}(?:${[...new Set(fits)].join('|')})${ended ? '$' : ''}`;
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
  // Some languages put a space before a percent sign ("34 %").
  source = source.replace(/(?<!\\)%/g, '[\\s\\u00a0\\u202f]?%');
  if (source === english.source && !source.includes('\\d')) return english;
  const r = new RegExp(source.replace(/\\d/g, DIGIT), english.flags);
  made.add(r);
  return r;
}

/**
 * A pattern of words and other parts ("^Recorded: \\d+ of \\d+, ") as the app's lines it
 * fits, with its words and its other parts in their places in the film's language. A
 * pattern open at its end (or start) fits the start (or end) of a line.
 */
function bySample(english: RegExp, anchored: boolean, ended: boolean): string | undefined {
  if (!anchored && !ended) return undefined;
  const body = english.source.slice(anchored ? 1 : 0, ended ? -1 : undefined);
  const parts = runs(body);
  if (!parts.some((r) => r.plain) || parts.some((r) => !r.plain && /[()|^$]/.test(r.text.replace(/\\./g, '')))) return undefined;
  // Each part that is not words stands in the sample as one private-use letter.
  const stands: string[] = [];
  const isStand = (c: string) => c >= '\ue000' && c < '\uf000';
  const sample = parts.map((r) => (r.plain ? r.text : String.fromCharCode(0xe000 + stands.push(r.text) - 1))).join('');
  if (anchored && ended && !stands.length) return undefined;
  const value = (got: string): string | RegExp => {
    if (![...got].some(isStand)) return eitherOf(inUiText(got, 2), got);
    const r = new RegExp(`^${[...got].map((c) => (isStand(c) ? `(?:${stands[c.charCodeAt(0) - 0xe000]})` : escape(c))).join('')}$`);
    made.add(r);
    return r;
  };
  // The sample's words before its first other part (and after its last): a line it fits starts (ends) so.
  const lead = sample.split(/[\ue000-\uefff]/)[0]!;
  const tail = sample.split(/[\ue000-\uefff]/).at(-1)!;
  const found: { mixed: number; held: number; literal: number; source: string }[] = [];
  for (const l of lines()) {
    if (l.literal < 3) continue;
    const pieces = l.en.split(PLACE);
    if (anchored && !(lead.startsWith(pieces[0]!) || pieces[0]!.startsWith(lead))) continue;
    if (ended && !(tail.endsWith(pieces.at(-1)!) || pieces.at(-1)!.endsWith(tail))) continue;
    // Where the line may be cut: anywhere but inside a {{value}}.
    const cuts: number[] = [];
    if (anchored && ended) cuts.push(l.en.length);
    else {
      let at = 0;
      for (const piece of pieces) {
        if (placeName(piece)) { at += piece.length; cuts.push(at); continue; }
        for (let k = at === 0 ? 0 : 1; k <= piece.length; k++) cuts.push(at + k);
        at += piece.length;
      }
      // The longest cut that fits first: it holds the most of the sample to the line's words.
      if (anchored) cuts.reverse();
    }
    for (const k of cuts) {
      const cut = anchored ? l.en.slice(0, k) : l.en.slice(k);
      // Some of the line's own words must be in the part that fits, not only its values.
      if (cut.replace(/\{\{[^}]*\}\}/g, '').trim().length < 3) continue;
      const names: string[] = [];
      const source = cut.split(PLACE).map((p) => { const n = placeName(p); if (n) { names.push(n); return '(.+?)'; } return escape(p); }).join('');
      const m = new RegExp(`^${source}$`, 's').exec(sample);
      if (!m) continue;
      const got = m.slice(1);
      // A value of words and other parts together ("2 of \\d+") is a sign of a poor fit.
      const mixed = got.filter((g) => [...g].some(isStand) && /[^\s\ue000-\uefff]/.test(g)).length;
      found.push({ mixed, held: cut.replace(/\{\{[^}]*\}\}/g, '').length, literal: l.literal, source: filmPattern(l, Object.fromEntries(names.map((n, i) => [n, value(got[i]!)]))) });
      break;
    }
  }
  if (!found.length) return undefined;
  found.sort((a, b) => a.mixed - b.mixed || b.held - a.held || a.literal - b.literal);
  const sources = [...new Set(found.filter((f) => f.mixed === found[0]!.mixed).map((f) => f.source))].slice(0, 40);
  return `${anchored ? '^' : ''}(?:${sources.join('|')})${ended ? '$' : ''}`;
}

/** What the screen shows in the film's language for what a script wrote in English. */
export function inUi<T extends string | RegExp>(english: T): string | RegExp {
  if (FILM_LANGUAGE === 'en') return english;
  if (typeof english !== 'string' && (keptAsIs.has(english) || made.has(english))) return forPlaywright(english);
  const found = typeof english === 'string' ? inUiText(english, 0) : inUiPattern(english);
  if (found === english) return english;
  // Or the English: names the screen shows as written (a role, a book, a kind of
  // check from the library) are the app's words too, and stay English there.
  const theirs = typeof found === 'string' ? `^${escape(found)}$` : found.source;
  const ours = typeof english === 'string' ? `^${escape(english.trim())}$` : english.source;
  const r = new RegExp(`(?:${theirs})|(?:${ours})`, typeof found === 'string' ? '' : found.flags);
  made.add(r);
  return forPlaywright(r);
}

// Playwright reads a getByText pattern's i, g and m flags only; with any other it looks for the pattern's text as written.
function forPlaywright(r: RegExp): RegExp {
  if (!r.flags.includes('s')) return r;
  const plain = new RegExp(r.source, r.flags.replace('s', ''));
  made.add(plain);
  return plain;
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
    // Some test ids end in the words a row shows ('invite-role-Translators').
    const byTestId = proto.getByTestId;
    proto.getByTestId = function (this: unknown, testId: string | RegExp) {
      const named = typeof testId === 'string' ? /^(.*?-)([A-Z][^-]*)$/.exec(testId) : null;
      const found = named ? inUiText(named[2]!, 0) : undefined;
      if (!named || found === undefined || found === named[2]) return byTestId.call(this, testId);
      const theirs = typeof found === 'string' ? escape(found) : found.source.replace(/^\^/, '').replace(/\$$/, '');
      return byTestId.call(this, new RegExp(`^${escape(named[1]!)}(?:${theirs}|${escape(named[2]!)})$`));
    };
    const byRole = proto.getByRole;
    proto.getByRole = function (this: unknown, role: string, options?: { name?: string | RegExp }) {
      return byRole.call(this, role, options?.name === undefined ? options : { ...options, name: inUi(options.name) });
    };
  }
}
