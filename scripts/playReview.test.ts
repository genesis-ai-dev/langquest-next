import { generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NO_KEY, PACKAGE, assertion, newestRelease, nextPlayStep, playKey, run } from './play-review.mjs';
import { EAS_KEYS, destinations } from './secrets.mjs';

/**
 * The Android step that clears internal testing (scripts/play-review.mjs,
 * decisions.md 253): new builds go straight to production review, and the
 * newest build left in internal testing goes there too, in place of a
 * release still in review, so nothing waits in internal testing. Only the
 * newest goes. The step runs against a fake Play Developer API.
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

async function step(tracks: Tracks, args: string[] = []) {
  const google = fakeGoogle(tracks);
  const said: string[] = [];
  const result = await run({ env, args, fetch: google.fetch as never, log: (line: string) => said.push(line) });
  return { ...google, result, said };
}

// Google Play on 2026-11-04: 2026.1030.1319 (code 48) is public, 2026.1103.2251 (code 50) went to production review.
const public48: Release = { name: '2026.1030.1319', versionCodes: ['48'], status: 'completed' };
const review50: Release = { name: '2026.1103.2251', versionCodes: ['50'], status: 'completed' };
const internal51: Release = { name: '2026.1104.1802', versionCodes: ['51'], status: 'completed' };

const internal52: Release = { name: '2026.1105.900', versionCodes: ['52'], status: 'completed' };

describe('a build left in internal testing', () => {
  it('goes to production review in place of the release still in review, released to everyone when Google approves it', async () => {
    const { writes, result, said, tracks } = await step({ production: [public48, review50], internal: [internal51] });
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual(['PUT /edits/e2/tracks/production', 'POST /edits/e2:commit']);
    expect(writes()[0].body).toEqual({ track: 'production', releases: [{ name: '2026.1104.1802', versionCodes: ['51'], status: 'completed' }] });
    expect(result.action).toBe('promote');
    expect(said).toEqual([
      'promote: build 51 (2026.1104.1802) is the newest build in internal testing, so it goes to production review, in place of build 50 (2026.1103.2251) if Google has not approved that one yet.',
      'Build 51 is in production review, and goes public when Google approves it.'
    ]);
    expect(newestRelease(tracks.production)?.code).toBe(51);
  });

  it('goes alone: only the newest of several builds in internal testing is sent', async () => {
    const { writes, result } = await step({ production: [public48], internal: [internal51, internal52] });
    expect(result.action).toBe('promote');
    expect(writes().filter((c) => c.method === 'PUT').map((c) => c.body.releases)).toEqual([[{ name: '2026.1105.900', versionCodes: ['52'], status: 'completed' }]]);
  });

  it('does nothing when no newer build is in internal testing, and throws away the edits it reads in', async () => {
    const { writes, result, calls } = await step({ production: [public48, review50], internal: [{ ...review50 }] });
    expect(writes()).toEqual([]);
    expect(result).toMatchObject({ action: 'none', why: 'build 50 (2026.1103.2251) is not newer than build 50 (2026.1103.2251) on production' });
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/edits/e1']);
    expect((await step({ production: [public48], internal: [] })).result.action).toBe('none');
  });

  it('goes straight to review on a production track with nothing on it yet', async () => {
    const { result } = await step({ production: [], internal: [internal51] });
    expect(result).toMatchObject({ action: 'promote', why: 'build 51 (2026.1104.1802) is the newest build in internal testing, so it goes to production review' });
  });

  it('only says so with --dry-run', async () => {
    const { writes, result } = await step({ production: [public48], internal: [internal51] }, ['--dry-run']);
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

  it('never waits for a review: the newest build in internal testing goes whatever is on production', () => {
    expect(nextPlayStep({ production: [review50], internal: [internal51] }).action).toBe('promote');
    expect(nextPlayStep({ production: [{ ...review50, name: 'Release 50' }], internal: [internal51] }).action).toBe('promote');
    expect(nextPlayStep({ production: [{ ...internal51 }], internal: [internal51] }).action).toBe('none');
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

  it('sends a new Android build straight to production review, and nothing to internal testing', () => {
    // eas.json keeps its unused `internal` profile: any change to that file changes the native fingerprint (decision 253).
    expect(job('submit_android')).toContain('needs: [build_android]\n');
    expect(job('submit_android')).not.toContain('if:');
    expect(job('submit_android')).toContain('profile: production');
    expect(deploy).not.toMatch(/profile: internal|store-choice|node scripts\/play-review/);
    const eas = JSON.parse(read('apps/mobile/eas.json')).submit;
    expect(eas.production.android).toEqual({ track: 'production', releaseStatus: 'completed' });
  });

  it('tries every hour, with the production key', () => {
    const hourly = read('apps/mobile/.eas/workflows/app-store-review.yml');
    expect(hourly).toMatch(/review_android:\n\s*name: [^\n]*\n\s*environment: production[\s\S]*node scripts\/play-review\.mjs/);
  });
});
