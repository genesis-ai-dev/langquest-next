import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Passages this person opened on this device, newest first (J-WORK-8).
 * Device-local on purpose: "Recent" is where you were, not a project fact,
 * so it never enters the event log. Keyed by org, project and actor so a
 * shared device never shows one person's trail to another.
 */
export interface RecentPassage { unitId: string; laneId: string }

export const RECENT_MAX = 5;

/** Screens whose opening counts as visiting a passage. */
export const RECENT_SCREENS = ['passage_record', 'workspace', 'review_capture'] as const;

export const recentKey = (orgId: string, projectId: string, actorId: string) => `recent:${orgId}:${projectId}:${actorId}`;

/** Pure: the list after visiting one passage. */
export function pushRecent(list: RecentPassage[], visit: RecentPassage): RecentPassage[] {
  return [visit, ...list.filter((r) => r.unitId !== visit.unitId || r.laneId !== visit.laneId)].slice(0, RECENT_MAX);
}

export async function readRecent(key: string): Promise<RecentPassage[]> {
  try {
    const parsed: unknown = JSON.parse((await AsyncStorage.getItem(key)) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((r): r is RecentPassage => typeof r?.unitId === 'string' && typeof r?.laneId === 'string').slice(0, RECENT_MAX)
      : [];
  } catch {
    return [];
  }
}

const listeners = new Set<(key: string) => void>();
/** My Work re-reads its Recent list when a visit is written. */
export function onRecentChange(listener: (key: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// Writes are serialised so two quick visits cannot overwrite each other.
let queue: Promise<unknown> = Promise.resolve();
export function rememberRecent(key: string, visit: RecentPassage): Promise<void> {
  const next = queue.then(async () => {
    await AsyncStorage.setItem(key, JSON.stringify(pushRecent(await readRecent(key), visit)));
    for (const l of listeners) l(key);
  }).catch(() => {});
  queue = next;
  return next;
}
