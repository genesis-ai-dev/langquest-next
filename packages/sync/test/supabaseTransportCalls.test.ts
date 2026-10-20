import { CLIENT_PROTOCOL_VERSION, type AnyEvent } from '@langquest-next/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseTransport } from '../src/supabaseTransport';
import { NotAuthorizedError, OfflineError } from '../src/types';

type Reply = { data: unknown; error: { message: string; code?: string } | null };

/** A client that records each rpc and answers from `reply`. */
function client(reply: (fn: string) => Reply) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const supabase = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return reply(fn);
    }
  } as unknown as SupabaseClient;
  return { transport: new SupabaseTransport(supabase), calls };
}

const event = { id: 'e1', type: 'v1.UnitAdded', orgId: 'o', streamId: 's', actorId: 'a', deviceId: 'd', hlc: 'h', payload: {}, serverSeq: 7 } as unknown as AnyEvent;

describe('SupabaseTransport calls', () => {
  it('append sends the events without their server seq, with the client protocol version, and maps the verdicts', async () => {
    const { transport, calls } = client(() => ({
      data: [{ id: 'e1', accepted: false, server_seq: null, reason: 'not a member' }, { id: 'e2', accepted: true, server_seq: 4, reason: null }],
      error: null
    }));
    const results = await transport.append([event]);
    expect(calls[0]!.fn).toBe('append_events');
    expect(calls[0]!.args['p_client_version']).toBe(CLIENT_PROTOCOL_VERSION);
    expect(calls[0]!.args['p_events']).toEqual([{ id: 'e1', type: 'v1.UnitAdded', orgId: 'o', streamId: 's', actorId: 'a', deviceId: 'd', hlc: 'h', payload: {} }]);
    expect(results).toEqual([
      { id: 'e1', accepted: false, serverSeq: null, reason: 'not a member' },
      { id: 'e2', accepted: true, serverSeq: 4, reason: null }
    ]);
  });

  it('the server\'s cut: a server without the function answers no head, and rows come back as the phone keeps them', async () => {
    // Why: an app can reach a server from before the cut (decisions.md 147); it must download the whole snapshot, not fail.
    expect(await client(() => ({ data: null, error: { message: 'Could not find the function', code: 'PGRST202' } })).transport.snapshotHead('o', 's', 1, 1)).toBeNull();
    const { transport, calls } = client(() => ({
      data: { server_seq: 9, rows: [['take', 't1', 'u1', 'a', { unitId: 'u1' }]], next: ['u1', 'take', 't1'] }, error: null
    }));
    const page = await transport.snapshotRows('o', 's', 1, 5, ['u1'], { unitId: 'u0', kind: 'file', id: 'h' }, 10);
    expect(calls[0]!.args).toMatchObject({ p_min_seq: 5, p_unit_ids: ['u1'], p_after: ['u0', 'file', 'h'], p_limit: 10 });
    expect(page).toEqual({ serverSeq: 9, rows: [{ kind: 'take', id: 't1', unitId: 'u1', ref: 'a', json: '{"unitId":"u1"}' }], next: { unitId: 'u1', kind: 'take', id: 't1' } });
  });

  it('snapshotMeta is null when the server has none, and the numbers when it has one', async () => {
    expect(await client(() => ({ data: [], error: null })).transport.snapshotMeta('o', 's', 1)).toBeNull();
    expect(await client(() => ({ data: null, error: null })).transport.snapshotMeta('o', 's', 1)).toBeNull();
    const { transport, calls } = client(() => ({ data: [{ server_seq: 9, chunks: 2, bytes: 300 }], error: null }));
    expect(await transport.snapshotMeta('o', 's', 3)).toEqual({ serverSeq: 9, chunks: 2, bytes: 300 });
    expect(calls[0]!.args).toEqual({ p_org_id: 'o', p_stream_id: 's', p_reducer_version: 3 });
  });

  it('snapshotChunk is the text, or null when the snapshot has moved on', async () => {
    expect(await client(() => ({ data: '{"a":', error: null })).transport.snapshotChunk('o', 's', 1, 9, 0)).toBe('{"a":');
    expect(await client(() => ({ data: null, error: null })).transport.snapshotChunk('o', 's', 1, 9, 5)).toBeNull();
  });

  it('pull keeps a parent pointer only when the event has one, and asks with the protocol version', async () => {
    const row = { id: 'e1', org_id: 'o', stream_id: 's', server_seq: 3, type: 'v1.Redacted', actor_id: 'a', device_id: 'd', hlc: 'h', payload: { eventId: 'x' } };
    const { transport, calls } = client(() => ({ data: [{ ...row, parent_event_id: 'p' }, { ...row, id: 'e2', parent_event_id: null }], error: null }));
    const [a, b] = await transport.pull('o', 's', 2, 50);
    expect(a).toMatchObject({ id: 'e1', parentEventId: 'p' });
    expect('parentEventId' in b!).toBe(false);
    expect(calls[0]!.args).toEqual({ p_org_id: 'o', p_stream_id: 's', p_after: 2, p_limit: 50, p_client_version: CLIENT_PROTOCOL_VERSION });
  });

  it('classifies by message when there is no code, and names any other failure by its code', async () => {
    const fail = (message: string, code?: string) =>
      client(() => ({ data: null, error: { message, ...(code ? { code } : {}) } })).transport.pull('o', 's', 0, 1);
    await expect(fail('permission denied for function pull_events')).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(fail('service role only')).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(fail('connect ECONNREFUSED 127.0.0.1')).rejects.toBeInstanceOf(OfflineError);
    await expect(fail('request timed out')).rejects.toBeInstanceOf(OfflineError);
    await expect(fail('statement timeout', '57014')).rejects.toThrow('57014: statement timeout');
    await expect(fail('boom')).rejects.toThrow('rpc: boom');
  });
});

describe('SupabaseTransport.watch', () => {
  function realtime() {
    const state: { name?: string; config?: unknown; onBroadcast?: () => void; onStatus?: (s: string) => void; removed: unknown[] } = { removed: [] };
    const channel = {
      on: (_kind: string, filter: { event: string }, cb: () => void) => {
        expect(filter).toEqual({ event: 'appended' });
        state.onBroadcast = cb;
        return channel;
      },
      subscribe: (cb: (s: string) => void) => {
        state.onStatus = cb;
        return channel;
      }
    };
    const supabase = {
      channel: (name: string, config: unknown) => {
        state.name = name;
        state.config = config;
        return channel;
      },
      removeChannel: async (c: unknown) => { state.removed.push(c); }
    } as unknown as SupabaseClient;
    return { transport: new SupabaseTransport(supabase), state, channel };
  }

  it('listens on the stream channel, passes pokes and connection state on, and leaves the channel when stopped', () => {
    const { transport, state, channel } = realtime();
    const seen: (string | boolean)[] = [];
    const stop = transport.watch('o', 's', { onPoke: () => seen.push('poke'), onStatus: (up) => seen.push(up) });
    expect(state.name).toBe('events:o/s');
    // Private: only someone who may read the stream hears its pokes (decisions.md 117).
    expect(state.config).toEqual({ config: { private: true } });
    state.onStatus!('SUBSCRIBED');
    state.onBroadcast!();
    state.onStatus!('CHANNEL_ERROR');
    expect(seen).toEqual([true, 'poke', false]);
    stop();
    expect(state.removed).toEqual([channel]);
  });
});
