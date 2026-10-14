import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  applyOrgEvent, derivePassage, deriveUploadWork, emptyOrgState, foldOrg, isStored, ORG_STREAM, REDUCER_VERSION, SEED_ROLES,
  type OrgState, type Scope
} from '@langquest-next/core';
import { MemoryStore } from '../src/memoryStore';
import { runSnapshotWorker } from '../src/snapshotWorker';
import { runBlobReconciler } from '../src/blobReconciler';
import type { BlobFiles } from '../src/workerBlobs';
import { BadDigest, handleBlobs, type BlobBucket, type BlobDeps } from '../../../apps/web/worker/blobs';
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

const sha256 = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))).map((b) => b.toString(16).padStart(2, '0')).join('');

/** R2 in memory: the files the reconciler sees, and (`asBucket`) the bucket the Worker writes, which refuses bytes that do not hash to their name. */
class MemoryFiles implements BlobFiles {
  readonly objects = new Map<string, Uint8Array>();
  async list(prefix: string) {
    return [...this.objects].filter(([k]) => k.startsWith(prefix)).map(([key, b]) => ({ key, size: b.byteLength }));
  }
  async get(key: string) {
    const bytes = this.objects.get(key);
    if (!bytes) throw new Error(`no ${key}`);
    return bytes;
  }
  async put(key: string, bytes: Uint8Array) { this.objects.set(key, bytes); }
  async remove(key: string) { this.objects.delete(key); }
  asBucket(): BlobBucket {
    return {
      get: async (key) => {
        const bytes = this.objects.get(key);
        return bytes ? { size: bytes.byteLength, body: new Response(bytes as BodyInit).body! } : null;
      },
      head: async (key) => (this.objects.has(key) ? { size: this.objects.get(key)!.byteLength } : null),
      put: async (key, body, _length, hash) => {
        const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
        if ((await sha256(bytes)) !== hash) throw new BadDigest('did not match what we received');
        this.objects.set(key, bytes);
        return { size: bytes.byteLength };
      },
      delete: async (key) => { this.objects.delete(key); },
      list: async (prefix) => ({ objects: await this.list(prefix) })
    };
  }
}

/** The Worker's blob routes (apps/web/worker/blobs.ts) against the local database. */
function blobWorker(files: MemoryFiles): BlobDeps {
  const service = createClient(URL, SERVICE, { auth: { persistSession: false } });
  return {
    bucket: files.asBucket(),
    serviceKey: SERVICE,
    profileOf: async (token) => (await service.auth.getUser(token)).data.user?.id ?? null,
    mayUse: async (key, profileId, write) => {
      const { data, error } = await service.rpc('blob_access', { p_name: key, p_profile: profileId, p_write: write });
      if (error) throw new Error(error.message);
      return data === true;
    },
    record: async (orgId, streamId, hash, size) => {
      const { error } = await service.rpc('record_blob', { p_org: orgId, p_stream: streamId, p_hash: hash, p_size: size });
      if (error) throw new Error(error.message);
    }
  };
}

async function putAs(worker: BlobDeps, user: { sb: SupabaseClient }, key: string, bytes: Uint8Array): Promise<number> {
  const token = (await user.sb.auth.getSession()).data.session!.access_token;
  const res = await handleBlobs(new Request(`http://worker.test/api/blobs/${key}`, {
    method: 'PUT', body: bytes as BodyInit, headers: { authorization: `Bearer ${token}`, 'content-length': String(bytes.byteLength) }
  }), worker);
  return res.status;
}

const up = ANON ? await reachable() : false;

/** The lead invites someone, and they redeem it as themselves: nobody is added without joining (decisions.md 75). */
async function joinByInvite(lead: { sb: SupabaseClient }, who: { sb: SupabaseClient }, orgId: string, roleId: string, scope: Scope) {
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const issued = await lead.sb.rpc('issue_invite_v3', {
    p_org: orgId, p_invite_id: crypto.randomUUID(), p_token_hash: hash, p_role_id: roleId, p_scope: scope,
    p_expires_at: new Date(Date.now() + 86_400_000).toISOString(), p_label: null, p_max_uses: 1
  });
  if (issued.error) throw new Error(`invite: ${issued.error.message}`);
  const redeemed = await who.sb.rpc('redeem_invite_v2', { p_token: token });
  if (redeemed.error) throw new Error(`join: ${redeemed.error.message}`);
}

describe.skipIf(!up)('integration: two real users against local Supabase', () => {
  it('owner bootstraps, translator records, owner reviews, both converge', async () => {
    const stamp = Date.now();
    const lead = await signUp(`lead-${stamp}@example.test`);
    const trans = await signUp(`t1-${stamp}@example.test`);
    const orgId = `org-${stamp}`;
    const languageId = `lang-${stamp}`;
    const org = await newOrg(lead, orgId, languageId);
    const inLanguage: Scope = { level: 'language', languageId };
    // The lead may not add someone who never joined; the translator joins by invite.
    await org.append('v1.MemberAdded', { profileId: trans.userId, roleId: 'translator', scope: inLanguage });
    expect((await org.sync()).rejected).toBe(1);
    await joinByInvite(lead, trans, orgId, 'translator', inLanguage);
    await org.sync();

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

  it('a member upload through the Worker lands a BlobStored confirmation in the log', async () => {
    // Why: PLAN.md section 14 rule 2. The client never declares completion;
    // the Worker appends the confirmation once R2 has the bytes, and every
    // device pulls it (decisions.md 69).
    const stamp = Date.now();
    const lead = await signUp(`blob-${stamp}@example.test`);
    const stranger = await signUp(`blob-x-${stamp}@example.test`);
    const orgId = `org-b-${stamp}`;
    const languageId = `lb-${stamp}`;
    await newOrg(lead, orgId, languageId);
    const a = languageClient(orgId, languageId, lead, 'dA');
    await a.load();
    const bytes = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]);
    const hash = await sha256(bytes);
    await a.append('v1.RecordingAdded', { recordingId: 'r1', unitId: 'u1', kind: 'target', cards: [{ hash, durationMs: 10, format: 'wav' }] });
    await a.sync();
    expect(deriveUploadWork(a.getState(), new Set([hash])).map((r) => r.hash)).toEqual([hash]);

    const worker = blobWorker(new MemoryFiles());
    const key = `${orgId}/${languageId}/${hash}.wav`;
    expect(await putAs(worker, stranger, key, bytes)).toBe(403);
    expect(await putAs(worker, lead, `${orgId}/${languageId}/${'b'.repeat(64)}.wav`, bytes)).toBe(422);
    expect(await putAs(worker, lead, key, bytes)).toBe(200);

    await a.sync();
    expect(a.getState().blobs[hash]?.size).toBe(bytes.byteLength);
    expect(deriveUploadWork(a.getState(), new Set([hash]))).toEqual([]);

    // A client cannot forge the confirmation.
    await a.append('v1.BlobStored', { hash: 'forged', size: 1 });
    const r = await a.sync();
    expect(r.rejected).toBe(1);
    expect(a.getState().blobs['forged']).toBeUndefined();
  });

  it('the reconciler confirms what was never confirmed and invalidates bytes that hash wrong', async () => {
    // Why: decision 17. A confirmation can be lost after the bytes land, and
    // bytes can rot; nothing else checks the bucket. A corrupt file must not
    // be served to other devices, and the device holding the real file must
    // upload it again.
    const stamp = Date.now();
    const lead = await signUp(`recon-${stamp}@example.test`);
    const orgId = `org-r-${stamp}`;
    const languageId = `lr-${stamp}`;
    await newOrg(lead, orgId, languageId);
    const a = languageClient(orgId, languageId, lead, 'dA');
    await a.load();
    const good = new TextEncoder().encode('good bytes');
    const goodHash = await sha256(good);
    const badName = 'b'.repeat(64);
    await a.append('v1.RecordingAdded', { recordingId: 'r1', unitId: 'u1', kind: 'target', cards: [{ hash: goodHash, durationMs: 10, format: 'wav' }, { hash: badName, durationMs: 10, format: 'wav' }] });
    await a.sync();
    // Straight into the bucket, past the Worker: no confirmation, no hash check.
    const bucket = new MemoryFiles();
    bucket.objects.set(`${orgId}/${languageId}/${goodHash}.wav`, good);
    bucket.objects.set(`${orgId}/${languageId}/${badName}.wav`, new TextEncoder().encode('garbage'));

    const service = createClient(URL, SERVICE, { auth: { persistSession: false } });
    const report = await runBlobReconciler(service, bucket, { verify: true });
    expect(report.invalidated).toBeGreaterThanOrEqual(1);

    await a.sync();
    expect(isStored(a.getState(), goodHash)).toBe(true);
    expect(isStored(a.getState(), badName)).toBe(false);
    expect(deriveUploadWork(a.getState(), new Set([goodHash, badName])).map((r) => r.hash)).toEqual([badName]);
    expect(bucket.objects.has(`${orgId}/${languageId}/${badName}.wav`)).toBe(false);
  });
});
