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
