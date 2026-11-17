import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { noteExpected } from '../diagnostics/report';
import { keepFindKeys } from '../server/lock';
import { getStore } from '../storage/store';

/**
 * What nearby sync leaves behind at any sign-out (docs/nearby-sync-plan.md 5.12 "The store",
 * decisions.md 168 as amended). App calls this from supabase-js's listener with whoever was
 * signed in before.
 *
 * - Their discovery keys never stay in the clear. A sign-out they chose sealed them already
 *   (lock.ts), so this finds nothing; one the server forced sealed nothing, and sealing now
 *   would be pointless, since their lock key is still in the clear on that path, so the keys
 *   go and their next certificate answer brings them back.
 * - `nearbyPeers` goes, phone-wide: it says who is on the team, and a taken phone gives it up.
 *   `nearbyToday` joins it here once something writes it.
 *
 * Plain on every build: no nearby entry is imported, and elsewhere than Android there is
 * nothing to find. It never throws and never holds up the sign-out.
 */
export async function nearbyAfterAuthEvent(event: AuthChangeEvent, before: Pick<Session, 'user'> | null | undefined): Promise<void> {
  if (event !== 'SIGNED_OUT' || !before) return;
  await Promise.all([
    keepFindKeys(before.user.id, null).catch((e: unknown) => noteExpected('nearby sign-out: keys', e)),
    (async () => { await (await getStore()).clearMeta('nearbyPeers:'); })().catch((e: unknown) => noteExpected('nearby sign-out: peers', e))
  ]);
}
