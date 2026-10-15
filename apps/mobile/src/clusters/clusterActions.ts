// A cluster's subtitle, and writing cluster events to the organization (clusters/parts.tsx).
import type { ClusterInfo, OrgState } from '@langquest-next/core';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { clusterNames, type ClusterEvent } from './model';

/** "5 languages · Northeastern Dinka, Northwestern Dinka, South Central Dinka…" */
export function clusterSub(org: OrgState | null, c: ClusterInfo): string {
  const names = clusterNames(org, c).join(t('admin.list.separator'));
  return t('clusters.row.sub', { count: c.languageIds.length, names: c.languageIds.length > 3 ? t('clusters.row.namesMore', { names }) : names });
}

/** Append a cluster's events in order, to the organization's stream. */
export async function appendClusterEvents(ctx: Ctx, events: readonly ClusterEvent[]): Promise<void> {
  for (const e of events) {
    if (e.type === 'v1.ClusterNamed') await ctx.org.append('v1.ClusterNamed', e.payload);
    else await ctx.org.append('v1.LanguageClusterSet', e.payload);
  }
}
