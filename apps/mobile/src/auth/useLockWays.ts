import { useCallback, useEffect, useState } from 'react';
import type { Wrap } from './lockModel';
import { noteExpected } from '../diagnostics/report';
import { LOCKS_ON_SIGN_OUT, lockPictures, lockWays, onLocksChanged } from '../server/lock';

/**
 * What this person could sign back in with on this phone after signing out
 * (decisions.md 168), and the picture they chose: null while it is read,
 * and never anything on the web, which forgets everything instead.
 */
export function useLockWays(actorId: string): { ways: Wrap['kind'][] | null; picture: number | null; taken: number[] } {
  const [state, setState] = useState<{ ways: Wrap['kind'][] | null; picture: number | null; taken: number[] }>(
    { ways: LOCKS_ON_SIGN_OUT ? null : [], picture: null, taken: [] });
  const read = useCallback(() => {
    if (!LOCKS_ON_SIGN_OUT) return () => {};
    let active = true;
    Promise.all([lockWays(actorId), lockPictures(actorId)]).then(
      ([ways, p]) => { if (active) setState({ ways, picture: p.mine, taken: p.taken }); },
      (e: unknown) => { noteExpected('lock ways', e); if (active) setState({ ways: [], picture: null, taken: [] }); });
    return () => { active = false; };
  }, [actorId]);
  useEffect(() => {
    let stop = read();
    const off = onLocksChanged(() => { stop(); stop = read(); });
    return () => { stop(); off(); };
  }, [read]);
  return state;
}
