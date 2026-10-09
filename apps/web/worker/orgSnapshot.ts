import { DurableObject } from 'cloudflare:workers';
import { SupabaseTransport } from '@langquest-next/client';
import type { OrgReportsResponse } from '@langquest-next/core';
import { serviceClient, type Env } from './env';
import { OrgFolder } from './orgFolder';
import { AgentOrg, type AgentQuery, type AgentWrite, type OrgAccess } from './agent/org';
import type { Grant } from './agent/tokens';
import type { LinkReviewInput, LinkSpec, ReviewLink } from './agent/view';
import { readPath } from './blobs';
import { SqlCache } from './sqlCache';

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
        }
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
        heads: async (org: string) => {
          const { data, error } = await service.rpc('stream_heads', { p_org_id: org });
          if (error) throw new Error(`stream_heads: ${error.message}`);
          return Object.fromEntries(((data ?? []) as { stream_id: string; head: number }[]).map((r) => [r.stream_id, Number(r.head)]));
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
