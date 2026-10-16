/**
 * What became of a join request the server has, as far as the person who
 * asked can tell: the organizations they now belong to (`my_organizations`)
 * and whether their own request is still open (they may read it,
 * `join_requests_read`). The decision is not theirs to read: it is in the
 * organization's stream. Accepting deletes the request and adds the
 * membership in one transaction, so a request that is gone while they
 * belong nowhere was turned away.
 */
export type RequestOutcome =
  | { kind: 'waiting' }
  | { kind: 'joined'; orgId: string }
  | { kind: 'declined' };

export function requestOutcome(orgId: string, memberOf: readonly string[], stillOpen: boolean): RequestOutcome {
  // Any organization will do: someone here belongs to none, so the one they
  // asked for, else one they joined another way (an invite on the web).
  if (memberOf.includes(orgId)) return { kind: 'joined', orgId };
  if (memberOf.length > 0) return { kind: 'joined', orgId: memberOf[0]! };
  return stillOpen ? { kind: 'waiting' } : { kind: 'declined' };
}

/** What `latestRequest` reads of an account-outbox action. */
interface RequestLike { kind: string; status: string; payload: Record<string, unknown> }

/**
 * The join request someone made last, which "Join your team" is about. The
 * outbox keeps unsent actions before sent ones, so the last in the list is
 * not the newest: after asking again, the old, declined request came last
 * and the screen went on saying no. Requests carry when they were asked
 * (`askedAt`); older ones, without it, count as oldest, in list order.
 * A request the server refused is never shown as waiting.
 */
export function latestRequest<T extends RequestLike>(actions: readonly T[]): T | undefined {
  let best: T | undefined;
  let bestAt = -Infinity;
  for (const a of actions) {
    if (a.kind !== 'join_request' || a.status === 'failed') continue;
    const at = typeof a.payload['askedAt'] === 'number' ? a.payload['askedAt'] as number : -1;
    if (at >= bestAt) { best = a; bestAt = at; }
  }
  return best;
}
