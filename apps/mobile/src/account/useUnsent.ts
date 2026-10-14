import type { Ctx } from '../ctx';
import { useAccountActions } from '../useAccount';
import { unsentWork } from './model';

/** What this session could still deliver from this phone; sign-out and deletion wait for it. */
export function useUnsent(ctx: Ctx): string[] {
  const accountQueued = useAccountActions(ctx.session.actorId).filter((a) => a.status === 'queued').length;
  return unsentWork({
    refused: ctx.language.refused, pending: ctx.language.pending, orgPending: ctx.org.pending,
    uploads: ctx.language.blobs.pendingUp, accountQueued
  });
}
