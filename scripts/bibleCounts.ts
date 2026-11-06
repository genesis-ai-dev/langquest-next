// How many Bibles and New Testaments are complete in each app
// (scripts/bible-counts.ts, LAN-231). Pure, so what counts as complete is
// tested: every verse of the 66 books or of the 27, checked by exact verse
// count, never by a percent that rounded up to 100.
import { BIBLE_BOOKS, bookOfVerse, inScope, SCOPE_VERSES, unitVerses, type LanguageState } from '@langquest-next/core';
import { bucketName, metadataOf, type V2Asset, type V2Placement, type V2ProjectRows, type V2Quest } from '@langquest-next/v2-import';

type Scope = 'nt' | 'bible';
type Measure = 'recorded' | 'approved';
const SCOPES: Scope[] = ['nt', 'bible'];

/** One language in one app. A percent is 100 only when every verse of the scope is there. */
export interface LanguageCount {
  name: string;
  /** Its organization in Next, its projects in v2. */
  where: string;
  /** Not on the public list in Next, a private project in v2: Caleb decides before its name leaves the team. */
  notPublic: boolean;
  /** Its name looks like a test; it stays in the count, marked, for a person to look at. */
  testLike: boolean;
  notes: string[];
  percent: Record<Measure, Record<Scope, number>>;
}

/** A percent with one decimal, rounded down: 99.99 reads 99.9, never 100. */
const floorPct = (n: number, total: number) => Math.floor((1000 * n) / total) / 10;
const TEST_NAME = /\b(test|tests|testing|demo|sample|dev|e2e|fixture|qa)\b/i;
export const looksLikeTest = (name: string | null | undefined) => TEST_NAME.test(name ?? '');

// ---- read-only ------------------------------------------------------------------------

const WRITES = /\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|copy|call|do|execute|set_config|nextval|setval|lo_\w+)\b|\bpg_\w+\s*\(/i;

/**
 * One plain SELECT, or the SQL is not sent. `supabase db query --linked`
 * logs in as a role that could write and offers no read-only mode, so what
 * keeps this read-only is that it can only ever send this.
 */
export function assertOnlyReads(sql: string): string {
  const s = sql.trim();
  if (!/^(select|with)\b/i.test(s) || s.includes(';') || WRITES.test(s)) throw new Error(`Refusing to send anything but one plain SELECT:\n${s}`);
  return s;
}

// ---- LangQuest Next -------------------------------------------------------------------

/** One row of NEXT_REPORTS: what the projection pass folded for a language (decisions.md 142). */
export interface NextReportRow {
  org_id: string;
  org_name: string | null;
  language_id: string;
  language_name: string | null;
  listed: boolean;
  seq: number;
  head: number | null;
  coverage: { done: Record<Scope, number> };
  /** By scope: verses first covered by a published version, per day. Exact, where `coverage` is rounded. */
  days: Record<Scope, [day: string, verses: number][]>;
  books: { bookId: string | null; total: number; done: number }[];
}

export const NEXT_REPORTS = `
  select i.org_id, n.name as org_name, i.language_id, l.name as language_name, coalesce(v.listed, false) as listed,
    i.seq, c.next_seq - 1 as head,
    i.inputs -> 'coverage' as coverage, i.inputs -> 'coverageDays' as days, i.inputs -> 'books' as books
  from public.language_report_inputs i
  left join public.org_names n on n.org_id = i.org_id
  left join public.language_visibility v on v.org_id = i.org_id and v.language_id = i.language_id
  left join public.stream_cursors c on c.org_id = i.org_id and c.stream_id = i.language_id
  left join lateral (
    select e.payload ->> 'name' as name from public.events e
    where e.stream_id = '_org' and e.org_id = i.org_id and e.type in ('v1.LanguageAdded', 'v1.LanguageRenamed')
      and e.payload ->> 'languageId' = i.language_id
    order by e.hlc desc limit 1
  ) l on true`;

/** Every language in Next, for the ones the pass has stored no report of yet. */
export const NEXT_LANGUAGES = `
  select distinct org_id, payload ->> 'languageId' as language_id from public.events
  where stream_id = '_org' and type = 'v1.LanguageAdded'`;

/** The first copy a move left behind holds the same work as the new one (docs/v2-import.md). */
export const V2_MOVES = 'select from_org, from_language, to_org, to_language from v2_import.moves';

/** What the board says of each v2 project: its language, chosen by a person. */
export const V2_PLACEMENTS = `
  select p.project_id, p.languoid_id::text as languoid_id, l.name as language_name
  from v2_import.placements p left join public.languoid l on l.id = p.languoid_id`;

const bookIndex = (itemId: string | null) => BIBLE_BOOKS.findIndex((b) => b.itemId === itemId);

export function nextCount(row: NextReportRow): LanguageCount {
  const notes: string[] = [];
  const percent = { recorded: { nt: 0, bible: 0 }, approved: { nt: 0, bible: 0 } };
  for (const scope of SCOPES) {
    const verses = row.days[scope].reduce((n, [, v]) => n + v, 0);
    percent.recorded[scope] = floorPct(verses, SCOPE_VERSES[scope]);
    // Done is stored rounded: up to a few verses short still reads 100. All recorded, and every passage of the scope done, is exact.
    const stored = row.coverage.done[scope];
    const finished = row.books.every((b) => { const i = bookIndex(b.bookId); return i < 0 || !inScope(scope, i) || b.done === b.total; });
    percent.approved[scope] = stored < 100 || (verses === SCOPE_VERSES[scope] && finished) ? stored : 99.9;
    if (percent.approved[scope] !== stored) notes.push(`${scope}: reads 100% approved, but a passage or verse is not done. Look at this language by hand.`);
  }
  // Both are bigint, which may come as text.
  const behind = row.head === null ? 0 : Number(row.head) - Number(row.seq);
  if (behind > 0) notes.push(`its report is ${behind} events behind`);
  return {
    name: row.language_name ?? row.language_id, where: row.org_name ?? row.org_id, notPublic: !row.listed,
    testLike: looksLikeTest(row.language_name) || looksLikeTest(row.org_name), notes, percent
  };
}

// ---- LangQuest v2 ---------------------------------------------------------------------

/** v2's book ids and USFM's, as LangQuest's Bible names the book. */
const BOOK_ALIAS: Record<string, string> = { mrk: 'mar', jhn: 'joh', jol: 'joe', nam: 'nah', php: 'phi' };

/** Verses of "3", "3:1-21" or "1:1-2:3" in a book, read as the reports read a hand-added passage's label. */
export function versesIn(book: string, range: string): number[] {
  const id = book.toLowerCase();
  const b = BIBLE_BOOKS[bookIndex(BOOK_ALIAS[id] ?? id)];
  if (!b) return [];
  const key = `count:${b.itemId}:${range}`;
  return unitVerses({ units: { [key]: { label: `${b.label} ${range}` } } } as unknown as LanguageState, key);
}

/** A live chapter or FIA passage quest: its book, its verses, and its chapter when it has just one. */
function questPlace(q: V2Quest, template: string | null): { book: string; chapter: number | null; verses: number[] } | null {
  const meta = metadataOf(q.metadata);
  if (template === 'bible') {
    const { book, chapter } = (meta?.['bible'] ?? {}) as { book?: string; chapter?: number };
    return book && chapter ? { book, chapter: Number(chapter), verses: versesIn(book, String(chapter)) } : null;
  }
  const { bookId, verseRange } = (meta?.['fia'] ?? {}) as { bookId?: string; verseRange?: string };
  if (!bookId || !verseRange) return null;
  const m = /^(\d+):\d+[a-z]?-(?:(\d+):)?\d+[a-z]?$/.exec(verseRange);
  return { book: bookId, chapter: m && (!m[2] || m[2] === m[1]) ? Number(m[1]) : null, verses: versesIn(bookId, verseRange) };
}

export interface V2Verses {
  recorded: Set<number>;
  approved: Set<number>;
  /** Chapters where no recording says which verses it holds: the recordings count for the whole chapter. */
  wholeChapters: number;
}

/**
 * The verses a Bible or FIA project holds, verse by verse. It picks rows as
 * the import does (`mapProject`): live quests, active assets, the project's
 * own recordings and not its source material, and for source material the
 * translations hanging off it. A recording counts when a file of it reached
 * v2's bucket. It is approved with an up vote and no down vote.
 */
export function v2Verses(rows: V2ProjectRows): V2Verses {
  const target = rows.languages.find((l) => l.active && l.language_type === 'target')?.languoid_id ?? null;
  const sources = new Set(rows.languages.filter((l) => l.active && l.language_type === 'source').map((l) => l.languoid_id));
  const assets = new Map(rows.assets.filter((a) => a.active && a.visible !== false).map((a) => [a.id, a]));
  const contentsOf = groupBy(rows.contents.filter((c) => c.active), (c) => c.asset_id);
  const votesOf = groupBy(rows.votes.filter((v) => v.active), (v) => v.asset_id);
  const childrenOf = groupBy([...assets.values()].filter((a) => a.source_asset_id), (a) => a.source_asset_id!);
  const placed = groupBy(rows.placements.filter((p) => p.active && p.visible && assets.has(p.asset_id)), (p) => p.quest_id);

  const hasAudio = (a: V2Asset) => (contentsOf.get(a.id) ?? []).some((c) => (c.audio ?? []).some((f) => bucketName(f)));
  const isApproved = (a: V2Asset) => {
    const votes = votesOf.get(a.id) ?? [];
    return votes.some((v) => v.polarity === 'up') && !votes.some((v) => v.polarity === 'down');
  };
  const isMaterial = (a: V2Asset) => {
    const counts = new Map<string, number>();
    for (const c of contentsOf.get(a.id) ?? []) {
      const l = c.languoid_id ?? c.source_language_id;
      if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
    }
    const language = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? null;
    return language !== null && language !== target && sources.has(language);
  };
  const marked = (p: V2Placement, a: V2Asset, place: NonNullable<ReturnType<typeof questPlace>>): number[] | null => {
    const verse = (metadataOf(p.metadata) ?? metadataOf(a.metadata))?.['verse'] as { from?: unknown; to?: unknown } | undefined;
    const from = Number(verse?.from);
    const to = Number(verse?.to ?? verse?.from);
    if (!place.chapter || !Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) return null;
    return versesIn(place.book, `${place.chapter}:${from}-${to}`);
  };

  const out: V2Verses = { recorded: new Set(), approved: new Set(), wholeChapters: 0 };
  for (const q of rows.quests) {
    if (!q.active || q.visible === false || q.duplicate_of) continue;
    const place = questPlace(q, rows.project.template);
    if (!place) continue;
    const takes = (placed.get(q.id) ?? []).flatMap((p) => {
      const a = assets.get(p.asset_id)!;
      if (a.source_asset_id) return [];
      const verses = marked(p, a, place);
      return (isMaterial(a) ? childrenOf.get(a.id) ?? [] : [a]).filter(hasAudio).map((take) => ({ verses, approved: isApproved(take) }));
    });
    if (takes.length === 0) continue;
    const withVerses = takes.filter((t) => t.verses);
    if (withVerses.length === 0) out.wholeChapters += 1;
    const said = withVerses.length > 0 ? withVerses : [{ verses: place.verses, approved: takes.every((t) => t.approved) }];
    for (const t of said) {
      for (const v of t.verses!) {
        out.recorded.add(v);
        if (t.approved) out.approved.add(v);
      }
    }
  }
  return out;
}

export interface V2Project {
  id: string;
  name: string;
  private: boolean;
  /** The language a person chose for it (docs/v2-project-languages.md); v2's own and the CSV's suggestion are never used. */
  language: { id: string; name: string | null } | null;
  verses: V2Verses;
}

/** v2's projects as languages: projects of one chosen language count together, and one with none chosen stands alone. */
export function v2Counts(projects: V2Project[]): LanguageCount[] {
  return [...groupBy(projects, (p) => p.language?.id ?? `project:${p.id}`).values()].map((group) => {
    const recorded = new Set(group.flatMap((p) => [...p.verses.recorded]));
    const approved = new Set(group.flatMap((p) => [...p.verses.approved]));
    const first = group[0]!;
    const whole = group.reduce((n, p) => n + p.verses.wholeChapters, 0);
    return {
      name: first.language?.name ?? first.name, where: group.map((p) => p.name).join(', '),
      notPublic: group.some((p) => p.private), testLike: group.every((p) => looksLikeTest(p.name)),
      notes: [...(first.language ? [] : ['language not confirmed: this is the project\'s name']), ...(whole ? [`${whole} chapters have recordings that do not say their verses, and count as whole chapters`] : [])],
      percent: { recorded: scopePercents(recorded), approved: scopePercents(approved) }
    };
  });
}

function scopePercents(verses: Set<number>): Record<Scope, number> {
  const inIt = (scope: Scope) => [...verses].filter((v) => inScope(scope, bookOfVerse(v))).length;
  return { nt: floorPct(inIt('nt'), SCOPE_VERSES.nt), bible: floorPct(inIt('bible'), SCOPE_VERSES.bible) };
}

function groupBy<T, K>(items: readonly T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const t of items) {
    const k = key(t);
    const list = out.get(k);
    if (list) list.push(t);
    else out.set(k, [t]);
  }
  return out;
}

// ---- the answer -----------------------------------------------------------------------

export interface AppCount {
  bibles: LanguageCount[];
  newTestaments: LanguageCount[];
  /** The nearest to a complete New Testament that have not finished it. */
  nearest: LanguageCount[];
}

export function appCount(rows: LanguageCount[], measure: Measure): AppCount {
  const nt = (r: LanguageCount) => r.percent[measure].nt;
  return {
    bibles: rows.filter((r) => r.percent[measure].bible === 100),
    newTestaments: rows.filter((r) => nt(r) === 100),
    nearest: rows.filter((r) => nt(r) > 0 && nt(r) < 100).sort((a, b) => nt(b) - nt(a) || a.name.localeCompare(b.name)).slice(0, 5)
  };
}

/** A language's name as the tables show it: `*` not public, `?` looks like a test. */
const shown = (r: LanguageCount) => `${r.name}${r.notPublic ? '*' : ''}${r.testLike ? '?' : ''}`;

function table(next: LanguageCount[] | null, v2: LanguageCount[] | null, measure: Measure): string[] {
  const line = (app: string, rows: LanguageCount[] | null) => {
    if (!rows) return `| ${app} | could not read | could not read | could not read |`;
    const c = appCount(rows, measure);
    const nearest = c.nearest.map((r) => `${shown(r)} ${r.percent[measure].nt.toFixed(1)}%`).join(', ') || 'none';
    return `| ${app} | ${c.bibles.length} | ${c.newTestaments.length} | ${nearest} |`;
  };
  return [
    '| App | Whole Bibles complete | New Testaments complete | Five languages nearest a complete New Testament |',
    '| --- | --- | --- | --- |',
    line('LangQuest Next', next),
    line('LangQuest (v2)', v2)
  ];
}

export interface Report {
  at: string;
  next: LanguageCount[] | null;
  v2: LanguageCount[] | null;
  /** What a person must weigh before the numbers go out, one line each. */
  warnings: string[];
}

export function render({ at, next, v2, warnings }: Report): string {
  const complete = (rows: LanguageCount[] | null, measure: Measure, scope: Scope) =>
    (rows ?? []).filter((r) => r.percent[measure][scope] === 100).map((r) => `- ${shown(r)} (${r.where})`);
  const noted = [...(next ?? []), ...(v2 ?? [])].filter((r) => r.notes.length > 0 && r.percent.recorded.nt > 0);
  const near = [...appCount(next ?? [], 'approved').nearest, ...appCount(next ?? [], 'recorded').nearest, ...appCount(v2 ?? [], 'approved').nearest, ...appCount(v2 ?? [], 'recorded').nearest];
  return [
    '# How many Bibles are complete in LangQuest', '',
    `Read ${at}. This script only reads.`, '',
    '## The answer: recorded and approved', '',
    ...table(next, v2, 'approved'), '',
    '## The same count, recorded only (approval left out)', '',
    ...table(next, v2, 'recorded'), '',
    'A whole Bible also counts as a New Testament. `*` means the work is not public: decide before you say its name. `?` means the name looks like a test.', '',
    '## Which ones are complete', '',
    '**Next, New Testament, recorded and approved**', ...orNone(complete(next, 'approved', 'nt')), '',
    '**Next, New Testament, recorded**', ...orNone(complete(next, 'recorded', 'nt')), '',
    '**v2, New Testament, recorded and approved**', ...orNone(complete(v2, 'approved', 'nt')), '',
    '**v2, New Testament, recorded**', ...orNone(complete(v2, 'recorded', 'nt')), '',
    '## Look at these before you share', '',
    ...orNone(warnings.map((w) => `- ${w}`)), '',
    '**The languages in the tables, and where they are**',
    ...orNone([...new Set(near.map((r) => `- ${shown(r)}: ${r.where}`))]), '',
    '**Notes on single languages**',
    ...orNone(noted.map((r) => `- ${shown(r)} (${r.where}): ${r.notes.join('; ')}`)), '',
    '## How this counts', '',
    '- The count is 31,102 verses for the whole Bible and 7,957 for the New Testament, in LangQuest\'s numbering.',
    '- Next: the numbers come from the report each language already has, which the server makes by reading all its events.',
    '- Next: recorded means a passage has a published version. Approved means the passage is done through its language\'s flow. With no flow, recorded is done.',
    '- Next: a passage counts for all its verses, so a chapter with a part recorded counts whole.',
    '- v2: only projects made from the Bible or FIA template are counted. Other projects do not say which verses they hold.',
    '- v2: a recording counts for the verses it says it holds, and for the whole chapter when no recording of that chapter says.',
    '- v2: approved means a recording has an up vote and no down vote.',
    '- Projects that came over from v2 are in both rows. Do not add the rows together.',
    ''
  ].join('\n');
}

const orNone = (lines: string[]) => (lines.length > 0 ? lines : ['- none']);
