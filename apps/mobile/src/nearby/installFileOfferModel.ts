import type { ApkCheck, ApkGet, ApkStep, KeepResult } from './carriedApkModel';

/*
 * What Download the install file offers to do (docs/nearby-sync-plan.md 14.4), as pure rules.
 * Only Android's files import this (GetInstallFileScreen.android.tsx), so the web bundle, which
 * never opens that screen, carries none of it.
 */

/**
 * What Download the install file offers to do, which decides its buttons, by the step (`apkStep`):
 * - `get`, `choose`: no file in hand for these versions (never got, the copy gone, or one for
 *   other versions): the step's own buttons.
 * - `newer`: in hand, and while it can be downloaded (`get` ready) a newer file is known to be
 *   ready (`behind`: `keptBehind` or `keptFromOlderBuild`): Download in the browser is the main
 *   button again.
 * - `again`: in hand, but the file handed over or chosen on this visit did not check or could not
 *   be kept (`checkFailed`): choose it again, or download it again.
 * - null: in hand and nothing newer known, a file just handed over or chosen included, so the
 *   screen says the file is ready and offers no download (Carl, 2026-11-24). Download the newest
 *   file, there since 2026-11-20 whatever the phone held, said LangQuest lacked the newest file
 *   just after the browser handed it over. Also null until the step is read.
 */
export type ApkOffer = 'get' | 'choose' | 'newer' | 'again' | null;

export function apkOffer(o: { step: ApkStep | null; get: ApkGet; behind: boolean; checked: { result: ApkCheck; keep?: KeepResult } | null }): ApkOffer {
  if (o.step === null) return null;
  if (o.step !== 'done') return o.step;
  if (o.behind && o.get === 'ready') return 'newer';
  return o.checked && checkFailed(o.checked) ? 'again' : null;
}

/**
 * A file handed over or chosen that is not the one this phone needs (another version), or whose
 * copy could not be kept: not this app's own, no room, unreadable, or failed otherwise. A phone
 * that keeps no copy (`needs-android`, `needs-update`) has the file it needs, so that is no failure.
 */
export function checkFailed(c: { result: ApkCheck; keep?: KeepResult }): boolean {
  return c.result === 'other' || c.keep === 'not-ours' || c.keep === 'no-space' || c.keep === 'unreadable' || c.keep === 'failed';
}
