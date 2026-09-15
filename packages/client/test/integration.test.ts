import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { deriveTakeStatus, deriveUploadWork, isStored } from '@langquest-next/core';
import { MemoryStore } from '../src/memoryStore';
import { runSnapshotWorker } from '../src/snapshotWorker';
import { runBlobReconciler } from '../src/blobReconciler';
import { SupabaseTransport } from '../src/supabaseTransport';
import { SyncClient } from '../src/syncClient';

/** A fresh org per run: an org that already has members refuses strangers' bootstraps (migration 000009). */
const ORG = `org-${Date.now()}`;

/**
 * Runs against the local Supabase started by `npm run db:start`. Skipped when
 * it is not reachable so `npm test` stays green without Docker.
 */
const URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321';
const ANON = process.env['SUPABASE_ANON_KEY'] ?? '';
const SERVICE = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';

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

const up = ANON ? await reachable() : false;

describe.skipIf(!up)('integration: two real users against local Supabase', () => {
  const projectId = `p-${Date.now()}`;

  it('owner bootstraps, translator records, owner reviews, both converge', async () => {
    const stamp = Date.now();
    const lead = await signUp(`lead-${stamp}@example.test`);
    const trans = await signUp(`t1-${stamp}@example.test`);

    const a = new SyncClient({
      orgId: ORG,
      projectId,
      actorId: lead.userId,
      deviceId: 'dA',
      store: new MemoryStore(),
      transport: new SupabaseTransport(lead.sb)
    });
    const b = new SyncClient({
      orgId: ORG,
      projectId,
      actorId: trans.userId,
      deviceId: 'dB',
      store: new MemoryStore(),
      transport: new SupabaseTransport(trans.sb)
    });
    await a.load();
    await b.load();

    await a.append('v1.ProjectCreated', { name: 'Luke', sourceLanguoidId: 'eng' });
    await a.append('v1.MemberAdded', { profileId: lead.userId, role: 'owner' });
    await a.append('v1.MemberAdded', { profileId: trans.userId, role: 'translator' });
    await a.append('v1.MemberAdded', { profileId: lead.userId, role: 'reviewer' });
    const r1 = await a.sync();
    expect(r1.rejected).toBe(0);
    expect(r1.pushed).toBe(4);

    // Translator cannot pull before membership landed? It has landed; pull works.
    await b.sync();
    expect(b.getState().project?.value.name).toBe('Luke');

    await b.append('v1.TakeComposed', {
      takeId: 'take1',
      unitId: 'u1',
      laneId: 'L1',
      cardHashes: ['c1'],
      parentTakeId: null
    });
    // Translator tries something outside their role: kept locally, rejected by server.
    await b.append('v1.MemberAdded', { profileId: 'intruder', role: 'owner' });
    const r2 = await b.sync();
    expect(r2.pushed).toBe(1);
    expect(r2.rejected).toBe(1);
    expect(b.getState().members['intruder']).toBeUndefined();

    await b.append('v1.TakeSubmitted', { takeId: 'take1' });
    await b.sync();
    await a.sync();
    expect(a.getState().takes['take1']).toBeDefined();
    await a.append('v1.ReviewSubmitted', { takeId: 'take1', stepId: 'community', decision: 'approve' });
    await a.sync();
    await b.sync();

    expect(deriveTakeStatus(a.getState(), 'take1').outcome).toBe('approved');
    expect(deriveTakeStatus(b.getState(), 'take1').outcome).toBe('approved');
  });

  it('the snapshot worker folds every partition and a new device cold-starts from it', async () => {
    // Why: gate 4. Cold start must be snapshot plus tail, produced by the
    // same reducer the phone runs, written by the service role only.
    const stamp = Date.now();
    const lead = await signUp(`snap-${stamp}@example.test`);
    const pid = `ps-${stamp}`;
    const a = new SyncClient({ orgId: ORG, projectId: pid, actorId: lead.userId, deviceId: 'dA', store: new MemoryStore(), transport: new SupabaseTransport(lead.sb) });
    await a.load();
    await a.append('v1.ProjectCreated', { name: 'S', sourceLanguoidId: 'eng' });
    await a.append('v1.MemberAdded', { profileId: lead.userId, role: 'owner' });
    for (let i = 0; i < 5; i++) {
      await a.append('v1.UnitAdded', { unitId: `u${i}`, parentUnitId: null, kind: 'passage', label: `P${i}`, order: `a${i}` });
    }
    await a.sync();

    const service = createClient(URL, SERVICE, { auth: { persistSession: false } });
    const done = await runSnapshotWorker(service);
    expect(done.find((d) => d.projectId === pid)?.serverSeq).toBe(7);

    await a.append('v1.LaneAdded', { laneId: 'L1', languoidId: 'x' });
    await a.sync();

    const store = new MemoryStore();
    const b = new SyncClient({ orgId: ORG, projectId: pid, actorId: lead.userId, deviceId: 'dB', store, transport: new SupabaseTransport(lead.sb) });
    await b.load();
    const pulled = await b.pull();
    expect(pulled).toBe(1);
    expect(Object.keys(b.getState().units).length).toBe(5);
    expect(b.getState().lanes['L1']).toBeDefined();
    expect(await store.cursor(ORG, pid)).toBe(8);

    // A second worker pass with nothing new is a no-op for this partition.
    const again = await runSnapshotWorker(service);
    expect(again.find((d) => d.projectId === pid)?.serverSeq).toBe(8);
  });

  it('a member upload to the blobs bucket lands a BlobStored confirmation in the log', async () => {
    // Why: PLAN.md section 14 rule 2. The client never declares completion;
    // the storage trigger appends the confirmation and every device pulls it.
    const stamp = Date.now();
    const lead = await signUp(`blob-${stamp}@example.test`);
    const pid = `pb-${stamp}`;
    const a = new SyncClient({ orgId: ORG, projectId: pid, actorId: lead.userId, deviceId: 'dA', store: new MemoryStore(), transport: new SupabaseTransport(lead.sb) });
    await a.load();
    await a.append('v1.ProjectCreated', { name: 'B', sourceLanguoidId: 'eng' });
    await a.append('v1.MemberAdded', { profileId: lead.userId, role: 'owner' });
    await a.append('v1.RecordingAdded', { recordingId: 'r1', unitId: 'u1', laneId: 'L1', kind: 'target', cards: [{ hash: 'deadbeef', durationMs: 10, format: 'wav' }] });
    await a.sync();
    expect(deriveUploadWork(a.getState(), new Set(['deadbeef'])).map((r) => r.hash)).toEqual(['deadbeef']);

    const bytes = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]);
    const { error } = await lead.sb.storage.from('blobs').upload(`${ORG}/${pid}/deadbeef.wav`, bytes, { upsert: true, contentType: 'audio/wav' });
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
    const pid = `pr-${stamp}`;
    const a = new SyncClient({ orgId: ORG, projectId: pid, actorId: lead.userId, deviceId: 'dA', store: new MemoryStore(), transport: new SupabaseTransport(lead.sb) });
    await a.load();
    await a.append('v1.ProjectCreated', { name: 'R', sourceLanguoidId: 'eng' });
    await a.append('v1.MemberAdded', { profileId: lead.userId, role: 'owner' });
    const good = new TextEncoder().encode('good bytes');
    const goodHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', good))).map((b) => b.toString(16).padStart(2, '0')).join('');
    const badName = 'b'.repeat(64);
    await a.append('v1.RecordingAdded', { recordingId: 'r1', unitId: 'u1', laneId: 'L1', kind: 'target', cards: [{ hash: goodHash, durationMs: 10, format: 'wav' }, { hash: badName, durationMs: 10, format: 'wav' }] });
    await a.sync();
    expect((await lead.sb.storage.from('blobs').upload(`${ORG}/${pid}/${goodHash}.wav`, good, { upsert: true, contentType: 'audio/wav' })).error).toBeNull();
    expect((await lead.sb.storage.from('blobs').upload(`${ORG}/${pid}/${badName}.wav`, new TextEncoder().encode('garbage'), { upsert: true, contentType: 'audio/wav' })).error).toBeNull();
    await a.sync();
    expect(isStored(a.getState(), badName)).toBe(true); // the trigger trusts the name

    const service = createClient(URL, SERVICE, { auth: { persistSession: false } });
    const report = await runBlobReconciler(service, { verify: true });
    expect(report.invalidated).toBeGreaterThanOrEqual(1);

    await a.sync();
    expect(isStored(a.getState(), goodHash)).toBe(true);
    expect(isStored(a.getState(), badName)).toBe(false);
    expect(deriveUploadWork(a.getState(), new Set([goodHash, badName])).map((r) => r.hash)).toEqual([badName]);
    expect((await lead.sb.storage.from('blobs').download(`${ORG}/${pid}/${badName}.wav`)).error).not.toBeNull();
  });
});
