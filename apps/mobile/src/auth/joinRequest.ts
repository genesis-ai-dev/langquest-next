import { queueAccountAction } from '../account/accountData';

/** Ask to join an organization: queued on the account outbox, which delivers and retries. Answers the action's id. */
export function queueJoinRequest(actorId: string, ask: { orgId: string; message: string; orgName?: string | undefined }): Promise<string> {
  return queueAccountAction(actorId, 'join_request', {
    orgId: ask.orgId, message: ask.message.trim(), ...(ask.orgName ? { orgName: ask.orgName } : {}), askedAt: Date.now()
  });
}
