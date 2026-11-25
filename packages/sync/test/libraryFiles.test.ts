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

/** The language's documents, the same on both phones: each linked to a passage. */
function libraryOf(...linked: unknown[]): NearbyLibrary {
  const byHash = new Map(linked.map((d) => [h(d), d]));
  const org = { library: Object.fromEntries(linked.map((d, i) => [`item${i}`, item(h(d))])), recommendations: {}, members: {}, roles: {}, languages: {} } as unknown as OrgState;
  const language = {
    template: null, templateHistory: {}, flow: null, passageLinks: { u1: Object.fromEntries(linked.map((_d, i) => [`item${i}`, reg(true)])) }, languageReferences: {}, checkHelps: {}
  } as unknown as LanguageState;
  const docs: NearbyDocs = {
    head: async (x) => (byHash.has(x) ? nearbyDocHeadOf(byHash.get(x) as LibraryDoc) : null),
    text: async (x) => (byHash.has(x) ? canonicalJson(byHash.get(x)) : null),
    keep: async () => true
  };
  return { org: () => org, language: () => language, docs };
}

/** FIA's guide: its step audio and picture named only by address. */
function fiaGuide(...urls: string[]) {
  return {
    format: 'study@1', title: 'FIA', pattern: 'FIA', about: '', source: 'fia.bible', language: 'eng', ref: 'MRK 1:1-8', versification: 'ab'.repeat(32), deps: ['ab'.repeat(32)],
    steps: urls.map((url, i) => ({ id: `s${i}`, title: 'Listen', text: 'Water.', audio: { url } })), resources: [], terms: []
  };
}

/** A phone's study folder: files kept by address, on its shelf at `<phone>/study:<address>`. */
function withStudyFolder(p: TestPhone, shelf: MemoryFiles, study: Set<string>) {
  const at = (url: string) => `${p.who.deviceId}/study:${url}`;
  const landed = p.files.landed.bind(p.files);
  p.files.landed = async (file, stagingUri, size) => {
    if (file.group !== 'link') return landed(file, stagingUri, size);
    shelf.set(at(file.url!), shelf.get(stagingUri)!);
    shelf.delete(stagingUri);
    study.add(file.url!);
  };
  p.files.reference!.links = {
    held: async (urls) => urls.filter((u) => study.has(u)),
    lacking: async (urls) => urls.filter((u) => !study.has(u)),
    serve: async (url) => (study.has(url) ? { uri: at(url), size: shelf.get(at(url))!.length } : null)
  };
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
    expect(rb.libraryFiles).toEqual({ held: 0, theirs: 2, got: 2, served: 0, short: 0 });
    expect(ra.libraryFiles).toEqual({ held: 2, theirs: 0, got: 0, served: 2, short: 0 });
    // The guide's are not counted as recordings: only the backup is one. Nothing was asked in vain.
    expect(rb.files.got).toBe(1);
    expect(ra.files.toldNo).toBe(0);
    for (const hello of [helloOf(pair.sent.a.frames), helloOf(pair.sent.b.frames)]) {
      expect(hello?.kind === 'message' && hello.message.t === 'hello' && hello.message.can.includes(LIBRARY_FILES_ABILITY)).toBe(true);
    }
  });

  // The 2026-11-24 review (item 22): a library file never makes room, and the person is told how many waited for it.
  it('a library file that finds no room waits, the rest go on, and the report says how many waited', async () => {
    const a = await testPhone(server, make(), ana, shelf);
    const b = await testPhone(server, make(), sam, shelf);
    const pictures = ['one', 'two'].map((n) => { const x = fileHash(n); shelf.set(`${ana.deviceId}/${x}`, bytesOf(n)); a.files.here.add(x); return x; });
    const guide = guideNaming(...pictures);
    withLibraryFiles(a, shelf, new Set());
    withLibraryFiles(b, shelf, new Set());
    const fetchFile = b.files.fetchFile.bind(b.files);
    b.files.fetchFile = async (f) => (f.group === 'reference' ? null : fetchFile(f));
    const pair = memoryNearbyPair({ time, files: shelf, kind: 'wifi-direct' });
    const [, rb] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(a, 'i', pair.a, time, { library: libraryOf(guide) }).run(),
      sessionFor(b, 'r', pair.b, time, { library: libraryOf(guide) }).run());
    expect(rb.ended).toEqual({ how: 'done' });
    expect(rb.libraryFiles).toMatchObject({ theirs: 2, got: 0, short: 2 });
    expect(rb.files.noRoom).toBe(false);
  });

  it('a source\'s chapter audio comes last, after backups', async () => {
    const a = await testPhone(server, make(), ana, shelf);
    const b = await testPhone(server, make(), sam, shelf);
    const backup = await record(a, shelf, 'r1');
    const [picture, chapter] = ['picture', 'chapter'].map((n) => { const x = fileHash(n); shelf.set(`${ana.deviceId}/${x}`, bytesOf(n)); a.files.here.add(x); return x; });
    const guide = guideNaming(picture!);
    const book = { format: 'sourceBook@1', book: 'MRK', chapters: [{ chapter: 1, audio: { url: 'https://x/mrk1.mp3', hash: chapter } }], deps: [] };
    withLibraryFiles(a, shelf, new Set());
    withLibraryFiles(b, shelf, new Set());
    const pair = memoryNearbyPair({ time, files: shelf, kind: 'wifi-direct' });
    const [, rb] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(a, 'i', pair.a, time, { library: libraryOf(guide, book) }).run(),
      sessionFor(b, 'r', pair.b, time, { library: libraryOf(guide, book) }).run());
    expect(rb.ended).toEqual({ how: 'done' });
    const asked = pair.sent.b.frames.map((f) => parseMessage(f)).flatMap((p) => (p.kind === 'message' && p.message.t === 'file-ask' ? [p.message.hash] : []));
    expect(asked).toEqual([picture, backup, chapter]);
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

describe.each(STORES)('FIA\'s files named by address, on the %s store', (_name, make) => {
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

  // Carl, 2026-11-24: a phone that joined offline showed FIA's steps with no audio. FIA names its media only by address,
  // so no hash can hold the bytes: they come on the teammate's word, and the phone fetches them again once online.
  it('a phone lacking an FIA step\'s audio takes it from one that holds it, on its word, after the team\'s own files', async () => {
    const a = await testPhone(server, make(), ana, shelf);
    const b = await testPhone(server, make(), sam, shelf);
    const url = 'https://fia.bible/audio/mrk1-step1.mp3';
    // What FIA's address gave the teammate: no hash names these bytes.
    shelf.set(`${ana.deviceId}/study:${url}`, new TextEncoder().encode('step audio'));
    const aStudy = new Set([url]);
    const bStudy = new Set<string>();
    const guide = fiaGuide(url);
    withLibraryFiles(a, shelf, new Set());
    withLibraryFiles(b, shelf, new Set());
    withStudyFolder(a, shelf, aStudy);
    withStudyFolder(b, shelf, bStudy);
    const pair = memoryNearbyPair({ time, files: shelf, kind: 'wifi-direct' });
    const [ra, rb] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(a, 'i', pair.a, time, { library: libraryOf(guide) }).run(),
      sessionFor(b, 'r', pair.b, time, { library: libraryOf(guide) }).run());
    expect(ra.ended).toEqual({ how: 'done' });
    expect(rb.ended).toEqual({ how: 'done' });
    expect(bStudy).toEqual(new Set([url]));
    expect(new TextDecoder().decode(shelf.get(`${sam.deviceId}/study:${url}`))).toBe('step audio');
    expect(rb.libraryFiles).toMatchObject({ theirs: 1, got: 1 });
    expect(ra.libraryFiles).toMatchObject({ held: 1, served: 1 });
    // The address goes by its SHA-256, never as text.
    const key = bytesToHex(fakeSha256(utf8Encode(url)));
    const said = pair.sent.a.frames.map((f) => parseMessage(f)).find((m) => m.kind === 'message' && m.message.t === 'lib-held');
    expect(said?.kind === 'message' && said.message.t === 'lib-held' && said.message.files).toEqual([key]);
    expect(pair.sent.a.frames.some((f) => new TextDecoder().decode(f).includes('fia.bible'))).toBe(false);
  });

  it('a phone that keeps no study folder lists no address and is asked for none', async () => {
    const a = await testPhone(server, make(), ana, shelf);
    const b = await testPhone(server, make(), sam, shelf);
    const url = 'https://fia.bible/audio/mrk1-step1.mp3';
    shelf.set(`${ana.deviceId}/study:${url}`, new TextEncoder().encode('step audio'));
    withLibraryFiles(a, shelf, new Set());
    withLibraryFiles(b, shelf, new Set());
    withStudyFolder(a, shelf, new Set([url]));
    const pair = memoryNearbyPair({ time, files: shelf, kind: 'wifi-direct' });
    const [ra, rb] = await settled<[NearbySessionReport, NearbySessionReport]>(time,
      sessionFor(a, 'i', pair.a, time, { library: libraryOf(fiaGuide(url)) }).run(),
      sessionFor(b, 'r', pair.b, time, { library: libraryOf(fiaGuide(url)) }).run());
    expect(rb.ended).toEqual({ how: 'done' });
    expect(ra.libraryFiles).toMatchObject({ held: 1, served: 0 });
    expect(rb.libraryFiles).toMatchObject({ held: 0, theirs: 0, got: 0 });
  });
});
