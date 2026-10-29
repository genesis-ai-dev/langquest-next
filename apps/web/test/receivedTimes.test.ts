import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RECEIPTS_PER_ASK, receivedTimes } from '../worker/agent/store';

/**
 * How the Worker asks `received_times` (decisions.md 188): each kind of key
 * in its own list (v2's stamps too), a bounded number at a time, and the database's
 * timestamps read back as the API's ISO times.
 */

function service(answer: (args: Record<string, unknown>) => { key: string; received_at: string }[]) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: answer(args), error: null };
    }
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe('receivedTimes', () => {
  it('sends takes, event ids and entity keys in their own lists, and answers with ISO times', async () => {
    const { client, calls } = service(() => [
      { key: 'submitted:t1', received_at: '2026-10-29T15:42:56.123456+00:00' },
      { key: 'review:r1', received_at: '2026-10-28T01:02:03+00:00' }
    ]);
    const got = await receivedTimes(client, 'org1', 'L1', ['submitted:t1', 'review:r1', 'request:q1', 'event:e1', 'v2:review:r1', 'v2:file:h1']);
    expect(calls).toEqual([{
      name: 'received_times',
      args: { p_org: 'org1', p_stream: 'L1', p_takes: ['t1'], p_events: ['e1'], p_v2: ['review:r1', 'file:h1'], p_entities: ['review:r1', 'request:q1'] }
    }]);
    expect([...got]).toEqual([['submitted:t1', '2026-10-29T15:42:56.123Z'], ['review:r1', '2026-10-28T01:02:03.000Z']]);
  });

  it('asks a long list a page at a time', async () => {
    const { client, calls } = service((args) => (args['p_takes'] as string[]).map((t) => ({ key: `submitted:${t}`, received_at: '2026-10-29T00:00:00Z' })));
    const keys = Array.from({ length: RECEIPTS_PER_ASK * 2 + 1 }, (_, i) => `submitted:t${i}`);
    const got = await receivedTimes(client, 'org1', 'L1', keys);
    expect(calls.map((c) => (c.args['p_takes'] as string[]).length)).toEqual([RECEIPTS_PER_ASK, RECEIPTS_PER_ASK, 1]);
    expect(got.size).toBe(keys.length);
  });

  it('fails loudly when the database does', async () => {
    const client = { rpc: async () => ({ data: null, error: { message: 'down' } }) } as unknown as SupabaseClient;
    await expect(receivedTimes(client, 'org1', 'L1', ['review:r1'])).rejects.toThrow('received_times: down');
  });
});
