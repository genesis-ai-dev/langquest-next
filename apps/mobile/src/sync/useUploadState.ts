import type { Ctx } from '../shell/ctx';
import { isOffline, waitingCounts, type WaitingCounts } from './uploadsModel';
import { useSyncStatus } from './useSyncStatus';
import { useWaitingElsewhere } from './useWaitingElsewhere';

/** What waits to upload on this device, whether it is offline, and whether a file is going up this moment (decisions.md 166). */
export function useUploadState(ctx: Ctx): { counts: WaitingCounts; offline: boolean; moving: boolean } {
  const status = useSyncStatus();
  const counts = waitingCounts(status, useWaitingElsewhere(ctx));
  const offline = isOffline(ctx.language.online);
  return { counts, offline, moving: !offline && status.uploading.size > 0 };
}
