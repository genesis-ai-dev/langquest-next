// Send the newest iPhone build to Apple's review (decisions.md 157).
//
// The EAS workflow on main runs this after each new build reaches
// TestFlight, and an EAS schedule runs it every hour. Apple reviews one
// version at a time, and a version taken out of review loses its place in
// line, so this never cancels, changes or replaces what is in review: while
// a review is waiting or under way, or a version is approved and not yet
// out, the new build waits in TestFlight. When Apple rejects a version, a
// person reads Apple's message and answers it in App Store Connect; this
// waits for that, and never sends a rejected build again by itself. When
// nothing is open, it sends only the newest processed build that is newer
// than the public one, on an App Store version of its own (the version
// number that app.config.js gave the build), released as soon as Apple
// approves it. Its only writes are the version, its "What's New", and the
// review submission; it never deletes and never cancels.
//
//   node scripts/app-store-review.mjs             look, and send when it is time
//   node scripts/app-store-review.mjs --dry-run   look, and say what it would do
//
// It needs an App Store Connect API key, as APP_STORE_REVIEW_KEY: the JSON
// {"issuerId", "keyId", "privateKey"} (the .p8 file's text) of a team key
// with the App Manager role, or {"keyId", "privateKey"} of an individual
// key, which acts as the Admin or App Manager who made it. It is a secret
// in .env.production, and
// `npm run secrets -- production --only eas` puts it in EAS's production
// environment, where the workflows read it (docs/environments.md, "The App
// Store key"). The app is eas.json's ascAppId.
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'https://api.appstoreconnect.apple.com/v1';

/** Review submission states in which a review is waiting or under way: never touched. */
export const REVIEWING = ['WAITING_FOR_REVIEW', 'IN_REVIEW', 'CANCELING', 'COMPLETING'];
/** A submission that Apple answered with a rejection, open until a person answers it in App Store Connect. */
export const UNRESOLVED = 'UNRESOLVED_ISSUES';
/** A submission put together and not yet sent: App Store Connect's draft. Apple keeps one open submission per platform. */
export const DRAFT = 'READY_FOR_REVIEW';
/** Every submission state but COMPLETE: the ones this step reads. */
export const NOT_COMPLETE = [DRAFT, ...REVIEWING, UNRESOLVED];

/**
 * appStoreState's names that appVersionState (API 3.3) renamed. Apple
 * deprecated appStoreState in API 3.7; an answer that still has only it is
 * read with the new names.
 */
export const RENAMED = {
  READY_FOR_SALE: 'READY_FOR_DISTRIBUTION',
  PREORDER_READY_FOR_SALE: 'READY_FOR_DISTRIBUTION',
  REMOVED_FROM_SALE: 'READY_FOR_DISTRIBUTION',
  DEVELOPER_REMOVED_FROM_SALE: 'READY_FOR_DISTRIBUTION',
  PROCESSING_FOR_APP_STORE: 'PROCESSING_FOR_DISTRIBUTION'
};
/** The version people have. */
export const LIVE = 'READY_FOR_DISTRIBUTION';
/** Versions that newer ones replaced. */
export const PAST = ['REPLACED_WITH_NEW_VERSION', 'NOT_APPLICABLE'];
/** Versions that can take a new build and go to review. Apple keeps one at a time. */
export const EDITABLE = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'INVALID_BINARY'];
/** What each editable state says happened to the version's build, which is then never sent again by itself. */
export const REFUSED = {
  REJECTED: 'rejected by Apple',
  DEVELOPER_REJECTED: 'taken out of review',
  INVALID_BINARY: 'refused by Apple as an invalid build'
};
/** A version that is in a draft submission. */
export const IN_DRAFT = 'READY_FOR_REVIEW';
/** Apple refused the version's store details, which a person fixes in App Store Connect. */
export const METADATA_REJECTED = 'METADATA_REJECTED';
/**
 * States this step knows what to do with. Every other one (waiting for
 * review, in review, accepted, pending developer or Apple release,
 * processing for distribution, waiting for export compliance, and any state
 * Apple adds later) is a version on its way, so the new build waits.
 */
export const SETTLED = [LIVE, ...PAST, ...EDITABLE, IN_DRAFT, METADATA_REJECTED];
/** Words for "What's New", which Apple asks for on every version after the first. */
export const WHATS_NEW = 'Bug fixes and improvements.';
/** How long the step waits for Apple to call a version ready for review before it submits anyway: 10 looks, 15 s apart, as fastlane does. */
export const READY_LOOKS = 10;
export const READY_WAIT_MS = 15_000;
/** Apple finishes some changes a moment later and answers 409 meanwhile; adding the version to the submission is tried this often, 20 s apart. */
export const ITEM_TRIES = 6;
export const ITEM_WAIT_MS = 20_000;

/** What the step says while it has no key. */
export const NO_KEY = 'no App Store Connect key yet (APP_STORE_REVIEW_KEY is not in EAS\'s production environment), so the newest build waits in TestFlight for a person to send it to review';

const words = (state) => state.toLowerCase().replaceAll('_', ' ');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A version's state in appVersionState's names. */
export function stateOf(resource) {
  const a = resource?.attributes ?? {};
  const state = a.appVersionState ?? a.appStoreState ?? 'UNKNOWN';
  return RENAMED[state] ?? state;
}

/**
 * What to do now, from what App Store Connect says:
 * - `submissions`: the app's iPhone review submissions that are not complete
 *   ({ id, state, versionId, items }: the version it holds, if any, and how
 *   many items, null when Apple did not say);
 * - `versions`: the app's iPhone App Store versions ({ id, string, state, build });
 * - `newest`: the newest processed build ({ id, number, version }), or null;
 * - `processing`: newer builds that Apple is still processing ({ number }).
 *
 * The action is `submit` (with the version to use, or null for a new one,
 * and the draft submission to use, or null for a new one), `none` (nothing
 * to send), `wait` (a review or release is on its way: try again later),
 * `held` (a person has to act in App Store Connect first) or `stuck` (this
 * build can never go).
 */
export function nextStep({ submissions = [], versions = [], newest = null, processing = [] }) {
  const name = (v) => `version ${v.string}${Number.isFinite(v.build) ? ` (build ${v.build})` : ''}`;
  const byId = (id) => versions.find((v) => v.id === id) ?? null;
  const later = processing.filter((b) => !newest || b.number > newest.number).map((b) => b.number);
  const also = later.length ? `; build ${later.join(' and ')} ${later.length === 1 ? 'is' : 'are'} still processing at Apple` : '';
  if (!newest) return { action: 'none', why: `no processed build in TestFlight${also}` };
  const build = `build ${newest.number}`;
  const waits = `so ${build} waits in TestFlight and goes on a later run${also}`;

  const liveBuilds = versions.filter((v) => v.state === LIVE && Number.isFinite(v.build)).map((v) => v.build);
  const live = liveBuilds.length ? Math.max(...liveBuilds) : null;
  if (live !== null && newest.number <= live) return { action: 'none', why: `${build} is not newer than the public build ${live}${also}` };

  // A review that is waiting or under way is never cancelled or changed.
  const reviewing = submissions.find((s) => REVIEWING.includes(s.state));
  if (reviewing) {
    const v = byId(reviewing.versionId);
    if (v && v.build === newest.number) return { action: 'none', why: `${name(v)} is ${words(reviewing.state)}${also}` };
    return { action: 'wait', why: `${v ? name(v) : 'a submission'} is ${words(reviewing.state)}, ${waits}` };
  }
  // Nor is a version on its way: in review, approved, or being released.
  const busy = versions.find((v) => !SETTLED.includes(v.state));
  if (busy) {
    const until = busy.state === 'PENDING_DEVELOPER_RELEASE' ? ' until someone releases it in App Store Connect' : '';
    if (busy.build === newest.number) return { action: 'none', why: `${name(busy)} is ${words(busy.state)}${until}${also}` };
    return { action: 'wait', why: `${name(busy)} is ${words(busy.state)}${until}, ${waits}` };
  }
  // A rejection waits for a person: Apple's message needs an answer, and Apple takes no new submission while it is open.
  const rejected = submissions.find((s) => s.state === UNRESOLVED);
  if (rejected) {
    const v = byId(rejected.versionId);
    return {
      action: 'held',
      why: `Apple rejected ${v ? name(v) : 'a submission'}. Someone reads Apple's message in App Store Connect (App Review) and answers it there, then resubmits or removes it; until then ${build} waits in TestFlight${also}`
    };
  }
  const metadata = versions.find((v) => v.state === METADATA_REJECTED);
  if (metadata) {
    return { action: 'held', why: `Apple rejected the store details of ${name(metadata)}. Someone fixes them in App Store Connect and resubmits; until then ${build} waits in TestFlight${also}` };
  }

  // Apple takes one App Store version per version number.
  const own = versions.find((v) => v.string === newest.version) ?? null;
  if (own && (own.state === LIVE || PAST.includes(own.state))) {
    return { action: 'stuck', why: `${name(own)} is ${words(own.state)}, and ${build} has the same version number, which Apple takes only once, so that build goes no further and the next store build brings a new number` };
  }

  // Apple keeps one unreleased version at a time: the new build takes it over, with its own version number.
  const open = own ?? versions.find((v) => EDITABLE.includes(v.state) || v.state === IN_DRAFT) ?? null;
  const draft = submissions.find((s) => s.state === DRAFT) ?? null;
  const draftHolds = (v) => draft !== null && v !== null && draft.versionId === v.id;
  if (open && Object.hasOwn(REFUSED, open.state) && open.build === newest.number) {
    return { action: 'held', why: `${name(open)} was ${REFUSED[open.state]}, and that build is not sent again by itself: someone resubmits it in App Store Connect, or a newer build goes on a later run${also}` };
  }
  if (open && open.state === IN_DRAFT) {
    if (draftHolds(open) && open.build === newest.number) return { action: 'submit', why: `${name(open)} waits in a draft submission, so it goes to review`, version: open, draft };
    return { action: 'held', why: `${name(open)} is in a draft submission in App Store Connect. Someone submits or removes it there, and ${build} goes on a later run${also}` };
  }
  // A draft is used only when it is empty or holds this version alone; anything else in it is someone's own work.
  if (draft && !(draft.items === 0 || (draftHolds(open) && (draft.items === 1 || draft.items === null)))) {
    return { action: 'held', why: `a draft submission in App Store Connect holds other items. Someone submits or removes them there, and ${build} goes on a later run${also}` };
  }
  return { action: 'submit', why: `no review is open, so ${build} (${newest.version}) goes to review`, version: open, draft };
}

/** A token for the App Store Connect API, good for 15 minutes. */
export function token({ keyId, issuerId, privateKey }, now = Date.now()) {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = part({ alg: 'ES256', kid: keyId, typ: 'JWT' });
  // A team key names its issuer; an individual key has none and says "user" instead (Apple's "Generating Tokens for API Requests").
  const who = issuerId ? { iss: issuerId } : { sub: 'user' };
  const body = part({ ...who, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 900, aud: 'appstoreconnect-v1' });
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key: createPrivateKey(privateKey), dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${sig.toString('base64url')}`;
}

/**
 * The key from APP_STORE_REVIEW_KEY, or null while there is none: a team
 * key with its issuerId, or an individual key without one. A value that is
 * there but is not a key throws, so a bad key fails the job instead of
 * quietly waiting.
 */
export function reviewKey(env) {
  const raw = env.APP_STORE_REVIEW_KEY?.trim();
  if (!raw) return null;
  const shape = 'the JSON {"issuerId", "keyId", "privateKey"} (or {"keyId", "privateKey"} for an individual key) that docs/environments.md ("The App Store key") describes';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A copy whose "\n"s became line breaks inside the key's text is read with them escaped again.
    try { parsed = JSON.parse(raw.replace(/\r?\n/g, '\\n')); } catch { throw new Error(`APP_STORE_REVIEW_KEY is not ${shape}`); }
  }
  // The .p8 file's text keeps its line breaks; a copy that turned them into "\n" is put back.
  const privateKey = typeof parsed?.privateKey === 'string' ? parsed.privateKey.replaceAll('\\n', '\n') : '';
  if (typeof parsed?.keyId !== 'string' || !parsed.keyId || !privateKey) {
    throw new Error(`APP_STORE_REVIEW_KEY is not ${shape}: it lacks ${['keyId', 'privateKey'].filter((k) => !parsed?.[k]).join(', ') || 'a field'}`);
  }
  if (parsed.issuerId !== undefined && (typeof parsed.issuerId !== 'string' || !parsed.issuerId)) {
    throw new Error(`APP_STORE_REVIEW_KEY is not ${shape}: its issuerId is empty`);
  }
  try {
    createPrivateKey(privateKey);
  } catch {
    throw new Error('APP_STORE_REVIEW_KEY\'s privateKey is not the text of an App Store Connect .p8 key');
  }
  return parsed.issuerId ? { issuerId: parsed.issuerId, keyId: parsed.keyId, privateKey } : { keyId: parsed.keyId, privateKey };
}

/** An answer from App Store Connect that was not a success, with Apple's error codes and reasons. */
export class AppleError extends Error {
  constructor(method, path, status, text) {
    let errors = [];
    try {
      errors = JSON.parse(text).errors ?? [];
    } catch { /* not JSON: the text says it */ }
    const reasons = errors.flatMap((e) => [
      [e.code, e.detail ?? e.title].filter(Boolean).join(': '),
      ...(Object.values(e.meta?.associatedErrors ?? {}).flat().map((a) => `  ${[a.code, a.detail ?? a.title].filter(Boolean).join(': ')}`))
    ]);
    super(`App Store Connect answered ${status} to ${method} ${path}: ${reasons.length ? reasons.join('\n') : text}`);
    this.status = status;
    this.codes = errors.flatMap((e) => [e.code, ...Object.values(e.meta?.associatedErrors ?? {}).flat().map((a) => a.code)]).filter(Boolean);
  }
}

/**
 * Calls the API: method, path (or a full URL, such as a page's next link)
 * and the resource to send. A read is tried again when Apple is busy or
 * briefly down; a write is not, since it may have happened.
 */
export function client(key, { fetch: fetchImpl = fetch, wait = sleep, now = Date.now } = {}) {
  return async (method, path, body) => {
    const url = path.startsWith('https://') ? path : `${API}${path}`;
    for (let attempt = 1; ; attempt++) {
      const res = await fetchImpl(url, {
        method,
        headers: { authorization: `Bearer ${token(key, now())}`, 'content-type': 'application/json' },
        body: body ? JSON.stringify({ data: body }) : undefined,
        signal: AbortSignal.timeout(60_000)
      });
      if (res.ok) return res.status === 204 ? null : res.json();
      if (method === 'GET' && (res.status === 429 || res.status >= 500) && attempt < 3) {
        await wait(attempt * 10_000);
        continue;
      }
      throw new AppleError(method, path, res.status, await res.text());
    }
  };
}

/** Every page of a list, followed by its next links. */
async function all(api, path) {
  const out = { data: [], included: [] };
  let next = path;
  for (let page = 0; next && page < 20; page++) {
    const answer = await api('GET', next);
    out.data.push(...(answer?.data ?? []));
    out.included.push(...(answer?.included ?? []));
    next = answer?.links?.next ?? null;
  }
  return out;
}

const buildNumber = (b) => {
  const n = Number(b?.attributes?.version);
  return Number.isFinite(n) ? n : null;
};

/** What App Store Connect says about the app's iPhone versions, builds and review submissions now. */
export async function look(api, appId) {
  const submissions = await all(api, `/reviewSubmissions?filter[app]=${appId}&filter[platform]=IOS&filter[state]=${NOT_COMPLETE.join(',')}&include=items,appStoreVersionForReview&limit=200`);
  const versions = await all(api, `/apps/${appId}/appStoreVersions?filter[platform]=IOS&include=build&limit=200`);
  const builds = await api('GET', `/builds?filter[app]=${appId}&filter[preReleaseVersion.platform]=IOS&filter[expired]=false&sort=-uploadedDate&include=preReleaseVersion&limit=20`);
  const numbers = new Map(versions.included.filter((i) => i.type === 'builds').map((b) => [b.id, buildNumber(b)]));
  const marketing = new Map((builds.included ?? []).filter((i) => i.type === 'preReleaseVersions').map((p) => [p.id, p.attributes?.version ?? null]));
  // Builds made for the App Store: TestFlight's internal-only builds cannot go to review.
  const listed = (builds.data ?? [])
    .filter((b) => b.attributes?.buildAudienceType !== 'INTERNAL_ONLY' && buildNumber(b) !== null)
    .map((b) => ({ id: b.id, number: buildNumber(b), version: marketing.get(b.relationships?.preReleaseVersion?.data?.id) ?? null, state: b.attributes?.processingState }));
  const valid = listed.filter((b) => b.state === 'VALID' && b.version).sort((a, b) => b.number - a.number);
  const newest = valid[0] ? { id: valid[0].id, number: valid[0].number, version: valid[0].version } : null;
  return {
    submissions: submissions.data.map((s) => ({
      id: s.id,
      state: s.attributes?.state,
      versionId: s.relationships?.appStoreVersionForReview?.data?.id ?? null,
      items: Array.isArray(s.relationships?.items?.data) ? s.relationships.items.data.length : null
    })),
    versions: versions.data.map((v) => ({
      id: v.id,
      string: v.attributes?.versionString,
      state: stateOf(v),
      build: numbers.get(v.relationships?.build?.data?.id) ?? null
    })),
    newest,
    processing: listed.filter((b) => b.state === 'PROCESSING').map((b) => ({ number: b.number }))
  };
}

/** Tries a call again while Apple answers that the thing it changes is still settling (409, ENTITY_STATE_INVALID). */
async function settling(call, wait) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      const conflict = err instanceof AppleError && err.status === 409 && err.codes.some((c) => c.includes('ENTITY_STATE_INVALID'));
      if (!conflict || attempt >= ITEM_TRIES) throw err;
      await wait(ITEM_WAIT_MS);
    }
  }
}

/**
 * Puts the newest build on its version (the open one, or a new one released
 * on approval), fills in "What's New" where it is empty, puts the version in
 * the draft submission (or a new one), waits for Apple to call it ready, and
 * sends it. Returns the submission's state afterwards.
 */
export async function submit(api, appId, { newest, version, draft }, { wait = sleep } = {}) {
  let versionId = version?.id ?? null;
  if (!versionId) {
    const made = await api('POST', '/appStoreVersions', {
      type: 'appStoreVersions',
      attributes: { platform: 'IOS', versionString: newest.version, releaseType: 'AFTER_APPROVAL' },
      relationships: { app: { data: { type: 'apps', id: appId } }, build: { data: { type: 'builds', id: newest.id } } }
    });
    versionId = made.data.id;
  } else if (version.build !== newest.number || version.string !== newest.version) {
    await api('PATCH', `/appStoreVersions/${versionId}`, {
      type: 'appStoreVersions',
      id: versionId,
      attributes: { versionString: newest.version },
      relationships: { build: { data: { type: 'builds', id: newest.id } } }
    });
  }
  const locales = await all(api, `/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=200`);
  for (const l of locales.data) {
    if (!l.attributes?.whatsNew?.trim()) await api('PATCH', `/appStoreVersionLocalizations/${l.id}`, { type: 'appStoreVersionLocalizations', id: l.id, attributes: { whatsNew: WHATS_NEW } });
  }
  const submissionId = draft?.id ??
    (await api('POST', '/reviewSubmissions', { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: appId } } } })).data.id;
  if (draft?.versionId !== versionId) {
    await settling(() => api('POST', '/reviewSubmissionItems', {
      type: 'reviewSubmissionItems',
      relationships: {
        reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
        appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } }
      }
    }), wait);
  }
  // Apple calls the version ready for review a moment after it joins the submission. If it does not,
  // the submit below still goes, and Apple's answer says what is missing.
  for (let looks = 1; looks <= READY_LOOKS; looks++) {
    if (stateOf((await api('GET', `/appStoreVersions/${versionId}`))?.data) === IN_DRAFT) break;
    if (looks < READY_LOOKS) await wait(READY_WAIT_MS);
  }
  await api('PATCH', `/reviewSubmissions/${submissionId}`, { type: 'reviewSubmissions', id: submissionId, attributes: { submitted: true } });
  return (await api('GET', `/reviewSubmissions/${submissionId}`))?.data?.attributes?.state ?? null;
}

/** One run: look, say what is next, and send when it is time. Returns the step. */
export async function run({ env = process.env, args = [], appId, fetch: fetchImpl = fetch, wait = sleep, log = console.log } = {}) {
  const key = reviewKey(env);
  if (!key) {
    log(`wait: ${NO_KEY}.`);
    return { action: 'wait', why: NO_KEY };
  }
  const api = client(key, { fetch: fetchImpl, wait });
  const state = await look(api, appId);
  const step = nextStep(state);
  log(`${step.action}: ${step.why}.`);
  if (step.action !== 'submit' || args.includes('--dry-run')) return step;
  const sent = await submit(api, appId, { newest: state.newest, version: step.version, draft: step.draft }, { wait });
  log(`Build ${state.newest.number} (${state.newest.version}) is ${sent ? words(sent) : 'sent'}, and goes public when Apple approves it.`);
  return { ...step, sent };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const eas = JSON.parse(readFileSync(new URL('../apps/mobile/eas.json', import.meta.url), 'utf8'));
  run({ args: process.argv.slice(2), appId: eas.submit.production.ios.ascAppId })
    .then((step) => {
      if (step.action === 'stuck') process.exit(1);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
