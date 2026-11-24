/**
 * Whether this phone wears a cover now, read at once rather than drawn (docs/nearby-sync-plan.md
 * 15.6): for code that must decide in the moment a cover goes on, before any screen draws again.
 * On an iPhone and the web nothing ever does, so these builds carry no code of it (decisions.md
 * 171); Android's file (appCovered.android.ts) reads the phone's own.
 */
export function wornNow(): boolean {
  return false;
}
