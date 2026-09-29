// Which language this phone has open (docs/decisions.md 37). Each language is
// its own partition; the phone syncs the organization's partition and the
// open language's, and keeps any it opened before. Pure, so it can be tested.
import { orgLanguages, partitionOfLane, WORK_PARTITION, type OrgState } from '@langquest-next/core';

export interface OpenLanguage {
  /** The language screens default to (ctx.laneId), or null when the organization has none yet. */
  laneId: string | null;
  /** The partition to sync: the language's own, or an empty one before there are languages. */
  partitionId: string;
}

/**
 * The language to open: the one the current screen is about, else the one
 * opened last, else the first this person is assigned to, else the first by
 * name. Only languages the organization has registered count. (An
 * organization from before decision 37 registered one shared partition;
 * it opens as one entry, and its languages are read once it is open.)
 */
export function openLanguage(
  org: OrgState | null,
  actorId: string,
  wanted: { param?: string | undefined; saved?: string | null | undefined }
): OpenLanguage {
  const languages = orgLanguages(org);
  const registered = new Set(languages.map((l) => l.laneId));
  const ok = (id: string | null | undefined): id is string => !!id && registered.has(id);
  const mine = Object.values(org?.members[actorId] ?? {})
    .filter((m) => m.removed.value === false && m.scope.level === 'lane' && m.scope.laneId && registered.has(m.scope.laneId))
    .map((m) => m.scope.laneId!)
    .sort();
  const laneId = [wanted.param, wanted.saved, mine[0], languages[0]?.laneId].find(ok) ?? null;
  return { laneId, partitionId: laneId ? partitionOfLane(org, laneId) : WORK_PARTITION };
}

/**
 * Every language to list: the organization's, plus those of an older shared
 * partition once it is open (which then stand in for its one registry entry).
 */
export function languagesToList(registered: { laneId: string }[], openState: { lanes: Record<string, unknown> } | null, openPartition: string): string[] {
  const openLanes = Object.keys(openState?.lanes ?? {});
  const sharedPartition = (id: string) => id === openPartition && !!openState && !openState.lanes[id] && openLanes.length > 0;
  return [...new Set([...registered.map((l) => l.laneId).filter((id) => !sharedPartition(id)), ...openLanes])];
}
