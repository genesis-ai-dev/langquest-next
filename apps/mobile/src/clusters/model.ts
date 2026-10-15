// Clusters (decision 107, demo ADR-045): a name an organization puts on
// some of its languages. Nothing here touches a language's stream, people
// or setup; a cluster is two kinds of organization event, a name and a tag
// per (language, cluster). Pure: the screens append what this returns.
import { clusterName, clustersOf, orgClusters, orgLanguages, type ClusterInfo, type EventPayloads, type OrgState } from '@langquest-next/core';

export type ClusterEvent =
  | { type: 'v1.ClusterNamed'; payload: EventPayloads['v1.ClusterNamed'] }
  | { type: 'v1.LanguageClusterSet'; payload: EventPayloads['v1.LanguageClusterSet'] };

/** A new cluster's id: readable in logs, unique by its random tail. */
export function newClusterId(name: string, random: string): string {
  const slug = name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'cluster';
  return `cl-${slug}-${random.replace(/-/g, '').slice(0, 8)}`;
}

/** Is this language in this cluster now? */
export function inCluster(org: OrgState | null, clusterId: string, languageId: string): boolean {
  return org?.clusters?.[clusterId]?.languages[languageId]?.value === true;
}

/**
 * The events that bring a cluster to what was asked: its name when it is
 * new or changed, a tag for each language put in that is not in yet, and
 * one off for each taken out that is in. Nothing when nothing changes.
 */
export function clusterEvents(org: OrgState | null, change: { clusterId: string; name?: string; add?: readonly string[]; remove?: readonly string[] }): ClusterEvent[] {
  const out: ClusterEvent[] = [];
  const name = change.name?.trim();
  if (name && name !== clusterName(org, change.clusterId)) out.push({ type: 'v1.ClusterNamed', payload: { clusterId: change.clusterId, name } });
  for (const languageId of new Set(change.add ?? [])) {
    if (!inCluster(org, change.clusterId, languageId)) out.push({ type: 'v1.LanguageClusterSet', payload: { languageId, clusterId: change.clusterId, inCluster: true } });
  }
  for (const languageId of new Set(change.remove ?? [])) {
    if (inCluster(org, change.clusterId, languageId)) out.push({ type: 'v1.LanguageClusterSet', payload: { languageId, clusterId: change.clusterId, inCluster: false } });
  }
  return out;
}

/** Ungrouping a cluster: every language taken out of it. The languages stay as they are; the cluster is gone (`orgClusters`). */
export function ungroupEvents(org: OrgState | null, clusterId: string): ClusterEvent[] {
  const c = orgClusters(org).find((x) => x.clusterId === clusterId);
  return c ? clusterEvents(org, { clusterId, remove: c.languageIds }) : [];
}

/** The languages on the organization's home: those in no cluster, in the list's order. */
export function languagesOutsideClusters(org: OrgState | null, languageIds: readonly string[]): string[] {
  const grouped = new Set(orgClusters(org).flatMap((c) => c.languageIds));
  return languageIds.filter((id) => !grouped.has(id));
}

/** A cluster's languages named, as a row under its name says them: the first few, then "…". */
export function clusterNames(org: OrgState | null, c: ClusterInfo, max = 3): string[] {
  const names = new Map(orgLanguages(org).map((l) => [l.languageId, l.name]));
  return c.languageIds.slice(0, max).map((id) => names.get(id) ?? id);
}

/** A cluster with this name already, ignoring case and spaces at the ends: making it again joins that one. */
export function clusterNamed(org: OrgState | null, name: string): ClusterInfo | null {
  const key = name.trim().toLocaleLowerCase();
  return key ? orgClusters(org).find((c) => c.name.trim().toLocaleLowerCase() === key) ?? null : null;
}

/** The progress filter on All languages (Map): every language, one cluster's, or those in none. */
export type ClusterFilter = { kind: 'all' } | { kind: 'cluster'; clusterId: string } | { kind: 'none' };

export function filterByCluster(org: OrgState | null, languageIds: readonly string[], f: ClusterFilter): string[] {
  if (f.kind === 'all') return [...languageIds];
  if (f.kind === 'none') return languagesOutsideClusters(org, languageIds);
  return languageIds.filter((id) => clustersOf(org, id).some((c) => c.clusterId === f.clusterId));
}
