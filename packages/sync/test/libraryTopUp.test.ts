import { canonicalJson, docHeadOf, type LanguageState, type LibraryDoc, type OrgState } from '@langquest-next/core';
import { bytesToHex, utf8Encode } from '@langquest-next/core/nearby';
import {
  COPY_HELD_MAX_CHARS, LibraryDocsSender, StartingCopySender, takeLibraryDocs, type CopyAsker, type NearbyDocs, type NearbyLibrary
} from '../src/nearbyCopy';
import { COPY_LIBRARY_ABILITY, type NearbySessionReport } from '../src/nearbySession';
import { parseMessage, type Message } from '../src/nearbyWire';
import { FakeServer } from '../src/testing/fakeServer';
import { fakeSha256, memoryNearbyPair, type MemoryFiles } from '../src/testing/memoryNearbyLink';
import { LANG, STORES, teammate, type Teammate } from './nearbyFixtures';
import { newTime, sessionFor, settled, testPhone } from './nearbyKit';

/**
 * The library documents a language uses, between any two teammates (docs/nearby-sync-plan.md 14.1,
 * 2026-11-24). Why: Carl's phone that joined offline showed no FIA steps, and a copy that came
 * short, or a guide a teammate fetched online, must still reach a phone. A teammate says which it
 * holds (`held`), so nothing is asked one hash at a time in vain; what the language names comes
 * first; the Bluetooth pipe takes only a share a session; and nothing is asked of a phone that
 * cannot answer, or when nothing is lacking.
 */

const h = (doc: unknown) => bytesToHex(fakeSha256(utf8Encode(canonicalJson(doc))));
const reg = <V>(value: V) => ({ value, hlc: '001800000000000:000000:dA', eventId: 'e' });
const guide = (title: string) => ({ format: 'study@2', title, links: [], steps: [{ id: 's1', title: 'Listen', text: `${title}.` }], resources: [], terms: [], deps: [] });
const fia = { format: 'material@1', kind: 'key_terms', title: 'FIA', source: 'fia.bible', pattern: 'FIA', deps: [] };
const ownGuide = guide('Clean water');
const offered = guide('Offered');
const offStream = guide('Another language only');

const item = (docHash: string) => ({
  kind: reg('material'), name: reg('Item'), description: reg(''), copiedFrom: reg(null), versions: { [docHash]: { docHash, hlc: 'x', eventId: 'e', actorId: 'a' } },
  sharing: reg({ shared: false, subscribable: false }), archived: reg(false), subscription: reg(null), pinned: reg(null)
});
/** FIA's key words help on a check, a team's guide is linked to a passage, and one more guide the library offers. */
const orgState = { library: { fia: item(h(fia)), own: item(h(ownGuide)), offered: item(h(offered)) }, recommendations: {}, members: {}, roles: {}, languages: {} } as unknown as OrgState;
const language = () => ({
  template: null, templateHistory: {}, flow: null, passageLinks: { u1: { own: reg(true) } }, languageReferences: {}, checkHelps: { peer: { 'item:fia': reg(true) } }
}) as unknown as LanguageState;
const ALL = [fia, ownGuide, offered, offStream];

/** A phone's documents in memory, counting what it reads whole. */
function shelfOf(held: readonly unknown[]) {
  const docs = new Map<string, LibraryDoc>(held.map((d) => [h(d), d as LibraryDoc]));
  const kept: string[] = [];
  const port: NearbyDocs = {
    head: async (x) => { const d = docs.get(x); return d ? docHeadOf(d) : null; },
    text: async (x) => (docs.has(x) ? canonicalJson(docs.get(x)) : null),
    keep: async (x, text) => { docs.set(x, JSON.parse(text) as LibraryDoc); kept.push(x); return true; }
  };
  const library: NearbyLibrary = { org: () => orgState, language, docs: port };
  return { docs, kept, port, library };
}

/** An asker straight to a sender, counting the asks. */
function askerTo(sender: LibraryDocsSender | StartingCopySender) {
  const asks: Omit<Extract<Message, { t: 'copy-ask' }>, 't'>[] = [];
  const asker: CopyAsker = async (ask) => {
    asks.push(ask);
    const got = await sender.answer({ t: 'copy-ask', ...ask });
    return typeof got === 'string' ? { t: 'copy-no', reason: got } : { t: 'copy-part', ...got };
  };
  return { asker, asks };
}

describe('a teammate says which documents it holds', () => {
  it('held lists, sorted, only documents on its list that it holds: never one only another language uses', async () => {
    const there = shelfOf(ALL);
    const got = await LibraryDocsSender.of(there.library).answer({ t: 'copy-ask', part: 'held' });
    if (typeof got === 'string') throw new Error(got);
    expect(JSON.parse(got.body)).toEqual([h(fia), h(ownGuide), h(offered)].sort());
    // A sender lacking one leaves it out.
    const short = shelfOf([fia, offered]);
    const less = await LibraryDocsSender.of(short.library).answer({ t: 'copy-ask', part: 'held' });
    if (typeof less === 'string') throw new Error(less);
    expect(JSON.parse(less.body)).toEqual([h(fia), h(offered)].sort());
  });

  it('a library sender answers no starting-copy part, and no document off its list', async () => {
    const s = LibraryDocsSender.of(shelfOf(ALL).library);
    expect(await s.answer({ t: 'copy-ask', part: 'state', stream: LANG })).toBe('not-allowed');
    expect(await s.answer({ t: 'copy-ask', part: 'names' })).toBe('not-allowed');
    expect(await s.answer({ t: 'copy-ask', part: 'doc', hash: h(offStream) })).toBe('not-allowed');
    expect(await s.answer({ t: 'copy-ask', part: 'doc', hash: h(offered) })).toMatchObject({ part: 'doc', body: canonicalJson(offered), next: null });
  });

  it('the starting copy\'s sender answers held too, from the copy\'s states', async () => {
    const there = shelfOf([fia, ownGuide]);
    const s = new StartingCopySender({
      language: { startingCopy: async () => ({ serverSeq: 5, state: language() }) }, org: { startingCopy: async () => ({ serverSeq: 3, state: orgState }) }, docs: there.port
    }, LANG);
    const got = await s.answer({ t: 'copy-ask', part: 'held' });
    if (typeof got === 'string') throw new Error(got);
    expect(JSON.parse(got.body)).toEqual([h(fia), h(ownGuide)].sort());
  });
});

describe('a phone takes the documents its language uses that it lacks', () => {
  it('asks held once, then only what the teammate holds; what neither holds is missing, never asked', async () => {
    const here = shelfOf([]);
    const { asker, asks } = askerTo(LibraryDocsSender.of(shelfOf([fia, offered]).library));
    const got = await takeLibraryDocs(asker, here.library, { sha256: fakeSha256 }, { held: true });
    expect(got).toEqual({ kept: 2, refused: 0, missing: 1, capped: false });
    expect(asks.map((a) => a.part)).toEqual(['held', 'doc', 'doc']);
    expect(asks.some((a) => a.hash === h(ownGuide))).toBe(false);
    expect(here.kept.sort()).toEqual([h(fia), h(offered)].sort());
  });

  it('of an older teammate, which cannot say what it holds, it asks each hash', async () => {
    const here = shelfOf([]);
    const { asker, asks } = askerTo(LibraryDocsSender.of(shelfOf([fia]).library));
    const got = await takeLibraryDocs(asker, here.library, { sha256: fakeSha256 }, { held: false });
    expect(got).toEqual({ kept: 1, refused: 0, missing: 2, capped: false });
    expect(asks.map((a) => a.part)).toEqual(['doc', 'doc', 'doc']);
  });

  it('asks nothing at all when nothing is lacking', async () => {
    const here = shelfOf(ALL);
    const { asker, asks } = askerTo(LibraryDocsSender.of(shelfOf(ALL).library));
    expect(await takeLibraryDocs(asker, here.library, { sha256: fakeSha256 }, { held: true })).toEqual({ kept: 0, refused: 0, missing: 0, capped: false });
    expect(asks).toEqual([]);
  });

  it('a share of the pipe takes what the language names first and leaves the rest for the next session', async () => {
    const here = shelfOf([]);
    const there = LibraryDocsSender.of(shelfOf(ALL).library);
    const first = askerTo(there);
    // A budget of one character: one document a session.
    const one = await takeLibraryDocs(first.asker, here.library, { sha256: fakeSha256 }, { held: true, budgetChars: 1 });
    expect(one).toMatchObject({ kept: 1, capped: true });
    // The language's own come first (FIA's key words or its guide), the guide the library offers last.
    expect([h(fia), h(ownGuide)]).toContain(here.kept[0]);
    await takeLibraryDocs(askerTo(there).asker, here.library, { sha256: fakeSha256 }, { held: true, budgetChars: 1 });
    expect(here.kept).not.toContain(h(offered));
    const last = await takeLibraryDocs(askerTo(there).asker, here.library, { sha256: fakeSha256 }, { held: true, budgetChars: 1 });
    expect(last).toEqual({ kept: 1, refused: 0, missing: 0, capped: false });
    expect(here.kept.at(-1)).toBe(h(offered));
  });

  it('a held answer past its bound, or of another kind, gives nothing this time and asks no document', async () => {
    const here = shelfOf([]);
    const asks: string[] = [];
    const huge: CopyAsker = async (ask) => {
      asks.push(ask.part);
      return { t: 'copy-part', part: 'held', body: 'x'.repeat(COPY_HELD_MAX_CHARS + 1), next: String(COPY_HELD_MAX_CHARS + 1) };
    };
    expect(await takeLibraryDocs(huge, here.library, { sha256: fakeSha256 }, { held: true })).toEqual({ kept: 0, refused: 0, missing: 3, capped: false });
    expect(asks).toEqual(['held']);
    const wrong: CopyAsker = async () => ({ t: 'copy-part', part: 'held', body: '{"a":1}', next: null });
    expect(await takeLibraryDocs(wrong, here.library, { sha256: fakeSha256 }, { held: true })).toMatchObject({ kept: 0 });
  });

  it('a text that does not hash to its name is refused, and the session goes on', async () => {
    const here = shelfOf([]);
    const forged: CopyAsker = async (ask) => (ask.part === 'held'
      ? { t: 'copy-part', part: 'held', body: JSON.stringify([h(fia)]), next: null }
      : { t: 'copy-part', part: 'doc', body: canonicalJson(offered), next: null });
    expect(await takeLibraryDocs(forged, here.library, { sha256: fakeSha256 }, { held: true })).toEqual({ kept: 0, refused: 1, missing: 2, capped: false });
    expect(here.kept).toEqual([]);
  });
});

describe.each(STORES)('two members top each other up in a session, on the %s store', (_name, make) => {
  let server: FakeServer;
  let shelf: MemoryFiles;
  let time: ReturnType<typeof newTime>;
  let ana: Teammate;
  let sam: Teammate;

  beforeEach(async () => {
    server = new FakeServer();
    shelf = new Map();
    time = newTime();
    ana = await teammate('ana');
    sam = await teammate('sam');
  });

  const typesOf = (frames: readonly Uint8Array[]) => frames.map((f) => { const p = parseMessage(f); return p.kind === 'message' ? p.message : null; });

  async function meet(aHolds: readonly unknown[], bHolds: readonly unknown[], o: { kind?: 'wifi-direct' | 'bluetooth'; bLibrary?: boolean } = {}) {
    const a = await testPhone(server, make(), ana, shelf);
    const b = await testPhone(server, make(), sam, shelf);
    const da = shelfOf(aHolds);
    const db = shelfOf(bHolds);
    const pair = memoryNearbyPair({ time, files: shelf, kind: o.kind ?? 'wifi-direct' });
    const [ra, rb] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(a, 'i', pair.a, time, { library: da.library }).run(),
      sessionFor(b, 'r', pair.b, time, o.bLibrary === false ? {} : { library: db.library }).run());
    return { ra, rb, da, db, pair };
  }

  it('each takes what the other holds, both asking at once, and the session ends done', async () => {
    const { ra, rb, da, db } = await meet([fia, offered], [ownGuide]);
    expect(ra.ended).toEqual({ how: 'done' });
    expect(rb.ended).toEqual({ how: 'done' });
    expect(da.kept).toEqual([h(ownGuide)]);
    expect(db.kept.sort()).toEqual([h(fia), h(offered)].sort());
    expect(ra.topUp).toEqual({ kept: 1, refused: 0, missing: 0, capped: false });
    expect(rb.topUp).toEqual({ kept: 2, refused: 0, missing: 0, capped: false });
    expect(ra.changed).toBe(true);
  });

  it('phones holding the same documents ask for none', async () => {
    const { ra, rb, pair } = await meet(ALL, ALL);
    expect(ra.ended).toEqual({ how: 'done' });
    expect(ra.topUp).toBeNull();
    expect(rb.topUp).toBeNull();
    expect([...pair.sent.a.frames, ...pair.sent.b.frames].map((f) => parseMessage(f)).some((p) => p.kind === 'message' && p.message.t === 'copy-ask')).toBe(false);
  });

  it('a phone that serves no documents is asked none, and never a part it cannot read', async () => {
    const { ra, rb, pair } = await meet([], ALL, { bLibrary: false });
    expect(ra.ended).toEqual({ how: 'done' });
    expect(rb.ended).toEqual({ how: 'done' });
    expect(ra.topUp).toBeNull();
    const hello = typesOf(pair.sent.b.frames).find((m) => m?.t === 'hello');
    expect(hello?.t === 'hello' && hello.can.includes(COPY_LIBRARY_ABILITY)).toBe(false);
    expect(typesOf(pair.sent.a.frames).some((m) => m?.t === 'copy-ask')).toBe(false);
  });

  it('over the Bluetooth pipe a session takes its share, and the rest waits', async () => {
    const big = (title: string) => ({ ...guide(title), steps: [{ id: 's1', title: 'Listen', text: 'w'.repeat(200 * 1024) }] });
    const g1 = big('One');
    const extra = { ...orgState, library: { ...orgState.library, g1: item(h(g1)), g2: item(h(big('Two'))) } } as unknown as OrgState;
    const a = await testPhone(server, make(), ana, shelf);
    const b = await testPhone(server, make(), sam, shelf);
    const da = shelfOf([]);
    const db = shelfOf([...ALL, g1, big('Two')]);
    const pair = memoryNearbyPair({ time, files: shelf, kind: 'bluetooth' });
    const [ra] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(a, 'i', pair.a, time, { library: { ...da.library, org: () => extra } }).run(),
      sessionFor(b, 'r', pair.b, time, { library: { ...db.library, org: () => extra } }).run());
    expect(ra.ended).toEqual({ how: 'done' });
    expect(ra.topUp?.capped).toBe(true);
    expect(ra.topUp!.kept).toBeLessThan(5);
    // What the language names came first.
    expect(da.kept.slice(0, 2).sort()).toEqual([h(fia), h(ownGuide)].sort());
  });
});
