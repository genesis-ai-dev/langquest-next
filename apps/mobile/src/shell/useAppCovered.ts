const NONE = { covered: false, worn: false } as const;

/**
 * Whether something stands in front of the app, for a screen that must not run behind it
 * (docs/nearby-sync-plan.md 5.8): `covered` while it is in front now, `worn` while this phone
 * has one at all. On an iPhone and the web nothing ever does, so both are false and these
 * builds carry no code of it (decisions.md 171, apps/mobile/test/disguiseIphone.test.ts).
 * Android's file (useAppCovered.android.ts) reads the phone's own.
 */
export function useAppCovered(): { covered: boolean; worn: boolean } {
  return NONE;
}
