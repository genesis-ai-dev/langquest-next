// What an Inbox badge says when a count could not load (LAN-221). Pure.

/** A count read from the server: the last number that loaded, and whether the latest read failed since. */
export interface BadgeCount { count: number; stale: boolean }

/** How soon a failed count is read again, instead of waiting for the next regular read. */
export const RETRY_MS = 15_000;

/** Add the counts that make up one badge; it is stale when any of them is. */
export function badgeTotal(local: number, remote: BadgeCount[]): { total: number; stale: boolean } {
  let total = local;
  let stale = false;
  for (const r of remote) { total += r.count; if (r.stale) stale = true; }
  return { total, stale };
}

/**
 * How the badge looks. A count that could not be refreshed keeps its last
 * number but turns grey, so it is never shown as certain; with no number
 * to show, a grey dot says something may be waiting.
 */
export function badgeShape(count: number, stale: boolean): { kind: 'none' } | { kind: 'count'; n: number; grey: boolean } | { kind: 'dot' } {
  if (count > 0) return { kind: 'count', n: count, grey: stale };
  return stale ? { kind: 'dot' } : { kind: 'none' };
}
