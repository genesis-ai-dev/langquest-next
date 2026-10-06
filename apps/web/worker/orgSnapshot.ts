import { DurableObject } from 'cloudflare:workers';
import { SupabaseTransport } from '@langquest-next/client';
import type { OrgReportsResponse } from '@langquest-next/core';
import { serviceClient, type Env } from './env';
import { OrgFolder } from './orgFolder';
import { SqlCache } from './sqlCache';

/**
 * One per organization, named by its id, so every request for an
 * organization reaches the same folded state (decision 44). Between
 * evictions it keeps reports and recent folds in memory; across them, in its
 * own SQLite, so waking costs one heads query rather than a rebuild.
 */
export class OrgSnapshot extends DurableObject<Env> {
  private folder: OrgFolder | null = null;

  async reports(orgId: string, profileId: string, fresh: boolean): Promise<OrgReportsResponse | null> {
    if (!this.folder) {
      const service = serviceClient(this.env);
      const transport = new SupabaseTransport(service);
      const source = {
        pull: transport.pull.bind(transport),
        snapshotMeta: transport.snapshotMeta.bind(transport),
        snapshotChunk: transport.snapshotChunk.bind(transport),
        heads: async (org: string) => {
          const { data, error } = await service.rpc('partition_heads', { p_org_id: org });
          if (error) throw new Error(`partition_heads: ${error.message}`);
          return Object.fromEntries(((data ?? []) as { partition_id: string; head: number }[]).map((r) => [r.partition_id, Number(r.head)]));
        }
      };
      const storage = this.ctx.storage;
      this.folder = new OrgFolder(source, orgId, new SqlCache({
        exec: (query, ...bindings) => storage.sql.exec(query, ...bindings),
        transactionSync: (fn) => storage.transactionSync(fn)
      }));
    }
    return this.folder.reportsFor(profileId, fresh);
  }
}
