import { nearbyDayOf, nearbyFirstDayWithin, nearbyGreetDue, nearbyKeepOf, type NearbyMeta } from '../src/nearbyKeep';

/**
 * `nearbyMet:<org>` (docs/nearby-sync-plan.md 15.8, decision 230 as amended). Why: it says who
 * was together and when, so it holds only the day and never one older than the window; and a
 * gathering on Share nearby must greet every pair before their days run out.
 */

const DAY = 86_400_000;
const WINDOW = 14 * DAY;

function metaOf(): NearbyMeta & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return {
    rows,
    nearbyMeta: async (key) => rows.get(key) ?? null,
    writeNearbyMeta: async (written) => { for (const [k, v] of Object.entries(written)) rows.set(k, v); }
  };
}

describe('the days teammates were met on Share nearby', () => {
  it('a day counts from its start: the first day within the window began no longer than it before now', () => {
    const now = 20_000 * DAY + 5 * 3_600_000;
    expect(nearbyDayOf(now)).toBe(20_000);
    // Fourteen days back from five in the morning is five in the morning: that day began before, so it is out.
    expect(nearbyFirstDayWithin(now, WINDOW)).toBe(19_987);
    expect(nearbyFirstDayWithin(20_000 * DAY, WINDOW)).toBe(19_986);
  });

  it('keeps one line a teammate, per organization, forgets days before the window as it reads or writes, and reads a damaged row as nothing', async () => {
    const meta = metaOf();
    const keep = nearbyKeepOf(meta, { orgId: 'o1', streamId: 'L1' });
    const other = nearbyKeepOf(meta, { orgId: 'o1', streamId: 'L2' });
    await keep.noteMet({ key: 'k1', profileId: 'p1', day: 100 }, 90);
    await keep.noteMet({ key: 'k2', profileId: 'p2', day: 95 }, 90);
    await keep.noteMet({ key: 'k1', profileId: 'p1', day: 101 }, 90);
    // Another language of the organization reads the same days: a certificate is the organization's.
    expect(await other.met(90)).toEqual([{ key: 'k2', profileId: 'p2', day: 95 }, { key: 'k1', profileId: 'p1', day: 101 }]);
    expect([...meta.rows.keys()]).toEqual(['nearbyMet:o1']);
    // Read with a later start, the older day goes from the row too.
    expect(await keep.met(96)).toEqual([{ key: 'k1', profileId: 'p1', day: 101 }]);
    expect(JSON.parse(meta.rows.get('nearbyMet:o1')!)).toEqual([{ key: 'k1', profileId: 'p1', day: 101 }]);
    // Nothing but the key, the person and the day is written, whatever is passed.
    await keep.noteMet({ key: 'k3', profileId: 'p3', day: 102, where: 'village' } as never, 96);
    expect(JSON.parse(meta.rows.get('nearbyMet:o1')!)[1]).toEqual({ key: 'k3', profileId: 'p3', day: 102 });
    for (const raw of ['nope', '{"k1":1}', '[{"key":"k","profileId":"p","day":"1"}]', '[null,1]']) {
      meta.rows.set('nearbyMet:o1', raw);
      expect(await keep.met(0), raw).toEqual([]);
    }
  });

  it('Share nearby greets a teammate not met on a day within half the window, and one whose key it does not know yet', () => {
    const now = 20_000 * DAY + 3_600_000;
    const due = nearbyGreetDue([{ key: 'recent', profileId: 'p', day: 19_994 }, { key: 'old', profileId: 'p', day: 19_992 }], now, WINDOW);
    expect(due('recent')).toBe(false);
    expect(due('old')).toBe(true);
    expect(due('never')).toBe(true);
    expect(due(null)).toBe(true);
  });
});
