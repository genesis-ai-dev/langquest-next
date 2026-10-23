import { jsonSecret, signJwt } from '../jwt';
import { getJson, ok, off, type Alert, type Section } from '../section';

/**
 * The Android app on Google Play: crash and ANR rates from Android vitals
 * (the Play Developer Reporting API), the top crash and ANR clusters, and
 * the last week's reviews. Read with a service account that Play Console
 * lets view app information, never one that can publish. Reviewers' names
 * are left out.
 */

/** Play's bad-behaviour lines for user-perceived rates (Android vitals). */
export const CRASH_LINE = 0.0109;
export const ANR_LINE = 0.0047;

export interface Rate { userPerceived: number; rate: number; users: number }
export interface GooglePlay {
  package: string;
  /** The last 7 days Play has data for, weighted by each day's users. */
  crash: Rate | null;
  anr: Rate | null;
  freshThrough: string | null;
  issues: { type: string; cause: string | null; location: string | null; reports: number; users: number; lastAt: string | null; uri: string | null }[];
  reviews: { lowWeek: number; average: number | null; recent: { stars: number; text: string; version: string | null; at: string }[] } | null;
  notes: string[];
}

interface ServiceAccount { client_email: string; private_key: string }
interface GDate { year: number; month: number; day: number; timeZone?: { id: string } }
interface MetricRow { startTime?: GDate; metrics?: { metric: string; decimalValue?: { value?: string } }[] }

const REPORTING = 'https://playdeveloperreporting.googleapis.com/v1beta1';
const SCOPES = 'https://www.googleapis.com/auth/playdeveloperreporting https://www.googleapis.com/auth/androidpublisher';

/** One access token per service account per isolate, renewed a few minutes before Google's hour runs out. */
const tokens = new Map<string, { token: string; until: number }>();

export async function googleToken(account: ServiceAccount, fetcher: typeof fetch, now = Date.now()): Promise<string> {
  const hit = tokens.get(account.client_email);
  if (hit && hit.until > now) return hit.token;
  const iat = Math.floor(now / 1000);
  const assertion = await signJwt('RS256', account.private_key, {
    iss: account.client_email, scope: SCOPES, aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600
  });
  const response = await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${assertion}`,
    signal: AbortSignal.timeout(10_000)
  });
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !body.access_token) throw new Error(`Google sign-in for the service account: ${body.error ?? `HTTP ${response.status}`}`);
  tokens.set(account.client_email, { token: body.access_token, until: now + ((body.expires_in ?? 3600) - 300) * 1000 });
  return body.access_token;
}

const dateOf = (d: GDate) => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

/** A Play date `days` before another, same time zone. */
function minusDays(d: GDate, days: number): GDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day) - days * 86_400_000);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate(), ...(d.timeZone ? { timeZone: d.timeZone } : {}) };
}

/**
 * The week's rate as Play judges it: the newest day's 7-day user-weighted
 * rates when Play gives them, else the days' rates weighted by their users.
 * Play's decimals are fractions (0.0109 is 1.09%), as Google's API returns
 * percentages elsewhere; check on the first real answer (docs/admin.md).
 */
export function weekRate(rows: MetricRow[], perceived: string, plain: string): Rate | null {
  const latest = [...rows].filter((r) => r.startTime).sort((a, b) => dateOf(b.startTime!).localeCompare(dateOf(a.startTime!)))[0];
  if (latest) {
    const m = Object.fromEntries((latest.metrics ?? []).map((x) => [x.metric, Number(x.decimalValue?.value ?? NaN)]));
    const p7 = m[`${perceived}7dUserWeighted`], r7 = m[`${plain}7dUserWeighted`];
    if (Number.isFinite(p7 ?? NaN)) return { userPerceived: p7!, rate: Number.isFinite(r7 ?? NaN) ? r7! : p7!, users: m.distinctUsers ?? 0 };
  }
  return weighted(rows, perceived, plain);
}

/** Days' rates folded into one, each day weighted by its distinct users. */
export function weighted(rows: MetricRow[], perceived: string, plain: string): Rate | null {
  let users = 0, perceivedSum = 0, plainSum = 0;
  for (const row of rows) {
    const m = Object.fromEntries((row.metrics ?? []).map((x) => [x.metric, Number(x.decimalValue?.value ?? NaN)]));
    const u = m.distinctUsers ?? 0;
    if (!u || !Number.isFinite(m[perceived] ?? NaN)) continue;
    users += u;
    perceivedSum += (m[perceived] ?? 0) * u;
    plainSum += (Number.isFinite(m[plain] ?? NaN) ? m[plain]! : 0) * u;
  }
  return users ? { userPerceived: perceivedSum / users, rate: plainSum / users, users } : null;
}

export function playAlerts(p: GooglePlay): Alert[] {
  const out: Alert[] = [];
  const pc = (x: number) => `${(x * 100).toFixed(2)}%`;
  if (p.crash && p.crash.userPerceived >= CRASH_LINE) out.push({ level: 'problem', text: `Google Play: ${pc(p.crash.userPerceived)} of Android users met a crash over the last 7 days, past Play's ${pc(CRASH_LINE)} bad-behaviour line.` });
  else if (p.crash && p.crash.userPerceived >= CRASH_LINE / 2) out.push({ level: 'watch', text: `Google Play: user-perceived crash rate is ${pc(p.crash.userPerceived)} over the last 7 days (Play's line is ${pc(CRASH_LINE)}).` });
  if (p.anr && p.anr.userPerceived >= ANR_LINE) out.push({ level: 'problem', text: `Google Play: ${pc(p.anr.userPerceived)} of Android users met an ANR (app not responding) over the last 7 days, past Play's ${pc(ANR_LINE)} line.` });
  else if (p.anr && p.anr.userPerceived >= ANR_LINE / 2) out.push({ level: 'watch', text: `Google Play: user-perceived ANR rate is ${pc(p.anr.userPerceived)} over the last 7 days (Play's line is ${pc(ANR_LINE)}).` });
  if (p.reviews && p.reviews.lowWeek > 0) out.push({ level: 'watch', text: `Google Play: ${p.reviews.lowWeek} one- or two-star review${p.reviews.lowWeek === 1 ? '' : 's'} in the last 7 days.` });
  return out;
}

async function rates(fetcher: typeof fetch, headers: Record<string, string>, pkg: string, set: string, metrics: string[]): Promise<{ rows: MetricRow[]; through: GDate | null }> {
  const meta = await getJson<{ freshnessInfo?: { freshnesses?: { aggregationPeriod: string; latestEndTime: GDate }[] } }>(fetcher,
    `${REPORTING}/apps/${pkg}/${set}`, { headers }, `Play ${set}`);
  const end = meta.freshnessInfo?.freshnesses?.find((f) => f.aggregationPeriod === 'DAILY')?.latestEndTime ?? null;
  if (!end) return { rows: [], through: null };
  // Daily rows are in Play's own time zone (America/Los_Angeles), which the end time names; the end is
  // exclusive and is where Play's data stops, so this is the last 7 days Play has.
  const weekly = metrics.map((m) => `${m}7dUserWeighted`);
  const body = { timelineSpec: { aggregationPeriod: 'DAILY', startTime: minusDays(end, 7), endTime: end }, metrics: [...metrics, ...weekly, 'distinctUsers'] };
  const answer = await getJson<{ rows?: MetricRow[] }>(fetcher, `${REPORTING}/apps/${pkg}/${set}:query`,
    { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }, `Play ${set}`);
  return { rows: answer.rows ?? [], through: minusDays(end, 1) };
}

interface Review { comments?: { userComment?: { text?: string; starRating?: number; appVersionName?: string; lastModified?: { seconds?: string | number } } }[] }

export function reviewsFrom(list: Review[], now = Date.now()): GooglePlay['reviews'] {
  const items = list.flatMap((r) => {
    const c = r.comments?.find((x) => x.userComment)?.userComment;
    if (!c?.starRating) return [];
    return [{ stars: c.starRating, text: (c.text ?? '').trim().slice(0, 400), version: c.appVersionName ?? null, at: new Date(Number(c.lastModified?.seconds ?? 0) * 1000).toISOString() }];
  }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const week = items.filter((r) => now - Date.parse(r.at) < 7 * 86_400_000);
  return {
    lowWeek: week.filter((r) => r.stars <= 2).length,
    average: items.length ? items.reduce((a, r) => a + r.stars, 0) / items.length : null,
    recent: items.slice(0, 5)
  };
}

export async function googlePlaySection(env: { ADMIN_GOOGLE_PLAY_KEY?: string; GOOGLE_PLAY_PACKAGE: string }, fetcher: typeof fetch = fetch, now = Date.now()): Promise<Section<GooglePlay>> {
  if (!env.ADMIN_GOOGLE_PLAY_KEY) {
    return off('Add ADMIN_GOOGLE_PLAY_KEY: a Google service account key (JSON) that Play Console lets "View app information (read-only)" (docs/admin.md).') as Section<GooglePlay>;
  }
  const account = jsonSecret<ServiceAccount>(env.ADMIN_GOOGLE_PLAY_KEY, 'ADMIN_GOOGLE_PLAY_KEY', ['client_email', 'private_key']);
  const headers = { authorization: `Bearer ${await googleToken(account, fetcher, now)}` };
  const pkg = env.GOOGLE_PLAY_PACKAGE;
  const notes: string[] = [];
  const note = (what: string) => (e: unknown) => { notes.push(`${what}: ${e instanceof Error ? e.message : String(e)}`); return null; };

  const [crash, anr, issues, reviews] = await Promise.all([
    rates(fetcher, headers, pkg, 'crashRateMetricSet', ['crashRate', 'userPerceivedCrashRate']),
    rates(fetcher, headers, pkg, 'anrRateMetricSet', ['anrRate', 'userPerceivedAnrRate']).catch(note('ANR rate')),
    issuesOf(fetcher, headers, pkg, now).catch(note('Top issues')),
    getJson<{ reviews?: Review[] }>(fetcher, `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}/reviews?maxResults=100`, { headers }, 'Play reviews')
      .then((r) => reviewsFrom(r.reviews ?? [], now))
      .catch(note('Reviews'))
  ]);
  const play: GooglePlay = {
    package: pkg,
    crash: weekRate(crash.rows, 'userPerceivedCrashRate', 'crashRate'),
    anr: anr ? weekRate(anr.rows, 'userPerceivedAnrRate', 'anrRate') : null,
    freshThrough: crash.through ? dateOf(crash.through) : null,
    issues: issues ?? [],
    reviews,
    notes
  };
  return ok(play, playAlerts(play));
}

interface ErrorIssue { type?: string; cause?: string; location?: string; errorReportCount?: string | number; distinctUsers?: string | number; lastErrorReportTime?: string; issueUri?: string }

/** The interval's ends, which errorIssues:search wants on whole hours in UTC. */
function hourParams(prefix: string, t: Date): Record<string, string> {
  return {
    [`${prefix}.year`]: String(t.getUTCFullYear()), [`${prefix}.month`]: String(t.getUTCMonth() + 1), [`${prefix}.day`]: String(t.getUTCDate()),
    [`${prefix}.hours`]: String(t.getUTCHours()), [`${prefix}.timeZone.id`]: 'UTC'
  };
}

async function issuesOf(fetcher: typeof fetch, headers: Record<string, string>, pkg: string, now: number): Promise<GooglePlay['issues']> {
  const end = new Date(Math.floor(now / 3_600_000) * 3_600_000);
  const q = new URLSearchParams({
    pageSize: '8',
    orderBy: 'errorReportCount desc',
    ...hourParams('interval.startTime', new Date(end.getTime() - 7 * 86_400_000)),
    ...hourParams('interval.endTime', end)
  });
  const answer = await getJson<{ errorIssues?: ErrorIssue[] }>(fetcher, `${REPORTING}/apps/${pkg}/errorIssues:search?${q}`, { headers }, 'Play error issues');
  return (answer.errorIssues ?? []).map((i) => ({
    // The filter says ANR, the answer APPLICATION_NOT_RESPONDING.
    type: i.type === 'APPLICATION_NOT_RESPONDING' ? 'ANR' : i.type ?? 'ERROR', cause: i.cause ?? null, location: i.location ?? null,
    reports: Number(i.errorReportCount ?? 0), users: Number(i.distinctUsers ?? 0), lastAt: i.lastErrorReportTime ?? null, uri: i.issueUri ?? null
  }));
}
