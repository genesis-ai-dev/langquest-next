// What Sync and offline says, as pure rules (docs/decisions/2026-11-18-sync-and-offline-one-screen.md):
// the strip's link, each fold's one line and whether it needs attention, which folds open by
// themselves, and Me's line for the screen. No React, no I/O: test/syncScreenModel.test.ts.
import { t } from '../i18n';
import { offlineCount } from '../account/meModel';
import { syncSummary } from '../account/model';
import type { InstallItem } from '../nearby/carriedApkModel';
import type { SyncStanding } from './syncStanding';

/** Where the line between phone and server stands, as the strip draws it (transit.tsx). */
export type StripLink = 'live' | 'checking' | 'offline' | 'refused';

/** A fold's summary that needs attention: amber for something to do, red for something refused. */
export type FoldTone = 'amber' | 'red' | null;

/** The folds a person can open; Downloads has nothing more to show and never opens. */
export type SyncFold = 'refused' | 'uploads' | 'ready' | 'details';

/**
 * The strip's link for the screen's standing: a solid line while live, dashed while the live
 * channel is down, broken while offline or while a sign-in waits to be renewed (nothing reaches
 * the server either way), and an alert on the server where it refuses this account or its work.
 * Too old to receive still sends its own work, so its line is the dashed one.
 */
export function stripLink(s: SyncStanding): StripLink {
  return s === 'live' ? 'live' : s === 'offline' || s === 'signIn' ? 'offline' : s === 'refused' ? 'refused' : 'checking';
}

/** One summary line of two parts, in the order each language joins them. */
export function joined(a: string, b: string | null): string {
  return b ? t('account.sync.fold.join', { a, b }) : a;
}

/**
 * Downloads' line. Offline, what is new on the server cannot be known: never "Up to date" then,
 * only the files this device already knows it must fetch (decisions.md 166). The speed shows
 * while something comes down.
 */
export function downloadsLine(o: { online: boolean | null; pendingDown: number; rate: string | null }): string {
  if (o.pendingDown > 0) return joined(t('account.sync.down.count', { count: o.pendingDown }), o.online === false ? null : o.rate);
  return o.online === false ? t('account.sync.down.offline') : t('account.more.syncUpToDate');
}

/** Uploads' line: everything uploaded and when it last went, or what waits and whether it is going up (uploadsSummary). */
export function uploadsLine(summary: { waiting: boolean; title: string; sub: string | null }, offline: boolean): { line: string; tone: FoldTone } {
  return { line: joined(summary.title, summary.sub), tone: summary.waiting && offline ? 'amber' : null };
}

/**
 * Ready for offline's line: how many kept passages are on this device and, for someone who can
 * let a new person in, whether the install file is in hand (installFileItem). Amber while either
 * still needs doing, so a person packing for a trip sees it before leaving.
 */
export function readyLine(s: { kept: number; ready: number } | null, install: InstallItem | null): { line: string; tone: FoldTone } {
  const passages = offlineCount(s);
  const passagesShort = !!s && s.kept > 0 && s.ready < s.kept;
  const file = install === null ? null : t(INSTALL_LINE[install]);
  return { line: joined(passages, file), tone: passagesShort || (install !== null && install !== 'ready') ? 'amber' : null };
}

const INSTALL_LINE = {
  ready: 'nearby.installFile.readyShort', 'not-got': 'nearby.installFile.notGot', older: 'nearby.installFile.older', downloaded: 'nearby.installFile.notChosen'
} as const satisfies Record<InstallItem, string>;

/**
 * The install file's item inside Ready for offline: whether it is done, what it says, and the one
 * way on. Getting the file needs the internet, so offline that way is a line saying so; choosing a
 * file already downloaded needs none. Ready says when to delete the file only on a phone that
 * keeps no copy (`keeps` false), where the file in Downloads is the only one (Carl, 2026-11-19),
 * and, online, that a newer file is ready when the kept copy is `behind` this phone's app.
 */
export function installBlock(install: InstallItem, keeps: boolean, offline: boolean, behind = false): {
  good: boolean; body: string; way: 'get' | 'choose' | 'newer' | 'offline' | null;
} {
  if (install === 'ready') {
    const ready = t('nearby.installFile.ready');
    // A kept copy behind this phone's app still works, so it stays ready; while online it says a newer
    // file is there to download (keptBehind, docs/decisions/2026-11-19-carried-build-refreshed-daily.md).
    // Two whole sentences, joined as offlineText's `sentences` joins them (not imported: it brings React Native into this model).
    if (behind && !offline) return { good: true, body: `${ready} ${t('nearby.installFile.newer')}`, way: 'newer' };
    return { good: true, body: keeps ? ready : `${ready} ${t('nearby.letIn.fileHelp')}`, way: null };
  }
  if (install === 'downloaded') return { good: false, body: t('nearby.installFile.downloaded'), way: 'choose' };
  return { good: false, body: t(install === 'older' ? 'nearby.installFile.old' : 'nearby.installFile.lineHelp'), way: offline ? 'offline' : 'get' };
}

/** Refused's line: how many changes the server would not take. */
export function refusedLine(count: number): string {
  return t('account.sync.fold.refusedCount', { count });
}

/**
 * Which folds are open as the screen arrives: Refused whenever there is something refused, since
 * it is the one thing to act on, and the fold a link asked for (the upload bar and Sign out's
 * "See what is waiting" ask for Uploads). Nothing else: the screen starts short.
 */
export function foldsOpenAtFirst(asked: unknown): Set<SyncFold> {
  const open = new Set<SyncFold>(['refused']);
  if (asked === 'uploads' || asked === 'ready' || asked === 'details') open.add(asked);
  return open;
}

/**
 * Me's line for Sync and offline: what needs noticing first (refused, or work waiting to send,
 * the sync icon's own count), else how ready this device is for offline. Live or offline with
 * nothing waiting is the screen's to say, not Me's.
 */
export function meSyncLine(p: {
  refused: string | null; refusedEvents: number; pending: number; recordings: number; live: boolean; online: boolean | null; lastSync: string;
  offline: { kept: number; ready: number } | null;
}): string {
  if (p.refused) return syncSummary(p);
  if (p.refusedEvents > 0) return t('account.sync.refusedCount', { n: p.refusedEvents });
  if (p.pending + p.recordings > 0) return syncSummary(p);
  return offlineCount(p.offline);
}
