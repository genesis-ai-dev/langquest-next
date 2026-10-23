import { describe, expect, it } from 'vitest';
import { iconCounts } from '../src/sync/syncStanding';

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
});
