// What an Inbox badge says when a count could not load (LAN-221). Pure.

/** A count of something on the server: a number once read, null when the last read failed or none has worked yet. */
export type KnownCount = number | null;

/**
 * Add the counts that make up one badge. `unsure` is true when any of them
 * could not be read, so the badge never claims "nothing waiting" (or an old
 * number) when the truth is that the server could not be asked.
 */
export function badgeTotal(local: number, remote: KnownCount[]): { total: number; unsure: boolean } {
  let total = local;
  let unsure = false;
  for (const n of remote) { if (n === null) unsure = true; else total += n; }
  return { total, unsure };
}

/** The badge's text: a count, "n+" when more may wait, "?" when nothing is known. Null when there is nothing to show. */
export function badgeShape(count: number, unsure: boolean): { kind: 'none' } | { kind: 'count'; n: number } | { kind: 'atLeast'; n: number } | { kind: 'unknown' } {
  if (unsure) return count > 0 ? { kind: 'atLeast', n: count } : { kind: 'unknown' };
  return count > 0 ? { kind: 'count', n: count } : { kind: 'none' };
}
