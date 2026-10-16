import type { Ctx } from '../shell/ctx';
import { useAccountActions } from './useAccount';
import { unsentWork } from './model';
import { useSyncStatus } from '../sync/useSyncStatus';

/** What this session could still deliver from this phone; sign-out and deletion wait for it. */
export function useUnsent(ctx: Ctx): string[] {
  const status = useSyncStatus();
  const accountQueued = useAccountActions(ctx.session.actorId).filter((a) => a.status === 'queued').length;
  return unsentWork({
    refused: ctx.language.refused, pending: status.pending, orgPending: status.orgPending,
    uploads: status.pendingUp, accountQueued
  });
}
