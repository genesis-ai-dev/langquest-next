/**
 * Which numbering each of Bible Brain's Bibles uses (docs/breaking-up-the-bible.md,
 * "Bibles from Bible Brain"): for every Bible with text, its books and their
 * chapters, then the last verse of about forty chapters where the standard
 * numberings part (scripts/bibleSurvey.ts chooses them). A Bible that every
 * chapter read agrees with one numbering gets that numbering; one that none
 * fits is custom, with the nearest and where it parts from it.
 *
 *   npm run bibles:survey -- [--out <dir>] [--resume <survey.json>] [--only ENGESV,HINOVBSI]
 *                            [--limit <n>] [--rate <calls a second>] [--minutes <n>]
 *   npm run bibles:survey -- --full HINOVBSI [--out <dir>]   every chapter of these Bibles
 *
 * Needs BIBLE_BRAIN_ACCESS_KEY; GitHub runs it with the repository's secret
 * (.github/workflows/bible-survey.yml). The app's reference material uses the
 * same key, so calls are paced (`--rate`, 4 a second by default) and a 429
 * waits, never hurries. `--minutes` stops starting Bibles after that long and
 * writes what it has; `--resume` carries on from it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chooseFilesets, coverage, versesOf, type DbpFileset, type Testaments } from '../apps/web/worker/bible';
import {
  chapterKey, chaptersToRead, fits, lastVerseOf, lastVersesOf, SYSTEMS, verdict,
  type Difference, type LastVerses, type System, type Verdict
} from './bibleSurvey';

const VERSIFICATIONS = fileURLToPath(new URL('../library/versifications/', import.meta.url));

/** One Bible as the survey found it. */
export interface Surveyed extends Verdict {
  bibleId: string;
  name: string;
  /** Its name in its own language, when Bible Brain has one. */
  vname?: string;
  /** ISO 639-3. */
  iso: string;
  /** The language's name in English, as Bible Brain gives it. */
  language: string;
  text: Testaments;
  /** The text covers only part of its testaments. */
  partial: boolean;
  books: number;
  /** Books beyond the 66 (Tobit, Sirach, ...). */
  deuterocanon: boolean;
  /** Chapters read, and those Bible Brain had no text for. */
  read: number;
  missing: number;
  /** For --full: the last verse of every chapter. */
  lastVerses?: Record<string, number[]>;
  /**
   * Each book's name as this Bible gives it, in its own language ("उत्पत्ति"),
   * for every book Bible Brain lists. Missing only from a survey made before
   * names were kept; --resume surveys those Bibles again.
   */
  bookNames?: Record<string, string>;
  /** Why it could not be surveyed. */
  failed?: string;
  /** How its chapters were chosen (PLAN); missing on the first survey of 2026-10-30. */
  plan?: number;
}

/**
 * 2: each testament planned alone. The first survey planned a whole Bible
 * as one, which read one New Testament chapter (Romans 16) where a New
 * Testament alone reads thirteen; --resume surveys those Bibles again.
 */
const PLAN = 2;

export interface Survey {
  startedAt: string;
  finishedAt?: string;
  /** False when --minutes or --limit stopped it first. */
  done: boolean;
  /** Bibles Bible Brain lists, and those with no text to read. */
  listed: number;
  withoutText: number;
  bibles: Surveyed[];
}

type Get = (path: string, query?: Record<string, string>) => Promise<{ status: number; body: unknown }>;

const rows = (body: unknown): Record<string, unknown>[] => {
  const d = (body as { data?: unknown } | null)?.data;
  return Array.isArray(d) ? d.filter((x) => x && typeof x === 'object') : [];
};

/**
 * Bible Brain with the key, calls spaced to `perSecond`. A 429 waits a
 * minute, then two, then four; a 5xx or a dropped connection is tried twice
 * more. Errors name the path, never the URL, which holds the key.
 */
function bibleBrain(key: string, perSecond: number): Get {
  let next = 0;
  return async (path, query = {}) => {
    const u = new URL(`https://4.dbt.io/api${path}`);
    u.searchParams.set('v', '4');
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    u.searchParams.set('key', key);
    for (let attempt = 0; ; attempt++) {
      const wait = Math.max(0, next - Date.now());
      next = Math.max(Date.now(), next) + 1000 / perSecond;
      if (wait) await new Promise((r) => setTimeout(r, wait));
      let res: Response;
      try {
        res = await fetch(u, { headers: { accept: 'application/json' } });
      } catch (e) {
        if (attempt >= 2) throw new Error(`Bible Brain ${path}: ${e instanceof Error ? e.name : 'failed'}`);
        continue;
      }
      if (res.status === 429 && attempt < 3) {
        console.log(`  Bible Brain asked us to slow down (${path}); waiting ${2 ** attempt} min`);
        await new Promise((r) => setTimeout(r, 60_000 * 2 ** attempt));
        continue;
      }
      if (res.status >= 500 && attempt < 2) continue;
      return { status: res.status, body: res.ok ? await res.json() : null };
    }
  };
}

/** Every Bible Bible Brain lists, 100 a page. */
async function listBibles(get: Get): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let page = 1; page <= 200; page++) {
    const r = await get('/bibles', { limit: '100', page: String(page) });
    if (r.status !== 200) throw new Error(`Bible Brain /bibles page ${page}: ${r.status}`);
    const list = rows(r.body);
    out.push(...list);
    const meta = (r.body as { meta?: { pagination?: { last_page?: number; total_pages?: number } } }).meta?.pagination;
    const last = Number(meta?.last_page ?? meta?.total_pages ?? page);
    if (page >= last || list.length === 0) break;
  }
  return out;
}

const filesetsOf = (v: unknown): DbpFileset[] =>
  v && typeof v === 'object' ? Object.values(v as Record<string, DbpFileset[]>).flat().filter((f) => f && typeof f.id === 'string') : [];

/** Bible Brain marks the deuterocanon AP; its text is with the Old Testament's. */
const testamentOf = (t: unknown): 'OT' | 'NT' => (t === 'NT' ? 'NT' : 'OT');

const BOOKS_66 = new Set(Object.keys(JSON.parse(readFileSync(join(VERSIFICATIONS, 'rsc.json'), 'utf8')).maxVerses as object));

export async function surveyOne(
  get: Get,
  row: Record<string, unknown>,
  systems: Record<System, LastVerses>,
  full: boolean
): Promise<Surveyed | null> {
  const bibleId = String(row['abbr'] ?? '');
  const filesets = filesetsOf(row['filesets']);
  const { text } = chooseFilesets(filesets);
  if (!text.OT && !text.NT) return null;
  const base = {
    bibleId,
    name: String(row['name'] ?? bibleId).trim(),
    ...(typeof row['vname'] === 'string' && row['vname'].trim() ? { vname: row['vname'].trim() } : {}),
    iso: String(row['iso'] ?? ''),
    language: String(row['language'] ?? row['iso'] ?? ''),
    text
  };
  const sizeOf = (id?: string) => filesets.find((f) => f.id === id && f.type === 'text_plain')?.size ?? '';
  const whole = (['OT', 'NT'] as const).every((t) => !text[t] || coverage(sizeOf(text[t])).whole || sizeOf(text[t]) === 'C');
  const listed = await get(`/bibles/${encodeURIComponent(bibleId)}/book`);
  if (listed.status !== 200) return { ...base, numbering: 'custom', partial: !whole, books: 0, deuterocanon: false, read: 0, missing: 0, failed: `book list: ${listed.status}` };
  const bookNames: Record<string, string> = {};
  for (const b of rows(listed.body)) {
    const book = String(b['book_id'] ?? '');
    const name = typeof b['name'] === 'string' ? b['name'].trim() : '';
    if (/^[A-Z0-9]{3}$/.test(book) && name) bookNames[book] = name;
  }
  const books = rows(listed.body).flatMap((b) => {
    const book = String(b['book_id'] ?? '');
    const chapters = Array.isArray(b['chapters']) ? Math.max(0, ...(b['chapters'] as unknown[]).map(Number).filter(Number.isInteger)) : 0;
    const t = testamentOf(b['testament']);
    return /^[A-Z0-9]{3}$/.test(book) && chapters > 0 && text[t] ? [{ book, chapters, testament: t, fileset: text[t]! }] : [];
  });
  // A text that lacks a testament's books it lists is partial too.
  const partial = !whole || books.length === 0;
  const plan = full
    ? books.flatMap((b) => Array.from({ length: b.chapters }, (_, i) => ({ book: b.book, chapter: i + 1 })))
    // Each testament is planned alone, so a whole Bible reads the same New
    // Testament chapters as a New Testament on its own (2 Corinthians 13,
    // Revelation 12), and the two can be compared.
    : (['OT', 'NT'] as const).flatMap((t) => chaptersToRead(systems, books.filter((b) => b.testament === t)));
  const filesetOf = new Map(books.map((b) => [b.book, b.fileset]));
  const lastVerse: Record<string, number> = {};
  let missing = 0;
  // Four at a time; the pacing keeps the rate.
  for (let i = 0; i < plan.length; i += 4) {
    await Promise.all(plan.slice(i, i + 4).map(async ({ book, chapter }) => {
      const r = await get(`/bibles/filesets/${encodeURIComponent(filesetOf.get(book)!)}/${book}/${chapter}`);
      const last = r.status === 200 ? lastVerseOf(versesOf(rows(r.body))) : 0;
      if (r.status !== 200 && r.status !== 404) throw new Error(`${bibleId} ${book} ${chapter}: ${r.status}`);
      if (!last) missing++;
      lastVerse[chapterKey(book, chapter)] = last;
    }));
  }
  const seen = { books: books.map(({ book, chapters }) => ({ book, chapters })), lastVerse, partial };
  return {
    ...base,
    ...verdict(fits(systems, seen)),
    partial,
    books: books.length,
    deuterocanon: books.some((b) => !BOOKS_66.has(b.book)),
    bookNames,
    read: plan.length,
    missing,
    plan: PLAN,
    ...(full ? {
      lastVerses: Object.fromEntries(books.map((b) => [b.book, Array.from({ length: b.chapters }, (_, i) => lastVerse[chapterKey(b.book, i + 1)] ?? 0)]))
    } : {})
  };
}

/** The app's languages (packages/core uiLanguages.ts), by the ISO 639-3 codes Bible Brain files their Bibles under. */
const APP_LANGUAGES: [string, string[]][] = [
  ['English', ['eng']], ['Spanish', ['spa']], ['Portuguese', ['por']], ['French', ['fra']], ['Arabic', ['arb', 'ara']],
  ['Swahili', ['swh', 'swa']], ['Hausa', ['hau']], ['Amharic', ['amh']], ['Hindi', ['hin']], ['Bengali', ['ben']],
  ['Nepali', ['npi', 'nep']], ['Indonesian', ['ind']], ['Chinese', ['cmn', 'zho']], ['Thai', ['tha']], ['Burmese', ['mya']]
];

const EACH_CUSTOM = '## Custom, each one';

/** How many of each, most first, as "eng 3, custom 1". */
const tally = (keys: string[]) => {
  const n = new Map<string, number>();
  for (const k of keys) n.set(k, (n.get(k) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

const differenceText = (d: Difference) => `${d.at} ${d.saw} not ${d.expected}`;

/**
 * The survey in a few lines a person reads: how many in each numbering, the
 * app's languages, where custom Bibles part from their nearest numbering
 * (one place at a time, then Bibles that part in exactly the same places,
 * which is where a new numbering would come from), and every custom one.
 */
export function report(s: Survey): string {
  const surveyed = s.bibles.filter((b) => !b.failed);
  const custom = surveyed.filter((b) => b.numbering === 'custom');
  const failed = s.bibles.filter((b) => b.failed);
  const fitsAll = surveyed.filter((b) => (b.alsoFits?.length ?? 0) === SYSTEMS.length - 1).length;
  const places = tally(custom.flatMap((b) => (b.differences ?? []).map((d) => `${differenceText(d)} (${b.nearest})`)));
  const groups = new Map<string, Surveyed[]>();
  for (const b of custom) {
    const key = `${b.nearest} | ${(b.differences ?? []).map(differenceText).sort().join(', ')}`;
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  const bigGroups = [...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const TOP = 25;
  return [
    `# Bible Brain numbering survey`,
    '',
    `Started ${s.startedAt}${s.finishedAt ? `, finished ${s.finishedAt}` : ''}${s.done ? '' : ' (not finished: run again with --resume)'}.`,
    `${s.listed} Bibles listed, ${s.withoutText} without text, ${s.bibles.length} surveyed.`,
    ...(fitsAll ? [`${fitsAll} have too little text to tell any numbering from another; they count as eng.`] : []),
    '',
    '| Numbering | Bibles |',
    '| --- | --- |',
    ...tally(surveyed.map((b) => b.numbering)).map(([n, c]) => `| ${n} | ${c} |`),
    '',
    `## The app's languages`,
    '',
    '| Language | Bibles | Numberings |',
    '| --- | --- | --- |',
    ...APP_LANGUAGES.map(([name, isos]) => {
      const here = surveyed.filter((b) => isos.includes(b.iso));
      return `| ${name} | ${here.length} | ${tally(here.map((b) => b.numbering)).map(([n, c]) => `${n} ${c}`).join(', ')} |`;
    }),
    '',
    `## Where custom Bibles part from their nearest numbering`,
    '',
    '| Place: verses in the Bible, not in the numbering | Bibles |',
    '| --- | --- |',
    ...places.slice(0, TOP).map(([p, c]) => `| ${p} | ${c} |`),
    ...(places.length > TOP ? ['', `And ${places.length - TOP} more places.`] : []),
    '',
    `## Custom Bibles that part in exactly the same places`,
    '',
    '| Nearest | Where they part | Bibles | For example |',
    '| --- | --- | --- | --- |',
    ...bigGroups.slice(0, TOP).map(([key, list]) => {
      const [nearest, where] = key.split(' | ') as [string, string];
      return `| ${nearest} | ${where.length > 160 ? `${where.slice(0, 160)}…` : where} | ${list.length} | ${list.slice(0, 3).map((b) => b.bibleId).join(', ')} |`;
    }),
    ...(bigGroups.length > TOP ? ['', `And ${bigGroups.length - TOP} more groups, ${bigGroups.slice(TOP).reduce((n, [, l]) => n + l.length, 0)} Bibles.`] : []),
    '',
    `${EACH_CUSTOM} (${custom.length}): nearest numbering and where each parts from it`,
    '',
    ...custom.map((b) => `- ${b.bibleId} ${b.name} (${b.language}, ${b.iso}${b.partial ? ', partial' : ''}): nearest ${b.nearest}; ${(b.differences ?? []).slice(0, 8).map(differenceText).join(', ')}${(b.differences?.length ?? 0) > 8 ? `, and ${b.differences!.length - 8} more` : ''}`),
    ...(failed.length ? ['', `## Not surveyed (${failed.length})`, '', ...failed.map((b) => `- ${b.bibleId} ${b.name}: ${b.failed}`)] : [])
  ].join('\n') + '\n';
}

async function main(argv: string[]) {
  const value = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const key = process.env['BIBLE_BRAIN_ACCESS_KEY'];
  if (!key) throw new Error('BIBLE_BRAIN_ACCESS_KEY is not set');
  const out = value('out') ?? 'bible-survey';
  const only = new Set((value('only') ?? value('full') ?? '').split(',').filter(Boolean));
  const full = argv.includes('--full');
  const limit = Number(value('limit') ?? Infinity);
  const stopAt = Date.now() + Number(value('minutes') ?? Infinity) * 60_000;
  const get = bibleBrain(key, Number(value('rate') ?? 4));
  const systems = Object.fromEntries(SYSTEMS.map((s) => [s, lastVersesOf(JSON.parse(readFileSync(join(VERSIFICATIONS, `${s}.json`), 'utf8')).maxVerses)])) as Record<System, LastVerses>;

  const resume = value('resume');
  const before: Survey | null = resume && existsSync(resume) ? JSON.parse(readFileSync(resume, 'utf8')) as Survey : null;
  const survey: Survey = { startedAt: before?.startedAt ?? new Date().toISOString(), done: false, listed: 0, withoutText: 0, bibles: before?.bibles ?? [] };
  // A Bible that failed, was surveyed before book names were kept, or had both testaments
  // planned as one (PLAN), is surveyed again.
  survey.bibles = survey.bibles.filter((b) => !b.failed && b.bookNames && (b.plan === PLAN || !(b.text.OT && b.text.NT)));
  const have = new Set(survey.bibles.map((b) => b.bibleId));
  mkdirSync(out, { recursive: true });
  const save = () => {
    writeFileSync(join(out, full ? 'full.json' : 'survey.json'), JSON.stringify(survey, null, 1) + '\n');
    writeFileSync(join(out, full ? 'full.md' : 'survey.md'), report(survey));
  };

  const all = await listBibles(get);
  survey.listed = all.length;
  const todo = all.filter((r) => (only.size ? only.has(String(r['abbr'])) : !have.has(String(r['abbr']))));
  console.log(`${all.length} Bibles listed; ${todo.length} to survey${have.size ? ` (${have.size} done before)` : ''}`);
  let started = 0;
  let stopped = false;
  for (const row of todo) {
    if (started >= limit || Date.now() > stopAt) {
      stopped = true;
      break;
    }
    started++;
    try {
      const s = await surveyOne(get, row, systems, full);
      if (!s) {
        survey.withoutText++;
        continue;
      }
      survey.bibles.push(s);
      console.log(`${String(started).padStart(5)} ${s.bibleId.padEnd(12)} ${s.numbering}${s.nearest ? ` (nearest ${s.nearest}, ${s.differences!.length} apart)` : ''}${s.alsoFits ? ` (also ${s.alsoFits.join(', ')})` : ''}  ${s.language}`);
    } catch (e) {
      survey.bibles.push({ bibleId: String(row['abbr']), name: String(row['name'] ?? ''), iso: String(row['iso'] ?? ''), language: String(row['language'] ?? ''), text: {}, numbering: 'custom', partial: false, books: 0, deuterocanon: false, read: 0, missing: 0, failed: e instanceof Error ? e.message : String(e) });
    }
    if (started % 25 === 0) save();
  }
  survey.done = !stopped;
  if (survey.done) survey.finishedAt = new Date().toISOString();
  save();
  console.log(report(survey).split(EACH_CUSTOM)[0]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
