import { DatabaseSync } from 'node:sqlite';
import {
  canonicalJson, emptyLanguageState, foldLanguage, foldOrg, HlcClock, keptVerdict, languageLines, ORG_STREAM, PART_OF_KIND, putEntry, withOwnParts, type LanguageState, type LibraryDoc, type OrgState
} from '@langquest-next/core';
import { bytesToHex, newcomerOrgState, utf8Encode } from '@langquest-next/core/nearby';
import { PART_KINDS } from '../src/keptLanguage';
import { MemoryStore } from '../src/memoryStore';
import { rowsOverLink, StartingCopySender, takeStartingCopy, type CopyAsker, type NearbyDocs } from '../src/nearbyCopy';
import { ORG_MATERIALIZER } from '../src/orgSession';
import { SqliteStore, type SqlDriver } from '../src/sqliteStore';
import { SyncClient } from '../src/syncClient';
import { FakeServer } from '../src/testing/fakeServer';
import { fakeSha256 } from '../src/testing/memoryNearbyLink';
import { OfflineError, type EventStore, type StartingCopy, type Transport } from '../src/types';

/**
 * A newcomer's starting copy (docs/nearby-sync-plan.md 14.1, 4 and 6; section 7, phase 6 step 2).
 * Why these tests: a newcomer with no server takes a teammate's checkpoint as its own, and the
 * only thing that may end it is the server's first download. The pull gate, the drop where the
 * server has no snapshot and the checkpoint skip go in together because any one alone keeps a
 * forged copy for good, so every test here ends at first contact and asks whether anything the
 * copy said that the server does not survived, with the server's cut, its whole snapshot, and
 * no snapshot at all.
 */

let ids = 0;
function sqlite(): EventStore {
  const db = new DatabaseSync(':memory:');
  const driver: SqlDriver = {
    run: async (sql, params = []) => { db.prepare(sql).run(...(params as never[])); },
    all: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as never[])) as T[],
    transaction: async (fn) => { db.exec('begin'); try { await fn(driver); db.exec('commit'); } catch (e) { db.exec('rollback'); throw e; } }
  };
  let opened: Promise<SqliteStore> | null = null;
  const store = () => (opened ??= SqliteStore.open(driver));
  return new Proxy({} as EventStore, { get: (_t, k) => async (...a: unknown[]) => ((await store()) as unknown as Record<string, (...x: unknown[]) => unknown>)[k as string]!(...a) });
}

/** A transport that answers only while `online()` says so, as a newcomer's before first contact. */
function gated(t: Transport, online: () => boolean): Transport {
  return new Proxy(t, {
    get(target, k) {
      const value = (target as unknown as Record<string | symbol, unknown>)[k];
      if (typeof value !== 'function') return value;
      return (...a: unknown[]) => (online() ? (value as (...x: unknown[]) => unknown).apply(target, a) : Promise.reject(new OfflineError('no server yet')));
    }
  });
}

type Lang = LanguageState;
const comparable = (s: Lang) => ({ ...s, appliedEventIds: {} });
const plain = (l: unknown) => JSON.parse(JSON.stringify(l)) as unknown;

describe.each([['memory', () => new MemoryStore() as EventStore], ['SQLite', sqlite]] as const)('on the %s store', (_name, makeStore) => {
  function phone(server: FakeServer, deviceId: string, actorId: string, o: { keepOnDisk?: boolean; store?: EventStore; online?: () => boolean } = {}) {
    const store = o.store ?? makeStore();
    const transport = o.online ? gated(server.transportFor(), o.online) : server.transportFor();
    const client = new SyncClient({
      orgId: 'org1', streamId: 'p1', actorId, deviceId, store, transport,
      clock: new HlcClock(deviceId, () => ++ids), newId: () => `${deviceId}-${++ids}`,
      ...(o.keepOnDisk ?? true ? { keepOnDisk: true } : {}), fillPageRows: 6, fillAtOnceRows: 0
    });
    return { client, store };
  }

  async function whole(c: SyncClient, store: EventStore): Promise<Lang> {
    const s = withOwnParts(structuredClone(c.getState()) as Lang);
    for (const kind of PART_KINDS) for (const row of await store.keptAll('org1', 'p1', kind)) putEntry(s, PART_OF_KIND.get(kind)!, row.id, JSON.parse(row.json));
    for (const row of await store.keptAll('org1', 'p1', 'file')) {
      const kept = JSON.parse(row.json) as Lang['blobs'][string];
      const here = s.blobs[row.id];
      s.blobs[row.id] = here ? keptVerdict(kept, here) : kept;
    }
    return s;
  }

  async function settle(c: SyncClient) {
    for (let i = 0; i < 200; i++) {
      const r = await c.sync();
      if (r.offline) throw new Error('offline');
      if (r.more) continue;
      if (!r.filling) break;
      await c.fillSome();
    }
    await c.settleLines();
  }

  /** A language of `n` passages, half of them recorded and reviewed, its files stored. */
  async function language(server: FakeServer, n: number) {
    const lead = phone(server, 'dA', 'lead', { keepOnDisk: false });
    await lead.client.load();
    await lead.client.append('v1.ReviewKindDefined', { kindId: 'peer', name: 'Peer check', produces: false } as never);
    for (let i = 0; i < n; i++) await lead.client.append('v1.UnitAdded', { unitId: `u${String(i).padStart(2, '0')}`, parentUnitId: null, kind: 'passage', label: `P${i}`, order: `a${String(i).padStart(3, '0')}` });
    for (let i = 0; i < n; i += 2) {
      const u = `u${String(i).padStart(2, '0')}`;
      await lead.client.append('v1.RecordingAdded', { recordingId: `r-${i}`, unitId: u, kind: 'target', cards: [{ hash: `h-${i}`, durationMs: 1000 }] });
      await lead.client.append('v1.TakeComposed', { takeId: `t-${i}`, unitId: u, cardHashes: [`h-${i}`], parentTakeId: null });
      await lead.client.append('v1.TakeSubmitted', { takeId: `t-${i}` });
      await lead.client.append('v1.NoteAdded', { noteId: `n-${i}`, unitId: u, anchor: { kind: 'passage' }, text: 'hm' });
    }
    await lead.client.sync();
    for (let i = 0; i < n; i += 2) server.storeBlob('org1', 'p1', `h-${i}`, 100 + i);
    return lead;
  }

  /** The sender's answers, straight through, as a link would carry them. */
  const asker = (sender: StartingCopySender): CopyAsker => async (ask) => {
    const got = await sender.answer({ t: 'copy-ask', ...ask });
    return typeof got === 'string' ? { t: 'copy-no', reason: got } : { t: 'copy-part', ...got };
  };

  /** A teammate with the whole language from the server, kept on disk and filled in. */
  async function teammate(server: FakeServer) {
    const t = phone(server, 'dT', 'r1');
    await t.client.load();
    await settle(t.client);
    return t;
  }

  /** A newcomer phone with no server yet, holding a teammate's copy, filled in over the link. */
  async function newcomer(server: FakeServer, from: SyncClient, online: { on: boolean }, forge?: (copy: StartingCopy) => StartingCopy) {
    const n = phone(server, 'dN', 'new-1', { online: () => online.on });
    await n.client.load();
    const sender = new StartingCopySender({ language: from }, 'p1');
    const copy = (await from.startingCopy())!;
    await n.client.adoptStartingCopy(forge ? forge(structuredClone(copy)) : copy);
    await n.client.fillFromCopy(rowsOverLink(asker(sender), 'p1'));
    return n;
  }

  /** A copy that says what the server never did: a passage, a recording, a line and a verdict. */
  const forged = (copy: StartingCopy): StartingCopy => {
    const state = copy.state as Lang;
    state.units['forged'] = { ...Object.values(state.units)[0]!, unitId: 'forged', label: 'Forged' } as Lang['units'][string];
    copy.kept!.lines.push({ ...copy.kept!.lines[0]!, unitId: 'forged' });
    return { ...copy, serverSeq: copy.serverSeq + 1000 };
  };

  const serverFold = (server: FakeServer) => foldLanguage(server.stream('org1', 'p1'), emptyLanguageState());

  describe('adoptStartingCopy', () => {
    it('makes a newcomer\'s language the teammate\'s, with the cursor at 0 and the copy\'s seq kept for the door and for claims', async () => {
      const server = new FakeServer();
      server.serverCut = true;
      await language(server, 12);
      server.makeSnapshot('org1', 'p1');
      const t = await teammate(server);
      const online = { on: false };
      const n = await newcomer(server, t.client, online);
      expect(comparable(await whole(n.client, n.store))).toEqual(comparable(await whole(t.client, t.store)));
      expect(await n.store.cursor('org1', 'p1')).toBe(0);
      const seq = server.head('org1', 'p1');
      expect(await n.store.meta('startingCopy:org1/p1')).toBe(String(seq));
      expect(await n.store.meta('nearbyClaimed:org1/p1')).toBe(String(seq));
      expect((await n.store.meta('snapshotSeq:org1/p1'))!.endsWith(`:${seq}`)).toBe(true);
      expect(await n.client.holdsCopy()).toBe(true);
      expect(n.client.fillProgress()).toBeNull();
      // A restart reads it back as it was.
      const again = phone(server, 'dN', 'new-1', { store: n.store, online: () => false });
      await again.client.load();
      expect(await again.client.holdsCopy()).toBe(true);
      expect(comparable(await whole(again.client, n.store))).toEqual(comparable(await whole(t.client, t.store)));
    });

    it('is refused by a phone with anything from the server, and for a copy of the other kind', async () => {
      const server = new FakeServer();
      server.serverCut = true;
      await language(server, 4);
      server.makeSnapshot('org1', 'p1');
      const t = await teammate(server);
      const copy = (await t.client.startingCopy())!;
      await expect(t.client.adoptStartingCopy(copy)).rejects.toThrow(/nothing from the server/);
      const memory = phone(server, 'dM', 'm', { keepOnDisk: false, online: () => false });
      await memory.client.load();
      await expect(memory.client.adoptStartingCopy(copy)).rejects.toThrow(/cannot take|can take/);
      await expect(memory.client.adoptStartingCopy({ serverSeq: -1, state: {} })).rejects.toThrow();
    });

    it('a sender still filling in, or with no checkpoint, has no copy to give, and refuses passages it has not filled', async () => {
      const server = new FakeServer();
      server.serverCut = true;
      await language(server, 12);
      server.makeSnapshot('org1', 'p1');
      const t = phone(server, 'dT', 'r1');
      await t.client.load();
      await t.client.sync();
      expect(t.client.fillProgress()).not.toBeNull();
      expect(await t.client.startingCopy()).toBeNull();
      const sender = new StartingCopySender({ language: t.client }, 'p1');
      const unfilled = ['u00', 'u01', 'u02', 'u03'].find((u) => !t.client.isFilled(u))!;
      expect(await sender.answer({ t: 'copy-ask', part: 'rows', stream: 'p1', after: JSON.stringify([unfilled, 0]) })).toBe('not-filled');
      expect(await sender.answer({ t: 'copy-ask', part: 'state', stream: 'p1' })).toBe('not-filled');
      const none = phone(server, 'dZ', 'z', { online: () => false });
      await none.client.load();
      expect(await none.client.startingCopy()).toBeNull();
    });
  });

  describe('the documents a kept language uses', () => {
    it('sender and newcomer count a material linked to a passage whose links are kept on disk, and it goes', async () => {
      const server = new FakeServer();
      server.serverCut = true;
      const lead = await language(server, 8);
      const mat = { format: 'material@1', kind: 'document', title: 'Notes', deps: [] } as unknown as LibraryDoc;
      const matHash = bytesToHex(fakeSha256(utf8Encode(canonicalJson(mat))));
      await lead.client.append('v1.PassageReferenceLinked', { unitId: 'u03', itemId: 'mat', linked: true } as never);
      await lead.client.sync();
      server.makeSnapshot('org1', 'p1');
      const t = await teammate(server);
      // Kept on disk: the checkpoint the copy carries holds no links; the passage's rows do.
      expect(((await t.client.startingCopy())!.state as Lang).passageLinks?.['u03']).toBeUndefined();
      const reg = <T,>(value: T) => ({ value, hlc: 'x', eventId: 'e' });
      const orgState = {
        library: { mat: { kind: reg('material'), name: reg('Notes'), description: reg(''), copiedFrom: reg(null), versions: { [matHash]: { docHash: matHash, hlc: 'x', eventId: 'e', actorId: 'lead' } }, sharing: reg({ shared: false, subscribable: false }), archived: reg(false), subscription: reg(null), pinned: reg(null) } },
        recommendations: {}, members: {}, roles: {}, languages: {}
      } as unknown as OrgState;
      const docs = new Map([[matHash, mat]]);
      const kept: string[] = [];
      const port: NearbyDocs = { read: async (x) => docs.get(x) ?? null, text: async (x) => (docs.has(x) ? canonicalJson(docs.get(x)) : null), keep: async (x) => { kept.push(x); return true; } };
      const sender = new StartingCopySender({ language: t.client, org: { startingCopy: async () => ({ serverSeq: 1, state: orgState }) }, docs: port }, 'p1');
      expect(await sender.answer({ t: 'copy-ask', part: 'doc', hash: matHash })).toMatchObject({ part: 'doc', body: canonicalJson(mat) });

      const n = await newcomer(server, t.client, { on: false });
      const none: NearbyDocs = { read: async () => null, text: async () => null, keep: port.keep };
      const taken = await takeStartingCopy(asker(sender), {
        languageId: 'p1', sha256: fakeSha256, docs: none,
        language: { holdsCopy: () => n.client.holdsCopy(), adoptStartingCopy: (c) => n.client.adoptStartingCopy(c), fillFromCopy: (r) => n.client.fillFromCopy(r), keptOnDisk: true, state: () => n.client.getState(), keptPassageLinks: () => n.client.keptPassageLinks() },
        org: { holdsCopy: async () => true, adoptStartingCopy: async () => undefined, state: () => orgState }
      });
      expect(taken.docs).toEqual({ kept: 1, refused: 0, missing: 0 });
      expect(kept).toEqual([matHash]);
    });
  });

  describe('a starting copy is never pulled onto, and never checkpointed', () => {
    it('offline, a sync changes nothing; a fill without a link asks nothing of anyone, even the server once it answers', async () => {
      const server = new FakeServer();
      server.serverCut = true;
      await language(server, 12);
      server.makeSnapshot('org1', 'p1');
      const t = await teammate(server);
      const online = { on: false };
      const n = phone(server, 'dN', 'new-1', { online: () => online.on });
      await n.client.load();
      await n.client.adoptStartingCopy((await t.client.startingCopy())!);
      expect(n.client.fillProgress()).not.toBeNull();
      expect((await n.client.sync()).offline).toBe(true);
      const rowsBefore = server.rowsCalls;
      expect(await n.client.fillSome()).toMatchObject({ filled: 0, offline: true });
      expect(server.rowsCalls).toBe(rowsBefore);
      // The server answers now, and a fill run before any sync still reads nothing from it: its rows would join a stand-in.
      online.on = true;
      expect(await n.client.fillSome()).toMatchObject({ filled: 0, offline: true });
      expect(server.rowsCalls).toBe(rowsBefore);
      expect(await n.client.holdsCopy()).toBe(true);
      online.on = false;
      expect(await n.store.cursor('org1', 'p1')).toBe(0);
      // A drop part-way keeps what came and goes on.
      const sender = new StartingCopySender({ language: t.client }, 'p1');
      let asks = 0;
      const dropping: CopyAsker = async (ask) => {
        if (++asks === 4) throw new OfflineError('link dropped');
        return asker(sender)(ask);
      };
      await expect(n.client.fillFromCopy(rowsOverLink(dropping, 'p1'))).rejects.toThrow(OfflineError);
      const part = n.client.fillProgress();
      expect(part).not.toBeNull();
      expect(part!.filled).toBeGreaterThan(0);
      expect(await n.client.fillFromCopy(rowsOverLink(asker(sender), 'p1'))).toMatchObject({ filling: false });
      expect(comparable(await whole(n.client, n.store))).toEqual(comparable(await whole(t.client, t.store)));
    });

    it('a row source answering nothing is a drop, never a gone cut that drops the language', async () => {
      const server = new FakeServer();
      server.serverCut = true;
      await language(server, 8);
      server.makeSnapshot('org1', 'p1');
      const t = await teammate(server);
      const n = phone(server, 'dN', 'new-1', { online: () => false });
      await n.client.load();
      await n.client.adoptStartingCopy((await t.client.startingCopy())!);
      const nothing = (async () => null) as unknown as Parameters<SyncClient['fillFromCopy']>[0];
      await expect(n.client.fillFromCopy(nothing)).rejects.toThrow(OfflineError);
      expect(await n.client.holdsCopy()).toBe(true);
      expect(n.client.restarts).toBe(0);
    });

    it('opening many passages takes no checkpoint while the copy is held: one at cursor 0 would write 0 over its seq', async () => {
      const server = new FakeServer();
      server.serverCut = true;
      await language(server, 60);
      server.makeSnapshot('org1', 'p1');
      const t = await teammate(server);
      const n = await newcomer(server, t.client, { on: false });
      const seqBefore = await n.store.meta('snapshotSeq:org1/p1');
      for (let i = 0; i < 60; i += 1) await n.client.loadUnits([`u${String(i).padStart(2, '0')}`]);
      expect(await n.store.meta('snapshotSeq:org1/p1')).toBe(seqBefore);
      expect(await n.store.meta('startingCopy:org1/p1')).toBe(seqBefore!.split(':')[1]);
    });
  });

  describe('first contact: the server\'s first download replaces the copy, with nothing lost and nothing forged kept', () => {
    const cases = [
      ['the server\'s cut', (server: FakeServer) => { server.serverCut = true; server.makeSnapshot('org1', 'p1'); }],
      ['its whole snapshot', (server: FakeServer) => { server.serverCut = false; server.dropCuts(); server.makeSnapshot('org1', 'p1'); }],
      ['no snapshot at all', (server: FakeServer) => { server.snapshots.clear(); server.dropCuts(); }]
    ] as const;

    for (const [label, atContact] of cases) {
      it(`with ${label}`, async () => {
        const server = new FakeServer();
        server.serverCut = true;
        const lead = await language(server, 12);
        server.makeSnapshot('org1', 'p1');
        const t = await teammate(server);
        const online = { on: false };
        const n = await newcomer(server, t.client, online, forged);
        expect(Object.keys((await whole(n.client, n.store)).units)).toContain('forged');
        // The newcomer works, and the team carries on at the server meanwhile.
        await n.client.append('v1.NoteAdded', { noteId: 'n-new', unitId: 'u01', anchor: { kind: 'passage' }, text: 'from the newcomer' });
        await lead.client.append('v1.NoteAdded', { noteId: 'n-later', unitId: 'u03', anchor: { kind: 'passage' }, text: 'later' });
        await lead.client.sync();
        atContact(server);
        online.on = true;
        await settle(n.client);
        expect(await n.client.holdsCopy()).toBe(false);
        expect(await n.store.meta('startingCopy:org1/p1')).toBeFalsy();
        // The forged copy's seq is gone with it: claims resume from what the server gave, never above its head.
        expect(Number(await n.store.meta('nearbyClaimed:org1/p1'))).toBeLessThanOrEqual(server.head('org1', 'p1'));
        const truth = serverFold(server);
        expect(Object.keys(truth.notes ?? {})).toEqual(expect.arrayContaining(['n-new', 'n-later']));
        expect(comparable(await whole(n.client, n.store))).toEqual(comparable(truth));
        expect(Object.keys((await whole(n.client, n.store)).units)).not.toContain('forged');
        // A line is always given; the forged one is no longer kept, and reads as the server's would.
        expect(await n.store.keptById('org1', 'p1', 'line', ['forged'])).toEqual([]);
        expect(plain(n.client.passageLines().get('forged'))).toEqual(plain(languageLines(truth).get('forged')));
        expect(plain(n.client.passageLines().get('u01'))).toEqual(plain(languageLines(truth).get('u01')));
        expect(await n.client.pendingCount()).toBe(0);
      });
    }

    it('a download cut short leaves the copy whole and pulls nothing onto it', async () => {
      const server = new FakeServer();
      server.serverCut = false;
      await language(server, 12);
      server.chunkChars = 400;
      server.makeSnapshot('org1', 'p1');
      server.serverCut = true;
      const t = phone(server, 'dT', 'r1');
      await t.client.load();
      await settle(t.client);
      const online = { on: false };
      const n = await newcomer(server, t.client, online, forged);
      server.failChunkAfter = server.chunkCalls + 1;
      online.on = true;
      await n.client.sync().catch(() => undefined);
      expect(await n.store.cursor('org1', 'p1')).toBe(0);
      expect(await n.client.holdsCopy()).toBe(true);
      server.failChunkAfter = Infinity;
      await settle(n.client);
      expect(comparable(await whole(n.client, n.store))).toEqual(comparable(serverFold(server)));
    });
  });

  it('a snapshot replaced during the download pulls nothing onto the copy, and the next sync replaces it', async () => {
    // A download that finds its snapshot gone answers 0, as for a stale one. A pull from there would fold the server's
    // log onto the copy and move the cursor past 0, and nothing would ever replace the copy.
    const server = new FakeServer();
    server.serverCut = false;
    const lead = await language(server, 12);
    server.chunkChars = 400;
    server.makeSnapshot('org1', 'p1');
    server.serverCut = true;
    const t = phone(server, 'dT', 'r1');
    await t.client.load();
    await settle(t.client);
    server.serverCut = false;
    server.dropCuts();
    server.chunkChars = 100;
    server.makeSnapshot('org1', 'p1');
    const online = { on: false };
    let replaced = false;
    const n = phone(server, 'dN', 'new-1', { online: () => online.on });
    const real = server.transportFor();
    const watching: Transport = { ...real, snapshotChunk: async (...a) => {
      const text = await real.snapshotChunk(...a);
      if (!replaced) {
        replaced = true;
        await lead.client.append('v1.NoteAdded', { noteId: 'n-mid', unitId: 'u05', anchor: { kind: 'passage' }, text: 'mid' });
        await lead.client.sync();
        server.makeSnapshot('org1', 'p1');
      }
      return text;
    } };
    const client = new SyncClient({
      orgId: 'org1', streamId: 'p1', actorId: 'new-1', deviceId: 'dN', store: n.store, transport: gated(watching, () => online.on),
      clock: new HlcClock('dN', () => ++ids), newId: () => `dN-${++ids}`, keepOnDisk: true, fillPageRows: 6, fillAtOnceRows: 0
    });
    await client.load();
    await client.adoptStartingCopy(forged(structuredClone((await t.client.startingCopy())!)));
    await client.fillFromCopy(rowsOverLink(asker(new StartingCopySender({ language: t.client }, 'p1')), 'p1'));
    online.on = true;
    expect((await client.sync()).pulled).toBe(0);
    expect(replaced).toBe(true);
    expect(await n.store.cursor('org1', 'p1')).toBe(0);
    expect(await client.holdsCopy()).toBe(true);
    await settle(client);
    expect(await client.holdsCopy()).toBe(false);
    expect(comparable(await whole(client, n.store))).toEqual(comparable(serverFold(server)));
  });

  describe('the organization stream, which never has a snapshot', () => {
    function orgClient(server: FakeServer, actorId: string, store: EventStore, online: () => boolean) {
      return new SyncClient<OrgState>({
        materializer: ORG_MATERIALIZER, orgId: 'org1', streamId: ORG_STREAM, actorId, deviceId: `d-${actorId}`, store,
        transport: gated(server.transportFor(), online), clock: new HlcClock(`d-${actorId}`, () => ++ids), newId: () => `${actorId}-${++ids}`
      });
    }

    it('a copy holds only this organization\'s cut, and first contact replaces it from a pull aside, in one commit', async () => {
      const server = new FakeServer();
      const admin = orgClient(server, 'admin', makeStore(), () => true);
      await admin.load();
      await admin.append('v1.OrgCreated', { name: 'Team' });
      await admin.append('v1.RoleDefined', { roleId: 'translator', name: 'Translator', privileges: ['translate', 'view_status'] });
      await admin.append('v1.LanguageAdded', { languageId: 'p1', name: 'Dinka', code: 'din', sourceCode: 'eng' });
      await admin.append('v1.LanguageAdded', { languageId: 'p2', name: 'Nuer', code: 'nus', sourceCode: 'eng' });
      await admin.append('v1.MemberAdded', { profileId: 't1', roleId: 'translator', scope: { level: 'language', languageId: 'p1' } });
      await admin.append('v1.MemberAdded', { profileId: 't2', roleId: 'translator', scope: { level: 'language', languageId: 'p2' } });
      await admin.append('v1.InviteIssued', { inviteId: 'inv1', roleId: 'translator', scope: { level: 'language', languageId: 'p1' }, expiresAt: '2030-01-01T00:00:00Z' });
      await admin.sync();
      const sender = new StartingCopySender({ language: { startingCopy: async () => null }, org: admin }, 'p1');
      const got = await sender.answer({ t: 'copy-ask', part: 'state', stream: ORG_STREAM });
      expect(typeof got).toBe('object');
      const copy = JSON.parse((got as { body: string }).body) as StartingCopy;
      const state = copy.state as OrgState;
      expect(Object.keys(state.members)).toEqual(['t1']);
      expect(Object.keys(state.languages)).toEqual(['p1']);
      expect(state.invites).toEqual({});
      expect(await sender.answer({ t: 'copy-ask', part: 'state', stream: 'p2' })).toBe('not-allowed');

      // The newcomer takes it, with a forged member in it.
      const online = { on: false };
      const store = makeStore();
      const n = orgClient(server, 'new-1', store, () => online.on);
      await n.load();
      const forgedState = structuredClone(state);
      forgedState.members['forged-admin'] = structuredClone(forgedState.members['t1']!);
      await n.adoptStartingCopy({ ...copy, serverSeq: copy.serverSeq + 1000, state: forgedState });
      expect(await store.meta(`nearbyClaimed:org1/${ORG_STREAM}`)).toBe(String(copy.serverSeq + 1000));
      expect(Object.keys(n.getState().members)).toContain('forged-admin');
      expect((await n.sync()).offline).toBe(true);
      expect(Object.keys(n.getState().members)).toContain('forged-admin');

      // A pull aside that drops part-way leaves the copy as it was.
      let pulls = 0;
      online.on = true;
      const flaky = new SyncClient<OrgState>({
        materializer: ORG_MATERIALIZER, orgId: 'org1', streamId: ORG_STREAM, actorId: 'new-1', deviceId: 'd-new-1', store,
        transport: gated(server.transportFor(), () => ++pulls < 3), pullPageSize: 2, clock: new HlcClock('d-new-1', () => ++ids)
      });
      await flaky.load();
      expect((await flaky.sync()).offline).toBe(true);
      expect(await flaky.holdsCopy()).toBe(true);
      expect(Object.keys(flaky.getState().members)).toContain('forged-admin');
      expect(await store.cursor('org1', ORG_STREAM)).toBe(0);

      // Then a good link: the server's organization, and the forged member gone.
      const good = orgClient(server, 'new-1', store, () => true);
      await good.load();
      await good.sync();
      expect(await good.holdsCopy()).toBe(false);
      expect(await store.meta(`startingCopy:org1/${ORG_STREAM}`)).toBeFalsy();
      const truth = foldOrg(server.stream('org1', ORG_STREAM));
      expect({ ...good.getState(), appliedEventIds: {} }).toEqual({ ...truth, appliedEventIds: {} });
      expect(await store.cursor('org1', ORG_STREAM)).toBe(server.head('org1', ORG_STREAM));
      expect(await store.meta(`nearbyClaimed:org1/${ORG_STREAM}`)).toBe(String(server.head('org1', ORG_STREAM)));
      expect(newcomerOrgState(good.getState(), 'p1').members['forged-admin']).toBeUndefined();
    });
  });
});
