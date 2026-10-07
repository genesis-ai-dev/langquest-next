import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseTransport } from '../src/supabaseTransport';
import { ClientTooOldError, NotAuthorizedError, OfflineError } from '../src/types';

/** A SupabaseClient whose every rpc() fails the way the real one reports it. */
function failingWith(error: { message: string; code?: string }): SupabaseTransport {
  return new SupabaseTransport({ rpc: async () => ({ data: null, error }) } as unknown as SupabaseClient);
}

describe('SupabaseTransport error classification', () => {
  it('reports a 42501 refusal as not authorized, never as offline', async () => {
    // Why: `raise exception 'not a member' using errcode = '42501'` in
    // supabase/migrations is what a device pointed at a stream it may not
    // read gets back. The server
    // answered, so the device is online; calling it offline strands the user.
    const t = failingWith({ code: '42501', message: 'not a member' });
    await expect(t.pull('org1', 'p1', 0, 500)).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(t.append([])).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(t.snapshotMeta('org1', 'p1', 1)).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it('reports a link failure as offline, in either wording', async () => {
    // Why: RN says "Network request failed", the web fetch says "Failed to
    // fetch"; both mean the request never reached the server.
    await expect(failingWith({ message: 'Network request failed' }).pull('org1', 'p1', 0, 1)).rejects.toBeInstanceOf(OfflineError);
    await expect(failingWith({ message: 'TypeError: Failed to fetch' }).pull('org1', 'p1', 0, 1)).rejects.toBeInstanceOf(OfflineError);
  });

  it('still reports a refused protocol version as too old', async () => {
    await expect(failingWith({ code: 'LQ001', message: 'client too old' }).pull('org1', 'p1', 0, 1)).rejects.toBeInstanceOf(
      ClientTooOldError
    );
  });
});

describe('SupabaseTransport requests', () => {
  it('names the stream p_stream_id and maps stream_id rows back to streamId', async () => {
    // Why: the RPCs take the stream, never a partition or project; a stale
    // parameter name fails every call on a real server.
    const calls: [string, Record<string, unknown>][] = [];
    const row = { id: 'e1', org_id: 'org1', stream_id: 'p1', server_seq: 3, type: 'v1.UnitAdded', actor_id: 'a', device_id: 'd', hlc: 'h', parent_event_id: null, payload: {} };
    const t = new SupabaseTransport({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push([fn, args]);
        return { data: fn === 'pull_events' ? [row] : [], error: null };
      }
    } as unknown as SupabaseClient);
    const [event] = await t.pull('org1', 'p1', 2, 10);
    expect(event).toMatchObject({ id: 'e1', orgId: 'org1', streamId: 'p1', serverSeq: 3 });
    await t.snapshotMeta('org1', 'p1', 1);
    await t.snapshotChunk('org1', 'p1', 1, 3, 0);
    expect(calls.map(([fn, args]) => [fn, args['p_org_id'], args['p_stream_id']])).toEqual([
      ['pull_events', 'org1', 'p1'],
      ['get_snapshot_meta', 'org1', 'p1'],
      ['get_snapshot_chunk', 'org1', 'p1']
    ]);
  });
});
