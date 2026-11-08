import { canonicalJson, HlcClock, ORG_STREAM, type LanguageState, type LibraryDoc, type OrgState } from '@langquest-next/core';
import {
  base64urlEncode, bytesToHex, checkChain, joinPassBody, newcomerProfileId, utf8Encode, type ChainLink, type JoinPass, type WorkerLink
} from '@langquest-next/core/nearby';
import { admitDoc, StartingCopySender, type NearbyCopySource, type NearbyDocs, type StartingCopyTarget } from '../src/nearbyCopy';
import type { NearbyJoinInviter, NearbyJoinNewcomer, NearbySessionReport } from '../src/nearbySession';
import { encodeMessage, parseMessage } from '../src/nearbyWire';
import { ORG_MATERIALIZER } from '../src/orgSession';
import { SyncClient } from '../src/syncClient';
import { FakeServer } from '../src/testing/fakeServer';
import { fakeSha256, fakeSigner, memoryNearbyPair, type MemoryNearbyPair } from '../src/testing/memoryNearbyLink';
import { OfflineError, type EventStore, type Transport } from '../src/types';
import { LANG, NOW, ORG, STORES, worker, type Teammate } from './nearbyFixtures';
import { newTime, sessionFor, settled, testPhone, type TestPhone } from './nearbyKit';

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
  async function inviterPhone(o: { scopes?: WorkerLink['body']['org']['scopes']; orgId?: string } = {}) {
    const crypto = fakeSigner('d-ana');
    const chain = await worker.certify({ installKey: crypto.publicKey, profileId: 'ana', deviceId: 'd-ana' }, {
      orgId: o.orgId ?? ORG, scopes: o.scopes ?? [{ level: 'language', languageId: LANG, privileges: ['invite_members', 'translate', 'view_status'] }]
    });
    const who: Teammate = { profileId: 'ana', deviceId: 'd-ana', crypto, key: crypto.publicKey, chain };
    const p = await testPhone(server, make(), who, new Map());
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
  async function newcomerPhone() {
    const crypto = fakeSigner('d-new');
    const profileId = (await newcomerProfileId(crypto.publicKey, SALT, fakeSha256))!;
    const who: Teammate = { profileId, deviceId: 'd-new', crypto, key: crypto.publicKey, chain: [] };
    const p = await testPhone(server, make(), who, new Map(), { transport: offline(server.transportFor()) });
    const org = new SyncClient<OrgState>({
      materializer: ORG_MATERIALIZER, orgId: ORG, streamId: ORG_STREAM, actorId: profileId, deviceId: 'd-new', store: make(), transport: offline(server.transportFor()),
      clock: new HlcClock('d-new-org', () => NOW + ++ids), newId: () => `n-${++ids}`
    });
    await org.load();
    const names: Record<string, string>[] = [];
    const target: Omit<StartingCopyTarget, 'sha256'> = {
      languageId: LANG,
      language: { holdsCopy: () => p.client.holdsCopy(), adoptStartingCopy: (c) => p.client.adoptStartingCopy(c), keptOnDisk: false, state: () => p.client.getState() },
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

  async function setUp(o: { tap?: string | null; stop?: string | null; pass?: (p: JoinPass) => JoinPass; inviter?: Parameters<typeof inviterPhone>[0] } = {}) {
    const a = await inviterPhone(o.inviter);
    const n = await newcomerPhone();
    const granted: { chain: ChainLink[]; discovery: { key: string; gen: number; floor: number } }[] = [];
    const shown: [number, number][] = [];
    const tapped: { name: string; profileId: string; pictures: [number, number] }[] = [];
    const join = {
      i: {
        as: 'inviter', pass: o.pass ? o.pass(a.pass) : a.pass, discovery: { key: base64urlEncode(new Uint8Array(32).fill(9)), gen: 4, floor: 2 },
        tap: async (who) => { tapped.push(who); return o.tap === undefined ? 'translator' : o.tap; },
        ...(o.stop !== undefined ? { stop: () => o.stop! } : {})
      } satisfies NearbyJoinInviter,
      n: {
        as: 'newcomer', idSalt: SALT, profileId: n.profileId, name: 'Nyibol', pictures: (p) => shown.push(p),
        granted: async (g) => { granted.push({ chain: g.chain, discovery: g.discovery }); }, target: n.target
      } satisfies NearbyJoinNewcomer
    };
    const copy: NearbyCopySource = { language: a.p.client, org: a.org, names: async () => ({ ana: 'Ana', elsewhere: 'Someone else\'s', asker: 'A join request' }) };
    const pair = memoryNearbyPair({ time, kind: 'wifi-direct' });
    return { a, n, join, copy, pair, granted, shown, tapped };
  }

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
  });
});

describe('a sender\'s answers and a newcomer\'s keep', () => {
  const h = (doc: unknown) => bytesToHex(fakeSha256(utf8Encode(canonicalJson(doc))));
  const versification = { format: 'versification@1', name: 'English', books: [] } as unknown as LibraryDoc;
  const tpl = { format: 'template@2', name: 'Tpl', deps: [], books: [], levels: [] } as unknown as LibraryDoc;
  const fia = { format: 'material@1', kind: 'key_terms', title: 'FIA', source: 'fia.bible', pattern: 'FIA', deps: [] } as unknown as LibraryDoc;
  const docs = new Map<string, LibraryDoc>([[h(tpl), tpl], [h(fia), fia], [h(versification), versification]]);
  const port: NearbyDocs = { read: async (x) => docs.get(x) ?? null, text: async (x) => (docs.has(x) ? canonicalJson(docs.get(x)) : null), keep: async () => true };
  const lang = (): LanguageState => ({ template: { value: { itemId: 'tpl', docHash: h(tpl), unitPrefix: 'tpl' }, hlc: '', eventId: '' }, templateHistory: {}, flow: null, passageLinks: {}, languageReferences: {}, checkHelps: { peer: { 'item:fia': { value: true, hlc: '', eventId: '' } } } } as unknown as LanguageState);
  const orgState = { library: { fia: { kind: { value: 'material', hlc: 'x', eventId: 'e' }, name: { value: 'FIA', hlc: 'x', eventId: 'e' }, description: { value: '', hlc: 'x', eventId: 'e' }, copiedFrom: { value: null, hlc: '', eventId: '' }, versions: { [h(fia)]: { docHash: h(fia), hlc: 'x', eventId: 'e', actorId: 'a' } }, sharing: { value: { shared: false, subscribable: false }, hlc: '', eventId: '' }, archived: { value: false, hlc: '', eventId: '' }, subscription: { value: null, hlc: '', eventId: '' }, pinned: { value: null, hlc: '', eventId: '' } } }, recommendations: {}, members: { ana: {} }, roles: {}, languages: {} } as unknown as OrgState;
  const sender = () => new StartingCopySender({
    language: { startingCopy: async () => ({ serverSeq: 5, state: lang() }) },
    org: { startingCopy: async () => ({ serverSeq: 3, state: orgState }) },
    docs: port
  }, LANG);

  it('serves a document on the list in parts, refuses one off the list, and one the allowlist refuses', async () => {
    const s = sender();
    expect(await s.answer({ t: 'copy-ask', part: 'doc', hash: h(tpl) })).toMatchObject({ part: 'doc', body: canonicalJson(tpl), next: null });
    expect(await s.answer({ t: 'copy-ask', part: 'doc', hash: h(fia) })).toBe('not-allowed');
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

  it('a newcomer keeps a text only if it hashes to its name, is canonical, validates and the allowlist takes it', async () => {
    const good = { format: 'versification@1', code: 'eng', name: 'English', maxVerses: { GEN: [31] }, mappedVerses: {} };
    const text = canonicalJson(good);
    const hash = bytesToHex(fakeSha256(utf8Encode(text)));
    expect(await admitDoc(hash, text, fakeSha256)).not.toBeNull();
    expect(await admitDoc('0'.repeat(64), text, fakeSha256)).toBeNull();
    const spaced = JSON.stringify(good, null, 1);
    expect(await admitDoc(bytesToHex(fakeSha256(utf8Encode(spaced))), spaced, fakeSha256)).toBeNull();
    const study = canonicalJson({ format: 'study@2', title: 'x', deps: [] });
    expect(await admitDoc(bytesToHex(fakeSha256(utf8Encode(study))), study, fakeSha256)).toBeNull();
    const fiaText = canonicalJson(fia);
    expect(await admitDoc(bytesToHex(fakeSha256(utf8Encode(fiaText))), fiaText, fakeSha256)).toBeNull();
    expect(await admitDoc(hash, 'not json', fakeSha256)).toBeNull();
  });
});
