import { describe, expect, it } from 'vitest';
import { iconCounts, standingIcon, syncStanding } from '../src/sync/syncStanding';

describe('the sync icon', () => {
  it('counts as "to send" the events and recordings waiting to go up, never what is coming down', () => {
    expect(iconCounts({ pending: 1, orgPending: 0, pendingUp: 0, pendingDown: 25 }).toSend).toBe(1);
    expect(iconCounts({ pending: 2, orgPending: 3, pendingUp: 4, pendingDown: 0 }).toSend).toBe(9);
    expect(iconCounts({ pending: 0, orgPending: 0, pendingUp: 0, pendingDown: 0 }).toSend).toBe(0);
  });

  it('turns its ring while recordings come down, with nothing to send', () => {
    expect(iconCounts({ pending: 0, orgPending: 0, pendingUp: 0, pendingDown: 25 })).toEqual({ toSend: 0, inFlight: 25 });
    expect(iconCounts({ pending: 1, orgPending: 0, pendingUp: 2, pendingDown: 4 })).toEqual({ toSend: 3, inFlight: 7 });
  });

  it('draws each state with a glyph of its own, not by the dot\'s colour alone (UI audit, finding 83)', () => {
    const glyphs = (['live', 'checking', 'offline', 'refused', 'tooOld'] as const).map(standingIcon);
    expect(glyphs).toEqual(['onPhone', 'cloud', 'notOnPhone', 'cloudAlert', 'cloudDown']);
    expect(new Set(glyphs).size).toBe(5);
  });

  it('says an app too old to receive is that, not refused, unless the account itself was refused (UI audit, finding 119)', () => {
    const at = (p: Partial<Parameters<typeof syncStanding>[0]>) => syncStanding({ refused: null, tooOld: false, refusedEvents: 0, online: true, live: true, ...p } as Parameters<typeof syncStanding>[0]);
    expect(at({ tooOld: true })).toBe('tooOld');
    expect(at({ tooOld: true, refusedEvents: 2 })).toBe('tooOld');
    expect(at({ tooOld: true, refused: 'NOT_MEMBER' })).toBe('refused');
    expect(at({ refusedEvents: 1 })).toBe('refused');
    expect(at({ online: false })).toBe('offline');
  });
});
