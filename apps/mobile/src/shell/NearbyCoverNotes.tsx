import type { NearbyActions, NearbyView } from '../nearby/nearbyRunModel';

/**
 * Share nearby's words for a phone that wears a cover: the line and "Start sharing" before any
 * radio runs, the one warning before Android's questions, and why sharing stopped (docs/
 * nearby-sync-plan.md 5.8, Carl's answer 15). On an iPhone and the web no phone wears one, so
 * this draws nothing and these builds carry none of it (decisions.md 171, disguiseIphone.test.ts).
 * Android's file (NearbyCoverNotes.android.tsx) has the words, in src/disguise/i18n.
 */
export function NearbyCoverNotes(_props: { view: NearbyView; actions: NearbyActions; stopLine: string | null }) {
  return null;
}
