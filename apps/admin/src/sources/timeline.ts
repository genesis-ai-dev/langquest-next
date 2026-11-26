import { diagConnection, withDiag, type Query } from '../db';
import { getJson, off, ok, type Section } from '../section';
import { namedIssues } from './fixes';
import { METRICS } from './history';
import { plainTitle, prSummary } from './prs';

/**
 * The line of merges at the top of the Releases page
 * (docs/decisions/2026-11-26-release-timeline-on-the-releases-page.md): each
 * pull request merged into main in the last LINE_DAYS days, with what it
 * changed (by the paths of its files), the Linear issues it names, who made
 * and merged it, when work on it started, and when the phone app's bundle
 * that holds it first ran on an iPhone and on an Android phone; the commit
 * the web app serves; and the failures each hour. A person's first name is
 * kept, never a login or an email.
 *
 * GitHub's GraphQL search reads the pull requests (one search for each few
 * days, side by side); Expo says which commit each update and store build
 * came from; the database says when production phones first ran each
 * bundle (diag.ops_release_line, counts and times only).
 */

/** How far back the line goes. */
export const LINE_DAYS = 30;
/** Days in one GitHub search; the searches run side by side. */
const WINDOW_DAYS = 5;

// ---- what a merge changed --------------------------------------------------------------------

/** The areas a page filters by, in the order its buttons show. */
export const AREAS = ['app', 'ui', 'dashboard', 'backend', 'videos', 'jobs', 'tests', 'docs'] as const;
export type Area = (typeof AREAS)[number];

const AGENT_FILES = /^(scripts\/(agent-|user-issues|card-questions|research-team|merge-issues|tutorial-review|card-words)|\.agents\/skills\/(user-issues|tutorial-review|merge-issues|research-team|card-questions|field-diagnosis)\/)/;

/** A file's area and its part of that area, by its path. */
export function areaOf(f: string): [Area, string] {
  if (/(^|\/)test\/|\.test\.(ts|tsx|mjs)$|^e2e\/(ui|web-smoke|fixtures)\/|^e2e\/[^/]+\.(ts|sh)$|^smart-tests\/|^eval\/|^stryker|^vitest/.test(f) || /^server\/[^/]*[sS]moke\.sql$/.test(f))
    return ['tests', /^e2e\/|^smart-tests\//.test(f) ? 'Screen tests' : /^eval\/|^stryker/.test(f) ? 'Test quality' : 'Code tests'];
  if (/^docs\/decisions\//.test(f)) return ['docs', 'Decisions'];
  if ((/^docs\/|\.md$/.test(f)) && !/^\.agents\//.test(f)) return ['docs', 'Guides and plans'];
  if (/^e2e\/tutorials\/lines\//.test(f)) return ['videos', 'Voice lines'];
  if (/^e2e\/tutorials\//.test(f)) return ['videos', 'Video steps'];
  if (/^apps\/admin\//.test(f)) return ['dashboard', /\/page[A-Z]?\w*\.ts$/.test(f) ? 'Pages' : /\/(sources|read|db|logs\w*|lines)(\/|\.ts$)/.test(f) ? 'Dashboard data' : 'Sign-in and Worker'];
  if (/^supabase\/migrations\/|^supabase\/[^/]+\.(toml|sql)$/.test(f)) return ['backend', 'Database'];
  if (/^supabase\/functions\/|^apps\/invite-email\//.test(f)) return ['backend', 'Email and edge functions'];
  if (/^server\//.test(f)) return ['backend', 'Server code'];
  if (/^apps\/web\/|^apps\/mobile\/public\//.test(f)) return ['backend', 'Web server'];
  if (AGENT_FILES.test(f)) return ['jobs', 'Agent team'];
  if (/^\.github\//.test(f)) return ['jobs', 'GitHub workflows'];
  if (/^\.agents\/|^\.claude\/|^\.hermes\/|^skills-lock\.json$/.test(f)) return ['jobs', 'Claude skills'];
  if (/^scripts\/|^\.githooks\/|^apps\/mobile\/\.eas\//.test(f)) return ['jobs', 'Tools and scripts'];
  if (/^apps\/mobile\/src\/(ui|.*theme)\//.test(f)) return ['ui', 'Kit and theme'];
  if (/^apps\/mobile\/src\/(helps|helpMode|guides)\//.test(f) && /\.tsx$/.test(f)) return ['ui', 'Help and guides'];
  if (/^apps\/mobile\/src\/.*\.tsx$/.test(f)) return ['ui', 'Screens'];
  if (/^apps\/mobile\/assets\//.test(f)) return ['ui', 'Pictures and icons'];
  if (/^apps\/mobile\/(locales|src\/i18n)\//.test(f)) return ['app', 'Translations'];
  if (/^apps\/mobile\/src\/nearby\/|^apps\/mobile\/modules\/nearby/.test(f)) return ['app', 'Nearby sharing'];
  if (/^apps\/mobile\/src\/(audio|recording|mic|breakup)\/|^apps\/mobile\/modules\/microphone/.test(f)) return ['app', 'Recording and audio'];
  if (/^packages\/(sync|core)\/|^apps\/mobile\/src\/(sync|storage|server|session|sources|imports|library|clusters)\//.test(f)) return ['app', 'Sync and data'];
  if (/^packages\/v2-import\//.test(f)) return ['app', 'Old LangQuest import'];
  if (/^library\//.test(f)) return ['app', 'Library content'];
  if (/^apps\/mobile\/(modules|plugins|scripts)\/|^apps\/mobile\/[^/]+\.(js|json|ts)$|^package(-lock)?\.json$|^app\.json$/.test(f)) return ['app', 'Native code and build'];
  if (/^apps\/mobile\/src\//.test(f)) return ['app', 'Other app code'];
  return ['jobs', 'Tools and scripts'];
}

/** A merge's areas, the one with the most files first (tests and docs last), each with its parts, most files first. */
export function areasOf(files: string[]): [Area, string[]][] {
  const by = new Map<Area, Map<string, number>>();
  for (const f of files) {
    const [a, part] = areaOf(f);
    const parts = by.get(a) ?? new Map<string, number>();
    parts.set(part, (parts.get(part) ?? 0) + 1);
    by.set(a, parts);
  }
  const weight = (a: Area) => [...by.get(a)!.values()].reduce((x, y) => x + y, 0);
  const aside = (a: Area) => (a === 'tests' || a === 'docs' ? 1 : 0);
  return [...by.keys()].sort((a, b) => aside(a) - aside(b) || weight(b) - weight(a))
    .map((a) => [a, [...by.get(a)!].sort((x, y) => y[1] - x[1]).map(([p]) => p)]);
}

/** Whether a file goes into the phone app's bundle or build. */
export const inPhoneApp = (f: string): boolean =>
  (/^(apps\/mobile\/|packages\/(core|sync)\/)/.test(f) || f === 'package.json' || f === 'package-lock.json')
  && !/^apps\/mobile\/(\.eas|public|test|e2e)\//.test(f) && !/(^|\/)test\/|\.test\.tsx?$|\.md$/.test(f);

// ---- who made and merged it --------------------------------------------------------------------

interface Actor { __typename?: string; login?: string; name?: string | null }
export interface Who {
  kind: 'thread' | 'agent' | 'dev' | 'bot';
  /** Claude thread, Issue fix team, Tutorial video team, a developer's first name, Dependabot. */
  name: string;
  /** How it was merged, in a few words. */
  sub: string;
  /** The Claude Code session it came from, when the pull request names one. */
  link?: string;
}
const firstName = (a: Actor | null | undefined): string | null =>
  !a || a.__typename === 'Bot' ? null : (String(a.name ?? '').trim().split(/\s+/)[0] || null);
const SESSION = /https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]+/;

export function whoOf(branch: string, author: Actor | null, mergedBy: Actor | null, body: string): Who {
  const merger = firstName(mergedBy);
  const bot = !mergedBy || mergedBy.__typename === 'Bot';
  const team = (name: string): Who => ({ kind: 'agent', name, sub: bot || merger === null ? 'Claude wrote it and it merged itself' : `Claude wrote it; ${merger} merged it` });
  if (/^user-issue\//.test(branch)) return team('Issue fix team');
  if (/^tutorial-fix\//.test(branch)) return team('Tutorial video team');
  if (/^claude\/project-thread-/.test(branch)) {
    const link = SESSION.exec(body)?.[0];
    return { kind: 'thread', name: 'Claude thread', sub: merger ? `Merged with ${merger}'s account` : 'Merged', ...(link ? { link } : {}) };
  }
  if (author?.__typename === 'Bot') return { kind: 'bot', name: /dependabot/i.test(author.login ?? '') ? 'Dependabot' : 'A bot', sub: merger ? `${merger} merged it` : 'Merged' };
  const maker = firstName(author) ?? 'A developer';
  const with_ = /^claude\//.test(branch) ? 'Written with Claude Code' : '';
  return { kind: 'dev', name: maker, sub: [with_, merger && merger !== maker ? `${merger} merged it` : ''].filter(Boolean).join('; ') };
}

// ---- the issues it names ---------------------------------------------------------------------------

/** Each Linear issue a pull request names: 'p' when its text says it is part of the issue, else 'f' (it fixes it). */
export function issuesOf(title: string, body: string, branch: string): { id: string; r: 'f' | 'p' }[] {
  const fromBranch = /(?:^|\/)lan-(\d{1,7})\b/i.exec(branch);
  const ids = namedIssues(title, body, fromBranch ? `LAN-${fromBranch[1]}` : '');
  const part = new Set<string>();
  for (const m of body.matchAll(/Part of\s+((?:\[?LAN-\d+\]?(?:\([^)]*\))?(?:,\s*|\s+and\s+)?)+)/gi)) for (const id of m[1]!.match(/LAN-\d+/g) ?? []) part.add(id);
  const fixes = new Set<string>();
  for (const m of body.matchAll(/(?:Fix(?:es|ed)?|Close[sd]?|Resolve[sd]?)\s+((?:\[?LAN-\d+\]?(?:\([^)]*\))?(?:,\s*|\s+and\s+)?)+)/gi)) for (const id of m[1]!.match(/LAN-\d+/g) ?? []) fixes.add(id);
  return ids.map((id) => ({ id, r: part.has(id) && !fixes.has(id) ? 'p' : 'f' }));
}

/** Up to three lines a person reads: the first items of its "What people see" section, else its summary. */
export function peopleLines(body: string): string[] {
  const m = /^#{1,4}\s*What people (?:see|get)\b[^\n]*\n([\s\S]*?)(?=\n#{1,4}\s|(?![\s\S]))/im.exec(body.replace(/<!--[\s\S]*?-->/g, ''));
  const lines = m ? m[1]!.split('\n').map((l) => l.replace(/^\s*(\d+\.|[-*+])\s+/, '').trim()).filter((l) => l && !/^[<|`]/.test(l)) : [];
  const plain = (l: string) => l.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_]{1,2}([^`*_]+)[`*_]{1,2}/g, '$1').replace(/\s+/g, ' ').trim();
  const out = lines.map(plain).filter(Boolean).slice(0, 3);
  if (out.length) return out.map((l) => (l.length > 240 ? l.slice(0, 239).replace(/\s+\S*$/, '') + '…' : l));
  const s = prSummary(body);
  return s ? [s.split('\n')[0]!] : [];
}

// ---- reading GitHub ---------------------------------------------------------------------------------

interface Pull {
  number: number; title: string; body: string | null; createdAt: string; mergedAt: string; headRefName: string; changedFiles: number;
  mergeCommit: { oid: string } | null; author: Actor | null; mergedBy: Actor | null;
  files: { nodes: { path: string }[] } | null; commits: { nodes: { commit: { authoredDate: string } }[] } | null;
}
export const PULLS_QUERY = `query ($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      number title body createdAt mergedAt headRefName changedFiles
      mergeCommit { oid }
      author { __typename login ... on User { name } }
      mergedBy { __typename login ... on User { name } }
      files(first: 100) { nodes { path } }
      commits(first: 1) { nodes { commit { authoredDate } } }
    } }
  }
}`;

/** A merge as the page draws it. Short keys: the line holds hundreds. */
export interface LineMerge {
  /** Pull request number, the merge commit, when it merged, its title as a person reads it. */
  n: number; s: string; t: string; ti: string;
  w: Who;
  /** Areas with their parts (areasOf), files changed, and the versions of the migrations it adds. */
  ar: [Area, string[]][]; nf: number; mg?: string[];
  is?: { id: string; r: 'f' | 'p' }[];
  /** What people see. */
  pe?: string[];
  /** When the pull request opened, and when work on it started: its first commit, or the pull request when that is earlier. */
  op: string; ws: string;
  /** It changed the phone app. */
  app?: 1;
  /** Each platform's update EAS published from this commit, and store build made from it. */
  up?: { ios?: string; android?: string };
  sb?: { ios?: string; android?: string };
  /** When a bundle that holds it first ran on a production iPhone and Android phone. */
  i?: string; a?: string;
}

export function lineMerge(p: Pull): LineMerge | null {
  if (!p.mergedAt || !p.mergeCommit) return null;
  const body = p.body ?? '';
  const files = (p.files?.nodes ?? []).map((f) => f.path);
  const first = p.commits?.nodes[0]?.commit.authoredDate;
  const merged = Date.parse(p.mergedAt);
  const starts = [Date.parse(p.createdAt), first ? Date.parse(first) : NaN].filter((t) => Number.isFinite(t) && t <= merged);
  const mg = files.map((f) => /^supabase\/migrations\/(\d{14})_/.exec(f)?.[1]).filter((v): v is string => !!v);
  const is = issuesOf(p.title, body, p.headRefName);
  const pe = peopleLines(body);
  return {
    n: p.number, s: p.mergeCommit.oid, t: new Date(merged).toISOString(), ti: plainTitle(p.title),
    w: whoOf(p.headRefName, p.author, p.mergedBy, body),
    ar: areasOf(files), nf: Math.max(p.changedFiles, files.length), ...(mg.length ? { mg } : {}),
    ...(is.length ? { is } : {}), ...(pe.length ? { pe } : {}),
    op: new Date(Date.parse(p.createdAt)).toISOString(), ws: new Date(Math.min(...starts, merged)).toISOString(),
    ...(files.some(inPhoneApp) ? { app: 1 as const } : {})
  };
}

const kept = new Map<number, LineMerge>();
let keptSince = 0, keptAt = 0;

async function readPulls(env: { GITHUB_REPO: string; ADMIN_GITHUB_TOKEN?: string }, fetcher: typeof fetch, from: number, now: number): Promise<LineMerge[]> {
  if (!env.ADMIN_GITHUB_TOKEN) throw new Error('GitHub search needs ADMIN_GITHUB_TOKEN.');
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  const search = async (q: string) => {
    const out: Pull[] = [];
    let after: string | null = null;
    for (let page = 0; page < 6; page++) {
      const answer: { data?: { search: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Pull[] } }; errors?: { message: string }[] } =
        await getJson(fetcher, 'https://api.github.com/graphql', {
          method: 'POST',
          headers: { authorization: `Bearer ${env.ADMIN_GITHUB_TOKEN}`, 'content-type': 'application/json', 'user-agent': 'langquest-next-admin' },
          body: JSON.stringify({ query: PULLS_QUERY, variables: { q, after } })
        }, 'GitHub search');
      if (answer.errors?.length || !answer.data) throw new Error(`GitHub search: ${answer.errors?.[0]?.message.slice(0, 160) ?? 'no answer'}`);
      out.push(...answer.data.search.nodes.filter((n) => n && n.number));
      if (!answer.data.search.pageInfo.hasNextPage) break;
      after = answer.data.search.pageInfo.endCursor;
    }
    return out;
  };
  // Merged pull requests do not change: after a full read, only the last day is read again, for six hours.
  const full = !keptAt || now - keptAt > 6 * 3_600_000 || from < keptSince;
  const start = full ? from : Math.max(from, now - 86_400_000);
  // Whole days in UTC, as GitHub's merged: dates are, from the first day to today, WINDOW_DAYS in each search.
  const windows: [number, number][] = [];
  const firstDay = Date.parse(day(start)), lastDay = Date.parse(day(now));
  for (let a = firstDay; a <= lastDay; a += WINDOW_DAYS * 86_400_000) windows.push([a, Math.min(lastDay, a + (WINDOW_DAYS - 1) * 86_400_000)]);
  const pulls = (await Promise.all(windows.map(([a, b]) =>
    search(`repo:${env.GITHUB_REPO} is:pr is:merged base:main merged:${day(a)}..${day(b)}`)))).flat();
  if (full) { kept.clear(); keptSince = from; keptAt = now; }
  for (const p of pulls) { const m = lineMerge(p); if (m) kept.set(m.n, m); }
  return [...kept.values()].filter((m) => Date.parse(m.t) >= from).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}

// ---- reading Expo ------------------------------------------------------------------------------------

export const LINE_EXPO_QUERY = `query ($id: String!) {
  app { byId(appId: $id) {
    updateBranches(offset: 0, limit: 10) { name updateGroups(offset: 0, limit: 100) { id platform createdAt gitCommitHash } }
    builds(offset: 0, limit: 60) { platform status createdAt appBuildVersion gitCommitHash buildProfile }
  } }
}`;
interface ExpoAnswer {
  data?: { app?: { byId?: {
    updateBranches?: { name: string; updateGroups?: { id: string; platform: string; createdAt: string; gitCommitHash?: string | null }[][] }[];
    builds?: { platform: string; status: string; createdAt: string; appBuildVersion?: string | null; gitCommitHash?: string | null; buildProfile?: string | null }[];
  } } };
  errors?: { message: string }[];
}
export interface ExpoMade { updates: { key: string; os: string; at: string; sha: string | null }[]; builds: { os: string; at: string; build: string; sha: string }[] }

export function expoMade(a: ExpoAnswer): ExpoMade {
  const app = a.data?.app?.byId;
  const updates = (app?.updateBranches ?? []).filter((b) => b.name === 'production').flatMap((b) => (b.updateGroups ?? []).flat())
    .map((u) => ({ key: u.id.slice(0, 8), os: u.platform.toLowerCase(), at: u.createdAt, sha: u.gitCommitHash ?? null }));
  const builds = (app?.builds ?? []).filter((b) => b.buildProfile === 'production' && b.status === 'FINISHED' && b.gitCommitHash && b.appBuildVersion)
    .map((b) => ({ os: b.platform.toLowerCase(), at: b.createdAt, build: b.appBuildVersion!, sha: b.gitCommitHash! }));
  return { updates, builds };
}

// ---- where each merge reached ---------------------------------------------------------------------------

export interface PhoneRuns {
  /** [update key, os, first seen, phones]. */
  updates: [string, string, string, number][];
  /** [os, app version, first seen, phones]. */
  builds: [string, string, string, number][];
  hours: [string, string, string, string, number][];
  days: [string, string, string, string, number][];
}
export const RELEASE_LINE_SQL = 'select diag.ops_release_line($1::int) as v';

/** The time a store version names: the merge's time in UTC (apps/mobile/app.config.js), "2026.1121.2103". */
export function versionTime(v: string): number | null {
  const m = /^(\d{4})\.(\d{3,4})\.(\d{1,4})$/.exec(v.split(' ')[0] ?? '');
  if (!m) return null;
  const md = Number(m[2]), hm = Number(m[3]);
  const t = Date.UTC(Number(m[1]), Math.floor(md / 100) - 1, md % 100, Math.floor(hm / 100), hm % 100);
  return Number.isFinite(t) ? t : null;
}

/** An update id's time: EAS ids are UUIDv7, whose first 8 hex digits are the time in units of 65,536 ms. */
export const updateKeyTime = (key: string): number | null => (/^[0-9a-f]{8}$/i.test(key) ? parseInt(key, 16) * 65_536 : null);

/**
 * Each app merge's updates and store builds, and when a bundle that holds it
 * first ran on each platform: a bundle holds every merge up to the commit it
 * was made from (an update's commit, as Expo says, or else 15 minutes before
 * EAS made it; a store build's version time).
 */
export function placeOnPhones(merges: LineMerge[], expo: ExpoMade | null, runs: PhoneRuns | null): void {
  const bySha = new Map(merges.map((m) => [m.s, m]));
  const shaTime = (sha: string | null | undefined) => (sha ? bySha.get(sha)?.t : undefined);
  const made = new Map<string, number>();
  for (const u of expo?.updates ?? []) {
    const m = u.sha ? bySha.get(u.sha) : undefined;
    if (m) (m.up ??= {})[u.os as 'ios' | 'android'] ??= u.at;
    const t = shaTime(u.sha);
    if (t) made.set(`${u.key}|${u.os}`, Date.parse(t));
  }
  for (const b of expo?.builds ?? []) {
    const m = bySha.get(b.sha);
    if (m) (m.sb ??= {})[b.os as 'ios' | 'android'] ??= b.build;
  }
  const bundles: { os: string; holds: number; first: number }[] = [];
  for (const [key, os, first] of runs?.updates ?? []) {
    const holds = made.get(`${key}|${os}`) ?? ((updateKeyTime(key) ?? NaN) - 15 * 60_000);
    if (Number.isFinite(holds)) bundles.push({ os, holds, first: Date.parse(first) });
  }
  for (const [os, v, first] of runs?.builds ?? []) {
    const holds = versionTime(v);
    if (holds !== null) bundles.push({ os, holds, first: Date.parse(first) });
  }
  for (const m of merges) {
    if (!m.app) continue;
    const t = Date.parse(m.t);
    for (const os of ['ios', 'android'] as const) {
      let best = Infinity;
      for (const b of bundles) if (b.os === os && b.holds >= t && b.first >= t && b.first < best) best = b.first;
      if (best < Infinity) m[os === 'ios' ? 'i' : 'a'] = new Date(best).toISOString();
    }
  }
}

// ---- failures each hour --------------------------------------------------------------------------------

export interface ErrorKind {
  id: string; label: string; group: string; total: number;
  /** [hours since the line's first hour, count, hours it covers (1, or 24 for a day before diag.hourly's days)]. */
  s: [number, number, number][];
}
const SERVER: Record<string, string> = { other: 'Other requests', ops: 'Ops dashboard requests', blobs_get: 'File downloads', blobs_put: 'File uploads', r2_put: 'Saving files to R2' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One series for each kind of failure; a total that has keys the same hour is left out, so nothing counts twice. */
export function errorKinds(runs: PhoneRuns | null, h0: number): ErrorKind[] {
  const kinds = new Map<string, ErrorKind>();
  const rows = [...(runs?.days ?? []).map((r) => [r, 24] as const), ...(runs?.hours ?? []).map((r) => [r, 1] as const)];
  const keyed = new Set(rows.filter(([r]) => r[3] !== '').map(([r]) => `${r[0]}|${r[1]}|${r[2]}`));
  for (const [[at, part, metric, key, value], span] of rows) {
    if (key === '' && keyed.has(`${at}|${part}|${metric}`)) continue;
    const group = part === 'worker' ? 'Requests that failed on the server' : part === 'jobs' || part === 'cron' ? 'Job runs that failed' : METRICS[part]?.[metric]?.label ?? metric;
    const label = part === 'worker' ? SERVER[key] ?? cap(key || 'all') : part === 'cron' ? `Database timer: ${key || 'any'}` : part === 'jobs' ? cap((key || 'any job').replace(/_/g, ' '))
      : key ? key.replace(/:/g, ' · ') : METRICS[part]?.[metric]?.label ?? metric;
    const id = `${part}.${metric}.${key}`;
    const k = kinds.get(id) ?? { id, label: label.slice(0, 160), group, total: 0, s: [] };
    const t = Date.parse(span === 24 ? `${at}T00:00:00Z` : at);
    if (!Number.isFinite(t)) continue;
    k.s.push([Math.round((t - h0) / 3_600_000), Number(value), span]);
    k.total += Number(value);
    kinds.set(id, k);
  }
  return [...kinds.values()].sort((a, b) => a.group.localeCompare(b.group) || b.total - a.total);
}

// ---- the answer ---------------------------------------------------------------------------------------------

export interface Timeline {
  /** The line's first hour and now. */
  from: string; now: string;
  merges: LineMerge[];
  /** The commit the web app serves, and the merge it is. */
  web: { sha: string; n: number | null } | null;
  errors: ErrorKind[];
  /** What could not be read: the line shows the rest. */
  notes: string[];
}

type Env = { DIAG?: Hyperdrive; GITHUB_REPO: string; ADMIN_GITHUB_TOKEN?: string; APP_URL: string; ADMIN_EXPO_TOKEN?: string; EXPO_PROJECT_ID: string };

export async function timelineSection(env: Env, fetcher: typeof fetch = fetch, now = Date.now(),
  diag: <T>(fn: (q: Query) => Promise<T>) => Promise<T> = (fn) => withDiag(diagConnection(env), fn)): Promise<Section<Timeline>> {
  if (!env.ADMIN_GITHUB_TOKEN) return off('Add ADMIN_GITHUB_TOKEN: GitHub\'s search, which the line of merges reads, takes no anonymous call (docs/admin.md).') as Section<Timeline>;
  const notes: string[] = [];
  const note = (what: string) => (e: unknown) => { notes.push(`${what}: ${e instanceof Error ? e.message : String(e)}`); return null; };
  const from = Math.floor((now - LINE_DAYS * 86_400_000) / 3_600_000) * 3_600_000;
  const expo = env.ADMIN_EXPO_TOKEN
    ? getJson<ExpoAnswer>(fetcher, 'https://api.expo.dev/graphql', {
      method: 'POST', headers: { authorization: `Bearer ${env.ADMIN_EXPO_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: LINE_EXPO_QUERY, variables: { id: env.EXPO_PROJECT_ID } })
    }, 'Expo').then((a) => { if (a.errors?.length) throw new Error(a.errors[0]!.message.slice(0, 160)); return expoMade(a); }).catch(note('Expo'))
    : Promise.resolve(null);
  const runs = Promise.resolve().then(() => diag((q) => q<PhoneRuns>(RELEASE_LINE_SQL, [LINE_DAYS + 1]))).catch(note('Phones and failures (diag.ops_release_line)'));
  const web = fetcher(`${env.APP_URL.replace(/\/+$/, '')}/version.json`, { signal: AbortSignal.timeout(8000) })
    .then(async (r) => (r.ok ? String(((await r.json()) as { build?: unknown }).build ?? '') || null : null)).catch(() => null);
  const [merges, e, r, w] = await Promise.all([readPulls(env, fetcher, from, now), expo, runs, web]);
  placeOnPhones(merges, e, r);
  const served = w ? merges.find((m) => m.s.startsWith(w) || w.startsWith(m.s.slice(0, 7))) : undefined;
  return ok<Timeline>({
    from: new Date(from).toISOString(), now: new Date(now).toISOString(), merges,
    web: w ? { sha: w.slice(0, 12), n: served?.n ?? null } : null,
    errors: errorKinds(r, from), notes
  });
}

/** For tests: forget the pull requests read. */
export function forgetLine(): void { kept.clear(); keptAt = 0; keptSince = 0; }
