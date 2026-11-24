import type { JobStatusRpc } from './sources/container';
import { jsonSecret } from './jwt';
import { appStoreKey as parseAppStoreKey, appStoreToken, type AppStoreKey } from './sources/appstore';
import { googleToken, hourParams } from './sources/googleplay';
import { getJson, head, maskPersonal, need, num, Refused, str, type LogAnswer } from './logsShared';

/**
 * The provider APIs behind the log gate (logs.ts, docs/production-reads.md,
 * "Provider APIs";
 * docs/decisions/2026-11-24-agents-read-everything-but-personal-data.md):
 * whatever the read-only keys this Worker already holds for the ops
 * dashboard can read, for both logins alike. Each reader only reads: a GET,
 * or a GraphQL query (never a mutation) on an API that is read-only.
 * Personal data is taken out of every answer: fields that name or reach a
 * person (`PERSONAL_KEYS`), then emails, IP addresses and phone numbers in
 * any text (`maskPersonal`). The App Store's lists of people are refused.
 */

export interface ApisEnv {
  CLOUDFLARE_ACCOUNT_ID: string;
  EXPO_PROJECT_ID: string;
  GITHUB_REPO: string;
  APP_STORE_APP_ID?: string;
  GOOGLE_PLAY_PACKAGE?: string;
  /** Account Analytics Read, Workers Scripts Read, Workers CI Read. */
  ADMIN_CLOUDFLARE_TOKEN?: string;
  ADMIN_EXPO_TOKEN?: string;
  ADMIN_GITHUB_TOKEN?: string;
  ADMIN_APP_STORE_KEY?: string;
  ADMIN_GOOGLE_PLAY_KEY?: string;
  APP_JOBS?: JobStatusRpc;
}

export interface ApisDeps { env: ApisEnv; fetcher: typeof fetch; now: () => number }

export type ApiSource = 'cloudflare-graphql' | 'cloudflare-api' | 'github-api' | 'eas-graphql' | 'eas-updates' | 'eas-submissions'
  | 'app-store-api' | 'app-store-crash-log' | 'app-store-report' | 'play-crashes' | 'google-play-api' | 'r2-blobs';

export const API_SOURCES: Record<ApiSource, string> = {
  'cloudflare-graphql': 'Cloudflare\'s analytics (GraphQL): Worker requests, errors and CPU, R2 operations, Hyperdrive, Durable Objects: {query, variables?}; $account is filled in',
  'cloudflare-api': 'A GET on Cloudflare\'s API under the account: {path} such as workers/scripts, hyperdrive/configs, builds/...',
  'github-api': 'A GET on GitHub\'s API under this repository: {path} such as actions/runs?per_page=20, actions/runs/<id>/jobs, actions/runs/<id>/artifacts',
  'eas-graphql': 'Expo\'s API (GraphQL), a query and never a mutation: {query, variables?}; $appId is filled in',
  'eas-updates': 'The latest OTA updates on each branch: {limit?}',
  'eas-submissions': 'The latest store submissions from EAS and their errors: {limit?}',
  'app-store-api': 'A GET on App Store Connect: {path} such as v1/apps/{app}/appStoreVersions, v1/apps/{app}/betaFeedbackCrashSubmissions?sort=-createdDate&limit=20, v1/builds?filter[app]={app}',
  'app-store-crash-log': 'One TestFlight crash report\'s crash log: {submission}',
  'app-store-report': 'An App Store analytics report as rows, newest instance: {name?} ("App Crashes"), {granularity?} (DAILY, WEEKLY, MONTHLY)',
  'play-crashes': 'Google Play\'s crash and ANR groups over {days?} (7), or one group\'s reports with their stack traces: {issue?, limit?}',
  'google-play-api': 'A GET on Google Play: {api: reporting | publisher, path} such as apps/{package}/anrRateMetricSet (reporting) or reviews (publisher)',
  'r2-blobs': 'Stored files (BLOBS bucket): each key\'s size and time {keys: ["org/stream/<sha256>.m4a"]}, or a listing {prefix: "org/stream/", limit?, cursor?}'
};

/** Fields that name or reach a person: their value is replaced wherever it sits in an answer. */
export const PERSONAL_KEYS = /^(author_?name|reviewer_?nickname|nickname|first_?name|last_?name|full_?name|display_?name|e_?mail|email_?address|user_?name|login_?name|phone(_?number)?|ip_?address|client_?ip|avatar(_?url)?|actor_?name)$/i;

/** People in App Store Connect: never read. */
const PEOPLE_PATHS = /(^|\/)(users|userInvitations|betaTesters|betaTesterInvitations|actors)(\/|\?|$)/i;

/** A path below an API's base: no `..`, no scheme, no spaces. */
const PATH = /^[A-Za-z0-9_\-.~/:{}[\]]+(\?[^\s#]*)?$/;

function pathOf(v: unknown, fill: Record<string, string | undefined> = {}): string {
  const raw = str(v, 'path', PATH).replace(/^\/+/, '');
  if (raw.includes('..') || raw.includes('//')) throw new Refused('path holds .. or //');
  return raw.replace(/\{(\w+)\}/g, (m, k: string) => fill[k] ?? m);
}

export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, PERSONAL_KEYS.test(k) && v !== null && v !== '' ? '[hidden]' : scrub(v)]));
  }
  return value;
}

/** An API's answer as lines: JSON indented one space, personal data taken out, from the top. */
export function jsonLines(value: unknown, note?: string): LogAnswer {
  return head(JSON.stringify(scrub(value), null, 1).split('\n').map(maskPersonal), note);
}

async function getAny(d: ApisDeps, url: string, headers: Record<string, string>, what: string): Promise<LogAnswer> {
  const res = await d.fetcher(url, { headers, signal: AbortSignal.timeout(20_000) });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403 ? ' (the key is refused or lacks a permission)' : '';
    throw new Refused(`${what}: HTTP ${res.status}${hint}: ${maskPersonal((await res.text().catch(() => '')).slice(0, 500))}`, 502);
  }
  if (/json/.test(type)) return jsonLines(await res.json());
  if (/^text\/|javascript|xml|^$/.test(type)) return head((await res.text()).split('\n').map(maskPersonal));
  throw new Refused(`${what} answered ${type}, not text: read what it says about the file instead (its size, its name)`);
}

const READ_ONLY_QUERY = /^\s*(query\b|\{)/;
function queryOf(v: unknown): string {
  if (typeof v !== 'string' || v.length > 20_000 || !READ_ONLY_QUERY.test(v) || /\b(mutation|subscription)\b/.test(v)) {
    throw new Refused('Send {query: "query (...) { ... }"}: a query, never a mutation or subscription.');
  }
  return v;
}
const varsOf = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {});

// ---- Cloudflare ----

async function cloudflareGraphql(d: ApisDeps, body: Record<string, unknown>): Promise<LogAnswer> {
  const token = need(d.env.ADMIN_CLOUDFLARE_TOKEN, 'ADMIN_CLOUDFLARE_TOKEN', 'Cloudflare analytics');
  const query = queryOf(body.query);
  const variables = varsOf(body.variables);
  if (query.includes('$account') && variables.account === undefined) variables.account = d.env.CLOUDFLARE_ACCOUNT_ID;
  const answer = await getJson<{ data?: unknown; errors?: { message: string }[] | null }>(d.fetcher, 'https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query, variables })
  }, 'Cloudflare analytics');
  return jsonLines(answer.data ?? null, answer.errors?.length ? `Errors: ${answer.errors.map((e) => e.message).join('; ')}` : undefined);
}

async function cloudflareApi(d: ApisDeps, body: Record<string, unknown>): Promise<LogAnswer> {
  const token = need(d.env.ADMIN_CLOUDFLARE_TOKEN, 'ADMIN_CLOUDFLARE_TOKEN', 'Cloudflare\'s API');
  const path = pathOf(body.path, { account: d.env.CLOUDFLARE_ACCOUNT_ID });
  return getAny(d, `https://api.cloudflare.com/client/v4/accounts/${d.env.CLOUDFLARE_ACCOUNT_ID}/${path}`, { authorization: `Bearer ${token}` }, 'Cloudflare');
}

// ---- GitHub ----

async function githubApi(d: ApisDeps, body: Record<string, unknown>): Promise<LogAnswer> {
  const path = pathOf(body.path);
  return getAny(d, `https://api.github.com/repos/${d.env.GITHUB_REPO}/${path}`, {
    accept: 'application/vnd.github+json', 'user-agent': 'langquest-next-admin', ...(d.env.ADMIN_GITHUB_TOKEN ? { authorization: `Bearer ${d.env.ADMIN_GITHUB_TOKEN}` } : {})
  }, 'GitHub');
}

// ---- EAS ----

async function expo(d: ApisDeps, query: string, variables: Record<string, unknown>): Promise<{ data?: unknown; errors?: { message: string }[] }> {
  const token = need(d.env.ADMIN_EXPO_TOKEN, 'ADMIN_EXPO_TOKEN', 'EAS');
  return getJson(d.fetcher, 'https://api.expo.dev/graphql', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query, variables })
  }, 'EAS');
}

async function easGraphql(d: ApisDeps, body: Record<string, unknown>): Promise<LogAnswer> {
  const query = queryOf(body.query);
  const variables = varsOf(body.variables);
  if (query.includes('$appId') && variables.appId === undefined) variables.appId = d.env.EXPO_PROJECT_ID;
  const answer = await expo(d, query, variables);
  return jsonLines(answer.data ?? null, answer.errors?.length ? `Errors: ${answer.errors.map((e) => e.message).join('; ')}` : undefined);
}

async function easUpdates(d: ApisDeps, body: Record<string, unknown>): Promise<LogAnswer> {
  const limit = num(body.limit, 5, 20);
  const answer = await expo(d, `query ($appId: String!, $limit: Int!) { app { byId(appId: $appId) {
    updateBranches(offset: 0, limit: 20) { name updateGroups(offset: 0, limit: $limit) { id group platform message createdAt runtimeVersion gitCommitHash } }
  } } }`, { appId: d.env.EXPO_PROJECT_ID, limit });
  return jsonLines(answer.data ?? null, answer.errors?.length ? `Errors: ${answer.errors.map((e) => e.message).join('; ')}` : 'Each branch\'s newest update groups; one group holds an update for each platform.');
}

async function easSubmissions(d: ApisDeps, body: Record<string, unknown>): Promise<LogAnswer> {
  const limit = num(body.limit, 10, 30);
  const answer = await expo(d, `query ($appId: String!, $limit: Int!) { app { byId(appId: $appId) {
    submissions(filter: {}, offset: 0, limit: $limit) { id status platform createdAt error { errorCode message } submittedBuild { id appVersion } }
  } } }`, { appId: d.env.EXPO_PROJECT_ID, limit });
  return jsonLines(answer.data ?? null, answer.errors?.length ? `Errors: ${answer.errors.map((e) => e.message).join('; ')}` : undefined);
}

// ---- App Store Connect ----

function appStoreKey(d: ApisDeps): AppStoreKey {
  const raw = need(d.env.ADMIN_APP_STORE_KEY, 'ADMIN_APP_STORE_KEY', 'App Store Connect');
  try { return parseAppStoreKey(raw); } catch (e) { throw new Refused(e instanceof Error ? e.message : 'ADMIN_APP_STORE_KEY is not well formed', 503); }
}

async function appStoreApi(d: ApisDeps, body: Record<string, unknown>): Promise<LogAnswer> {
  const path = pathOf(body.path, { app: d.env.APP_STORE_APP_ID });
  if (!/^v[1-3]\//.test(path)) throw new Refused('path starts with v1/, v2/ or v3/');
  if (PEOPLE_PATHS.test(path)) throw new Refused('App Store Connect\'s lists of people (users, testers) are personal data and are not read.', 403);
  const token = await appStoreToken(appStoreKey(d), d.now());
  return getAny(d, `https://api.appstoreconnect.apple.com/${path}`, { authorization: `Bearer ${token}` }, 'App Store Connect');
}

async function appStoreCrashLog(d: ApisDeps, body: Record<string, unknown>): Promise<LogAnswer> {
  const id = str(body.submission, 'submission', /^[A-Za-z0-9_-]{4,80}$/);
  const token = await appStoreToken(appStoreKey(d), d.now());
  const answer = await getJson<{ data?: { attributes?: { logText?: string } } }>(d.fetcher,
    `https://api.appstoreconnect.apple.com/v1/betaFeedbackCrashSubmissions/${id}/crashLog`, { headers: { authorization: `Bearer ${token}` } }, 'TestFlight crash log');
  const text = answer.data?.attributes?.logText;
  if (!text) throw new Refused('That crash report has no crash log', 404);
  return head(text.split('\n').map(maskPersonal));
}

/** Apple's analytics report files: gzip text on Apple's own hosts. */
const REPORT_HOST = /(^|\.)apple\.com$/;

async function appStoreReport(d: ApisDeps, body: Record<string, unknown>): Promise<LogAnswer> {
  const name = typeof body.name === 'string' && /^[\w ,&()-]{2,80}$/.test(body.name) ? body.name : 'App Crashes';
  const granularity = typeof body.granularity === 'string' && /^(DAILY|WEEKLY|MONTHLY)$/.test(body.granularity) ? body.granularity : 'DAILY';
  const headers = { authorization: `Bearer ${await appStoreToken(appStoreKey(d), d.now())}` };
  const api = 'https://api.appstoreconnect.apple.com/v1';
  type List = { data?: { id: string; attributes?: Record<string, unknown> }[] };
  const requests = await getJson<List>(d.fetcher, `${api}/apps/${d.env.APP_STORE_APP_ID}/analyticsReportRequests?filter[accessType]=ONGOING`, { headers }, 'App Store report requests');
  const request = requests.data?.[0];
  if (!request) throw new Refused('There is no ongoing report request yet: run scripts/app-store-analytics-request.mjs on the Mac once.', 404);
  const reports = await getJson<List>(d.fetcher, `${api}/analyticsReportRequests/${request.id}/reports?filter[name]=${encodeURIComponent(name)}`, { headers }, 'App Store reports');
  const report = reports.data?.[0];
  if (!report) throw new Refused(`No report named ${name} yet. Apple makes the first ones 1 to 2 days after the request.`, 404);
  const instances = await getJson<List>(d.fetcher, `${api}/analyticsReports/${report.id}/instances?filter[granularity]=${granularity}&limit=1`, { headers }, 'App Store report instances');
  const instance = instances.data?.[0];
  if (!instance) throw new Refused(`The ${name} report has no ${granularity} instance yet.`, 404);
  const segments = await getJson<List>(d.fetcher, `${api}/analyticsReportInstances/${instance.id}/segments`, { headers }, 'App Store report segments');
  const lines: string[] = [];
  for (const segment of (segments.data ?? []).slice(0, 5)) {
    const url = typeof segment.attributes?.url === 'string' ? segment.attributes.url : '';
    let host = '';
    try { host = new URL(url).hostname; } catch { /* not a URL */ }
    if (!url.startsWith('https://') || !REPORT_HOST.test(host)) { lines.push(`(a segment on ${host || 'no host'}, not read: not one of Apple's hosts)`); continue; }
    const res = await d.fetcher(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok || !res.body) { lines.push(`(a segment answered HTTP ${res.status})`); continue; }
    const text = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).text();
    lines.push(...text.split('\n').filter(Boolean).map(maskPersonal));
  }
  return head(lines, `${name}, ${granularity}, the instance of ${String(instance.attributes?.processingDate ?? 'its newest day')}.`);
}

// ---- Google Play ----

async function playHeaders(d: ApisDeps): Promise<Record<string, string>> {
  const raw = need(d.env.ADMIN_GOOGLE_PLAY_KEY, 'ADMIN_GOOGLE_PLAY_KEY', 'Google Play');
  let account: { client_email: string; private_key: string };
  try { account = jsonSecret(raw, 'ADMIN_GOOGLE_PLAY_KEY', ['client_email', 'private_key']); } catch (e) { throw new Refused(e instanceof Error ? e.message : 'ADMIN_GOOGLE_PLAY_KEY is not well formed', 503); }
  return { authorization: `Bearer ${await googleToken(account, d.fetcher, d.now())}` };
}

function playPackage(d: ApisDeps): string {
  const pkg = d.env.GOOGLE_PLAY_PACKAGE;
  if (!pkg) throw new Refused('No GOOGLE_PLAY_PACKAGE is set', 503);
  return pkg;
}

async function playCrashes(d: ApisDeps, body: Record<string, unknown>): Promise<LogAnswer> {
  const pkg = playPackage(d);
  const headers = await playHeaders(d);
  const days = num(body.days, 7, 30);
  const end = new Date(Math.floor(d.now() / 3_600_000) * 3_600_000);
  const interval = { ...hourParams('interval.startTime', new Date(end.getTime() - days * 86_400_000)), ...hourParams('interval.endTime', end) };
  const base = `https://playdeveloperreporting.googleapis.com/v1beta1/apps/${pkg}`;
  if (body.issue !== undefined) {
    const issue = str(String(body.issue), 'issue', /^[A-Za-z0-9_-]{1,80}$/);
    const q = new URLSearchParams({ pageSize: String(num(body.limit, 10, 50)), filter: `errorIssueId = ${issue}`, ...interval });
    const answer = await getJson<unknown>(d.fetcher, `${base}/errorReports:search?${q}`, { headers }, 'Play error reports');
    return jsonLines(answer, 'Each report\'s reportText is its stack trace.');
  }
  const q = new URLSearchParams({ pageSize: String(num(body.limit, 25, 50)), orderBy: 'errorReportCount desc', ...interval });
  const answer = await getJson<unknown>(d.fetcher, `${base}/errorIssues:search?${q}`, { headers }, 'Play error issues');
  return jsonLines(answer, 'Read one group\'s reports with {issue: <the id at the end of its name>}.');
}

async function googlePlayApi(d: ApisDeps, body: Record<string, unknown>): Promise<LogAnswer> {
  const pkg = playPackage(d);
  const path = pathOf(body.path, { package: pkg });
  let url: string;
  if (body.api === 'reporting') {
    if (!path.startsWith(`apps/${pkg}`)) throw new Refused(`A reporting path starts with apps/{package}`);
    url = `https://playdeveloperreporting.googleapis.com/v1beta1/${path}`;
  } else if (body.api === 'publisher') {
    url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}/${path}`;
  } else throw new Refused('api is reporting or publisher');
  return getAny(d, url, await playHeaders(d), 'Google Play');
}

// ---- R2 ----

async function r2Blobs(d: ApisDeps, body: Record<string, unknown>): Promise<LogAnswer> {
  const jobs = d.env.APP_JOBS;
  if (!jobs?.blobs) throw new Refused('The admin Worker has no APP_JOBS binding with blobs (apps/admin/wrangler.jsonc).', 503);
  const keys = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === 'string').slice(0, 40) : undefined;
  const answer = await jobs.blobs(keys ? { keys } : {
    ...(typeof body.prefix === 'string' ? { prefix: body.prefix } : {}), limit: num(body.limit, 100, 1000), ...(typeof body.cursor === 'string' ? { cursor: body.cursor } : {})
  });
  if (answer.error) throw new Refused(answer.error);
  const lines = ['key\tsize\tuploaded\ttype', ...answer.objects.map((o) => [o.key, o.size, o.uploaded, o.type ?? ''].join('\t')), ...answer.missing.map((k) => `${k}\tmissing`)];
  return head(lines, answer.truncated ? `More files: send cursor ${answer.cursor}` : undefined);
}

export const API_READERS: Record<ApiSource, (d: ApisDeps, body: Record<string, unknown>) => Promise<LogAnswer>> = {
  'cloudflare-graphql': cloudflareGraphql,
  'cloudflare-api': cloudflareApi,
  'github-api': githubApi,
  'eas-graphql': easGraphql,
  'eas-updates': easUpdates,
  'eas-submissions': easSubmissions,
  'app-store-api': appStoreApi,
  'app-store-crash-log': appStoreCrashLog,
  'app-store-report': appStoreReport,
  'play-crashes': playCrashes,
  'google-play-api': googlePlayApi,
  'r2-blobs': r2Blobs
};
