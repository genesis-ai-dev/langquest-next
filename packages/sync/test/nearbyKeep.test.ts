import { NEARBY_LISTED_KEPT, nearbyDayOf, nearbyFirstDayWithin, nearbyGreetDue, nearbyKeepOf, type NearbyMeta } from '../src/nearbyKeep';

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

// The review of 2026-11-24, item 7: a pass lets in `maxUses` people, and this phone is its only user, so it counts them.
// 2026-11-25: a pair's record also keeps the fingerprint of the files this phone held when the two finished, so a file gained
// since makes them meet again. A record from before it has none, and still counts.
describe('the record of a pair that finished', () => {
  it('keeps the files fingerprint, reads a record without one, and drops one whose fingerprint is not text', async () => {
    const meta = metaOf();
    const keep = nearbyKeepOf(meta, { orgId: 'o1', streamId: 'L1' });
    await keep.recordPeer({ tag: 't1', gen: 1, mine: 'aaaaaaaa', theirs: 'bbbbbbbb', files: '3:abc:def' });
    expect(await keep.peers()).toEqual([{ tag: 't1', gen: 1, mine: 'aaaaaaaa', theirs: 'bbbbbbbb', files: '3:abc:def' }]);
    const key = [...meta.rows.keys()].find((k) => k.includes('eers'))!;
    meta.rows.set(key, JSON.stringify([{ tag: 't1', gen: 1, mine: 'a', theirs: 'b' }, { tag: 't2', gen: 1, mine: 'a', theirs: 'b', files: 7 }]));
    expect(await keep.peers()).toEqual([{ tag: 't1', gen: 1, mine: 'a', theirs: 'b' }]);
  });
});

describe('the people a phone let in under each pass', () => {
  it('counts each person once, stops at the pass\'s count, keeps a few passes, and reads a damaged row as nothing', async () => {
    const meta = metaOf();
    const keep = nearbyKeepOf(meta, { orgId: 'o1', streamId: 'L1' });
    expect(await keep.letIn('pass-1')).toEqual([]);
    expect(await keep.noteLetIn('pass-1', 'p1', 2)).toBe(true);
    expect(await keep.noteLetIn('pass-1', 'p1', 2)).toBe(true);
    expect(await keep.noteLetIn('pass-1', 'p2', 2)).toBe(true);
    expect(await keep.noteLetIn('pass-1', 'p3', 2)).toBe(false);
    // Someone already in is still in, on a link that dropped and came again.
    expect(await keep.noteLetIn('pass-1', 'p2', 2)).toBe(true);
    expect(await keep.letIn('pass-1')).toEqual(['p1', 'p2']);
    // Per language: another language's pass is its own.
    expect(await nearbyKeepOf(meta, { orgId: 'o1', streamId: 'L2' }).letIn('pass-1')).toEqual([]);
    for (let i = 2; i <= 10; i += 1) await keep.noteLetIn(`pass-${i}`, 'p1', 10);
    expect((JSON.parse(meta.rows.get('nearbyLetIn:o1/L1')!) as unknown[]).length).toBe(8);
    expect(await keep.letIn('pass-1')).toEqual([]);
    expect(await keep.letIn('pass-10')).toEqual(['p1']);
    for (const raw of ['nope', '{"pass-10":["p1"]}', '[["pass-10",[1]]]', '[null]']) {
      meta.rows.set('nearbyLetIn:o1/L1', raw);
      expect(await keep.letIn('pass-10'), raw).toEqual([]);
    }
  });
});

describe('the documents a language\'s earlier lists named (review item 17)', () => {
  const hash = (n: number) => n.toString(16).padStart(64, '0');

  it('keeps each once, newest first, per language, writes only when something is new, and keeps no more than its bound', async () => {
    const meta = metaOf();
    const keep = nearbyKeepOf(meta, { orgId: 'o', streamId: 'l1' });
    const other = nearbyKeepOf(meta, { orgId: 'o', streamId: 'l2' });
    await keep.noteListedDocs!([hash(1), hash(2), hash(1)]);
    await keep.noteListedDocs!([hash(3), hash(2)]);
    expect(await keep.listedDocs!()).toEqual([hash(3), hash(1), hash(2)]);
    expect(await other.listedDocs!()).toEqual([]);
    const writes = meta.rows.get('nearbyListed:o/l1');
    meta.rows.set('nearbyListed:o/l1', writes!);
    await keep.noteListedDocs!([hash(1)]);
    expect(meta.rows.get('nearbyListed:o/l1')).toBe(writes);
    await keep.noteListedDocs!(Array.from({ length: NEARBY_LISTED_KEPT + 10 }, (_, i) => hash(100 + i)));
    expect(await keep.listedDocs!()).toHaveLength(NEARBY_LISTED_KEPT);
  });

  it('reads a damaged row as nothing, and anything that is not a hash as not there', async () => {
    const meta = metaOf();
    const keep = nearbyKeepOf(meta, { orgId: 'o', streamId: 'l1' });
    meta.rows.set('nearbyListed:o/l1', 'nope');
    expect(await keep.listedDocs!()).toEqual([]);
    meta.rows.set('nearbyListed:o/l1', JSON.stringify(['../x', 5, hash(1)]));
    expect(await keep.listedDocs!()).toEqual([hash(1)]);
    await keep.noteListedDocs!(['not a hash']);
    expect(await keep.listedDocs!()).toEqual([hash(1)]);
  });
});
