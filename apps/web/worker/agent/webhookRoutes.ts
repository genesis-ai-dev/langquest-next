import { answer, body, fail, json, type AgentDeps } from './http';
import type { TokenRecord, WebhookRecord } from './store';
import { canRead, type Grant } from './tokens';
import { CHANGES_PAGE, CHANGES_PAGE_MAX, newWebhookSecret, parseWebhookInput, WEBHOOKS_PER_TOKEN } from './webhooks';

/**
 * `/api/v1/webhooks/*` and `/api/v1/languages/{id}/changes` (decisions.md
 * 101). A webhook belongs to the token that made it: only that token lists,
 * pings or deletes it, and it stops when the token is revoked.
 */

export const webhookOut = (w: WebhookRecord) => ({
  id: w.id, url: w.url, events: w.events, languageIds: w.languageIds, createdAt: w.createdAt, disabledAt: w.disabledAt, disabledReason: w.disabledReason
});

const NEEDS_READ = 'Webhooks and the change feed need the read scope.';

export async function webhookRoute(request: Request, parts: string[], grant: Grant, deps: AgentDeps): Promise<Response> {
  if (!canRead(grant, true)) return fail(403, 'scope', NEEDS_READ);
  const org = deps.org(grant.orgId);
  if (parts.length === 0) {
    if (request.method === 'GET') return json(200, { webhooks: (await deps.store.webhooksOfToken(grant.tokenId)).map(webhookOut) });
    if (request.method !== 'POST') return fail(405, 'method', 'GET lists this token\'s webhooks; POST makes one.');
    const b = await body(request);
    if (!b) return fail(400, 'bad_request', 'Send a JSON object: { "url": "https://…", "events": [ … ] }.');
    const input = parseWebhookInput(b);
    if ('code' in input) return fail(input.status, input.code, input.error);
    if (input.languageIds) {
      const languages = await org.read(grant, { op: 'languages' });
      const reach = new Set(languages.ok ? (languages.data as { languageId: string }[]).map((l) => l.languageId) : []);
      const outside = input.languageIds.filter((id) => !reach.has(id));
      if (outside.length) return fail(400, 'bad_request', `This token cannot open ${outside.join(', ')}.`);
    }
    const mine = await deps.store.webhooksOfToken(grant.tokenId);
    if (mine.filter((w) => !w.disabledAt).length >= WEBHOOKS_PER_TOKEN) return fail(409, 'too_many', `A token may have ${WEBHOOKS_PER_TOKEN} running webhooks. Delete one first.`);
    if (!(await org.spendWrite(grant.tokenId))) return fail(429, 'rate_limited', 'This token has made too many writes in the last hour. Try again later.');
    const secret = newWebhookSecret();
    const webhook = await deps.store.insertWebhook({ orgId: grant.orgId, tokenId: grant.tokenId, ...input, secret });
    // Its languages get a starting point now, so the next change is sent rather than taken as the start.
    await org.scanWebhooks();
    return json(200, { webhookId: webhook.id, secret, webhook: webhookOut(webhook) });
  }
  const webhook = (await deps.store.webhooksOfToken(grant.tokenId)).find((w) => w.id === parts[0]);
  if (!webhook) return fail(404, 'no_webhook', 'This token has no webhook with that id.');
  if (parts.length === 1) {
    if (request.method === 'GET') return json(200, webhookOut(webhook));
    if (request.method !== 'DELETE') return fail(405, 'method', 'GET or DELETE a webhook.');
    await deps.store.deleteWebhook(webhook.id, grant.tokenId);
    return json(200, { id: webhook.id, deleted: true });
  }
  if (parts.length === 2 && parts[1] === 'ping' && request.method === 'POST') {
    if (webhook.disabledAt) return fail(409, 'disabled', `This webhook has stopped: ${webhook.disabledReason ?? 'disabled'}. Make a new one.`);
    if (!(await org.spendWrite(grant.tokenId))) return fail(429, 'rate_limited', 'This token has made too many writes in the last hour. Try again later.');
    return json(200, { delivery: await org.pingWebhook(webhook) });
  }
  if (parts.length === 2 && parts[1] === 'deliveries' && request.method === 'GET') return json(200, await org.webhookDeliveries(webhook.id));
  return fail(404, 'not_found', 'Not found. GET /api/v1 lists what is here.');
}

/** `GET …/languages/{languageId}/changes?after=&limit=`. */
export async function changesRoute(url: URL, grant: Grant, languageId: string, deps: AgentDeps): Promise<Response> {
  const rawAfter = url.searchParams.get('after');
  const after = rawAfter === null ? null : Number(rawAfter);
  if (after !== null && (!Number.isSafeInteger(after) || after < 0)) return fail(400, 'bad_request', 'after is a cursor from this feed or a webhook delivery.');
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? CHANGES_PAGE : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > CHANGES_PAGE_MAX) return fail(400, 'bad_request', `limit is 1 to ${CHANGES_PAGE_MAX}.`);
  return answer(await deps.org(grant.orgId).changes(grant, languageId, after, limit));
}

/** Revoke a token; its running webhooks hear token.revoked as their last delivery. */
export async function revokeWithWebhooks(token: Pick<TokenRecord, 'id'>, profileId: string, deps: AgentDeps): Promise<boolean> {
  const running = (await deps.store.webhooksOfToken(token.id)).filter((w) => !w.disabledAt);
  if (!(await deps.store.revokeToken(token.id, profileId))) return false;
  if (running.length) await deps.org(running[0]!.orgId).webhooksEnded(running).catch((e: unknown) => console.error('token.revoked notice', e));
  return true;
}
