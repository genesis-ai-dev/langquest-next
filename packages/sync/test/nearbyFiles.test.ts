import { HlcClock, type BlobRef } from '@langquest-next/core';
import type { ChainLink, HoldChoice, HoldingEntry, NearbyMark, WantedFile } from '@langquest-next/core/nearby';
import { LanguageSession, type LanguageSessionOptions, type LocalFiles } from '../src/languageSession';
import { MemoryStore } from '../src/memoryStore';
import { nearbyClient } from '../src/nearbyClient';
import { nearbyFiles, type NearbyFetchFile } from '../src/nearbyFiles';
import { nearbyKeepOf } from '../src/nearbyKeep';
import { MemoryNearbyMarks } from '../src/nearbyMarks';
import { FakeServer } from '../src/testing/fakeServer';
import type { Transport } from '../src/types';

// A language session's nearby files (docs/nearby-sync-plan.md 5.6; section 8's freeing-space,
// hold and Teams rows): marks, own-file counts, level 2, a confirmed backup going, shedding and
// the third worker, over memory stores and a FakeServer.

const H = (c: string) => c.repeat(64);
const MINE = H('a');
const SAMS = H('b');
const CYS = H('c');
const KEY = (c: string) => `${c.repeat(42)}A`;
const ME_KEY = KEY('m');
const SIG = 'A'.repeat(86);
const MB = 1024 * 1024;
/** Nothing reaches the server from here, so a teammate's file is not confirmed by this phone's own upload. */
const NO_UPLOAD = async (): Promise<void> => { throw new Error('offline'); };

interface Reclaim { lists: string[][]; limits: { minFreeBytes: number; maxTotalBytes: number; uncapped?: ReadonlySet<string> } }

/** A phone's files: sizes, a free-space figure, and a reclaim that frees as the app's store does (cap from the first list only, uncapped left out). */
function phoneFiles() {
  const sizes = new Map<string, number>();
  const listeners = new Set<() => void>();
  const disk = { free: 10_000 * MB };
  const reclaims: Reclaim[] = [];
  const removed: string[] = [];
  let version = 0;
  const changed = () => { version++; for (const l of listeners) l(); };
  const drop = (hash: string) => { if (sizes.delete(hash)) disk.free += 0; };
  const files: LocalFiles & { put(hash: string, size: number): void } = {
    put(hash, size) { sizes.set(hash, size); changed(); },
    snapshot: () => new Set(sizes.keys()),
    get version() { return version; },
    sizes: () => sizes,
    sizeOf: (hash) => sizes.get(hash),
    formatOf: (hash) => (sizes.has(hash) ? 'm4a' : undefined),
    reclaim: (lists, limits) => {
      reclaims.push({ lists: lists.map((l) => l.map((r) => r.hash)), limits });
      let total = 0;
      for (const [h, n] of sizes) if (!limits.uncapped?.has(h)) total += n;
      let short = limits.minFreeBytes - disk.free;
      let over = total - limits.maxTotalBytes;
      const gone: string[] = [];
      lists.forEach((list, i) => {
        for (const { hash } of list) {
          if ((short <= 0 && (i > 0 || over <= 0)) || !sizes.has(hash) || gone.includes(hash)) continue;
          const n = sizes.get(hash)!;
          gone.push(hash);
          short -= n;
          if (i === 0) over -= n;
        }
      });
      for (const h of gone) { drop(h); disk.free += 0; }
      if (gone.length) changed();
      return gone;
    },
    onChange: (l) => { listeners.add(l); return () => { listeners.delete(l); }; }
  };
  const fetchFile: NearbyFetchFile = {
    stagingUri: (f) => `${f.hash}.${f.format}.nearby.part`,
    commit: async (f, _uri, size) => { files.put(f.hash, size); },
    discard: async () => {},
    uriOf: (f) => (sizes.has(f.hash) ? `file:${f.hash}` : null),
    freeBytes: () => disk.free,
    remove: (refs) => {
      const out = refs.map((r) => r.hash).filter((h) => sizes.has(h));
      for (const h of out) { sizes.delete(h); removed.push(h); }
      if (out.length) changed();
      return out;
    }
  };
  return { files, fetchFile, disk, reclaims, removed, sizes };
}

const unit = (label: string) => ({ unitId: label, parentUnitId: null, kind: 'passage', label, order: label });
const recording = (id: string, unitId: string, hash: string) => ({ recordingId: id, unitId, kind: 'target' as const, cards: [{ hash, durationMs: 1000, format: 'm4a' as const }] });

async function until(ok: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function setUp(over: { choice?: HoldChoice | null; mayUpload?: boolean; limits?: LanguageSessionOptions['limits']; preset?: NearbyMark[]; upload?: LanguageSessionOptions['upload']; transport?: (t: Transport) => Transport } = {}) {
  const server = new FakeServer();
  const marks = new MemoryNearbyMarks();
  await marks.put(over.preset ?? []);
  const f = phoneFiles();
  const wall = { t: 0 };
  const choice = { now: over.choice === undefined ? ({ hold: true } as HoldChoice | null) : over.choice };
  const session = await LanguageSession.open({
    orgId: 'org1', languageId: 'luke', actorId: 'akol', deviceId: 'phone', store: new MemoryStore(), transport: (over.transport ?? ((t) => t))(server.transportFor()), files: f.files,
    upload: over.upload ?? (async (ref: BlobRef) => { server.storeBlob('org1', 'luke', ref.hash, f.sizes.get(ref.hash) ?? 0); }),
    download: async () => {},
    limits: over.limits ?? { minFreeBytes: 500 * MB, maxTotalBytes: 2048 * MB },
    client: { clock: new HlcClock('phone', () => (wall.t += 1)), newId: () => `e${(wall.t += 1)}`, nearby: nearbyClient() },
    fetchFile: f.fetchFile,
    nearbyFiles: nearbyFiles({ marks, installKey: () => ME_KEY, canReview: () => false }),
    holdChoice: () => choice.now,
    mayUpload: () => over.mayUpload ?? true
  });
  // Sam records two passages on his own phone; the server has the events but not his files.
  const sam = await LanguageSession.open({
    orgId: 'org1', languageId: 'luke', actorId: 'sam', deviceId: 'sam-phone', store: new MemoryStore(), transport: server.transportFor(), files: phoneFiles().files,
    upload: async () => {}, download: async () => {}, limits: { minFreeBytes: 0, maxTotalBytes: Number.MAX_SAFE_INTEGER },
    client: { clock: new HlcClock('sam-phone', () => (wall.t += 1)), newId: () => `s${(wall.t += 1)}` }
  });
  await sam.appendMany([{ type: 'v1.UnitAdded', payload: unit('Luke 2') }, { type: 'v1.UnitAdded', payload: unit('Luke 3') }]);
  await sam.append('v1.RecordingAdded', recording('rs', 'Luke 2', SAMS));
  await sam.append('v1.RecordingAdded', recording('rc', 'Luke 3', CYS));
  await sam.sync();
  sam.close();
  // Akol records her own.
  await session.append('v1.UnitAdded', unit('Luke 1'));
  await session.append('v1.RecordingAdded', recording('ra', 'Luke 1', MINE));
  f.files.put(MINE, 10 * MB);
  await session.sync();
  // Sam's file comes over the link and lands.
  const moves = session.nearbyMoves()!;
  const land = async (hash: string, size: number, group: WantedFile['group'] = 'backup') => {
    const file = { hash, format: 'm4a', group } as WantedFile;
    const stage = await moves.fetchFile(file);
    await moves.landed(file, stage!.stagingUri, size);
  };
  const keep = nearbyKeepOf({ nearbyMeta: (k) => session.client.nearbyMeta(k), writeNearbyMeta: (r) => session.client.writeNearbyMeta(r) }, { orgId: 'org1', streamId: 'luke' });
  /** Sam records again on his own phone, which pulls first. */
  const samRecords = async (id: string, unitId: string, hash: string) => {
    const again = await LanguageSession.open({
      orgId: 'org1', languageId: 'luke', actorId: 'sam', deviceId: 'sam-phone', store: new MemoryStore(), transport: server.transportFor(), files: phoneFiles().files,
      upload: async () => {}, download: async () => {}, limits: { minFreeBytes: 0, maxTotalBytes: Number.MAX_SAFE_INTEGER },
      client: { clock: new HlcClock('sam-phone', () => (wall.t += 1)), newId: () => `s${(wall.t += 1)}` }
    });
    await again.sync();
    await again.append('v1.RecordingAdded', recording(id, unitId, hash));
    await again.sync();
    again.close();
  };
  return { server, session, marks, ...f, moves, land, keep, choice, samRecords };
}

const chainOf = (profileId: string) => [{ kind: 'worker@1', kid: 'k', body: { profileId }, sig: SIG }] as unknown as ChainLink[];
const entry = (files: string[], profileId: string, hold = false): HoldingEntry => ({ counter: 1, files: [...files].sort(), hold, sig: SIG, chain: chainOf(profileId) });

describe('nearby files: marks and what counts as this person\'s (5.2, 5.4)', () => {
  it('a file that lands is marked; the sign-out count, a hand-over and the lost view leave it out, and "Holding" counts it', async () => {
    const { session, marks, land } = await setUp({ upload: () => new Promise(() => {}) });
    await land(SAMS, 4 * MB);
    session.start();
    expect([...marks.rows.keys()]).toEqual([SAMS]);
    expect((await session.unsent()).map((r) => r.hash)).toEqual([MINE]);
    await until(() => session.status.holding === 1);
    session.triggerUpload();
    // Sam's file still goes up from here (decisions 165 and 166 count it on the bar), but this person's own count is hers alone.
    await until(() => session.status.uploads.size === 2);
    await until(() => session.status.pendingUp === 1);
    await new Promise((r) => setTimeout(r, 30));
    expect(session.status.pendingUp).toBe(1);
    expect(await session.lost([MINE, SAMS])).toEqual({ safe: 0, unsent: 1, unitIds: ['Luke 1'] });
    session.close();
  });

  it('a lost teammate\'s file is not this person\'s to record again; a lost own file is', async () => {
    const { session, land, server } = await setUp();
    await land(SAMS, 4 * MB);
    server.offline = true;
    expect(await session.lost([SAMS])).toEqual({ safe: 0, unsent: 0, unitIds: [] });
    session.close();
  });

  it('the same bytes already here unmarked stay unmarked, so nothing a teammate sends makes this person\'s file deletable', async () => {
    const { session, marks, land } = await setUp();
    await land(MINE, 10 * MB);
    expect(marks.rows.size).toBe(0);
    session.close();
  });

  it('someone who may not write files keeps teammates\' files no accepted event names off the upload list, and their own on it', async () => {
    const uploaded: string[] = [];
    const STRAY = H('e');
    const { session, land } = await setUp({ mayUpload: false, upload: async (ref) => { uploaded.push(ref.hash); } });
    await land(STRAY, 4 * MB);
    await session.sync();
    session.start();
    session.triggerUpload();
    await until(() => uploaded.includes(MINE));
    await new Promise((r) => setTimeout(r, 30));
    expect(uploaded).toEqual([MINE]);
    expect(await session.lost([STRAY])).toEqual({ safe: 0, unsent: 0, unitIds: [] });
    session.close();
  });

  it('someone who only views uploads a teammate\'s file an accepted event names, naming that event (section 6)', async () => {
    // Why: any phone can carry the team's work. The server lets a viewer put a file up only by naming an
    // accepted event that names it (blob_named_by), so the upload says which (x-named-by).
    const uploaded: BlobRef[] = [];
    const { session, land, server } = await setUp({ mayUpload: false, upload: async (ref) => { uploaded.push(ref); } });
    await land(SAMS, 4 * MB);
    await session.sync();
    session.start();
    session.triggerUpload();
    await until(() => uploaded.some((r) => r.hash === SAMS));
    const naming = server.log.find((e) => e.type === 'v1.RecordingAdded' && JSON.stringify(e.payload).includes(SAMS))!;
    expect(uploaded.find((r) => r.hash === SAMS)?.namedBy).toBe(naming.id);
    expect(uploaded.find((r) => r.hash === MINE)?.namedBy).toBeUndefined();
    session.close();
  });

  it('a viewer whose own push lands above an unpulled gap still finds the event in that gap that names a teammate\'s file', async () => {
    // Why: the look for naming events moves forward by serverSeq. A row confirmed by this phone's push or by
    // delivery can sit above events the pull has not brought yet, and moving past it would skip them for good.
    const uploaded: BlobRef[] = [];
    const behind = { on: false };
    const FRESH = H('f');
    const { session, land, server, samRecords } = await setUp({
      mayUpload: false, upload: async (ref) => { uploaded.push(ref); },
      transport: (t) => ({ ...t, pull: async (...a) => (behind.on ? [] : t.pull(...a)) })
    });
    await samRecords('rf', 'Luke 3', FRESH);
    await land(FRESH, 4 * MB);
    behind.on = true;
    await session.append('v1.UnitAdded', unit('Luke 4'));
    await session.sync();
    behind.on = false;
    await session.sync();
    session.start();
    session.triggerUpload();
    await until(() => uploaded.some((r) => r.hash === FRESH));
    const naming = server.log.find((e) => e.type === 'v1.RecordingAdded' && JSON.stringify(e.payload).includes(FRESH))!;
    expect(uploaded.find((r) => r.hash === FRESH)?.namedBy).toBe(naming.id);
    session.close();
  });
});

describe('nearby files: freeing space in three levels (5.6)', () => {
  it('reclaim hands level 1 largest first, then level 2, and the cap leaves marked files out', async () => {
    const { session, land, reclaims, files, disk, sizes } = await setUp({ upload: NO_UPLOAD });
    await land(SAMS, 40 * MB);
    await land(CYS, 30 * MB);
    // Akol's file is on the server now and outside her scope once she leaves it: give Luke 1 to nobody by making a stored file outside any scope.
    files.put(H('d'), 1);
    disk.free = 10_000 * MB;
    session.start();
    await until(() => reclaims.some((r) => r.lists.length === 2));
    const last = reclaims.find((r) => r.lists.length === 2)!;
    // Unmarked files are never in level 2; Sam's and Cy's are, the most copies first and then the largest.
    expect(last.lists[1]).toEqual([SAMS, CYS]);
    expect([...(last.limits.uncapped ?? [])].sort()).toEqual([SAMS, CYS].sort());
    expect(sizes.has(MINE)).toBe(true);
    session.close();
  });

  it('the 2 GB cap alone deletes no nearby file, and a backup goes only once level 1 cannot free enough, in one pass', async () => {
    const { session, land, reclaims, disk, sizes, marks, files, server } = await setUp({ limits: { minFreeBytes: 500 * MB, maxTotalBytes: 45 * MB }, upload: NO_UPLOAD });
    // Cy's file came from the server: level 1, outside Akol's scope. Sam's and another came over the link.
    server.storeBlob('org1', 'luke', CYS, 30 * MB);
    await session.sync();
    files.put(CYS, 30 * MB);
    await land(SAMS, 40 * MB);
    await land(H('e'), 20 * MB);
    session.start();
    await until(() => reclaims.some((r) => r.lists.length === 2));
    await new Promise((r) => setTimeout(r, 50));
    // 100 MB here, 40 MB of it this phone's own and the server's: under the cap once teammates' files are left out, so nothing goes.
    expect([CYS, SAMS, H('e')].filter((h) => !sizes.has(h))).toEqual([]);
    const nudge = async (free: number) => {
      disk.free = free;
      const before = reclaims.length;
      files.put(H('0'), 0);
      await until(() => reclaims.length > before);
      const last = reclaims[reclaims.length - 1]!;
      // Every level in one call, so files leaving a moment later cannot make a second call delete too many.
      expect(last.lists).toHaveLength(2);
      return last;
    };
    // 25 MB short: level 1 frees enough, so no backup goes.
    const first = await nudge(475 * MB);
    // A marked file no reference names goes first in level 2.
    expect(first.lists).toEqual([[CYS], [H('e'), SAMS]]);
    expect(sizes.has(CYS)).toBe(false);
    expect(sizes.has(SAMS) && sizes.has(H('e'))).toBe(true);
    // 15 MB short with level 1 used up: the unnamed file goes, and only it.
    await nudge(485 * MB);
    expect(sizes.has(H('e'))).toBe(false);
    expect(sizes.has(SAMS) && sizes.has(MINE)).toBe(true);
    await until(() => !marks.rows.has(H('e')));
    expect(marks.rows.has(SAMS)).toBe(true);
    // 30 MB short: the backup goes, and this person's own unsent file never does.
    await nudge(470 * MB);
    expect(sizes.has(SAMS)).toBe(false);
    expect(sizes.has(MINE)).toBe(true);
    session.close();
  });

  it('another language\'s level 2 files can go too, from the mark alone, and never its needed ones', async () => {
    const other = (c: string, group: NearbyMark['group']): NearbyMark => ({ hash: H(c), format: 'm4a', languageId: 'mark', group, copies: 0 });
    const { session, reclaims, files } = await setUp({ preset: [other('f', 'backup'), other('9', 'needed')] });
    files.put(H('f'), 5 * MB);
    files.put(H('9'), 5 * MB);
    session.start();
    await until(() => reclaims.some((r) => r.lists[1]?.includes(H('f'))));
    expect(reclaims[reclaims.length - 1]!.lists[1]).toEqual([H('f')]);
    session.close();
  });

  it('level 1 gives way before a nearby file lands, and a phone that would keep too little free takes none', async () => {
    const { session, moves, reclaims, disk } = await setUp();
    disk.free = 600 * MB;
    const before = reclaims.length;
    expect(await moves.fetchFile({ hash: H('7'), format: 'm4a', group: 'backup' })).toEqual({ stagingUri: `${H('7')}.m4a.nearby.part`, maxBytes: 50 * MB, minFreeBytes: 500 * MB });
    expect(reclaims.length).toBe(before + 1);
    // Level 1 only: the nearby files are no list there.
    expect(reclaims[before]!.lists).toHaveLength(1);
    disk.free = 400 * MB;
    expect(await moves.fetchFile({ hash: H('7'), format: 'm4a', group: 'backup' })).toBeNull();
    session.close();
  });
});

describe('nearby files: a backup going once the server confirms it (Carl\'s answer 14)', () => {
  for (const choice of [{ hold: true }, { hold: false, reviewWindow: 5 }, null] as (HoldChoice | null)[]) {
    it(`a confirmed backup goes at once with the row ${choice === null ? 'not known' : choice.hold ? 'on' : 'off'}`, async () => {
      const { session, land, server, removed, marks } = await setUp({ choice });
      await land(SAMS, 4 * MB);
      server.storeBlob('org1', 'luke', SAMS, 4 * MB);
      await session.sync();
      expect(removed).toEqual([SAMS]);
      expect(marks.rows.has(SAMS)).toBe(false);
      session.close();
    });
  }

  it('a confirmed file at another size is not a confirmation: it stays', async () => {
    const { session, land, server, removed } = await setUp();
    await land(SAMS, 4 * MB);
    server.storeBlob('org1', 'luke', SAMS, 3 * MB);
    await session.sync();
    expect(removed).toEqual([]);
    session.close();
  });

  it('a confirmed needed file stays, and is no longer a nearby file', async () => {
    const { session, land, server, removed, marks } = await setUp();
    await session.keepOffline('Luke 2', true);
    await land(SAMS, 4 * MB, 'needed');
    server.storeBlob('org1', 'luke', SAMS, 4 * MB);
    await session.sync();
    expect(removed).toEqual([]);
    expect(marks.rows.has(SAMS)).toBe(false);
    session.close();
  });
});

describe('nearby files: "Hold teammates\' recordings" off (Carl\'s answer 14)', () => {
  it('sheds a file another person holds under a lower key, and keeps the last known copy', async () => {
    const { session, land, keep, removed, marks } = await setUp({ choice: { hold: false, reviewWindow: 5 } });
    await land(SAMS, 4 * MB);
    await land(CYS, 4 * MB);
    await keep.saveHoldings(new Map([[KEY('c'), entry([SAMS], 'sam')]]));
    await session.sync();
    expect(removed).toEqual([SAMS]);
    expect([...marks.rows.keys()]).toEqual([CYS]);
    session.close();
  });

  it('a higher key counts only when its row is on, and another install of whoever is signed in never does', async () => {
    const { session, land, keep, removed } = await setUp({ choice: { hold: false, reviewWindow: 5 } });
    await land(SAMS, 4 * MB);
    await land(CYS, 4 * MB);
    await keep.saveHoldings(new Map([[KEY('x'), entry([SAMS], 'sam')], [KEY('y'), entry([CYS], 'cy', true)], [KEY('b'), entry([SAMS], 'akol', true)]]));
    await session.sync();
    expect(removed).toEqual([CYS]);
    session.close();
  });

  it('with the row on, or not known yet, nothing is shed for another\'s sake', async () => {
    for (const choice of [{ hold: true }, null] as (HoldChoice | null)[]) {
      const { session, land, keep, removed } = await setUp({ choice });
      await land(SAMS, 4 * MB);
      await keep.saveHoldings(new Map([[KEY('c'), entry([SAMS], 'sam', true)]]));
      await session.sync();
      expect(removed).toEqual([]);
      session.close();
    }
  });

  it('a needed file is never shed', async () => {
    const { session, land, keep, removed } = await setUp({ choice: { hold: false, reviewWindow: 5 } });
    await session.keepOffline('Luke 2', true);
    await land(SAMS, 4 * MB, 'needed');
    await keep.saveHoldings(new Map([[KEY('c'), entry([SAMS], 'sam', true)]]));
    await session.sync();
    expect(removed).toEqual([]);
    session.close();
  });

  it('off, no backup is asked for; on, every unconfirmed file is, and a confirmed one is not', async () => {
    const { session, moves, choice, server } = await setUp({ choice: { hold: false, reviewWindow: 5 } });
    expect(await moves.wanted(new Map())).toEqual([]);
    choice.now = { hold: true };
    expect((await moves.wanted(new Map())).map((w) => [w.hash, w.group])).toEqual([[SAMS, 'backup'], [CYS, 'backup']]);
    server.storeBlob('org1', 'luke', CYS, 1);
    await session.sync();
    expect((await moves.wanted(new Map())).map((w) => w.hash)).toEqual([SAMS]);
    // The fewest known copies first.
    expect((await moves.wanted(new Map([[KEY('c'), entry([SAMS], 'sam')]]))).map((w) => w.hash)).toEqual([SAMS]);
    // Signed into this phone's own entry.
    expect(moves.holds?.()).toBe(true);
    choice.now = null;
    expect(moves.holds?.()).toBe(false);
    session.close();
  });
});

describe('nearby files: serving and the third worker (5.6)', () => {
  it('serves only a file this language names and this phone holds', async () => {
    const { session, moves } = await setUp();
    expect(await moves.serveFile({ hash: MINE, format: 'm4a' })).toEqual({ uri: `file:${MINE}`, size: 10 * MB });
    expect(await moves.serveFile({ hash: SAMS, format: 'm4a' })).toEqual({ no: 'not-here' });
    expect(await moves.serveFile({ hash: H('0'), format: 'm4a' })).toEqual({ no: 'not-referenced' });
    expect(await moves.held()).toEqual([MINE]);
    session.close();
  });

  it('takes a session\'s files one at a time on link up, and stops when room runs out or the session says so', async () => {
    const { session, moves, disk } = await setUp();
    session.start();
    const got: string[] = [];
    const fetch = async (file: WantedFile, stage: { stagingUri: string }) => {
      got.push(file.hash);
      await moves.landed(file, stage.stagingUri, MB);
    };
    const list: WantedFile[] = [{ hash: SAMS, format: 'm4a', group: 'review' }, { hash: CYS, format: 'm4a', group: 'backup' }];
    expect(await moves.take!({ list, fetch, linkUp: () => true, stop: () => false })).toEqual({ noRoom: false });
    expect(got).toEqual([SAMS, CYS]);
    // A link that is down moves nothing.
    expect(await moves.take!({ list: [{ hash: H('5'), format: 'm4a', group: 'backup' }], fetch, linkUp: () => false, stop: () => false })).toEqual({ noRoom: false });
    expect(got).toHaveLength(2);
    // The session cuts backups.
    expect(await moves.take!({ list: [{ hash: H('5'), format: 'm4a', group: 'backup' }], fetch, linkUp: () => true, stop: (f) => f.group === 'backup' })).toEqual({ noRoom: false });
    expect(got).toHaveLength(2);
    disk.free = 100 * MB;
    expect(await moves.take!({ list: [{ hash: H('5'), format: 'm4a', group: 'needed' }], fetch, linkUp: () => true, stop: () => false })).toEqual({ noRoom: true });
    // A dropped link ends the job with the drop, as the session expects.
    disk.free = 10_000 * MB;
    const drop = new Error('dropped');
    await expect(moves.take!({ list: [{ hash: H('6'), format: 'm4a', group: 'needed' }], fetch: async () => { throw drop; }, linkUp: () => true, stop: () => false })).rejects.toBe(drop);
    session.close();
  });
});
