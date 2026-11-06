import { describe, expect, it } from 'vitest';
import { badgeShape, badgeTotal } from '../src/shell/badgeModel';
import { tabsFor } from '../src/shell/session';
import { roleSession } from './sessions';

// LAN-221: an Inbox badge must not look certain when its count could not be refreshed.
describe('Inbox badge when a count cannot load', () => {
  it('adds the last counts and is stale when any read failed', () => {
    expect(badgeTotal(2, [{ count: 3, stale: false }, { count: 1, stale: false }])).toEqual({ total: 6, stale: false });
    expect(badgeTotal(2, [{ count: 3, stale: false }, { count: 1, stale: true }])).toEqual({ total: 6, stale: true });
  });
  it('shows a number, a grey number, a grey dot, or nothing', () => {
    expect(badgeShape(0, false)).toEqual({ kind: 'none' });
    expect(badgeShape(4, false)).toEqual({ kind: 'count', n: 4, grey: false });
    expect(badgeShape(4, true)).toEqual({ kind: 'count', n: 4, grey: true });
    expect(badgeShape(0, true)).toEqual({ kind: 'dot' });
  });
  it('reaches the Inbox tab', () => {
    const viewer = roleSession('viewer');
    expect(tabsFor(viewer, { forYou: 0, unread: 0, unreadStale: true }).find((t) => t.id === 'inbox')?.badgeStale).toBe(true);
    expect(tabsFor(viewer, { forYou: 0, unread: 0 }).find((t) => t.id === 'inbox')?.badgeStale).toBe(false);
  });
});
