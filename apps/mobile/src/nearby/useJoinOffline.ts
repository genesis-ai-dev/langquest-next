import type { JoinStage } from './joinOfflineModel';

/** The progress screen's state and actions (docs/nearby-sync-plan.md 14.1, 3 and 4). */
export interface JoinOfflineHandle {
  stage: JoinStage;
  /** The two pictures to compare with the inviter's phone, once asked. */
  pictures: [number, number] | null;
  /** The code was scanned over two minutes ago: the inviter's phone has likely made it useless. */
  stale: boolean;
  inBuild: boolean;
  actions: { join(name: string): void; again(): void; look(): void; stopLooking(): void; openSettings(): Promise<void> };
}

const NOTHING = (): void => undefined;
const NOT_HERE: JoinOfflineHandle = {
  stage: { t: 'not-in-build' }, pictures: null, stale: false, inBuild: false,
  actions: { join: NOTHING, again: NOTHING, look: NOTHING, stopLooking: NOTHING, openSettings: async () => undefined }
};

/**
 * Joining offline (docs/nearby-sync-plan.md 14.1). Only an Android phone can, because an iPhone
 * cannot install an app offline and the web shares nothing nearby (useJoinOffline.android.ts).
 */
export function useJoinOffline(): JoinOfflineHandle {
  return NOT_HERE;
}
