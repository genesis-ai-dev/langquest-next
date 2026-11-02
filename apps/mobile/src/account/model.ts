// Pure pieces of the account screens (Inbox, Settings, Sync status): no
// React, no I/O, so they are tested on their own (test/accountModel.test.ts).
import type { LocalEvent } from '@langquest-next/sync';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';

/**
 * The last sync, from useLanguage's `lastSync` (a diagnostic token, not
 * words: 'never', 'offline', 'up to date', 'pushed N, pulled N, rejected N',
 * 'refused: …', 'error: …').
 */
export function lastSyncText(lastSync: string): string {
  if (lastSync === 'up to date' || lastSync.startsWith('pushed ')) return t('account.more.syncUpToDate');
  if (lastSync === 'offline') return t('account.more.syncOffline');
  if (lastSync.startsWith('refused')) return t('account.more.syncRefused');
  if (lastSync.startsWith('error')) return t('account.more.syncError');
  return t('account.more.syncSaved');
}

/** Every refused event, once: the clients' own view and the log's, which also covers a language whose client is not open. */
export function refusedHere(...sources: ({ rejected: LocalEvent[] } | null)[]): LocalEvent[] {
  const byId = new Map<string, LocalEvent>();
  for (const s of sources) for (const l of s?.rejected ?? []) byId.set(l.event.id, l);
  return [...byId.values()].sort((a, b) => (a.event.hlc < b.event.hlc ? -1 : a.event.hlc > b.event.hlc ? 1 : 0));
}

/** A transfer speed in the unit that reads best: B/s, KB/s or MB/s. */
export function speed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return t('account.sync.speedB', { value: formatNumber(Math.round(bytesPerSecond)) });
  if (bytesPerSecond < 1024 * 1024) return t('account.sync.speedKB', { value: formatNumber(bytesPerSecond / 1024, { maximumFractionDigits: 0 }) });
  return t('account.sync.speedMB', { value: formatNumber(bytesPerSecond / (1024 * 1024), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
}

/**
 * The sync line under Settings: refused, recordings or changes waiting to
 * send, offline, live, or how the last sync went. Offline outranks live:
 * the live channel can take a minute to notice the network went
 * (decisions.md 166), and nothing waiting may be hidden behind "Live".
 */
export function syncSummary(p: { refused: string | null; pending: number; recordings?: number; live: boolean; online: boolean | null; lastSync: string }): string {
  const recordings = p.recordings ?? 0;
  // The same total the sync icon and the badges show (iconCounts), with the recordings in it named (UI audit, finding 118).
  return p.refused ? t('account.more.syncRefused')
    : recordings > 0 && p.pending > 0 ? t('account.more.syncPendingMixed', { total: p.pending + recordings, recordings })
    : recordings > 0 ? t('uploads.barRecordings', { count: recordings })
    : p.pending > 0 ? t('account.more.syncPending', { count: p.pending })
    : p.online === false ? t('account.more.syncOffline')
    : p.live ? t('account.more.syncLive')
    : lastSyncText(p.lastSync);
}

/** What this session could still deliver from this phone, in words; sign-out and deletion wait for it. */
export function unsentWork(w: { refused: string | null; pending: number; orgPending: number; uploads: number; accountQueued: number }): string[] {
  return [
    !w.refused && w.pending > 0 ? t('account.unsent.changes', { count: w.pending }) : null,
    w.orgPending > 0 ? t('account.unsent.orgChanges', { count: w.orgPending }) : null,
    !w.refused && w.uploads > 0 ? t('account.unsent.recordings', { count: w.uploads }) : null,
    w.accountQueued > 0 ? t('account.unsent.accountChanges', { count: w.accountQueued }) : null
  ].filter((s): s is string => s !== null);
}

/**
 * How the Inbox shows one of the server's notifications, or null when it
 * shows it another way. This organization's updates are derived from the
 * open language's record, and its join requests and reports too once they
 * are listed; the organization's other languages, and other organizations,
 * come from the server.
 */
export function remoteRowView(
  row: { org_id: string; kind: string; language_id: string | null },
  here: { orgId: string; languageId: string; requestsListed: boolean; reportsListed: boolean; mayAdmitAndAssign: boolean; mayModerate: boolean }
): 'otherOrg' | 'otherLanguage' | 'connectToSee' | 'openMembers' | null {
  const inThisOrg = row.org_id === here.orgId;
  if (inThisOrg && row.kind === 'join_request' && (here.requestsListed || !here.mayAdmitAndAssign)) return null;
  if (inThisOrg && row.kind === 'content_report' && (here.reportsListed || !here.mayModerate)) return null;
  const otherLanguage = inThisOrg && !!row.language_id && row.language_id !== here.languageId;
  if (inThisOrg && row.kind !== 'join_request' && row.kind !== 'content_report' && !otherLanguage) return null;
  return !inThisOrg ? 'otherOrg' : otherLanguage ? 'otherLanguage' : row.kind === 'content_report' ? 'connectToSee' : 'openMembers';
}

/**
 * Someone known to be in more than one organization: Switch Organization is
 * on Me itself (decision 71, amended 2026-10-14). Unknown (never listed on
 * this device) or one: it stays under More settings, where it also starts a
 * new one.
 */
export function inSeveral(orgs: readonly unknown[] | null): boolean {
  return orgs !== null && orgs.length > 1;
}
