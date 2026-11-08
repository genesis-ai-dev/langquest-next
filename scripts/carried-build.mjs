// The carried build (docs/nearby-sync-plan.md 14.4): an APK a teammate
// carries to a phone that has no internet or no Play Store, holding the
// team's latest JavaScript. A merge into main that changes REDUCER_VERSION,
// LINES_VERSION, the nearby protocol range or the Android fingerprint makes
// one; other merges do not need one. The file's name holds those versions
// alone (core `carriedApkName`, which the Worker's /apk/* route and Let
// someone in use too), so asking for that name answers whether one is due:
// EAS clones only the latest commit, so this cannot diff.
//
//   npx tsx scripts/carried-build.mjs --check --fingerprint <android fingerprint>
//       prints true when no file of that name is in the APK bucket (a build
//       is due), false when it is there; a failed publish is retried by the
//       next merge this way
//   npx tsx scripts/carried-build.mjs --publish --version-code <n> --fingerprint <hash> --build-fingerprint <hash> [--dry-run]
//       asks Google Play for the Play-signed universal APK of that version
//       code (Android Publisher `generatedApks`), checks it, puts it in the
//       APK bucket under its name, and records it as current
//
// It runs under tsx, since it takes the versions and the name from core's
// TypeScript. The EAS workflow runs it (.eas/workflows/deploy-to-testers.yml,
// the carried_* jobs), apart from the store build's jobs, so its failure never
// holds up publish_android_update.
//
// It fails closed. A missing bucket setting or key, a fingerprint that is not
// the build's, or an answer from Google or the bucket that is not what it
// expects exits non-zero with a plain message, before anything is written.
// It never prints a key.
//
// What it reads, from EAS's production environment (docs/environments.md,
// "The carried build"): PLAY_REVIEW_KEY, the Play service account key that
// play-review.mjs uses, for GET requests only; APK_R2_ACCESS_KEY_ID and
// APK_R2_SECRET_ACCESS_KEY, the S3 credentials of an R2 token limited to the
// APK bucket. The bucket's name and the account come from
// apps/web/wrangler.jsonc (the APKS binding), so the Worker and this script
// read one bucket.
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINES_VERSION, NEARBY_PROTOCOL, REDUCER_VERSION, carriedApkName } from '@langquest-next/core';
import { parseJsonc, root, wranglerFor } from './env-files.mjs';
import { API, PACKAGE, TOKEN_URL, assertion, playKey } from './play-review.mjs';

/** The Worker binding that serves carried builds (apps/web/wrangler.jsonc). */
export const BINDING = 'APKS';
/** Where this script records which carried build is current. Not an APK's name, so the route never serves it. */
export const CURRENT = 'current.json';
export const APK_TYPE = 'application/vnd.android.package-archive';
/** An APK smaller than this is not the app; larger than that is not one either. */
export const MIN_BYTES = 1 << 20;
export const MAX_BYTES = 1 << 30;
/** How long Play may take to make the APKs of a bundle just uploaded: tries, a minute apart. */
export const TRIES = 15;
const CONFIG = 'apps/web/wrangler.jsonc';

/** A refusal: the plain message the job prints before it exits non-zero, having changed nothing. */
export class Refusal extends Error {}

/** The versions this checkout's core holds. */
export const VERSIONS = { reducer: REDUCER_VERSION, lines: LINES_VERSION, protocol: NEARBY_PROTOCOL };

/** The file name for this checkout's versions and an Android fingerprint; a refusal for a fingerprint that is not one. */
export function fileName(fingerprint, versions = VERSIONS) {
  const name = typeof fingerprint === 'string' ? carriedApkName({ ...versions, fingerprint }) : null;
  if (!name) throw new Refusal(`"${fingerprint ?? ''}" is not an Android fingerprint (the fingerprint job's android_fingerprint_hash), so no carried build's name can be made`);
  return name;
}

/**
 * The APK bucket: its name and account from the Worker's config, its
 * credentials from the environment. A refusal while any is missing.
 */
export function bucketConfig(env, config = parseJsonc(readFileSync(join(root, CONFIG), 'utf8'))) {
  const bucket = (wranglerFor(config, 'production').r2_buckets ?? []).find((b) => b.binding === BINDING)?.bucket_name;
  const account = config.account_id;
  const accessKeyId = env.APK_R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.APK_R2_SECRET_ACCESS_KEY?.trim();
  const missing = [
    !bucket && `the ${BINDING} binding in ${CONFIG}`, !account && `account_id in ${CONFIG}`,
    !accessKeyId && 'APK_R2_ACCESS_KEY_ID', !secretAccessKey && 'APK_R2_SECRET_ACCESS_KEY'
  ].filter(Boolean);
  if (missing.length) {
    throw new Refusal(`the APK bucket is not configured (no ${missing.join(', ')}). A person creates the bucket and its token and applies them (docs/environments.md, "The carried build"); until then no carried build is checked or published`);
  }
  return { endpoint: `https://${account}.r2.cloudflarestorage.com`, bucket, accessKeyId, secretAccessKey };
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, text) => createHmac('sha256', key).update(text).digest();
/** RFC 3986 encoding, as Signature Version 4 asks (encodeURIComponent leaves !'()* alone). */
const encode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * The headers that sign a request to R2's S3 API with Signature Version 4
 * (region `auto`, as R2 asks). `headers` are the request's own; `host`,
 * `x-amz-date` and `x-amz-content-sha256` are added and signed.
 */
export function signV4({ method, url, headers = {}, payloadHash, accessKeyId, secretAccessKey, region = 'auto', service = 's3', now = new Date() }) {
  const u = new URL(url);
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const all = Object.fromEntries([
    ...Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()]),
    ['host', u.host], ['x-amz-content-sha256', payloadHash], ['x-amz-date', amzDate]
  ]);
  const names = Object.keys(all).sort();
  const path = u.pathname.split('/').map((seg) => encode(decodeURIComponent(seg))).join('/');
  const query = [...u.searchParams].map(([k, v]) => [encode(k), encode(v)]).sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`).join('&');
  const request = [method, path, query, names.map((n) => `${n}:${all[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(request)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  const { host: _host, ...sent } = all;
  return { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}

/** R2's own words for a refusal (`<Code>AccessDenied</Code>`), never the request's headers. */
async function s3Code(res) {
  return /<Code>([^<]{1,64})<\/Code>/.exec(await res.text().catch(() => ''))?.[1] ?? '';
}

/** The APK bucket through R2's S3 API: head, get and put, each refusing any answer it does not expect. */
export function bucketClient(config, { fetch: fetchImpl = fetch, now = () => new Date() } = {}) {
  const call = (method, key, { body, headers = {} } = {}) => {
    const url = `${config.endpoint}/${encode(config.bucket)}/${key.split('/').map(encode).join('/')}`;
    const payloadHash = body ? sha256(body) : sha256('');
    const signed = signV4({ method, url, headers, payloadHash, accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, now: now() });
    return fetchImpl(url, { method, headers: signed, body, signal: AbortSignal.timeout(method === 'PUT' ? 600_000 : 30_000) });
  };
  const refuse = async (what, res) => new Refusal(`the APK bucket answered ${res.status}${(await s3Code(res)).replace(/^./, ' $&')} to ${what}, so nothing more was done`);
  return {
    /** The object's size, or null when the bucket has no such name. */
    async head(key) {
      const res = await call('HEAD', key);
      if (res.status === 404) return null;
      if (res.status !== 200) throw await refuse(`HEAD ${key}`, res);
      const size = Number(res.headers.get('content-length'));
      if (!Number.isSafeInteger(size)) throw new Refusal(`the APK bucket gave no size for ${key}`);
      return { size };
    },
    /** The object's text, or null when the bucket has no such name. */
    async getText(key) {
      const res = await call('GET', key);
      if (res.status === 404) return null;
      if (res.status !== 200) throw await refuse(`GET ${key}`, res);
      return res.text();
    },
    async put(key, body, contentType, extra = {}) {
      const res = await call('PUT', key, { body, headers: { 'content-type': contentType, ...extra } });
      if (res.status !== 200) throw await refuse(`PUT ${key}`, res);
    }
  };
}

/** Google Play's API for this app, read-only: JSON answers and file downloads, each a refusal on any other status. */
export async function playReader(key, { fetch: fetchImpl = fetch, now = Date.now } = {}) {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: assertion(key, now()) }).toString(),
    signal: AbortSignal.timeout(30_000)
  });
  if (!res.ok) throw new Refusal(`Google refused the Play key (${res.status})`);
  const token = (await res.json().catch(() => null))?.access_token;
  if (typeof token !== 'string' || !token) throw new Refusal('Google answered the Play key with no access token');
  const get = (path) => fetchImpl(`${API}/${PACKAGE}${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(600_000) });
  return {
    /** The JSON at a path, `{ status }` alone for a 404 (not there yet), a refusal for anything else. */
    async json(path) {
      const answer = await get(path);
      if (answer.status === 404) return { status: 404 };
      if (!answer.ok) throw new Refusal(`Google Play answered ${answer.status} to GET ${path}`);
      const body = await answer.json().catch(() => undefined);
      if (!body || typeof body !== 'object') throw new Refusal(`Google Play's answer to GET ${path} is not JSON`);
      return { status: answer.status, body };
    },
    async bytes(path) {
      const answer = await get(path);
      if (!answer.ok) throw new Refusal(`Google Play answered ${answer.status} to GET ${path}`);
      return new Uint8Array(await answer.arrayBuffer());
    }
  };
}

/**
 * The download id of the one Play-signed universal APK in a `generatedApks`
 * answer; null while Play has not made it yet (no entry), a refusal for any
 * answer that is not one entry with one universal APK. More than one entry
 * means more than one signing key, and which to carry is a person's choice.
 */
export function universalApk(body) {
  const list = body?.generatedApks;
  if (list === undefined || (Array.isArray(list) && list.length === 0)) return null;
  if (!Array.isArray(list)) throw new Refusal('Google Play\'s generatedApks answer has no list of APKs');
  if (list.length !== 1) throw new Refusal(`Google Play's generatedApks answer has ${list.length} signing keys, not one, so which APK to carry is a person's choice`);
  const universal = list[0]?.generatedUniversalApk;
  if (universal === undefined) return null;
  const id = universal?.downloadId;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_.~-]{1,512}$/.test(id)) throw new Refusal('Google Play\'s universal APK has no download id this script can read');
  return id;
}

/** Whether these bytes look like an APK: a zip of a believable size. */
export function checkApk(bytes) {
  if (bytes.length < MIN_BYTES || bytes.length > MAX_BYTES) throw new Refusal(`the APK Google Play gave is ${bytes.length} bytes, outside ${MIN_BYTES} to ${MAX_BYTES}`);
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) throw new Refusal('the file Google Play gave is not a zip, so not an APK');
}

/** Whether a carried build is due: true when the bucket has no file of this build's name. */
export async function check({ fingerprint, env = process.env, fetch: fetchImpl = fetch, log = console.error, config, versions = VERSIONS }) {
  const name = fileName(fingerprint, versions);
  const bucket = bucketClient(bucketConfig(env, config), { fetch: fetchImpl });
  const there = await bucket.head(name);
  log(there ? `none: ${name} is in the APK bucket, so no carried build is due.` : `due: ${name} is not in the APK bucket, so a carried build is due.`);
  return { due: !there, name };
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Puts the carried build of a version code in the APK bucket. Everything
 * that could refuse is asked first: the arguments, the bucket's settings,
 * the key, Google's answer, the file and what is recorded as current. Only
 * then is anything written: the APK under its name, then `current.json`.
 */
export async function publish({
  versionCode, fingerprint, buildFingerprint, env = process.env, fetch: fetchImpl = fetch, log = console.log, dryRun = false,
  config, versions = VERSIONS, tries = TRIES, sleep = wait, now = () => new Date()
}) {
  const code = Number(versionCode);
  if (!/^\d{1,10}$/.test(String(versionCode ?? '')) || !Number.isSafeInteger(code) || code < 1) {
    throw new Refusal(`"${versionCode ?? ''}" is not a version code (the build job's app_build_version)`);
  }
  const name = fileName(fingerprint, versions);
  if (typeof buildFingerprint !== 'string' || buildFingerprint.toLowerCase() !== String(fingerprint).toLowerCase()) {
    throw new Refusal(`the carried build's fingerprint "${buildFingerprint ?? ''}" is not the one the check named (${fingerprint}), so the file's name would not match what phones on it ask for`);
  }
  const bucket = bucketClient(bucketConfig(env, config), { fetch: fetchImpl });
  const key = playKey(env);
  if (!key) throw new Refusal('no Google Play key (PLAY_REVIEW_KEY is not in EAS\'s production environment), so the carried build\'s APK cannot be fetched');
  const play = await playReader(key, { fetch: fetchImpl });

  let downloadId = null;
  for (let i = 1; downloadId === null; i++) {
    const answer = await play.json(`/generatedApks/${code}`);
    downloadId = answer.status === 404 ? null : universalApk(answer.body);
    if (downloadId !== null) break;
    if (i >= tries) throw new Refusal(`Google Play has no universal APK for version code ${code} after ${tries} tries; the next merge that needs one tries again`);
    log(`Google Play has not made the APKs of version code ${code} yet; trying again in a minute (${i} of ${tries}).`);
    await sleep(60_000);
  }
  const bytes = await play.bytes(`/generatedApks/${code}/downloads/${encodeURIComponent(downloadId)}:download?alt=media`);
  checkApk(bytes);
  const hash = sha256(bytes);

  const currentText = await bucket.getText(CURRENT);
  let current = null;
  if (currentText !== null) {
    try {
      current = JSON.parse(currentText);
    } catch {
      current = undefined;
    }
    if (!current || !Number.isSafeInteger(current.versionCode)) throw new Refusal(`${CURRENT} in the APK bucket is not what this script writes, so a person looks at it first`);
  }
  const already = await bucket.head(name);
  const record = { name, versionCode: code, fingerprint: String(fingerprint).toLowerCase(), ...versions, sha256: hash, bytes: bytes.length, publishedAt: now().toISOString() };
  const moves = !current || current.versionCode < code;
  if (dryRun) {
    log(`dry run: would put ${name} (${bytes.length} bytes, sha256 ${hash}) in the APK bucket${already ? ', which has it already' : ''}${moves ? `, and record version code ${code} as current` : ''}.`);
    return { name, record, wrote: false };
  }
  if (already) log(`${name} is in the APK bucket already; it is left as it is.`);
  else {
    await bucket.put(name, bytes, APK_TYPE, { 'content-disposition': `attachment; filename="${name}"` });
    const stored = await bucket.head(name);
    if (stored?.size !== bytes.length) throw new Refusal(`the APK bucket holds ${stored?.size ?? 'nothing'} bytes under ${name}, not ${bytes.length}`);
    log(`${name} is in the APK bucket: version code ${code}, ${bytes.length} bytes, sha256 ${hash}.`);
  }
  if (moves) {
    await bucket.put(CURRENT, JSON.stringify(record, null, 2), 'application/json');
    log(`Version code ${code} is the current carried build.`);
  } else {
    log(`Version code ${current.versionCode} stays the current carried build, as it is newer than ${code}.`);
  }
  return { name, record, wrote: true };
}

/** The value after a flag, or undefined. */
function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** One run from the command line: 0, or 1 with a plain message. `--check` prints true or false alone on stdout. */
export async function run(args, { env = process.env, fetch: fetchImpl = fetch, out = (s) => process.stdout.write(`${s}\n`), log = console.error, config } = {}) {
  try {
    if (args.includes('--check')) {
      const { due } = await check({ fingerprint: flag(args, '--fingerprint'), env, fetch: fetchImpl, log, config });
      out(String(due));
      return 0;
    }
    if (args.includes('--publish')) {
      await publish({
        versionCode: flag(args, '--version-code'), fingerprint: flag(args, '--fingerprint'), buildFingerprint: flag(args, '--build-fingerprint'),
        env, fetch: fetchImpl, log, dryRun: args.includes('--dry-run'), config
      });
      return 0;
    }
    log('usage: npx tsx scripts/carried-build.mjs --check --fingerprint <hash> | --publish --version-code <n> --fingerprint <hash> --build-fingerprint <hash> [--dry-run]');
    return 2;
  } catch (err) {
    // A refusal is a plain sentence; anything else (a network failure) is said as briefly, never with a request's headers.
    log(`no carried build: ${err instanceof Refusal ? err.message : `${err?.name ?? 'Error'}: ${err?.message ?? err}`}.`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
