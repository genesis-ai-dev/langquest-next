import { generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NO_KEY, PACKAGE, assertion, livePlayVersion, newestRelease, nextPlayStep, playKey, run } from './play-review.mjs';
import { EAS_KEYS, destinations } from './secrets.mjs';

/**
 * The Android half of sending new builds to production review
 * (scripts/play-review.mjs, decisions.md 157 amended 2026-11-04): a new
 * build waits in internal testing while an older one is in review on Google
 * Play, and goes to production once nothing is. Google's API calls a
 * production release completed from the moment it is sent, so "in review"
 * is a production release newer than the version Play's page shows. The
 * step runs against a fake Play Developer API.
 */

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const { privateKey: pem, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyText = pem.export({ type: 'pkcs8', format: 'pem' }) as string;
const keyFile = JSON.stringify({ type: 'service_account', project_id: 'p', client_email: 'review@p.iam.gserviceaccount.com', private_key: keyText });
const env = { PLAY_REVIEW_KEY: keyFile };

interface Release { name?: string; versionCodes: string[]; status: string }
interface Tracks { production: Release[]; internal: Release[] }
interface Call { method: string; path: string; body?: any }

/** Google's token endpoint and the Play Developer API, as far as this step uses them. */
function fakeGoogle(tracks: Tracks) {
  const calls: Call[] = [];
  let edits = 0;
  const open = new Set<string>();
  const answer = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  const fetch = async (url: string, init: { method: string; body?: string }) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(init.body);
      calls.push({ method: init.method, path: 'token' });
      if (form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer' || !form.get('assertion')) return answer(400, { error: 'invalid_grant' });
      return answer(200, { access_token: 'ya29.token', expires_in: 3599 });
    }
    const prefix = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
    if (!url.startsWith(prefix)) return answer(404, { error: `not ${prefix}` });
    const path = url.slice(prefix.length);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path, body });
    if (init.method === 'POST' && path === '/edits') {
      const id = `e${++edits}`;
      open.add(id);
      return answer(200, { id });
    }
    let m = /^\/edits\/(e\d+)\/tracks$/.exec(path);
    if (m && init.method === 'GET') {
      return answer(200, { kind: 'androidpublisher#tracksListResponse', tracks: Object.entries(tracks).map(([track, releases]) => ({ track, releases })) });
    }
    m = /^\/edits\/(e\d+)\/tracks\/production$/.exec(path);
    if (m && init.method === 'PUT') {
      if (!open.has(m[1])) return answer(404, { error: 'no such edit' });
      tracks.production = [...tracks.production.map((r) => ({ ...r, status: r.status === 'completed' ? 'completed' : r.status })), ...body.releases];
      return answer(200, body);
    }
    m = /^\/edits\/(e\d+):commit$/.exec(path);
    if (m && init.method === 'POST') {
      open.delete(m[1]);
      return answer(200, { id: m[1] });
    }
    m = /^\/edits\/(e\d+)$/.exec(path);
    if (m && init.method === 'DELETE') {
      open.delete(m[1]);
      return answer(204, null);
    }
    return answer(404, { error: `${init.method} ${path} is not something this step should call` });
  };
  const writes = () => calls.filter((c) => c.method !== 'GET' && c.path !== 'token' && !(c.method === 'POST' && c.path === '/edits') && c.method !== 'DELETE');
  return { fetch, calls, writes, tracks };
}

async function step(tracks: Tracks, live: string | null, args: string[] = []) {
  const google = fakeGoogle(tracks);
  const said: string[] = [];
  const result = await run({ env, args, fetch: google.fetch as never, log: (line: string) => said.push(line), live: async () => live });
  return { ...google, result, said };
}

// Google Play on 2026-11-04: 2026.1030.1319 (code 48) is public, 2026.1103.2251 (code 50) went to production review.
const public48: Release = { name: '2026.1030.1319', versionCodes: ['48'], status: 'completed' };
const review50: Release = { name: '2026.1103.2251', versionCodes: ['50'], status: 'completed' };
const internal51: Release = { name: '2026.1104.1802', versionCodes: ['51'], status: 'completed' };

describe('a new Android build', () => {
  it('waits in internal testing while an older build is in review on Google Play, and the step only reads', async () => {
    const { writes, result, said } = await step({ production: [public48, review50], internal: [internal51] }, '2026.1030.1319');
    expect(writes()).toEqual([]);
    expect(result.action).toBe('wait');
    expect(said[0]).toBe('wait: build 50 (2026.1103.2251) is in review on Google Play (people get 2026.1030.1319), so build 51 (2026.1104.1802) waits in internal testing and goes on a later run. If Google rejected it, someone fixes it in Play Console, or a merge labelled "store: replace review" sends its build in its place.');
  });

  it('goes to production review once the older build is public, released to everyone when Google approves it', async () => {
    const { writes, result, said, tracks } = await step({ production: [public48, review50], internal: [internal51] }, '2026.1103.2251');
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual(['PUT /edits/e2/tracks/production', 'POST /edits/e2:commit']);
    expect(writes()[0].body).toEqual({ track: 'production', releases: [{ name: '2026.1104.1802', versionCodes: ['51'], status: 'completed' }] });
    expect(result.action).toBe('promote');
    expect(said).toEqual([
      'promote: nothing is in review on Google Play (people get 2026.1103.2251), so build 51 (2026.1104.1802) goes to production review.',
      'Build 51 is in production review, and goes public when Google approves it.'
    ]);
    expect(newestRelease(tracks.production)?.code).toBe(51);
  });

  it('waits while Play\'s page cannot be read, since nobody can tell whether a review is open', async () => {
    const { writes, result } = await step({ production: [public48, review50], internal: [internal51] }, null);
    expect(writes()).toEqual([]);
    expect(result.why).toMatch(/^Google Play's page could not be read, so nobody can tell whether build 50 \(2026\.1103\.2251\) is still in review/);
  });

  it('does nothing when no newer build waits, and throws away the edits it reads in', async () => {
    const { writes, result, calls } = await step({ production: [public48, review50], internal: [{ ...review50 }] }, '2026.1030.1319');
    expect(writes()).toEqual([]);
    expect(result).toMatchObject({ action: 'none', why: 'build 50 (2026.1103.2251) is not newer than build 50 (2026.1103.2251) on production' });
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/edits/e1']);
    expect((await step({ production: [public48], internal: [] }, '2026.1030.1319')).result.action).toBe('none');
  });

  it('goes straight to review on a production track with nothing on it yet', async () => {
    const { result } = await step({ production: [], internal: [internal51] }, null);
    expect(result.action).toBe('promote');
  });

  it('only says so with --dry-run', async () => {
    const { writes, result } = await step({ production: [public48], internal: [internal51] }, '2026.1030.1319', ['--dry-run']);
    expect(result.action).toBe('promote');
    expect(writes()).toEqual([]);
  });
});

describe('what the step reads', () => {
  it('takes the newest of a track\'s sent releases by version code, leaving drafts and halted ones out', () => {
    expect(newestRelease([public48, { name: 'draft', versionCodes: ['60'], status: 'draft' }, { name: 'halted', versionCodes: ['59'], status: 'halted' }, review50])).toEqual({ name: '2026.1103.2251', code: 50, versionCodes: ['50'] });
    expect(newestRelease([{ versionCodes: ['49'], status: 'inProgress' }])).toEqual({ name: null, code: 49, versionCodes: ['49'] });
    expect(newestRelease([])).toBeNull();
  });

  it('counts a production release as public once Play shows its version or a newer one', () => {
    expect(nextPlayStep({ production: [review50], internal: [internal51], live: '2026.1103.2251' }).action).toBe('promote');
    expect(nextPlayStep({ production: [review50], internal: [internal51], live: '2026.1104.900' }).action).toBe('promote');
    expect(nextPlayStep({ production: [review50], internal: [internal51], live: '2026.1103.2250' }).action).toBe('wait');
    expect(nextPlayStep({ production: [{ ...review50, name: 'Release 50' }], internal: [internal51], live: '2026.1103.2251' }).action).toBe('wait');
  });

  it('reads the public version from Play\'s page, and nothing from a page without one', async () => {
    const page = (status: number, text: string) => (async () => ({ ok: status < 300, status, text: async () => text })) as never;
    expect(await livePlayVersion({ fetch: page(200, '<script>AF_initDataCallback({data:[[["2026.1030.1319"]],[[[36]]]]})</script>') })).toBe('2026.1030.1319');
    expect(await livePlayVersion({ fetch: page(200, '<html>consent</html>') })).toBeNull();
    expect(await livePlayVersion({ fetch: page(429, '') })).toBeNull();
  });
});

describe('the Play key', () => {
  it('waits for a person without one, and fails on a value that is not a key', async () => {
    const said: string[] = [];
    expect(await run({ env: {}, log: (l: string) => said.push(l) })).toEqual({ action: 'wait', why: NO_KEY });
    expect(said).toEqual([`wait: ${NO_KEY}.`]);
    expect(playKey({ PLAY_REVIEW_KEY: ' ' })).toBeNull();
    expect(() => playKey({ PLAY_REVIEW_KEY: 'not json' })).toThrow(/is not the JSON key file/);
    expect(() => playKey({ PLAY_REVIEW_KEY: JSON.stringify({ client_email: 'c' }) })).toThrow(/lacks private_key/);
    expect(() => playKey({ PLAY_REVIEW_KEY: JSON.stringify({ client_email: 'c', private_key: 'nope' }) })).toThrow(/is not a private key/);
    expect(playKey(env)).toEqual({ clientEmail: 'review@p.iam.gserviceaccount.com', privateKey: keyText });
  });

  it('signs Google\'s service account request for the Play Developer API scope, for an hour', () => {
    const jwt = assertion({ clientEmail: 'review@p.iam.gserviceaccount.com', privateKey: keyText }, 1_000_000);
    const [head, body, sig] = jwt.split('.');
    expect(JSON.parse(Buffer.from(head, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(body, 'base64url').toString())).toEqual({
      iss: 'review@p.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', iat: 1000, exp: 4600
    });
    expect(verify('RSA-SHA256', Buffer.from(`${head}.${body}`), publicKey, Buffer.from(sig, 'base64url'))).toBe(true);
  });

  it('is the secret npm run secrets puts in EAS, under the name the step reads', () => {
    expect(read('scripts/play-review.mjs')).toContain('env.PLAY_REVIEW_KEY');
    expect(EAS_KEYS).toContain('PLAY_REVIEW_KEY');
    const file = { INVITE_RELAY_SECRET: 'r', PUSH_DELIVERY_SECRET: 'p', PLAY_REVIEW_KEY: keyFile };
    expect(playKey(destinations('production', file, 'ref', 'k').eas)?.clientEmail).toBe('review@p.iam.gserviceaccount.com');
    expect(JSON.parse(read('apps/mobile/app.json')).expo.android.package).toBe(PACKAGE);
  });
});

describe('the workflows', () => {
  const deploy = read('apps/mobile/.eas/workflows/deploy-to-testers.yml');
  /** A job's lines, up to the next job. */
  const job = (name: string) => deploy.split(/\n(?=  \w+:\n)/).find((part) => part.startsWith(`  ${name}:\n`)) ?? '';

  it('sends a new Android build to internal testing, then to production review when nothing is in review, unless its pull request asks to replace the review', () => {
    expect(job('store_choice')).toContain("node scripts/store-choice.mjs --sha '${{ github.event.head_commit.id }}'");
    expect(job('submit_android')).toContain("if: ${{ needs.store_choice.outputs.replace == 'true' }}");
    expect(job('submit_android')).toContain('profile: production');
    expect(job('submit_android_internal')).toContain("if: ${{ needs.store_choice.outputs.replace != 'true' }}");
    expect(job('submit_android_internal')).toContain('profile: internal');
    expect(job('review_android')).toMatch(/needs: \[submit_android_internal\]\n\s*environment: production[\s\S]*node scripts\/play-review\.mjs/);
    const eas = JSON.parse(read('apps/mobile/eas.json')).submit;
    expect(eas.production.android).toEqual({ track: 'production', releaseStatus: 'completed' });
    expect(eas.internal.android).toEqual({ track: 'internal', releaseStatus: 'completed' });
  });

  it('tries every hour, with the production key', () => {
    const hourly = read('apps/mobile/.eas/workflows/app-store-review.yml');
    expect(hourly).toMatch(/review_android:\n\s*name: [^\n]*\n\s*environment: production[\s\S]*node scripts\/play-review\.mjs/);
  });
});
