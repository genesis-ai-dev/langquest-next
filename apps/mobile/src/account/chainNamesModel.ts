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
