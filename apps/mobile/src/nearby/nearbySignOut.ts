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
 * - `nearbyMet` goes too, phone-wide: the day this phone last met each teammate on Share nearby
 *   (decision 230 as amended), which says who was together and when.
 * - `nearbyLetIn` goes too, phone-wide: whom this phone let in under each of its passes
 *   (2026-11-24, review item 7), which says who joined the team through it. Its count of a pass
 *   starts again only if the same person signs in again while that pass still holds, and the
 *   server still refuses past the count at first contact (decision 240 as amended).
 *
 * Plain on every build: no nearby entry is imported, and on the web there is
 * nothing to find. It never throws and never holds up the sign-out.
 */
export async function nearbyAfterAuthEvent(event: AuthChangeEvent, before: Pick<Session, 'user'> | null | undefined): Promise<void> {
  if (event !== 'SIGNED_OUT' || !before) return;
  await Promise.all([
    keepFindKeys(before.user.id, null).catch((e: unknown) => noteExpected('nearby sign-out: keys', e)),
    (async () => { await (await getStore()).clearMeta('nearbyPeers:'); })().catch((e: unknown) => noteExpected('nearby sign-out: peers', e)),
    (async () => { await (await getStore()).clearMeta('nearbyMet:'); })().catch((e: unknown) => noteExpected('nearby sign-out: met', e)),
    (async () => { await (await getStore()).clearMeta('nearbyLetIn:'); })().catch((e: unknown) => noteExpected('nearby sign-out: let in', e))
  ]);
}
