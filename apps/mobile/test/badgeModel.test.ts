import { describe, expect, it } from 'vitest';
import { badgeShape, badgeTotal } from '../src/shell/badgeModel';
import { tabsFor } from '../src/shell/session';
import { roleSession } from './sessions';

// LAN-221: an Inbox badge must not say "nothing waiting" when the server could not be asked.
describe('Inbox badge when a count cannot load', () => {
  it('adds the counts that loaded and says it is unsure when one did not', () => {
    expect(badgeTotal(2, [3, 1])).toEqual({ total: 6, unsure: false });
    expect(badgeTotal(2, [3, null])).toEqual({ total: 5, unsure: true });
    expect(badgeTotal(0, [null, null])).toEqual({ total: 0, unsure: true });
  });
  it('shows a number, a number with a plus, a question mark, or nothing', () => {
    expect(badgeShape(0, false)).toEqual({ kind: 'none' });
    expect(badgeShape(4, false)).toEqual({ kind: 'count', n: 4 });
    expect(badgeShape(4, true)).toEqual({ kind: 'atLeast', n: 4 });
    expect(badgeShape(0, true)).toEqual({ kind: 'unknown' });
  });
  it('reaches the Inbox tab', () => {
    const viewer = roleSession('viewer');
    const tab = tabsFor(viewer, { forYou: 0, unread: 0, unreadUnsure: true }).find((t) => t.id === 'inbox');
    expect(tab?.badgeUnsure).toBe(true);
    expect(tabsFor(viewer, { forYou: 0, unread: 0 }).find((t) => t.id === 'inbox')?.badgeUnsure ?? false).toBe(false);
  });
});
