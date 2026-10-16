import type { SupabaseClient } from '@supabase/supabase-js';
import { deliverPushes } from '../server/projectionWorker';

/**
 * Just enough of supabase-js for deliverPushes: the claim, tokens, receipts,
 * and what it records. `recordFails` stands for a database where
 * record_notification_pushes does not exist yet.
 */
function fakeService(o: { claimed: { id: string; profile_id: string }[]; tokens: Record<string, string[]>; recordFails?: boolean }) {
  const recorded: unknown[] = [];
  const updates: { values: Record<string, unknown>; id: unknown }[] = [];
  const query = (table: string) => {
    const q: Record<string, unknown> = {};
    let filter: { col: string; value: unknown } | null = null;
    let update: Record<string, unknown> | null = null;
    q['select'] = () => q;
    q['upsert'] = async () => ({ error: null });
    q['delete'] = () => q;
    q['update'] = (values: Record<string, unknown>) => { update = values; return q; };
    q['lt'] = () => q;
    // Every claimed person's phones in one query (deliverPushes).
    q['in'] = async (col: string, values: unknown[]) => {
      if (table === 'push_tokens' && col === 'profile_id') {
        return { data: values.flatMap((p) => (o.tokens[String(p)] ?? []).map((token) => ({ token, profile_id: p }))), error: null };
      }
      return { data: [], error: null };
    };
    q['limit'] = async () => ({ data: [], error: null });
    q['eq'] = async (col: string, value: unknown) => {
      filter = { col, value };
      if (update) updates.push({ values: update, id: value });
      if (table === 'push_tokens' && filter.col === 'profile_id') return { data: (o.tokens[String(value)] ?? []).map((token) => ({ token })), error: null };
      return { data: null, error: null };
    };
    return q;
  };
  const service = {
    from: query,
    rpc: async (name: string, args: { p_results?: unknown }) => {
      if (name === 'claim_notification_pushes') return { data: o.claimed, error: null };
      if (name === 'record_notification_pushes') {
        if (o.recordFails) return { data: null, error: { message: 'Could not find the function', code: 'PGRST202' } };
        recorded.push(...(args.p_results as unknown[]));
        return { data: 1, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    }
  } as unknown as SupabaseClient;
  return { service, recorded, updates };
}

describe('push delivery (decisions.md 68) leaves what support needs (diag.inbox_health, diag.jobs)', () => {
  it('records each row as pushed or with why not, and one phone not answering does not stop the pass', async () => {
    const { service, recorded } = fakeService({
      claimed: [{ id: 'n1', profile_id: 'a' }, { id: 'n2', profile_id: 'b' }, { id: 'n3', profile_id: 'c' }, { id: 'n4', profile_id: 'gone' }],
      tokens: { a: ['ta'], b: ['tb'], c: ['tc'] }
    });
    const counts = await deliverPushes(service, async (_url, init) => {
      const to = JSON.parse(String(init?.body)).to;
      if (to === 'tb') throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
      if (to === 'tc') return new Response('busy', { status: 503 });
      return Response.json({ data: { status: 'ok', id: `ticket-${to}` } });
    });
    expect(recorded).toEqual([
      { id: 'n1', error: null }, { id: 'n2', error: 'timeout' }, { id: 'n3', error: 'http_5xx' }, { id: 'n4', error: 'no_token' }
    ]);
    expect(counts).toMatchObject({ claimed: 4, sent: 1, failed: 2, noToken: 1, failTimeout: 1, failHttp5xx: 1, receiptsError: 0 });
  });

  it('marks what went out as before when the database has no record_notification_pushes yet', async () => {
    const { service, updates } = fakeService({ claimed: [{ id: 'n1', profile_id: 'a' }, { id: 'n2', profile_id: 'b' }], tokens: { a: ['ta'], b: ['tb'] }, recordFails: true });
    await deliverPushes(service, async (_url, init) => {
      const to = JSON.parse(String(init?.body)).to;
      return to === 'ta' ? Response.json({ data: { status: 'ok', id: 't1' } }) : new Response('no', { status: 400 });
    });
    expect(updates).toEqual([{ values: { pushed_at: expect.any(String), push_lease_until: null }, id: 'n1' }]);
  });
});
