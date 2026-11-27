/**
 * The ops dashboard's two taps on the public roadmap (docs/roadmap.md), checked here before opsActions.ts
 * acts on them: an item made or changed, and a suggestion made into an item, added to one, or hidden.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISSUE = /^[A-Z]{1,10}-[0-9]{1,7}$/;
export const ROADMAP_STATES = ['progress', 'planned', 'considering', 'done', 'hidden'] as const;
export type RoadmapItemState = (typeof ROADMAP_STATES)[number];
export const TITLE_MAX = 120;
export const BODY_MAX = 2000;
/** A picture as the dashboard made it: a data URL that fits in one action (youtube.ts ACTION_BYTES). */
export const PICTURE_MAX = 200_000;
const PICTURE = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+=*$/;

export type RoadmapAction =
  /** An item made (id null) or changed. picture: absent keeps it, null removes it, a data URL sets it. */
  | { kind: 'roadmap-item'; id: string | null; state: RoadmapItemState; title: string; body: string; issue: string | null; picture?: string | null }
  /** A new suggestion made into a new item, added to an item, or hidden. */
  | { kind: 'roadmap-suggestion'; id: string; decision: 'new' | 'add' | 'hide'; item: string | null };

/** What the dashboard sent, checked; null when it is not a roadmap action, or not a good one. */
export function parseRoadmapAction(input: unknown): RoadmapAction | null {
  if (typeof input !== 'object' || input === null) return null;
  const a = input as { kind?: unknown; id?: unknown; state?: unknown; title?: unknown; body?: unknown; issue?: unknown; picture?: unknown; decision?: unknown; item?: unknown };
  if (a.kind === 'roadmap-item') {
    const id = a.id === null || a.id === undefined ? null : typeof a.id === 'string' && UUID.test(a.id) ? a.id.toLowerCase() : undefined;
    const title = typeof a.title === 'string' ? a.title.trim() : '';
    const body = a.body === undefined || a.body === null ? '' : typeof a.body === 'string' ? a.body.trim() : undefined;
    const issue = a.issue === undefined || a.issue === null || a.issue === '' ? null : typeof a.issue === 'string' && ISSUE.test(a.issue.trim().toUpperCase()) ? a.issue.trim().toUpperCase() : undefined;
    const picture = a.picture === undefined ? undefined : a.picture === null ? null
      : typeof a.picture === 'string' && a.picture.length <= PICTURE_MAX && PICTURE.test(a.picture) ? a.picture : false;
    if (id === undefined || !title || title.length > TITLE_MAX || body === undefined || body.length > BODY_MAX || issue === undefined || picture === false
      || typeof a.state !== 'string' || !(ROADMAP_STATES as readonly string[]).includes(a.state)) return null;
    return { kind: 'roadmap-item', id, state: a.state as RoadmapItemState, title, body, issue, ...(picture === undefined ? {} : { picture }) };
  }
  if (a.kind === 'roadmap-suggestion') {
    const item = a.item === undefined || a.item === null ? null : typeof a.item === 'string' && UUID.test(a.item) ? a.item.toLowerCase() : undefined;
    if (typeof a.id !== 'string' || !UUID.test(a.id) || item === undefined || (a.decision !== 'new' && a.decision !== 'add' && a.decision !== 'hide')) return null;
    if (a.decision === 'add' && !item) return null;
    return { kind: 'roadmap-suggestion', id: a.id.toLowerCase(), decision: a.decision, item: a.decision === 'add' ? item : null };
  }
  return null;
}
