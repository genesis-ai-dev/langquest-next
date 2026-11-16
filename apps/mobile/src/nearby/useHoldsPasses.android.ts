import { useEffect, useState } from 'react';
import { noteExpected } from '../diagnostics/report';
import { chainPeople, readPasses } from './nearbyPhone.android';

/**
 * Does this person hold a join pass, or, with no one signed in (a Forgot password link names its
 * account only once used), anyone on this phone (docs/nearby-sync-plan.md 14.1, 1; 14.3)?
 */
export function useHoldsPasses(actorId: string | null): boolean {
  const [holds, setHolds] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      const people = actorId ? [actorId] : await chainPeople();
      for (const p of people) if ((await readPasses(p)).length > 0) return true;
      return false;
    })().then((h) => { if (live) setHolds(h); }, (e: unknown) => noteExpected('passes held', e));
    return () => { live = false; };
  }, [actorId]);
  return holds;
}
