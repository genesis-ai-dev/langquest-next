import { bookId, bookLabel, bookOfChapter, bookOfVerse, inScope, SCOPE_VERSES, unitChapters, unitVerses } from './coverage';
import { buildIndexes, type Indexes } from './indexes';
import {
  deriveFlow, deriveKinds, derivePassage, languageProgress, stepName, unitPlace,
  type LanguageProgress, type PassageState
} from './passage';
import { privilegesFor, TARGET_SCOPES, type LanguageInfo, type LanguageTarget, type OrgState, type TargetScope } from './org';
import type { LanguageState } from './state';

/**
 * Progress reports for the web dashboard: one per language, read from the
 * passage record the app shows (`derivePassage`, `languageProgress`), so a
 * coordinator's report and the phone's Status screen never disagree. A pure
 * function of the fold and a date; the dashboard's server computes it from
 * its snapshot of the organization (decision 44), and nothing here is
 * authoritative.
 *
 * Uploads are timed by the server's `BlobStored` confirmation, never the
 * phone's clock (PLAN.md section 14, "measure from server truth"): a card
 * counts on the day it reached the cloud. Coverage is timed by when a
 * passage's first version was published.
 */

/** Bump when the report's shape or meaning changes. */
export const REPORT_VERSION = 5;

/** Weeks of activity and coverage history a report carries, ending with the week that holds `now`. */
export const REPORT_WEEKS = 53;
/** Days of daily upload counts. */
const REPORT_DAYS = 35;
/** Days of the progress line. */
export const PROGRESS_DAYS = 90;
/** Days of the chapter log. */
const LOG_DAYS = 14;
/** Months of the ledger, ending with the month that holds `now`. */
const LEDGER_MONTHS = 13;
/** A recorded card not on the server after this long is stuck on a phone. */
const STUCK_AFTER_DAYS = 14;
/** Coverage thresholds that count as milestones. */
const MILESTONES = [25, 50, 75, 100] as const;

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const LOG_LIMIT = 120;

/** Where one passage stands, one bucket each. */
export type PassageWork = 'not_started' | 'drafting' | 'in_review' | 'feedback' | 'done';
export const PASSAGE_WORK: readonly PassageWork[] = ['not_started', 'drafting', 'in_review', 'feedback', 'done'];

interface StageCount {
  stepId: string;
  name: string;
  checkpoint: boolean;
  /** Recorded passages whose suggested next step is this one. */
  passages: number;
}

interface BookReport {
  bookId: string | null;
  label: string;
  total: number;
  recorded: number;
  done: number;
}

export interface ActivityWeek {
  /** Monday of the week, UTC, `YYYY-MM-DD`. */
  weekStart: string;
  /** Cards (recordings) that reached the server this week. */
  cards: number;
  versions: number;
  reviews: number;
  requests: number;
}

interface UploadDay {
  day: string;
  cards: number;
  /** Distinct Bible chapters that got audio this day. */
  chapters: number;
}

/** One passage's uploads on one day, for the day-by-day log. */
export interface LogEntry {
  day: string;
  /** Newest upload of that passage that day, ISO. */
  at: string;
  unitId: string;
  label: string;
  book: string;
  cards: number;
  /** Verses of Scripture the passage covers. */
  verses: number;
}

/** Share of a scope's verses, in percent with one decimal. */
export type Coverage = Record<TargetScope, number>;

/** Passages recorded and done as of the end of a day. */
interface ProgressDay {
  day: string;
  recorded: number;
  done: number;
}

interface CoverageWeek {
  /** Sunday that ends the week, UTC. */
  weekEnd: string;
  recorded: Coverage;
}

export interface Milestone {
  scope: Exclude<TargetScope, 'bible'>;
  threshold: (typeof MILESTONES)[number];
  /** When recorded coverage first reached it, ISO. */
  at: string;
}

interface LedgerMonth {
  /** `YYYY-MM`, UTC. */
  month: string;
  /** Chapters whose first audio reached the server this month; each chapter counts once, ever. */
  chapters: number;
  books: { bookId: string; label: string; chapters: number }[];
}

export interface LanguageReport {
  languageId: string;
  name: string;
  /** The target language's code ("din"). */
  code: string;
  /** ISO 3166-1 alpha-2, or null when nobody set it. */
  country: string | null;
  flowName: string;
  target: LanguageTarget | null;
  progress: LanguageProgress;
  work: Record<PassageWork, number>;
  /** Flow steps in order, with how many passages sit at each. */
  stages: StageCount[];
  /** "12 in Community Check": the step most passages sit at, or null when none do. */
  bottleneck: string | null;
  attention: {
    /** Latest version has feedback nobody answered. */
    feedback: number;
    openRequests: number;
    /** Next step is a checkpoint nobody has cleared or moved past. */
    atCheckpoint: number;
  };
  books: BookReport[];
  activity: ActivityWeek[];
  /** ISO time of the newest version, review or request in this language. */
  lastActivity: string | null;
  /** Coverage of the canon by verses: passages with a published version, and passages done through the flow. */
  coverage: { recorded: Coverage; done: Coverage; weekly: CoverageWeek[] };
  milestones: Milestone[];
  /** One point per day for the last PROGRESS_DAYS, ending today; out of `progress.total`. */
  progressDaily: ProgressDay[];
  uploads: {
    /** Cards on the server, all time. */
    cards: number;
    /** Chapters with audio on the server, all time. */
    chapters: number;
    firstAt: string | null;
    lastAt: string | null;
    daily: UploadDay[];
    log: LogEntry[];
  };
  ledger: LedgerMonth[];
  alerts: {
    /** Cards recorded more than STUCK_AFTER_DAYS ago that the server still does not have. */
    stuckCards: number;
    stuckPassages: number;
    /** When the oldest stuck card was recorded, ISO. */
    stuckSince: string | null;
    /** Cards whose stored bytes the reconciler found wrong. */
    invalidCards: number;
  };
}

/** Where a passage's work stands, as the reports count it. */
export function passageWork(s: PassageState): PassageWork {
  if (s.done) return 'done';
  if (!s.recorded) return s.drafting ? 'drafting' : 'not_started';
  return s.awaitingResponse.length > 0 ? 'feedback' : 'in_review';
}

/** Wall time of a clock; the first field of an HLC is milliseconds. */
const wallOf = (hlc: string): number => Number(hlc.slice(0, hlc.indexOf(':')));

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const isoMonth = (ms: number): string => new Date(ms).toISOString().slice(0, 7);
const pct = (n: number, total: number): number => (total === 0 ? 0 : Math.round((1000 * n) / total) / 10);

/** Monday 00:00 UTC of the week holding `ms`. */
export function weekStartOf(ms: number): number {
  const day = Math.floor(ms / DAY_MS) * DAY_MS;
  const weekday = (new Date(day).getUTCDay() + 6) % 7;
  return day - weekday * DAY_MS;
}

function monthsEndingAt(now: number, n: number): string[] {
  const d = new Date(now);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  return out;
}

/**
 * What a language's report is made from, with no date and nothing from the
 * organization stream (decisions.md 141): the projection pass extracts it
 * when it folds the language and stores it, and the dashboard's server
 * renders a report from it for any day (`renderLanguageReport`), so no
 * server consumer folds a whole language for a report and a report never
 * goes stale at midnight. Everything that depends on the date is kept by
 * day, week or month, all time; the upload log keeps only the days it can
 * still show.
 */
export interface ReportInputs {
  /** The REPORT_VERSION it was extracted under. */
  v: number;
  /** Start of the first day the upload log holds: the log's first day when it was extracted. */
  logFrom: number;
  flowName: string;
  progress: LanguageProgress;
  work: Record<PassageWork, number>;
  stages: StageCount[];
  bottleneck: string | null;
  attention: LanguageReport['attention'];
  books: BookReport[];
  lastActivity: string | null;
  /** By week (its Monday, `YYYY-MM-DD`): cards that reached the server, versions, reviews and requests. */
  weeks: Record<string, [cards: number, versions: number, reviews: number, requests: number]>;
  coverage: { recorded: Coverage; done: Coverage };
  /** By scope: each day's verses first covered by a published version, days ascending. */
  coverageDays: Record<TargetScope, [day: string, verses: number][]>;
  milestones: Milestone[];
  /** Passages first published and passages finished, by day, days ascending. */
  passageDays: [day: string, recorded: number, done: number][];
  uploads: { cards: number; chapters: number; firstAt: string | null; lastAt: string | null };
  /** Cards that reached the server and the distinct chapters they gave audio to, by day, days ascending. */
  uploadDays: [day: string, cards: number, chapters: number][];
  /** The upload log's entries from `logFrom` on. */
  log: LogEntry[];
  /** By month (`YYYY-MM`): chapters whose first audio reached the server, by book index, ascending. */
  ledger: Record<string, [bookIndex: number, chapters: number][]>;
  /**
   * Cards the server does not have that were already stuck when the inputs
   * were extracted (recorded STUCK_AFTER_DAYS before): they stay stuck on
   * every later day, so a count, the oldest and their passages are enough.
   * An imported language can hold tens of thousands of them.
   */
  stuck: { cards: number; since: number | null; unitIds: string[] };
  /** Cards the server does not have, recorded too recently to be stuck yet when extracted: when, and the passage. */
  unstored: [recordedAt: number, unitId: string][];
  invalidCards: number;
}

const dayStart = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS;
const byKey = <T extends [string, ...unknown[]]>(a: T, b: T): number => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

/**
 * A language's report inputs: everything `languageReport` reads from the
 * fold. `asOf` only says which days of the upload log to keep; render the
 * inputs for a day at or after it.
 */
export function reportInputs(state: LanguageState, asOf: number, idx: Indexes = buildIndexes(state)): ReportInputs {
  const flow = deriveFlow(state);
  const kinds = deriveKinds(state);
  const passages = idx.passages.map((unitId) => derivePassage(state, unitId, idx));

  const work = Object.fromEntries(PASSAGE_WORK.map((w) => [w, 0])) as Record<PassageWork, number>;
  const atStep = new Map<string, number>();
  const attention = { feedback: 0, openRequests: 0, atCheckpoint: 0 };
  const books = new Map<string, BookReport & { canon: number }>();
  const weeks: ReportInputs['weeks'] = {};
  const weekOf = (ms: number) => (weeks[isoDay(weekStartOf(ms))] ??= [0, 0, 0, 0]);
  let last = 0;
  const count = (hlc: string, field: 1 | 2 | 3) => {
    const ms = wallOf(hlc);
    if (ms > last) last = ms;
    weekOf(ms)[field] += 1;
  };

  // Verse index -> when a passage covering it was first published; and verses in done passages.
  const recordedAt = new Map<number, number>();
  const doneVerses = new Set<number>();
  const passageDays = new Map<string, [string, number, number]>();
  const passageDay = (ms: number) => {
    const day = isoDay(ms);
    let row = passageDays.get(day);
    if (!row) passageDays.set(day, row = [day, 0, 0]);
    return row;
  };

  for (const s of passages) {
    const w = passageWork(s);
    work[w] += 1;
    if (w === 'feedback') attention.feedback += 1;
    if (!s.done && s.next) {
      atStep.set(s.next.step.id, (atStep.get(s.next.step.id) ?? 0) + 1);
      if (s.next.step.checkpoint) attention.atCheckpoint += 1;
    }
    attention.openRequests += s.openRequests.length;

    const place = unitPlace(state, s.unitId);
    const key = place.bookId ?? `label:${place.bookLabel}`;
    const book = books.get(key) ?? { bookId: place.bookId, label: place.bookLabel, total: 0, recorded: 0, done: 0, canon: place.canon };
    book.total += 1;
    if (s.recorded) book.recorded += 1;
    if (s.done) book.done += 1;
    books.set(key, book);

    for (const v of s.versions) count(v.hlc, 1);
    for (const r of s.reviews) count(r.hlc, 2);
    for (const r of s.requests) count(r.hlc, 3);

    const first = s.versions[0];
    if (first) {
      const at = wallOf(first.hlc);
      passageDay(at)[1] += 1;
      if (s.done) passageDay(Math.max(at, ...s.reviews.map((r) => wallOf(r.hlc)), ...s.departures.map((d) => wallOf(d.hlc))))[2] += 1;
      for (const v of unitVerses(state, s.unitId)) {
        const prior = recordedAt.get(v);
        if (prior === undefined || at < prior) recordedAt.set(v, at);
        if (s.done) doneVerses.add(v);
      }
    }
  }

  const stages: StageCount[] = flow.steps.map((step) => ({
    stepId: step.id, name: stepName(kinds, step), checkpoint: step.checkpoint, passages: atStep.get(step.id) ?? 0
  }));
  // Earliest step wins a tie: work upstream holds up everything after it.
  const top = stages.reduce<StageCount | null>((best, s) => (s.passages > (best?.passages ?? 0) ? s : best), null);

  // ---- coverage ----------------------------------------------------------
  const timesByScope = Object.fromEntries(TARGET_SCOPES.map((s) => [s, [] as number[]])) as Record<TargetScope, number[]>;
  for (const [v, at] of recordedAt) for (const s of TARGET_SCOPES) if (inScope(s, bookOfVerse(v))) timesByScope[s].push(at);
  for (const s of TARGET_SCOPES) timesByScope[s].sort((a, b) => a - b);
  const recorded = Object.fromEntries(TARGET_SCOPES.map((s) => [s, pct(timesByScope[s].length, SCOPE_VERSES[s])])) as Coverage;
  const coverageDays = Object.fromEntries(TARGET_SCOPES.map((s) => {
    const days: [string, number][] = [];
    for (const at of timesByScope[s]) {
      const day = isoDay(at);
      const lastDay = days[days.length - 1];
      if (lastDay?.[0] === day) lastDay[1] += 1;
      else days.push([day, 1]);
    }
    return [s, days];
  })) as ReportInputs['coverageDays'];
  const done = Object.fromEntries(TARGET_SCOPES.map((s) => {
    let n = 0;
    for (const v of doneVerses) if (inScope(s, bookOfVerse(v))) n += 1;
    return [s, pct(n, SCOPE_VERSES[s])];
  })) as Coverage;
  const milestones: Milestone[] = [];
  for (const scope of ['gospels', 'nt', 'ot'] as const) {
    for (const threshold of MILESTONES) {
      const needed = Math.ceil((threshold / 100) * SCOPE_VERSES[scope]);
      const at = timesByScope[scope][needed - 1];
      if (at !== undefined) milestones.push({ scope, threshold, at: new Date(at).toISOString() });
    }
  }
  milestones.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  // ---- uploads, ledger, alerts --------------------------------------------
  const logFrom = dayStart(asOf) - (LOG_DAYS - 1) * DAY_MS;
  const uploadDays = new Map<string, { cards: number; chapters: Set<number> }>();
  const log = new Map<string, LogEntry>();
  const unitFirstUpload = new Map<string, number>();
  const unstored: [number, string][] = [];
  const stuckBefore = asOf - STUCK_AFTER_DAYS * DAY_MS;
  const stuck = { cards: 0, since: Infinity, unitIds: new Set<string>() };
  let invalidCards = 0, cardsOnServer = 0, firstAt = Infinity, lastAt = 0;

  for (const rec of Object.values(state.recordings)) {
    if (rec.kind !== 'target') continue;
    for (const card of rec.cards) {
      const blob = state.blobs[card.hash];
      if (!blob?.stored) {
        if (blob && !blob.stored) invalidCards += 1;
        const recorded = wallOf(rec.hlc);
        if (recorded < stuckBefore) {
          stuck.cards += 1;
          stuck.since = Math.min(stuck.since, recorded);
          stuck.unitIds.add(rec.unitId);
        } else unstored.push([recorded, rec.unitId]);
        continue;
      }
      const at = wallOf(blob.hlc);
      cardsOnServer += 1;
      firstAt = Math.min(firstAt, at);
      lastAt = Math.max(lastAt, at);
      weekOf(at)[0] += 1;
      unitFirstUpload.set(rec.unitId, Math.min(unitFirstUpload.get(rec.unitId) ?? Infinity, at));
      const day = isoDay(at);
      let d = uploadDays.get(day);
      if (!d) uploadDays.set(day, d = { cards: 0, chapters: new Set() });
      d.cards += 1;
      for (const c of unitChapters(state, rec.unitId)) d.chapters.add(c);
      if (at >= logFrom) {
        const key = `${day}\u0000${rec.unitId}`;
        const entry = log.get(key) ?? {
          day, at: new Date(at).toISOString(), unitId: rec.unitId, label: state.units[rec.unitId]?.label ?? rec.unitId,
          book: unitPlace(state, rec.unitId).bookLabel, cards: 0, verses: unitVerses(state, rec.unitId).length
        };
        entry.cards += 1;
        if (new Date(at).toISOString() > entry.at) entry.at = new Date(at).toISOString();
        log.set(key, entry);
      }
    }
  }

  // A chapter counts once, in the month its first audio reached the server.
  const chapterFirst = new Map<number, number>();
  for (const [unitId, at] of unitFirstUpload) {
    for (const c of unitChapters(state, unitId)) chapterFirst.set(c, Math.min(chapterFirst.get(c) ?? Infinity, at));
  }
  const byMonth = new Map<string, Map<number, number>>();
  for (const [c, at] of chapterFirst) {
    const month = isoMonth(at);
    let perBook = byMonth.get(month);
    if (!perBook) byMonth.set(month, perBook = new Map());
    perBook.set(bookOfChapter(c), (perBook.get(bookOfChapter(c)) ?? 0) + 1);
  }

  return {
    v: REPORT_VERSION,
    logFrom,
    flowName: flow.name,
    progress: languageProgress(state, idx),
    work,
    stages,
    bottleneck: top ? `${top.passages} in ${top.name}` : null,
    attention,
    books: [...books.values()]
      .sort((a, b) => a.canon - b.canon || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
      .map(({ canon: _c, ...b }) => b),
    lastActivity: last > 0 ? new Date(last).toISOString() : null,
    weeks,
    coverage: { recorded, done },
    coverageDays,
    milestones,
    passageDays: [...passageDays.values()].sort(byKey),
    uploads: {
      cards: cardsOnServer,
      chapters: chapterFirst.size,
      firstAt: Number.isFinite(firstAt) ? new Date(firstAt).toISOString() : null,
      lastAt: lastAt > 0 ? new Date(lastAt).toISOString() : null
    },
    uploadDays: [...uploadDays].map(([day, d]): [string, number, number] => [day, d.cards, d.chapters.size]).sort(byKey),
    log: [...log.values()],
    ledger: Object.fromEntries([...byMonth].map(([month, perBook]) => [month, [...perBook].sort(([a], [b]) => a - b)])),
    stuck: { cards: stuck.cards, since: Number.isFinite(stuck.since) ? stuck.since : null, unitIds: [...stuck.unitIds].sort() },
    unstored,
    invalidCards
  };
}

/**
 * A language's report for the day that holds `now`, from its inputs and what
 * defines it on the organization stream (`languageInfo`). Cheap: it walks
 * days, weeks and months, never the fold. `now` should be at or after the
 * inputs' extraction; the upload log holds nothing older.
 */
export function renderLanguageReport(inputs: ReportInputs, info: LanguageInfo, now: number): LanguageReport {
  const firstWeek = weekStartOf(now) - (REPORT_WEEKS - 1) * WEEK_MS;
  const weeks: ActivityWeek[] = Array.from({ length: REPORT_WEEKS }, (_, i) => {
    const weekStart = isoDay(firstWeek + i * WEEK_MS);
    const [cards, versions, reviews, requests] = inputs.weeks[weekStart] ?? [0, 0, 0, 0];
    return { weekStart, cards, versions, reviews, requests };
  });

  // Recorded coverage at the end of each week: verses first covered on or before its Sunday.
  const weekly: CoverageWeek[] = [];
  const cursor = Object.fromEntries(TARGET_SCOPES.map((s) => [s, { i: 0, n: 0 }])) as Record<TargetScope, { i: number; n: number }>;
  for (const w of weeks) {
    const weekEnd = isoDay(Date.parse(`${w.weekStart}T00:00:00Z`) + WEEK_MS - 1);
    const recorded = Object.fromEntries(TARGET_SCOPES.map((s) => {
      const days = inputs.coverageDays[s];
      const c = cursor[s];
      while (c.i < days.length && days[c.i]![0] <= weekEnd) c.n += days[c.i++]![1];
      return [s, pct(c.n, SCOPE_VERSES[s])];
    })) as Coverage;
    weekly.push({ weekEnd, recorded });
  }

  // Passages recorded and done by the end of each of the last PROGRESS_DAYS days.
  const progressStart = dayStart(now) - (PROGRESS_DAYS - 1) * DAY_MS;
  let pi = 0, recordedSoFar = 0, doneSoFar = 0;
  const progressDaily: ProgressDay[] = Array.from({ length: PROGRESS_DAYS }, (_, i) => {
    const day = isoDay(progressStart + i * DAY_MS);
    while (pi < inputs.passageDays.length && inputs.passageDays[pi]![0] <= day) {
      recordedSoFar += inputs.passageDays[pi]![1];
      doneSoFar += inputs.passageDays[pi]![2];
      pi += 1;
    }
    return { day, recorded: recordedSoFar, done: doneSoFar };
  });

  const uploadsByDay = new Map(inputs.uploadDays.map(([day, cards, chapters]) => [day, { cards, chapters }]));
  const firstDay = dayStart(now) - (REPORT_DAYS - 1) * DAY_MS;
  const daily: UploadDay[] = Array.from({ length: REPORT_DAYS }, (_, i) => {
    const day = isoDay(firstDay + i * DAY_MS);
    return { day, ...(uploadsByDay.get(day) ?? { cards: 0, chapters: 0 }) };
  });
  const logStart = isoDay(dayStart(now) - (LOG_DAYS - 1) * DAY_MS);
  const log = inputs.log.filter((e) => e.day >= logStart)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.unitId < b.unitId ? -1 : 1)).slice(0, LOG_LIMIT);

  const ledger: LedgerMonth[] = monthsEndingAt(now, LEDGER_MONTHS).map((month) => {
    const perBook = inputs.ledger[month] ?? [];
    return {
      month,
      chapters: perBook.reduce((n, [, k]) => n + k, 0),
      books: perBook.map(([bi, chapters]) => ({ bookId: bookId(bi), label: bookLabel(bi), chapters }))
    };
  });

  // Stuck when extracted stays stuck; a recent card becomes stuck once now is far enough past it.
  const stuckBefore = now - STUCK_AFTER_DAYS * DAY_MS;
  const stuckPassages = new Set<string>(inputs.stuck.unitIds);
  let stuckCards = inputs.stuck.cards, stuckSince = inputs.stuck.since ?? Infinity;
  for (const [recorded, unitId] of inputs.unstored) {
    if (recorded >= stuckBefore) continue;
    stuckCards += 1;
    stuckPassages.add(unitId);
    stuckSince = Math.min(stuckSince, recorded);
  }

  return {
    languageId: info.languageId,
    name: info.name,
    code: info.code,
    country: info.country,
    flowName: inputs.flowName,
    target: info.target ? { ...info.target } : null,
    progress: inputs.progress,
    work: inputs.work,
    stages: inputs.stages,
    bottleneck: inputs.bottleneck,
    attention: inputs.attention,
    books: inputs.books,
    activity: weeks,
    lastActivity: inputs.lastActivity,
    coverage: { recorded: inputs.coverage.recorded, done: inputs.coverage.done, weekly },
    milestones: inputs.milestones,
    progressDaily,
    uploads: { ...inputs.uploads, daily, log },
    ledger,
    alerts: {
      stuckCards,
      stuckPassages: stuckPassages.size,
      stuckSince: Number.isFinite(stuckSince) ? new Date(stuckSince).toISOString() : null,
      invalidCards: inputs.invalidCards
    }
  };
}

/** A language's report: its work from its own stream, what defines it from the organization's (`languageInfo`). */
export function languageReport(state: LanguageState, info: LanguageInfo, now: number, idx: Indexes = buildIndexes(state)): LanguageReport {
  return renderLanguageReport(reportInputs(state, now, idx), info, now);
}

/**
 * May this person see a language's report? `view_status` from their org
 * role or their role in that language: a member of one language sees only
 * that language.
 */
export function mayViewLanguage(org: OrgState, profileId: string, languageId: string): boolean {
  return privilegesFor(org, profileId, languageId).has('view_status');
}

// ---- readings of a report at a moment -------------------------------------------
// Pure and cheap, so the page applies them at view time: a report folded
// this morning still says "check in" correctly this evening.

/**
 * How recently a language sent audio. Thresholds are days since the last
 * upload: active under 14, then a check-in, a reminder, four and five weeks
 * quiet, and inactive from 45.
 */
export type RecencyBand = 'not_started' | 'active' | 'check_in' | 'reminder' | 'four_weeks' | 'five_weeks' | 'inactive';
export const RECENCY_BANDS: readonly RecencyBand[] = ['active', 'check_in', 'reminder', 'four_weeks', 'five_weeks', 'inactive', 'not_started'];
export const RECENCY_DAYS: Record<Exclude<RecencyBand, 'not_started'>, [number, number]> = {
  active: [0, 13], check_in: [14, 20], reminder: [21, 27], four_weeks: [28, 34], five_weeks: [35, 44], inactive: [45, Infinity]
};

function daysSince(iso: string | null, now: number): number | null {
  return iso === null ? null : Math.max(0, Math.floor((now - Date.parse(iso)) / DAY_MS));
}

export function recencyOf(r: LanguageReport, now: number): { band: RecencyBand; days: number | null } {
  const days = daysSince(r.uploads.lastAt, now);
  if (days === null) return { band: 'not_started', days };
  const band = (Object.entries(RECENCY_DAYS) as [RecencyBand, [number, number]][]).find(([, [lo, hi]]) => days >= lo && days <= hi)![0];
  return { band, days };
}

/** Portfolio buckets: active, quiet (two to six weeks), inactive, or not started. */
export type Portfolio = 'active' | 'quiet' | 'inactive' | 'not_started';
export function portfolioOf(band: RecencyBand): Portfolio {
  return band === 'active' || band === 'inactive' || band === 'not_started' ? band : 'quiet';
}

export type PaceBand = 'ahead' | 'on_pace' | 'behind' | 'stalled' | 'complete';
export const PACE_BANDS: readonly PaceBand[] = ['ahead', 'on_pace', 'behind', 'stalled', 'complete'];

export interface Pace {
  band: PaceBand;
  scope: TargetScope;
  /** Recorded coverage of the scope now, percent. */
  actual: number;
  /** Where a straight line from start to target puts it today, percent. */
  expected: number;
  /** actual − expected, in points. */
  gap: number;
  /** At the last eight weeks' rate, ISO date, or null when there has been no progress. */
  projectedFinish: string | null;
}

/**
 * A language against its own target: on pace from 5 points behind to 10
 * ahead, ahead beyond that; behind languages whose recent rate still
 * finishes by the target date are "behind", the rest "stalled".
 */
export function paceOf(r: LanguageReport, now: number): Pace | null {
  if (!r.target) return null;
  const { scope, startDate, targetDate } = r.target;
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${targetDate}T00:00:00Z`);
  const actual = r.coverage.recorded[scope];
  const expected = Math.round(1000 * Math.min(1, Math.max(0, (now - start) / (end - start)))) / 10;
  const gap = Math.round(10 * (actual - expected)) / 10;
  const weekly = r.coverage.weekly;
  const eightAgo = weekly[weekly.length - 9]?.recorded[scope] ?? 0;
  const perDay = (actual - eightAgo) / 56;
  const projectedFinish = actual >= 100 ? isoDay(now) : perDay > 0 ? isoDay(now + ((100 - actual) / perDay) * DAY_MS) : null;
  let band: PaceBand;
  if (actual >= 100) band = 'complete';
  else if (gap > 10) band = 'ahead';
  else if (gap >= -5) band = 'on_pace';
  else band = projectedFinish !== null && projectedFinish <= targetDate ? 'behind' : 'stalled';
  return { band, scope, actual, expected, gap, projectedFinish };
}

// ---- what the dashboard's server answers (decision 44) ----------------------------

/** `GET /api/orgs/:org/reports`: the languages this person may see. */
export interface OrgReportsResponse {
  rows: { languageId: string; report: LanguageReport }[];
  /** When the dashboard's server last caught up with the log, ISO. */
  asOf: string;
}

/** One language's progress alone, for a phone's overview of languages it has not opened. */
export interface LanguageSummary {
  languageId: string;
  name: string;
  progress: LanguageProgress;
}

/** `GET /api/orgs/:org/reports?view=summary`. */
export interface OrgSummaryResponse {
  rows: LanguageSummary[];
  asOf: string;
}

export function summarizeReports(out: OrgReportsResponse): OrgSummaryResponse {
  return {
    rows: out.rows.map(({ languageId, report }) => ({ languageId, name: report.name, progress: report.progress })),
    asOf: out.asOf
  };
}
