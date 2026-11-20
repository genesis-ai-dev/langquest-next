import type { Ctx } from '../shell/ctx';
import { LET_IN_START, type LetInRole, type LetInState, type LetInWhyNot } from './letInModel';
import type { LetInPermit } from './letInPermitModel';

/** Let someone in as its screen takes it (docs/nearby-sync-plan.md 14.1, 3): plain data and the actions. */
export interface LetInHandle {
  whyNot: LetInWhyNot | null;
  roles: LetInRole[];
  state: LetInState;
  /** The QR code's text while it can still be used, else null. */
  code: string | null;
  secondsLeft: number;
  /** This phone wears a cover: the new phone will not, which only this phone's screen says. */
  worn: boolean;
  /** While the nearby permissions are missing, how this screen gets them (`letInPermit`); else null. */
  permit: LetInPermit | null;
  actions: { choose(roleId: string): void; show(): void; answer(yes: boolean): void; newCode(): void; askPermissions(): void; openSettings(): void };
}

const NOTHING = (): void => undefined;
const NOT_HERE: LetInHandle = {
  whyNot: 'not-in-build', roles: [], state: LET_IN_START, code: null, secondsLeft: 0, worn: false, permit: null,
  actions: { choose: NOTHING, show: NOTHING, answer: NOTHING, newCode: NOTHING, askPermissions: NOTHING, openSettings: NOTHING }
};

/**
 * Let someone in (docs/nearby-sync-plan.md 14.1, 3). Only an Android phone lets someone in
 * (useLetIn.android.ts): here nothing runs and nothing is offered, so the web and iPhone bundles
 * carry no radio and no nearby entry.
 */
export function useLetIn(_ctx: Ctx): LetInHandle {
  return NOT_HERE;
}

/** Whether Share nearby offers Let someone in, or why not. Never here. */
export function useLetInOffered(_ctx: Ctx): LetInWhyNot | null {
  return 'not-in-build';
}
