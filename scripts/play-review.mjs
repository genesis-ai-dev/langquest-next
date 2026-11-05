// Move the newest Android build from internal testing to production review
// when nothing is in review on Google Play (decisions.md 157, amended
// 2026-11-04).
//
// A merge into main that makes a new Android build uploads it to Play's
// internal testing track (eas.json, submit.internal), and this step runs
// right after; an EAS schedule runs it every hour too
// (app-store-review.yml). Play reviews a new production release from the
// start, and a newer one sent while another is in review takes its place, so
// the new build waits in internal testing while an older one is in review,
// as an iPhone build waits in TestFlight. A merge whose pull request is
// labelled `store: replace review` (scripts/store-choice.mjs) skips the wait:
// the workflow sends its build straight to production.
//
// Google's API cannot say whether a release is in review: it calls a
// production release completed from the moment it is sent
// (issuetracker.google.com/208842993). Play's public page shows the version
// people can download, and only once Google approved it (the store check
// reads it too, apps/web/worker/storeReleases.ts). So a production release
// whose version is not the one the page shows is in review, and while the
// page cannot be read the build waits. A release Google rejected stays in
// production unpublished, and the build waits until a person acts in Play
// Console, or a merge labelled `store: replace review` sends its build in
// its place.
//
//   node scripts/play-review.mjs             look, and send when it is time
//   node scripts/play-review.mjs --dry-run   look, and say what it would do
//
// It needs a Google Play service account key with "Release to production",
// as PLAY_REVIEW_KEY: the JSON file Google Cloud gives for the key. It is a
// secret in .env.production, and `npm run secrets -- production --only eas`
// puts it in EAS's production environment (docs/environments.md, "The Play
// key"). Its only writes are a production release of a build already in
// internal testing.
import { createPrivateKey, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
/** The app's id on Google Play (app.json, android.package). */
export const PACKAGE = 'com.frontierrnd.langquestnext';
const PAGE = `https://play.google.com/store/apps/details?id=${PACKAGE}&hl=en&gl=us`;

/** What the step says while it has no key. */
export const NO_KEY = 'no Google Play key yet (PLAY_REVIEW_KEY is not in EAS\'s production environment), so the newest Android build waits in internal testing for a person to promote it to production in Play Console';
/** Release states that count as sent: a production release is sent once it is completed, or rolling out. */
const SENT = ['completed', 'inProgress'];

/** The newest release of a track (the one with the highest version code) among those sent, or null. */
export function newestRelease(releases = []) {
  let best = null;
  for (const r of releases) {
    if (!SENT.includes(r?.status)) continue;
    const codes = (r.versionCodes ?? []).map(Number).filter(Number.isFinite);
    if (!codes.length) continue;
    const code = Math.max(...codes);
    if (!best || code > best.code) best = { name: r.name ?? null, code, versionCodes: r.versionCodes.map(String) };
  }
  return best;
}

/** Whether version `a` is at least version `b`, for dotted numbers (2026.1104.802); null when either is not one. */
function atLeast(a, b) {
  const parts = (v) => (/^\d+(\.\d+)*$/.test(v ?? '') ? v.split('.').map(Number) : null);
  const [x, y] = [parts(a), parts(b)];
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return true;
}

/**
 * What to do now: `production` and `internal` are the tracks' releases as
 * Google's API gives them, `live` the version Play's page shows (null when
 * it could not be read). The action is `promote` (the newest internal build
 * goes to production review), `wait` (a release is in review, or nobody can
 * tell) or `none` (nothing newer waits).
 */
export function nextPlayStep({ production = [], internal = [], live = null }) {
  const sent = newestRelease(production);
  const waiting = newestRelease(internal);
  const name = (r) => `build ${r.code}${r.name ? ` (${r.name})` : ''}`;
  if (!waiting) return { action: 'none', why: 'no build is in internal testing' };
  if (sent && waiting.code <= sent.code) return { action: 'none', why: `${name(waiting)} is not newer than ${name(sent)} on production` };
  const waits = `so ${name(waiting)} waits in internal testing and goes on a later run`;
  if (sent) {
    if (live === null) return { action: 'wait', why: `Google Play's page could not be read, so nobody can tell whether ${name(sent)} is still in review, ${waits}` };
    if (sent.name !== live && atLeast(live, sent.name) !== true) {
      return {
        action: 'wait',
        why: `${name(sent)} is in review on Google Play (people get ${live}), ${waits}. If Google rejected it, someone fixes it in Play Console, or a merge labelled "store: replace review" sends its build in its place`
      };
    }
  }
  return { action: 'promote', why: `nothing is in review on Google Play${live ? ` (people get ${live})` : ''}, so ${name(waiting)} goes to production review`, release: waiting };
}

/**
 * The service account key from PLAY_REVIEW_KEY, or null while there is
 * none. A value that is there but is not a key throws, so a bad key fails
 * the job instead of quietly waiting.
 */
export function playKey(env) {
  const raw = env.PLAY_REVIEW_KEY?.trim();
  if (!raw) return null;
  const shape = 'the JSON key file of a Google Play service account that docs/environments.md ("The Play key") describes';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`PLAY_REVIEW_KEY is not ${shape}`);
  }
  const privateKey = typeof parsed?.private_key === 'string' ? parsed.private_key.replaceAll('\\n', '\n') : '';
  if (typeof parsed?.client_email !== 'string' || !parsed.client_email || !privateKey) {
    throw new Error(`PLAY_REVIEW_KEY is not ${shape}: it lacks ${['client_email', 'private_key'].filter((k) => !parsed?.[k]).join(', ') || 'a field'}`);
  }
  try {
    createPrivateKey(privateKey);
  } catch {
    throw new Error('PLAY_REVIEW_KEY\'s private_key is not a private key');
  }
  return { clientEmail: parsed.client_email, privateKey };
}

/** The signed request for an access token (Google's service account flow), good for an hour. */
export function assertion({ clientEmail, privateKey }, now = Date.now()) {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const iat = Math.floor(now / 1000);
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iss: clientEmail, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(createPrivateKey(privateKey));
  return `${unsigned}.${sig.toString('base64url')}`;
}

/** Calls the Play Developer API for the app: method, path under the app, and the body to send. */
export async function client(key, { fetch: fetchImpl = fetch, now = Date.now } = {}) {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: assertion(key, now()) }).toString(),
    signal: AbortSignal.timeout(30_000)
  });
  if (!res.ok) throw new Error(`Google refused the Play key (${res.status}): ${await res.text()}`);
  const { access_token: accessToken } = await res.json();
  return async (method, path, body) => {
    const answer = await fetchImpl(`${API}/${PACKAGE}${path}`, {
      method,
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000)
    });
    if (!answer.ok) throw new Error(`Google Play answered ${answer.status} to ${method} ${path}: ${await answer.text()}`);
    return answer.status === 204 ? null : answer.json().catch(() => null);
  };
}

/** The production and internal tracks' releases, read in an edit that is thrown away. */
export async function look(api) {
  const edit = await api('POST', '/edits');
  try {
    const { tracks = [] } = (await api('GET', `/edits/${edit.id}/tracks`)) ?? {};
    const of = (name) => tracks.find((t) => t.track === name)?.releases ?? [];
    return { production: of('production'), internal: of('internal') };
  } finally {
    await api('DELETE', `/edits/${edit.id}`).catch(() => {});
  }
}

/** Sends a build that is in internal testing to production review, released to everyone once Google approves it. */
export async function promote(api, release) {
  const edit = await api('POST', '/edits');
  await api('PUT', `/edits/${edit.id}/tracks/production`, {
    track: 'production',
    releases: [{ ...(release.name ? { name: release.name } : {}), versionCodes: release.versionCodes, status: 'completed' }]
  });
  await api('POST', `/edits/${edit.id}:commit`);
}

/** The version people can download from Google Play now, from its public page, or null. */
export async function livePlayVersion({ fetch: fetchImpl = fetch } = {}) {
  const res = await fetchImpl(PAGE, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; LangQuest Play review)' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return null;
  // The page carries its data as JSON; the current version is the only string in a [[["…"]] of its own.
  return /\[\[\["(\d+(?:\.\d+){0,2})"\]\]/.exec(await res.text())?.[1] ?? null;
}

/** One run: look, say what is next, and send when it is time. Returns the step. */
export async function run({ env = process.env, args = [], fetch: fetchImpl = fetch, log = console.log, live = () => livePlayVersion({ fetch: fetchImpl }) } = {}) {
  const key = playKey(env);
  if (!key) {
    log(`wait: ${NO_KEY}.`);
    return { action: 'wait', why: NO_KEY };
  }
  const api = await client(key, { fetch: fetchImpl });
  const tracks = await look(api);
  const step = nextPlayStep({ ...tracks, live: await live().catch(() => null) });
  log(`${step.action}: ${step.why}.`);
  if (args.includes('--dry-run') || step.action !== 'promote') return step;
  await promote(api, step.release);
  log(`Build ${step.release.code} is in production review, and goes public when Google approves it.`);
  return step;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = JSON.parse(readFileSync(new URL('../apps/mobile/app.json', import.meta.url), 'utf8'));
  if (app.expo?.android?.package !== PACKAGE) {
    console.error(`app.json's android.package is ${app.expo?.android?.package}, not ${PACKAGE}`);
    process.exit(1);
  }
  run({ args: process.argv.slice(2) }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
