/**
 * Names from checked chains (docs/nearby-sync-plan.md 14.1, 5 "Teammates"): someone let in
 * offline has no profile on the server until their phone first reaches it, so teammates show
 * them under the name in their chain, which the inviter's phone signed. Kept apart from the
 * directory, which a read from the server replaces whole, and laid under it, so the server's
 * name wins once it has one. Pure, so it is tested on its own (test/chainNames.test.ts).
 */

/** How many are kept: the newest, since a name is only needed until that person's first contact. */
export const CHAIN_NAMES_KEPT = 200;

/** The directory with chain names under it: a chain fills only who the directory has no name for. */
export function withChainNames(directory: Record<string, string>, chain: Record<string, string>): Record<string, string> {
  return { ...chain, ...directory };
}

/**
 * The names held with this one kept as the join took it (1 to 80 characters, no control
 * characters, as `joinName`), newest last; null when nothing changes or the name is not one a
 * join could have given.
 */
export function keepChainName(held: Record<string, string>, profileId: string, name: string): Record<string, string> | null {
  const kept = name.trim().replace(/\s+/g, ' ');
  if (!profileId || kept.length < 1 || kept.length > 80 || /[\u0000-\u001f\u007f]/.test(kept)) return null;
  if (held[profileId] === kept) return null;
  const rest = Object.entries(held).filter(([id]) => id !== profileId);
  return Object.fromEntries([...rest.slice(-(CHAIN_NAMES_KEPT - 1)), [profileId, kept]]);
}

/**
 * The names held with each of these kept in turn (`keepChainName`): a session's names from
 * Hello, batches and holdings entries, or the people let in offline whose names a starting copy
 * brought (2026-11-24, review item 12). Null when nothing changes. Only the newest
 * `CHAIN_NAMES_KEPT` are looked at, since no more could stay: a teammate's copy may name tens of
 * thousands, and each costs a record rebuilt on the JS thread during the join.
 */
export function keepChainNames(held: Record<string, string>, names: readonly { profileId: string; name: string }[]): Record<string, string> | null {
  let now: Record<string, string> | null = null;
  for (const { profileId, name } of names.slice(-CHAIN_NAMES_KEPT)) now = keepChainName(now ?? held, profileId, name) ?? now;
  return now;
}

/**
 * Of a starting copy's names, those its organization's members do not list: people let in
 * offline whose work the language carries, never the person themselves (review item 12). The server's directory, which
 * replaces the copy's names at the first download, does not know them until their own phone
 * reaches it, so they are kept as chain names, laid under it.
 */
export function namesNotMembers(names: Record<string, string>, members: Record<string, unknown>, self: string): { profileId: string; name: string }[] {
  // No more than are kept: the copy's sender may be broken or hostile (the review of item 12's fix).
  return Object.entries(names).filter(([id]) => id !== self && !Object.prototype.hasOwnProperty.call(members, id)).slice(-CHAIN_NAMES_KEPT)
    .map(([profileId, name]) => ({ profileId, name }));
}
