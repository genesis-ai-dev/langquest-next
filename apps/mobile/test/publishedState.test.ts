import { HlcClock } from '@langquest-next/core';
import { MemoryStore } from '../../../packages/client/src/memoryStore';
import { SyncClient } from '../../../packages/client/src/syncClient';
import { FakeServer } from '../../../packages/client/src/testing/fakeServer';
import { stateCopier } from '../src/publishedState';

const unit = (i: number) => ({ unitId: `u${i}`, parentUnitId: null, kind: 'passage', label: `P${i}`, order: `a${i}` });

describe('the state copy screens render from', () => {
  it('is made once per change to the fold, not once per publish', async () => {
    // Why: each copy rebuilds every mounted screen's indexes, 8 ms at
    // 1,200 passages on a laptop, more on a phone (performance-audit.md item 2).
    const server = new FakeServer();
    let n = 0;
    const client = new SyncClient({
      orgId: 'org1', streamId: 'p1', actorId: 'lead', deviceId: 'dA', store: new MemoryStore(),
      transport: server.transportFor(), clock: new HlcClock('dA', () => ++n), newId: () => `e${++n}`
    });
    await client.load();
    const copy = stateCopier();
    let publishes = 0;
    let copies = 0;
    client.subscribe((s) => { publishes++; if (copy(s.state, s.revision)) copies++; });
    // What useLanguage did for an append: the client's publishes, then refresh().
    for (let i = 0; i < 5; i++) {
      await client.append('v1.UnitAdded', unit(i));
      if (copy(client.getState(), client.publishedRevision)) copies++;
    }
    expect(publishes).toBeGreaterThanOrEqual(10);
    expect(copies).toBe(5);
    // Syncing back its own events folds nothing new: at most the one copy
    // for the pulled page, none for a sync that pulls nothing.
    copies = 0;
    await client.sync();
    await client.sync();
    if (copy(client.getState(), client.publishedRevision)) copies++;
    expect(copies).toBeLessThanOrEqual(1);
  });

  it('copies when the client folds a fresh state object', () => {
    const copy = stateCopier();
    const a = { units: {} } as never;
    const b = { units: {} } as never;
    expect(copy(a, 1)).not.toBeNull();
    expect(copy(a, 1)).toBeNull();
    expect(copy(a, 2)).not.toBeNull();
    expect(copy(b, 2)).not.toBeNull();
  });
});
