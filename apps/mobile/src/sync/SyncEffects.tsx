import type { OrgState } from '@langquest-next/core';
import { useLabelsLoad } from '../library/useLabels';
import { useLibraryUpload } from '../library/useLibraryFollow';
import { useNearbyIdentity } from '../nearby/useNearbyIdentity';
import { useLeaveGuard } from '../web/useLeaveGuard';
import { useSyncStatus } from './useSyncStatus';

/**
 * What the shell does as sync counts tick, in a component of its own that
 * draws nothing: reading the status here redraws this alone, not the shell
 * and the screens under it (useSyncStatus.ts).
 */
export function SyncEffects(props: {
  orgId: string; orgPulled: boolean; refused: string | null;
  actorId: string; signedIn: boolean; org: OrgState | null; languageId: string | null;
}) {
  const status = useSyncStatus();
  // Web: warn before the tab closes with work still to send (storageGate.tsx).
  useLeaveGuard(!props.refused && (status.pending > 0 || status.pendingUp > 0) || status.orgPending > 0);
  useLibraryUpload(props.orgId, props.orgPulled);
  // What LangQuest's templates and flows are called in the language showing (decision 195).
  useLabelsLoad(props.orgId);
  // Nearby sync's key, certificates and discovery keys, after each organization pull (Android only; docs/nearby-sync-plan.md 5.10).
  useNearbyIdentity({ actorId: props.actorId, signedIn: props.signedIn, orgId: props.orgId, orgPulled: props.orgPulled, org: props.org, languageId: props.languageId });
  return null;
}
