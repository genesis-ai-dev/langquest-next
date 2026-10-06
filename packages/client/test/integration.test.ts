import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  applyOrgEvent, derivePassage, deriveUploadWork, emptyOrgState, foldOrg, isStored, ORG_STREAM, REDUCER_VERSION, SEED_ROLES,
  type OrgState, type Scope
} from '@langquest-next/core';
import { MemoryStore } from '../src/memoryStore';
import { runSnapshotWorker } from '../src/snapshotWorker';
import { runBlobReconciler } from '../src/blobReconciler';
import { SupabaseTransport } from '../src/supabaseTransport';
import { SyncClient, type Materializer } from '../src/syncClient';

/**
 * Runs against the local Supabase started by `npm run db:start`. Skipped when
 * it is not reachable so `npm test` stays green without Docker.
 */
const URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54421';
const ANON = process.env['SUPABASE_ANON_KEY'] ?? '';
const SERVICE = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';

const ORG_MATERIALIZER: Materializer<OrgState> = {
  empty: emptyOrgState, apply: applyOrgEvent, fold: foldOrg, compact: (s) => { s.appliedEventIds = {}; }, version: REDUCER_VERSION
};

async function reachable(): Promise<boolean> {
  try {
    const res = await fetch(`${URL}/auth/v1/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function signUp(email: string): Promise<{ sb: SupabaseClient; userId: string }> {
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signUp({ email, password: 'password-123' });
  if (error || !data.user || !data.session) throw new Error(`signUp failed: ${error?.message}`);
  return { sb, userId: data.user.id };
}

function orgClient(orgId: string, user: { sb: SupabaseClient; userId: string }, deviceId: string): SyncClient<OrgState> {
  return new SyncClient<OrgState>({
    materializer: ORG_MATERIALIZER, orgId, streamId: ORG_STREAM, actorId: user.userId, deviceId,
    store: new MemoryStore(), transport: new SupabaseTransport(user.sb)
  });
}

function languageClient(orgId: string, languageId: string, user: { sb: SupabaseClient; userId: string }, deviceId: string, store = new MemoryStore()): SyncClient {
  return new SyncClient({ orgId, streamId: languageId, actorId: user.userId, deviceId, store, transport: new SupabaseTransport(user.sb) });
}

/**
 * A fresh organization per test: its creator bootstraps the organization
 * stream (an organization that already has members refuses a stranger's
 * bootstrap) and lists the language, which its stream needs before it
 * accepts anything.
 */
async function newOrg(lead: { sb: SupabaseClient; userId: string }, orgId: string, languageId: string): Promise<SyncClient<OrgState>> {
  const org = orgClient(orgId, lead, 'dA');
  await org.load();
  await org.append('v1.OrgCreated', { name: orgId });
  for (const r of SEED_ROLES) await org.append('v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges });
  await org.append('v1.MemberAdded', { profileId: lead.userId, roleId: 'org_admin', scope: { level: 'org' } });
  await org.append('v1.LanguageAdded', { languageId, name: 'Luke', code: 'din', sourceCode: 'eng' });
  const r = await org.sync();
  expect(r.rejected).toBe(0);
  expect(r.pushed).toBe(SEED_ROLES.length + 3);
  return org;
}

const up = ANON ? await reachable() : false;

describe.skipIf(!up)('integration: two real users against local Supabase', () => {
  it('owner bootstraps, translator records, owner reviews, both converge', async () => {
    const stamp = Date.now();
    const lead = await signUp(`lead-${stamp}@example.test`);
    const trans = await signUp(`t1-${stamp}@example.test`);
    const orgId = `org-${stamp}`;
    const languageId = `lang-${stamp}`;
    const org = await newOrg(lead, orgId, languageId);
    const inLanguage: Scope = { level: 'language', languageId };
    await org.append('v1.MemberAdded', { profileId: trans.userId, roleId: 'translator', scope: inLanguage });
    expect((await org.sync()).rejected).toBe(0);

    const a = languageClient(orgId, languageId, lead, 'dA');
    const b = languageClient(orgId, languageId, trans, 'dB');
    await a.load();
    await b.load();
    await a.append('v1.UnitAdded', { unitId: 'u1', parentUnitId: null, kind: 'passage', label: 'Luke 1', order: 'a' });
    await a.append('v1.FlowSelected', { flowId: 'custom' });
    await a.append('v1.FlowStepSet', { stepId: 'custom/community', order: 's00', kindIds: ['community'], checkpoint: false });
    const r1 = await a.sync();
    expect(r1.rejected).toBe(0);
    expect(r1.pushed).toBe(3);

    // The translator's language-scope membership lets them read the language.
    await b.sync();
    expect(b.getState().units['u1']?.label).toBe('Luke 1');

    await b.append('v1.TakeComposed', { takeId: 'take1', unitId: 'u1', cardHashes: ['c1'], parentTakeId: null });
    // Translator tries something outside their role: kept locally, rejected by server.
    await b.append('v1.TemplateSelected', { itemId: 'tpl', docHash: 'a'.repeat(64), unitPrefix: 'tpl' });
    const r2 = await b.sync();
    expect(r2.pushed).toBe(1);
    expect(r2.rejected).toBe(1);
    expect(b.getState().template).toBeNull();

    // A language-scope translator may not grant roles in the organization stream either.
    const orgB = orgClient(orgId, trans, 'dB');
    await orgB.load();
    await orgB.append('v1.MemberAdded', { profileId: trans.userId, roleId: 'org_admin', scope: { level: 'org' } });
    expect((await orgB.sync()).rejected).toBe(1);

    await b.append('v1.TakeSubmitted', { takeId: 'take1' });
    await b.sync();
    await a.sync();
    expect(a.getState().takes['take1']).toBeDefined();
    await a.append('v1.ReviewRecorded', { reviewId: 'rv1', takeId: 'take1', kindId: 'community', outcome: 'looks_good', via: 'app' });
    await a.sync();
    await b.sync();

    expect(derivePassage(a.getState(), 'u1').done).toBe(true);
    expect(derivePassage(b.getState(), 'u1').done).toBe(true);
  });

  it('a language stream accepts nothing until the organization lists the language', async () => {
    // Why: rule 2 of docs/streams-and-languages.md. A language's identity
    // has one home, the organization stream; there is no bootstrap rule for
    // an empty language stream any more.
    const stamp = Date.now();
    const lead = await signUp(`unlisted-${stamp}@example.test`);
    const orgId = `org-u-${stamp}`;
    await newOrg(lead, orgId, `lang-${stamp}`);
    const c = languageClient(orgId, `unlisted-${stamp}`, lead, 'dA');
    await c.load();
    await c.append('v1.UnitAdded', { unitId: 'u1', parentUnitId: null, kind: 'passage', label: 'P', order: 'a' });
    const r = await c.sync();
    expect(r.pushed).toBe(0);
    expect(r.rejected === 1 || r.refused !== null).toBe(true);
  });

  it('the snapshot worker folds every language stream and a new device cold-starts from it', async () => {
    // Why: gate 4. Cold start must be snapshot plus tail, produced by the
    // same reducer the phone runs, written by the service role only.
    const stamp = Date.now();
    const lead = await signUp(`snap-${stamp}@example.test`);
    const orgId = `org-s-${stamp}`;
    const languageId = `ls-${stamp}`;
    await newOrg(lead, orgId, languageId);
    const a = languageClient(orgId, languageId, lead, 'dA');
    await a.load();
    for (let i = 0; i < 5; i++) {
      await a.append('v1.UnitAdded', { unitId: `u${i}`, parentUnitId: null, kind: 'passage', label: `P${i}`, order: `a${i}` });
    }
    await a.sync();

    const service = createClient(URL, SERVICE, { auth: { persistSession: false } });
    const done = await runSnapshotWorker(service);
    expect(done.find((d) => d.streamId === languageId)?.serverSeq).toBe(5);
    // The organization stream is small and never snapshotted.
    expect(done.some((d) => d.orgId === orgId && d.streamId === ORG_STREAM)).toBe(false);

    await a.append('v1.UnitHidden', { unitId: 'u0', hidden: true });
    await a.sync();

    const store = new MemoryStore();
    const b = languageClient(orgId, languageId, lead, 'dB', store);
    await b.load();
    const pulled = await b.pull();
    expect(pulled).toBe(1);
    expect(Object.keys(b.getState().units).length).toBe(5);
    expect(b.getState().hiddenUnits['u0']?.value).toBe(true);
    expect(await store.cursor(orgId, languageId)).toBe(6);

    // A second worker pass with nothing new is a no-op for this language.
    const again = await runSnapshotWorker(service);
    expect(again.find((d) => d.streamId === languageId)?.serverSeq).toBe(6);
  });

  it('a member upload to the blobs bucket lands a BlobStored confirmation in the log', async () => {
    // Why: PLAN.md section 14 rule 2. The client never declares completion;
    // the storage trigger appends the confirmation and every device pulls it.
    const stamp = Date.now();
    const lead = await signUp(`blob-${stamp}@example.test`);
    const orgId = `org-b-${stamp}`;
    const languageId = `lb-${stamp}`;
    await newOrg(lead, orgId, languageId);
    const a = languageClient(orgId, languageId, lead, 'dA');
    await a.load();
    await a.append('v1.RecordingAdded', { recordingId: 'r1', unitId: 'u1', kind: 'target', cards: [{ hash: 'deadbeef', durationMs: 10, format: 'wav' }] });
    await a.sync();
    expect(deriveUploadWork(a.getState(), new Set(['deadbeef'])).map((r) => r.hash)).toEqual(['deadbeef']);

    const bytes = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]);
    const { error } = await lead.sb.storage.from('blobs').upload(`${orgId}/${languageId}/deadbeef.wav`, bytes, { upsert: true, contentType: 'audio/wav' });
    expect(error).toBeNull();

    await a.sync();
    expect(a.getState().blobs['deadbeef']?.size).toBe(bytes.byteLength);
    expect(deriveUploadWork(a.getState(), new Set(['deadbeef']))).toEqual([]);

    // A client cannot forge the confirmation.
    await a.append('v1.BlobStored', { hash: 'forged', size: 1 });
    const r = await a.sync();
    expect(r.rejected).toBe(1);
    expect(a.getState().blobs['forged']).toBeUndefined();
  });

  it('the reconciler invalidates an object whose bytes do not hash to its name', async () => {
    // Why: nothing else verifies stored bytes. A corrupt upload must not be
    // served to other devices, and the device holding the real file must
    // upload it again.
    const stamp = Date.now();
    const lead = await signUp(`recon-${stamp}@example.test`);
    const orgId = `org-r-${stamp}`;
    const languageId = `lr-${stamp}`;
    await newOrg(lead, orgId, languageId);
    const a = languageClient(orgId, languageId, lead, 'dA');
    await a.load();
    const good = new TextEncoder().encode('good bytes');
    const goodHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', good))).map((b) => b.toString(16).padStart(2, '0')).join('');
    const badName = 'b'.repeat(64);
    await a.append('v1.RecordingAdded', { recordingId: 'r1', unitId: 'u1', kind: 'target', cards: [{ hash: goodHash, durationMs: 10, format: 'wav' }, { hash: badName, durationMs: 10, format: 'wav' }] });
    await a.sync();
    expect((await lead.sb.storage.from('blobs').upload(`${orgId}/${languageId}/${goodHash}.wav`, good, { upsert: true, contentType: 'audio/wav' })).error).toBeNull();
    expect((await lead.sb.storage.from('blobs').upload(`${orgId}/${languageId}/${badName}.wav`, new TextEncoder().encode('garbage'), { upsert: true, contentType: 'audio/wav' })).error).toBeNull();
    await a.sync();
    expect(isStored(a.getState(), badName)).toBe(true); // the trigger trusts the name

    const service = createClient(URL, SERVICE, { auth: { persistSession: false } });
    const report = await runBlobReconciler(service, { verify: true });
    expect(report.invalidated).toBeGreaterThanOrEqual(1);

    await a.sync();
    expect(isStored(a.getState(), goodHash)).toBe(true);
    expect(isStored(a.getState(), badName)).toBe(false);
    expect(deriveUploadWork(a.getState(), new Set([goodHash, badName])).map((r) => r.hash)).toEqual([badName]);
    expect((await lead.sb.storage.from('blobs').download(`${orgId}/${languageId}/${badName}.wav`)).error).not.toBeNull();
  });
});
