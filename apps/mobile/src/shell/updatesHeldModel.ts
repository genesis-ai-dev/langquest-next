import { ORG_STREAM } from '@langquest-next/core';

/**
 * Over-the-air updates are held while this phone holds a teammate's starting copy (2026-11-24,
 * review item 26), as pure rules. A build with another reducer cannot read the copy, which the
 * server's first download has not replaced yet, and offline only a teammate can give it again,
 * so the person could not record, review or read guides until then. The update waits for the
 * first download, which ends the copy. Nothing here reads the phone.
 */

/** The streams a person let in offline may hold a starting copy of: their organization and their language. */
export function copyStreamsOf(m: { orgId: string; languageId: string } | null): { orgId: string; streamId: string }[] {
  return m ? [{ orgId: m.orgId, streamId: ORG_STREAM }, { orgId: m.orgId, streamId: m.languageId }] : [];
}

/**
 * Whether expo-updates looks for an update by itself at each start, by app.json's
 * `checkAutomatically` as the build carries it (`Updates.checkAutomatically`). While it does
 * (`ON_LOAD`, today's store builds), the app's own look at start (`useUpdateAtStart`) would only
 * look twice, so it looks only once a build says `NEVER` (2026-11-24, review item 26). That
 * setting changes both platforms' native fingerprint, so it lands with a store build (decision
 * 155), never in a change that must reach phones by update; until then expo-updates' own look
 * fetches whatever a starting copy says, and only the app's other looks wait.
 */
export function updatesLookByThemselves(checkAutomatically: string | null): boolean {
  return checkAutomatically === 'ON_LOAD' || checkAutomatically === 'WIFI_ONLY';
}
