import { describe, expect, it } from 'vitest';
import { splitByRead, visibleRemote } from '../src/inboxRead';

describe('inbox read state', () => {
  it('a read item moves to Earlier and stops counting toward the badge, so the badge falls as the person catches up', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const { unread, earlier } = splitByRead(items, ['b']);
    expect(unread.map((i) => i.id)).toEqual(['a', 'c']);
    expect(earlier.map((i) => i.id)).toEqual(['b']);
  });

  it('read ids for items that no longer exist (a finished task) never hide a new item', () => {
    // Derived items vanish when the work is done; their read ids linger in storage.
    expect(splitByRead([{ id: 'new' }], ['gone', 'also-gone']).unread).toHaveLength(1);
  });
});

describe('server rows the inbox shows', () => {
  const row = (id: string, kind: string, org: string, project: string) => ({ id, kind, org_id: org, project_id: project, task_id: null });

  it('drops task rows for the open project, because deriveInbox already lists them from the log (no double count)', () => {
    const rows = [row('1', 'assignment', 'o1', 'p1'), row('2', 'assignment', 'o1', 'p2'), row('3', 'join_request', 'o1', '_org')];
    expect(visibleRemote(rows, 'o1', 'p1').map((r) => r.id)).toEqual(['2', '3']);
  });

  it('keeps join requests even in the open project: only the server knows about them', () => {
    expect(visibleRemote([row('1', 'join_request', 'o1', 'p1')], 'o1', 'p1')).toHaveLength(1);
  });
});
