// The choices behind the Map (decision 71; screens/map.tsx). Pure, so the
// rules are tested without a screen.
import {
  deriveFlow, derivePassage, highlightsFor, languageInfo, languageProgress, orgClusters, privilegesFor, unitPlace, upNext,
  type LanguageProgress, type LanguageState, type OrgState, type PassageState, type UnitPlace
} from '@langquest-next/core';
import {
  bookMatches, canonBook, canonBooks, chapterTone, matchesFilter, parseQuery, placeMatches,
  type CanonBook, type ChapterTone, type MapFilter, type Testament
} from '../reference/canon';
import { deriveKinds, stepName } from '../i18n/coreText';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { indexesFor } from '../sync/indexes';
import { languageFigures, oldestAsOf } from '../org/orgFigures';
import { filterByCluster, type ClusterFilter } from '../clusters/model';
import { workIcon } from '../work/homeModel';
import type { IconName } from '../ui/kit';

/** Passages and rows a list shows before "Show more". */
export const PAGE = 25;
/** The key of the group for passages that sit in no book. */
export const OTHER = 'other';

const fmt = (n: number) => formatNumber(n);

/**
 * Languages this person may open: those a role of theirs covers, at the
 * organization's scope or the language's own. Opening any other leaves the
 * session with no privileges at all, which the app reads as having no
 * organization: no tabs and no home (NAV-042). Progress and the Map's
 * language chips list only these.
 */
export function openableLanguages<L extends { languageId: string }>(org: OrgState | null, actorId: string, languages: readonly L[]): L[] {
  if (!org) return [];
  return languages.filter((l) => privilegesFor(org, actorId, l.languageId).size > 0);
}

/**
 * A language's map says it needs a connection (MAP-033, decision 61): the
 * language showing is the one this phone has open, it has not been read from
 * the server this session, the server cannot be reached, and nothing of it is
 * on this device to show.
 */
export function needsConnection(o: { showing: string | null; open: string; pulled: boolean; online: boolean | null; empty: boolean }): boolean {
  return o.showing === o.open && !o.pulled && o.online === false && o.empty;
}

// ---- spoken labels --------------------------------------------------------------------

/** Sentences of a spoken label, one after another: "Luke. 3 of 9 recorded". */
export const sentences = (parts: string[]) => parts.reduce((first, next) => t('map.joinSentences', { first, next }));
/** Clauses of a spoken label, one after another: "Chapter 3: Done, 2 parts". */
export const clauses = (parts: string[]) => parts.reduce((first, next) => t('map.joinClauses', { first, next }));

/** How long ago the server's figures are from, as people say it: "5 minutes ago". */
export function agoWords(iso: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return t('map.ago.justNow');
  if (s < 3600) return t('map.ago.minutes', { count: Math.floor(s / 60) });
  if (s < 86_400) return t('map.ago.hours', { count: Math.floor(s / 3600) });
  return t('map.ago.days', { count: Math.floor(s / 86_400) });
}

/** A filter's name, as its chip says it. */
export function filterLabel(f: MapFilter): string {
  switch (f) {
    case 'all': return t('map.filters.all');
    case 'feedback': return t('map.filters.feedback');
    case 'waiting': return t('map.filters.waiting');
    case 'review': return t('map.filters.review');
    case 'done': return t('map.filters.done');
    case 'todo': return t('map.filters.todo');
  }
}

/** How many passages match a filter, as a book's spoken label says it: "3 with feedback". */
export function matchingWords(f: MapFilter, count: number): string {
  switch (f) {
    case 'all': return t('map.passages', { count });
    case 'feedback': return t('map.matching.feedback', { count });
    case 'waiting': return t('map.matching.waiting', { count });
    case 'review': return t('map.matching.review', { count });
    case 'done': return t('map.matching.done', { count });
    case 'todo': return t('map.matching.todo', { count });
  }
}

/** What each tone is called, for a tile's spoken label. */
export function toneLabel(tone: ChapterTone): string {
  switch (tone) {
    case 'done': return t('map.tones.done');
    case 'feedback': return t('map.tones.feedback');
    case 'review': return t('map.tones.review');
    case 'drafting': return t('map.tones.drafting');
    case 'todo': return t('map.tones.todo');
    case 'none': return t('map.tones.none');
  }
}

// ---- one language's passages, read once per revision ---------------------------------

export interface Entry {
  unitId: string;
  place: UnitPlace;
  s: PassageState;
}

const entryCache = new WeakMap<LanguageState, Entry[]>();

/** Books of the language waiting to be broken up (decision 74), as the app's book ids ("rut"). */
export function waitingBooks(state: LanguageState): string[] {
  return indexesFor(state).waiting.map((unitId) => unitPlace(state, unitId).bookId).filter((b): b is string => !!b);
}

/** Every passage the open language works on, with where it sits and where it stands; shared by the map and its books. */
export function languageEntries(state: LanguageState): Entry[] {
  const hit = entryCache.get(state);
  if (hit) return hit;
  const idx = indexesFor(state);
  const out = idx.passages.map((unitId) => ({ unitId, place: unitPlace(state, unitId), s: derivePassage(state, unitId, idx) }));
  entryCache.set(state, out);
  return out;
}

/** What this person may do on a language, as the highlights ask for it. */
export interface MapCaps { canRecord: boolean; canReview: boolean }

/** Passages with something for this person on My Work: marked on the map, not listed (ADR-017). */
export function forYouIds(state: LanguageState | null, actorId: string, caps: MapCaps): Set<string> {
  return new Set(state ? highlightsFor(state, actorId, caps, indexesFor(state)).map((h) => h.unitId) : []);
}

/**
 * This person's next passage on the map (demo Map's "Next"): the first thing
 * waiting on them, as on My Work, or else a good place to start.
 */
export function nextPassage(state: LanguageState | null, actorId: string, caps: MapCaps): { unitId: string; icon: IconName } | null {
  if (!state || (!caps.canRecord && !caps.canReview)) return null;
  const idx = indexesFor(state);
  const first = highlightsFor(state, actorId, caps, idx)[0];
  if (first) return { unitId: first.unitId, icon: workIcon(first.kind).icon };
  const next = upNext(state, caps, idx);
  return next ? { unitId: next.unitId, icon: next.kind === 'record' ? 'mic' : 'check' } : null;
}

export function flowLabel(state: LanguageState): string {
  const flow = deriveFlow(state);
  return flow.steps.length ? flow.name : t('map.noFlow');
}

export function languageCode(org: OrgState | null, languageId: string): string {
  return (languageInfo(org, languageId)?.code || languageId).slice(0, 3).toUpperCase();
}

/**
 * The open language's state, or null while it is loading or another one is
 * opening: a `languageId` param opens that language's stream, and until it
 * has, the state on hand is the previous language's.
 */
export function openState(open: { languageId: string | null; state: LanguageState | null }, languageId: string | null): LanguageState | null {
  return languageId && languageId === open.languageId ? open.state : null;
}

// ---- the progress overview (MAP-8) -----------------------------------------------------

/** One language in the overview: its figures from this phone or the server, as of when. */
export interface StatusLanguage {
  languageId: string;
  /** This phone has it open, so its figures are its own and exact. */
  here: boolean;
  name: string;
  code: string;
  flow: string;
  progress: LanguageProgress | null;
  asOf: string | null;
  stepNames: string[] | undefined;
}

/**
 * The overview's languages, by name: the open one with this phone's own
 * figures and its steps named in the language showing (core names them in
 * English), the rest with the server's, as of when it last caught up.
 */
export function statusLanguages(o: {
  listed: readonly { languageId: string; name: string }[]; state: LanguageState | null; openId: string | null;
  org: OrgState | null; summary: Parameters<typeof languageFigures>[2];
}): StatusLanguage[] {
  const { state, org } = o;
  const openId = state ? o.openId : null;
  const ids = o.listed.map((l) => l.languageId);
  const local = new Map(state && openId ? [[openId, languageProgress(state, indexesFor(state))]] : []);
  const figures = languageFigures(ids, local, o.summary);
  const stepNames = state ? deriveFlow(state).steps.map((st) => stepName(deriveKinds(state), st)) : undefined;
  return o.listed.map(({ languageId, name }) => {
    const here = languageId === openId;
    const f = figures.get(languageId);
    return {
      languageId, here, name, code: languageCode(org, languageId),
      flow: here ? flowLabel(state!) : '', progress: f?.progress ?? null, asOf: f?.asOf ?? null,
      stepNames: here ? stepNames : undefined
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The clusters among the languages listed here, the cluster filter in force
 * (one that holds none of them falls back to all), the languages it keeps
 * and how many are in no cluster (decision 108).
 */
export function clusterView(org: OrgState | null, listedIds: readonly string[], cluster: ClusterFilter) {
  const clusters = orgClusters(org).map((c) => ({ ...c, languageIds: c.languageIds.filter((id) => listedIds.includes(id)) })).filter((c) => c.languageIds.length > 0);
  const filter: ClusterFilter = cluster.kind === 'cluster' && !clusters.some((c) => c.clusterId === cluster.clusterId) ? { kind: 'all' } : cluster;
  const kept = new Set(filterByCluster(org, listedIds, filter));
  const outside = filterByCluster(org, listedIds, { kind: 'none' }).length;
  return { clusters, filter, kept, outside };
}

/**
 * The counts over the languages in view: only those with figures are
 * summed, and `known` says how many that is. `asOf` is the oldest of the
 * server's figures among them.
 */
export function statusTotals(inView: readonly StatusLanguage[]) {
  const known = inView.flatMap((l) => (l.progress ? [l.progress] : []));
  const asOf = oldestAsOf(inView.flatMap((l) => (l.progress ? [{ progress: l.progress, asOf: l.asOf }] : [])));
  return {
    known, asOf,
    total: known.reduce((n, p) => n + p.total, 0),
    recorded: known.reduce((n, p) => n + p.recorded, 0),
    done: known.reduce((n, p) => n + p.done, 0),
    waiting: known.reduce((n, p) => n + p.waiting, 0)
  };
}

/** The languages whose name or code holds what was typed (all of them when nothing was). */
export function searchLanguages(inView: readonly StatusLanguage[], query: string): StatusLanguage[] {
  const q = query.trim().toLowerCase();
  return q ? inView.filter((l) => `${l.name} ${l.code}`.toLowerCase().includes(q)) : [...inView];
}

/** `n` steps of the brand hue, pale to full: later stages read darker (sequential ramp). */
export function stageRamp(n: number): string[] {
  const from = [0xc2, 0xb2, 0xf3], to = [0x4b, 0x2c, 0x9e];
  return Array.from({ length: n }, (_, i) => {
    const f = n === 1 ? 1 : i / (n - 1);
    return '#' + from.map((a, k) => Math.round(a + (to[k]! - a) * f).toString(16).padStart(2, '0')).join('');
  });
}

export interface FunnelRow { label: string; n: number; color: string; checkpoint: boolean }

/** The funnel's rows, in flow order: recorded, each step cleared, then done (when there are steps). `doneColor` is the green of done. */
export function funnelRows(p: LanguageProgress, stepNames: string[] | undefined, doneColor: string): FunnelRow[] {
  const ramp = stageRamp(1 + p.steps.length);
  return [
    { label: t('map.funnel.recorded'), n: p.recorded, color: ramp[0]!, checkpoint: false },
    ...p.steps.map((st, i) => ({ label: stepNames?.[i] ?? st.name, n: st.cleared, color: ramp[i + 1]!, checkpoint: st.checkpoint })),
    ...(p.steps.length ? [{ label: t('map.funnel.done'), n: p.done, color: doneColor, checkpoint: false }] : [])
  ];
}

/** The rows that have something, longest first, so a shorter bar is never hidden behind a longer one. */
export function funnelLayers(rows: readonly FunnelRow[]): (FunnelRow & { i: number })[] {
  return rows.map((r, i) => ({ ...r, i })).filter((r) => r.n > 0).sort((a, b) => b.n - a.n || a.i - b.i);
}

// ---- a language's map (MAP-1..4, MAP-6, MAP-7) ------------------------------------------

export interface BookSummary {
  key: string;
  /** Listed but not broken up yet (decision 74): nothing to record in it until a coordinator breaks it up. */
  waiting?: boolean;
  book: CanonBook | null;
  name: string;
  group: string;
  total: number;
  recorded: number;
  done: number;
  feedback: number;
  matching: number;
  mine: number;
}

export function summarizeBooks(entries: Entry[], filter: MapFilter, forYou: Set<string>, waiting: string[] = []): BookSummary[] {
  const by = new Map<string, BookSummary>();
  for (const id of waiting) {
    const book = canonBook(id);
    if (book) by.set(book.id, { key: book.id, waiting: true, book, name: book.name, group: book.group, total: 0, recorded: 0, done: 0, feedback: 0, matching: 0, mine: 0 });
  }
  for (const e of entries) {
    const book = canonBook(e.place.bookId) ?? null;
    const key = book?.id ?? OTHER;
    let row = by.get(key);
    if (!row) {
      row = { key, book, name: book?.name ?? t('map.other'), group: book?.group ?? t('map.other'), total: 0, recorded: 0, done: 0, feedback: 0, matching: 0, mine: 0 };
      by.set(key, row);
    }
    row.total++;
    if (e.s.recorded) row.recorded++;
    if (e.s.done) row.done++;
    if (e.s.awaitingResponse.length) row.feedback++;
    if (matchesFilter(e.s, filter)) row.matching++;
    if (forYou.has(e.unitId)) row.mine++;
  }
  return [...canonBooks().flatMap((b) => by.get(b.id) ?? []), ...(by.get(OTHER) ? [by.get(OTHER)!] : [])];
}

/** What a book row says under its name, and how it reads aloud: "25/97", with a filter set how many match. */
export function bookRowWords(b: BookSummary, filter: MapFilter): { sub: string; label: string } {
  const sub = b.waiting ? t('map.waiting') : b.recorded > 0
    ? b.done ? t('map.book.recordedDone', { recorded: fmt(b.recorded), total: fmt(b.total), done: fmt(b.done) }) : t('map.book.recorded', { recorded: fmt(b.recorded), total: fmt(b.total) })
    : t('map.book.notStarted');
  const label = sentences([b.name, sub, ...(filter !== 'all' ? [matchingWords(filter, b.matching)] : []),
    // With the feedback filter set, "N with feedback" is said once, as the match count.
    ...(b.mine ? [t('map.book.forYou', { count: b.mine })] : []), ...(b.feedback && filter !== 'feedback' ? [t('map.matching.feedback', { count: b.feedback })] : [])]);
  return { sub, label };
}

/** An outline language (lessons, stories): passages in no book, none waiting to be broken up (MAP-6). */
export function isOutline(entries: readonly Entry[], waiting: readonly string[]): boolean {
  return entries.length > 0 && waiting.length === 0 && entries.every((e) => !e.place.bookId);
}

/** An outline language's folders, each with its items, in the order they first appear. */
export function outlineSections(entries: readonly Entry[]): [string, Entry[]][] {
  const by = new Map<string, Entry[]>();
  for (const e of entries) {
    const list = by.get(e.place.bookLabel);
    if (list) list.push(e);
    else by.set(e.place.bookLabel, [e]);
  }
  return [...by.entries()];
}

/** What the map's search finds: books by name, or, once a chapter is typed, the passages there. */
export function mapSearch(query: string, books: readonly BookSummary[], entries: readonly Entry[]) {
  const search = parseQuery(query);
  const searching = query.trim().length > 0;
  const byChapter = search.chapter !== undefined;
  return {
    searching, byChapter,
    bookHits: searching && !byChapter ? books.filter((b) => b.book && bookMatches(b.book, search.book)) : [],
    passageHits: searching && byChapter ? entries.filter((e) => placeMatches(e.place, query)) : []
  };
}

/** A book stays in view under a filter when something in it matches, or it is not broken up yet. */
export function inFilter(b: BookSummary, filter: MapFilter): boolean {
  return filter === 'all' || b.matching > 0 || !!b.waiting;
}

/**
 * The books to list: the testaments there are (New first, demo Map), the
 * one showing (the one picked if the language has it, else the first), its
 * books in the filter, and the books in no testament.
 */
export function mapShelf(books: readonly BookSummary[], filter: MapFilter, picked: Testament | null) {
  const testaments = (['nt', 'ot'] as const).filter((x) => books.some((b) => b.book?.testament === x));
  const shownTestament = picked && testaments.includes(picked) ? picked : testaments[0];
  return {
    testaments, shownTestament,
    visible: books.filter((b) => b.book && b.book.testament === shownTestament && inFilter(b, filter)),
    other: books.find((b) => !b.book && inFilter(b, filter))
  };
}

// ---- one book: a grid of chapters (MAP-5) ---------------------------------------------------

export interface ChapterTile {
  n: number;
  list: Entry[];
  tone: ChapterTone;
  steps: number;
  cleared: number;
  mine: boolean;
  matches: boolean;
}

/** The passages of one book, or, for `other`, those in none. */
export function bookEntries(all: readonly Entry[], bookId: string): Entry[] {
  return all.filter((e) => (bookId === OTHER ? !canonBook(e.place.bookId) : e.place.bookId === bookId));
}

/** The passages a filter lets through. */
export function filterEntries(entries: readonly Entry[], filter: MapFilter): Entry[] {
  return entries.filter((e) => filter === 'all' || matchesFilter(e.s, filter));
}

/**
 * Every chapter of a book, whether or not it holds passages: its passages,
 * its tone, how far recorded ones are through the steps (the least of them,
 * when every one is recorded), whether any is for this person, and whether
 * any matches the filter.
 */
export function chapterTiles(book: CanonBook, entries: readonly Entry[], forYou: ReadonlySet<string>, filter: MapFilter): ChapterTile[] {
  const byChapter = new Map<number, Entry[]>();
  for (const e of entries) for (const n of e.place.chapters) {
    const list = byChapter.get(n);
    if (list) list.push(e);
    else byChapter.set(n, [e]);
  }
  return Array.from({ length: book.chapters }, (_, i) => {
    const n = i + 1;
    const list = byChapter.get(n) ?? [];
    const ss = list.map((e) => e.s);
    const recorded = ss.filter((s) => s.recorded);
    const steps = recorded[0]?.steps.length ?? 0;
    const cleared = recorded.length === ss.length && ss.length ? Math.min(...recorded.map((s) => s.steps.filter((st) => st.complete).length)) : 0;
    return { n, list, tone: chapterTone(ss), steps, cleared, mine: list.some((e) => forYou.has(e.unitId)),
      matches: filter === 'all' || ss.some((s) => matchesFilter(s, filter)) };
  });
}

/** The tiles in rows of `cols`, the last one short. */
export function chapterRows(chapters: readonly ChapterTile[], cols: number): ChapterTile[][] {
  const rows: ChapterTile[][] = [];
  for (let i = 0; i < chapters.length; i += cols) rows.push(chapters.slice(i, i + cols));
  return rows;
}

/**
 * A tile's spoken label: the chapter and its state, then what the three
 * marks leave out (parts, for you, kept on this device, changed since
 * recorded, outside the filter). `kept` is the chapter's passages that are
 * kept on this device; the mark is green only when every kept one is ready
 * (decisions.md 61).
 */
export function tileLabel(c: ChapterTile, kept: readonly { ready: boolean }[], changed: boolean): string {
  const parts = c.list.length;
  const keptWhere = kept.length === parts ? (parts > 1 ? t('map.tile.keptAll') : t('map.tile.kept')) : t('map.tile.keptSome', { count: parts, kept: fmt(kept.length) });
  const keptLabel = kept.length === 0 ? null : kept.every((u) => u.ready) ? keptWhere : t('map.tile.downloading', { kept: keptWhere });
  const state = c.tone === 'review' && c.steps
    ? t('map.tile.stateSteps', { state: toneLabel(c.tone), cleared: fmt(c.cleared), steps: fmt(c.steps) }) : toneLabel(c.tone);
  return clauses([
    t('map.tile.chapter', { n: fmt(c.n), state }),
    ...(parts > 1 ? [t('map.tile.parts', { count: parts })] : []),
    ...(c.mine ? [t('map.tile.forYou')] : []),
    ...(keptLabel ? [keptLabel] : []),
    ...(changed ? [t('map.tile.changedSinceRecorded')] : []),
    ...(c.matches ? [] : [t('map.tile.outsideFilter')])
  ]);
}
