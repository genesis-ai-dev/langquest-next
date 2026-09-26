/**
 * Pure rules for the Inbox's Unread / Earlier split and the tab badge. Read
 * state is per device (AsyncStorage `inbox-read:{actor}`); the items are
 * derived (core `deriveInbox`) or server rows (`notifications`).
 */

/** Minimal shape of a server notification row the inbox needs. */
export interface RemoteRow { id: string; org_id: string; project_id: string; kind: string; task_id: string | null }

/**
 * Server rows the inbox lists. A task row in the open project repeats an item
 * `deriveInbox` already lists from the log, so only join requests and rows
 * from other projects are shown.
 */
export function visibleRemote<T extends RemoteRow>(rows: T[], orgId: string, projectId: string): T[] {
  return rows.filter((r) => r.kind === 'join_request' || r.org_id !== orgId || r.project_id !== projectId);
}

/** Split ids into unread and earlier, keeping the given order in each. */
export function splitByRead<T extends { id: string }>(items: T[], read: readonly string[]): { unread: T[]; earlier: T[] } {
  const seen = new Set(read);
  return { unread: items.filter((i) => !seen.has(i.id)), earlier: items.filter((i) => seen.has(i.id)) };
}

