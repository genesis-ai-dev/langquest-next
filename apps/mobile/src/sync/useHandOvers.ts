// A shared phone's hand-overs, for screens to follow (sync/handOver.ts).
import { SyncScheduler } from '@langquest-next/sync';
import { useEffect } from 'react';
import { onWake } from './wake';
import { HANDS_OVER, added, sendAll } from './handOver';

/**
 * Runs for the whole app, signed in or not: sends what people signed out
 * of this phone left unsent, as them. Tries when someone hands over, when
 * the app comes back to the screen, and on a slow poll that backs off while
 * the phone is offline.
 */
export function useHandOvers(signedInAs: string | null | undefined): void {
  useEffect(() => {
    if (!HANDS_OVER || signedInAs === undefined) return;
    const scheduler = new SyncScheduler({ run: () => sendAll(signedInAs), pollMs: 10 * 60_000 });
    const nudge = () => scheduler.nudge();
    added.add(nudge);
    const unwake = onWake(() => scheduler.wake());
    scheduler.start();
    return () => { added.delete(nudge); unwake(); scheduler.stop(); };
  }, [signedInAs]);
}
