import { useLibraryUpload } from '../library/useLibraryFollow';
import { useLeaveGuard } from '../web/useLeaveGuard';
import { useSyncStatus } from './useSyncStatus';

/**
 * What the shell does as sync counts tick, in a component of its own that
 * draws nothing: reading the status here redraws this alone, not the shell
 * and the screens under it (useSyncStatus.ts).
 */
export function SyncEffects(props: { orgId: string; orgPulled: boolean; refused: string | null }) {
  const status = useSyncStatus();
  // Web: warn before the tab closes with work still to send (storageGate.tsx).
  useLeaveGuard(!props.refused && (status.pending > 0 || status.pendingUp > 0) || status.orgPending > 0);
  useLibraryUpload(props.orgId, props.orgPulled);
  return null;
}
