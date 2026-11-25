import { startingCopyHeldIn } from '@langquest-next/sync';
import * as Updates from 'expo-updates';
import { noteExpected } from '../diagnostics/report';
import { readLocalPerson } from '../server/localPerson';
import { membershipOf } from '../session/localPersonModel';
import { getStore } from '../storage/store';
import { copyStreamsOf, updatesLookByThemselves } from './updatesHeldModel';

/**
 * Does this phone hold a teammate's starting copy the server has not replaced yet (2026-11-24,
 * review item 26)? Only a person let in offline can, on Android. While one is held the app looks
 * for no over-the-air update (UpdateBanner.tsx, useFirstLaunchUpdate.ts), since a build with
 * another reducer would drop the copy at its next start. A phone that cannot tell says no, as
 * before this rule, so an update is never held by a read that failed.
 */
export async function startingCopyHere(): Promise<boolean> {
  try {
    const streams = copyStreamsOf(membershipOf(await readLocalPerson()));
    if (streams.length === 0) return false;
    const store = await getStore();
    for (const s of streams) if (await startingCopyHeldIn(store, s.orgId, s.streamId)) return true;
    return false;
  } catch (e) {
    noteExpected('updates held', e);
    return false;
  }
}

/**
 * Look for an over-the-air update and download it, unless a teammate's starting copy is held
 * (`startingCopyHere`): on coming back to the front (UpdateBanner.tsx) and, once a store build's
 * `checkAutomatically` is `NEVER`, at each start (`useUpdateAtStart`), which expo-updates does by
 * itself until then (`updatesLookByThemselves`, 2026-11-24). An update downloaded still takes
 * effect at the next start, as before.
 */
export async function lookForUpdate(): Promise<void> {
  if (!Updates.isEnabled) return;
  if (await startingCopyHere()) return;
  const result = await Updates.checkForUpdateAsync();
  if (result.isAvailable) await Updates.fetchUpdateAsync();
}

/**
 * The look at each start (`useUpdateAtStart`), only where expo-updates does not look by itself: a
 * build whose `checkAutomatically` is `NEVER` (`updatesLookByThemselves`, 2026-11-24). Today's
 * store builds say `ON_LOAD`, so this looks at nothing until a store build carries `NEVER`.
 */
export async function lookAtStart(): Promise<void> {
  if (!Updates.isEnabled || Updates.isEmergencyLaunch || updatesLookByThemselves(Updates.checkAutomatically)) return;
  await lookForUpdate();
}
