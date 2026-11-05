/** Webhook organizations woken at once by the catch-up; each wake starts a Durable Object. */
export const POKES_AT_ONCE = 20;

/**
 * Wake `orgs` a batch at a time, so a hundred webhook organizations do not
 * all start at once. A batch that fails still lets the later ones run; the
 * first failure is thrown at the end.
 */
export async function pokeInBatches(orgs: readonly string[], poke: (orgId: string) => Promise<void>, size = POKES_AT_ONCE): Promise<void> {
  let failure: { error: unknown } | null = null;
  for (let i = 0; i < orgs.length; i += size) {
    const results = await Promise.allSettled(orgs.slice(i, i + size).map(poke));
    for (const r of results) if (r.status === 'rejected') failure ??= { error: r.reason };
  }
  if (failure) throw failure.error;
}
