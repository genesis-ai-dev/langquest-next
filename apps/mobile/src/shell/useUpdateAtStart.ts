import { useEffect, useRef } from 'react';
import { noteExpected } from '../diagnostics/report';
import { lookAtStart } from './updatesHeld';

/**
 * The look for an over-the-air update at each start, once `ready` (the first launch's own wait is
 * over, useFirstLaunchUpdate.ts), which skips while a teammate's starting copy is held (review
 * item 26, `lookForUpdate`). expo-updates looks by itself while the build's `checkAutomatically`
 * is `ON_LOAD`, as today's store builds are, and then this does nothing; it takes over once a
 * store build carries `NEVER` (2026-11-24, `lookAtStart`, `updatesLookByThemselves`). Called in
 * App, outside the disguise, so a disguised phone looks at its start as it did before.
 */
export function useUpdateAtStart(ready: boolean): void {
  const looked = useRef(false);
  useEffect(() => {
    if (!ready || looked.current) return;
    looked.current = true;
    // Offline or the update server is away: expected, and the banner shows nothing for it (decisions.md 166).
    void lookAtStart().catch((e: unknown) => noteExpected('update check', e));
  }, [ready]);
}
