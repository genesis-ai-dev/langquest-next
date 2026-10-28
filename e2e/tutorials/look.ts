// What a tutorial video looks like, as text: each step's screen as Playwright
// reads it out (the accessibility tree, steps/NN.txt from a dry run), with
// what changes from one run to the next though the app did not taken out,
// hashed. nightly.ts films a video again only when its look changed.
//
// Taken out: the world's made-up addresses and two-step sign-in keys, which
// are new each run; numbers, months and weekdays, so counts, dates and times
// ("Oct 28, 15:20", "2 min ago") read the same any day; and what the app
// says about saving, uploading and keeping things on the device, which
// follows the network (in the film's language, from the app's catalogs).
// Names in a line are compared as a set, since two people asked at once can
// be listed either way round, and so are the things side by side on a
// screen, since people who joined in the same second can be listed in either
// order. A step's words are read once they stop changing and nothing is
// saving, and without the toast, which comes and goes by the clock (film.ts).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

type Catalog = { [key: string]: string | Catalog };

/** The app's words for a catalog key, in a language, plural forms included (`uploads.barChanges_` is every form). */
function catalogWords(language: string, keys: string[]): string[] {
  let catalog: Catalog;
  try {
    catalog = JSON.parse(readFileSync(path.join('apps', 'mobile', 'src', 'i18n', `${language}.json`), 'utf8')) as Catalog;
  } catch {
    return language === 'en' ? [] : catalogWords('en', keys);
  }
  const found: string[] = [];
  const walk = (node: Catalog, at: string) => {
    for (const [k, v] of Object.entries(node)) {
      const key = at ? `${at}.${k}` : k;
      if (typeof v !== 'string') walk(v, key);
      else if (keys.some((want) => (want.endsWith('_') ? key.startsWith(want) : key === want))) found.push(v);
    }
  };
  walk(catalog, '');
  return found;
}

/** A catalog string as a pattern: its values ({{count}}) match anything. */
const pattern = (words: string) => words.split(/\{\{[^}]*\}\}/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+?');

const statuses = new Map<string, { unsteady: RegExp; kept: RegExp; saving: RegExp }>();

/**
 * The film language's status words. A line about uploading or saving goes
 * (it comes and goes with the network); a passage's "On this device" or
 * "Download for offline" stays, as one word, since a recording heard a moment
 * earlier may or may not be kept yet.
 */
function statusWords(language: string): { unsteady: RegExp; kept: RegExp; saving: RegExp } {
  const known = statuses.get(language);
  if (known) return known;
  const any = (keys: string[]) => catalogWords(language, keys).filter(Boolean).sort((a, b) => b.length - a.length).map(pattern).join('|') || '(?!)';
  const uploads = any(['uploads.allUploaded', 'uploads.uploading', 'uploads.barRecordings_', 'uploads.barChanges_', 'account.sync.waitingUpload', 'reports.freshness']);
  const saved = any(['saved.saved', 'saved.saving']);
  const found = {
    unsteady: new RegExp(`${uploads}|^\\s*- img "(${saved})"`, 'u'),
    kept: new RegExp(any(['offline.passage.downloadingCount', 'offline.downloading', 'offline.download', 'offline.onDevice']), 'gu'),
    saving: new RegExp(`^\\s*- img "(${any(['saved.saving'])})"`, 'mu')
  };
  statuses.set(language, found);
  return found;
}

/** Whether a screen still shows something saving, which film.ts waits out before reading its words. */
export const saving = (screen: string, language = 'en') => statusWords(language).saving.test(screen);

const calendars = new Map<string, RegExp>();

/** The language's month and weekday names, long and short, as the app's dates write them (Intl). */
function calendarWords(language: string): RegExp {
  const known = calendars.get(language);
  if (known) return known;
  const names = new Set<string>();
  for (const month of ['long', 'short'] as const) {
    const format = new Intl.DateTimeFormat(language, { month, timeZone: 'UTC' });
    for (let m = 0; m < 12; m += 1) names.add(format.format(Date.UTC(2026, m, 15)).replace(/\.$/, ''));
  }
  for (const weekday of ['long', 'short'] as const) {
    const format = new Intl.DateTimeFormat(language, { weekday, timeZone: 'UTC' });
    for (let d = 0; d < 7; d += 1) names.add(format.format(Date.UTC(2026, 1, 1 + d)).replace(/\.$/, ''));
  }
  const words = [...names].filter(Boolean).sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const found = new RegExp(`(?<![\\p{L}\\p{M}])(${words.join('|')})(?![\\p{L}\\p{M}])`, 'gu');
  calendars.set(language, found);
  return found;
}

/** One line of a step's screen, as the look compares it, in the film's language. */
export function steadyLine(line: string, language = 'en'): string | null {
  const status = statusWords(language);
  if (status.unsteady.test(line)) return null;
  const indent = line.length - line.trimStart().length;
  const words = line
    .replace(status.kept, 'KEPT')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, 'ADDRESS')
    .replace(/\b[A-Z0-9]{4}( [A-Z0-9]{4}){3,}\b/g, 'KEY')
    .replace(calendarWords(language), 'DATE')
    .replace(/\p{Nd}+/gu, '#')
    .replace(/Just now|(#|\ban?) \w+ ago\b/g, 'WHEN')
    .replace(/[",]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort();
  return `${' '.repeat(indent)}${words.join(' ')}`;
}

type Node = { line: string; under: Node[] };

/**
 * One step's screen as the look compares it: each line made steady, under
 * the line it sits in, with the lines side by side sorted. An unsteady line
 * goes with what sits in it.
 */
export function steadyStep(step: string, language = 'en'): string {
  const root: Node = { line: '', under: [] };
  const open: { indent: number; node: Node | null }[] = [{ indent: -1, node: root }];
  for (const raw of step.split('\n')) {
    if (!raw.trim()) continue;
    const indent = raw.length - raw.trimStart().length;
    while (open[open.length - 1]!.indent >= indent) open.pop();
    const parent = open[open.length - 1]!.node;
    const line = parent ? steadyLine(raw.trimStart(), language) : null;
    const node = line === null ? null : { line, under: [] };
    if (node) parent!.under.push(node);
    open.push({ indent, node });
  }
  const write = (node: Node): string => {
    const under = node.under.map(write).sort();
    return under.length ? `${node.line}{${under.join('|')}}` : node.line;
  };
  return write(root);
}

/** A video's look: its steps' screens, in order, each made steady, hashed. */
export function lookOf(steps: string[], language = 'en'): string {
  return createHash('sha256').update(JSON.stringify(steps.map((step) => steadyStep(step, language)))).digest('hex');
}

/**
 * Whether a video that may have changed is tried again, from the looks of
 * its tries so far and its film's. A screen read while it was still changing
 * can make one try look different, so a new look counts once two tries agree
 * on it, or the third try still differs from the film.
 */
export function tryAgain(tries: readonly string[], film: string | undefined): boolean {
  const last = tries[tries.length - 1];
  return film !== undefined && last !== undefined && last !== film && tries.indexOf(last) === tries.length - 1 && tries.length < 3;
}
