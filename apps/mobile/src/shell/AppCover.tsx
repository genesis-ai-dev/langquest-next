import type { ReactNode } from 'react';

/**
 * What stands in front of the whole app. On an iPhone and the web, nothing:
 * the app as it is. Android's file (AppCover.android.tsx) is its phone's
 * disguise (decisions.md 171), which an iPhone build leaves out with all its
 * code and words, as Apple asked (App Review Guideline 2.5.19).
 */
export function AppCover(props: { children: ReactNode }) {
  return <>{props.children}</>;
}
