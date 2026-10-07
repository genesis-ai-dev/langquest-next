/**
 * List and detail side by side on a desktop-wide window (decisions.md 55).
 * Nothing here is a new screen or a new edge: the split is read off the
 * stack. When the screen on top was opened from a list that splits, the list
 * is drawn in a pane on the left and the stack on the right, and a tap in the
 * pane navigates as if the list were on top, along the list's own edges in
 * flow.ts. Pure, so it is tested without a device.
 */
import type { Mode, ScreenId } from './flow';
import type { IconName } from './kit';

export interface PaneRoute {
  screen: ScreenId;
  params?: Record<string, string>;
  key?: string;
}

export interface SplitSpec {
  list: ScreenId;
  /** Screens the list opens that sit beside it. Each is a push edge from the list (panes.test.ts). */
  details: readonly ScreenId[];
  /** What the right side shows while nothing is open. A hub with none keeps its single column until something is. */
  empty?: { icon: IconName; title: string; sub: string };
}

export const SPLITS: readonly SplitSpec[] = [
  { list: 'status_home', details: ['map_home'] },
  { list: 'map_home', details: ['book_map', 'passage_record'], empty: { icon: 'book', title: 'Pick a book', sub: 'Its chapters open here.' } },
  { list: 'book_map', details: ['passage_record'], empty: { icon: 'map', title: 'Pick a chapter', sub: 'Its passage opens here.' } },
  { list: 'inbox_home', details: ['passage_record', 'edit_member', 'members_list'], empty: { icon: 'inbox', title: 'Pick an update', sub: 'What it is about opens here.' } },
  { list: 'members_list', details: ['edit_member'], empty: { icon: 'people', title: 'Pick a member', sub: 'Their role opens here.' } },
  { list: 'roles_home', details: ['role_editor'], empty: { icon: 'user', title: 'Pick a role', sub: 'It opens here to edit.' } },
  { list: 'flows_home', details: ['flow_editor'], empty: { icon: 'flow', title: 'Pick a flow', sub: 'It opens here to edit.' } },
  { list: 'templates_home', details: ['template_editor'], empty: { icon: 'template', title: 'Pick a template', sub: 'It opens here to edit.' } },
  { list: 'reference_home', details: ['material_editor'], empty: { icon: 'folder', title: 'Pick reference material', sub: 'It opens here to edit.' } },
  { list: 'reference_bibles', details: ['reference_source'], empty: { icon: 'book', title: 'Pick a Bible', sub: 'What it offers opens here.' } },
  { list: 'reference_guides', details: ['material_editor'], empty: { icon: 'sparkle', title: 'Pick a guide or note', sub: 'It opens here.' } },
  { list: 'reference_coverage', details: ['passage_reference'], empty: { icon: 'map', title: 'Pick a passage', sub: 'Its reference opens here.' } },
  { list: 'review_teams', details: ['review_team_editor'], empty: { icon: 'people', title: 'Pick a team', sub: 'It opens here to edit.' } },
  { list: 'key_terms', details: ['key_term_detail'], empty: { icon: 'book', title: 'Pick a term', sub: 'Its meaning and renderings open here.' } },
  { list: 'org_home', details: ['language_home'] }
];

interface Split<R extends PaneRoute = PaneRoute> {
  /** Drawn in the pane. */
  list: R;
  listIndex: number;
  /** On top of the stack, beside the list; null while nothing is open. */
  detail: R | null;
  empty?: SplitSpec['empty'];
}

/**
 * The split for this stack, or null for a single column. The screen under
 * the top wins when it is a list that opened the top; otherwise a list on
 * top shows itself beside its empty state.
 */
export function paneFor<R extends PaneRoute>(stack: readonly R[]): Split<R> | null {
  const t = stack.length - 1;
  if (t < 0) return null;
  const top = stack[t]!;
  const under = t > 0 ? stack[t - 1]! : undefined;
  if (under) {
    const spec = SPLITS.find((s) => s.list === under.screen && s.details.includes(top.screen));
    if (spec) return { list: under, listIndex: t - 1, detail: top, ...(spec.empty ? { empty: spec.empty } : {}) };
  }
  const own = SPLITS.find((s) => s.list === top.screen && s.empty);
  if (own?.empty) return { list: top, listIndex: t, detail: null, empty: own.empty };
  return null;
}

/**
 * The stack after moving from `routes[at]` as if it were on top: what a tap
 * in the list pane does. Routes kept keep their keys, so React Navigation
 * leaves them mounted. Mirrors nav.ts: popTo goes back to the nearest match
 * at or below `at`, merging params, and replaces `routes[at]` when there is none.
 */
export function routesAfter<R extends { name: string; key?: string; params?: object }>(
  routes: readonly R[], at: number, mode: Mode, next: R
): R[] {
  switch (mode) {
    case 'push': return [...routes.slice(0, at + 1), next];
    case 'replace': return [...routes.slice(0, at), next];
    case 'reset': return [next];
    case 'back': return at === 0 ? routes.slice(0, at + 1) : routes.slice(0, at);
    case 'popTo': {
      for (let j = at; j >= 0; j--) {
        const r = routes[j]!;
        if (r.name !== next.name) continue;
        const params = next.params ? { ...(r.params ?? {}), ...next.params } : r.params;
        return [...routes.slice(0, j), { ...r, ...(params ? { params } : {}) }];
      }
      return [...routes.slice(0, at), next];
    }
  }
}
