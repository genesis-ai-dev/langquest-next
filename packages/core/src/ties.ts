import type { EventEnvelope } from './events';

/**
 * Does this event come before what a create-once entry holds (a unit, a
 * recording, a take, a response, a key term, its rendering, adjustment or
 * link to a take, a submission, a material)? The earliest clock wins; a
 * tie, which only a buggy or hostile client makes, is broken by author and
 * content, so every order folds the same (invariant 2).
 */
export function earlier(event: EventEnvelope, content: object, prior: { hlc: string; actorId: string }, priorContent: object, actorId = event.actorId): boolean {
  if (event.hlc !== prior.hlc) return event.hlc < prior.hlc;
  return tieWins(content, prior, priorContent, actorId);
}

/**
 * Does this event replace what a register holds (an invite, a join
 * decision)? The later clock wins; a tie is broken as `earlier` breaks it.
 */
export function later(event: EventEnvelope, content: object, prior: { hlc: string; actorId: string }, priorContent: object, actorId = event.actorId): boolean {
  if (event.hlc !== prior.hlc) return event.hlc > prior.hlc;
  return tieWins(content, prior, priorContent, actorId);
}

/** At the same clock, the lower author and content win, whichever arrived first. */
function tieWins(content: object, prior: { actorId: string }, priorContent: object, actorId: string): boolean {
  return `${actorId}\n${stable(content)}` < `${prior.actorId}\n${stable(priorContent)}`;
}

/** JSON with keys sorted and undefined fields left out, so equal content compares equal. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
