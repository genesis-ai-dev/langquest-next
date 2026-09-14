import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { deriveTakeStatus } from '@langquest-next/core';
import { MemoryStore } from '../src/memoryStore';
import { SupabaseTransport } from '../src/supabaseTransport';
import { SyncClient } from '../src/syncClient';

/**
 * Runs against the local Supabase started by `npm run db:start`. Skipped when
 * it is not reachable so `npm test` stays green without Docker.
 */
const URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321';
const ANON = process.env['SUPABASE_ANON_KEY'] ?? '';

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
      orgId: 'org1',
      projectId,
      actorId: lead.userId,
      deviceId: 'dA',
      store: new MemoryStore(),
      transport: new SupabaseTransport(lead.sb)
    });
    const b = new SyncClient({
      orgId: 'org1',
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
});
