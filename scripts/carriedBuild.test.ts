import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { carriedApkNameHere } from '@langquest-next/core';
import {
  APK_TYPE, BINDING, CURRENT, MIN_BYTES, Refusal, bucketConfig, check, checkApk, fileName, publish, run, signV4, universalApk
} from './carried-build.mjs';
import { look } from './play-review.mjs';
import { EAS_KEYS, FILE_KEYS } from './secrets.mjs';
import { parseJsonc } from './env-files.mjs';

/**
 * The carried build's pipeline (scripts/carried-build.mjs, docs/nearby-sync-plan.md 14.4) against a
 * fake Google Play and a fake R2 bucket: it first runs in EAS after the merge, so every answer it
 * does not expect must stop it before it writes anything, with a plain message and no key printed.
 */

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const { privateKey: pem } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyText = pem.export({ type: 'pkcs8', format: 'pem' }) as string;
const playKeyFile = JSON.stringify({ type: 'service_account', client_email: 'review@p.iam.gserviceaccount.com', private_key: keyText });
const env = { PLAY_REVIEW_KEY: playKeyFile, APK_R2_ACCESS_KEY_ID: 'AKID', APK_R2_SECRET_ACCESS_KEY: 'r2-secret-value' };
const config = { account_id: 'acct', r2_buckets: [{ binding: 'BLOBS', bucket_name: 'blobs' }, { binding: BINDING, bucket_name: 'apks' }] };
const FP = '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567';
const NAME = fileName(FP);

function apk(size = MIN_BYTES + 10): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x50, 0x4b, 0x03, 0x04]);
  return bytes;
}

interface Call { method: string; url: string; headers: Record<string, string> }

/** Google's token endpoint, generatedApks and its download, and R2's S3 API for one bucket, in one fetch. */
function fakes(o: { generated?: (n: number) => { status: number; body?: unknown }; file?: Uint8Array; bucket?: Map<string, { body: Uint8Array | string; type: string; disposition?: string }>; bucketStatus?: number } = {}) {
  const calls: Call[] = [];
  const bucket = o.bucket ?? new Map();
  let generatedAsked = 0;
  const fetch = async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ method, url, headers });
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'tok' });
    const play = /^https:\/\/androidpublisher\.googleapis\.com\/androidpublisher\/v3\/applications\/com\.frontierrnd\.langquestnext(\/.*)$/.exec(url);
    if (play) {
      if (headers.authorization !== 'Bearer tok') return new Response('no', { status: 401 });
      if (/^\/generatedApks\/\d+$/.test(play[1]!)) {
        generatedAsked += 1;
        const a = o.generated?.(generatedAsked) ?? { status: 200, body: { generatedApks: [{ certificateSha256Hash: 'c', generatedUniversalApk: { downloadId: 'dl-1' } }] } };
        return typeof a.body === 'string' ? new Response(a.body, { status: a.status }) : Response.json(a.body ?? {}, { status: a.status });
      }
      if (play[1] === '/generatedApks/42/downloads/dl-1:download?alt=media') return new Response(o.file ?? apk());
      return new Response('?', { status: 404 });
    }
    const r2 = /^https:\/\/acct\.r2\.cloudflarestorage\.com\/apks\/(.+)$/.exec(url);
    if (r2) {
      if (!headers.authorization?.startsWith('AWS4-HMAC-SHA256 Credential=AKID/')) return new Response('<Code>AccessDenied</Code>', { status: 403 });
      if (o.bucketStatus) return new Response('<Error><Code>InternalError</Code></Error>', { status: o.bucketStatus });
      const key = decodeURIComponent(r2[1]!);
      const obj = bucket.get(key);
      if (method === 'PUT') {
        const body = init.body as Uint8Array | string;
        bucket.set(key, { body, type: headers['content-type']!, disposition: headers['content-disposition'] });
        return new Response(null, { status: 200 });
      }
      if (!obj) return new Response('<Code>NoSuchKey</Code>', { status: 404 });
      const size = typeof obj.body === 'string' ? Buffer.byteLength(obj.body) : obj.body.length;
      if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-length': String(size) } });
      return new Response(obj.body, { status: 200 });
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { fetch, calls, bucket, writes: () => calls.filter((c) => c.method !== 'GET' && c.method !== 'HEAD' && !c.url.includes('oauth2')), asked: () => generatedAsked };
}

const quiet = () => {};
const base = { versionCode: '42', fingerprint: FP, buildFingerprint: FP, env, config, log: quiet, sleep: async () => {} };

describe('the carried build\'s name and the bucket it lives in', () => {
  it('is core\'s name for this checkout\'s versions, the one Let someone in shows and the route serves', () => {
    expect(NAME).toBe(carriedApkNameHere(FP));
    expect(NAME).toMatch(/^r\d+-l\d+-p\d+(\.\d+)?-0a1b2c3d\.apk$/);
    expect(() => fileName('')).toThrow(Refusal);
    expect(() => fileName(undefined)).toThrow(/is not an Android fingerprint/);
  });

  it('reads the bucket from the Worker\'s APKS binding and the credentials from the environment, and refuses while any is missing', () => {
    expect(bucketConfig(env, config)).toEqual({ endpoint: 'https://acct.r2.cloudflarestorage.com', bucket: 'apks', accessKeyId: 'AKID', secretAccessKey: 'r2-secret-value' });
    expect(() => bucketConfig({ ...env, APK_R2_SECRET_ACCESS_KEY: ' ' }, config)).toThrow(/the APK bucket is not configured \(no APK_R2_SECRET_ACCESS_KEY\)/);
    expect(() => bucketConfig(env, { account_id: 'acct', r2_buckets: [] })).toThrow(/no the APKS binding/);
    const wrangler = parseJsonc(read('apps/web/wrangler.jsonc'));
    expect(bucketConfig(env, wrangler).bucket).toBe('langquest-next-apks');
  });

  it('signs with Signature Version 4 as AWS documents it (GET Object example)', () => {
    const headers = signV4({
      method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', headers: { Range: 'bytes=0-9' },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1', now: new Date('2013-05-24T00:00:00Z')
    });
    expect(headers.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, '
      + 'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
    expect(headers).not.toHaveProperty('host');
  });
});

describe('--check', () => {
  it('is due when the bucket has no file of this build\'s name, and not when it has', async () => {
    const f = fakes();
    expect(await check({ fingerprint: FP, env, config, fetch: f.fetch, log: quiet })).toEqual({ due: true, name: NAME });
    f.bucket.set(NAME, { body: apk(), type: APK_TYPE });
    expect(await check({ fingerprint: FP, env, config, fetch: f.fetch, log: quiet })).toEqual({ due: false, name: NAME });
    expect(f.writes()).toEqual([]);
    expect(f.calls.every((c) => c.method === 'HEAD')).toBe(true);
  });

  it('fails closed on any other answer, and asks nothing while the bucket is not configured', async () => {
    const denied = fakes();
    await expect(check({ fingerprint: FP, env: { ...env, APK_R2_ACCESS_KEY_ID: 'other' }, config, fetch: denied.fetch, log: quiet })).rejects.toThrow(/answered 403 AccessDenied to HEAD/);
    const broken = fakes({ bucketStatus: 500 });
    await expect(check({ fingerprint: FP, env, config, fetch: broken.fetch, log: quiet })).rejects.toThrow(/answered 500 InternalError/);
    const none = fakes();
    await expect(check({ fingerprint: FP, env: {}, config, fetch: none.fetch, log: quiet })).rejects.toThrow(/not configured/);
    expect(none.calls).toEqual([]);
  });

  it('prints true or false alone on stdout, and exits 1 with a plain message when it cannot tell', async () => {
    const f = fakes();
    const out: string[] = [];
    const log: string[] = [];
    expect(await run(['--check', '--fingerprint', FP], { env, config, fetch: f.fetch, out: (s) => out.push(s), log: (s) => log.push(s) })).toBe(0);
    expect(out).toEqual(['true']);
    const stopped: string[] = [];
    expect(await run(['--check', '--fingerprint', FP], { env: {}, config, fetch: f.fetch, out: (s) => out.push(s), log: (s) => stopped.push(s) })).toBe(1);
    expect(out).toEqual(['true']);
    expect(stopped.join('\n')).toMatch(/^no carried build: the APK bucket is not configured/);
    expect(await run([], { env, fetch: f.fetch, out: quiet, log: quiet })).toBe(2);
  });
});

describe('--publish', () => {
  it('fetches the Play-signed universal APK read-only, puts it under its name with a neutral download name, and records it as current', async () => {
    const f = fakes();
    const lines: string[] = [];
    const { name, wrote } = await publish({ ...base, fetch: f.fetch, log: (s: string) => lines.push(s), now: () => new Date('2026-11-08T12:00:00Z') });
    expect([name, wrote]).toEqual([NAME, true]);
    const stored = f.bucket.get(NAME)!;
    expect(stored.type).toBe('application/vnd.android.package-archive');
    expect(stored.disposition).toBe(`attachment; filename="${NAME}"`);
    expect((stored.body as Uint8Array).length).toBe(MIN_BYTES + 10);
    const current = JSON.parse(f.bucket.get(CURRENT)!.body as string);
    expect(current).toMatchObject({ name: NAME, versionCode: 42, fingerprint: FP, bytes: MIN_BYTES + 10, publishedAt: '2026-11-08T12:00:00.000Z' });
    // Google is only read; the one POST is the token.
    const google = f.calls.filter((c) => c.url.includes('googleapis.com'));
    expect(google.filter((c) => c.method !== 'GET').map((c) => c.url)).toEqual(['https://oauth2.googleapis.com/token']);
    expect(f.writes().map((c) => `${c.method} ${c.url.replace(/^.*\/apks\//, '')}`)).toEqual([`PUT ${NAME}`, `PUT ${CURRENT}`]);
    // No key or secret in what it says.
    const said = lines.join('\n');
    for (const secret of ['r2-secret-value', 'PRIVATE KEY', 'tok']) expect(said).not.toContain(secret);
  });

  it('waits for Play to make the APKs of a bundle just uploaded, then gives up having written nothing', async () => {
    const later = fakes({ generated: (n) => (n < 3 ? { status: 404, body: {} } : n < 4 ? { status: 200, body: { generatedApks: [] } } : { status: 200, body: { generatedApks: [{ generatedUniversalApk: { downloadId: 'dl-1' } }] } }) });
    let slept = 0;
    await publish({ ...base, fetch: later.fetch, sleep: async () => { slept += 1; } });
    expect([later.asked(), slept]).toEqual([4, 3]);
    const never = fakes({ generated: () => ({ status: 404, body: {} }) });
    await expect(publish({ ...base, fetch: never.fetch, tries: 3 })).rejects.toThrow(/no universal APK for version code 42 after 3 tries/);
    expect(never.writes()).toEqual([]);
  });

  it('fails closed on any generatedApks answer it does not expect, writing nothing', async () => {
    const answers: { status: number; body?: unknown }[] = [
      { status: 500, body: {} },
      { status: 403, body: {} },
      { status: 200, body: 'not json' },
      { status: 200, body: { generatedApks: 'x' } },
      { status: 200, body: { generatedApks: [{ generatedUniversalApk: { downloadId: 'dl-1' } }, { generatedUniversalApk: { downloadId: 'dl-2' } }] } },
      { status: 200, body: { generatedApks: [{ generatedUniversalApk: { downloadId: 7 } }] } },
      { status: 200, body: { generatedApks: [{ generatedUniversalApk: { downloadId: '../../x y' } }] } }
    ];
    for (const a of answers) {
      const f = fakes({ generated: () => a });
      await expect(publish({ ...base, fetch: f.fetch }), JSON.stringify(a)).rejects.toThrow(Refusal);
      expect(f.writes(), JSON.stringify(a)).toEqual([]);
      expect(f.bucket.size).toBe(0);
    }
  });

  it('reads a generatedApks answer: one signing key with its universal APK, nothing yet, or a refusal', () => {
    expect(universalApk({ generatedApks: [{ generatedUniversalApk: { downloadId: 'a_b-1' } }] })).toBe('a_b-1');
    expect(universalApk({})).toBeNull();
    expect(universalApk({ generatedApks: [] })).toBeNull();
    expect(universalApk({ generatedApks: [{ generatedSplitApks: [] }] })).toBeNull();
    expect(() => universalApk({ generatedApks: [{}, {}] })).toThrow(/2 signing keys/);
  });

  it('refuses a file that is not an APK, writing nothing', async () => {
    expect(() => checkApk(apk(100))).toThrow(/outside/);
    const notZip = apk();
    notZip[0] = 0x3c;
    const f = fakes({ file: notZip });
    await expect(publish({ ...base, fetch: f.fetch })).rejects.toThrow(/not a zip/);
    expect(f.writes()).toEqual([]);
  });

  it('asks nothing for a version code, fingerprint, bucket or key that is not there, or a build whose fingerprint is not the one checked', async () => {
    const cases = [
      [{ versionCode: '' }, /is not a version code/],
      [{ versionCode: '4x' }, /is not a version code/],
      [{ fingerprint: '' }, /is not an Android fingerprint/],
      [{ buildFingerprint: '' }, /is not the one the check named/],
      [{ buildFingerprint: `f${FP.slice(1)}` }, /is not the one the check named/],
      [{ env: { PLAY_REVIEW_KEY: playKeyFile } }, /the APK bucket is not configured/],
      [{ env: { ...env, PLAY_REVIEW_KEY: '' } }, /no Google Play key/]
    ] as const;
    for (const [change, why] of cases) {
      const f = fakes();
      await expect(publish({ ...base, ...change, fetch: f.fetch }), String(why)).rejects.toThrow(why);
      expect(f.calls, String(why)).toEqual([]);
    }
  });

  it('keeps a newer current build, leaves a file already there and the record that describes it, refuses a current record it did not write, and writes nothing on a dry run', async () => {
    const newer = fakes();
    newer.bucket.set(CURRENT, { body: JSON.stringify({ name: 'r30-l1-p1-ffffffff.apk', versionCode: 99 }), type: 'application/json' });
    await publish({ ...base, fetch: newer.fetch });
    expect(JSON.parse(newer.bucket.get(CURRENT)!.body as string).versionCode).toBe(99);
    expect(newer.bucket.has(NAME)).toBe(true);

    // A file already there is the one current.json describes, or none: the record never takes this build's sha256 and size for another's bytes.
    const there = fakes();
    there.bucket.set(NAME, { body: apk(), type: APK_TYPE });
    there.bucket.set(CURRENT, { body: JSON.stringify({ name: NAME, versionCode: 30, sha256: 'old', bytes: 7 }), type: 'application/json' });
    await publish({ ...base, fetch: there.fetch });
    expect(there.writes()).toEqual([]);
    expect(JSON.parse(there.bucket.get(CURRENT)!.body as string)).toEqual({ name: NAME, versionCode: 30, sha256: 'old', bytes: 7 });

    const odd = fakes();
    odd.bucket.set(CURRENT, { body: 'hello', type: 'text/plain' });
    await expect(publish({ ...base, fetch: odd.fetch })).rejects.toThrow(/is not what this script writes/);
    expect(odd.writes()).toEqual([]);

    const dry = fakes();
    const lines: string[] = [];
    await publish({ ...base, fetch: dry.fetch, dryRun: true, log: (s: string) => lines.push(s) });
    expect(dry.writes()).toEqual([]);
    expect(lines.at(-1)).toMatch(/^dry run: would put r\d+-l\d+-p\d+-0a1b2c3d\.apk/);
  });
});

describe('the carried build in the pipeline', () => {
  const deploy = read('apps/mobile/.eas/workflows/deploy-to-testers.yml');
  const job = (name: string) => deploy.split(/\n(?=  \w+:\n)/).find((part) => part.startsWith(`  ${name}:\n`)) ?? '';
  const needs = (name: string) => (/\n {4}needs: \[([^\]]*)\]/.exec(job(name))?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  it('checks, builds on the carried profile, uploads to the alpha track as a draft, and publishes the APK, in jobs of its own', () => {
    expect(needs('carried_check')).toEqual(['fingerprint']);
    expect(job('carried_check')).toMatch(/environment: production[\s\S]*due="\$\(npx tsx scripts\/carried-build\.mjs --check --fingerprint '\$\{\{ needs\.fingerprint\.outputs\.android_fingerprint_hash \}\}'\)" \|\| exit 1/);
    expect(needs('build_carried')).toEqual(['carried_check']);
    expect(job('build_carried')).toContain("if: ${{ needs.carried_check.outputs.due == 'true' }}");
    expect(job('build_carried')).toMatch(/platform: android\n\s*profile: carried/);
    expect(job('build_carried')).toContain('LQ_STORE_BUILD_REF: ${{ github.ref }}');
    expect(needs('submit_carried')).toEqual(['build_carried']);
    expect(job('submit_carried')).toMatch(/type: submit[\s\S]*profile: carried/);
    expect(needs('publish_carried')).toEqual(['fingerprint', 'build_carried', 'submit_carried']);
    expect(job('publish_carried')).toMatch(/environment: production[\s\S]*npx tsx scripts\/carried-build\.mjs --publish --version-code '\$\{\{ needs\.build_carried\.outputs\.app_build_version \}\}'/);
    expect(job('publish_carried')).toContain("--build-fingerprint '${{ needs.build_carried.outputs.fingerprint_hash }}'");
  });

  it('stands apart from the store build, so a failure there cannot stall publish_android_update or a store upload', () => {
    const carried = ['carried_check', 'build_carried', 'submit_carried', 'publish_carried'];
    const jobs = [...deploy.matchAll(/\n {2}(\w+):\n/g)].map((m) => m[1]!);
    for (const name of jobs.filter((j) => !carried.includes(j))) expect(needs(name).filter((n) => carried.includes(n)), name).toEqual([]);
    for (const name of carried) expect(needs(name).filter((n) => !carried.includes(n) && n !== 'fingerprint'), name).toEqual([]);
    expect(needs('publish_android_update')).toEqual(['get_android_build']);
    // get-build matches on profile, so a carried build never satisfies the store build's check (14.4).
    expect(job('get_android_build')).toMatch(/profile: production/);
  });

  it('goes on the alpha track as a draft, which play-review.mjs never reads, so it is never promoted', async () => {
    const submit = JSON.parse(read('apps/mobile/eas.json')).submit;
    expect(submit.carried).toEqual({ extends: 'production', android: { track: 'alpha', releaseStatus: 'draft' } });
    const tracks = [
      { track: 'production', releases: [{ versionCodes: ['40'], status: 'completed' }] },
      { track: 'internal', releases: [{ versionCodes: ['41'], status: 'completed' }] },
      { track: 'alpha', releases: [{ versionCodes: ['42'], status: 'draft' }] }
    ];
    const api = async (method: string, path: string) => (path === '/edits' ? { id: 'e' } : method === 'GET' ? { tracks } : null);
    expect(await look(api)).toEqual({ production: tracks[0]!.releases, internal: tracks[1]!.releases });
  });

  it('reads its keys from EAS\'s production environment, where npm run secrets puts them', () => {
    for (const key of ['APK_R2_ACCESS_KEY_ID', 'APK_R2_SECRET_ACCESS_KEY', 'PLAY_REVIEW_KEY']) {
      expect(EAS_KEYS).toContain(key);
      expect(FILE_KEYS).toContain(key);
    }
  });
});
