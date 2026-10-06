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
    // supabase/migrations/20260914000009_org_partition.sql is what a device
    // pointed at a partition it is not a member of gets back. The server
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
