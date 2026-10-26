import { DatabaseSync } from 'node:sqlite';
import { emptyLanguageState, foldLanguage, HlcClock, type AnyEvent } from '@langquest-next/core';
import { MemoryStore, SqliteStore, SyncClient } from '@langquest-next/sync';
import { FakeServer } from '../../../packages/sync/src/testing/fakeServer';
import { LanguageRecordsKeeper, objectSqlDriver, positionIn, wholeRecords } from '../worker/languageRecords';
import type { SqlStore } from '../worker/sqlCache';
import { passageFor, passagesFor, PASSAGES_PAGE_MAX, type Signer } from '../worker/agent/view';
import { digestOf, digestOfRecords } from '../worker/agent/webhooks';
import type { Grant } from '../worker/agent/tokens';

/**
 * The organization's Durable Object reads each language for the
 * access-token API, MCP, review links and webhooks as records kept in its
 * own SQLite, taken from the server's cut (decisions.md 147), not as a
 * whole fold. Why these tests: the answers must be the ones a whole fold
 * gives, and the store must run on a Durable Object's SQLite, which takes
 * statements one way and few bound parameters.
 */

/** A Durable Object's SQLite as the object sees it, on node:sqlite: at most 100 bound parameters, no BEGIN of its own. */
function objectSql(): SqlStore & { statements: number } {
  const db = new DatabaseSync(':memory:');
  const store = {
    statements: 0,
    exec(query: string, ...bindings: unknown[]) {
      if (bindings.length > 100) throw new Error(`too many SQL variables: ${bindings.length}`);
      if (/^\s*(begin|commit|rollback)\b/i.test(query)) throw new Error('use transactionSync');
      store.statements += 1;
      const statement = db.prepare(query);
      const rows = statement.columns().length > 0 ? statement.all(...(bindings as never[])) : (statement.run(...(bindings as never[])), []);
      return { toArray: () => rows as Record<string, unknown>[] };
    },
    transactionSync<T>(fn: () => T): T {
      db.exec('begin');
      try { const out = fn(); db.exec('commit'); return out; } catch (e) { db.exec('rollback'); throw e; }
    }
  };
  return store;
}

let ids = 0;

/** A language of a few passages: versions shared and reviewed, requests, notes, a release. */
async function language(server: FakeServer) {
  const lead = new SyncClient({
    orgId: 'org1', streamId: 'p1', actorId: 'lead', deviceId: 'dA', store: new MemoryStore(), transport: server.transportFor(),
    clock: new HlcClock('dA', () => ++ids), newId: () => `dA-${++ids}`
  });
  await lead.load();
  await lead.append('v1.FlowSelected', { flowId: 'peer_only', name: 'Peer only' } as never);
  await lead.append('v1.FlowStepSet', { stepId: 'peer_only/s1', order: 's00', kindIds: ['peer'], checkpoint: false } as never);
  for (let i = 0; i < 12; i++) {
    const unitId = `u${String(i).padStart(2, '0')}`;
    await lead.append('v1.UnitAdded', { unitId, parentUnitId: null, kind: 'passage', label: `P${i}`, order: `a${i}` });
    if (i % 3 === 2) continue;
    const hash = `${i}`.repeat(64).slice(0, 64);
    await lead.append('v1.RecordingAdded', { recordingId: `r${i}`, unitId, kind: 'target', cards: [{ hash, durationMs: 1500 + i, format: 'm4a' }] });
    await lead.append('v1.TakeComposed', { takeId: `t${i}`, unitId, cardHashes: [hash], parentTakeId: null });
    await lead.append('v1.TakeSubmitted', { takeId: `t${i}` });
    if (i % 2 === 0) await lead.append('v1.ReviewRecorded', { reviewId: `rv${i}`, takeId: `t${i}`, kindId: 'peer', outcome: 'looks_good', via: 'app', comment: 'good' });
    if (i === 4) await lead.append('v1.VersionReleased', { takeId: 't4', channel: 'web', live: true });
    await lead.append('v1.RequestMade', { requestId: `q${i}`, unitId, what: 'review', kindId: 'peer', profileId: 'lead' });
  }
  await lead.sync();
  return lead;
}

const grant: Grant = { tokenId: 'tok', orgId: 'org1', profileId: 'lead', scopes: ['read', 'review', 'release'], languageIds: null };
const sign: Signer = async (key) => ({ url: `https://lq.test/${key}`, expiresAt: 0 });
const ALL = ['audio', 'reviews', 'steps', 'requests', 'versions', 'approvedAudio'] as const;

describe('a language read as records in the object\'s SQLite (decisions.md 147)', () => {
  it('runs sync\'s store on a Durable Object\'s SQLite: few bound parameters, statements gathered into one transaction', async () => {
    const sql = objectSql();
    const store = await SqliteStore.open(objectSqlDriver(sql));
    const rows = Array.from({ length: 2_500 }, (_, i) => ({ kind: 'take', id: `t${i}`, unitId: `u${i % 40}`, ref: '', json: '{}' }));
    await store.commit({ kept: { orgId: 'o', streamId: 's', upsert: rows }, meta: { a: '1' }, cursor: { orgId: 'o', streamId: 's', seq: 9 } });
    expect(await store.keptCount('o', 's', 'take')).toBe(2_500);
    expect(await store.keptById('o', 's', 'take', rows.map((r) => r.id))).toHaveLength(2_500);
    expect((await store.keptByUnit('o', 's', ['take', 'review'], ['u1', 'u2'])).length).toBe(126);
    expect(await store.cursor('o', 's')).toBe(9);
    // A statement that fails takes the whole write with it.
    await expect(store.commit({ meta: { b: '2' }, kept: { orgId: 'o', streamId: 's', upsert: [{ kind: 'take', id: 'x', unitId: null as never, ref: '', json: '{}' }] } })).rejects.toThrow(/NOT NULL/);
    expect(await store.meta('b')).toBeUndefined();
  });

  it('answers the API, the passage list and the webhook digest as a whole fold does, from the server\'s cut and its tail', async () => {
    const server = new FakeServer();
    server.serverCut = true;
    const lead = await language(server);
    server.makeSnapshot('org1', 'p1');
    // Work past the snapshot: a passage's new review, a new passage.
    await lead.append('v1.ReviewRecorded', { reviewId: 'rv-late', takeId: 't1', kindId: 'peer', outcome: 'needs_changes', via: 'app' });
    await lead.append('v1.UnitAdded', { unitId: 'u99', parentUnitId: null, kind: 'passage', label: 'P99', order: 'z' });
    await lead.sync();
    const whole = wholeRecords(foldLanguage([...server.stream('org1', 'p1')] as AnyEvent[], emptyLanguageState()));
    const keeper = new LanguageRecordsKeeper(server.transportFor(), 'org1', () => SqliteStore.open(objectSqlDriver(objectSql())), { fillInBackground: false, fillPageRows: 7 });
    const records = await keeper.records('p1');
    // Nothing whole was downloaded: the shared part and the lines, then each passage's rows as an answer needs them.
    expect(server.chunkCalls).toBe(0);
    expect(records.passages).toEqual(whole.passages);
    const query = { filter: {}, include: [...ALL], limit: PASSAGES_PAGE_MAX };
    expect(await passagesFor(grant, 'org1', 'p1', records, query, sign)).toEqual(await passagesFor(grant, 'org1', 'p1', whole, query, sign));
    for (const status of ['in_review', 'approved', 'not_started'] as const) {
      const q = { filter: { status }, include: [], limit: 2 };
      expect(await passagesFor(grant, 'org1', 'p1', records, q, sign), status).toEqual(await passagesFor(grant, 'org1', 'p1', whole, q, sign));
    }
    for (const u of ['u00', 'u01', 'u04', 'u99']) expect(await passageFor(grant, 'org1', 'p1', records, u, sign), u).toEqual(await passageFor(grant, 'org1', 'p1', whole, u, sign));
    expect(await digestOfRecords(records)).toEqual(digestOf(await whole.view([])));
    // A voice note is new only if nothing in the language names it, wherever its passage is.
    const named = await records.files(['1'.repeat(64), 'f'.repeat(64)]);
    expect([...named.named]).toEqual(['1'.repeat(64)]);
    expect(server.rowsCalls).toBeGreaterThan(0);
  });

  it('pulls on a read only when the head is past what is kept, and always when no head is given', async () => {
    const server = new FakeServer();
    server.serverCut = true;
    const lead = await language(server);
    const transport = server.transportFor();
    let pulls = 0;
    const counted = Object.create(transport) as typeof transport;
    counted.pull = (...args: Parameters<typeof transport.pull>) => { pulls += 1; return transport.pull(...args); };
    const keeper = new LanguageRecordsKeeper(counted, 'org1', () => SqliteStore.open(objectSqlDriver(objectSql())), { fillInBackground: false });
    await keeper.records('p1');
    const head = server.stream('org1', 'p1').length;
    const after = pulls;
    await keeper.records('p1', head);
    await keeper.records('p1', head - 1);
    expect(pulls).toBe(after);
    // A head past the cursor, or none known, pulls.
    await lead.append('v1.UnitAdded', { unitId: 'u77', parentUnitId: null, kind: 'passage', label: 'P77', order: 'zz' });
    await lead.sync();
    const moved = (await keeper.records('p1', server.stream('org1', 'p1').length)).passages;
    expect(pulls).toBe(after + 1);
    expect(moved).toContain('u77');
    await keeper.records('p1');
    expect(pulls).toBe(after + 2);
  });
});

describe('positionIn', () => {
  it('finds a passage\'s place in display order, or -1', () => {
    const passages = ['a', 'b', 'c'];
    expect(positionIn(passages, 'c')).toBe(2);
    expect(positionIn(passages, 'a')).toBe(0);
    expect(positionIn(passages, 'x')).toBe(-1);
  });
});
