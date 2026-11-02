import { DurableObject } from 'cloudflare:workers';
import { SqliteStore, SupabaseTransport } from '@langquest-next/sync';
import { languageInfo, REPORT_VERSION, type OrgReportsResponse, type ReportInputs } from '@langquest-next/core';
import { serviceClient, type Env } from './env';
import { OrgFolder } from './orgFolder';
import { AgentOrg, type AgentQuery, type AgentWrite, type OrgAccess } from './agent/org';
import type { Grant } from './agent/tokens';
import type { LinkReviewInput, LinkSpec, ReviewLink } from './agent/view';
import { WebhookDispatcher } from './agent/dispatch';
import { receivedTimes, supabaseAgentStore, type WebhookRecord } from './agent/store';
import { COALESCE_MS } from './agent/webhooks';
import { readPath } from './blobs';
import { SqlCache, type SqlStore } from './sqlCache';
import { LanguageRecordsKeeper, objectSqlDriver, type LanguageRecords } from './languageRecords';
import { jobRunSink } from '../../../server/jobRuns';

/** A scan compares what it just read: an answer this young is shared. */
const SCAN_HEADS_MS = 1_000;
/** An agent read trusts the log's heads this long (a few seconds, as a pull per read was the cost); writes pull anyway. */
const READ_HEADS_MS = 3_000;

/**
 * One per organization, named by its id, so every request for an
 * organization reaches the same folded state (decision 44). Between
 * evictions it keeps reports and recent folds in memory; across them, in its
 * own SQLite, so waking costs one heads query rather than a rebuild. The
 * access-token API, MCP, review links and webhooks read each language as
 * records kept in that SQLite, never whole in memory (decisions.md 147).
 */
export class OrgSnapshot extends DurableObject<Env> {
  private folder: OrgFolder | null = null;

  private agent: AgentOrg | null = null;

  async reports(orgId: string, profileId: string, fresh: boolean, everyLanguage = false): Promise<OrgReportsResponse | null> {
    return this.folderFor(orgId).reportsFor(profileId, fresh, everyLanguage);
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
        orgState: () => folder.orgOnly(true),
        languageRecords: async (languageId, head) => (languageInfo(await folder.orgOnly(), languageId) ? this.recordsFor(orgId).records(languageId, head) : null),
        // The scan's organization read has just asked (below); this one shares its answer.
        heads: () => this.heads(orgId, SCAN_HEADS_MS),
        fetch: (url, init) => fetch(url, init),
        now: Date.now,
        jobRun: (run) => this.ctx.waitUntil(jobRunSink(this.env.SUPABASE_URL, this.env.SUPABASE_SERVICE_ROLE_KEY)(run))
      });
    }
    return this.dispatcher;
  }

  private headsMemo: { at: number; settled: boolean; answer: Promise<Record<string, number>> } | null = null;

  /**
   * Each stream's newest seq. A question already on its way is shared, and an
   * answer no older than `maxAgeMs` is reused, so one scan asks once (the
   * organization read and the webhook comparison both need it) and a burst
   * of agent reads asks once. 0 takes only an answer still on its way.
   */
  private heads(orgId: string, maxAgeMs = 0): Promise<Record<string, number>> {
    const memo = this.headsMemo;
    if (memo && (!memo.settled || Date.now() - memo.at <= maxAgeMs)) return memo.answer;
    const answer = (async () => {
      const { data, error } = await serviceClient(this.env).rpc('stream_heads', { p_org_id: orgId });
      if (error) throw new Error(`stream_heads: ${error.message}`);
      return Object.fromEntries(((data ?? []) as { stream_id: string; head: number }[]).map((r) => [r.stream_id, Number(r.head)]));
    })();
    const mine = { at: Date.now(), settled: false, answer };
    this.headsMemo = mine;
    // A failure is not kept: the next ask goes to the database again.
    answer.then(() => { mine.settled = true; }, () => { if (this.headsMemo === mine) this.headsMemo = null; });
    return answer;
  }

  /**
   * A language for a read: pulled only when the log has moved past what is
   * kept, judged by heads at most READ_HEADS_MS old. A write passes `fresh`
   * and pulls whatever the heads say.
   */
  private async readRecords(orgId: string, languageId: string, fresh: boolean): Promise<LanguageRecords> {
    if (fresh) return this.recordsFor(orgId).records(languageId);
    const heads = await this.heads(orgId, READ_HEADS_MS).catch(() => null);
    return this.recordsFor(orgId).records(languageId, heads?.[languageId]);
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
        webhooks: this.dispatcherFor(orgId),
        records: (languageId, fresh) => this.readRecords(orgId, languageId, fresh),
        received: (languageId, keys) => receivedTimes(serviceClient(this.env), orgId, languageId, keys)
      });
    }
    return this.agent;
  }

  private keeper: LanguageRecordsKeeper | null = null;

  /** Each language as records in the object's SQLite: sync's kept client per language, over the service role (decisions.md 147). */
  private recordsFor(orgId: string): LanguageRecordsKeeper {
    if (!this.keeper) {
      const transport = new SupabaseTransport(serviceClient(this.env));
      this.keeper = new LanguageRecordsKeeper(transport, orgId, () => SqliteStore.open(objectSqlDriver(this.sql())));
    }
    return this.keeper;
  }

  private sql(): SqlStore {
    const storage = this.ctx.storage;
    return { exec: (query, ...bindings) => storage.sql.exec(query, ...bindings), transactionSync: (fn) => storage.transactionSync(fn) };
  }

  private folderFor(orgId: string): OrgFolder {
    if (!this.folder) {
      const service = serviceClient(this.env);
      const transport = new SupabaseTransport(service);
      const source = {
        pull: transport.pull.bind(transport),
        snapshotMeta: transport.snapshotMeta.bind(transport),
        snapshotChunk: transport.snapshotChunk.bind(transport),
        heads: (org: string) => this.heads(org),
        // What the projection pass stored (decisions.md 142), for this report version only.
        reportHeads: async (org: string) => {
          const { data, error } = await service.from('language_report_inputs').select('language_id,seq,updated_at')
            .eq('org_id', org).eq('report_version', REPORT_VERSION);
          if (error) throw new Error(`language_report_inputs: ${error.message}`);
          return Object.fromEntries(((data ?? []) as { language_id: string; seq: number; updated_at: string }[])
            .map((r) => [r.language_id, { seq: Number(r.seq), at: Date.parse(r.updated_at) }]));
        },
        reportInputs: async (org: string, languageId: string) => {
          const { data, error } = await service.from('language_report_inputs').select('seq,updated_at,inputs')
            .eq('org_id', org).eq('language_id', languageId).eq('report_version', REPORT_VERSION).maybeSingle();
          if (error) throw new Error(`language_report_inputs: ${error.message}`);
          const row = data as { seq: number; updated_at: string; inputs: ReportInputs } | null;
          return row ? { seq: Number(row.seq), at: Date.parse(row.updated_at), inputs: row.inputs } : null;
        }
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
