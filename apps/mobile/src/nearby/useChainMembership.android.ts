import type { Privilege } from '@langquest-next/core';
import { withChainMembership } from '@langquest-next/core/nearby';
import { useEffect, useMemo } from 'react';
import { noteExpected } from '../diagnostics/report';
import { forgetLocalPerson, type LocalPerson } from '../server/localPerson';
import { overlayFor, recordDone } from '../session/localPersonModel';
import type { OrgHandle } from '../sync/useOrg';

/**
 * The organization as a local person's own phone sees it (docs/nearby-sync-plan.md 14.1, 5
 * "Membership"): the chain's membership laid over the fold (core `withChainMembership`), so
 * nothing below `Workspace` changes and `privilegesFor` answers as for a member. Only in the
 * organization the chain names. It gives the link's signed privileges, never the fold's role of
 * that id, and writes nothing to the log. Core drops it by itself once the fold has any entry for
 * the person, live or removed, so it holds through the first download after first contact and a
 * removal sticks; then, once the certificate route has answered (`done`), the record goes.
 */
export function useChainMembership(org: OrgHandle, orgId: string | null, local: LocalPerson | null): OrgHandle {
  const membership = useMemo(() => overlayFor(local, orgId), [local, orgId]);
  const { state } = org;
  const overlaid = useMemo(
    () => (membership && state ? withChainMembership(state, { ...membership, privileges: membership.privileges as Privilege[] }) : state),
    [state, membership]
  );
  useEffect(() => {
    if (!recordDone(local, state?.members)) return;
    forgetLocalPerson(local.profileId).catch((e: unknown) => noteExpected('local person', e));
  }, [local, state]);
  return useMemo(() => (overlaid === state ? org : { ...org, state: overlaid }), [org, overlaid, state]);
}
