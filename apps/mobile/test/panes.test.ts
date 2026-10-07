import { edgeFor, SCREEN_IDS, type ScreenId } from '../src/flow';
import { paneFor, routesAfter, SPLITS, type PaneRoute } from '../src/panes';

const r = (screen: ScreenId, key = screen): PaneRoute => ({ screen, key });
const shape = (stack: PaneRoute[]) => {
  const s = paneFor(stack);
  return s ? { list: s.list.screen, detail: s.detail?.screen ?? null } : null;
};

describe('list and detail panes (decisions.md 55)', () => {
  it('add no screens and no edges: every pair is a push edge the list already has', () => {
    for (const s of SPLITS) {
      expect(SCREEN_IDS, s.list).toContain(s.list);
      for (const d of s.details) {
        expect(SCREEN_IDS, d).toContain(d);
        const edge = edgeFor(s.list, d);
        expect(edge, `${s.list} -> ${d}`).toBeDefined();
        expect(edge?.mode ?? 'push', `${s.list} -> ${d}`).toBe('push');
      }
    }
  });

  it('read the split off the stack', () => {
    expect(shape([r('map_home')])).toEqual({ list: 'map_home', detail: null });
    expect(shape([r('status_home'), r('map_home')])).toEqual({ list: 'status_home', detail: 'map_home' });
    expect(shape([r('map_home'), r('book_map')])).toEqual({ list: 'map_home', detail: 'book_map' });
    expect(shape([r('map_home'), r('book_map'), r('passage_record')])).toEqual({ list: 'book_map', detail: 'passage_record' });
    expect(shape([r('map_home'), r('passage_record')])).toEqual({ list: 'map_home', detail: 'passage_record' });
    expect(shape([r('inbox_home'), r('passage_record')])).toEqual({ list: 'inbox_home', detail: 'passage_record' });
    expect(shape([r('inbox_home'), r('members_list'), r('edit_member')])).toEqual({ list: 'members_list', detail: 'edit_member' });
    expect(shape([r('org_home'), r('language_home')])).toEqual({ list: 'org_home', detail: 'language_home' });
    expect(shape([r('roles_home'), r('role_editor')])).toEqual({ list: 'roles_home', detail: 'role_editor' });
  });

  it('fall back to one column where nothing splits', () => {
    expect(paneFor([])).toBeNull();
    expect(shape([r('my_work'), r('passage_record')])).toBeNull();
    expect(shape([r('map_home'), r('book_map'), r('passage_record'), r('version_detail')])).toBeNull();
    expect(shape([r('org_home')])).toBeNull();
    expect(shape([r('status_home')])).toBeNull();
    expect(shape([r('passage_record'), r('workspace')])).toBeNull();
  });

  it('carry the list route, with its key and params, into the pane', () => {
    const list = { screen: 'book_map' as const, key: 'b-1', params: { bookId: 'GEN', languageId: 'l1' } };
    const s = paneFor([r('map_home', 'm-1'), list, r('passage_record', 'p-1')]);
    expect(s?.list).toBe(list);
    expect(s?.listIndex).toBe(1);
    expect(s?.empty?.title).toBe('Pick a chapter');
  });
});

describe('moving from the list pane', () => {
  type R = { name: string; key?: string; params?: Record<string, string> };
  const routes: R[] = [{ name: 'map_home', key: 'm' }, { name: 'book_map', key: 'b', params: { bookId: 'GEN' } }, { name: 'passage_record', key: 'p' }];
  const next: R = { name: 'passage_record', params: { unitId: 'u2' } };

  it('push replaces whatever was open beside the list, keeping the routes below', () => {
    expect(routesAfter(routes, 1, 'push', next)).toEqual([routes[0], routes[1], next]);
    expect(routesAfter(routes, 0, 'push', { name: 'book_map' })).toEqual([routes[0], { name: 'book_map' }]);
  });

  it('replace, reset and back act on the list as if it were on top', () => {
    expect(routesAfter(routes, 1, 'replace', next)).toEqual([routes[0], next]);
    expect(routesAfter(routes, 1, 'reset', next)).toEqual([next]);
    expect(routesAfter(routes, 1, 'back', next)).toEqual([routes[0]]);
    expect(routesAfter(routes, 0, 'back', next)).toEqual([routes[0]]);
  });

  it('popTo goes back to the nearest match below, merging params and keeping its key', () => {
    expect(routesAfter(routes, 1, 'popTo', { name: 'map_home', params: { languageId: 'l1' } }))
      .toEqual([{ name: 'map_home', key: 'm', params: { languageId: 'l1' } }]);
    expect(routesAfter(routes, 1, 'popTo', { name: 'book_map' })).toEqual([routes[0], routes[1]]);
    // Not below the list: replace the list with it, as nav.popTo does.
    expect(routesAfter(routes, 1, 'popTo', { name: 'org_home' })).toEqual([routes[0], { name: 'org_home' }]);
  });
});
