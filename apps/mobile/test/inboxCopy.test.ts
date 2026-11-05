import { beforeEach, describe, expect, it, vi } from 'vitest';

// The phone's copy of its Inbox (notifications.ts refreshInbox). The server
// deletes a row 30 days after it went inactive, so a copy that was not
// refreshed for 25 days starts over rather than keep a row the phone would
// never hear went away.
const store = new Map<string, string>();
const pulls: number[] = [];
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => { store.set(k, v); },
    removeItem: async (k: string) => { store.delete(k); }
  }
}));
vi.mock('../src/notifications/push', () => ({ requestPushToken: async () => 'token' }));
vi.mock('../src/server/notifications', () => ({
  notificationsAfter: async (_profile: string, cursor: number) => {
    pulls.push(cursor);
    // The server still holds one active row, seq 7.
    return { data: cursor < 7 ? [{ id: 'live', seq: 7, active: true, org_id: 'o', language_id: 'L', kind: 'review', title: 't', task_id: null }] : [], error: null };
  },
  registerPushToken: async () => ({ error: null }),
  unregisterPushToken: async () => ({ error: null })
}));

const row = (id: string) => ({ id, seq: 5, active: true, org_id: 'o', language_id: 'L', kind: 'review', title: 't', task_id: null });

describe('the Inbox copy on the phone', () => {
  beforeEach(() => { store.clear(); pulls.length = 0; vi.resetModules(); });

  it('a recent copy continues from its cursor', async () => {
    store.set('inbox:me', JSON.stringify({ cursor: 5, rows: [row('old')], at: Date.now() - 60_000 }));
    const m = await import('../src/notifications/notifications');
    const rows = await m.refreshInbox('me');
    expect(pulls[0]).toBe(5);
    expect(rows.map((r) => r.id).sort()).toEqual(['live', 'old']);
  });

  it('a copy older than 25 days, or from before the date was kept, starts over', async () => {
    for (const at of [Date.now() - 26 * 24 * 60 * 60 * 1000, undefined]) {
      pulls.length = 0;
      store.set('inbox:me', JSON.stringify({ cursor: 5, rows: [row('gone')], ...(at ? { at } : {}) }));
      const m = await import('../src/notifications/notifications');
      const rows = await m.refreshInbox('me');
      expect(pulls[0]).toBe(0);
      expect(rows.map((r) => r.id)).toEqual(['live']);
    }
  });
});
