import type { Ctx } from './ctx';

/**
 * The install file line on Sync's Ready for offline card (docs/nearby-sync-plan.md 14.4,
 * "Reminded while online"; InstallFileReminder.android.tsx). Only an Android phone lets someone
 * in, so this is a plain stub, as NearbyRow is: the web and iPhone builds carry none of it.
 */
export function InstallFileReminder(_props: { ctx: Ctx }) {
  return null;
}
