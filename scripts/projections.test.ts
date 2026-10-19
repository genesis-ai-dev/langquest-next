import type { SupabaseClient } from '@supabase/supabase-js';
import { deliverPushes, isLarge, LARGE } from '../server/projectionWorker';

describe('which languages a local stack\'s Edge pass leaves out (decisions.md 103, 141)', () => {
  it('a language is large from a 10 MB snapshot, or 25,000 events past it', () => {
    // Why: a run of the Edge Function gets 256 MB and 2 s of CPU. From
    // 15:30 on 2026-10-14 the pass died on the biggest imported languages
    // (Santhali: 225,000 events, a 61 MB state, about 850 MB to fold), and
    // every language after them waited for its Inbox rows and snapshot.
    expect(LARGE).toEqual({ chars: 10_000_000, events: 25_000 });
    expect(isLarge({ chars: 9_999_999, head: 30_000, snapshotSeq: 29_000 })).toBe(false);
    expect(isLarge({ chars: 10_000_000, head: 30_000, snapshotSeq: 30_000 })).toBe(true);
  });

  it('counts the whole log when there is no snapshot, and only the tail when there is', () => {
    // Why: a first fold reads the whole log; a later one resumes from the
    // snapshot, so a big import into a small language is large until folded.
    expect(isLarge({ chars: 0, head: 25_000, snapshotSeq: 0 })).toBe(true);
    expect(isLarge({ chars: 0, head: 24_999, snapshotSeq: 0 })).toBe(false);
    expect(isLarge({ chars: 2_000_000, head: 80_000, snapshotSeq: 50_000 })).toBe(true);
    expect(isLarge({ chars: 2_000_000, head: 80_000, snapshotSeq: 70_000 })).toBe(false);
  });
});

describe('push delivery (performance-audit-app.md V9)', () => {
  it('looks up every claimed person\'s phones in one query', async () => {
    // Why: the job runs every minute and used one query per claimed row.
    const queries: string[] = [];
    const sent: string[] = [];
    const ok = { data: [], error: null };
    const table = (name: string) => {
      const q: Record<string, unknown> = {};
      const chain = (result: unknown) => new Proxy(q, {
        get: (_t, prop) => prop === 'then' ? (resolve: (v: unknown) => void) => resolve(result) : () => chain(result)
      });
      if (name === 'push_tokens') {
        return { select: () => ({ in: (_c: string, ids: string[]) => {
          queries.push(`tokens for ${ids.sort().join(',')}`);
          return Promise.resolve({ data: [
            { profile_id: 'a', token: 't1' }, { profile_id: 'a', token: 't2' }, { profile_id: 'b', token: 't3' }
          ], error: null });
        } }) };
      }
      return chain(ok);
    };
    const service = {
      rpc: async () => ({ data: [{ id: 'n1', profile_id: 'a' }, { id: 'n2', profile_id: 'b' }, { id: 'n3', profile_id: 'a' }, { id: 'n4', profile_id: 'c' }], error: null }),
      from: table
    } as unknown as SupabaseClient;
    const fetcher = (async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body).to);
      return { ok: true, json: async () => ({ data: { status: 'ok', id: 'ticket' } }) };
    }) as unknown as typeof fetch;
    await deliverPushes(service, fetcher);
    expect(queries).toEqual(['tokens for a,b,c']);
    // n1 and n3 (person a) go to both of a's phones, n2 to b's; n4 has no phone yet.
    expect(sent.sort()).toEqual(['t1', 't1', 't2', 't2', 't3']);
  });
});
