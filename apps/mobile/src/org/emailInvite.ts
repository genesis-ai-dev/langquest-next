import type { Scope } from '@langquest-next/core';
import { currentLanguage } from '../i18n';
import { issueInvite } from '../invites';
import { noteExpected } from '../report';
import { sendInviteEmail } from '../server/invites';
import { sendFailure } from './model';

/**
 * Invite someone by email: an invite for the role, sent by the send-invite
 * function in the language showing. Null once sent, else why not in words;
 * throws when the invite itself could not be made (offline, or refused).
 */
export async function emailInvite(orgId: string, roleId: string, scope: Scope, address: string): Promise<string | null> {
  const invite = await issueInvite(orgId, roleId, scope);
  const { error } = await sendInviteEmail(invite.inviteId, invite.token, address.trim(), currentLanguage());
  if (!error) return null;
  // The function's own words are English; its status says which refusal it was (supabase/functions/send-invite).
  noteExpected('send invite', error);
  return sendFailure(error.context instanceof Response ? error.context.status : 0);
}
