import type { OrgState } from '@langquest-next/core';
import type { SyncClient } from '@langquest-next/sync';
import type { NearbyLanguage } from '../sync/useLanguage';

/**
 * What a teammate's phone sends a newcomer as a starting copy over an ordinary Share nearby
 * session (docs/nearby-sync-plan.md 14.1, 4). Joining offline is Android only for now (section
 * 7's phase 5, Carl's answer 25), so only Android's file (nearbyCopySource.android.ts) has one;
 * here, on an iPhone, there is none, and a newcomer's copy is finished by an Android teammate or
 * the server.
 */
export function copySourceOf(_o: { actorId: string; language: NearbyLanguage['client']; org: SyncClient<OrgState> | null }): undefined {
  return undefined;
}
