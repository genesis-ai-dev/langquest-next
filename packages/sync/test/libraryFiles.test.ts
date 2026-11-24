import { canonicalJson, type LanguageState, type LibraryDoc, type OrgState } from '@langquest-next/core';
import { bytesToHex, nearbyDocHeadOf, utf8Encode } from '@langquest-next/core/nearby';
import type { NearbyDocs, NearbyLibrary } from '../src/nearbyCopy';
import { LIBRARY_FILES_ABILITY, type NearbySessionReport } from '../src/nearbySession';
import { parseMessage } from '../src/nearbyWire';
import { FakeServer } from '../src/testing/fakeServer';
import { fakeSha256, memoryNearbyPair, type MemoryFiles } from '../src/testing/memoryNearbyLink';
import { STORES, teammate, type Teammate } from './nearbyFixtures';
import { newTime, record, sessionFor, settled, testPhone, type TestPhone } from './nearbyKit';

/**
 * A team's library files between teammates' phones in step 7 (docs/nearby-sync-plan.md 5.12,
 * 2026-11-24). Why: a phone that joined offline, or one that never opened a guide online, should
 * show the guide's pictures and play its audio as its teammate's does. Each phone says which it
 * holds, so nothing is asked in vain; they come after needed and review recordings and before
 * backups; they land unmarked; and a document that names a recording never makes a phone pass that
 * recording on.
 */

const h = (doc: unknown) => bytesToHex(fakeSha256(utf8Encode(canonicalJson(doc))));
const reg = <V>(value: V) => ({ value, hlc: '001800000000000:000000:dA', eventId: 'e' });
const bytesOf = (name: string) => new TextEncoder().encode(`picture ${name}`);
const fileHash = (name: string) => bytesToHex(fakeSha256(bytesOf(name)));

/** A team's guide with a picture and step audio, linked to a passage. */
function guideNaming(...hashes: string[]) {
  return {
    format: 'study@2', title: 'Clean water', links: [], deps: [], resources: [],
    steps: hashes.map((x, i) => ({ id: `s${i}`, title: 'Listen', text: 'Water.', audio: { hash: x, format: 'm4a' } })), terms: []
  };
}
const item = (docHash: string) => ({
  kind: reg('material'), name: reg('Guide'), description: reg(''), copiedFrom: reg(null), versions: { [docHash]: { docHash, hlc: 'x', eventId: 'e', actorId: 'a' } },
  sharing: reg({ shared: false, subscribable: false }), archived: reg(false), subscription: reg(null), pinned: reg(null)
});

/** The language's documents, the same on both phones: a guide linked to a passage. */
function libraryOf(guide: unknown): NearbyLibrary {
  const org = { library: { guide: item(h(guide)) }, recommendations: {}, members: {}, roles: {}, languages: {} } as unknown as OrgState;
  const language = { template: null, templateHistory: {}, flow: null, passageLinks: { u1: { guide: reg(true) } }, languageReferences: {}, checkHelps: {} } as unknown as LanguageState;
  const docs: NearbyDocs = {
    head: async (x) => (x === h(guide) ? nearbyDocHeadOf(guide as LibraryDoc) : null),
    text: async (x) => (x === h(guide) ? canonicalJson(guide) : null),
    keep: async () => true
  };
  return { org: () => org, language: () => language, docs };
}

/** A phone's library files beside its test files: here when on its shelf, never one of its recordings. */
function withLibraryFiles(p: TestPhone, shelf: MemoryFiles, recordings: Set<string>) {
  const at = (hash: string) => `${p.who.deviceId}/${hash}`;
  // As the language's file moves do: a file no recording of this language names is not served as one.
  const serveFile = p.files.serveFile.bind(p.files);
  const named = (hash: string) => Object.values((p.client.getState() as LanguageState).recordings).some((r) => r.cards.some((c) => c.hash === hash));
  p.files.serveFile = async (f) => (named(f.hash) ? serveFile(f) : { no: 'not-referenced' });
  p.files.reference = {
    held: async (hashes) => hashes.filter((x) => p.files.here.has(x) && shelf.has(at(x)) && !recordings.has(x)),
    lacking: (files) => files.filter((f) => !p.files.here.has(f.hash)),
    serve: async (f) => (p.files.here.has(f.hash) && shelf.has(at(f.hash)) && !recordings.has(f.hash) ? { uri: at(f.hash), size: shelf.get(at(f.hash))!.length } : null)
  };
}

describe.each(STORES)('library files between two members, on the %s store', (_name, make) => {
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

  const helloOf = (frames: readonly Uint8Array[]) => frames.map((f) => parseMessage(f)).find((p) => p.kind === 'message' && p.message.t === 'hello');

  it('a phone that lacks a guide\'s files takes them from one that holds them, before backups, and not as recordings', async () => {
    const a = await testPhone(server, make(), ana, shelf);
    const b = await testPhone(server, make(), sam, shelf);
    const backup = await record(a, shelf, 'r1');
    const pictures = ['one', 'two'].map((n) => { const x = fileHash(n); shelf.set(`${ana.deviceId}/${x}`, bytesOf(n)); a.files.here.add(x); return x; });
    const guide = guideNaming(...pictures);
    withLibraryFiles(a, shelf, new Set());
    withLibraryFiles(b, shelf, new Set());
    const pair = memoryNearbyPair({ time, files: shelf, kind: 'wifi-direct' });
    const [ra, rb] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(a, 'i', pair.a, time, { library: libraryOf(guide) }).run(),
      sessionFor(b, 'r', pair.b, time, { library: libraryOf(guide) }).run());
    expect(ra.ended).toEqual({ how: 'done' });
    expect(rb.ended).toEqual({ how: 'done' });
    for (const x of pictures) expect(shelf.get(`${sam.deviceId}/${x}`)).toBeDefined();
    // Small files first (Carl, 2026-11-24): the guide's, then the teammate's backup.
    const asked = pair.sent.b.frames.map((f) => parseMessage(f)).flatMap((p) => (p.kind === 'message' && p.message.t === 'file-ask' ? [p.message.hash] : []));
    expect(asked).toEqual([...[...pictures].sort(), backup]);
    expect(rb.libraryFiles).toEqual({ held: 0, theirs: 2, got: 2, served: 0 });
    expect(ra.libraryFiles).toEqual({ held: 2, theirs: 0, got: 0, served: 2 });
    // The guide's are not counted as recordings: only the backup is one. Nothing was asked in vain.
    expect(rb.files.got).toBe(1);
    expect(ra.files.toldNo).toBe(0);
    for (const hello of [helloOf(pair.sent.a.frames), helloOf(pair.sent.b.frames)]) {
      expect(hello?.kind === 'message' && hello.message.t === 'hello' && hello.message.can.includes(LIBRARY_FILES_ABILITY)).toBe(true);
    }
  });

  it('a guide that names a recording\'s hash never makes a phone pass that recording on', async () => {
    const a = await testPhone(server, make(), ana, shelf);
    const b = await testPhone(server, make(), sam, shelf);
    // Ana's own recording, which a guide names: it goes only as a recording, by the rules for recordings, never as a library file.
    const theirs = await record(a, shelf, 'private');
    const guide = guideNaming(theirs);
    withLibraryFiles(a, shelf, new Set([theirs]));
    withLibraryFiles(b, shelf, new Set());
    const pair = memoryNearbyPair({ time, files: shelf, kind: 'wifi-direct' });
    const [, rb] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(a, 'i', pair.a, time, { library: libraryOf(guide) }).run(),
      sessionFor(b, 'r', pair.b, time, { library: libraryOf(guide) }).run());
    expect(rb.ended).toEqual({ how: 'done' });
    expect(rb.libraryFiles).toMatchObject({ theirs: 0, got: 0 });
  });

  it('a phone that cannot hold library files is sent no lib-held and asked for none, and over the Bluetooth pipe there is no files step', async () => {
    const a = await testPhone(server, make(), ana, shelf);
    const b = await testPhone(server, make(), sam, shelf);
    const x = fileHash('one');
    shelf.set(`${ana.deviceId}/${x}`, bytesOf('one'));
    a.files.here.add(x);
    withLibraryFiles(a, shelf, new Set());
    const pair = memoryNearbyPair({ time, files: shelf, kind: 'wifi-direct' });
    const [ra] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(a, 'i', pair.a, time, { library: libraryOf(guideNaming(x)) }).run(),
      sessionFor(b, 'r', pair.b, time, { library: libraryOf(guideNaming(x)) }).run());
    expect(ra.ended).toEqual({ how: 'done' });
    expect(ra.libraryFiles).toBeNull();
    expect(pair.sent.a.frames.map((f) => parseMessage(f)).some((p) => p.kind === 'message' && p.message.t === 'lib-held')).toBe(false);
    withLibraryFiles(b, shelf, new Set());
    const pipe = memoryNearbyPair({ time, files: shelf, kind: 'bluetooth' });
    const [rp] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(a, 'i', pipe.a, time, { library: libraryOf(guideNaming(x)) }).run(),
      sessionFor(b, 'r', pipe.b, time, { library: libraryOf(guideNaming(x)) }).run());
    expect(rp.ended).toEqual({ how: 'done' });
    expect(rp.libraryFiles).toBeNull();
    expect(shelf.get(`${sam.deviceId}/${x}`)).toBeUndefined();
  });
});
