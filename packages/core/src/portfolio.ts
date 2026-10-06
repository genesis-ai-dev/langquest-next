import { percent } from './passage';
import {
  PASSAGE_WORK, paceOf, portfolioOf, recencyOf, RECENCY_DAYS,
  type ActivityWeek, type LanguageReport, type LogEntry, type Milestone, type Pace, type PaceBand, type PassageWork,
  type Portfolio, type RecencyBand
} from './reports';
import { TARGET_SCOPES, type TargetScope } from './org';

/** One language's report, as an app holds it after asking the dashboard's server. */
export interface LanguageRow {
  orgId: string;
  languageId: string;
  /** When the server last caught up with the log (the response's `asOf`). */
  updatedAt: string;
  report: LanguageReport;
}

/**
 * Organization figures, summed on the device from the language rows this
 * person may read (decision 44). Nothing here is stored: a member scoped to
 * one language gets figures for that language only. Everything takes `now`
 * so a page reads "check in" or "overdue" as of the moment it is looked at.
 */

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export interface OrgTotals {
  languages: number;
  total: number;
  recorded: number;
  done: number;
  work: Record<PassageWork, number>;
  feedback: number;
  openRequests: number;
  overdueRequests: number;
  atCheckpoint: number;
  lastActivity: string | null;
  /** The stalest report among the rows: how far behind the page may be. */
  oldestUpdate: string | null;
}

const later = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a > b ? a : b);
const earlier = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a < b ? a : b);

export function orgTotals(rows: LanguageRow[]): OrgTotals {
  const out: OrgTotals = {
    languages: rows.length, total: 0, recorded: 0, done: 0,
    work: Object.fromEntries(PASSAGE_WORK.map((w) => [w, 0])) as Record<PassageWork, number>,
    feedback: 0, openRequests: 0, overdueRequests: 0, atCheckpoint: 0, lastActivity: null, oldestUpdate: null
  };
  for (const { report: r, updatedAt } of rows) {
    out.total += r.progress.total;
    out.recorded += r.progress.recorded;
    out.done += r.progress.done;
    for (const w of PASSAGE_WORK) out.work[w] += r.work[w];
    out.feedback += r.attention.feedback;
    out.openRequests += r.attention.openRequests;
    out.overdueRequests += r.attention.overdueRequests;
    out.atCheckpoint += r.attention.atCheckpoint;
    out.lastActivity = later(out.lastActivity, r.lastActivity);
    out.oldestUpdate = earlier(out.oldestUpdate, updatedAt);
  }
  return out;
}

export function byCountry(rows: LanguageRow[], country: string): LanguageRow[] {
  return country ? rows.filter((r) => (r.report.country ?? '') === country) : rows;
}

/** Countries present in the rows, by how many languages each has. */
export function countryCounts(rows: LanguageRow[]): { country: string | null; languages: number; cards: number }[] {
  const m = new Map<string | null, { country: string | null; languages: number; cards: number }>();
  for (const { report: r } of rows) {
    const e = m.get(r.country) ?? { country: r.country, languages: 0, cards: 0 };
    e.languages += 1;
    e.cards += r.uploads.cards;
    m.set(r.country, e);
  }
  return [...m.values()].sort((a, b) => b.languages - a.languages || (a.country ?? '~').localeCompare(b.country ?? '~'));
}

// ---- coverage ------------------------------------------------------------------------

/**
 * Coverage across languages. Every language's denominator is the same canon,
 * so the mean of shares is also the share of all verses across languages.
 */
export function coverageAverage(rows: LanguageRow[], which: 'recorded' | 'done'): Record<TargetScope, number> {
  return Object.fromEntries(TARGET_SCOPES.map((s) => [s,
    rows.length === 0 ? 0 : Math.round((10 * rows.reduce((n, r) => n + r.report.coverage[which][s], 0)) / rows.length) / 10
  ])) as Record<TargetScope, number>;
}

export const SCOPE_LABEL: Record<TargetScope, string> = { gospels: 'Gospels', nt: 'New Testament', ot: 'Old Testament', bible: 'Whole Bible' };

/** What a language is working toward: its target, else the first part of the canon it has not finished. */
export function workingScope(r: LanguageReport): TargetScope | null {
  if (r.target) return r.target.scope;
  if (r.coverage.recorded.bible === 0 && r.uploads.cards === 0) return null;
  return (['gospels', 'nt', 'ot'] as const).find((s) => r.coverage.recorded[s] < 100) ?? 'bible';
}

/** Recorded coverage of a scope as of a day, from the weekly series (the week that ended by then). */
export function coverageOn(r: LanguageReport, scope: TargetScope, day: string): number {
  let v = 0;
  for (const w of r.coverage.weekly) if (w.weekEnd < day) v = w.recorded[scope];
  return v;
}

// ---- recency --------------------------------------------------------------------------

export interface WatchItem {
  row: LanguageRow;
  band: RecencyBand;
  days: number;
  /** Days until it reads as inactive. */
  untilInactive: number;
}

export function recencyGroups(rows: LanguageRow[], now: number): Record<RecencyBand, { row: LanguageRow; days: number | null }[]> {
  const out = { active: [], check_in: [], reminder: [], four_weeks: [], five_weeks: [], inactive: [], not_started: [] } as Record<RecencyBand, { row: LanguageRow; days: number | null }[]>;
  for (const row of rows) {
    const { band, days } = recencyOf(row.report, now);
    out[band].push({ row, days });
  }
  for (const list of Object.values(out)) list.sort((a, b) => (b.days ?? -1) - (a.days ?? -1));
  return out;
}

export function portfolioCounts(rows: LanguageRow[], now: number): Record<Portfolio, number> {
  const out: Record<Portfolio, number> = { active: 0, quiet: 0, inactive: 0, not_started: 0 };
  for (const r of rows) out[portfolioOf(recencyOf(r.report, now).band)] += 1;
  return out;
}

/** Languages two to six weeks quiet, most urgent first: who to contact. */
export function watchList(rows: LanguageRow[], now: number): WatchItem[] {
  const out: WatchItem[] = [];
  for (const row of rows) {
    const { band, days } = recencyOf(row.report, now);
    if (days === null || band === 'active' || band === 'inactive') continue;
    out.push({ row, band, days, untilInactive: RECENCY_DAYS.inactive[0] - days });
  }
  return out.sort((a, b) => b.days - a.days);
}

// ---- activity windows -------------------------------------------------------------------

export interface DayTotal { day: string; cards: number; chapters: number }

/** Uploads per day across languages, oldest first. */
export function mergedDaily(rows: LanguageRow[]): DayTotal[] {
  const m = new Map<string, DayTotal>();
  for (const { report } of rows) {
    for (const d of report.uploads.daily) {
      const e = m.get(d.day) ?? { day: d.day, cards: 0, chapters: 0 };
      e.cards += d.cards;
      e.chapters += d.chapters;
      m.set(d.day, e);
    }
  }
  return [...m.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

export interface ActivityWindow {
  days: number;
  cards: number;
  previousCards: number;
  /** Passages that got new audio, across languages. */
  passages: number;
  books: number;
  languages: number;
  daily: DayTotal[];
  previousDaily: DayTotal[];
}

/** The last `days` days of uploads (today included) against the `days` before. */
export function activityWindow(rows: LanguageRow[], days: number, now: number): ActivityWindow {
  const today = isoDay(now);
  const start = isoDay(now - (days - 1) * DAY_MS);
  const prevStart = isoDay(now - (2 * days - 1) * DAY_MS);
  const all = mergedDaily(rows);
  const daily = all.filter((d) => d.day >= start && d.day <= today);
  const previousDaily = all.filter((d) => d.day >= prevStart && d.day < start);
  const passages = new Set<string>();
  const books = new Set<string>();
  const languages = new Set<string>();
  for (const { report } of rows) {
    for (const e of report.uploads.log) {
      if (e.day < start) continue;
      passages.add(`${report.languageId}\u0000${e.unitId}`);
      books.add(`${report.languageId}\u0000${e.book}`);
    }
    if (report.uploads.daily.some((d) => d.day >= start && d.cards > 0)) languages.add(report.languageId);
  }
  return {
    days, daily, previousDaily,
    cards: daily.reduce((n, d) => n + d.cards, 0),
    previousCards: previousDaily.reduce((n, d) => n + d.cards, 0),
    passages: passages.size, books: books.size, languages: languages.size
  };
}

/** Languages by cards uploaded in the window, most first. */
export function topLanguages(rows: LanguageRow[], days: number, now: number): { row: LanguageRow; cards: number }[] {
  const start = isoDay(now - (days - 1) * DAY_MS);
  return rows
    .map((row) => ({ row, cards: row.report.uploads.daily.filter((d) => d.day >= start).reduce((n, d) => n + d.cards, 0) }))
    .filter((x) => x.cards > 0)
    .sort((a, b) => b.cards - a.cards || a.row.report.name.localeCompare(b.row.report.name));
}

export interface LogDay {
  day: string;
  entries: (LogEntry & { row: LanguageRow })[];
  cards: number;
  passages: number;
  languages: number;
}

/** The day-by-day log of passages that got audio, newest day first. */
export function logByDay(rows: LanguageRow[], days: number, now: number): LogDay[] {
  const start = isoDay(now - (days - 1) * DAY_MS);
  const m = new Map<string, (LogEntry & { row: LanguageRow })[]>();
  for (const row of rows) for (const e of row.report.uploads.log) if (e.day >= start) (m.get(e.day) ?? m.set(e.day, []).get(e.day)!).push({ ...e, row });
  return [...m].sort(([a], [b]) => (a < b ? 1 : -1)).map(([day, entries]) => {
    entries.sort((a, b) => (a.at < b.at ? 1 : -1));
    return {
      day, entries,
      cards: entries.reduce((n, e) => n + e.cards, 0),
      passages: entries.length,
      languages: new Set(entries.map((e) => e.row.languageId)).size
    };
  });
}

/** Weekly totals across languages, oldest first. */
export function combinedActivity(rows: LanguageRow[]): ActivityWeek[] {
  const weeks = new Map<string, ActivityWeek>();
  for (const { report } of rows) {
    for (const w of report.activity) {
      const sum = weeks.get(w.weekStart) ?? { weekStart: w.weekStart, cards: 0, versions: 0, reviews: 0, requests: 0 };
      sum.cards += w.cards;
      sum.versions += w.versions;
      sum.reviews += w.reviews;
      sum.requests += w.requests;
      weeks.set(w.weekStart, sum);
    }
  }
  return [...weeks.values()].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
}

/** Cards per week for the last `n` weeks, for a sparkline. */
export function weeklyCards(r: LanguageReport, n = 8): number[] {
  return r.activity.slice(-n).map((w) => w.cards);
}

// ---- milestones -------------------------------------------------------------------------

export function milestonesSince(rows: LanguageRow[], sinceIso: string): (Milestone & { row: LanguageRow })[] {
  return rows
    .flatMap((row) => row.report.milestones.filter((m) => m.at >= sinceIso).map((m) => ({ ...m, row })))
    .sort((a, b) => (a.at < b.at ? 1 : -1));
}

export function milestoneText(m: Milestone & { row: LanguageRow }): string {
  const scope = SCOPE_LABEL[m.scope];
  return m.threshold === 100 ? `${m.row.report.name}: ${scope} fully recorded` : `${m.row.report.name}: ${m.threshold}% of the ${scope} recorded`;
}

// ---- field report ---------------------------------------------------------------------------

export type ReportWindow = 'week' | 'month' | 'ytd';

export interface FieldReport {
  window: ReportWindow;
  title: string;
  /** First and last day covered, inclusive. */
  from: string;
  to: string;
  cards: number;
  previousCards: number | null;
  languagesRecording: number;
  languages: number;
  countries: number;
  ntRecorded: number;
  passagesDone: number;
  advanced: { row: LanguageRow; scope: TargetScope; before: number; after: number }[];
  mostRecorded: { row: LanguageRow; cards: number }[];
  portfolio: Record<Portfolio, number>;
  workingOn: Record<TargetScope | 'none', number>;
  milestones: (Milestone & { row: LanguageRow })[];
  wentQuiet: LanguageRow[];
  resumed: LanguageRow[];
}

export function reportWindow(window: ReportWindow, now: number): { from: string; to: string; days: number } {
  const to = isoDay(now);
  if (window === 'ytd') {
    const from = `${to.slice(0, 4)}-01-01`;
    return { from, to, days: Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1 };
  }
  const days = window === 'week' ? 7 : 30;
  return { from: isoDay(now - (days - 1) * DAY_MS), to, days };
}

/** Cards uploaded between two days inclusive: daily counts where they reach, weekly beyond. */
function cardsBetween(r: LanguageReport, from: string, to: string): number {
  const firstDaily = r.uploads.daily[0]?.day ?? to;
  if (from >= firstDaily) return r.uploads.daily.filter((d) => d.day >= from && d.day <= to).reduce((n, d) => n + d.cards, 0);
  // Beyond the daily counts: every week that overlaps the range, whole.
  return r.activity
    .filter((w) => isoDay(Date.parse(`${w.weekStart}T00:00:00Z`) + 6 * DAY_MS) >= from && w.weekStart <= to)
    .reduce((n, w) => n + w.cards, 0);
}

export function fieldReport(rows: LanguageRow[], window: ReportWindow, now: number): FieldReport {
  const { from, to, days } = reportWindow(window, now);
  const prevFrom = isoDay(Date.parse(`${from}T00:00:00Z`) - days * DAY_MS);
  const prevTo = isoDay(Date.parse(`${from}T00:00:00Z`) - DAY_MS);
  const perLang = rows.map((row) => ({ row, cards: cardsBetween(row.report, from, to) }));
  const workingOn = { gospels: 0, nt: 0, ot: 0, bible: 0, none: 0 } as Record<TargetScope | 'none', number>;
  for (const { report } of rows) workingOn[workingScope(report) ?? 'none'] += 1;
  const quietDay = (row: LanguageRow) => recencyOf(row.report, now).days;
  return {
    window,
    title: window === 'week' ? 'This week in the field' : window === 'month' ? 'This month in the field' : `${to.slice(0, 4)} so far`,
    from, to,
    cards: perLang.reduce((n, x) => n + x.cards, 0),
    previousCards: window === 'ytd' ? null : rows.reduce((n, row) => n + cardsBetween(row.report, prevFrom, prevTo), 0),
    languagesRecording: perLang.filter((x) => x.cards > 0).length,
    languages: rows.length,
    countries: new Set(perLang.filter((x) => x.cards > 0).map((x) => x.row.report.country ?? '?')).size,
    ntRecorded: coverageAverage(rows, 'recorded').nt,
    passagesDone: rows.reduce((n, r) => n + r.report.progress.done, 0),
    advanced: rows.flatMap((row) => {
      const scope = workingScope(row.report);
      if (!scope) return [];
      const before = coverageOn(row.report, scope, from);
      const after = row.report.coverage.recorded[scope];
      return after > before ? [{ row, scope, before, after }] : [];
    }).sort((a, b) => b.after - b.before - (a.after - a.before)),
    mostRecorded: perLang.filter((x) => x.cards > 0).sort((a, b) => b.cards - a.cards),
    portfolio: portfolioCounts(rows, now),
    workingOn,
    milestones: milestonesSince(rows, `${from}T00:00:00.000Z`),
    // Last upload fell quiet (14 days) during the window.
    wentQuiet: rows.filter((row) => {
      const d = quietDay(row);
      return d !== null && d >= 14 && d < 14 + days;
    }),
    // Sent audio in the window after two quiet weeks or more before it.
    resumed: rows.filter((row) => {
      const w = row.report.activity;
      const inWindow = cardsBetween(row.report, from, to) > 0;
      const before = w.filter((x) => x.weekStart < from).slice(-2);
      return inWindow && before.length === 2 && before.every((x) => x.cards === 0) && w.some((x) => x.weekStart < from && x.cards > 0);
    })
  };
}

const n = (x: number) => x.toLocaleString('en-US');

/** "1 language has", "3 languages have". */
export const plural = (k: number, one: string, many = `${one}s`): string => `${n(k)} ${k === 1 ? one : many}`;
const verb = (k: number, one: string, many: string) => (k === 1 ? one : many);

/** The report as plain text, for pasting into an email or a message. */
export function reportText(fr: FieldReport, orgName: string): string {
  const lines = [
    `${orgName}: ${fr.title}`,
    `${fr.from} to ${fr.to}`,
    '',
    `${n(fr.cards)} recordings reached the server from ${n(fr.languagesRecording)} of ${n(fr.languages)} languages` +
      (fr.previousCards !== null ? ` (${fr.cards >= fr.previousCards ? '+' : ''}${n(fr.cards - fr.previousCards)} on the period before).` : '.'),
    `New Testament recorded across all languages: ${fr.ntRecorded}% of verses. Passages done through review: ${n(fr.passagesDone)}.`,
    ''
  ];
  if (fr.milestones.length) {
    lines.push('Milestones:');
    for (const m of fr.milestones) lines.push(`- ${m.at.slice(0, 10)} ${milestoneText(m)}`);
    lines.push('');
  }
  if (fr.advanced.length) {
    lines.push('Scripture coverage advanced:');
    for (const a of fr.advanced) lines.push(`- ${a.row.report.name} (${SCOPE_LABEL[a.scope]}): ${a.before}% to ${a.after}%`);
    lines.push('');
  }
  if (fr.mostRecorded.length) {
    lines.push('Most recordings:');
    fr.mostRecorded.slice(0, 10).forEach((x, i) => lines.push(`${i + 1}. ${x.row.report.name}: ${n(x.cards)}`));
    lines.push('');
  }
  if (fr.wentQuiet.length) lines.push(`Went quiet (no new recordings in 14+ days): ${fr.wentQuiet.map((r) => r.report.name).join(', ')}.`);
  if (fr.resumed.length) lines.push(`Resumed recording: ${fr.resumed.map((r) => r.report.name).join(', ')}.`);
  return lines.join('\n').trim() + '\n';
}

// ---- ledger -------------------------------------------------------------------------------

/** How long after a month ends its figures keep moving (late uploads) before they are settled. */
export const SETTLE_DAYS = 5;

export function ledgerMonths(rows: LanguageRow[]): string[] {
  const s = new Set<string>();
  for (const { report } of rows) for (const m of report.ledger) s.add(m.month);
  return [...s].sort();
}

export function isSettled(month: string, now: number): boolean {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return now >= Date.UTC(y, m, 1) + SETTLE_DAYS * DAY_MS;
}

/** The newest settled month, else the newest month. */
export function defaultLedgerMonth(months: string[], now: number): string | undefined {
  return [...months].reverse().find((m) => isSettled(m, now)) ?? months.at(-1);
}

export interface LedgerLine {
  row: LanguageRow;
  chapters: number;
  books: { bookId: string; label: string; chapters: number }[];
}

export function ledgerFor(rows: LanguageRow[], month: string): { chapters: number; books: number; languages: number; lines: LedgerLine[] } {
  const lines: LedgerLine[] = [];
  for (const row of rows) {
    const m = row.report.ledger.find((x) => x.month === month);
    if (m && m.chapters > 0) lines.push({ row, chapters: m.chapters, books: m.books });
  }
  lines.sort((a, b) => b.chapters - a.chapters || a.row.report.name.localeCompare(b.row.report.name));
  return {
    chapters: lines.reduce((k, l) => k + l.chapters, 0),
    books: lines.reduce((k, l) => k + l.books.length, 0),
    languages: lines.length,
    lines
  };
}

export function ledgerCsv(rows: LanguageRow[], month: string, countryName: (c: string | null) => string): string {
  const l = ledgerFor(rows, month);
  return toCsv([
    ['Month', 'Language', 'Code', 'Country', 'New chapters', 'Books', 'Chapters by book'],
    ...l.lines.map((x) => [month, x.row.report.name, x.row.report.code, countryName(x.row.report.country), x.chapters, x.books.length,
      x.books.map((b) => `${b.label} ${b.chapters}`).join('; ')]),
    [month, 'Total', null, null, l.chapters, l.books, null]
  ]);
}

// ---- pace ---------------------------------------------------------------------------------

export function paceGroups(rows: LanguageRow[], now: number): { band: PaceBand | 'no_target'; items: { row: LanguageRow; pace: Pace | null }[] }[] {
  const order: (PaceBand | 'no_target')[] = ['ahead', 'on_pace', 'behind', 'stalled', 'complete', 'no_target'];
  const groups = new Map(order.map((b) => [b, [] as { row: LanguageRow; pace: Pace | null }[]]));
  for (const row of rows) {
    const pace = paceOf(row.report, now);
    groups.get(pace?.band ?? 'no_target')!.push({ row, pace });
  }
  for (const list of groups.values()) list.sort((a, b) => (b.pace?.gap ?? 0) - (a.pace?.gap ?? 0) || a.row.report.name.localeCompare(b.row.report.name));
  return order.map((band) => ({ band, items: groups.get(band)! }));
}

// ---- alerts --------------------------------------------------------------------------------

export type AlertLevel = 'attention' | 'look' | 'fyi';

export interface Alert {
  id: string;
  level: AlertLevel;
  title: string;
  body: string;
  action: string;
  rows: LanguageRow[];
}

/** Figures older than this were read long before the page was looked at. */
export const STALE_AFTER_MS = 15 * 60_000;

/**
 * Checks on the data itself, in plain language. `asOf` is when the
 * dashboard's server last caught up with the log; it catches up on every
 * load, so old figures mean the page has been open a while.
 */
export function alertsFor(rows: LanguageRow[], asOf: string, now: number): Alert[] {
  const out: Alert[] = [];
  if (now - Date.parse(asOf) > STALE_AFTER_MS) {
    out.push({
      id: 'stale', level: 'look', title: 'These figures are not current',
      body: `They were read ${timeAgo(asOf, now)}. Work synced since then is not in them.`,
      action: 'Reload the page to catch up.', rows: []
    });
  }
  const stuck = rows.filter((r) => r.report.alerts.stuckCards > 0).sort((a, b) => b.report.alerts.stuckCards - a.report.alerts.stuckCards);
  if (stuck.length) {
    const cards = stuck.reduce((k, r) => k + r.report.alerts.stuckCards, 0);
    const serious = stuck.some((r) => r.report.alerts.stuckPassages >= 25 || (r.report.alerts.stuckSince !== null && now - Date.parse(r.report.alerts.stuckSince) > 30 * DAY_MS));
    out.push({
      id: 'stuck', level: serious ? 'attention' : 'look', title: 'Recorded audio stuck on phones',
      body: `${plural(cards, 'recording')} ${verb(cards, 'was', 'were')} made more than two weeks ago and have not reached the server. Until they upload, the phone holds the only copy: a lost, reset or reinstalled phone loses them.`,
      action: 'Ask the team not to reinstall or clear the app, and to get the phone onto a reliable connection with LangQuest open.', rows: stuck
    });
  }
  const invalid = rows.filter((r) => r.report.alerts.invalidCards > 0);
  if (invalid.length) {
    out.push({
      id: 'invalid', level: 'attention', title: 'Uploaded audio failed its integrity check',
      body: `${plural(invalid.reduce((k, r) => k + r.report.alerts.invalidCards, 0), 'recording')} on the server did not match their fingerprint and were removed. The phones that recorded them will upload them again if they still have them.`,
      action: 'Ask those teams to open LangQuest on a good connection; if it recurs, report it to the LangQuest team.', rows: invalid
    });
  }
  const noCountry = rows.filter((r) => !r.report.country);
  if (noCountry.length) {
    out.push({
      id: 'country', level: 'fyi', title: 'Languages without a country',
      body: `${plural(noCountry.length, 'language')} ${verb(noCountry.length, 'has', 'have')} no country, so the map and country filters leave them out.`,
      action: 'Open each language and set its country.', rows: noCountry
    });
  }
  const noTarget = rows.filter((r) => !r.report.target);
  if (noTarget.length) {
    out.push({
      id: 'target', level: 'fyi', title: 'Languages without a target',
      body: `${plural(noTarget.length, 'language')} ${verb(noTarget.length, 'has', 'have')} no target, so Pace cannot say whether they are on plan.`,
      action: 'Open each language and set what it aims to record, and by when.', rows: noTarget
    });
  }
  const rank: Record<AlertLevel, number> = { attention: 0, look: 1, fyi: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

// ---- sorting and tables ---------------------------------------------------------------------

/** Things a coordinator can act on in one language. */
export function attentionCount(r: LanguageReport): number {
  return r.attention.feedback + r.attention.overdueRequests + r.attention.atCheckpoint;
}

export type LanguageSortKey = 'name' | 'recorded' | 'done' | 'attention' | 'activity' | 'coverage' | 'cards' | 'upload';
export type SortDir = 'asc' | 'desc';

export function sortLanguages(rows: LanguageRow[], key: LanguageSortKey, dir: SortDir): LanguageRow[] {
  const value = (r: LanguageReport): number | string => {
    switch (key) {
      case 'name': return r.name.toLocaleLowerCase();
      case 'recorded': return percent(r.progress.recorded, r.progress.total);
      case 'done': return percent(r.progress.done, r.progress.total);
      case 'attention': return attentionCount(r);
      case 'activity': return r.lastActivity ?? '';
      case 'coverage': return r.coverage.recorded.bible;
      case 'cards': return r.uploads.cards;
      case 'upload': return r.uploads.lastAt ?? '';
    }
  };
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a.report);
    const y = value(b.report);
    if (x !== y) return (x < y ? -1 : 1) * sign;
    return a.report.name < b.report.name ? -1 : a.report.name > b.report.name ? 1 : 0;
  });
}

/** Recorded and done as shares of the language's passages today, one point per day, for the progress line. */
export function dayPercents(r: LanguageReport): { day: string; recorded: number; done: number }[] {
  const total = r.progress.total;
  return r.progressDaily.map((d) => ({ day: d.day, recorded: percent(d.recorded, total), done: percent(d.done, total) }));
}

// ---- CSV ---------------------------------------------------------------------------

type Cell = string | number | null;

/**
 * RFC 4180 quoting. A cell that a spreadsheet would read as a formula
 * (`=`, `+`, `-`, `@`, tab, carriage return) is prefixed with `'`: language
 * and passage names are typed by members, and a name must never run as code.
 */
export function csvCell(cell: Cell): string {
  if (cell === null) return '';
  if (typeof cell === 'number') return String(cell);
  const safe = /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function languagesCsv(rows: LanguageRow[], now = Date.now()): string {
  return toCsv([
    ['Language', 'Code', 'Country', 'Review flow', 'Passages', 'Recorded', 'Done', 'Recorded %', 'Done %',
      'Gospels recorded %', 'New Testament recorded %', 'Old Testament recorded %', 'Recordings on server', 'Last upload', 'Upload status',
      'Feedback to answer', 'Open requests', 'Overdue requests', 'At a checkpoint', 'Bottleneck', 'Last activity', 'Report updated'],
    ...rows.map(({ report: r, updatedAt }) => [
      r.name, r.code, r.country, r.flowName, r.progress.total, r.progress.recorded, r.progress.done,
      percent(r.progress.recorded, r.progress.total), percent(r.progress.done, r.progress.total),
      r.coverage.recorded.gospels, r.coverage.recorded.nt, r.coverage.recorded.ot, r.uploads.cards, r.uploads.lastAt,
      recencyOf(r, now).band,
      r.attention.feedback, r.attention.openRequests, r.attention.overdueRequests, r.attention.atCheckpoint,
      r.bottleneck, r.lastActivity, updatedAt
    ])
  ]);
}

export function languageCsv(r: LanguageReport): string {
  return toCsv([
    ['Book', 'Passages', 'Recorded', 'Done', 'Recorded %', 'Done %'],
    ...r.books.map((b) => [b.label, b.total, b.recorded, b.done, percent(b.recorded, b.total), percent(b.done, b.total)])
  ]);
}

// ---- time ----------------------------------------------------------------------------

export function timeAgo(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  const plural = (k: number, unit: string) => `${k} ${unit}${k === 1 ? '' : 's'} ago`;
  if (s < 3600) return plural(Math.floor(s / 60), 'minute');
  if (s < 86_400) return plural(Math.floor(s / 3600), 'hour');
  return plural(Math.floor(s / 86_400), 'day');
}
