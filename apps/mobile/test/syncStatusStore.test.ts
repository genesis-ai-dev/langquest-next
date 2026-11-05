import { NO_LANGUAGE_STATUS, StatusStore } from '../src/sync/syncStatusStore';

describe('the ticking part of a sync status (performance-audit-app.md R1)', () => {
  it('tells listeners only when a field differs, so an unchanged tick redraws nobody', () => {
    const store = new StatusStore({ ...NO_LANGUAGE_STATUS });
    let heard = 0;
    const stop = store.subscribe(() => { heard++; });
    const before = store.get();
    store.set({ ...NO_LANGUAGE_STATUS });
    expect(heard).toBe(0);
    expect(store.get()).toBe(before);
    store.set({ ...NO_LANGUAGE_STATUS, pendingDown: 3 });
    expect(heard).toBe(1);
    expect(store.get().pendingDown).toBe(3);
    stop();
    store.set({ ...NO_LANGUAGE_STATUS, pendingDown: 2 });
    expect(heard).toBe(1);
  });
});
