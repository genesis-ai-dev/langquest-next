import { useEffect, useRef, useState } from 'react';
import { useDisguise } from '../disguise/useDisguise';
import { keepNearbyOrg } from './holdChoice';
import { refreshHoldChoice, refreshNearbyIdentity } from './nearbyIdentity.android';
import { nearbyFlag, onNearbyFlag } from './nearbyFlag';
import { membershipMarkOf } from './nearbyModel';
import type { NearbyIdentityProps } from './useNearbyIdentity';

/**
 * A phone's nearby identity, from `SyncEffects`, whatever screen is open (docs/nearby-sync-plan.md
 * 5.5, 5.10, 5.12): after each organization pull, on each `get_user_state` answer, on a change of
 * this person's membership and when another language opens, it keeps the install key,
 * certificates, discovery keys and revocation lists current (nearbyIdentity.android.ts). It also
 * keeps "Hold teammates' recordings" where `openLanguage` reads it, so sync never reads a disguise.
 * Draws nothing and shows nothing.
 */
export function useNearbyIdentity(props: NearbyIdentityProps): void {
  const { actorId, signedIn, orgId, orgPulled, languageId } = props;
  const worn = useDisguise().look !== null;
  useEffect(() => { void refreshHoldChoice(worn); }, [worn]);

  const [revision, setRevision] = useState(() => nearbyFlag(actorId).revision);
  useEffect(() => {
    setRevision(nearbyFlag(actorId).revision);
    return onNearbyFlag(() => setRevision(nearbyFlag(actorId).revision));
  }, [actorId]);

  // The fold changes in place, so the membership is read each draw, and the latest fold handed over by ref.
  const membership = membershipMarkOf(props.org, actorId);
  const org = useRef(props.org);
  org.current = props.org;
  // For the language session's nearby files: may this person review, may they write files.
  useEffect(() => { if (orgId) keepNearbyOrg(orgId, props.org); });
  useEffect(() => {
    if (!signedIn || actorId === 'guest' || !orgId || !orgPulled) return;
    void refreshNearbyIdentity({ actorId, orgId, org: org.current, languageId });
  }, [actorId, signedIn, orgId, orgPulled, languageId, membership, revision]);
}
