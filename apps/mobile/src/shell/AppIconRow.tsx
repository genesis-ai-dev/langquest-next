import type { Ctx } from './ctx';

/**
 * The App icon row of More settings, which only Android has: its phone's
 * disguise (AppIconRow.android.tsx, decisions.md 171). An iPhone build leaves
 * it out with all its code and words, as Apple asked (App Review Guideline
 * 2.5.19); the web has none either.
 */
export function AppIconRow(_props: { ctx: Ctx; last?: boolean }) {
  return null;
}
