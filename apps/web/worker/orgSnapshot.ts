import { DurableObject } from 'cloudflare:workers';
import { SupabaseTransport } from '@langquest-next/client';
import type { OrgReportsResponse } from '../src/types';
import { serviceClient, type Env } from './env';
import { OrgFolder } from './orgFolder';

/**
 * One per organization, named by its id, so every request for an
 * organization reaches the same folded state (decision 44). It holds that
 * state in memory only; after an eviction it starts again from the server
 * snapshots.
 */
export class OrgSnapshot extends DurableObject<Env> {
  private folder: OrgFolder | null = null;

  async reports(orgId: string, profileId: string, fresh: boolean): Promise<OrgReportsResponse | null> {
    this.folder ??= new OrgFolder(new SupabaseTransport(serviceClient(this.env)), orgId);
    const out = await this.folder.reportsFor(profileId, fresh);
    return out.rows.length > 0 || this.folder.knows(profileId) ? out : null;
  }
}
