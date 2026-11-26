/**
 * A book's or an outline section's passages as one download, and whether a
 * passage's files are coming down: the hooks the download buttons share
 * (sync/offline.tsx), and the book screen's header and line (screens/map.tsx).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Ctx } from '../shell/ctx';
import { noteExpected } from '../diagnostics/report';
import { studyComing } from '../study/studyFiles';
import { referenceComing } from '../sources/referenceCounts';
import { useSlowly } from '../ui/useSlowly';
import { keptOfflineMap } from './offlineText';
import { fits, groupLook, groupOffline, groupProgress, keepAsk, letGoWords, noRoomWords, workKept, type GroupCost, type GroupLook, type KeepAsk } from './offlineModel';
import { useReferenceRevision } from './useOfflineSummary';
import { useSyncStatus } from './useSyncStatus';
import { isOffline } from './uploadsModel';
import { useNearbyCanRun } from '../nearby/useNearbyCanRun';

/**
 * Is a file of a passage coming down now: one of its recordings (the
 * session's transfers), its study guide's files (study/studyFiles.ts) or its
 * reference audio (sources/referenceCounts.ts)? Its button says
 * "Downloading" only then (decisions.md 166).
 */
export function useComing(): (unitId: string) => boolean {
  const downloading = useSyncStatus().downloading;
  useReferenceRevision();
  return (unitId) => downloading.has(unitId) || studyComing(unitId) || referenceComing(unitId);
}

/**
 * A group's cost, asked a beat after its passages are known and again as the
 * language changes, at most every few seconds (a sync changes it many times
 * a second). `answer` is null until these passages have been answered for,
 * and stays while they are asked about again. `ask` asks now, as a tap does,
 * and the line then says what the tap learned. Only what a tap would keep is
 * asked about, and only while `shown`.
 */
function useGroupCost(ctx: Ctx, unitIds: readonly string[], shown: boolean): { answer: GroupCost | null; ask: () => Promise<GroupCost> } {
  const key = unitIds.join('\n');
  const [cost, setCost] = useState<(GroupCost & { key: string }) | null>(null);
  const { offlineCost, store } = ctx.language.blobs;
  const revision = useSlowly(ctx.language.revision, 5000);
  const current = useRef(key);
  current.current = key;
  const ask = useCallback(async (): Promise<GroupCost> => {
    const c = key ? await offlineCost(key.split('\n')).catch((e: unknown) => { noteExpected('offline: group cost', e); return null; }) : null;
    const free = store?.roomBytes() ?? null;
    const found: GroupCost = { bytes: c ? c.bytes : null, files: c ? c.files : null, room: free === null ? null : free + (c?.freeable ?? 0), here: c ? c.here : null };
    // Kept only for the passages now asked about: an answer for an earlier set never replaces a later one's.
    if (current.current === key) setCost({ key, ...found });
    return found;
  }, [key, offlineCost, store]);
  useEffect(() => {
    if (!shown || !key) return;
    // A beat later, so passages kept one after another ask once.
    const timer = setTimeout(() => { void ask(); }, 300);
    return () => clearTimeout(timer);
  }, [shown, key, ask, revision]);
  return { answer: cost && cost.key === key ? cost : null, ask };
}

/**
 * A book's or an outline section's passages as one download (LAN-316,
 * docs/decisions/2026-11-20-a-book-has-its-own-download-button.md): what its
 * button says and what a tap does, from each passage's own count (decisions.md
 * 166). A tap keeps the passages not kept yet, with their reference material;
 * once every one is kept it lets go those the person chose, as a passage's
 * button does. `sized`: say how much audio would come before the tap.
 */
export interface GroupOffer {
  look: GroupLook; onPress: (() => void) | undefined;
  /**
   * Some passages the person chose are kept, all of the group or only some of
   * it: letting them go, which a screen asks to be sure of first
   * (`RemoveSheet`). A book partly downloaded could be let go only one passage
   * at a time (Carl, 2026-11-23).
   */
  remove: { run: () => void; stay: number } | null;
  /** How many passages the group has: none, and it shows nothing. */
  count: number;
  /**
   * For a screen that asks before it downloads (a book's, `KeepSheet`): asks the size again, as a tap does, and
   * says what the download would bring; null, with a toast that says why, when it would not fit (Carl, 2026-11-25).
   */
  ask: (name: string) => Promise<KeepAsk | null>;
  /** Keeps the passages not kept yet, with their reference material: what the sheet's Download does. */
  keep: () => void;
  /** Once a download is asked for: how many of the files its kept passages need are here, or still counting (`groupProgress`). */
  progress: { here: number; total: number } | 'checking' | null;
}

export function useGroupOffline(ctx: Ctx, unitIds: readonly string[], sized: boolean): GroupOffer {
  const counted = keptOfflineMap(ctx);
  const { keptOffline, keptUnits, keepOffline } = ctx.language.blobs;
  useReferenceRevision();
  const offline = isOffline(ctx.language.online);
  const coming = useComing();
  const g = useMemo(() => groupOffline(unitIds, keptOffline ? counted : null, keptUnits), [unitIds, keptOffline, counted, keptUnits]);
  // While a first download fills the language in (decisions.md 147) the device does not know every
  // passage's files, so it could not tell whether they fit: no group is offered until it ends.
  const fill = ctx.language.fill;
  const filling = !!fill && fill.total > 0;
  // Offline, where Share nearby can run, keeping them is a want a teammate's phone fills: offered, under the same room rule
  // (docs/decisions/2026-11-25-text-goes-whole-and-recordings-go-by-want.md).
  const nearby = useNearbyCanRun();
  const offering = !filling && !g.checking && (!offline || nearby) && g.toKeep.length > 0;
  // The size is said before the tap: until it is answered the line is still checking.
  const { answer, ask } = useGroupCost(ctx, g.toKeep, sized && offering);
  const cost = answer && answer.bytes !== null && answer.files !== null ? { bytes: answer.bytes, files: answer.files, here: answer.here ?? 0 } : null;
  const look = groupLook(g, {
    offline, filling, downloading: unitIds.some(coming), cost, room: answer?.room ?? null, sizing: sized && offering && !answer, nearby
  });
  // Asked again at the tap: a section's button says no size, and room changes. Null, and said, when it would not fit.
  const check = async (): Promise<GroupCost | null> => {
    const now = await ask();
    const bytes = now.bytes ?? 0;
    if (!fits(bytes, now.room)) { ctx.toast(noRoomWords(bytes, now.room ?? 0)); return null; }
    return now;
  };
  // With their reference material, as a passage's own button keeps one (decision amended 2026-11-23).
  const keepNow = () => keepOffline(g.toKeep, true);
  const keep = async () => { if (await check()) await keepNow(); };
  // A download that cannot run now says why at the tap (Carl, 2026-11-23): its button stays where it is, dimmed.
  const blocked = look.blocked;
  const onPress = look.tap === 'keep' ? () => { void keep(); }
    : look.tap === 'why' ? () => ctx.toast(look.help)
    : blocked ? () => ctx.toast(blocked)
    : undefined;
  const remove = g.chosen.length ? { run: () => { void keepOffline(g.chosen, false); ctx.toast(letGoWords(g)); }, stay: workKept(g) } : null;
  const fromTeammate = offline && nearby;
  return {
    look, onPress, remove, count: unitIds.length,
    ask: async (name) => { const now = await check(); return now ? keepAsk(name, g.toKeep.length, now, fromTeammate) : null; },
    keep: () => { void keepNow(); },
    progress: groupProgress(g, unitIds, counted)
  };
}

/**
 * A book's passages as one download, for a screen that says where they stand
 * in its header (`GroupStatusLine`) and offers the download over them
 * (`GroupOfflineBar`): both from one count, with the size said before the tap
 * and again in the sheet that asks before it starts.
 */
export function useBookOffline(ctx: Ctx, unitIds: readonly string[]): GroupOffer {
  return useGroupOffline(ctx, unitIds, true);
}
