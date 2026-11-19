import type { CannotGive, KeptFile } from './carriedApkModel';
import type { Giving, GiveStage } from './giveAppModel';

/** Give the app as its screen takes it (docs/nearby-sync-plan.md 14.5). */
export interface GiveAppHandle {
  stage: GiveStage;
  giving: Giving | null;
  kept: KeptFile | null | undefined;
  /** This phone can give the app: Android 10 or later, with a build whose native module can. */
  canGive: boolean;
  /** Why it cannot, where it cannot, so the screen says what would mend it (`cannotGive`). */
  cannotGive: CannotGive | null;
  /** This phone wears a cover (a disguise): the screen shows its note, and asks for no permission. */
  worn: boolean;
  actions: { start(): void; next(): void; back(): void; stop(): void; openSettings(): void };
}

const NOTHING = (): void => undefined;
const NOT_HERE: GiveAppHandle = {
  stage: { t: 'none' }, giving: null, kept: null, canGive: false, cannotGive: null, worn: false,
  actions: { start: NOTHING, next: NOTHING, back: NOTHING, stop: NOTHING, openSettings: NOTHING }
};

/** Only an Android phone gives the app (useGiveApp.android.ts): the web and iPhone bundles carry none of it. */
export function useGiveApp(): GiveAppHandle {
  return NOT_HERE;
}
