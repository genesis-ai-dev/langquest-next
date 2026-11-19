import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseTransport } from '../src/supabaseTransport';
import { ClientTooOldError, NotAuthorizedError, OfflineError, ServerError, UnrenewedError } from '../src/types';

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

  it("reads Safari's wording for a lost connection as offline, not as a server that did not answer", async () => {
    // Why: supabase-js passes Safari's fetch failure on as "TypeError: Load
    // failed" with no code and status 0. Read as a ServerError, an iPhone or
    // Mac browser losing signal for a moment was logged as `pull:-:ServerError`
    // and its sync stopped with an error (field snapshot, 2026-11-03).
    await expect(failingWith({ message: 'TypeError: Load failed', code: '' }).pull('org1', 'p1', 0, 1)).rejects.toBeInstanceOf(OfflineError);
    await expect(failingWith({ message: 'TypeError: Load failed', code: '' }).append([])).rejects.toBeInstanceOf(OfflineError);
    // Words that only contain it are not it.
    expect(await failingWith({ message: 'Download failed (404)', code: '' }).pull('org1', 'p1', 0, 1).catch((e: unknown) => e)).toBeInstanceOf(ServerError);
  });

  it('a sign-in that could not be renewed is offline, and says which kind', async () => {
    // Why: sessionSafeFetch.ts stops a request that would go out as no one
    // with a network-failure text, so it stays queued; diagnostics must still
    // tell it from no signal (both of its texts).
    const held = failingWith({ message: 'TypeError: Network request failed: the sign-in could not be renewed yet', code: '' });
    const err = await held.pull('org1', 'p1', 0, 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnrenewedError);
    expect(err).toBeInstanceOf(OfflineError);
    await expect(failingWith({ message: 'Network request failed: sign-in renewal answered 429' }).append([])).rejects.toBeInstanceOf(UnrenewedError);
  });

  it('an access token that expired in an idle tab is a sign-in not yet renewed, not a server error', async () => {
    // Why: a web tab that slept woke with its old token, and PostgREST
    // answered PGRST303 (JWT expired). Read as a ServerError, the language's
    // sync stopped with an error although the next request would have worked.
    const err = await failingWith({ code: 'PGRST303', message: 'JWT expired' }).pull('org1', 'p1', 0, 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnrenewedError);
    expect(err).toBeInstanceOf(OfflineError);
    await expect(failingWith({ code: 'PGRST303', message: 'JWT expired' }).append([])).rejects.toBeInstanceOf(UnrenewedError);
  });

  it('an expired access token is renewed and the request sent once more, so the pull succeeds', async () => {
    // Why: LAN-243. A web tab idle for half an hour woke with an expired
    // token; the pull failed with PGRST303 although one renewal would have
    // let it through (the next sync, ten minutes later, worked).
    const calls: string[] = [];
    let renewals = 0;
    let token = 'old';
    const client = {
      auth: { refreshSession: async () => { renewals += 1; token = 'new'; return { data: {}, error: null }; } },
      rpc: async () => {
        calls.push(token);
        return token === 'old' ? { data: null, error: { code: 'PGRST303', message: 'JWT expired' } } : { data: [], error: null };
      }
    } as unknown as SupabaseClient;
    expect(await new SupabaseTransport(client).pull('org1', 'p1', 0, 1)).toEqual([]);
    expect(renewals).toBe(1);
    expect(calls).toEqual(['old', 'new']);
  });

  it('an expired token that renewal does not fix is tried once more only, then offline-unrenewed', async () => {
    let rpcs = 0;
    const client = {
      auth: { refreshSession: async () => { throw new Error('Network request failed'); } },
      rpc: async () => { rpcs += 1; return { data: null, error: { code: 'PGRST303', message: 'JWT expired' } }; }
    } as unknown as SupabaseClient;
    await expect(new SupabaseTransport(client).pull('org1', 'p1', 0, 1)).rejects.toBeInstanceOf(UnrenewedError);
    expect(rpcs).toBe(2);
  });

  it('any other failure keeps the server code, or the HTTP status', async () => {
    const timeout = await failingWith({ code: '57014', message: 'canceling statement' }).pull('org1', 'p1', 0, 1).catch((e: unknown) => e);
    expect(timeout).toBeInstanceOf(ServerError);
    expect((timeout as ServerError).code).toBe('57014');
    const gateway = new SupabaseTransport({ rpc: async () => ({ data: null, error: { message: 'Bad gateway', code: '' }, status: 502 }) } as unknown as SupabaseClient);
    expect(((await gateway.pull('org1', 'p1', 0, 1).catch((e: unknown) => e)) as ServerError).code).toBe('http502');
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
