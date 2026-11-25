import { DatabaseSync } from 'node:sqlite';
import {
  canonicalJson, docHeadOf, emptyLanguageState, foldLanguage, foldOrg, HlcClock, keptVerdict, languageLines, ORG_STREAM, PART_OF_KIND, putEntry, withOwnParts, type LanguageState, type LibraryDoc, type OrgState
} from '@langquest-next/core';
import { bytesToHex, newcomerOrgState, utf8Encode } from '@langquest-next/core/nearby';
import { PART_KINDS } from '../src/keptLanguage';
import { MemoryStore } from '../src/memoryStore';
import { CopyRefused, OtherCheckpoint, rowsOverLink, StartingCopySender, takeStartingCopy, type CopyAsker, type NearbyDocs, type StartingCopyTarget } from '../src/nearbyCopy';
import { ORG_MATERIALIZER } from '../src/orgSession';
import { SqliteStore, type SqlDriver } from '../src/sqliteStore';
import { LANGUAGE_MATERIALIZER, SyncClient, type Materializer } from '../src/syncClient';
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
  function phone(server: FakeServer, deviceId: string, actorId: string, o: { keepOnDisk?: boolean; store?: EventStore; online?: () => boolean; materializer?: Materializer<Lang>; pullPageSize?: number } = {}) {
    const store = o.store ?? makeStore();
    const transport = o.online ? gated(server.transportFor(), o.online) : server.transportFor();
    const client = new SyncClient({
      orgId: 'org1', streamId: 'p1', actorId, deviceId, store, transport,
      clock: new HlcClock(deviceId, () => ++ids), newId: () => `${deviceId}-${++ids}`,
      ...(o.keepOnDisk ?? true ? { keepOnDisk: true } : {}), fillPageRows: 6, fillAtOnceRows: 0,
      ...(o.materializer ? { materializer: o.materializer } : {}), ...(o.pullPageSize ? { pullPageSize: o.pullPageSize } : {})
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

  /**
   * As a sender from before 2026-11-24, which says no checkpoint seq on its rows: a forged copy's
   * seq is not the sender's, and these tests fill it from that sender as one session would
   * (`rowsOverLink`'s `sameSender`), to see first contact replace it.
   */
  const unsaid = (a: CopyAsker): CopyAsker => async (ask) => {
    const got = await a(ask);
    if (got.t !== 'copy-part') return got;
    const { seq: _seq, ...rest } = got;
    return rest;
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
    await n.client.fillFromCopy(forge ? rowsOverLink(unsaid(asker(sender)), 'p1', true) : rowsOverLink(asker(sender), 'p1'));
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

    // Found on two emulators: a language under `checkpointEvery` events, with no server snapshot, had no checkpoint, so every copy stopped after the organization.
    it('a sender whose language is too young for a checkpoint takes one to give, holding only confirmed work', async () => {
      const server = new FakeServer();
      server.serverCut = true;
      await language(server, 12);
      const t = await teammate(server);
      expect(await t.store.meta('snapshotSeq:org1/p1')).toBeFalsy();
      const confirmed = comparable(await whole(t.client, t.store));
      await t.client.append('v1.NoteAdded', { noteId: 'unsent', unitId: 'u01', anchor: { kind: 'passage' }, text: 'not sent yet' });
      const n = await newcomer(server, t.client, { on: false });
      const seq = server.head('org1', 'p1');
      expect(await n.store.meta('startingCopy:org1/p1')).toBe(String(seq));
      expect(n.client.fillProgress()).toBeNull();
      expect(comparable(await whole(n.client, n.store))).toEqual(confirmed);
      // The sender loses nothing: its unsent note is still its own, and still to send.
      expect((await whole(t.client, t.store)).notes['unsent']).toBeDefined();
      expect(await t.store.unconfirmedCount('org1', 'p1')).toBe(1);
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

  // The 2026-11-24 review (P8, T6): a sender held every passage's rows text for the whole session, 50 MB for 100,000 rows.
  describe('what a sender holds while it gives a copy', () => {
    it('drops each passage\'s rows once its last part has gone, and holds a few at most for a newcomer that asks only first parts', async () => {
      const server = new FakeServer();
      server.serverCut = true;
      await language(server, 12);
      server.makeSnapshot('org1', 'p1');
      const t = await teammate(server);
      const sender = new StartingCopySender({ language: t.client }, 'p1');
      const rowsHeld = () => [...(sender as unknown as { texts: Map<string, unknown> }).texts.keys()].filter((k) => k.startsWith('rows:')).length;
      const units = Array.from({ length: 12 }, (_, i) => `u${String(i).padStart(2, '0')}`);
      // Every passage whole, one after another: none is held after its last part.
      for (const u of units) {
        for (let after = JSON.stringify([u, 0]); ;) {
          const got = await sender.answer({ t: 'copy-ask', part: 'rows', stream: 'p1', after });
          if (typeof got === 'string') throw new Error(got);
          if (got.next === null) break;
          after = got.next;
        }
      }
      expect(rowsHeld()).toBe(0);
      // A newcomer that asks the first part of every passage and no more pins at most a few.
      const again = new StartingCopySender({ language: t.client }, 'p1');
      const heldThen = () => [...(again as unknown as { texts: Map<string, unknown> }).texts.keys()].filter((k) => k.startsWith('rows:')).length;
      for (const u of units) await again.answer({ t: 'copy-ask', part: 'rows', stream: 'p1', after: JSON.stringify([u, 0]) });
      expect(heldThen()).toBeLessThanOrEqual(4);
    });

    it('a newcomer fills its passages several to a page, so it keeps them in fewer commits than passages', async () => {
      const server = new FakeServer();
      server.serverCut = true;
      await language(server, 12);
      server.makeSnapshot('org1', 'p1');
      const t = await teammate(server);
      const n = phone(server, 'dN', 'new-1', { online: () => false });
      await n.client.load();
      await n.client.adoptStartingCopy((await t.client.startingCopy())!);
      const sender = new StartingCopySender({ language: t.client }, 'p1');
      let pages = 0;
      const fill = rowsOverLink(asker(sender), 'p1');
      const counting: typeof fill = async (...a) => { pages += 1; return fill(...a); };
      const filled = await n.client.fillFromCopy(counting);
      expect(filled.filling).toBe(false);
      expect(pages).toBeLessThan(12);
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
      const port: NearbyDocs = { head: async (x: string) => { const d = docs.get(x); return d ? docHeadOf(d) : null; }, text: async (x) => (docs.has(x) ? canonicalJson(docs.get(x)) : null), keep: async (x) => { kept.push(x); return true; } };
      const sender = new StartingCopySender({ language: t.client, org: { startingCopy: async () => ({ serverSeq: 1, state: orgState }) }, docs: port }, 'p1');
      expect(await sender.answer({ t: 'copy-ask', part: 'doc', hash: matHash })).toMatchObject({ part: 'doc', body: canonicalJson(mat) });

      const n = await newcomer(server, t.client, { on: false });
      const none: NearbyDocs = { head: async () => null, text: async () => null, keep: port.keep };
      const taken = await takeStartingCopy(asker(sender), {
        languageId: 'p1', sha256: fakeSha256, docs: none,
        language: { holdsCopy: () => n.client.holdsCopy(), adoptStartingCopy: (c) => n.client.adoptStartingCopy(c), fillFromCopy: (r) => n.client.fillFromCopy(r), keptOnDisk: true, state: () => n.client.getState(), keptPassageLinks: () => n.client.keptPassageLinks() },
        org: { holdsCopy: async () => true, adoptStartingCopy: async () => undefined, state: () => orgState }
      });
      expect(taken.docs).toEqual({ kept: 1, refused: 0, missing: 0, capped: false });
      expect(kept).toEqual([matHash]);
    });

    // 2026-11-24: every guide the language uses goes now, so a hostile sender's forged collection could name thousands.
    it('keeps at most the copy\'s bound of documents, however many a collection names, and says it stopped', async () => {
      const server = new FakeServer();
      server.serverCut = true;
      await language(server, 4);
      server.makeSnapshot('org1', 'p1');
      const t = await teammate(server);
      const doc = (i: number) => ({ format: 'study@2', title: `Guide ${i}`, links: [], steps: [{ id: 's', title: 'Listen', text: `Step ${i}` }], resources: [], terms: [], deps: [] });
      const hashOf = (d: unknown) => bytesToHex(fakeSha256(utf8Encode(canonicalJson(d))));
      const guides = Array.from({ length: 40 }, (_, i) => doc(i));
      const numbering = { format: 'versification@1', code: 'eng', name: 'English', maxVerses: { MRK: [45] }, mappedVerses: {} };
      const entries = guides.map((g, i) => ({ ref: `MRK 1:${i + 1}`, title: `Guide ${i}`, doc: hashOf(g) }));
      const collection = { format: 'collection@1', title: 'Many', description: '', versification: hashOf(numbering), entries, deps: [...new Set([hashOf(numbering), ...entries.map((e) => e.doc)])].sort() };
      const all = new Map<string, unknown>([[hashOf(collection), collection], [hashOf(numbering), numbering], ...guides.map((g) => [hashOf(g), g] as [string, unknown])]);
      const reg = <T,>(value: T) => ({ value, hlc: 'x', eventId: 'e' });
      const cHash = hashOf(collection);
      const orgState = {
        library: { many: { kind: reg('material'), name: reg('Many'), description: reg(''), copiedFrom: reg(null), versions: { [cHash]: { docHash: cHash, hlc: 'x', eventId: 'e', actorId: 'lead' } }, sharing: reg({ shared: false, subscribable: false }), archived: reg(false), subscription: reg(null), pinned: reg(null) } },
        recommendations: {}, members: {}, roles: {}, languages: {}
      } as unknown as OrgState;
      const port: NearbyDocs = { head: async (x: string) => { const d = all.get(x) as LibraryDoc | undefined; return d ? docHeadOf(d) : null; }, text: async (x) => (all.has(x) ? canonicalJson(all.get(x)) : null), keep: async () => true };
      const sender = new StartingCopySender({ language: t.client, org: { startingCopy: async () => ({ serverSeq: 1, state: orgState }) }, docs: port }, 'p1');
      const n = await newcomer(server, t.client, { on: false });
      const kept: string[] = [];
      const none: NearbyDocs = { head: async () => null, text: async () => null, keep: async (x) => { kept.push(x); return true; } };
      const taken = await takeStartingCopy(asker(sender), {
        languageId: 'p1', sha256: fakeSha256, docs: none, docLimits: { count: 10, chars: 1_000_000 },
        language: { holdsCopy: () => n.client.holdsCopy(), adoptStartingCopy: (c) => n.client.adoptStartingCopy(c), fillFromCopy: (r) => n.client.fillFromCopy(r), keptOnDisk: true, state: () => n.client.getState() },
        org: { holdsCopy: async () => true, adoptStartingCopy: async () => undefined, state: () => orgState }
      });
      expect(taken.docs).toMatchObject({ kept: 10, capped: true });
      expect(kept).toHaveLength(10);
      // The collection, offered by the wider library, came first: it is how the guides were found.
      expect(kept[0]).toBe(cHash);
    });
  });

  /** Where a copy goes on a newcomer's phone, as the app's target has it, with the drop a copy from another checkpoint needs. */
  const targetOf = (c: SyncClient, o: { drop?: boolean } = {}): StartingCopyTarget => ({
    languageId: 'p1', sha256: fakeSha256,
    language: {
      holdsCopy: () => c.holdsCopy(), adoptStartingCopy: (x) => c.adoptStartingCopy(x), fillFromCopy: (r) => c.fillFromCopy(r), keptOnDisk: true, state: () => c.getState(),
      ...(o.drop === false ? {} : { dropCopy: () => c.dropStartingCopy() })
    },
    org: null
  });

  // The review of 2026-11-24, item 4: the join dropped while passages were filled, and a teammate at an older checkpoint
  // finished the copy. Its rows were labelled with the copy's seq, so passages worked on between the two checkpoints got its
  // older rows, or none, were marked filled, and the copy said it was whole. Claims start above the copy, so the gap stayed.
  describe('a fill resumes only from a teammate at the checkpoint the copy came from', () => {
    async function twoCheckpoints() {
      const server = new FakeServer();
      server.serverCut = true;
      const lead = await language(server, 12);
      server.makeSnapshot('org1', 'p1');
      const older = await teammate(server);
      const olderSeq = (await older.client.startingCopy())!.serverSeq;
      // Work between the two checkpoints, on passages the older one holds too.
      for (let i = 0; i < 12; i += 1) {
        const u = `u${String(i).padStart(2, '0')}`;
        await lead.client.append('v1.NoteAdded', { noteId: `later-${i}`, unitId: u, anchor: { kind: 'passage' }, text: 'between the checkpoints' });
      }
      await lead.client.sync();
      server.makeSnapshot('org1', 'p1');
      const newer = phone(server, 'dA', 'r2');
      await newer.client.load();
      await settle(newer.client);
      const newerSeq = (await newer.client.startingCopy())!.serverSeq;
      expect(newerSeq).toBeGreaterThan(olderSeq);
      return { server, older, newer, olderSeq, newerSeq };
    }

    /** A newcomer that took the newer copy and filled part of it before the link dropped. */
    async function partFilled(server: FakeServer, from: SyncClient) {
      const n = phone(server, 'dN', 'new-1', { online: () => false });
      await n.client.load();
      await n.client.adoptStartingCopy((await from.startingCopy())!);
      const sender = new StartingCopySender({ language: from }, 'p1');
      let asks = 0;
      const dropping: CopyAsker = async (ask) => {
        if (++asks === 3) throw new OfflineError('link dropped');
        return asker(sender)(ask);
      };
      await expect(n.client.fillFromCopy(rowsOverLink(dropping, 'p1'))).rejects.toThrow(OfflineError);
      expect(n.client.fillProgress()!.filled).toBeGreaterThan(0);
      return n;
    }

    it('every rows part says the seq of the checkpoint its rows belong to', async () => {
      const { older, olderSeq } = await twoCheckpoints();
      const sender = new StartingCopySender({ language: older.client }, 'p1');
      const got = await sender.answer({ t: 'copy-ask', part: 'rows', stream: 'p1', after: JSON.stringify(['u00', 0]) });
      expect(got).toMatchObject({ part: 'rows', seq: olderSeq });
    });

    it('rows from an older checkpoint go into no passage: the fill stops, and filled passages keep the newer rows', async () => {
      const { server, older, newer } = await twoCheckpoints();
      const n = await partFilled(server, newer.client);
      const before = n.client.fillProgress()!.filled;
      const fromOlder = rowsOverLink(asker(new StartingCopySender({ language: older.client }, 'p1')), 'p1');
      await expect(n.client.fillFromCopy(fromOlder)).rejects.toThrow(OtherCheckpoint);
      expect(n.client.fillProgress()!.filled).toBe(before);
    });

    it('a newcomer meeting a teammate at another checkpoint drops its part-filled copy and takes that teammate\'s whole copy', async () => {
      const { server, older, newer, olderSeq } = await twoCheckpoints();
      const n = await partFilled(server, newer.client);
      const sender = new StartingCopySender({ language: older.client }, 'p1');
      const taken = await takeStartingCopy(asker(sender), targetOf(n.client));
      expect(taken.whole).toBe(true);
      expect(await n.store.meta('startingCopy:org1/p1')).toBe(String(olderSeq));
      // One teammate's copy, whole: never the newer state with the older rows.
      expect(comparable(await whole(n.client, n.store))).toEqual(comparable(await whole(older.client, older.store)));
      expect(n.client.fillProgress()).toBeNull();
      // Claims resume above the copy taken, never above the dropped one's newer seq, which would leave the gap between them.
      expect(await n.store.meta('nearbyClaimed:org1/p1')).toBe(String(olderSeq));
    });

    // The review of the fixes, 2026-11-24: the copy was dropped before its replacement was asked for, which may take many parts
    // on Bluetooth, and a teammate whose checkpoint moved after the drop threw `OtherCheckpoint`, which ended the session failed.
    it('asks for the replacement before dropping anything: a link that goes then leaves the part-filled copy and its passages', async () => {
      const { server, older, newer, newerSeq } = await twoCheckpoints();
      const n = await partFilled(server, newer.client);
      const before = n.client.fillProgress()!.filled;
      const fromOlder = asker(new StartingCopySender({ language: older.client }, 'p1'));
      const goesAtState: CopyAsker = async (ask) => {
        if (ask.part === 'state') throw new OfflineError('link dropped');
        return fromOlder(ask);
      };
      await expect(takeStartingCopy(goesAtState, targetOf(n.client))).rejects.toThrow(OfflineError);
      expect(await n.store.meta('startingCopy:org1/p1')).toBe(String(newerSeq));
      expect(n.client.fillProgress()!.filled).toBe(before);
    });

    it('a teammate whose checkpoint moves after the copy was dropped refuses it, and does not end the session', async () => {
      const { server, older, newer, olderSeq } = await twoCheckpoints();
      const n = await partFilled(server, newer.client);
      const fromOlder = asker(new StartingCopySender({ language: older.client }, 'p1'));
      let stateGiven = false;
      const moving: CopyAsker = async (ask) => {
        const got = await fromOlder(ask);
        if (ask.part === 'state') stateGiven = true;
        return got.t === 'copy-part' && got.part === 'rows' && stateGiven ? { ...got, seq: olderSeq + 1 } : got;
      };
      const err = await takeStartingCopy(moving, targetOf(n.client)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CopyRefused);
      expect((err as CopyRefused).reason).toBe('moved');
      // The older copy stands, its passages still to fill, from a teammate at its checkpoint.
      expect(await n.store.meta('startingCopy:org1/p1')).toBe(String(olderSeq));
      expect(await n.client.holdsCopy()).toBe(true);
    });

    it('a teammate whose rows and state are at different checkpoints refuses the copy, and nothing is dropped', async () => {
      const { server, older, newer, newerSeq } = await twoCheckpoints();
      const n = await partFilled(server, newer.client);
      const before = n.client.fillProgress()!.filled;
      const fromOlder = asker(new StartingCopySender({ language: older.client }, 'p1'));
      const split: CopyAsker = async (ask) => {
        const got = await fromOlder(ask);
        return got.t === 'copy-part' && got.part === 'rows' ? { ...got, seq: newerSeq + 500 } : got;
      };
      const err = await takeStartingCopy(split, targetOf(n.client)).catch((e: unknown) => e);
      expect((err as CopyRefused).reason).toBe('moved');
      expect(await n.store.meta('startingCopy:org1/p1')).toBe(String(newerSeq));
      expect(n.client.fillProgress()!.filled).toBe(before);
    });

    it('a teammate from before seqs on rows, at the copy\'s own checkpoint, finishes the fill with nothing dropped', async () => {
      const { server, newer, newerSeq } = await twoCheckpoints();
      const n = await partFilled(server, newer.client);
      const same = phone(server, 'dB', 'r3');
      await same.client.load();
      await settle(same.client);
      expect((await same.client.startingCopy())!.serverSeq).toBe(newerSeq);
      let drops = 0;
      const target = targetOf(n.client);
      target.language.dropCopy = async () => { drops += 1; await n.client.dropStartingCopy(); };
      const taken = await takeStartingCopy(unsaid(asker(new StartingCopySender({ language: same.client }, 'p1'))), target);
      expect(taken.whole).toBe(true);
      // Nothing dropped: the passages filled before stay, and only the rest came.
      expect(drops).toBe(0);
      expect(comparable(await whole(n.client, n.store))).toEqual(comparable(await whole(newer.client, newer.store)));
    });

    it('a teammate at the same checkpoint finishes the fill, and the copy is the first teammate\'s, whole', async () => {
      const { server, newer, newerSeq } = await twoCheckpoints();
      const n = await partFilled(server, newer.client);
      const same = phone(server, 'dB', 'r3');
      await same.client.load();
      await settle(same.client);
      expect((await same.client.startingCopy())!.serverSeq).toBe(newerSeq);
      const taken = await takeStartingCopy(asker(new StartingCopySender({ language: same.client }, 'p1')), targetOf(n.client));
      expect(taken.whole).toBe(true);
      expect(comparable(await whole(n.client, n.store))).toEqual(comparable(await whole(newer.client, newer.store)));
    });

    it('with no way to drop the copy, a teammate at another checkpoint refuses it, and nothing of it is filled in', async () => {
      const { server, older, newer } = await twoCheckpoints();
      const n = await partFilled(server, newer.client);
      const before = n.client.fillProgress()!.filled;
      await expect(takeStartingCopy(asker(new StartingCopySender({ language: older.client }, 'p1')), targetOf(n.client, { drop: false }))).rejects.toThrow(CopyRefused);
      expect(n.client.fillProgress()!.filled).toBe(before);
    });

    it('a teammate whose own fill is unfinished refuses the copy, rather than ending the session as a drop', async () => {
      const { server, newer } = await twoCheckpoints();
      const n = await partFilled(server, newer.client);
      const notFilled: CopyAsker = async (ask) => (ask.part === 'rows' ? { t: 'copy-no', reason: 'not-filled' } : asker(new StartingCopySender({ language: newer.client }, 'p1'))(ask));
      const err = await takeStartingCopy(notFilled, targetOf(n.client)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CopyRefused);
      expect((err as CopyRefused).reason).toBe('not-filled');
    });
  });

  // The review of 2026-11-24, item 3: names and up to 5,000 documents follow the passages one round trip each, the longest part;
  // a drop there threw `OfflineError`, so the copy was not set though the person held everything needed to work.
  it('a link that goes during the documents leaves the copy whole, said before the first document, with what came kept', async () => {
    const server = new FakeServer();
    server.serverCut = true;
    await language(server, 4);
    server.makeSnapshot('org1', 'p1');
    const t = await teammate(server);
    const doc = (i: number) => ({ format: 'study@2', title: `Guide ${i}`, links: [], steps: [{ id: 's', title: 'Listen', text: `Step ${i}` }], resources: [], terms: [], deps: [] });
    const hashOf = (d: unknown) => bytesToHex(fakeSha256(utf8Encode(canonicalJson(d))));
    const docs = [doc(1), doc(2), doc(3)];
    const reg = <T,>(value: T) => ({ value, hlc: 'x', eventId: 'e' });
    const library = Object.fromEntries(docs.map((d, i) => [`v${i}`, {
      kind: reg('material'), name: reg(`V${i}`), description: reg(''), copiedFrom: reg(null), versions: { [hashOf(d)]: { docHash: hashOf(d), hlc: 'x', eventId: 'e', actorId: 'lead' } },
      sharing: reg({ shared: false, subscribable: false }), archived: reg(false), subscription: reg(null), pinned: reg(null)
    }]));
    const orgState = { library, recommendations: {}, members: {}, roles: {}, languages: {} } as unknown as OrgState;
    const all = new Map(docs.map((d) => [hashOf(d), d as unknown as LibraryDoc]));
    const port: NearbyDocs = { head: async (x) => { const d = all.get(x); return d ? docHeadOf(d) : null; }, text: async (x) => (all.has(x) ? canonicalJson(all.get(x)) : null), keep: async () => true };
    const sender = new StartingCopySender({ language: t.client, org: { startingCopy: async () => ({ serverSeq: 1, state: orgState }) }, docs: port }, 'p1');
    const n = phone(server, 'dN', 'new-1', { online: () => false });
    await n.client.load();
    const said: string[] = [];
    let docAsks = 0;
    const dropping: CopyAsker = async (ask) => {
      if (ask.part === 'doc') said.push('doc');
      if (ask.part === 'doc' && ++docAsks === 2) throw new OfflineError('link dropped');
      return asker(sender)(ask);
    };
    const kept: string[] = [];
    const taken = await takeStartingCopy(dropping, {
      ...targetOf(n.client), docs: { head: async () => null, text: async () => null, keep: async (x) => { kept.push(x); return true; } },
      org: { holdsCopy: async () => true, adoptStartingCopy: async () => undefined, state: () => orgState }
    }, { held: false }, async (soFar) => { said.push(`whole ${String(soFar.whole)}`); });
    expect(taken.whole).toBe(true);
    expect(taken.docs).toMatchObject({ kept: 1, cut: true });
    expect(kept).toHaveLength(1);
    expect(said[0]).toBe('whole true');
    expect(said.filter((x) => x === 'whole true')).toHaveLength(1);
    // A drop before the copy is whole is still a drop: nothing is said whole.
    const m = phone(server, 'dM', 'new-2', { online: () => false });
    await m.client.load();
    const early: CopyAsker = async (ask) => { if (ask.part === 'rows') throw new OfflineError('link dropped'); return asker(sender)(ask); };
    const none: string[] = [];
    await expect(takeStartingCopy(early, { ...targetOf(m.client), org: { holdsCopy: async () => true, adoptStartingCopy: async () => undefined, state: () => orgState } }, { held: false },
      async () => { none.push('whole'); })).rejects.toThrow(OfflineError);
    expect(none).toEqual([]);
  });

  // The review of 2026-11-24, item 28: an older phone treated a document in a format a newer build added as forged, asked that
  // teammate nothing more that session, and did so again every session. 40 guides plus one such document listed first: 0 kept.
  it('a document this build cannot read is skipped and remembered, and every readable one after it is still taken', async () => {
    const server = new FakeServer();
    server.serverCut = true;
    await language(server, 4);
    server.makeSnapshot('org1', 'p1');
    const t = await teammate(server);
    const hashOf = (d: unknown) => bytesToHex(fakeSha256(utf8Encode(canonicalJson(d))));
    const later = { format: 'labels@9', title: 'From a newer build', deps: [] };
    const guides = Array.from({ length: 5 }, (_, i) => ({ format: 'study@2', title: `Guide ${i}`, links: [], steps: [{ id: 's', title: 'Listen', text: `Step ${i}` }], resources: [], terms: [], deps: [] }));
    const reg = <T,>(value: T) => ({ value, hlc: 'x', eventId: 'e' });
    // The unknown one is named first, as the review reproduced it.
    const named = [later, ...guides];
    const library = Object.fromEntries(named.map((d, i) => [`i${i}`, {
      kind: reg('material'), name: reg(`I${i}`), description: reg(''), copiedFrom: reg(null), versions: { [hashOf(d)]: { docHash: hashOf(d), hlc: 'x', eventId: 'e', actorId: 'lead' } },
      sharing: reg({ shared: false, subscribable: false }), archived: reg(false), subscription: reg(null), pinned: reg(null)
    }]));
    const orgState = { library, recommendations: {}, members: {}, roles: {}, languages: {} } as unknown as OrgState;
    const texts = new Map(named.map((d) => [hashOf(d), canonicalJson(d)]));
    // The newer teammate serves every document it holds, the unknown one among them.
    // A newer build reads the unknown format, and offers it as a guide.
    const theirs: NearbyDocs = { head: async (x) => (texts.has(x) ? { format: 'study@2', refs: [] } : null), text: async (x) => texts.get(x) ?? null, keep: async () => true };
    const sender = new StartingCopySender({ language: t.client, org: { startingCopy: async () => ({ serverSeq: 1, state: orgState }) }, docs: theirs }, 'p1');
    const remembered = new Set<string>();
    const kept: string[] = [];
    const asked: string[] = [];
    const mine: NearbyDocs = {
      head: async () => null, text: async () => null, keep: async (x) => { kept.push(x); return true; },
      unreadable: async () => remembered, noteUnreadable: async (x) => { remembered.add(x); }
    };
    const counting: CopyAsker = async (ask) => { if (ask.part === 'doc') asked.push(ask.hash!); return asker(sender)(ask); };
    const n = phone(server, 'dN', 'new-1', { online: () => false });
    await n.client.load();
    const target = { ...targetOf(n.client), docs: mine, org: { holdsCopy: async () => true, adoptStartingCopy: async () => undefined, state: () => orgState } };
    const taken = await takeStartingCopy(counting, target);
    expect(taken.docs).toMatchObject({ kept: 5, refused: 0, missing: 0, unreadable: 1 });
    expect(kept.sort()).toEqual(guides.map(hashOf).sort());
    expect([...remembered]).toEqual([hashOf(later)]);
    // Remembered until the app updates: the next session asks for it no more.
    asked.length = 0;
    const again = await takeStartingCopy(counting, { ...target, docs: { ...mine, head: async (x) => (kept.includes(x) ? docHeadOf(guides.find((g) => hashOf(g) === x) as unknown as LibraryDoc) : null) } });
    expect(asked).toEqual([]);
    expect(again.docs).toMatchObject({ kept: 0, refused: 0, missing: 0 });
    // A text with the wrong hash is still a forgery, and that teammate is asked nothing more.
    const forger: CopyAsker = async (ask) => (ask.part === 'doc' ? { t: 'copy-part', part: 'doc', next: null, body: canonicalJson({ ...guides[0], name: 'forged' }) } : asker(sender)(ask));
    const m = phone(server, 'dM', 'new-2', { online: () => false });
    await m.client.load();
    const forged = await takeStartingCopy(forger, { ...targetOf(m.client), docs: { head: async () => null, text: async () => null, keep: async () => true }, org: target.org });
    expect(forged.docs).toMatchObject({ kept: 0, refused: 1 });
  });

  // The review of 2026-11-24, item 27: a teammate part-way through downloading gave out what it held as a whole copy, and the
  // newcomer asks for the organization only while it holds none, so it kept an organization missing roles and members for good.
  describe('a stream gives a copy only once it was downloaded right up to the server\'s newest', () => {
    it('a language whose first download was cut short gives none, and says why, until a pull reaches the newest', async () => {
      const server = new FakeServer();
      server.serverCut = false;
      await language(server, 12);
      const p = phone(server, 'dP', 'r1', { pullPageSize: 4 });
      await p.client.load();
      expect(await p.client.canGiveCopy()).toEqual({ ok: false, why: 'nothing' });
      await p.client.pullSlice(0);
      expect(await p.store.cursor('org1', 'p1')).toBeGreaterThan(0);
      expect(await p.store.cursor('org1', 'p1')).toBeLessThan(server.head('org1', 'p1'));
      expect(await p.client.startingCopy()).toBeNull();
      expect(await p.client.canGiveCopy()).toEqual({ ok: false, why: 'downloading' });
      await settle(p.client);
      expect(await p.client.canGiveCopy()).toEqual({ ok: true });
      expect((await p.client.startingCopy())!.serverSeq).toBe(server.head('org1', 'p1'));
    });

    // The review of the fixes, 2026-11-24: the mark was written only with no copy held, so a copy an older build took (no mark)
    // and then replaced by a first download in several slices counted as downloaded between them, and gave what it held.
    it('a copy an older build took, replaced by a download in several slices, gives none until the last', async () => {
      const server = new FakeServer();
      server.serverCut = false;
      const lead = await language(server, 6);
      server.makeSnapshot('org1', 'p1');
      const t = phone(server, 'dT', 'r1', { keepOnDisk: false });
      await t.client.load();
      await settle(t.client);
      const copy = (await t.client.startingCopy())!;
      // Work after the snapshot, which the newcomer's first download pulls in pages after it.
      for (let i = 0; i < 12; i += 1) await lead.client.append('v1.NoteAdded', { noteId: `after-${i}`, unitId: 'u00', anchor: { kind: 'passage' }, text: 'later' });
      await lead.client.sync();
      const online = { on: false };
      const n = phone(server, 'dN', 'new-1', { keepOnDisk: false, online: () => online.on, pullPageSize: 4 });
      await n.client.load();
      await n.client.adoptStartingCopy(copy);
      // As an older build left it: no mark.
      await n.store.clearMeta('downloaded:');
      online.on = true;
      await n.client.pullSlice(0);
      expect(await n.client.holdsCopy()).toBe(false);
      expect(await n.store.cursor('org1', 'p1')).toBeGreaterThan(0);
      expect(await n.store.cursor('org1', 'p1')).toBeLessThan(server.head('org1', 'p1'));
      expect(await n.client.startingCopy()).toBeNull();
      await settle(n.client);
      expect((await n.client.startingCopy())!.serverSeq).toBe(server.head('org1', 'p1'));
    });

    it('a teammate still filling in says how far, and gives none', async () => {
      const server = new FakeServer();
      server.serverCut = true;
      await language(server, 12);
      server.makeSnapshot('org1', 'p1');
      const t = phone(server, 'dT', 'r1');
      await t.client.load();
      await t.client.sync();
      const ready = await t.client.canGiveCopy();
      expect(ready).toMatchObject({ ok: false, why: 'filling' });
      expect((ready as { fill: { filled: number; total: number } }).fill.total).toBeGreaterThan(0);
    });
  });

  // The review of 2026-11-24, item 26: an app on another reducer, from an update caught at a market or a newer install file,
  // dropped the newcomer's copy at the next start, and nothing said so or took one again.
  describe('a copy lost to another reducer is marked, and wanted again', () => {
    it('marks the copy lost when its checkpoint is dropped, and a copy taken again, or the server\'s download, clears the mark', async () => {
      const server = new FakeServer();
      server.serverCut = true;
      await language(server, 6);
      server.makeSnapshot('org1', 'p1');
      const t = await teammate(server);
      const online = { on: false };
      const n = await newcomer(server, t.client, online);
      expect(await n.client.copyNeed()).toBeNull();
      // The same store under a build with another reducer.
      const bumped = { ...LANGUAGE_MATERIALIZER, version: LANGUAGE_MATERIALIZER.version + 1 } as Materializer<Lang>;
      const after = phone(server, 'dN', 'new-1', { store: n.store, online: () => online.on, materializer: bumped });
      await after.client.load();
      expect(await after.client.holdsCopy()).toBe(false);
      expect(await after.client.copyNeed()).toBe('lost');
      expect(await n.store.meta('copyLost:org1/p1')).toBe('1');
      // A teammate on the new build gives it again.
      const t2 = phone(server, 'dT2', 'r2', { materializer: bumped });
      await t2.client.load();
      await settle(t2.client);
      await after.client.adoptStartingCopy((await t2.client.startingCopy())!);
      expect(await after.client.copyNeed()).toBe('filling');
      await after.client.fillFromCopy(rowsOverLink(asker(new StartingCopySender({ language: t2.client }, 'p1')), 'p1'));
      expect(await after.client.copyNeed()).toBeNull();
      expect(await n.store.meta('copyLost:org1/p1')).toBeFalsy();
      // A phone that never took one needs one; one with anything from the server needs none.
      const none = phone(server, 'dZ', 'z', { online: () => false });
      await none.client.load();
      expect(await none.client.copyNeed()).toBe('missing');
      expect(await t.client.copyNeed()).toBeNull();
    });

    it('a reducer change on a phone that downloaded from the server marks no copy lost, and gives no copy until downloaded again', async () => {
      const server = new FakeServer();
      server.serverCut = true;
      await language(server, 6);
      server.makeSnapshot('org1', 'p1');
      const t = await teammate(server);
      expect(await t.client.startingCopy()).not.toBeNull();
      const bumped = { ...LANGUAGE_MATERIALIZER, version: LANGUAGE_MATERIALIZER.version + 1 } as Materializer<Lang>;
      const online = { on: false };
      const after = phone(server, 'dT', 'r1', { store: t.store, online: () => online.on, materializer: bumped });
      await after.client.load();
      expect(await t.store.meta('copyLost:org1/p1')).toBeFalsy();
      expect(await after.client.startingCopy()).toBeNull();
      online.on = true;
      server.reducerVersion = bumped.version;
      server.makeSnapshot('org1', 'p1');
      await settle(after.client);
      expect(await after.client.startingCopy()).not.toBeNull();
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
    await client.fillFromCopy(rowsOverLink(unsaid(asker(new StartingCopySender({ language: t.client }, 'p1'))), 'p1', true));
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
