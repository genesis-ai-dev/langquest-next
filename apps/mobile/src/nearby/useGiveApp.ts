import type { CannotGive, KeptFile } from './carriedApkModel';
import type { Giving, GiveStage } from './giveAppModel';
import type { LetInWhyNot } from './letInModel';

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
  /** Send with Quick Share is offered: a kept file, a build that can share it, and no group running (`shareOffered`). */
  canShare: boolean;
  /** Android's share sheet would not open, for a reason other than a missing file. */
  shareFailed: boolean;
  /**
   * Let them in hands the serving group to Let someone in rather than stopping it (`handsOver`), so
   * the new phone's LangQuest finds this phone by itself and the screen says so.
   */
  handsOver: boolean;
  /**
   * `share`: Android's share sheet with the kept file, for Quick Share. `letIn`: Let them in's part
   * here, before the screen opens Let someone in: hands the group over, or stops it.
   */
  actions: { start(): void; next(): void; back(): void; stop(): void; openSettings(): void; share(): void; letIn(): void };
}

const NOTHING = (): void => undefined;
const NOT_HERE: GiveAppHandle = {
  stage: { t: 'none' }, giving: null, kept: null, canGive: false, cannotGive: null, worn: false, canShare: false, shareFailed: false, handsOver: false,
  actions: { start: NOTHING, next: NOTHING, back: NOTHING, stop: NOTHING, openSettings: NOTHING, share: NOTHING, letIn: NOTHING }
};

/**
 * Only an Android phone gives the app (useGiveApp.android.ts): the web and iPhone bundles carry none
 * of it. `letIn`: whether this phone can let people in (`useLetInOffered`), for the hand-over.
 */
export function useGiveApp(_letIn: LetInWhyNot | null): GiveAppHandle {
  return NOT_HERE;
}
