// A group invite for the admin screen: issue one, and say what went wrong (admin/admin.tsx).
import { useEffect, useState } from 'react';
import { scopeKey, type Scope } from '@langquest-next/core';
import { APP_URL } from '../web/appUrl';
import { inviteUri, issueInvite } from '../invites/invites';
import { noteExpected } from '../diagnostics/report';
import { inviteFailureText, GROUP_USES } from './inviteText';

export type InviteState = { uri: string } | { error: string } | null;

/**
 * A group code for one role at one scope, issued when first shown (the same
 * RPC as Invite by QR) and kept while the screen is up, so switching back to
 * a role shows the code already made. Offline, it says so.
 */
export function useGroupInvite(orgId: string, roleId: string | null, scope: Scope | null, label: string): InviteState {
  const [made, setMade] = useState<Record<string, InviteState>>({});
  const key = roleId && scope ? `${roleId}|${scopeKey(scope)}` : '';
  useEffect(() => {
    if (!key || !roleId || !scope || made[key]) return;
    let live = true;
    void issueInvite(orgId, roleId, scope, { label, maxUses: GROUP_USES })
      .then((inv) => { if (live) setMade((m) => ({ ...m, [key]: { uri: inviteUri(orgId, inv.token, APP_URL) } })); })
      .catch((e: unknown) => {
        // Offline or refused by the server: its words say which.
        noteExpected('issue group invite', e);
        if (live) setMade((m) => ({ ...m, [key]: { error: inviteFailureText(e) } }));
      });
    return () => { live = false; };
    // `made` is read to skip a code already made; it must not re-run the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, orgId, label]);
  return key ? made[key] ?? null : null;
}
