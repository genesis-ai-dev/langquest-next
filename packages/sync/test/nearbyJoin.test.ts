import { canonicalJson, docHeadOf, HlcClock, keptVerdict, ORG_STREAM, PART_OF_KIND, putEntry, validateDoc, withOwnParts, type LanguageState, type LibraryDoc, type OrgState } from '@langquest-next/core';
import { nearbyDocHeadOf } from '@langquest-next/core/nearby';
import {
  base64urlEncode, bytesToHex, checkChain, joinPassBody, linkText, NEARBY_NEWCOMER_MS, nearbyBytes, newcomerProfileId, revocationText, utf8Encode,
  type ChainLink, type InviteLink, type JoinPass, type RevocationList, type WorkerLink
} from '@langquest-next/core/nearby';
import { FILE, PART_KINDS } from '../src/keptLanguage';
import { admitDoc, StartingCopySender, type NearbyCopySource, type NearbyDocs, type NearbyLabel, type NearbyLabels, type StartingCopyTarget } from '../src/nearbyCopy';
import { refusalOf, sessionDiagOf } from '../src/nearbyDiag';
import { joinOnlyKeep, joinOnlyPort, JOIN_EXCHANGE_ABILITY, NEARBY_PASS_USED_UP, type NearbyFileMoves, type NearbyJoinInviter, type NearbyJoinNewcomer, type NearbySessionReport } from '../src/nearbySession';
import { LanguageSession, type LocalFiles } from '../src/languageSession';
import { nearbyClient } from '../src/nearbyClient';
import { nearbyFiles, type NearbyFetchFile } from '../src/nearbyFiles';
import { nearbyDayOf, nearbyKeepOf } from '../src/nearbyKeep';
import { MemoryNearbyMarks } from '../src/nearbyMarks';
import { drawOpening, openingPinOf, QR_SALT, qrSessionKeyOf } from '../src/nearbyOpening';
import { encodeMessage, parseMessage } from '../src/nearbyWire';
import { NEARBY_MESSAGE_MAX } from '../src/nearbyLink';
import { ORG_MATERIALIZER } from '../src/orgSession';
import { SyncClient } from '../src/syncClient';
import { FakeServer } from '../src/testing/fakeServer';
import { fakeSha256, fakeSigner, memoryNearbyPair, type MemoryFiles, type MemoryNearbyPair } from '../src/testing/memoryNearbyLink';
import { OfflineError, type EventStore, type Transport } from '../src/types';
import { LANG, NOW, ORG, signerFor, STORES, teammate, worker, type Teammate } from './nearbyFixtures';
import { certified, newTime, record, sessionFor, settled, testPhone, type TestPhone } from './nearbyKit';

/**
 * Letting someone in over a link a QR code started (docs/nearby-sync-plan.md 14.1, 3 and 4).
 * Why these tests: before the inviter's one tap, a QR holder must learn nothing (no pass, chain,
 * discovery key, inviter id or copy part), a grant must name only the key, id, device and name
 * the newcomer asked with, and a starting copy must carry only this language and this
 * organization's live members, from a teammate that passed its read gate.
 */

const offline = (t: Transport): Transport => new Proxy(t, { get: (target, k) => (typeof (target as unknown as Record<string | symbol, unknown>)[k] === 'function' ? () => Promise.reject(new OfflineError('no server yet')) : (target as unknown as Record<string | symbol, unknown>)[k]) });
const SALT = base64urlEncode(new Uint8Array(16).fill(5));
const ROLES = [{ roleId: 'translator', privileges: ['translate', 'view_status'] as ('translate' | 'view_status')[] }];
const typesOf = (frames: readonly Uint8Array[]) => frames.map((f) => { const p = parseMessage(f); return p.kind === 'message' ? p.message.t : p.kind; });
const textOf = (frames: readonly Uint8Array[]) => frames.map((f) => new TextDecoder().decode(f)).join('\n');

describe.each(STORES)('letting someone in, on the %s store', (_name, make) => {
  let server: FakeServer;
  let time: ReturnType<typeof newTime>;
  let ids = 0;

  /** An inviter with Invite in the language, and its organization, on the server and on its phone. */
  async function inviterPhone(o: { scopes?: WorkerLink['body']['org']['scopes']; orgId?: string; kept?: boolean; now?: () => number; shelf?: MemoryFiles } = {}) {
    const crypto = fakeSigner('d-ana');
    const chain = await worker.certify({ installKey: crypto.publicKey, profileId: 'ana', deviceId: 'd-ana' }, {
      orgId: o.orgId ?? ORG, scopes: o.scopes ?? [{ level: 'language', languageId: LANG, privileges: ['invite_members', 'translate', 'view_status'] }]
    });
    const who: Teammate = { profileId: 'ana', deviceId: 'd-ana', crypto, key: crypto.publicKey, chain };
    const p = await testPhone(server, make(), who, o.shelf ?? new Map(), { ...(o.kept ? { keepOnDisk: true, checkpointEvery: 3 } : {}), ...(o.now ? { now: o.now } : {}) });
    await p.client.append('v1.UnitAdded', { unitId: 'u1', parentUnitId: null, kind: 'passage', label: 'u1', order: 'a' });
    await p.client.append('v1.RecordingAdded', { recordingId: 'by:ana:r1', unitId: 'u1', kind: 'target', cards: [{ hash: 'h1', durationMs: 5 }] });
    await p.client.sync();
    const org = new SyncClient<OrgState>({
      materializer: ORG_MATERIALIZER, orgId: ORG, streamId: ORG_STREAM, actorId: 'ana', deviceId: 'd-ana', store: make(), transport: server.transportFor(),
      clock: new HlcClock('d-ana-org', () => NOW + ++ids), newId: () => `org-${++ids}`
    });
    await org.load();
    await org.append('v1.OrgCreated', { name: 'Team' });
    await org.append('v1.RoleDefined', { roleId: 'translator', name: 'Translator', privileges: ['translate', 'view_status'] });
    await org.append('v1.LanguageAdded', { languageId: LANG, name: 'Dinka', code: 'din', sourceCode: 'eng' });
    await org.append('v1.LanguageAdded', { languageId: 'p2', name: 'Nuer', code: 'nus', sourceCode: 'eng' });
    await org.append('v1.MemberAdded', { profileId: 'ana', roleId: 'translator', scope: { level: 'language', languageId: LANG } });
    await org.append('v1.MemberAdded', { profileId: 'elsewhere', roleId: 'translator', scope: { level: 'language', languageId: 'p2' } });
    await org.sync();
    const pass = await worker.signPass((await joinPassBody({ orgId: ORG, languageId: LANG, inviter: 'ana', inviterKey: crypto.publicKey, roles: ROLES, nowMs: NOW }, fakeSha256))!);
    return { p, org, pass, who };
  }

  /** A phone with nobody on it: a new install key, an id from it, and no server. */
  async function newcomerPhone(o: { kept?: boolean; now?: () => number; shelf?: MemoryFiles } = {}) {
    const crypto = fakeSigner('d-new');
    const profileId = (await newcomerProfileId(crypto.publicKey, SALT, fakeSha256))!;
    const who: Teammate = { profileId, deviceId: 'd-new', crypto, key: crypto.publicKey, chain: [] };
    const p = await testPhone(server, make(), who, o.shelf ?? new Map(), { transport: offline(server.transportFor()), ...(o.kept ? { keepOnDisk: true } : {}), ...(o.now ? { now: o.now } : {}) });
    const org = new SyncClient<OrgState>({
      materializer: ORG_MATERIALIZER, orgId: ORG, streamId: ORG_STREAM, actorId: profileId, deviceId: 'd-new', store: make(), transport: offline(server.transportFor()),
      clock: new HlcClock('d-new-org', () => NOW + ++ids), newId: () => `n-${++ids}`
    });
    await org.load();
    const names: Record<string, string>[] = [];
    const target: Omit<StartingCopyTarget, 'sha256'> = {
      languageId: LANG,
      language: {
        holdsCopy: () => p.client.holdsCopy(), adoptStartingCopy: (c) => p.client.adoptStartingCopy(c), keptOnDisk: !!o.kept, state: () => p.client.getState(),
        ...(o.kept ? { fillFromCopy: (rows: Parameters<SyncClient['fillFromCopy']>[0]) => p.client.fillFromCopy(rows), keptPassageLinks: () => p.client.keptPassageLinks() } : {})
      },
      org: { holdsCopy: () => org.holdsCopy(), adoptStartingCopy: (c) => org.adoptStartingCopy(c), state: () => org.getState() },
      names: async (n) => { names.push(n); }
    };
    return { p, org, who, profileId, target, names };
  }

  beforeEach(() => {
    server = new FakeServer();
    time = newTime();
  });

  const run = async (inviter: TestPhone, newcomer: TestPhone, pair: MemoryNearbyPair, join: { i: NearbyJoinInviter; n: NearbyJoinNewcomer }, copy: NearbyCopySource) =>
    settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(newcomer, 'i', pair.a, time, { join: join.n, chain: [] }).run(),
      sessionFor(inviter, 'r', pair.b, time, { join: join.i, copy }).run());

  async function setUp(o: {
    tap?: string | null; stop?: string | null; pass?: (p: JoinPass) => JoinPass; inviter?: Parameters<typeof inviterPhone>[0]; newcomer?: Parameters<typeof newcomerPhone>[0]; features?: readonly string[];
    /** The newcomer runs the ordinary steps after a whole copy (2026-11-24), on its own phone's pieces. */
    exchange?: boolean;
    /** What the newcomer's `granted` answers for noting the meeting. */
    notesMetForMs?: number;
  } = {}) {
    const shelf: MemoryFiles = new Map();
    const a = await inviterPhone({ shelf, ...o.inviter });
    const n = await newcomerPhone({ shelf, ...o.newcomer });
    const granted: { chain: ChainLink[]; discovery: { key: string; gen: number; floor: number }; features: readonly string[]; revoked: { text: string; kid: string; sig: string } | null }[] = [];
    const shown: [number, number][] = [];
    const tapped: { name: string; profileId: string; pictures: [number, number] }[] = [];
    const join = {
      i: {
        as: 'inviter', pass: o.pass ? o.pass(a.pass) : a.pass, discovery: { key: base64urlEncode(new Uint8Array(32).fill(9)), gen: 4, floor: 2 },
        tap: async (who) => { tapped.push(who); return o.tap === undefined ? 'translator' : o.tap; },
        ...(o.stop !== undefined ? { stop: () => o.stop! } : {}), ...(o.features ? { features: o.features } : {})
      } satisfies NearbyJoinInviter,
      n: {
        as: 'newcomer', idSalt: SALT, profileId: n.profileId, name: 'Nyibol', pictures: (p) => shown.push(p),
        granted: async (g) => {
          granted.push({ chain: g.chain, discovery: g.discovery, features: g.features, revoked: g.revoked });
          return o.notesMetForMs !== undefined ? { keep: n.p.keep, notesMetForMs: o.notesMetForMs } : undefined;
        },
        target: n.target,
        ...(o.exchange ? {
          exchange: {
            library: false,
            open: async () => ({ port: n.p.client, gate: { people: () => n.p.people }, signer: signerFor(n.who.crypto, { [n.profileId]: granted[0]!.chain }), files: n.p.files })
          }
        } : {})
      } satisfies NearbyJoinNewcomer
    };
    const copy: NearbyCopySource = { language: a.p.client, org: a.org, names: async () => ({ ana: 'Ana', elsewhere: 'Someone else\'s', asker: 'A join request' }) };
    const pair = memoryNearbyPair({ time, kind: 'wifi-direct', files: shelf });
    return { a, n, join, copy, pair, granted, shown, tapped, shelf };
  }

  // Carl, 2026-11-24: a phone that joined offline never heard the server say its organization shares while LangQuest is
  // open, so the two phones never met by themselves. The grant carries the inviter's word.
  it('hands the newcomer the organization\'s nearby features as the inviter\'s phone knows them, and none from an inviter that says none', async () => {
    const s = await setUp({ features: ['nearby', 'nearby_join', 'nearby_open'] });
    await run(s.a.p, s.n.p, s.pair, s.join, s.copy);
    expect(s.granted.map((g) => g.features)).toEqual([['nearby', 'nearby_join', 'nearby_open']]);
    const older = await setUp();
    await run(older.a.p, older.n.p, older.pair, older.join, older.copy);
    expect(older.granted.map((g) => g.features)).toEqual([[]]);
  });

  it('after one tap: the same two pictures on both phones, a grant naming what the newcomer asked with, and a starting copy of this language only', async () => {
    const s = await setUp();
    const [rn, ri] = await run(s.a.p, s.n.p, s.pair, s.join, s.copy);
    expect(rn.ended).toEqual({ how: 'done' });
    expect(ri.ended).toEqual({ how: 'done' });
    expect(rn.join?.granted).toBe(true);
    expect(s.shown).toEqual([s.tapped[0]!.pictures]);
    expect(ri.join?.pictures).toEqual(rn.join?.pictures);
    expect(s.tapped[0]).toMatchObject({ name: 'Nyibol', profileId: s.n.profileId });
    expect(s.granted).toHaveLength(1);
    expect(s.granted[0]!.discovery).toEqual({ key: base64urlEncode(new Uint8Array(32).fill(9)), gen: 4, floor: 2 });
    const verdict = await checkChain(s.granted[0]!.chain, { rootKeys: worker.rootKeys, orgId: ORG, languageId: LANG, now: NOW, verify: s.n.who.crypto.verify, sha256: fakeSha256 });
    expect(verdict).toMatchObject({ ok: true, links: 2, roleId: 'translator', inviter: 'ana', holder: { profileId: s.n.profileId, installKey: s.n.who.key, deviceId: 'd-new', name: 'Nyibol' } });
    // Its certificate for this organization and no other.
    expect((s.granted[0]!.chain[0] as WorkerLink).body.org.orgId).toBe(ORG);
    // The starting copy: the language's confirmed work, the organization's cut, and names of its members only.
    expect(await s.n.p.client.holdsCopy()).toBe(true);
    expect(Object.keys((s.n.p.client.getState() as LanguageState).recordings)).toEqual(['by:ana:r1']);
    expect(Object.keys(s.n.org.getState().members)).toEqual(['ana']);
    expect(Object.keys(s.n.org.getState().languages)).toEqual([LANG]);
    expect(s.n.names).toEqual([{ ana: 'Ana' }]);
    expect(rn.copy).toMatchObject({ whole: true });
    expect(ri.copyServed.parts).toBeGreaterThan(0);
    expect(ri.copyServed.stateRefused).toBeNull();
  });

  // Decision 240 as amended (Carl, 2026-11-24): every pass expires at its window's end, so a newcomer let in the day
  // before it was refused at Hello by every teammate the day after. The link now says when it was made.
  it('a newcomer let in before the pass expired is accepted at Hello past its expiry, for 90 days from the tap; a link with no time of its own is not', async () => {
    const DAY = 86_400_000;
    const s = await setUp();
    const [rn] = await run(s.a.p, s.n.p, s.pair, s.join, s.copy);
    expect(rn.join?.granted).toBe(true);
    const chain = s.granted[0]!.chain;
    const link = chain[1] as InviteLink;
    // Made by the inviter's Hello clock, at the tap.
    const madeAt = link.body.madeAt!;
    expect(madeAt).toBeGreaterThanOrEqual(NOW);
    expect(madeAt).toBeLessThanOrEqual(s.a.p.client.nearbyHelloNow);
    const newcomer = { ...s.n.p, who: { ...s.n.who, chain } };
    const cyAt = async (wall: number) => testPhone(server, make(), await teammate('cy'), new Map(), { now: () => wall });
    const hello = async (cy: Awaited<ReturnType<typeof cyAt>>) => {
      const pair = memoryNearbyPair({ time, kind: 'wifi-direct' });
      return settled<[NearbySessionReport, NearbySessionReport]>(time, sessionFor(newcomer, 'i', pair.a, time).run(), sessionFor(cy, 'r', pair.b, time).run());
    };
    // A teammate whose clock is a day past the pass's expiry.
    const past = await cyAt(s.a.pass.body.expiresAt + DAY);
    expect(past.client.nearbyHelloNow).toBeGreaterThan(s.a.pass.body.expiresAt);
    const [, ok] = await hello(past);
    expect(ok.ended).toEqual({ how: 'done' });
    expect(ok.peer?.profileId).toBe(s.n.profileId);
    // Ninety days from the tap, and not a moment more.
    expect((await hello(await cyAt(madeAt + NEARBY_NEWCOMER_MS)))[1].ended).toEqual({ how: 'done' });
    const [, late] = await hello(await cyAt(madeAt + NEARBY_NEWCOMER_MS + 1));
    expect(late.ended).toMatchObject({ how: 'said', reason: 'identity', detail: 'pass expired' });
    // A link from a build before then names no time: it lasts to its pass's expiry, as it always did.
    const { madeAt: _dropped, ...older } = link.body;
    const olderLink: InviteLink = { kind: 'invite@1', body: older, sig: await s.a.who.crypto.sign(nearbyBytes('link', linkText({ kind: 'invite@1', body: older }, (chain[0] as WorkerLink).sig))) };
    const before = { ...s.n.p, who: { ...s.n.who, chain: [chain[0]!, olderLink] } };
    const pair = memoryNearbyPair({ time, kind: 'wifi-direct' });
    const [, refused] = await settled<[NearbySessionReport, NearbySessionReport]>(time, sessionFor(before, 'i', pair.a, time).run(), sessionFor(await cyAt(s.a.pass.body.expiresAt + DAY), 'r', pair.b, time).run());
    expect(refused.ended).toMatchObject({ how: 'said', reason: 'identity', detail: 'pass expired' });
    // Field diagnostics tell it from a certificate that expired (it was filed as "other").
    expect(refusalOf('pass expired')).toBe('pass-expired');
  });

  // The review of 2026-11-24, item 13: a newcomer whose app is in French saw English names where the inviter saw French ones.
  it('the copy carries the names the team\'s followed items go by in the newcomer\'s language, as the inviter\'s phone keeps them', async () => {
    const s = await setUp();
    const hash = 'a'.repeat(64);
    await s.a.org.append('v1.LibrarySubscribed', { itemId: 'sub.fia.guides', kind: 'material', sourceOrgId: 'fia', sourceOrgName: 'FIA', sourceItemId: 'guides', name: 'FIA guides', autoUpdate: true, active: true });
    await s.a.org.append('v1.LibraryPinned', { itemId: 'sub.fia.guides', kind: 'material', docHash: hash });
    await s.a.org.sync();
    const keeping = (held: Record<string, NearbyLabel>) => {
      const kept = new Map(Object.entries(held));
      const labels: NearbyLabels = { lang: async () => 'fra', kept: async () => kept, fromServer: async () => false, keep: async (_l, got) => { for (const [k, v] of got) if (!kept.has(k)) kept.set(k, v); } };
      return { labels, kept };
    };
    const there = keeping({ 'fia/guides': { name: 'Guides FIA' }, 'pub/unused': { name: 'Pas pour cette langue' } });
    const here = keeping({});
    s.n.target.labels = here.labels;
    const [rn, ri] = await run(s.a.p, s.n.p, s.pair, s.join, { ...s.copy, labels: there.labels });
    expect([rn.ended, ri.ended]).toEqual([{ how: 'done' }, { how: 'done' }]);
    expect([...here.kept]).toEqual([['fia/guides', { name: 'Guides FIA' }]]);
    expect(rn.copy?.docs.labels).toBe(1);
  });

  // The review of item 13's fix: a store that could not keep the names threw out of a whole copy, after the passages came.
  it('a newcomer whose store cannot keep the names still takes the copy whole, and the session ends done', async () => {
    const s = await setUp();
    const hash = 'a'.repeat(64);
    await s.a.org.append('v1.LibrarySubscribed', { itemId: 'sub.fia.guides', kind: 'material', sourceOrgId: 'fia', sourceOrgName: 'FIA', sourceItemId: 'guides', name: 'FIA guides', autoUpdate: true, active: true });
    await s.a.org.append('v1.LibraryPinned', { itemId: 'sub.fia.guides', kind: 'material', docHash: hash });
    await s.a.org.sync();
    const there: NearbyLabels = { lang: async () => 'fra', kept: async () => new Map([['fia/guides', { name: 'Guides FIA' }]]), fromServer: async () => false, keep: async () => undefined };
    const failed: unknown[] = [];
    s.n.target.labels = { ...there, kept: async () => new Map(), keep: async () => { throw new Error('storage full'); }, failed: (err) => { failed.push(err); } };
    const [rn, ri] = await run(s.a.p, s.n.p, s.pair, s.join, { ...s.copy, labels: there });
    expect([rn.ended, ri.ended]).toEqual([{ how: 'done' }, { how: 'done' }]);
    expect(rn.copy?.whole).toBe(true);
    expect(rn.copy?.docs.labels).toBeUndefined();
    expect(failed).toHaveLength(1);
  });

  // Found on two emulators: the inviter refused the language's state and still said the newcomer could work now.
  it('an inviter with no copy of the language to give lets them in and its report says why the copy is short', async () => {
    const s = await setUp();
    const [rn, ri] = await run(s.a.p, s.n.p, s.pair, s.join, { ...s.copy, language: { startingCopy: async () => null } });
    expect(rn.join?.granted).toBe(true);
    expect(rn.copyRefused).toBe('not-filled');
    expect(await s.n.p.client.holdsCopy()).toBe(false);
    expect(ri.copyServed.stateRefused).toBe('not-filled');
    expect(ri.ended).toEqual({ how: 'done' });
  });

  it('before the tap nothing the inviter sent holds its pass, chain, key, id or device, and a No sends none of it', async () => {
    const s = await setUp({ tap: null });
    const [rn, ri] = await run(s.a.p, s.n.p, s.pair, s.join, s.copy);
    expect(ri.ended).toEqual({ how: 'said', reason: 'stopped', detail: 'not let in' });
    expect(rn.join?.granted).toBe(false);
    expect(s.granted).toEqual([]);
    expect(await s.n.p.client.holdsCopy()).toBe(false);
    expect(await s.n.org.holdsCopy()).toBe(false);
    const sent = s.pair.sent.b.frames;
    expect(typesOf(sent)).not.toContain('join-grant');
    expect(typesOf(sent)).not.toContain('copy-part');
    const text = textOf(sent);
    for (const secret of ['ana', 'd-ana', s.a.who.key, s.a.pass.body.passId, base64urlEncode(new Uint8Array(32).fill(9))]) expect(text).not.toContain(secret);
  });

  it('a copy asked before the grant gets copy-no not-allowed, and nothing of the copy moves until the tap', async () => {
    const s = await setUp();
    const realSend = s.pair.a.send.bind(s.pair.a);
    s.pair.a.send = async (bytes) => {
      const p = parseMessage(bytes);
      if (p.kind === 'message' && p.message.t === 'join-ask') await realSend(encodeMessage({ t: 'copy-ask', part: 'state', stream: LANG }));
      await realSend(bytes);
    };
    const [rn] = await run(s.a.p, s.n.p, s.pair, s.join, s.copy);
    expect(rn.join?.granted).toBe(true);
    const types = typesOf(s.pair.sent.b.frames);
    expect(types.indexOf('copy-no')).toBeGreaterThan(-1);
    expect(types.indexOf('copy-no')).toBeLessThan(types.indexOf('join-grant'));
    expect(types.indexOf('copy-part')).toBeGreaterThan(types.indexOf('join-grant'));
  });

  it('a pass this phone\'s fold has stopped, an expired pass and a role off the pass each send nothing', async () => {
    for (const o of [
      { stop: 'inviter could not grant this role' },
      { pass: (p: JoinPass) => ({ ...p, body: { ...p.body, expiresAt: NOW - 1 } }) },
      { tap: 'admin' }
    ]) {
      server = new FakeServer();
      const s = await setUp(o);
      const [rn, ri] = await run(s.a.p, s.n.p, s.pair, s.join, s.copy);
      expect(ri.ended.how, JSON.stringify(o)).toBe('said');
      expect(rn.join?.granted).toBe(false);
      expect(s.granted).toEqual([]);
      expect(typesOf(s.pair.sent.b.frames)).not.toContain('join-grant');
      expect(await s.n.p.client.holdsCopy()).toBe(false);
    }
  });

  it('a person in two organizations grants with this organization\'s certificate or not at all', async () => {
    const s = await setUp({ inviter: { orgId: 'org2' } });
    const [rn, ri] = await run(s.a.p, s.n.p, s.pair, s.join, s.copy);
    expect(ri.ended).toMatchObject({ how: 'said', reason: 'identity' });
    expect(rn.join?.granted).toBe(false);
    expect(typesOf(s.pair.sent.b.frames)).not.toContain('join-grant');
  });

  it('clocks more than five minutes apart let nobody in', async () => {
    const s = await setUp();
    const late = await testPhone(server, make(), s.n.who, new Map(), { transport: offline(server.transportFor()), now: () => NOW + 6 * 60_000 });
    const [rn, ri] = await run(s.a.p, late, s.pair, { ...s.join, n: { ...s.join.n, target: { ...s.n.target } } }, s.copy);
    expect([rn.ended, ri.ended]).toContainEqual({ how: 'said', reason: 'protocol', detail: 'clock' });
    expect(s.granted).toEqual([]);
  });

  it('a newcomer whose QR code named no organization takes it from the grant, and the copy goes where granted says', async () => {
    const s = await setUp();
    const seen: { orgId: string; languageId: string }[] = [];
    const n: NearbyJoinNewcomer = {
      as: 'newcomer', idSalt: SALT, profileId: s.n.profileId, name: 'Nyibol',
      granted: async (g) => { seen.push({ orgId: g.orgId, languageId: g.languageId }); return { target: s.n.target }; }
    };
    const [rn, ri] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(s.n.p, 'i', s.pair.a, time, { join: n, chain: [], orgId: '', languageId: '', port: joinOnlyPort(() => NOW), keep: joinOnlyKeep() }).run(),
      sessionFor(s.a.p, 'r', s.pair.b, time, { join: s.join.i, copy: s.copy }).run());
    expect(ri.ended).toEqual({ how: 'done' });
    expect(rn.join?.granted).toBe(true);
    expect(seen).toEqual([{ orgId: ORG, languageId: LANG }]);
    expect(rn.copy).toMatchObject({ whole: true });
    expect(await s.n.p.client.holdsCopy()).toBe(true);
  });

  it('a QR link opens only on the opening its pin names: another opening under the same secret gets silence and no ask', async () => {
    const qr = fakeSigner('qr');
    const secret = qr.randomBytes(16);
    const kSess = qrSessionKeyOf(qr, secret);
    for (const pinned of [true, false]) {
      server = new FakeServer();
      const s = await setUp();
      const drawn = drawOpening(s.a.who.crypto);
      const other = drawOpening(s.a.who.crypto);
      const pin = openingPinOf(qr, (pinned ? drawn : other).eph.public, (pinned ? drawn : other).nonce);
      const [rn, ri] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
        sessionFor(s.n.p, 'i', s.pair.a, time, { join: s.join.n, chain: [], opening: { kSess, salt: QR_SALT, kFind: new Uint8Array(32), pin } }).run(),
        sessionFor(s.a.p, 'r', s.pair.b, time, { join: s.join.i, copy: s.copy, opening: { kSess, salt: QR_SALT, kFind: new Uint8Array(32), seen: new Set(), drawn } }).run());
      if (pinned) {
        expect(rn.join?.granted).toBe(true);
        expect(ri.ended).toEqual({ how: 'done' });
      } else {
        expect(rn.ended).toEqual({ how: 'silent' });
        expect(s.granted).toEqual([]);
        expect(typesOf(s.pair.sent.a.frames)).not.toContain('join-ask');
      }
    }
  });

  it('a dropped link after the grant resumes the copy from a teammate after an ordinary Hello', async () => {
    const s = await setUp();
    // Drop as soon as the first part of the copy has gone.
    let parts = 0;
    const realSend = s.pair.b.send.bind(s.pair.b);
    s.pair.b.send = async (bytes) => {
      const p = parseMessage(bytes);
      if (p.kind === 'message' && p.message.t === 'copy-part' && ++parts === 2) s.pair.drop();
      return realSend(bytes);
    };
    const [rn] = await run(s.a.p, s.n.p, s.pair, s.join, s.copy);
    expect(rn.join?.granted).toBe(true);
    expect(rn.ended.how).toBe('dropped');
    expect(await s.n.org.holdsCopy()).toBe(true);
    expect(await s.n.p.client.holdsCopy()).toBe(false);
    // Now the newcomer holds its chain, and meets the inviter as anyone does.
    const holder: Teammate = { ...s.n.who, chain: s.granted[0]!.chain };
    const again = memoryNearbyPair({ time, kind: 'wifi-direct' });
    const [rn2, ri2] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(s.n.p, 'i', again.a, time, { chain: holder.chain, signer: { publicKey: holder.key, sign: holder.crypto.sign, sha256: fakeSha256, chainFor: () => holder.chain }, takeCopy: s.n.target }).run(),
      sessionFor(s.a.p, 'r', again.b, time, { copy: s.copy }).run());
    expect(ri2.ended).toEqual({ how: 'done' });
    expect(rn2.ended).toEqual({ how: 'done' });
    expect(rn2.copy).toMatchObject({ whole: true });
    expect(Object.keys((s.n.p.client.getState() as LanguageState).recordings)).toEqual(['by:ana:r1']);
    // Found on two emulators: the teammate showed them as "Someone". Their chain names them, and the report says so.
    expect(ri2.peer).toMatchObject({ profileId: s.n.profileId, name: 'Nyibol' });
    expect(rn2.peer?.name).toBeUndefined();
  });

  // The security review's: a newcomer kept every Have a teammate sent while it waited on a part, with no limit.
  it('a second Have while the newcomer waits on its copy ends the session before the copy is taken', async () => {
    const s = await setUp();
    let parts = 0;
    const realSend = s.pair.b.send.bind(s.pair.b);
    s.pair.b.send = async (bytes) => {
      const p = parseMessage(bytes);
      if (p.kind === 'message' && p.message.t === 'copy-part' && ++parts === 2) s.pair.drop();
      return realSend(bytes);
    };
    await run(s.a.p, s.n.p, s.pair, s.join, s.copy);
    const holder: Teammate = { ...s.n.who, chain: s.granted[0]!.chain };
    const again = memoryNearbyPair({ time, kind: 'wifi-direct' });
    const send = again.b.send.bind(again.b);
    again.b.send = async (bytes) => {
      const p = parseMessage(bytes);
      if (p.kind === 'message' && p.message.t === 'have') await send(bytes);
      return send(bytes);
    };
    const [rn2] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(s.n.p, 'i', again.a, time, { chain: holder.chain, signer: { publicKey: holder.key, sign: holder.crypto.sign, sha256: fakeSha256, chainFor: () => holder.chain }, takeCopy: s.n.target }).run(),
      sessionFor(s.a.p, 'r', again.b, time, { copy: s.copy }).run());
    expect(rn2.ended).toMatchObject({ how: 'said', reason: 'protocol' });
    expect(rn2.copy?.whole ?? false).toBe(false);
    expect(await s.n.p.client.holdsCopy()).toBe(false);
  });

  // The newcomer was left looking, beside a teammate who could never finish the copy, and was not told why.
  it('a teammate on another version gives no copy, and the newcomer\'s report says that is why', async () => {
    const s = await setUp();
    let parts = 0;
    const realSend = s.pair.b.send.bind(s.pair.b);
    s.pair.b.send = async (bytes) => {
      const p = parseMessage(bytes);
      if (p.kind === 'message' && p.message.t === 'copy-part' && ++parts === 2) s.pair.drop();
      return realSend(bytes);
    };
    await run(s.a.p, s.n.p, s.pair, s.join, s.copy);
    expect(await s.n.p.client.holdsCopy()).toBe(false);
    const holder: Teammate = { ...s.n.who, chain: s.granted[0]!.chain };
    const again = memoryNearbyPair({ time, kind: 'wifi-direct' });
    // The teammate runs a newer reducer: its hello says so.
    const send = again.b.send.bind(again.b);
    again.b.send = async (bytes) => {
      const p = parseMessage(bytes);
      return send(p.kind === 'message' && p.message.t === 'hello' ? encodeMessage({ ...p.message, reducerVersion: p.message.reducerVersion + 1 }) : bytes);
    };
    const [rn2] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(s.n.p, 'i', again.a, time, { chain: holder.chain, signer: { publicKey: holder.key, sign: holder.crypto.sign, sha256: fakeSha256, chainFor: () => holder.chain }, takeCopy: s.n.target }).run(),
      sessionFor(s.a.p, 'r', again.b, time, { copy: s.copy }).run());
    expect(rn2.copy).toBeNull();
    expect(rn2.copyRefused).toBe('versions');
    expect(await s.n.p.client.holdsCopy()).toBe(false);
  });

  /** The language as a phone holds it: memory, and for one that keeps it on disk every kept row too. */
  async function whole(p: TestPhone, kept: boolean): Promise<LanguageState> {
    const live = p.client.getState() as LanguageState;
    if (!kept) return live;
    const out = withOwnParts(structuredClone(live));
    for (const kind of PART_KINDS) for (const row of await p.store.keptAll(ORG, LANG, kind)) putEntry(out, PART_OF_KIND.get(kind)!, row.id, JSON.parse(row.json));
    for (const row of await p.store.keptAll(ORG, LANG, FILE)) {
      const k = JSON.parse(row.json) as LanguageState['blobs'][string];
      const here = out.blobs[row.id];
      out.blobs[row.id] = here ? keptVerdict(k, here) : k;
    }
    return out;
  }
  const keysOf = (l: LanguageState) => ({ units: Object.keys(l.units).sort(), recordings: Object.keys(l.recordings).sort(), notes: Object.keys(l.notes).sort() });
  const DAY = 86_400_000;

  // The review of 2026-11-24, item 2 (and T1): the copy is the inviter's last checkpoint, up to 1,999 events old, and the QR
  // session ended straight after it, so the newcomer started behind the phone beside it, without the work the inviter had
  // pulled since, its unsent work, the teammates' work it carried, or any file, until it got online.
  it('after a whole copy the two run the ordinary steps on the same link, and the newcomer holds what the inviter\'s phone holds, files too', async () => {
    server.attester = worker.attestRows;
    const s = await setUp({ inviter: { kept: true }, newcomer: { kept: true }, exchange: true });
    // A teammate's work the inviter pulls after its checkpoint, fewer events than a checkpoint takes.
    const cy = await testPhone(server, make(), await teammate('cy'), s.shelf);
    await cy.client.append('v1.UnitAdded', { unitId: 'u2', parentUnitId: null, kind: 'passage', label: 'u2', order: 'b' });
    await cy.client.sync();
    await s.a.p.client.sync();
    await cy.client.append('v1.RecordingAdded', { recordingId: 'by:cy:r2', unitId: 'u2', kind: 'target', cards: [{ hash: 'h2', durationMs: 5 }] });
    await cy.client.sync();
    await s.a.p.client.sync();
    const checkpoint = (await s.a.p.client.startingCopy())!.serverSeq;
    expect(checkpoint).toBeLessThan(server.head(ORG, LANG));
    // A teammate's work the inviter carries, with its file, from a meeting nearby.
    const dan = await testPhone(server, make(), await teammate('dan'), s.shelf);
    const carried = await record(dan, s.shelf, 'd1', 'u1');
    const met = memoryNearbyPair({ time, kind: 'wifi-direct', files: s.shelf });
    await settled(time, sessionFor(dan, 'i', met.a, time).run(), sessionFor(s.a.p, 'r', met.b, time).run());
    expect(s.a.p.files.here.has(carried)).toBe(true);
    // And the inviter's own unsent work: a recording with its file, and a note.
    const unsent = await record(s.a.p, s.shelf, 'unsent', 'u1');
    await s.a.p.client.append('v1.NoteAdded', { noteId: 'by:ana:n1', unitId: 'u1', anchor: { kind: 'passage' }, text: 'not sent yet' });

    const [rn, ri] = await run(s.a.p, s.n.p, s.pair, s.join, s.copy);
    expect(rn.ended).toEqual({ how: 'done' });
    expect(ri.ended).toEqual({ how: 'done' });
    expect(rn.copy).toMatchObject({ whole: true });
    expect([rn.join?.exchange, ri.join?.exchange]).toEqual([true, true]);
    const theirs = keysOf(await whole(s.a.p, true));
    expect(theirs.recordings).toEqual(expect.arrayContaining(['by:ana:r1', 'by:cy:r2', 'by:dan:d1', 'by:ana:unsent']));
    expect(keysOf(await whole(s.n.p, true))).toEqual(theirs);
    // The files of the work it carried and of its own unsent recording, over the same link.
    expect(s.n.p.files.here.has(unsent)).toBe(true);
    expect(s.n.p.files.here.has(carried)).toBe(true);
    // The join in field diagnostics, on both phones (item 14): granted, the steps after the copy, and what the copy was.
    expect(sessionDiagOf(rn, 1, 'join')).toMatchObject({ t: { event: 'session', mode: 'join', role: 'i', end: 'done' }, n: { granted: 1, exchanged: 1, copyWhole: 1 } });
    const inviterRecord = sessionDiagOf(ri, 1, 'join');
    expect(inviterRecord).toMatchObject({ t: { mode: 'join', role: 'r' }, n: { granted: 1, exchanged: 1 } });
    expect(inviterRecord.n!['copyParts']).toBeGreaterThan(0);
  });

  // The review of 2026-11-24, T1 (joinParity): a phone that joined offline does what its inviter's does. After the join, the
  // newcomer holds the documents the language uses and the files they name that the inviter's phone holds, and knows each
  // came from the library, so it passes them on in turn.
  it('after the join the newcomer holds the inviter\'s documents and the guide and key-word files they name, as library files', async () => {
    server.attester = worker.attestRows;
    const s = await setUp({ inviter: { kept: true }, newcomer: { kept: true }, exchange: true });
    const fileOf = (name: string) => bytesToHex(fakeSha256(new TextEncoder().encode(`file ${name}`)));
    const [audio, picture, word] = ['step audio', 'map', 'word audio'].map(fileOf) as [string, string, string];
    const guide = {
      format: 'study@2', title: 'Clean water', links: [], deps: [],
      steps: [{ id: 's1', title: 'Listen', text: 'Water at dawn.', audio: { hash: audio, format: 'm4a' } }],
      resources: [{ ref: 'MRK 1:1', kind: 'media', title: 'Map', media: [{ id: 'm', kind: 'map', title: 'Map', caption: '', file: { hash: picture, format: 'jpg' } }] }],
      terms: []
    };
    const words = { format: 'material@1', kind: 'key_terms', title: 'Words', source: 'team', pattern: 'FIA', deps: [], terms: [{ id: 'w', term: 'water', gloss: '', audio: { hash: word, format: 'm4a' } }] };
    const hashOf = (d: unknown) => bytesToHex(fakeSha256(utf8Encode(canonicalJson(d))));
    for (const [itemId, doc] of [['guide', guide], ['words', words]] as const) {
      await s.a.org.append('v1.LibraryItemDefined', { itemId, kind: 'material', name: itemId, description: '' });
      await s.a.org.append('v1.LibraryVersionPublished', { itemId, kind: 'material', docHash: hashOf(doc) });
      await s.a.org.append('v1.ReferenceRecommended', { itemId, recommended: true });
    }
    await s.a.org.sync();
    // The inviter's documents and files, each file known to have come from the library.
    const shelfDocs = (held: readonly unknown[]): NearbyDocs & { held: Map<string, LibraryDoc> } => {
      const held2 = new Map<string, LibraryDoc>(held.map((d) => [hashOf(d), d as LibraryDoc]));
      return {
        held: held2,
        head: async (x) => { const d = held2.get(x); return d ? nearbyDocHeadOf(d) : null; },
        text: async (x) => (held2.has(x) ? canonicalJson(held2.get(x)) : null),
        keep: async (x, text) => { held2.set(x, JSON.parse(text) as LibraryDoc); return true; }
      };
    };
    const inviterDocs = shelfDocs([guide, words]);
    const newcomerDocs = shelfDocs([]);
    const origins = { inviter: new Set([audio, picture, word]), newcomer: new Set<string>() };
    const withLibraryFiles = (p: TestPhone, mine: Set<string>) => {
      const at = (x: string) => `${p.who.deviceId}/${x}`;
      // As the language's file moves do: a file no recording of this language names is not served as one.
      const serveFile = p.files.serveFile.bind(p.files);
      const named = (x: string) => Object.values((p.client.getState() as LanguageState).recordings).some((r) => r.cards.some((c) => c.hash === x));
      p.files.serveFile = async (f) => (named(f.hash) ? serveFile(f) : { no: 'not-referenced' });
      p.files.reference = {
        held: async (hashes) => hashes.filter((x) => p.files.here.has(x) && s.shelf.has(at(x)) && mine.has(x)),
        lacking: (files) => files.filter((f) => !p.files.here.has(f.hash)),
        serve: async (f) => (p.files.here.has(f.hash) && mine.has(f.hash) ? { uri: at(f.hash), size: s.shelf.get(at(f.hash))!.length } : null)
      };
      // A library file that lands is one this phone knows came from the library.
      const landed = p.files.landed.bind(p.files);
      p.files.landed = async (file, uri, size) => { await landed(file, uri, size); if (file.group === 'reference') mine.add(file.hash); };
    };
    for (const [x, name] of [[audio, 'step audio'], [picture, 'map'], [word, 'word audio']] as const) {
      s.shelf.set(`${s.a.who.deviceId}/${x}`, new TextEncoder().encode(`file ${name}`));
      s.a.p.files.here.add(x);
    }
    withLibraryFiles(s.a.p, origins.inviter);
    withLibraryFiles(s.n.p, origins.newcomer);
    const inviterLibrary = { org: () => s.a.org.getState(), language: () => s.a.p.client.getState() as LanguageState, docs: inviterDocs };
    const target = { ...s.n.target, docs: newcomerDocs };
    const join = {
      i: s.join.i,
      n: {
        ...s.join.n, target,
        exchange: {
          library: true,
          open: async () => ({
            port: s.n.p.client, gate: { people: () => s.n.p.people }, signer: signerFor(s.n.who.crypto, { [s.n.profileId]: s.granted[0]!.chain }), files: s.n.p.files,
            library: { org: () => s.n.org.getState(), language: () => s.n.p.client.getState() as LanguageState, docs: newcomerDocs }
          })
        }
      }
    };
    const [rn, ri] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(s.n.p, 'i', s.pair.a, time, { join: join.n, chain: [] }).run(),
      sessionFor(s.a.p, 'r', s.pair.b, time, { join: join.i, copy: { ...s.copy, docs: inviterDocs }, library: inviterLibrary }).run());
    expect([rn.ended.how, ri.ended.how]).toEqual(['done', 'done']);
    expect(rn.copy).toMatchObject({ whole: true });
    // The documents the language uses, as the inviter's phone holds them.
    expect([...newcomerDocs.held.keys()].sort()).toEqual([...inviterDocs.held.keys()].sort());
    // The files they name, over the same link, each kept as a library file it may pass on.
    for (const x of [audio, picture, word]) expect(s.n.p.files.here.has(x)).toBe(true);
    expect(origins.newcomer).toEqual(new Set([audio, picture, word]));
    expect(rn.libraryFiles).toMatchObject({ got: 3 });
    expect(ri.libraryFiles).toMatchObject({ served: 3 });
  });

  // How the app runs it (nearbyJoin.android.ts `ownLanguage`): after the copy the newcomer opens its language as the app does,
  // but idle, with no server and no workers, on the same store the copy went into, and the session moves each file itself.
  it('the steps after the copy run on the newcomer\'s language opened idle on the copy\'s store, which then holds the work and its files', async () => {
    const s = await setUp({ inviter: { kept: true }, newcomer: { kept: true } });
    const dan = await testPhone(server, make(), await teammate('dan'), s.shelf);
    const carried = await record(dan, s.shelf, 'd1', 'u1');
    const met = memoryNearbyPair({ time, kind: 'wifi-direct', files: s.shelf });
    await settled(time, sessionFor(dan, 'i', met.a, time).run(), sessionFor(s.a.p, 'r', met.b, time).run());
    const unsent = await record(s.a.p, s.shelf, 'unsent', 'u1');
    // The phone's files as a language session keeps them.
    const sizes = new Map<string, number>();
    const listeners = new Set<() => void>();
    const files: LocalFiles = {
      snapshot: () => new Set(sizes.keys()), sizes: () => sizes, sizeOf: (h) => sizes.get(h), formatOf: (h) => (sizes.has(h) ? 'm4a' : undefined),
      reclaim: () => [], onChange: (l) => { listeners.add(l); return () => { listeners.delete(l); }; }
    };
    const fetchFile: NearbyFetchFile = {
      stagingUri: (f) => `own/${f.hash}.${f.format}.nearby.part`, commit: async (f, _uri, size) => { sizes.set(f.hash, size); for (const l of listeners) l(); },
      discard: async () => undefined, uriOf: (f) => (sizes.has(f.hash) ? `own/${f.hash}` : null), freeBytes: () => 1e12, remove: () => []
    };
    let opened: LanguageSession | null = null;
    const n: NearbyJoinNewcomer = {
      ...s.join.n,
      exchange: {
        library: false,
        open: async () => {
          const session = await LanguageSession.open({
            orgId: ORG, languageId: LANG, actorId: s.n.profileId, deviceId: 'd-new', store: s.n.p.store, files, transport: offline(server.transportFor()),
            upload: () => Promise.reject(new OfflineError('none')), download: () => Promise.reject(new OfflineError('none')),
            limits: { minFreeBytes: 0, maxTotalBytes: 1e12 }, keepOnDisk: true, client: { now: () => NOW, nearby: nearbyClient(certified) },
            fetchFile, nearbyFiles: nearbyFiles({ marks: new MemoryNearbyMarks(), installKey: () => s.n.who.key, canReview: () => false }),
            holdChoice: () => ({ hold: true, reviewWindow: 5 })
          });
          opened = session;
          const moves: NearbyFileMoves = { ...session.nearbyMoves()! };
          delete moves.take;
          return {
            port: session.client, keep: nearbyKeepOf(session.client, { orgId: ORG, streamId: LANG }), gate: { people: () => s.n.p.people },
            signer: signerFor(s.n.who.crypto, { [s.n.profileId]: s.granted[0]!.chain }), files: moves
          };
        }
      }
    };
    const [rn, ri] = await run(s.a.p, s.n.p, s.pair, { ...s.join, n }, s.copy);
    expect([rn.ended, ri.ended]).toEqual([{ how: 'done' }, { how: 'done' }]);
    expect(rn.join?.exchange).toBe(true);
    const own = opened as LanguageSession | null;
    expect(own).not.toBeNull();
    expect(Object.keys((own!.client.getState() as LanguageState).recordings)).toEqual(expect.arrayContaining(['by:ana:unsent', 'by:dan:d1']));
    expect([...sizes.keys()].sort()).toEqual([carried, unsent].sort());
    own!.close();
    // What the app opens as the person next reads it all from the store.
    const again = await testPhone(server, s.n.p.store, s.n.who, s.shelf, { keepOnDisk: true, transport: offline(server.transportFor()) });
    expect(keysOf(await whole(again, true))).toEqual(keysOf(await whole(s.a.p, true)));
  });

  it('a newcomer on a build before then names no `join-exchange`: its join ends with the copy, as it always did', async () => {
    const s = await setUp();
    await s.a.p.client.append('v1.NoteAdded', { noteId: 'by:ana:n1', unitId: 'u1', anchor: { kind: 'passage' }, text: 'not sent yet' });
    const [rn, ri] = await run(s.a.p, s.n.p, s.pair, s.join, s.copy);
    expect([rn.ended, ri.ended]).toEqual([{ how: 'done' }, { how: 'done' }]);
    expect([rn.join?.exchange, ri.join?.exchange]).toEqual([false, false]);
    expect(typesOf(s.pair.sent.a.frames)).not.toContain('have');
    // The inviter offers it; the older newcomer never takes it up, so its unsent note stays behind until another session.
    const hello = s.pair.sent.b.frames.map(parseMessage).find((m) => m.kind === 'message' && m.message.t === 'hello');
    expect(hello?.kind === 'message' && hello.message.t === 'hello' && hello.message.can).toContain(JOIN_EXCHANGE_ABILITY);
    expect((s.n.p.client.getState() as LanguageState).notes['by:ana:n1']).toBeUndefined();
  });

  it('a newcomer whose own pieces could not open ends with the copy, and both phones say done', async () => {
    const s = await setUp({ exchange: true });
    const n: NearbyJoinNewcomer = { ...s.join.n, exchange: { library: false, open: async () => null } };
    const [rn, ri] = await run(s.a.p, s.n.p, s.pair, { ...s.join, n }, s.copy);
    expect([rn.ended, ri.ended]).toEqual([{ how: 'done' }, { how: 'done' }]);
    expect(rn.copy).toMatchObject({ whole: true });
    expect([rn.join?.exchange, ri.join?.exchange]).toEqual([false, false]);
    // The newcomer says why, which the field record keeps apart from an older app; the inviter cannot tell.
    expect([rn.join?.exchangeSkip, ri.join?.exchangeSkip]).toEqual(['no-pieces', null]);
    expect(sessionDiagOf(rn, 1, 'join').n).toMatchObject({ exchanged: 0, exchangeNoPieces: 1, copyWhole: 1 });
    expect(sessionDiagOf(rn, 1, 'join').n).not.toHaveProperty('exchangeOlder');
  });

  // The review of 2026-11-24, item 14: `exchanged` 0 beside a whole copy had three causes the record could not tell apart.
  it('a newcomer says why the steps after the copy did not run: its person left, or its pieces came short of what its Hello said', async () => {
    const s = await setUp({ exchange: true });
    const left: NearbyJoinNewcomer = { ...s.join.n, exchange: { library: false, open: async () => 'left' } };
    const [rn] = await run(s.a.p, s.n.p, s.pair, { ...s.join, n: left }, s.copy);
    expect(rn.copy).toMatchObject({ whole: true });
    expect(rn.join).toMatchObject({ exchange: false, exchangeSkip: 'left' });
    expect(sessionDiagOf(rn, 1, 'join').n).toMatchObject({ exchangeLeft: 1 });
    // Library files promised in Hello, and pieces with no library: short of what was said.
    server = new FakeServer();
    const t = await setUp({ exchange: true });
    const short: NearbyJoinNewcomer = {
      ...t.join.n,
      exchange: { library: true, open: async () => ({ port: t.n.p.client, gate: { people: () => t.n.p.people }, signer: signerFor(t.n.who.crypto, { [t.n.profileId]: t.granted[0]!.chain }), files: t.n.p.files }) }
    };
    const [rs] = await run(t.a.p, t.n.p, t.pair, { ...t.join, n: short }, t.copy);
    expect(rs.join).toMatchObject({ exchange: false, exchangeSkip: 'no-pieces' });
  });

  // The review of 2026-11-24, item 2 (T): only an older newcomer was tested. A newcomer that sent `have` to an inviter on an older
  // build, which ignores it, would leave both waiting until the stall, and the inviter's screen would say the link dropped.
  it('an inviter on a build before then names no `join-exchange`: the newcomer ends with the copy, sends no `have`, and says the inviter is older', async () => {
    const s = await setUp({ exchange: true });
    let opened = 0;
    const n: NearbyJoinNewcomer = { ...s.join.n, exchange: { library: false, open: async () => { opened += 1; return s.join.n.exchange!.open(); } } };
    const send = s.pair.b.send.bind(s.pair.b);
    s.pair.b.send = async (bytes) => {
      const p = parseMessage(bytes);
      return send(p.kind === 'message' && p.message.t === 'hello' ? encodeMessage({ ...p.message, can: p.message.can.filter((c) => c !== JOIN_EXCHANGE_ABILITY) }) : bytes);
    };
    const [rn, ri] = await run(s.a.p, s.n.p, s.pair, { ...s.join, n }, s.copy);
    expect([rn.ended, ri.ended]).toEqual([{ how: 'done' }, { how: 'done' }]);
    expect(rn.copy).toMatchObject({ whole: true });
    expect([rn.join?.exchange, ri.join?.exchange]).toEqual([false, false]);
    expect(typesOf(s.pair.sent.a.frames)).not.toContain('have');
    expect(opened).toBe(0);
    expect(rn.join?.exchangeSkip).toBe('older');
    expect(sessionDiagOf(rn, 1, 'join').n).toMatchObject({ exchanged: 0, exchangeOlder: 1 });
  });

  it('an inviter whose newcomer is on a build before then says the newcomer is older', async () => {
    const s = await setUp();
    const [rn, ri] = await run(s.a.p, s.n.p, s.pair, s.join, s.copy);
    expect([rn.ended, ri.ended]).toEqual([{ how: 'done' }, { how: 'done' }]);
    expect(ri.join?.exchangeSkip).toBe('older');
    expect(sessionDiagOf(ri, 1, 'join').n).toMatchObject({ granted: 1, exchanged: 0, exchangeOlder: 1 });
  });

  // The review of 2026-11-24, item 14 (minor): the inviter said `older` at the grant, so a copy that then dropped was recorded as
  // one that ended with the starting copy because the other phone's app is older.
  it('an inviter says an older newcomer is older only once it ends a copy given whole: not when the copy drops, nor when it was short', async () => {
    const s = await setUp();
    const realSend = s.pair.b.send.bind(s.pair.b);
    s.pair.b.send = async (bytes) => {
      const p = parseMessage(bytes);
      if (p.kind === 'message' && p.message.t === 'copy-part') s.pair.drop();
      return realSend(bytes);
    };
    const [rn, ri] = await run(s.a.p, s.n.p, s.pair, s.join, s.copy);
    expect(rn.copy?.whole ?? false).toBe(false);
    expect(ri.ended.how).not.toBe('done');
    expect(ri.join).toMatchObject({ granted: true, exchange: false, exchangeSkip: null });
    expect(ri.join).not.toHaveProperty('copyWhole');
    expect(sessionDiagOf(ri, 1, 'join').n).not.toHaveProperty('exchangeOlder');
    // Given short: the newcomer ends with `bye` `done`, but the copy, not its app, is why nothing followed.
    server = new FakeServer();
    const t = await setUp();
    const [, rt] = await run(t.a.p, t.n.p, t.pair, t.join, { ...t.copy, language: { startingCopy: async () => null } });
    expect(rt.ended).toEqual({ how: 'done' });
    expect(rt.copyServed.stateRefused).toBe('not-filled');
    expect(rt.join?.exchangeSkip).toBeNull();
    expect(sessionDiagOf(rt, 1, 'join').n).not.toHaveProperty('exchangeOlder');
  });

  // The review of 2026-11-24, item 2: setting the person waits on the steps after the copy, so the app marks the record when the
  // copy is whole, before them, and a phone that dies during them sets the person at its next start.
  it('says the copy is whole once, before the steps after it, and not when it is not whole', async () => {
    const s = await setUp({ exchange: true });
    const said: string[] = [];
    const n: NearbyJoinNewcomer = {
      ...s.join.n,
      whole: async () => { said.push(`whole, ${typesOf(s.pair.sent.a.frames).filter((t) => t === 'have').length} have`); },
      exchange: { library: false, open: async () => { said.push('open'); return s.join.n.exchange!.open(); } }
    };
    const [rn] = await run(s.a.p, s.n.p, s.pair, { ...s.join, n }, s.copy);
    expect(rn.join?.exchange).toBe(true);
    expect(said).toEqual(['whole, 0 have', 'open']);
    // Cut at the first part: never whole, never said.
    server = new FakeServer();
    const t = await setUp({ exchange: true });
    const none: string[] = [];
    const realSend = t.pair.b.send.bind(t.pair.b);
    t.pair.b.send = async (bytes) => {
      const p = parseMessage(bytes);
      if (p.kind === 'message' && p.message.t === 'copy-part') t.pair.drop();
      return realSend(bytes);
    };
    const [rt] = await run(t.a.p, t.n.p, t.pair, { ...t.join, n: { ...t.join.n, whole: async () => { none.push('whole'); } } }, t.copy);
    expect(rt.copy?.whole ?? false).toBe(false);
    expect(none).toEqual([]);
  });

  // The review of 2026-11-24, item 3: names and documents follow the passages one round trip each, the longest part of a join. A
  // drop there threw, so the copy was never set, though the person held everything needed to work.
  it('a link that goes during the names, after the passages are filled, leaves the copy whole, said once, and the session dropped', async () => {
    const s = await setUp({ inviter: { kept: true }, newcomer: { kept: true }, exchange: true });
    const said: string[] = [];
    const realSend = s.pair.b.send.bind(s.pair.b);
    s.pair.b.send = async (bytes) => {
      const p = parseMessage(bytes);
      if (p.kind === 'message' && p.message.t === 'copy-part' && p.message.part === 'names') s.pair.drop();
      return realSend(bytes);
    };
    let opened = 0;
    const n: NearbyJoinNewcomer = {
      ...s.join.n, whole: async () => { said.push('whole'); },
      exchange: { library: false, open: async () => { opened += 1; return s.join.n.exchange!.open(); } }
    };
    const [rn, ri] = await run(s.a.p, s.n.p, s.pair, { ...s.join, n }, s.copy);
    expect(['dropped', 'stalled']).toContain(rn.ended.how);
    expect(rn.copy).toMatchObject({ whole: true, docs: { cut: true } });
    expect(said).toEqual(['whole']);
    // The inviter knows the copy was whole, since names come only after it, so its screen says they can work (review of the fixes).
    expect(ri.join).toMatchObject({ granted: true, exchange: false, copyWhole: true });
    expect(sessionDiagOf(rn, 1, 'join').n).toMatchObject({ copyWhole: 1, copyDocsCut: 1 });
    // No steps after the copy on a link that has gone.
    expect(opened).toBe(0);
    expect(await s.n.p.client.holdsCopy()).toBe(true);
    expect(s.n.p.client.fillProgress()).toBeNull();
  });

  // The review of 2026-11-24, item 4: a teammate whose own fill was unfinished answered the rows `copy-no`, which became an
  // `OfflineError` and ended the whole session as dropped, events and files with it.
  it('a teammate that cannot give a passage\'s rows refuses the copy, and the session goes on to its end', async () => {
    const s = await setUp({ inviter: { kept: true }, newcomer: { kept: true } });
    // The join drops at the first rows part: the newcomer holds the copy's state, its passages still to fill.
    const realSend = s.pair.b.send.bind(s.pair.b);
    s.pair.b.send = async (bytes) => {
      const p = parseMessage(bytes);
      if (p.kind === 'message' && p.message.t === 'copy-part' && p.message.part === 'rows') s.pair.drop();
      return realSend(bytes);
    };
    await run(s.a.p, s.n.p, s.pair, s.join, s.copy);
    expect(await s.n.p.client.holdsCopy()).toBe(true);
    expect(s.n.p.client.fillProgress()).not.toBeNull();
    const holder: Teammate = { ...s.n.who, chain: s.granted[0]!.chain };
    const again = memoryNearbyPair({ time, kind: 'wifi-direct' });
    const stillFilling: NearbyCopySource = { ...s.copy, language: { startingCopy: () => s.a.p.client.startingCopy(), startingCopyRowsAt: async () => null } };
    const [rn2, ri2] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(s.n.p, 'i', again.a, time, { chain: holder.chain, signer: { publicKey: holder.key, sign: holder.crypto.sign, sha256: fakeSha256, chainFor: () => holder.chain }, takeCopy: s.n.target }).run(),
      sessionFor(s.a.p, 'r', again.b, time, { copy: stillFilling }).run());
    expect(rn2.copyRefused).toBe('not-filled');
    expect([rn2.ended, ri2.ended]).toEqual([{ how: 'done' }, { how: 'done' }]);
  });

  // The review of 2026-11-24, items 6 and 26: a room passes a target whenever its person's copy may be short or lost; once it is
  // whole, a teammate is asked for nothing, not even names.
  it('a target that says no copy is wanted asks nothing of a teammate', async () => {
    const s = await setUp();
    await run(s.a.p, s.n.p, s.pair, s.join, s.copy);
    const holder: Teammate = { ...s.n.who, chain: s.granted[0]!.chain };
    const again = memoryNearbyPair({ time, kind: 'wifi-direct' });
    const [rn2] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(s.n.p, 'i', again.a, time, { chain: holder.chain, signer: { publicKey: holder.key, sign: holder.crypto.sign, sha256: fakeSha256, chainFor: () => holder.chain }, takeCopy: { ...s.n.target, wanted: async () => false } }).run(),
      sessionFor(s.a.p, 'r', again.b, time, { copy: s.copy }).run());
    expect(rn2.ended).toEqual({ how: 'done' });
    expect(rn2.copy).toBeNull();
    expect(typesOf(again.sent.a.frames)).not.toContain('copy-ask');
  });

  // The review of 2026-11-24, item 7: a pass lets in `maxUses` people and only this phone uses it, but nothing counted. Newcomers
  // past that were let in, then cut by teammates, differently on each phone, and refused by the server at first contact.
  it('an inviter lets in at most the pass\'s count, counts each person once, and says so before any tap', async () => {
    const s = await setUp();
    const one = await worker.signPass({ ...s.a.pass.body, maxUses: 1 });
    const join = { ...s.join, i: { ...s.join.i, pass: one } };
    const [rn, ri] = await run(s.a.p, s.n.p, s.pair, join, s.copy);
    expect([rn.join?.granted, ri.join?.granted]).toEqual([true, true]);
    expect(await s.a.p.keep.letIn(one.body.passId)).toEqual([s.n.profileId]);
    // The same person again, on a link that dropped say: still the one use.
    const same = memoryNearbyPair({ time, kind: 'wifi-direct', files: s.shelf });
    const [rs] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(s.n.p, 'i', same.a, time, { join: s.join.n, chain: [] }).run(),
      sessionFor(s.a.p, 'r', same.b, time, { join: join.i, copy: s.copy }).run());
    expect(rs.join?.granted).toBe(true);
    // Someone else: refused before the tap, and not as a failed check.
    const tapsBefore = s.tapped.length;
    const other = await newcomerPhone();
    const otherId = (await newcomerProfileId(other.who.key, base64urlEncode(new Uint8Array(16).fill(6)), fakeSha256))!;
    const third = memoryNearbyPair({ time, kind: 'wifi-direct' });
    const [ro, rio] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(other.p, 'i', third.a, time, { join: { ...s.join.n, idSalt: base64urlEncode(new Uint8Array(16).fill(6)), profileId: otherId }, chain: [] }).run(),
      sessionFor(s.a.p, 'r', third.b, time, { join: join.i, copy: s.copy }).run());
    expect(ro.join?.granted).toBe(false);
    expect(rio.join?.refused).toBe(NEARBY_PASS_USED_UP);
    expect(rio.ended).toMatchObject({ how: 'said', reason: 'stopped' });
    expect(ro.ended).toMatchObject({ how: 'heard', reason: 'stopped' });
    expect(s.tapped.length).toBe(tapsBefore);
    expect(typesOf(third.sent.b.frames)).not.toContain('join-grant');
    expect(await s.a.p.keep.letIn(one.body.passId)).toEqual([s.n.profileId]);
  });

  // The review of 2026-11-24, item 2: after the last part the inviter waits for the newcomer's `have`, while the newcomer keeps its
  // documents and opens its own language, which the link does not show. On a slow phone with a large language that took past the
  // inviter's minute, the inviter ended stalled, the newest work did not follow, and its screen said the link dropped.
  it('the inviter waits past its minute while the newcomer opens its own language after the copy, and the newest work follows', async () => {
    const s = await setUp({ exchange: true });
    await s.a.p.client.append('v1.NoteAdded', { noteId: 'by:ana:n1', unitId: 'u1', anchor: { kind: 'passage' }, text: 'not sent yet' });
    const n: NearbyJoinNewcomer = {
      ...s.join.n,
      exchange: { library: false, open: async () => { await time.sleep(3 * 60_000); return s.join.n.exchange!.open(); } }
    };
    const [rn, ri] = await run(s.a.p, s.n.p, s.pair, { ...s.join, n }, s.copy);
    expect([rn.ended, ri.ended]).toEqual([{ how: 'done' }, { how: 'done' }]);
    expect([rn.join?.exchange, ri.join?.exchange]).toEqual([true, true]);
    expect((s.n.p.client.getState() as LanguageState).notes['by:ana:n1']).toBeDefined();
  });

  it('a newcomer silent before its copy\'s state is all given still stalls the inviter at its minute', async () => {
    const s = await setUp({ exchange: true });
    // The newcomer goes quiet between the organization's state and the language's, for longer than a file's time, though its own
    // clock would wait: only the inviter's minute ends it.
    const realSend = s.pair.a.send.bind(s.pair.a);
    let asked = 0;
    s.pair.a.send = async (bytes) => {
      const p = parseMessage(bytes);
      if (p.kind === 'message' && p.message.t === 'copy-ask' && ++asked === 2) await time.sleep(15 * 60_000);
      return realSend(bytes);
    };
    const [, ri] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(s.n.p, 'i', s.pair.a, time, { join: s.join.n, chain: [], tunables: { openCloseMinMs: 3_000, openCloseMaxMs: 3_000, stallMs: 60 * 60_000 } }).run(),
      sessionFor(s.a.p, 'r', s.pair.b, time, { join: s.join.i, copy: s.copy }).run());
    expect(ri.ended).toEqual({ how: 'stalled' });
    expect(ri.join?.granted).toBe(true);
  });

  // The review of 2026-11-24, item 8: the quiet mode takes a teammate whose certificate is under 14 days old or who was met on
  // Share nearby, and the newcomer's chain starts with the inviter's certificate. The two refused each other until they opened
  // Share nearby together, which defeated passing `nearby_open` in the grant.
  it('the join is a meeting on both phones, so the quiet mode takes the two at once though the inviter\'s certificate is older than its window', async () => {
    const later = () => NOW + 20 * DAY;
    for (const noted of [true, false]) {
      server = new FakeServer();
      const s = await setUp({ inviter: { now: later }, newcomer: { now: later }, ...(noted ? { notesMetForMs: 14 * DAY } : {}) });
      const [rn] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
        sessionFor(s.n.p, 'i', s.pair.a, time, { join: s.join.n, chain: [] }).run(),
        sessionFor(s.a.p, 'r', s.pair.b, time, { join: s.join.i, copy: s.copy, ...(noted ? { notesMetForMs: 14 * DAY } : {}) }).run());
      expect(rn.join?.granted).toBe(true);
      // Noted before the copy, which still comes whole.
      expect(rn.copy).toMatchObject({ whole: true });
      const day = nearbyDayOf(s.a.p.client.nearbyHelloNow);
      expect(await s.a.p.keep.met(0)).toEqual(noted ? [{ key: s.n.who.key, profileId: s.n.profileId, day }] : []);
      expect(await s.n.p.keep.met(0)).toEqual(noted ? [{ key: s.a.who.key, profileId: 'ana', day }] : []);
      // Both know the other's key, as a Hello leaves it, so each can find the other while LangQuest is open.
      expect(JSON.parse((await s.n.p.client.nearbyMeta(`nearbyNames:${ORG}`))!)).toContainEqual([s.a.who.key, 'ana']);
      expect(JSON.parse((await s.a.p.client.nearbyMeta(`nearbyNames:${ORG}`))!)).toContainEqual([s.n.who.key, s.n.profileId]);
      const holder = { ...s.n.p, who: { ...s.n.who, chain: s.granted[0]!.chain } };
      const quiet = memoryNearbyPair({ time, kind: 'wifi-direct' });
      const [qn, qi] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
        sessionFor(holder, 'i', quiet.a, time, { freshWithinMs: 14 * DAY }).run(),
        sessionFor(s.a.p, 'r', quiet.b, time, { freshWithinMs: 14 * DAY }).run());
      if (noted) expect([qn.ended, qi.ended]).toEqual([{ how: 'done' }, { how: 'done' }]);
      else expect([qn.ended, qi.ended]).toContainEqual({ how: 'said', reason: 'identity', detail: 'certificate not recent' });
    }
  });

  // The review of 2026-11-24, item 11: the list moved only after Have in an ordinary session, so until the newcomer met an
  // honest teammate it took a stolen phone still signed in for a teammate, and gave it the team's newest work.
  it('the grant carries the inviter\'s revocation list, kept before the copy, so the newcomer turns a listed phone away from the start', async () => {
    const stolen = await teammate('stolen');
    const list = await signedList({ v: 1, kid: 'k1', orgId: ORG, seq: 4, keys: [[stolen.key, 'stolen', NOW]] });
    const s = await setUp();
    await s.a.p.keep.saveRevoked(list);
    // Cut at the first part of the copy: the list is kept by then.
    const realSend = s.pair.b.send.bind(s.pair.b);
    s.pair.b.send = async (bytes) => {
      const p = parseMessage(bytes);
      if (p.kind === 'message' && p.message.t === 'copy-part') s.pair.drop();
      return realSend(bytes);
    };
    const [rn] = await run(s.a.p, s.n.p, s.pair, s.join, s.copy);
    expect(rn.join?.granted).toBe(true);
    expect(await s.n.p.client.holdsCopy()).toBe(false);
    expect(s.granted[0]!.revoked).toEqual(list);
    expect(rn.revokedTaken).toBe(4);
    expect((await s.n.p.keep.revoked())?.list.seq).toBe(4);
    // The newcomer, holding its chain, meets the stolen phone: it refuses it at Hello.
    const holder = { ...s.n.p, who: { ...s.n.who, chain: s.granted[0]!.chain } };
    const thief = await testPhone(server, make(), stolen, new Map());
    const pair = memoryNearbyPair({ time, kind: 'wifi-direct' });
    const [rh] = await settled<[NearbySessionReport, NearbySessionReport]>(time, sessionFor(holder, 'i', pair.a, time).run(), sessionFor(thief, 'r', pair.b, time).run());
    expect(rh.ended).toEqual({ how: 'said', reason: 'identity', detail: 'key revoked' });
  });

  // The review of 2026-11-24, items 8 and 11: `granted` may answer only a target. The session then went on writing to the keep
  // the newcomer started with, `joinOnlyKeep`, which refuses: an inviter holding a list, or a meeting to note, failed the join.
  it('a newcomer on a join\'s own keep whose grant answers no keep goes on: the list is held for the session, and no meeting is noted', async () => {
    const stolen = await teammate('stolen');
    const list = await signedList({ v: 1, kid: 'k1', orgId: ORG, seq: 6, keys: [[stolen.key, 'stolen', NOW]] });
    for (const notes of [false, true]) {
      server = new FakeServer();
      const s = await setUp();
      await s.a.p.keep.saveRevoked(list);
      const n: NearbyJoinNewcomer = {
        as: 'newcomer', idSalt: SALT, profileId: s.n.profileId, name: 'Nyibol',
        granted: async () => ({ target: s.n.target, ...(notes ? { notesMetForMs: 14 * DAY } : {}) })
      };
      const [rn, ri] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
        sessionFor(s.n.p, 'i', s.pair.a, time, { join: n, chain: [], orgId: '', languageId: '', port: joinOnlyPort(() => NOW), keep: joinOnlyKeep() }).run(),
        sessionFor(s.a.p, 'r', s.pair.b, time, { join: s.join.i, copy: s.copy }).run());
      expect([rn.ended, ri.ended], `notes ${notes}`).toEqual([{ how: 'done' }, { how: 'done' }]);
      expect(rn.copy).toMatchObject({ whole: true });
      // Checked against the Worker's keys and taken for this session, though kept nowhere.
      expect(rn.revokedTaken).toBe(6);
      expect(await s.n.p.keep.revoked()).toBeNull();
      expect(await s.n.p.keep.met(0)).toEqual([]);
    }
  });

  it('a newcomer on a join\'s own keep still turns away an inviter its grant\'s list names', async () => {
    const s = await setUp();
    const list = await signedList({ v: 1, kid: 'k1', orgId: ORG, seq: 5, keys: [[s.a.who.key, 'ana', NOW]] });
    const realSend = s.pair.b.send.bind(s.pair.b);
    s.pair.b.send = async (bytes) => {
      const p = parseMessage(bytes);
      return realSend(p.kind === 'message' && p.message.t === 'join-grant' ? encodeMessage({ ...p.message, revoked: list }) : bytes);
    };
    const n: NearbyJoinNewcomer = { as: 'newcomer', idSalt: SALT, profileId: s.n.profileId, name: 'Nyibol', granted: async () => ({ target: s.n.target }) };
    const [rn] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(s.n.p, 'i', s.pair.a, time, { join: n, chain: [], orgId: '', languageId: '', port: joinOnlyPort(() => NOW), keep: joinOnlyKeep() }).run(),
      sessionFor(s.a.p, 'r', s.pair.b, time, { join: s.join.i, copy: s.copy }).run());
    expect(rn.join).toMatchObject({ granted: false, refused: 'key revoked' });
  });

  it('a newcomer whose own pieces and grant answer no keep of the person\'s does not run the steps after the copy on a join\'s keep', async () => {
    const s = await setUp();
    const n: NearbyJoinNewcomer = {
      as: 'newcomer', idSalt: SALT, profileId: s.n.profileId, name: 'Nyibol', granted: async () => ({ target: s.n.target }),
      exchange: { library: false, open: async () => ({ port: s.n.p.client, gate: { people: () => s.n.p.people }, signer: signerFor(s.n.who.crypto, { [s.n.profileId]: s.granted[0]?.chain ?? [] }), files: s.n.p.files }) }
    };
    const [rn, ri] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(s.n.p, 'i', s.pair.a, time, { join: n, chain: [], orgId: '', languageId: '', port: joinOnlyPort(() => NOW), keep: joinOnlyKeep() }).run(),
      sessionFor(s.a.p, 'r', s.pair.b, time, { join: s.join.i, copy: s.copy }).run());
    expect([rn.ended, ri.ended]).toEqual([{ how: 'done' }, { how: 'done' }]);
    expect(rn.join).toMatchObject({ exchange: false, exchangeSkip: 'no-pieces' });
  });

  it('a list in the grant the Worker did not sign is dropped and counted, and the join goes on', async () => {
    const list = await signedList({ v: 1, kid: 'k1', orgId: ORG, seq: 4, keys: [] });
    const s = await setUp();
    await s.a.p.keep.saveRevoked({ ...list, sig: await fakeSigner('not-the-worker').sign(nearbyBytes('revoked', list.text)) });
    const [rn, ri] = await run(s.a.p, s.n.p, s.pair, s.join, s.copy);
    expect([rn.ended, ri.ended]).toEqual([{ how: 'done' }, { how: 'done' }]);
    expect(s.granted[0]!.revoked).toBeNull();
    expect(rn.revokedDropped).toBe(1);
    expect(await s.n.p.keep.revoked()).toBeNull();
  });

  it('a revocation list too long to ride in one message with the chain leaves it out of the grant, and the join goes on', async () => {
    const s = await setUp();
    // The longest list a `revoked` message carries alone: with the chain beside it, a grant would not fit.
    const entry: [string, string, number] = [s.a.who.key.replace(/^./, 'B'), 'x', 0];
    const fits = (n: number) => encodeMessage({ t: 'revoked', text: revocationText({ v: 1, kid: 'k1', orgId: ORG, seq: 7, keys: Array<typeof entry>(n).fill(entry) }), kid: 'k1', sig: 'A'.repeat(86) }).length <= NEARBY_MESSAGE_MAX;
    const fitting = (n: number) => { try { return fits(n); } catch { return false; } };
    let lo = 1;
    let hi = 40_000;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (fitting(mid)) lo = mid; else hi = mid - 1; }
    await s.a.p.keep.saveRevoked(await signedList({ v: 1, kid: 'k1', orgId: ORG, seq: 7, keys: Array<typeof entry>(lo).fill(entry) }));
    const [rn, ri] = await run(s.a.p, s.n.p, s.pair, s.join, s.copy);
    expect([rn.ended, ri.ended]).toEqual([{ how: 'done' }, { how: 'done' }]);
    expect(rn.join?.granted).toBe(true);
    expect(s.granted[0]!.revoked).toBeNull();
  });

  it('an inviter that holds a revoked key\'s list grants nobody the key revoked: the newcomer checks the grant\'s chain against it', async () => {
    const s = await setUp();
    const list = await signedList({ v: 1, kid: 'k1', orgId: ORG, seq: 5, keys: [[s.a.who.key, 'ana', NOW]] });
    // As a forged inviter would: send the grant with a list naming its own key, and sign the link anyway.
    const realSend = s.pair.b.send.bind(s.pair.b);
    s.pair.b.send = async (bytes) => {
      const p = parseMessage(bytes);
      return realSend(p.kind === 'message' && p.message.t === 'join-grant' ? encodeMessage({ ...p.message, revoked: list }) : bytes);
    };
    const [rn] = await run(s.a.p, s.n.p, s.pair, s.join, s.copy);
    expect(rn.join?.granted).toBe(false);
    expect(rn.join?.refused).toBe('key revoked');
    expect(s.granted).toEqual([]);
  });
});

async function signedList(list: RevocationList) {
  const text = revocationText(list);
  return { text, kid: list.kid, sig: await fakeSigner('worker:k1').sign(nearbyBytes('revoked', text)) };
}

describe('a sender\'s answers and a newcomer\'s keep', () => {
  const h = (doc: unknown) => bytesToHex(fakeSha256(utf8Encode(canonicalJson(doc))));
  const versification = { format: 'versification@1', name: 'English', books: [] } as unknown as LibraryDoc;
  const tpl = { format: 'template@2', name: 'Tpl', deps: [], books: [], levels: [] } as unknown as LibraryDoc;
  const fia = { format: 'material@1', kind: 'key_terms', title: 'FIA', source: 'fia.bible', pattern: 'FIA', deps: [] } as unknown as LibraryDoc;
  const docs = new Map<string, LibraryDoc>([[h(tpl), tpl], [h(fia), fia], [h(versification), versification]]);
  const port: NearbyDocs = { head: async (x: string) => { const d = docs.get(x); return d ? docHeadOf(d) : null; }, text: async (x) => (docs.has(x) ? canonicalJson(docs.get(x)) : null), keep: async () => true };
  const lang = (): LanguageState => ({ template: { value: { itemId: 'tpl', docHash: h(tpl), unitPrefix: 'tpl' }, hlc: '', eventId: '' }, templateHistory: {}, flow: null, passageLinks: {}, languageReferences: {}, checkHelps: { peer: { 'item:fia': { value: true, hlc: '', eventId: '' } } } } as unknown as LanguageState);
  const orgState = { library: { fia: { kind: { value: 'material', hlc: 'x', eventId: 'e' }, name: { value: 'FIA', hlc: 'x', eventId: 'e' }, description: { value: '', hlc: 'x', eventId: 'e' }, copiedFrom: { value: null, hlc: '', eventId: '' }, versions: { [h(fia)]: { docHash: h(fia), hlc: 'x', eventId: 'e', actorId: 'a' } }, sharing: { value: { shared: false, subscribable: false }, hlc: '', eventId: '' }, archived: { value: false, hlc: '', eventId: '' }, subscription: { value: null, hlc: '', eventId: '' }, pinned: { value: null, hlc: '', eventId: '' } } }, recommendations: {}, members: { ana: {} }, roles: {}, languages: {} } as unknown as OrgState;
  const sender = () => new StartingCopySender({
    language: { startingCopy: async () => ({ serverSeq: 5, state: lang() }) },
    org: { startingCopy: async () => ({ serverSeq: 3, state: orgState }) },
    docs: port
  }, LANG);

  // Carl, 2026-11-24: FIA's key words, which the language uses on a check, go as the template does.
  it('serves a document on the list in parts, FIA\'s key words among them, and refuses one off the list', async () => {
    const s = sender();
    expect(await s.answer({ t: 'copy-ask', part: 'doc', hash: h(tpl) })).toMatchObject({ part: 'doc', body: canonicalJson(tpl), next: null });
    expect(await s.answer({ t: 'copy-ask', part: 'doc', hash: h(fia) })).toMatchObject({ part: 'doc', body: canonicalJson(fia), next: null });
    expect(await s.answer({ t: 'copy-ask', part: 'doc', hash: h(versification) })).toBe('not-allowed');
    expect(await s.answer({ t: 'copy-ask', part: 'doc', hash: 'f'.repeat(64) })).toBe('not-allowed');
    expect(await s.answer({ t: 'copy-ask', part: 'state', stream: 'p2' })).toBe('not-allowed');
    expect(await s.answer({ t: 'copy-ask', part: 'state', stream: LANG, after: 'x' })).toBe('not-allowed');
  });

  it('answers not-here for a document on the list it lacks', async () => {
    const missing = { format: 'flow@1', name: 'F', steps: [], deps: [] } as unknown as LibraryDoc;
    const s = new StartingCopySender({
      language: { startingCopy: async () => ({ serverSeq: 5, state: { ...lang(), flow: { value: { flowId: 'f', docHash: h(missing) }, hlc: '', eventId: '' } } }) },
      org: { startingCopy: async () => ({ serverSeq: 3, state: orgState }) }, docs: port
    }, LANG);
    expect(await s.answer({ t: 'copy-ask', part: 'doc', hash: h(missing) })).toBe('not-here');
  });

  it('a long text goes in parts, each within a message, and joins back whole', async () => {
    const big = 'é"'.repeat(700_000);
    const s = new StartingCopySender({ language: { startingCopy: async () => ({ serverSeq: 1, state: { big } }) } }, LANG);
    let after: string | undefined;
    const parts: string[] = [];
    for (;;) {
      const got = await s.answer({ t: 'copy-ask', part: 'state', stream: LANG, ...(after ? { after } : {}) });
      if (typeof got === 'string') throw new Error(got);
      expect(utf8Encode(JSON.stringify(got.body)).length).toBeLessThanOrEqual(900 * 1024);
      parts.push(got.body);
      if (got.next === null) break;
      after = got.next;
    }
    expect(parts.length).toBeGreaterThan(1);
    expect(JSON.parse(parts.join(''))).toEqual({ serverSeq: 1, state: { big } });
  });

  it('a newcomer keeps a text only if it hashes to its name, is canonical and validates, a team\'s guide and FIA\'s key words among them', async () => {
    const good = { format: 'versification@1', code: 'eng', name: 'English', maxVerses: { GEN: [31] }, mappedVerses: {} };
    const text = canonicalJson(good);
    const hash = bytesToHex(fakeSha256(utf8Encode(text)));
    expect(await admitDoc(hash, text, fakeSha256)).toMatchObject({ format: 'versification@1' });
    expect(await admitDoc('0'.repeat(64), text, fakeSha256)).toBeNull();
    // With the phone's own native hash (review P6), which may answer in capitals, the same holds.
    const native = async (t: string) => bytesToHex(fakeSha256(utf8Encode(t))).toUpperCase();
    expect(await admitDoc(hash, text, fakeSha256, native)).toMatchObject({ format: 'versification@1' });
    expect(await admitDoc('0'.repeat(64), text, fakeSha256, native)).toBeNull();
    const spaced = JSON.stringify(good, null, 1);
    expect(await admitDoc(bytesToHex(fakeSha256(utf8Encode(spaced))), spaced, fakeSha256)).toBeNull();
    // A team's own guide and FIA's key words, whole and valid, are kept since Carl confirmed the terms (2026-11-24).
    const guide = { format: 'study@2', title: 'Clean water', links: [{ template: 'health', node: 'water' }], steps: [{ id: 's1', title: 'Listen', text: 'Water is fetched at dawn.' }], resources: [], terms: [], deps: [] };
    expect(validateDoc(guide)).toBeNull();
    const study = canonicalJson(guide);
    expect(await admitDoc(bytesToHex(fakeSha256(utf8Encode(study))), study, fakeSha256)).toMatchObject({ format: 'study@2' });
    const fiaText = canonicalJson(fia);
    expect(validateDoc(fia)).toBeNull();
    expect(await admitDoc(bytesToHex(fakeSha256(utf8Encode(fiaText))), fiaText, fakeSha256)).toMatchObject({ format: (fia as { format: string }).format });
    // A format this build does not know stays out, however it hashes: no forgery, but unreadable here (review item 28).
    const later = canonicalJson({ format: 'study@9', title: 'Later', deps: [] });
    expect(await admitDoc(bytesToHex(fakeSha256(utf8Encode(later))), later, fakeSha256)).toBe('unreadable');
    // A wrong hash, or a text not in canonical form, is a forgery whatever its format.
    expect(await admitDoc('0'.repeat(64), later, fakeSha256)).toBeNull();
    const laterSpaced = JSON.stringify(JSON.parse(later), null, 1);
    expect(await admitDoc(bytesToHex(fakeSha256(utf8Encode(laterSpaced))), laterSpaced, fakeSha256)).toBeNull();
    expect(await admitDoc(hash, 'not json', fakeSha256)).toBeNull();
  });
});
