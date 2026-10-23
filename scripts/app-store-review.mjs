// Send the newest iPhone build to Apple's review (decisions.md 156).
//
// The EAS workflow on main runs this after each new build reaches
// TestFlight, and an EAS schedule runs it every hour. Apple reviews
// one version at a time, and a version taken out of review loses its place
// in line, so this never cancels a review: while one is waiting or under way,
// the new build waits in TestFlight. When no review is open, it sends only
// the newest processed build that is newer than the public one, on an App
// Store version of its own (the version number that app.config.js gave the
// build), released as soon as Apple approves it.
//
//   node scripts/app-store-review.mjs             look, and send when it is time
//   node scripts/app-store-review.mjs --dry-run   look, and say what it would do
//
// It needs an App Store Connect API key with the App Manager role:
// ASC_KEY_ID, ASC_ISSUER_ID and ASC_PRIVATE_KEY (the .p8 file's text), EAS
// secrets on the production environment. The app is eas.json's ascAppId.
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'https://api.appstoreconnect.apple.com/v1';

/** Review submission states in which a review is still waiting or under way. */
export const OPEN = ['WAITING_FOR_REVIEW', 'IN_REVIEW', 'CANCELING', 'COMPLETING'];
/**
 * App Store version states in which a version is in review, approved and not
 * yet out, or being released: while any version is in one, a new version
 * would sit beside it, so the new build waits in TestFlight.
 */
export const BUSY_VERSIONS = ['WAITING_FOR_REVIEW', 'IN_REVIEW', 'PENDING_DEVELOPER_RELEASE', 'PENDING_APPLE_RELEASE', 'PROCESSING_FOR_APP_STORE'];
/** App Store version states whose build can still be changed. */
export const EDITABLE = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY'];
/** Words for "What's New", which Apple asks for on every version after the first. */
export const WHATS_NEW = 'Bug fixes and improvements.';

/**
 * What to do now. `open` is the states of the app's review submissions,
 * `live` the build number of the version people have (null before the
 * first), `newest` the newest processed build ({ number, version }), and
 * `version` the App Store version with the newest build's version number,
 * if there is one ({ state, build }), and `versions` every App Store version
 * of the app ({ string, state }).
 */
export function nextStep({ open, live, newest, version, versions = [] }) {
  const busyVersion = versions.find((v) => BUSY_VERSIONS.includes(v.state));
  const busy = open.find((s) => OPEN.includes(s)) ?? (busyVersion ? `version ${busyVersion.string} is ${busyVersion.state.toLowerCase().replaceAll('_', ' ')}` : undefined);
  if (!newest) return { action: 'none', why: 'no processed build in TestFlight' };
  if (live !== null && newest.number <= live) return { action: 'none', why: `build ${newest.number} is not newer than the public build ${live}` };
  if (version && !EDITABLE.includes(version.state) && version.build === newest.number)
    return { action: 'none', why: `version ${newest.version} with build ${newest.number} is ${version.state.toLowerCase().replaceAll('_', ' ')}` };
  if (busy) {
    const what = busy.startsWith('version ') ? busy : `a review is ${busy.toLowerCase().replaceAll('_', ' ')}`;
    return { action: 'wait', why: `${what}, so build ${newest.number} waits in TestFlight and is tried again on the next run` };
  }
  if (version && !EDITABLE.includes(version.state)) {
    return { action: 'stuck', why: `version ${newest.version} is ${version.state.toLowerCase().replaceAll('_', ' ')} with build ${version.build}, and build ${newest.number} has the same version number` };
  }
  return { action: 'submit', why: `no review is open, so build ${newest.number} (${newest.version}) goes to review` };
}

/** A token for the App Store Connect API, good for 15 minutes. */
export function token({ keyId, issuerId, privateKey }, now = Date.now()) {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = part({ alg: 'ES256', kid: keyId, typ: 'JWT' });
  const body = part({ iss: issuerId, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 900, aud: 'appstoreconnect-v1' });
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key: createPrivateKey(privateKey), dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${sig.toString('base64url')}`;
}

function client(env) {
  const auth = `Bearer ${token({ keyId: env.ASC_KEY_ID, issuerId: env.ASC_ISSUER_ID, privateKey: env.ASC_PRIVATE_KEY })}`;
  return async (method, path, body) => {
    const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
      method,
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: body ? JSON.stringify({ data: body }) : undefined,
    });
    if (!res.ok) throw new Error(`App Store Connect answered ${res.status} to ${method} ${path}: ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };
}

/** What App Store Connect says about the app now. */
async function look(api, appId) {
  const submissions = await api('GET', `/reviewSubmissions?filter[app]=${appId}&filter[platform]=IOS&limit=20`);
  const versions = await api('GET', `/apps/${appId}/appStoreVersions?filter[platform]=IOS&include=build&limit=20`);
  const builds = await api('GET', `/builds?filter[app]=${appId}&filter[processingState]=VALID&filter[expired]=false&sort=-uploadedDate&include=preReleaseVersion&limit=1`);
  const buildNumber = new Map((versions.included ?? []).filter((i) => i.type === 'builds').map((b) => [b.id, Number(b.attributes.version)]));
  const versionOf = (v) => ({ id: v.id, string: v.attributes.versionString, state: v.attributes.appStoreState ?? v.attributes.appVersionState, build: buildNumber.get(v.relationships?.build?.data?.id) ?? null });
  const all = versions.data.map(versionOf);
  const liveVersion = all.find((v) => v.state === 'READY_FOR_SALE');
  const b = builds.data[0];
  const pre = (builds.included ?? []).find((i) => i.type === 'preReleaseVersions');
  const newest = b ? { id: b.id, number: Number(b.attributes.version), version: pre?.attributes.version } : null;
  return {
    open: submissions.data.map((s) => s.attributes.state),
    live: liveVersion?.build ?? null,
    newest,
    // Its own version, or else a version not yet released that can still change (a rejected 1.0):
    // Apple keeps one unreleased version at a time, so the new build takes that one over.
    version: newest ? all.find((v) => v.string === newest.version) ?? all.find((v) => EDITABLE.includes(v.state)) ?? null : null,
    versions: all,
  };
}

/** Put the build on its version, fill in What's New, and send the version to review. */
async function submit(api, appId, newest, version) {
  let versionId = version?.id;
  if (!versionId) {
    const made = await api('POST', '/appStoreVersions', {
      type: 'appStoreVersions',
      attributes: { platform: 'IOS', versionString: newest.version, releaseType: 'AFTER_APPROVAL' },
      relationships: { app: { data: { type: 'apps', id: appId } }, build: { data: { type: 'builds', id: newest.id } } },
    });
    versionId = made.data.id;
  } else {
    await api('PATCH', `/appStoreVersions/${versionId}`, {
      type: 'appStoreVersions',
      id: versionId,
      attributes: { versionString: newest.version, releaseType: 'AFTER_APPROVAL' },
      relationships: { build: { data: { type: 'builds', id: newest.id } } },
    });
  }
  const locales = await api('GET', `/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=50`);
  for (const l of locales.data)
    if (!l.attributes.whatsNew) await api('PATCH', `/appStoreVersionLocalizations/${l.id}`, { type: 'appStoreVersionLocalizations', id: l.id, attributes: { whatsNew: WHATS_NEW } });
  const ready = await api('GET', `/reviewSubmissions?filter[app]=${appId}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW&limit=1`);
  const submissionId =
    ready.data[0]?.id ??
    (await api('POST', '/reviewSubmissions', { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: appId } } } })).data.id;
  await api('POST', '/reviewSubmissionItems', {
    type: 'reviewSubmissionItems',
    relationships: {
      reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
      appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
    },
  });
  await api('PATCH', `/reviewSubmissions/${submissionId}`, { type: 'reviewSubmissions', id: submissionId, attributes: { submitted: true } });
}

/**
 * Why the step cannot run yet, or null. Until the App Manager key is in EAS's
 * production environment, iPhone builds stop at TestFlight for a person to
 * send to review, as before, and the step says so and succeeds, so the
 * pipeline stays green; once the key is there, nothing else changes.
 */
export function keyMissing(env) {
  const missing = ['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_PRIVATE_KEY'].filter((k) => !env[k]);
  return missing.length ? `no App Store Connect key yet (${missing.join(', ')} not set in EAS's production environment), so the newest build waits in TestFlight` : null;
}

async function main(env = process.env) {
  const dryRun = process.argv.includes('--dry-run');
  const notYet = keyMissing(env);
  if (notYet) return console.log(`wait: ${notYet}.`);
  const eas = JSON.parse(readFileSync(new URL('../apps/mobile/eas.json', import.meta.url), 'utf8'));
  const appId = eas.submit.production.ios.ascAppId;
  const api = client(env);
  const state = await look(api, appId);
  const step = nextStep(state);
  console.log(`${step.action}: ${step.why}.`);
  if (step.action === 'stuck') process.exit(1);
  if (step.action !== 'submit' || dryRun) return;
  await submit(api, appId, state.newest, state.version);
  console.log(`Build ${state.newest.number} (${state.newest.version}) is waiting for review, and goes public when Apple approves it.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
