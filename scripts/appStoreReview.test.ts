import { generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AppleError, CANCELABLE, ITEM_TRIES, ITEM_WAIT_MS, NO_KEY, READY_LOOKS, READY_WAIT_MS, REVIEWING, WHATS_NEW, nextStep, reviewKey, run, stateOf, token
} from './app-store-review.mjs';
import { EAS_KEYS, destinations } from './secrets.mjs';
// @ts-expect-error CommonJS app config, read for its helper
import appConfig from '../apps/mobile/app.config.js';

/**
 * The iPhone half of sending new builds to production review
 * (scripts/app-store-review.mjs, decisions.md 157): never cancel, change or
 * replace what is in review unless the newer build's pull request asked to
 * replace it (the label `store: replace review`), let newer builds wait in
 * TestFlight while a review or release is on its way, let a newer build take a rejected one's
 * place (and leave the rejected build itself to a person), and send only the
 * newest build when nothing is open. The step runs against a fake App Store
 * Connect that refuses what Apple refuses.
 */

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const APP = '6812492008';
const pem = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const env = { APP_STORE_REVIEW_KEY: JSON.stringify({ issuerId: 'issuer', keyId: 'KEY123', privateKey: pem }) };

interface Version { id: string; string: string; state: string; build: string | null; oldField?: boolean; releaseType?: string }
interface Build { id: string; number: number; version: string; state?: 'VALID' | 'PROCESSING'; audience?: string }
interface Submission { id: string; state: string; items: string[] }
interface World { versions: Version[]; builds: Build[]; submissions: Submission[]; locales?: Record<string, { id: string; whatsNew: string | null }[]> }
interface Call { method: string; path: string; body?: any }

/** Apple's API as far as this step uses it, with the refusals that matter: one unreleased version and one open submission at a time, no change to a version on its way. */
function fakeApple(world: World, { itemConflicts = 0, readyAfterLooks = 0, refuseSubmit = false, closesLate = false, cancelsLate = false } = {}) {
  const calls: Call[] = [];
  const answer = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  const refuse = (status: number, code: string, detail: string, associated?: unknown) =>
    answer(status, { errors: [{ status: String(status), code, title: 'refused', detail, ...(associated ? { meta: { associatedErrors: associated } } : {}) }] });
  const editable = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'INVALID_BINARY', 'READY_FOR_REVIEW'];
  const unreleased = (v: Version) => !['READY_FOR_DISTRIBUTION', 'READY_FOR_SALE', 'REPLACED_WITH_NEW_VERSION'].includes(v.state);
  const buildOf = (id: string | null) => world.builds.find((b) => b.id === id);
  const locales = (versionId: string) => (world.locales ??= {})[versionId] ??= [{ id: `${versionId}-en`, whatsNew: null }];
  let looks = 0;
  let conflicts = itemConflicts;
  const versionResource = (v: Version) => ({
    type: 'appStoreVersions',
    id: v.id,
    attributes: { versionString: v.string, platform: 'IOS', releaseType: v.releaseType ?? 'MANUAL', ...(v.oldField ? { appStoreState: v.state } : { appStoreState: 'DEPRECATED_FIELD', appVersionState: v.state }) },
    relationships: { build: { data: v.build ? { type: 'builds', id: v.build } : null } }
  });

  const fetch = async (url: string, init: { method: string; body?: string }) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v1/, '');
    const body = init.body ? JSON.parse(init.body).data : undefined;
    calls.push({ method: init.method, path: `${path}${u.search}`, body });
    const route = `${init.method} ${path}`;

    if (route === 'GET /reviewSubmissions') {
      const states = u.searchParams.get('filter[state]')?.split(',');
      const subs = world.submissions.filter((s) => !states || states.includes(s.state));
      return answer(200, {
        data: subs.map((s) => ({
          type: 'reviewSubmissions',
          id: s.id,
          attributes: { platform: 'IOS', state: s.state },
          relationships: {
            items: { data: s.items.map((_, i) => ({ type: 'reviewSubmissionItems', id: `${s.id}-${i}` })) },
            appStoreVersionForReview: { data: world.versions.some((v) => v.id === s.items[0]) ? { type: 'appStoreVersions', id: s.items[0] } : null }
          }
        })),
        links: {}
      });
    }
    if (route === `GET /apps/${APP}/appStoreVersions`) {
      const attached = world.builds.filter((b) => world.versions.some((v) => v.build === b.id));
      return answer(200, {
        data: world.versions.map(versionResource),
        included: attached.map((b) => ({ type: 'builds', id: b.id, attributes: { version: String(b.number) } })),
        links: {}
      });
    }
    if (route === 'GET /builds') {
      const listed = [...world.builds].reverse();
      return answer(200, {
        data: listed.map((b) => ({
          type: 'builds',
          id: b.id,
          attributes: { version: String(b.number), processingState: b.state ?? 'VALID', buildAudienceType: b.audience ?? 'APP_STORE_ELIGIBLE', expired: false },
          relationships: { preReleaseVersion: { data: { type: 'preReleaseVersions', id: `pre-${b.version}` } } }
        })),
        included: [...new Set(listed.map((b) => b.version))].map((v) => ({ type: 'preReleaseVersions', id: `pre-${v}`, attributes: { version: v, platform: 'IOS' } }))
      });
    }
    if (route === 'POST /appStoreVersions') {
      if (world.versions.some(unreleased)) return refuse(409, 'ENTITY_ERROR', 'You cannot create a new version of the App in the current state.');
      const v = { id: `v-${body.attributes.versionString}`, string: body.attributes.versionString, state: 'PREPARE_FOR_SUBMISSION', build: body.relationships.build.data.id, releaseType: body.attributes.releaseType };
      world.versions.push(v);
      return answer(201, { data: versionResource(v) });
    }
    let m = /^\/appStoreVersions\/([^/]+)$/.exec(path);
    if (m && init.method === 'PATCH') {
      const v = world.versions.find((x) => x.id === m![1])!;
      if (!editable.includes(v.state)) return refuse(409, 'ENTITY_ERROR.ATTRIBUTE.INVALID', `version ${v.string} is ${v.state} and cannot change`);
      if (body.attributes?.versionString) v.string = body.attributes.versionString;
      if (body.relationships?.build) v.build = body.relationships.build.data.id;
      return answer(200, { data: versionResource(v) });
    }
    if (m && init.method === 'GET') {
      const v = world.versions.find((x) => x.id === m![1])!;
      looks++;
      if (['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'INVALID_BINARY'].includes(v.state) && world.submissions.some((s) => s.state === 'READY_FOR_REVIEW' && s.items.includes(v.id)) && looks > readyAfterLooks) v.state = 'READY_FOR_REVIEW';
      return answer(200, { data: versionResource(v) });
    }
    m = /^\/appStoreVersions\/([^/]+)\/appStoreVersionLocalizations$/.exec(path);
    if (m && init.method === 'GET') {
      return answer(200, { data: locales(m[1]).map((l) => ({ type: 'appStoreVersionLocalizations', id: l.id, attributes: { locale: 'en-US', whatsNew: l.whatsNew } })), links: {} });
    }
    m = /^\/appStoreVersionLocalizations\/([^/]+)$/.exec(path);
    if (m && init.method === 'PATCH') {
      const l = Object.values(world.locales ?? {}).flat().find((x) => x.id === m![1])!;
      l.whatsNew = body.attributes.whatsNew;
      return answer(200, { data: { type: 'appStoreVersionLocalizations', id: l.id, attributes: { whatsNew: l.whatsNew } } });
    }
    if (route === 'POST /reviewSubmissions') {
      if (world.submissions.some((s) => s.state !== 'COMPLETE')) return refuse(409, 'ENTITY_ERROR', 'There is already an open submission for this platform.');
      const s = { id: `s-${world.submissions.length + 1}`, state: 'READY_FOR_REVIEW', items: [] as string[] };
      world.submissions.push(s);
      return answer(201, { data: { type: 'reviewSubmissions', id: s.id, attributes: { state: s.state } } });
    }
    if (route === 'POST /reviewSubmissionItems') {
      if (conflicts > 0) {
        conflicts--;
        return refuse(409, 'STATE_ERROR.ENTITY_STATE_INVALID', 'appStoreVersions is not in valid state');
      }
      const s = world.submissions.find((x) => x.id === body.relationships.reviewSubmission.data.id)!;
      if (s.state !== 'READY_FOR_REVIEW') return refuse(409, 'ENTITY_ERROR', `submission ${s.id} is ${s.state}`);
      s.items.push(body.relationships.appStoreVersion.data.id);
      return answer(201, { data: { type: 'reviewSubmissionItems', id: `${s.id}-${s.items.length - 1}` } });
    }
    m = /^\/reviewSubmissions\/([^/]+)$/.exec(path);
    if (m && init.method === 'PATCH') {
      const s = world.submissions.find((x) => x.id === m![1])!;
      // Apple cancels a submission only while it waits or is in review; its version is then taken out of review.
      if (body.attributes?.canceled) {
        if (!['WAITING_FOR_REVIEW', 'IN_REVIEW'].includes(s.state)) return refuse(409, 'STATE_ERROR.ENTITY_STATE_INVALID', `submission ${s.id} is ${s.state} and cannot be cancelled`);
        s.state = cancelsLate ? 'CANCELING' : 'COMPLETE';
        for (const id of s.items) world.versions.find((v) => v.id === id)!.state = 'DEVELOPER_REJECTED';
        return answer(200, { data: { type: 'reviewSubmissions', id: s.id, attributes: { state: s.state } } });
      }
      if (body.attributes?.submitted) {
        if (refuseSubmit) return refuse(409, 'STATE_ERROR.ENTITY_STATE_INVALID', 'not ready', { [`/v1/appStoreVersions/${s.items[0]}`]: [{ code: 'ENTITY_ERROR.ATTRIBUTE.REQUIRED', detail: 'You must provide a value for the attribute \'copyright\'.' }] });
        s.state = 'WAITING_FOR_REVIEW';
        for (const id of s.items) world.versions.find((v) => v.id === id)!.state = 'WAITING_FOR_REVIEW';
      }
      return answer(200, { data: { type: 'reviewSubmissions', id: s.id, attributes: { state: s.state } } });
    }
    if (m && init.method === 'GET') {
      const s = world.submissions.find((x) => x.id === m![1])!;
      return answer(200, { data: { type: 'reviewSubmissions', id: s.id, attributes: { state: s.state } } });
    }
    m = /^\/reviewSubmissions\/([^/]+)\/items$/.exec(path);
    if (m && init.method === 'GET') {
      const s = world.submissions.find((x) => x.id === m![1])!;
      return answer(200, {
        data: s.items.map((item, i) => ({
          type: 'reviewSubmissionItems',
          id: `${s.id}-${i}`,
          relationships: { appStoreVersion: { data: world.versions.some((v) => v.id === item) ? { type: 'appStoreVersions', id: item } : null } }
        })),
        links: {}
      });
    }
    m = /^\/reviewSubmissionItems\/(.+)-(\d+)$/.exec(path);
    // Apple deletes no item that went to review (409 for build 48, 2026-11-04); the Remove button marks it removed.
    if (m && init.method === 'DELETE') return refuse(409, 'STATE_ERROR.ENTITY_STATE_INVALID', 'Item was already submitted');
    if (m && init.method === 'PATCH' && body.attributes?.removed) {
      const s = world.submissions.find((x) => x.id === m![1]);
      if (!s || !['UNRESOLVED_ISSUES', 'READY_FOR_REVIEW'].includes(s.state)) return refuse(409, 'ENTITY_ERROR', `submission ${m[1]} cannot lose items`);
      s.items.splice(Number(m[2]), 1);
      // Apple closes a rejected submission once its last item is gone.
      if (s.state === 'UNRESOLVED_ISSUES' && s.items.length === 0 && !closesLate) s.state = 'COMPLETE';
      return answer(200, { data: { type: 'reviewSubmissionItems', id: `${m[1]}-${m[2]}`, attributes: { state: 'REMOVED' } } });
    }
    return refuse(404, 'NOT_FOUND', `${route} is not something this step should call`);
  };
  const writes = () => calls.filter((c) => c.method !== 'GET');
  return { fetch, calls, writes, world };
}

/**
 * One run of the step against a fake App Store Connect, with no real
 * waiting. `replace` is what the newest build's pull request asks (the
 * label `store: replace review`); `asked` lists the versions it was asked for.
 */
async function step(world: World, options: Parameters<typeof fakeApple>[1] = {}, args: string[] = [], replace = false) {
  const apple = fakeApple(world, options);
  const waited: number[] = [];
  const said: string[] = [];
  const asked: string[] = [];
  const choice = async (version: string) => {
    asked.push(version);
    return replace ? { replace: true, why: `${version} came from #400, labelled "store: replace review"` } : { replace: false, why: `${version} came from #400, not labelled "store: replace review"` };
  };
  const result = await run({ env, args, appId: APP, fetch: apple.fetch as never, wait: (async (ms: number) => { waited.push(ms); }) as never, log: (line: string) => said.push(line), choice: choice as never });
  return { ...apple, result, waited, said, asked };
}

// Today's App Store (2026-11-02): build 45 is public, build 48 waits for Apple.
const live45: Version = { id: 'v-45', string: '2026.1026.1817', state: 'READY_FOR_DISTRIBUTION', build: 'b45' };
const builds: Build[] = [
  { id: 'b45', number: 45, version: '2026.1026.1817' },
  { id: 'b48', number: 48, version: '2026.1030.1319' },
  { id: 'b49', number: 49, version: '2026.1104.1700' }
];
const inReview = (state: string): World => ({
  versions: [live45, { id: 'v-48', string: '2026.1030.1319', state: state === 'IN_REVIEW' ? 'IN_REVIEW' : 'WAITING_FOR_REVIEW', build: 'b48' }],
  builds,
  submissions: [{ id: 's-48', state, items: ['v-48'] }]
});
const fresh = (world: World): World => JSON.parse(JSON.stringify(world));

describe('a build already in review', () => {
  it('is never cancelled, changed or replaced unless the newer build\'s merge asks: while a review is open, the step only reads', async () => {
    for (const state of REVIEWING) {
      const { writes, result, said, asked } = await step(inReview(state));
      expect(writes(), state).toEqual([]);
      expect(result.action, state).toBe('wait');
      expect(said.at(-1), state).toContain('so build 49 waits in TestFlight');
      // The label is read only for a review the step could cancel.
      expect(asked, state).toEqual(CANCELABLE.includes(state) ? ['2026.1104.1700'] : []);
    }
  });

  it('is cancelled for a newer build whose pull request asked to replace it, and the newer build goes to review on its version', async () => {
    for (const state of CANCELABLE) {
      const { writes, result, said, world: after } = await step(inReview(state), {}, [], true);
      expect(writes().map((c) => `${c.method} ${c.path.split('?')[0]}`), state).toEqual([
        'PATCH /reviewSubmissions/s-48',
        'PATCH /appStoreVersions/v-48',
        'PATCH /appStoreVersionLocalizations/v-48-en',
        'POST /reviewSubmissions',
        'POST /reviewSubmissionItems',
        'PATCH /reviewSubmissions/s-2'
      ]);
      expect(writes()[0].body, state).toEqual({ type: 'reviewSubmissions', id: 's-48', attributes: { canceled: true } });
      expect(said[0], state).toBe('Build 49: 2026.1104.1700 came from #400, labelled "store: replace review".');
      expect(said[1], state).toMatch(/^cancel: version 2026\.1030\.1319 \(build 48\) is (waiting for review|in review), and the merge that made build 49 asked to replace it/);
      expect(result.action, state).toBe('submit');
      expect(after.versions.find((v) => v.id === 'v-48'), state).toMatchObject({ string: '2026.1104.1700', build: 'b49', state: 'WAITING_FOR_REVIEW' });
    }
  });

  it('is cancelled with --dry-run only in words', async () => {
    const { writes, result } = await step(inReview('WAITING_FOR_REVIEW'), {}, ['--dry-run'], true);
    expect(writes()).toEqual([]);
    expect(result.action).toBe('cancel');
  });

  it('when Apple has not finished cancelling, the newer build goes on a later run', async () => {
    const { writes, result, waited } = await step(inReview('IN_REVIEW'), { cancelsLate: true }, [], true);
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual(['PATCH /reviewSubmissions/s-48']);
    expect(waited.filter((ms) => ms === READY_WAIT_MS)).toHaveLength(READY_LOOKS - 1);
    expect(result).toMatchObject({ action: 'wait', why: 'Apple is still cancelling the review, so build 49 goes on a later run' });
  });

  it('is not cancelled for its own build, nor while it is approved and on its way out, even when a merge asks', async () => {
    const own = await step({ ...inReview('WAITING_FOR_REVIEW'), builds: builds.slice(0, 2) }, {}, [], true);
    expect(own.writes()).toEqual([]);
    expect(own.result.action).toBe('none');
    for (const state of ['ACCEPTED', 'PENDING_DEVELOPER_RELEASE', 'PENDING_APPLE_RELEASE', 'PROCESSING_FOR_DISTRIBUTION']) {
      const world: World = { versions: [live45, { id: 'v-48', string: '2026.1030.1319', state, build: 'b48' }], builds, submissions: [{ id: 's-48', state: 'COMPLETE', items: ['v-48'] }] };
      const { writes, result, asked } = await step(world, {}, [], true);
      expect(writes(), state).toEqual([]);
      expect(result.action, state).toBe('wait');
      expect(asked, state).toEqual([]);
    }
  });

  it('is left alone when it is itself the newest build', async () => {
    const { writes, result } = await step({ ...inReview('WAITING_FOR_REVIEW'), builds: builds.slice(0, 2) });
    expect(writes()).toEqual([]);
    expect(result).toMatchObject({ action: 'none', why: 'version 2026.1030.1319 (build 48) is waiting for review' });
  });

  it('keeps its place while it is approved and not yet out, or in any state the step does not know', async () => {
    for (const state of ['ACCEPTED', 'PENDING_DEVELOPER_RELEASE', 'PENDING_APPLE_RELEASE', 'PROCESSING_FOR_DISTRIBUTION', 'PROCESSING_FOR_APP_STORE', 'WAITING_FOR_EXPORT_COMPLIANCE', 'A_STATE_APPLE_ADDS_LATER']) {
      const world: World = { versions: [live45, { id: 'v-48', string: '2026.1030.1319', state, build: 'b48' }], builds, submissions: [{ id: 's-48', state: 'COMPLETE', items: ['v-48'] }] };
      const { writes, result } = await step(world);
      expect(writes(), state).toEqual([]);
      expect(result.action, state).toBe('wait');
    }
    const { result } = await step({ versions: [live45, { id: 'v-48', string: '2026.1030.1319', state: 'PENDING_DEVELOPER_RELEASE', build: 'b48' }], builds, submissions: [] });
    expect(result.why).toContain('until someone releases it in App Store Connect');
  });

  it('is never sent again over a rejection: with no newer build, the step waits for a person to answer Apple', async () => {
    const world: World = { versions: [live45, { id: 'v-48', string: '2026.1030.1319', state: 'REJECTED', build: 'b48' }], builds: builds.slice(0, 2), submissions: [{ id: 's-48', state: 'UNRESOLVED_ISSUES', items: ['v-48'] }] };
    const { writes, result } = await step(world);
    expect(writes()).toEqual([]);
    expect(result.action).toBe('held');
    expect(result.why).toMatch(/^Apple rejected version 2026\.1030\.1319 \(build 48\)\. Someone answers Apple's message in App Store Connect \(App Review\) and resubmits it there, or a newer build takes its place by itself/);
    const metadata = await step({ versions: [live45, { id: 'v-48', string: '2026.1030.1319', state: 'METADATA_REJECTED', build: 'b48' }], builds, submissions: [] });
    expect(metadata.writes()).toEqual([]);
    expect(metadata.result.action).toBe('held');
  });

  it('is not sent again when its build was refused or taken out of review and no newer build has come', async () => {
    for (const state of ['REJECTED', 'DEVELOPER_REJECTED', 'INVALID_BINARY']) {
      const world: World = { versions: [live45, { id: 'v-48', string: '2026.1030.1319', state, build: 'b48' }], builds: builds.slice(0, 2), submissions: [] };
      const { writes, result } = await step(world);
      expect(writes(), state).toEqual([]);
      expect(result.action, state).toBe('held');
    }
  });
});

describe('a rejected build', () => {
  const rejected = (items = ['v-48']): World => ({
    versions: [live45, { id: 'v-48', string: '2026.1030.1319', state: 'REJECTED', build: 'b48' }],
    builds,
    submissions: [{ id: 's-48', state: 'UNRESOLVED_ISSUES', items }]
  });

  it('gives its place to a newer build: out of the rejected submission, then the newer build on its version, under the new number, to review', async () => {
    const { writes, result, said, world: after } = await step(rejected());
    expect(writes().map((c) => `${c.method} ${c.path.split('?')[0]}`)).toEqual([
      'PATCH /reviewSubmissionItems/s-48-0',
      'PATCH /appStoreVersions/v-48',
      'PATCH /appStoreVersionLocalizations/v-48-en',
      'POST /reviewSubmissions',
      'POST /reviewSubmissionItems',
      'PATCH /reviewSubmissions/s-2'
    ]);
    expect(writes()[0].body).toEqual({ type: 'reviewSubmissionItems', id: 's-48-0', attributes: { removed: true } });
    expect(writes()[1].body.attributes).toEqual({ versionString: '2026.1104.1700' });
    expect(writes()[1].body.relationships.build.data.id).toBe('b49');
    expect(result.action).toBe('submit');
    expect(said[0]).toBe('replace: Apple rejected version 2026.1030.1319 (build 48), and build 49 is newer, so build 49 takes its place: the rejected version leaves its submission and goes to review with build 49 (2026.1104.1700).');
    expect(said).toContain('Version 2026.1030.1319 (build 48) left its rejected submission.');
    expect(said.at(-1)).toBe('Build 49 (2026.1104.1700) is waiting for review, and goes public when Apple approves it.');
    expect(after.submissions.find((x) => x.id === 's-48')).toMatchObject({ state: 'COMPLETE', items: [] });
    expect(after.versions.find((v) => v.id === 'v-48')).toMatchObject({ string: '2026.1104.1700', build: 'b49', state: 'WAITING_FOR_REVIEW' });
  });

  it('only says so with --dry-run', async () => {
    const { writes, result } = await step(rejected(), {}, ['--dry-run']);
    expect(result.action).toBe('replace');
    expect(writes()).toEqual([]);
  });

  it('leaves a rejected submission that holds anything else to a person', async () => {
    const { writes, result } = await step(rejected(['v-48', 'in-app-event']));
    expect(writes()).toEqual([]);
    expect(result.action).toBe('held');
    expect(result.why).toContain('holds more than version 2026.1030.1319');
  });

  it('waits for Apple to close the rejected submission, and sends the newer build on a later run when it has not', async () => {
    const { writes, result, waited } = await step(rejected(), { closesLate: true });
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual(['PATCH /reviewSubmissionItems/s-48-0']);
    expect(waited.filter((ms) => ms === READY_WAIT_MS)).toHaveLength(READY_LOOKS - 1);
    expect(result).toMatchObject({ action: 'wait', why: 'Apple has not closed the rejected submission yet, so build 49 goes on a later run' });
  });
});

describe('sending the newest build', () => {
  it('makes its version, released on approval, fills in What\'s New, and sends it once Apple calls it ready', async () => {
    const world: World = { versions: [live45], builds, submissions: [] };
    const { writes, result, said, world: after } = await step(world, { readyAfterLooks: 2 });
    expect(result.action).toBe('submit');
    expect(writes().map((c) => `${c.method} ${c.path.split('?')[0]}`)).toEqual([
      'POST /appStoreVersions',
      'PATCH /appStoreVersionLocalizations/v-2026.1104.1700-en',
      'POST /reviewSubmissions',
      'POST /reviewSubmissionItems',
      'PATCH /reviewSubmissions/s-1'
    ]);
    expect(writes()[0].body.attributes).toEqual({ platform: 'IOS', versionString: '2026.1104.1700', releaseType: 'AFTER_APPROVAL' });
    expect(writes()[0].body.relationships.build.data.id).toBe('b49');
    expect(writes()[1].body.attributes).toEqual({ whatsNew: WHATS_NEW });
    expect(writes()[4].body.attributes).toEqual({ submitted: true });
    expect(after.submissions[0]).toMatchObject({ state: 'WAITING_FOR_REVIEW', items: ['v-2026.1104.1700'] });
    expect(said[1]).toBe('Build 49 (2026.1104.1700) is waiting for review, and goes public when Apple approves it.');
  });

  it('only says what it would do with --dry-run', async () => {
    const { writes, result } = await step({ versions: [live45], builds, submissions: [] }, {}, ['--dry-run']);
    expect(result.action).toBe('submit');
    expect(writes()).toEqual([]);
  });

  it('puts a newer build on a version that was rejected once the rejection is closed, under the build\'s own number', async () => {
    const world: World = { versions: [live45, { id: 'v-48', string: '2026.1030.1319', state: 'REJECTED', build: 'b48' }], builds, submissions: [{ id: 's-48', state: 'COMPLETE', items: ['v-48'] }] };
    const { writes, world: after } = await step(world);
    expect(writes()[0]).toMatchObject({ method: 'PATCH', path: '/appStoreVersions/v-48' });
    expect(writes()[0].body.attributes).toEqual({ versionString: '2026.1104.1700' });
    expect(writes()[0].body.relationships.build.data.id).toBe('b49');
    expect(writes().some((c) => c.path === '/appStoreVersions' && c.method === 'POST')).toBe(false);
    expect(after.versions.find((v) => v.id === 'v-48')).toMatchObject({ string: '2026.1104.1700', build: 'b49', state: 'WAITING_FOR_REVIEW' });
  });

  it('keeps What\'s New that someone wrote', async () => {
    const world: World = {
      versions: [live45, { id: 'v-49', string: '2026.1104.1700', state: 'PREPARE_FOR_SUBMISSION', build: 'b49' }],
      builds,
      submissions: [],
      locales: { 'v-49': [{ id: 'v-49-en', whatsNew: 'Clean up and even loudness.' }, { id: 'v-49-fr', whatsNew: '' }] }
    };
    const { writes, world: after } = await step(world);
    expect(writes().filter((c) => c.path.startsWith('/appStoreVersionLocalizations')).map((c) => c.path)).toEqual(['/appStoreVersionLocalizations/v-49-fr']);
    expect(after.locales!['v-49'][0].whatsNew).toBe('Clean up and even loudness.');
    // Its version already has the build, so nothing about it changes.
    expect(writes().some((c) => c.path.startsWith('/appStoreVersions'))).toBe(false);
  });

  it('uses an empty draft rather than opening a second submission, and resumes a draft that already holds the build', async () => {
    const empty = await step({ versions: [live45], builds, submissions: [{ id: 'draft', state: 'READY_FOR_REVIEW', items: [] }] });
    expect(empty.writes().some((c) => c.method === 'POST' && c.path === '/reviewSubmissions')).toBe(false);
    expect(empty.world.submissions[0]).toMatchObject({ id: 'draft', state: 'WAITING_FOR_REVIEW', items: ['v-2026.1104.1700'] });

    const resumed = await step({
      versions: [live45, { id: 'v-49', string: '2026.1104.1700', state: 'READY_FOR_REVIEW', build: 'b49' }],
      builds,
      submissions: [{ id: 'draft', state: 'READY_FOR_REVIEW', items: ['v-49'] }],
      locales: { 'v-49': [{ id: 'v-49-en', whatsNew: WHATS_NEW }] }
    });
    expect(resumed.writes().map((c) => `${c.method} ${c.path}`)).toEqual(['PATCH /reviewSubmissions/draft']);
  });

  it('leaves a draft that holds someone else\'s items, or an older build, to a person', async () => {
    const others = await step({ versions: [live45], builds, submissions: [{ id: 'draft', state: 'READY_FOR_REVIEW', items: ['in-app-event'] }] });
    expect(others.writes()).toEqual([]);
    expect(others.result.action).toBe('held');
    const older = await step({
      versions: [live45, { id: 'v-48', string: '2026.1030.1319', state: 'READY_FOR_REVIEW', build: 'b48' }],
      builds,
      submissions: [{ id: 'draft', state: 'READY_FOR_REVIEW', items: ['v-48'] }]
    });
    expect(older.writes()).toEqual([]);
    expect(older.result.why).toContain('is in a draft submission in App Store Connect');
  });

  it('tries the version\'s place in the submission again while Apple settles, then gives up with Apple\'s reason', async () => {
    const settled = await step({ versions: [live45], builds, submissions: [] }, { itemConflicts: 2 });
    expect(settled.world.submissions[0].state).toBe('WAITING_FOR_REVIEW');
    expect(settled.waited.filter((ms) => ms === ITEM_WAIT_MS)).toHaveLength(2);
    await expect(step({ versions: [live45], builds, submissions: [] }, { itemConflicts: ITEM_TRIES })).rejects.toThrow(/409 to POST \/reviewSubmissionItems: STATE_ERROR\.ENTITY_STATE_INVALID/);
  });

  it('submits after its wait even when Apple never calls the version ready, and fails with what Apple says is missing', async () => {
    const world: World = { versions: [live45], builds, submissions: [] };
    const err = await step(world, { readyAfterLooks: Infinity, refuseSubmit: true }).catch((e) => e);
    expect(err).toBeInstanceOf(AppleError);
    expect(err.message).toContain('ENTITY_ERROR.ATTRIBUTE.REQUIRED: You must provide a value for the attribute \'copyright\'.');
  });

  it('waits for Apple to call the version ready a set number of times', async () => {
    const { waited } = await step({ versions: [live45], builds, submissions: [] }, { readyAfterLooks: Infinity });
    expect(waited.filter((ms) => ms === READY_WAIT_MS)).toHaveLength(READY_LOOKS - 1);
  });
});

describe('the next step', () => {
  const newest = { id: 'b49', number: 49, version: '2026.1104.1700' };
  const live = { id: 'v-45', string: '2026.1026.1817', state: 'READY_FOR_DISTRIBUTION', build: 45 };

  it('sends only builds newer than the public one, the newest of several public versions', () => {
    expect(nextStep({ versions: [live], newest: { ...newest, number: 45 } }).action).toBe('none');
    expect(nextStep({ versions: [{ ...live, build: 40 }, live, { ...live, id: 'v-44', build: 44 }], newest: { ...newest, number: 45 } }).why).toBe('build 45 is not newer than the public build 45');
    expect(nextStep({ versions: [], newest }).action).toBe('submit');
    expect(nextStep({ versions: [live], newest: null }).action).toBe('none');
  });

  it('waits while Apple closes a rejected submission that someone emptied', () => {
    expect(nextStep({ versions: [live], newest, submissions: [{ id: 's', state: 'UNRESOLVED_ISSUES', versionId: null, items: 0 }] }))
      .toEqual({ action: 'wait', why: 'Apple is closing a rejected submission that holds nothing now, so build 49 waits in TestFlight and goes on a later run' });
  });

  it('says which builds Apple is still processing', () => {
    expect(nextStep({ versions: [{ ...live, build: 49 }], newest, processing: [{ number: 50 }] }).why)
      .toBe('build 49 is not newer than the public build 49; build 50 is still processing at Apple');
  });

  it('stops when another build already holds the version number', () => {
    expect(nextStep({ versions: [{ ...live, string: newest.version, build: 48 }], newest }).action).toBe('stuck');
    expect(nextStep({ versions: [live, { id: 'old', string: newest.version, state: 'REPLACED_WITH_NEW_VERSION', build: 47 }], newest }).action).toBe('stuck');
  });

  it('reads appStoreState\'s old names, and prefers appVersionState', () => {
    expect(stateOf({ attributes: { appStoreState: 'READY_FOR_SALE' } })).toBe('READY_FOR_DISTRIBUTION');
    expect(stateOf({ attributes: { appStoreState: 'PROCESSING_FOR_APP_STORE' } })).toBe('PROCESSING_FOR_DISTRIBUTION');
    expect(stateOf({ attributes: { appStoreState: 'READY_FOR_SALE', appVersionState: 'WAITING_FOR_REVIEW' } })).toBe('WAITING_FOR_REVIEW');
    expect(stateOf({})).toBe('UNKNOWN');
  });

  it('counts a version that has only the old field as public', async () => {
    const { result } = await step({ versions: [{ ...live45, state: 'READY_FOR_SALE', oldField: true }], builds: builds.slice(0, 1), submissions: [] });
    expect(result.why).toBe('build 45 is not newer than the public build 45');
  });

  it('never sends a build that TestFlight keeps for internal testers, or one still processing', async () => {
    const world: World = { versions: [live45], builds: [builds[0], { id: 'b46', number: 46, version: '2026.1027.900', audience: 'INTERNAL_ONLY' }, { id: 'b47', number: 47, version: '2026.1028.900', state: 'PROCESSING' }], submissions: [] };
    const { result, writes } = await step(world);
    expect(writes()).toEqual([]);
    expect(result.why).toBe('build 45 is not newer than the public build 45; build 47 is still processing at Apple');
  });
});

describe('the App Manager key', () => {
  it('lets the build wait in TestFlight while there is none, and asks nothing of Apple', async () => {
    const said: string[] = [];
    const result = await run({ env: {}, appId: APP, fetch: (() => { throw new Error('no request without a key'); }) as never, log: (l: string) => said.push(l) });
    expect(result.action).toBe('wait');
    expect(said).toEqual([`wait: ${NO_KEY}.`]);
    expect(reviewKey({})).toBeNull();
    expect(reviewKey({ APP_STORE_REVIEW_KEY: '  ' })).toBeNull();
  });

  it('is the JSON that docs/environments.md describes, and fails the job when it is anything else', () => {
    expect(reviewKey(env)).toEqual({ issuerId: 'issuer', keyId: 'KEY123', privateKey: pem });
    // A copy that turned the file's line breaks into "\n" still works.
    expect(reviewKey({ APP_STORE_REVIEW_KEY: JSON.stringify({ issuerId: 'i', keyId: 'k', privateKey: pem.replaceAll('\n', '\\n') }) })?.privateKey).toBe(pem);
    const broken = `{"issuerId":"i","keyId":"k","privateKey":"${pem.trim()}"}`;
    expect(reviewKey({ APP_STORE_REVIEW_KEY: broken })?.privateKey.trim()).toBe(pem.trim());
    expect(() => reviewKey({ APP_STORE_REVIEW_KEY: pem })).toThrow(/is not the JSON/);
    // An individual key has no issuer.
    expect(reviewKey({ APP_STORE_REVIEW_KEY: JSON.stringify({ keyId: 'k', privateKey: pem }) })).toEqual({ keyId: 'k', privateKey: pem });
    expect(() => reviewKey({ APP_STORE_REVIEW_KEY: JSON.stringify({ issuerId: '', keyId: 'k', privateKey: pem }) })).toThrow(/issuerId is empty/);
    expect(() => reviewKey({ APP_STORE_REVIEW_KEY: JSON.stringify({ issuerId: 'i', privateKey: pem }) })).toThrow(/lacks keyId/);
    expect(() => reviewKey({ APP_STORE_REVIEW_KEY: JSON.stringify({ issuerId: 'i', keyId: 'k', privateKey: 'not a key' }) })).toThrow(/not the text of an App Store Connect \.p8 key/);
  });

  it('signs an ES256 token for the key, good for 15 minutes', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwt = token({ keyId: 'K1', issuerId: 'I1', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string }, 1_000_000);
    const [head, body, sig] = jwt.split('.');
    expect(JSON.parse(Buffer.from(head, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'K1', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(body, 'base64url').toString())).toEqual({ iss: 'I1', iat: 1000, exp: 1900, aud: 'appstoreconnect-v1' });
    expect(verify('sha256', Buffer.from(`${head}.${body}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))).toBe(true);
  });

  it('signs an individual key\'s token with "sub": "user" and no issuer, as Apple asks', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwt = token({ keyId: 'K2', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string }, 1_000_000);
    const [head, body, sig] = jwt.split('.');
    expect(JSON.parse(Buffer.from(head, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'K2', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(body, 'base64url').toString())).toEqual({ sub: 'user', iat: 1000, exp: 1900, aud: 'appstoreconnect-v1' });
    expect(verify('sha256', Buffer.from(`${head}.${body}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))).toBe(true);
  });

  it('is the secret npm run secrets puts in EAS, under the name the step reads', () => {
    expect(read('scripts/app-store-review.mjs')).toContain('env.APP_STORE_REVIEW_KEY');
    expect(EAS_KEYS).toContain('APP_STORE_REVIEW_KEY');
    const file = { INVITE_RELAY_SECRET: 'r', PUSH_DELIVERY_SECRET: 'p', APP_STORE_REVIEW_KEY: env.APP_STORE_REVIEW_KEY };
    expect(destinations('production', file, 'ref', 'k').eas).toEqual(env);
    expect(reviewKey(destinations('production', file, 'ref', 'k').eas)?.keyId).toBe('KEY123');
  });
});

describe('the step\'s code and workflows', () => {
  it('deletes nothing, cancels a review in one place only, and removes only a rejected version from its rejected submission', () => {
    const source = read('scripts/app-store-review.mjs');
    expect(source.match(/\bcanceled: true\b/g)).toHaveLength(1);
    expect(source).toContain("export async function cancelReview(api, submission, { wait = sleep } = {}) {\n  await api('PATCH', `/reviewSubmissions/${submission.id}`, { type: 'reviewSubmissions', id: submission.id, attributes: { canceled: true } });");
    // Called once, for the step that only a merge labelled `store: replace review` makes.
    expect(source.match(/await cancelReview\(/g)).toHaveLength(1);
    expect(source).toMatch(/if \(step\.action === 'cancel'\) \{\n    const done = await cancelReview\(/);
    expect(source).not.toMatch(/'DELETE'/);
    expect(source.match(/removed: true/g)).toHaveLength(1);
  });

  it('runs every hour, and right after each new iPhone build reaches TestFlight, with the production key', () => {
    const hourly = read('apps/mobile/.eas/workflows/app-store-review.yml');
    expect(hourly).toMatch(/schedule:\s*\n\s*- cron: '7 \* \* \* \*'/);
    expect(hourly).toMatch(/environment: production[\s\S]*node scripts\/app-store-review\.mjs/);
    const deploy = read('apps/mobile/.eas/workflows/deploy-to-testers.yml');
    expect(deploy).toMatch(/review_ios:\s*\n\s*name: [^\n]*\n\s*needs: \[submit_ios\]\s*\n\s*environment: production[\s\S]*?node scripts\/app-store-review\.mjs/);
  });
});

describe('the store version', () => {
  it('is the merge time in UTC, and grows with it', () => {
    expect(appConfig.storeVersion('2026-10-22T18:30:00Z')).toBe('2026.1022.1830');
    expect(appConfig.storeVersion('2026-10-22T11:30:00-07:00')).toBe('2026.1022.1830');
    expect(appConfig.storeVersion('2027-01-05T00:05:00Z')).toBe('2027.105.5');
    const order = ['2026-10-22T09:05:00Z', '2026-10-22T18:30:00Z', '2026-11-01T00:00:00Z', '2027-01-01T00:00:00Z'].map(appConfig.storeVersion);
    const key = (v: string) => v.split('.').reduce((n, part) => n * 10_000 + Number(part), 0);
    for (let i = 1; i < order.length; i++) expect(key(order[i]), order[i]).toBeGreaterThan(key(order[i - 1]));
  });

  it('keeps app.json\'s version for every build that the workflow on main did not start', () => {
    const before = process.env.LQ_STORE_VERSION_TIME;
    delete process.env.LQ_STORE_VERSION_TIME;
    expect(appConfig({ config: { version: '1.0.0', name: 'x' } }).version).toBe('1.0.0');
    process.env.LQ_STORE_VERSION_TIME = '2026-10-22T18:30:00Z';
    expect(appConfig({ config: { version: '1.0.0', name: 'x' } }).version).toBe('2026.1022.1830');
    if (before === undefined) delete process.env.LQ_STORE_VERSION_TIME;
    else process.env.LQ_STORE_VERSION_TIME = before;
  });
});
