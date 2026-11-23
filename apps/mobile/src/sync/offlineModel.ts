// What a passage's download button and line say, from what this device knows (decisions.md 166). Pure.
import { t } from '../i18n';
import { formatBytes, formatNumber } from '../i18n/format';
import type { KeptOffline } from './offlineText';

/**
 * Where a passage's audio stands on this device, as its download button and
 * line say it (decisions.md 61, 166). Each says only what the device knows:
 * "On this device" once its own count says every file is here, "Downloading"
 * only while a file of it is coming down, and no download offered while the
 * device is offline.
 */
export type OfflineLook = { kind: 'checking' | 'none' | 'noConnection' | 'downloading' | 'partial' | 'ready'; label: string };

export function offlineLook(u: KeptOffline | 'checking', o: { offline: boolean; downloading: boolean }): OfflineLook {
  if (u === 'checking') return { kind: 'checking', label: t('offline.summary.checking') };
  if (!u.reason) return o.offline ? { kind: 'noConnection', label: t('offline.needsConnection') } : { kind: 'none', label: t('offline.download') };
  if (u.ready) return { kind: 'ready', label: t('offline.onDevice') };
  // Its recordings are here, and its study guide or its reference audio has not been worked out yet: the device
  // cannot say its files are here. Online that is a moment's checking; offline what it needs may not be on this
  // device to work it out, so it is not here yet.
  if ((u.studyUnknown || u.refUnknown) && u.toFetch === 0) {
    return o.offline ? { kind: 'partial', label: t('offline.notHere.title') } : { kind: 'checking', label: t('offline.summary.checking') };
  }
  const here = u.here + u.studyHere + u.refHere;
  const total = u.audio + u.studyTotal + u.refTotal;
  // Kept, but its rows have not reached this device yet (decisions.md 147).
  if (total === 0) return { kind: 'partial', label: t('offline.notHere.title') };
  return o.downloading && !o.offline
    ? { kind: 'downloading', label: t('offline.passage.downloadingCount', { here, total }) }
    : { kind: 'partial', label: t('offline.passage.onlySomeHere', { here, count: total }) };
}

/**
 * The passages whose reference material comes along (study guide files,
 * reference audio): every passage kept on this device, the person's own
 * (asked of them or worked on) and those chosen, one by one or a book at a
 * time (docs/decisions/2026-11-20-a-book-has-its-own-download-button.md,
 * amended 2026-11-23).
 */
export function referenceUnits(blobs: { scope: ReadonlySet<string>; keptUnits: ReadonlySet<string> }): Set<string> {
  return new Set([...blobs.scope, ...blobs.keptUnits]);
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
  /** The device has not counted what it keeps yet. */
  checking: boolean;
  /** Kept passages with reference audio that cannot come: no room kept for it, or not downloadable now. */
  referenceMissing: number;
  /** Kept passages with a recording the phone that made it has not sent yet: no device can download it (decisions.md 61). */
  unsent: number;
}

export function groupOffline(unitIds: readonly string[], counted: ReadonlyMap<string, KeptOffline> | null, keptUnits: ReadonlySet<string>): GroupOffline {
  const g: GroupOffline = { count: unitIds.length, ready: 0, toKeep: [], chosen: [], checking: !counted, referenceMissing: 0, unsent: 0 };
  for (const unitId of unitIds) {
    const u = counted?.get(unitId);
    if (!u?.reason) {
      // Chosen a moment ago, and the count has not caught up with it yet: kept, and not here yet. Calling the whole
      // group "checking" until then made its line shrink to one line and grow back under a thumb on every tap.
      if (keptUnits.has(unitId)) g.chosen.push(unitId);
      else g.toKeep.push(unitId);
      continue;
    }
    if (u.ready) g.ready += 1;
    if (u.reason === 'chosen') g.chosen.push(unitId);
    if (u.refFull || u.refUnavailable) g.referenceMissing += 1;
    if (u.notSent) g.unsent += 1;
  }
  return g;
}

/** What a tap on a group's button does: keep the passages not kept, let go those the person chose, or only say why they are kept. */
export type GroupTap = 'keep' | 'letGo' | 'why';

export interface GroupLook {
  /** `noRoom`: the passages not kept would not fit on this device. */
  kind: OfflineLook['kind'] | 'noRoom';
  /**
   * Where the passages stand on this device, in words, with a count only when some of them are here: on a book,
   * under how many are recorded in its header, so the book's counts are in one place (Carl, 2026-11-23).
   */
  title: string;
  /**
   * What a download would bring, or what is in the way: spoken with `title` on an outline section's round mark. A
   * book's screen shows no line of words over its passages, only the buttons (Carl, 2026-11-23): the size is on the
   * Download button (`size`), what stops it is said when it is tapped (`blocked`), and what it lacks is in its header
   * (`note`).
   */
  sub: string;
  /**
   * What the passages on this device still lack, said after `title` in a book's header: a recording not sent yet
   * from the phone that made it, or reference audio that cannot be downloaded (decision 61, amended 2026-11-23).
   */
  note: string | null;
  /** How much the recordings a download would bring are, on its button: null until worked out, or with none to fetch. */
  size: string | null;
  /**
   * Why a download cannot run now: the button stays where it is, dimmed, and a tap says this (short of room, a tap
   * asks again, since room changes). Null where it can run, or where no download is offered.
   */
  blocked: string | null;
  /** What help mode says of it, and what a tap that only explains says; empty where a tap does nothing. */
  help: string;
  tap: GroupTap | null;
  /** The words on its button for a download: all of it, or the rest. */
  button: 'all' | 'rest';
}

/**
 * What a group's download line says, by the rules of a passage's
 * (decisions.md 166): nothing offered offline, "on this device" only once
 * every passage's own count says so, "downloading" only while a file of one
 * is coming down. Before anything is kept it says how much audio its
 * recordings are (`cost`; null where it could not be worked out); their
 * reference material comes too, and its size is not known before it comes.
 * A download that would leave no room for recording (`room`, null where the
 * device cannot say) does not run: its button is dimmed, and a tap asks again.
 * `sizing`: the size is still being worked out; the button is there already,
 * since a tap asks again. `filling`: a first download is still bringing the
 * language in (decisions.md 147), so the device does not know every passage's
 * files and could not tell whether they fit: the button is dimmed until it
 * ends, and a tap says why.
 */
export function groupLook(
  g: GroupOffline,
  o: { offline: boolean; downloading: boolean; cost: { bytes: number; files?: number; here?: number } | null; room: number | null; sizing?: boolean; filling?: boolean }
): GroupLook {
  const none = { note: null, size: null, blocked: null };
  // Where a tap does nothing, help mode has nothing to light, so there are no help words. The download button is there
  // already, dimmed, so the line has its height before the device has counted.
  if (g.checking) {
    return { kind: 'checking', title: t('offline.summary.checking'), sub: t('offline.group.whatComes'), help: '', tap: null, button: 'all', ...none, blocked: t('offline.summary.checking') };
  }
  // None, some or all: "ready" said kept and here at once, and read wrong where only one was true (Carl, 2026-11-23).
  const here = g.ready === 0 ? t('offline.group.statusNone')
    : g.ready === g.count ? t('offline.onDevice')
    : t('offline.group.statusSome', { ready: formatNumber(g.ready), count: g.count });
  const button = g.toKeep.length < g.count ? 'rest' : 'all';
  if (g.toKeep.length > 0) {
    if (o.offline) {
      const sub = t('offline.needsConnection');
      return { kind: 'noConnection', title: here, sub, help: '', tap: null, button, ...none, blocked: sub };
    }
    if (o.filling) {
      const sub = t('map.joinSentences', { first: t('offline.fill.title'), next: t('offline.stayConnected') });
      return { kind: 'checking', title: here, sub, help: '', tap: null, button, ...none, blocked: sub };
    }
    if (o.sizing) return { kind: 'none', title: here, sub: t('offline.group.sizing'), help: t('offline.group.keepHelp'), tap: 'keep', button, ...none };
    const bytes = o.cost?.bytes ?? 0;
    if (!fits(bytes, o.room)) {
      // A tap asks again, since room changes: it keeps them if they fit by then, and says so if they do not.
      const sub = noRoomWords(bytes, o.room ?? 0);
      return { kind: 'noRoom', title: here, sub, help: t('offline.group.noRoomHelp'), tap: 'keep', button, ...none, size: formatBytes(bytes), blocked: sub };
    }
    // How much of the recordings would come, or that there are none yet, so a book nobody has recorded does not look
    // like a download that never starts. Their reference material comes too; its size is not known before it does.
    // Nothing to fetch with files here is not "no recordings": a book let go keeps its files until room is needed.
    // The line does not say they are here either, under "0 of 97 ready" (Carl, 2026-11-23): it says what comes.
    const sub = bytes > 0 ? t('offline.group.sizeLine', { size: formatBytes(bytes) })
      : o.cost?.files === 0 && !o.cost.here ? t('offline.group.nothingYet')
      : t('offline.group.whatComes');
    return { kind: 'none', title: here, sub, help: t('offline.group.keepHelp'), tap: 'keep', button, ...none, size: bytes > 0 ? formatBytes(bytes) : null };
  }
  // Every passage is kept: a tap lets go what the person chose, or says why none of it was a choice.
  const tap: GroupTap = g.chosen.length ? 'letGo' : 'why';
  const help = g.chosen.length ? t('offline.group.letGoHelp') : t('offline.group.reason');
  // What cannot come does not keep a passage from being ready, and is said here, as on its own line: a recording its
  // phone has not sent first, since nothing plays it anywhere until it is (decision 61, amended 2026-11-23), then
  // reference audio that cannot be downloaded now.
  const missing = g.unsent ? t('offline.group.unsent') : g.referenceMissing ? t('offline.group.referenceMissing') : null;
  if (g.ready === g.count) {
    const note = g.unsent ? t('offline.group.unsentShort') : g.referenceMissing ? t('offline.group.referenceMissingShort') : null;
    return { kind: 'ready', title: here, sub: missing ?? (g.chosen.length ? t('offline.group.allHereSub') : help), help, tap, button, ...none, note };
  }
  if (o.downloading && !o.offline) {
    return { kind: 'downloading', title: t('offline.passage.downloadingCount', { here: g.ready, total: g.count }), sub: t('offline.stayConnected'), help, tap, button, ...none };
  }
  return { kind: 'partial', title: here, sub: o.offline ? t('offline.connectToFinish') : t('offline.group.stillToCome'), help, tap, button, ...none };
}

/** Would this much audio fit in the room the device has to spare (`BlobStore.roomBytes`)? A device that cannot say (`null`) is not held back. */
export function fits(bytes: number, room: number | null): boolean {
  return room === null || bytes <= room;
}

/** What a tap says when the passages would not fit: asked again at the tap, since room changes. */
export function noRoomWords(bytes: number, room: number): string {
  return t('map.joinSentences', { first: t('offline.group.noRoom'), next: t('offline.group.noRoomNeeds', { size: formatBytes(bytes), room: formatBytes(room) }) });
}

/** A group's two lines, as one spoken label: a first line that already ends a sentence ("Checking this device…") takes no second stop. */
export function groupSpoken(look: GroupLook): string {
  return /[.…!?。]$/.test(look.title.trim()) ? [look.title, look.sub].join(' ') : t('map.joinSentences', { first: look.title, next: look.sub });
}

/**
 * Of a group's passages, those kept because they are the person's work
 * (asked of them, or worked on): what letting the group go leaves kept. Not
 * those never kept, which a book only partly downloaded also has.
 */
export function workKept(g: GroupOffline): number {
  return g.count - g.toKeep.length - g.chosen.length;
}

/** What letting a group go says: its audio may go, and how many passages stay kept because they are the person's work. */
export function letGoWords(g: GroupOffline): string {
  const stay = workKept(g);
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
