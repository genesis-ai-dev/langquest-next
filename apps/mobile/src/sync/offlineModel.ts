// What a passage's download button and line say, from what this device knows (decisions.md 166). Pure.
import { t } from '../i18n';
import { formatBytes, formatNumber } from '../i18n/format';
import type { KeptOffline } from './offlineText';

/**
 * Where a passage's audio stands on this device, as its download button and
 * line say it (decisions.md 61, 166). Each says only what the device knows:
 * "On this device" once its own count says every file is here, "Downloading"
 * only while a file of it is coming down, and no download offered while the
 * device is offline. `recordings`: kept for its recordings alone, through its
 * book's or section's button, and they are here; `ready` is a passage kept
 * with its reference material, all of it here. The two look and read apart
 * (docs/decisions/2026-11-20-a-book-has-its-own-download-button.md, amended).
 */
export type OfflineLook = { kind: 'checking' | 'none' | 'noConnection' | 'downloading' | 'partial' | 'ready' | 'recordings'; label: string };

export function offlineLook(u: KeptOffline | 'checking', o: { offline: boolean; downloading: boolean }): OfflineLook {
  if (u === 'checking') return { kind: 'checking', label: t('offline.summary.checking') };
  if (!u.reason) return o.offline ? { kind: 'noConnection', label: t('offline.needsConnection') } : { kind: 'none', label: t('offline.download') };
  if (u.ready) return u.recordingsOnly ? { kind: 'recordings', label: t('offline.recordingsHere') } : { kind: 'ready', label: t('offline.onDevice') };
  // Its recordings are here, and its study guide has not been looked up yet: the device cannot say its files are
  // here. Online that is a moment's checking; offline the guide cannot be looked up at all, so it is not here yet.
  if (u.studyUnknown && u.toFetch === 0) {
    return o.offline ? { kind: 'partial', label: t('offline.notHere.title') } : { kind: 'checking', label: t('offline.summary.checking') };
  }
  const here = u.here + u.studyHere;
  const total = u.audio + u.studyTotal;
  // Kept, but its rows have not reached this device yet (decisions.md 147).
  if (total === 0) return { kind: 'partial', label: t('offline.notHere.title') };
  return o.downloading && !o.offline
    ? { kind: 'downloading', label: t('offline.passage.downloadingCount', { here, total }) }
    : { kind: 'partial', label: t('offline.passage.onlySomeHere', { here, count: total }) };
}

/**
 * The passages whose reference material comes along (study guide files,
 * reference audio): the person's own (asked of them or worked on) and those
 * kept by their own button, not those kept only for their recordings through
 * a book's or a section's button
 * (docs/decisions/2026-11-20-a-book-has-its-own-download-button.md, amended).
 */
export function referenceUnits(blobs: { scope: ReadonlySet<string>; keptUnits: ReadonlySet<string>; recordingsOnly: ReadonlySet<string> }): Set<string> {
  const units = new Set(blobs.scope);
  for (const u of blobs.keptUnits) if (!blobs.recordingsOnly.has(u)) units.add(u);
  return units;
}

/**
 * A book's or an outline section's passages taken as one download
 * (docs/decisions/2026-11-20-a-book-has-its-own-download-button.md, LAN-316).
 * The choice is still each passage's own (decisions.md 61): this is those
 * passages counted together, from the same counts their own buttons read.
 */
export interface GroupOffline {
  /** Passages in the group. */
  count: number;
  /** Kept, with every file here. */
  ready: number;
  /** Not kept: what a tap keeps. */
  toKeep: string[];
  /** Kept because the person chose them: what a tap lets go once every passage is kept. */
  chosen: string[];
  /** The device has not counted every kept passage of the group yet. */
  checking: boolean;
}

export function groupOffline(unitIds: readonly string[], counted: ReadonlyMap<string, KeptOffline> | null, keptUnits: ReadonlySet<string>): GroupOffline {
  const g: GroupOffline = { count: unitIds.length, ready: 0, toKeep: [], chosen: [], checking: !counted };
  for (const unitId of unitIds) {
    const u = counted?.get(unitId);
    if (!u?.reason) {
      // Chosen a moment ago: the count has not caught up with it yet.
      if (keptUnits.has(unitId)) g.checking = true;
      else g.toKeep.push(unitId);
      continue;
    }
    if (u.ready) g.ready += 1;
    if (u.reason === 'chosen') g.chosen.push(unitId);
  }
  return g;
}

/** What a tap on a group's button does: keep the passages not kept, let go those the person chose, or only say why they are kept. */
export type GroupTap = 'keep' | 'letGo' | 'why';

export interface GroupLook {
  /** `noRoom`: the passages not kept would not fit on this device. */
  kind: OfflineLook['kind'] | 'noRoom';
  /** The line: what a tap does, or where the passages stand. */
  label: string;
  /** Under it: how many are here, how much is to come, what is in the way. */
  notes: string[];
  /** What help mode says of it, and what a tap that only explains says; empty where a tap does nothing. */
  help: string;
  tap: GroupTap | null;
}

/**
 * What a group's download button says, by the rules of a passage's
 * (decisions.md 166): nothing offered offline, "on this device" only once
 * every passage's own count says so, "downloading" only while a file of one
 * is coming down. Before anything is kept it says how much audio would come
 * (`cost`; null where it is not said, or could not be worked out), and a
 * download that would leave no room for recording (`room`, null where the
 * device cannot say) is not offered at all. `sizing`: the device is still
 * working the size out, so the line is still checking: an offer never
 * appears and then changes under a thumb. `filling`: a first download is
 * still bringing the language in (decisions.md 147), so the device does not
 * know every passage's files and could not tell whether they fit: no group
 * is offered until it ends, and the line says the language is downloading.
 */
export function groupLook(
  g: GroupOffline,
  o: { offline: boolean; downloading: boolean; cost: { bytes: number; files?: number } | null; room: number | null; sizing?: boolean; filling?: boolean }
): GroupLook {
  // Where a tap does nothing, help mode has nothing to light, so there are no help words.
  const checking: GroupLook = { kind: 'checking', label: t('offline.summary.checking'), notes: [], help: '', tap: null };
  if (g.checking) return checking;
  const here = t('map.me.ready', { ready: formatNumber(g.ready), count: g.count });
  if (g.toKeep.length > 0) {
    // Some are kept already (asked of the person, worked on, or chosen one by one): say how far those are.
    const notes = g.toKeep.length < g.count ? [here] : [];
    if (o.offline) return { kind: 'noConnection', label: t('offline.needsConnection'), notes, help: '', tap: null };
    if (o.filling) return { ...checking, label: t('offline.fill.title'), notes };
    if (o.sizing) return checking;
    const bytes = o.cost?.bytes ?? 0;
    if (!fits(bytes, o.room)) {
      // A tap asks again, since room changes: it keeps them if they fit by then, and says so if they do not.
      return {
        kind: 'noRoom', label: t('offline.group.noRoom'), notes: [...notes, t('offline.group.noRoomNeeds', { size: formatBytes(bytes), room: formatBytes(o.room ?? 0) })],
        help: t('offline.group.noRoomHelp'), tap: 'keep'
      };
    }
    // The button keeps recordings only, and says how much of them would come: the size once worked out, or that
    // there is none yet, so a book nobody has recorded does not look like a download that never starts. Files
    // whose size is not known are neither: nothing is said of them.
    const coming = bytes > 0 ? [t('offline.group.size', { size: formatBytes(bytes) })] : o.cost?.files === 0 ? [t('offline.group.nothingYet')] : [];
    return {
      kind: 'none',
      label: notes.length ? t('offline.group.downloadRest', { count: g.toKeep.length }) : t('offline.group.download', { count: g.count }),
      notes: [...notes, ...coming],
      help: t('offline.group.keepHelp'), tap: 'keep'
    };
  }
  // Every passage is kept: a tap lets go what the person chose, or says why none of it was a choice.
  const tap: GroupTap = g.chosen.length ? 'letGo' : 'why';
  const help = g.chosen.length ? t('offline.group.letGoHelp') : t('offline.group.reason');
  // What a group promises is recordings, so its mark when they are all here is the recordings mark, not "On this device"'s.
  if (g.ready === g.count) return { kind: 'recordings', label: t('offline.group.allHere', { count: g.count }), notes: [], help, tap };
  if (o.downloading && !o.offline) {
    return { kind: 'downloading', label: t('offline.passage.downloadingCount', { here: g.ready, total: g.count }), notes: [t('offline.stayConnected')], help, tap };
  }
  return { kind: 'partial', label: here, notes: o.offline ? [t('offline.connectToFinish')] : [], help, tap };
}

/** Would this much audio fit in the room the device has to spare (`BlobStore.roomBytes`)? A device that cannot say (`null`) is not held back. */
export function fits(bytes: number, room: number | null): boolean {
  return room === null || bytes <= room;
}

/** What a tap says when the passages would not fit: asked again at the tap, since room changes. */
export function noRoomWords(bytes: number, room: number): string {
  return t('map.joinSentences', { first: t('offline.group.noRoom'), next: t('offline.group.noRoomNeeds', { size: formatBytes(bytes), room: formatBytes(room) }) });
}

/** A group's line and what is under it, as one spoken label. */
export function groupSpoken(look: GroupLook): string {
  return [look.label, ...look.notes].reduce((first, next) => t('map.joinSentences', { first, next }));
}

/** What letting a group go says: its audio may go, and how many passages stay kept because they are the person's work. */
export function letGoWords(g: GroupOffline): string {
  const stay = g.count - g.chosen.length;
  return stay > 0 ? t('offline.group.toast.someStay', { count: stay }) : t('offline.group.toast.letGo');
}

/** The language download a screen has shown its banner for: which language, and how many passages it had to fill. */
export type FillSeen = { languageId: string; total: number };

/**
 * What the first-download banner shows (decisions.md 147): the fill while it
 * runs, then, once this screen has shown it, the finished fill in the same
 * place until the person leaves the screen. Taken away the moment the last
 * passage arrived, the list under it moved up by the banner's height while
 * someone was tapping a row, and the tap missed (LAN-253). Nothing for a
 * fill this screen never showed, or one of another language.
 */
export function fillBanner(fill: { filled: number; total: number } | null, seen: FillSeen | null, languageId: string):
  { filled: number; total: number; done: boolean } | null {
  if (fill && fill.total > 0) return { filled: fill.filled, total: fill.total, done: false };
  if (!fill && seen && seen.languageId === languageId) return { filled: seen.total, total: seen.total, done: true };
  return null;
}
