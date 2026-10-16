import { DurableObject } from 'cloudflare:workers';
import { SupabaseTransport } from '@langquest-next/sync';
import type { OrgReportsResponse } from '@langquest-next/core';
import { serviceClient, type Env } from './env';
import { OrgFolder } from './orgFolder';
import { AgentOrg, type AgentQuery, type AgentWrite, type OrgAccess } from './agent/org';
import type { Grant } from './agent/tokens';
import type { LinkReviewInput, LinkSpec, ReviewLink } from './agent/view';
import { WebhookDispatcher } from './agent/dispatch';
import { supabaseAgentStore, type WebhookRecord } from './agent/store';
import { COALESCE_MS } from './agent/webhooks';
import { readPath } from './blobs';
import { SqlCache } from './sqlCache';
import { jobRunSink } from '../../../server/jobRuns';

/**
 * One per organization, named by its id, so every request for an
 * organization reaches the same folded state (decision 44). Between
 * evictions it keeps reports and recent folds in memory; across them, in its
 * own SQLite, so waking costs one heads query rather than a rebuild.
 */
export class OrgSnapshot extends DurableObject<Env> {
  private folder: OrgFolder | null = null;

  private agent: AgentOrg | null = null;

  async reports(orgId: string, profileId: string, fresh: boolean): Promise<OrgReportsResponse | null> {
    return this.folderFor(orgId).reportsFor(profileId, fresh);
  }

  // The access-token API (agent/, decision 70): the same folds, read for a token.
  async agentRead(orgId: string, grant: Grant, q: AgentQuery, origin: string) {
    return this.agentFor(orgId, origin).read(grant, q);
  }

  async agentWrite(orgId: string, grant: Grant, w: AgentWrite, origin: string) {
    return this.agentFor(orgId, origin).write(grant, w);
  }

  async agentSpend(orgId: string, key: string): Promise<boolean> {
    return this.agentFor(orgId, '').spend(key);
  }

  async agentSpendWrite(orgId: string, key: string): Promise<boolean> {
    return this.agentFor(orgId, '').spendWrite(key);
  }

  async agentLinkOpen(orgId: string, link: ReviewLink): Promise<boolean> {
    return this.agentFor(orgId, '').linkOpen(link);
  }

  async agentMayRevokeLink(orgId: string, profileId: string, link: ReviewLink): Promise<boolean> {
    return this.agentFor(orgId, '').mayRevokeLink(profileId, link);
  }

  async agentCheckLink(orgId: string, profileId: string, spec: LinkSpec) {
    return this.agentFor(orgId, '').checkLink(profileId, spec);
  }

  async agentLinkInfo(orgId: string, link: ReviewLink, origin: string) {
    return this.agentFor(orgId, origin).linkInfo(link);
  }

  async agentLinkReview(orgId: string, link: ReviewLink, input: LinkReviewInput) {
    return this.agentFor(orgId, '').linkReview(link, input);
  }

  async agentAccess(orgId: string, profileId: string): Promise<OrgAccess | null> {
    return this.agentFor(orgId, '').access(profileId);
  }

  // Webhooks and the change feed (agent/dispatch.ts, decisions.md 101). The
  // database pokes when the log moves; a burst waits COALESCE_MS, so one
  // alarm looks once and a recording session becomes one delivery.

  async agentChanges(orgId: string, grant: Grant, languageId: string, after: number | null, limit: number) {
    return this.agentFor(orgId, '').changes(grant, languageId, after, limit);
  }

  async agentScanWebhooks(orgId: string): Promise<void> {
    await this.ctx.storage.put('webhooks:org', orgId);
    await this.agentFor(orgId, '').scanWebhooks();
    const next = this.dispatcherFor(orgId).nextDue();
    if (next !== null) await this.wakeBy(next);
  }

  async agentWebhooksEnded(orgId: string, webhooks: WebhookRecord[]): Promise<void> {
    await this.ctx.storage.put('webhooks:org', orgId);
    await this.agentFor(orgId, '').webhooksEnded(webhooks);
    await this.wakeBy(Date.now());
  }

  async agentPingWebhook(orgId: string, webhook: WebhookRecord) {
    return this.agentFor(orgId, '').pingWebhook(webhook);
  }

  async agentWebhookDeliveries(orgId: string, webhookId: string) {
    return this.agentFor(orgId, '').webhookDeliveries(webhookId);
  }

  /** Something was appended to the organization's log: look for changes shortly. */
  async webhookPoke(orgId: string): Promise<void> {
    await this.ctx.storage.put({ 'webhooks:org': orgId, 'webhooks:scanDue': Date.now() });
    await this.wakeBy(Date.now() + COALESCE_MS);
  }

  /** Make sure the alarm goes off by `at`, never later than one already set. */
  private async wakeBy(at: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at) await this.ctx.storage.setAlarm(at);
  }

  async alarm(): Promise<void> {
    const orgId = await this.ctx.storage.get<string>('webhooks:org');
    if (!orgId) return;
    const dispatcher = this.dispatcherFor(orgId);
    const due = await this.ctx.storage.get<number>('webhooks:scanDue');
    if (due !== undefined) {
      await dispatcher.scan();
      // A poke while scanning asks for another look.
      if ((await this.ctx.storage.get<number>('webhooks:scanDue')) === due) await this.ctx.storage.delete('webhooks:scanDue');
    }
    await dispatcher.deliverDue();
    const next = dispatcher.nextDue();
    if ((await this.ctx.storage.get('webhooks:scanDue')) !== undefined) await this.wakeBy(Date.now() + COALESCE_MS);
    if (next !== null) await this.wakeBy(Math.max(next, Date.now() + 1000));
  }

  private dispatcher: WebhookDispatcher | null = null;

  private dispatcherFor(orgId: string): WebhookDispatcher {
    if (!this.dispatcher) {
      const storage = this.ctx.storage;
      const folder = this.folderFor(orgId);
      this.dispatcher = new WebhookDispatcher({
        exec: (query, ...bindings) => storage.sql.exec(query, ...bindings),
        transactionSync: (fn) => storage.transactionSync(fn)
      }, orgId, {
        store: supabaseAgentStore(serviceClient(this.env)),
        orgState: () => folder.orgState(true),
        languageState: (languageId) => folder.languageState(languageId),
        heads: () => this.heads(orgId),
        fetch: (url, init) => fetch(url, init),
        now: Date.now,
        jobRun: (run) => this.ctx.waitUntil(jobRunSink(this.env.SUPABASE_URL, this.env.SUPABASE_SERVICE_ROLE_KEY)(run))
      });
    }
    return this.dispatcher;
  }

  private async heads(orgId: string): Promise<Record<string, number>> {
    const { data, error } = await serviceClient(this.env).rpc('stream_heads', { p_org_id: orgId });
    if (error) throw new Error(`stream_heads: ${error.message}`);
    return Object.fromEntries(((data ?? []) as { stream_id: string; head: number }[]).map((r) => [r.stream_id, Number(r.head)]));
  }

  private origin = '';

  private agentFor(orgId: string, origin: string): AgentOrg {
    if (origin) this.origin = origin;
    if (!this.agent) {
      const transport = new SupabaseTransport(serviceClient(this.env));
      this.agent = new AgentOrg(this.folderFor(orgId), orgId, {
        append: (events) => transport.append(events),
        sign: async (key) => {
          const { path, expiresAt } = await readPath(key, { serviceKey: this.env.SUPABASE_SERVICE_ROLE_KEY });
          return { url: `${this.origin}${path}`, expiresAt };
        },
        webhooks: this.dispatcherFor(orgId)
      });
    }
    return this.agent;
  }

  private folderFor(orgId: string): OrgFolder {
    if (!this.folder) {
      const service = serviceClient(this.env);
      const transport = new SupabaseTransport(service);
      const source = {
        pull: transport.pull.bind(transport),
        snapshotMeta: transport.snapshotMeta.bind(transport),
        snapshotChunk: transport.snapshotChunk.bind(transport),
        heads: (org: string) => this.heads(org)
      };
      const storage = this.ctx.storage;
      this.folder = new OrgFolder(source, orgId, new SqlCache({
        exec: (query, ...bindings) => storage.sql.exec(query, ...bindings),
        transactionSync: (fn) => storage.transactionSync(fn)
      }));
    }
    return this.folder;
  }
}
