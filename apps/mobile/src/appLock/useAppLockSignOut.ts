import { useEffect, useRef } from 'react';
import { leaveThisDevice } from '../account/accountAuth';
import { useUnsent } from '../account/useUnsent';
import type { Ctx } from '../shell/ctx';
import { HANDS_OVER } from '../sync/handOver';
import { setSignOutForLock } from './appLock';

/**
 * The app lock's Forgot? (decisions.md 253) leaves as Sign Out does, from the
 * open organization: unsent work is handed over and sent as them later
 * (decision 60), and the sign-in stays locked for their return (168).
 */
export function useAppLockSignOut(ctx: Ctx): void {
  const waiting = useUnsent(ctx);
  const latest = useRef({ ctx, handsOver: false });
  latest.current = { ctx, handsOver: HANDS_OVER && waiting.length > 0 };
  useEffect(() => {
    setSignOutForLock(() => {
      const { ctx: now, handsOver } = latest.current;
      const { orgId, languageId, blobs } = now.language;
      return leaveThisDevice(now.session.actorId, handsOver, { orgId, languageId, unsent: blobs.unsent });
    });
    return () => setSignOutForLock(null);
  }, []);
}
