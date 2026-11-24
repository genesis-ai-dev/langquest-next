// Sources kept on the phone (docs/reference-material.md, PLAN.md section 14).
//
// Only sources phones may keep are downloaded: a library source whose
// document says `offline: 'allowed'`, or a Bible Brain fileset the Worker
// says `/download` allows (`offline: true` on its audio link). Stream-only
// sources are never written to disk. Chapters are fetched for the passages
// whose reference material is kept (`referenceUnits`: core
// `defaultOfflineScope` plus every unit kept by choice, one by one or a book
// at a time), hashed after download and kept in the app's
// hash-addressed blob store under that hash; playback reads the file when
// it is there and streams otherwise. When the Worker later says a fileset
// may no longer be kept, its files are deleted.
//
// The index (AsyncStorage) says which file holds which chapter: Bible Brain
// files have no hash until downloaded. The sources share of the cache is
// bounded (`SOURCE_CACHE_BYTES`): files outside the scope go first, oldest
// first, and nothing new is fetched past the cap. Like every transfer, this
// waits while the microphone is open and while offline. A browser gets the
// files through the Worker (throughWorker.ts, decisions.md 201).
import type { SourceDoc } from '@langquest-next/core';
import { classifyTransferFailure } from '@langquest-next/sync';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { BlobStore, getBlobStore, type BlobFile } from '../sync/blobs';
import { referenceUnits } from '../sync/offlineModel';
import { heldDoc, loadDocs } from '../library/docStore';
import { libraryFilesKnown, noteLibraryFiles } from '../library/libraryOrigins';
import { noteExpected } from '../diagnostics/report';
import { timedTransfer } from '../diagnostics/diagnostics';
import type { Session } from '../shell/session';
import type { OrgHandle } from '../sync/useOrg';
import type { LanguageHandle } from '../sync/useLanguage';
import { isRecording } from '../recording/recorderState';
import { BibleError } from './bibleBrain';
import { offlineAllowed, sourceEvictions, type SourceOption } from './model';
import { audioFormatOf, bbKey, bookHashesFor, libAudioKey, offlineOptions, sourceHashes, wantsByUnit, type AudioFormat } from './offlineModel';
import { forgetReference, publishReference, referenceArrived, referenceState, type ReferenceMissing } from './referenceCounts';
import { bibleBrain, type MyBible } from './store';
import { bibleFilePath, fetchThroughWorker, libraryAudioPath } from './throughWorker';

// The key and format helpers are offlineModel.ts's; other files still import them from here.
export { audioFormatOf, bbKey, libAudioKey };

/** The sources' share of the 2 GB blob cache. */
const SOURCE_CACHE_BYTES = 1024 * 1024 * 1024;
const INDEX_KEY = 'source-audio:index';
/** Files fetched per pass; the next pass carries on. */
const PER_PASS = 40;

interface Entry {
  hash: string;
  bytes: number;
  /** How the file is named in the store; Bible Brain audio is MP3. */
  format?: AudioFormat;
  /** The Bible Brain fileset it came from, so a withdrawn license removes it. */
  fileset?: string;
  at: number;
}

/** chapter key -> file. Keys: `bb:<fileset>:<book>:<chapter>`, `lib:<hash>`, `url:<url>` (library audio named only by its link). */
let index: Record<string, Entry> | null = null;
const indexListeners = new Set<() => void>();

async function loadIndex(): Promise<Record<string, Entry>> {
  if (index) return index;
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    index = raw ? (JSON.parse(raw) as Record<string, Entry>) : {};
  } catch {
    index = {};
  }
  return index;
}

async function saveIndex(): Promise<void> {
  if (!index) return;
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index)).catch(() => undefined);
  for (const l of indexListeners) l();
}

/**
 * The chapters of library audio the last pass wanted and did not have, by hash, leaving out what
 * the sources' share has no room for: what a teammate's phone may hand over (2026-11-24,
 * docs/nearby-sync-plan.md 5.12, Library files), exactly what this phone would download online.
 */
let wantedHashes: ReadonlySet<string> = new Set();
export function sourceAudioWanted(): ReadonlySet<string> {
  return wantedHashes;
}

/** Re-render when files arrive or go. */
export function onSourceFiles(l: () => void): () => void {
  indexListeners.add(l);
  return () => { indexListeners.delete(l); };
}

/** A chapter's file on this phone, or null (call `ensureIndex` once first). */
export function keptAudio(store: BlobStore | null, key: string): BlobFile | null {
  const e = index?.[key];
  return e && store?.has(e.hash) ? { hash: e.hash, format: e.format ?? 'mp3' } : null;
}

export function ensureIndex(): Promise<unknown> {
  return loadIndex();
}

/** A URI to play a kept file from. On the web the bytes are read once into an object URL, which takes a moment. */
export async function playableUri(store: BlobStore, ref: BlobFile): Promise<string | null> {
  const now = store.uriFor(ref);
  if (now || Platform.OS !== 'web') return now;
  return new Promise((resolve) => {
    const done = (v: string | null) => { off(); clearTimeout(timer); resolve(v); };
    const off = store.onUrlReady(() => { const u = store.uriFor(ref); if (u) done(u); });
    const timer = setTimeout(() => done(store.uriFor(ref)), 3000);
  });
}

/**
 * Fetch one chapter's audio, hash it, and keep it under its hash. A known
 * hash must match. Answers its size. In a browser the Worker fetches it:
 * `webPath`, or else the library link's own route (throughWorker.ts).
 */
export async function download(store: BlobStore, key: string, url: string, opts: { expectHash?: string; fileset?: string; format?: AudioFormat; webPath?: string }): Promise<number> {
  const format = opts.format ?? 'mp3';
  let bytes: Uint8Array<ArrayBuffer>;
  let staged: File | null = null;
  if (Platform.OS === 'web') {
    const res = await fetchThroughWorker(opts.webPath ?? libraryAudioPath(url));
    bytes = new Uint8Array(await res.arrayBuffer());
  } else {
    // A staging name nobody trusts; only a hashed file earns its place in the store.
    staged = new File(Paths.cache, `source-${Crypto.randomUUID()}.${format}.part`);
    await File.downloadFileAsync(url, staged);
    bytes = await staged.bytes();
  }
  const hash = await BlobStore.hashOf(bytes);
  if (opts.expectHash && hash !== opts.expectHash) {
    try { staged?.delete(); } catch { /* the cache directory is the system's to clear */ }
    throw new Error(`hash mismatch for ${key}`);
  }
  const ref: BlobFile = { hash, format };
  if (Platform.OS === 'web') await store.putVerified(ref, bytes);
  else {
    const dest = store.fileFor(ref);
    if (dest.exists) staged!.delete();
    else staged!.move(dest);
    store.markPresent(hash, bytes.byteLength);
  }
  const idx = await loadIndex();
  idx[key] = { hash, bytes: bytes.byteLength, format, ...(opts.fileset ? { fileset: opts.fileset } : {}), at: Date.now() };
  await saveIndex();
  // A library source's chapter, its bytes held to the hash its document names: a teammate may be given it. Never Bible Brain's.
  if (opts.expectHash && !opts.fileset) noteLibraryFiles([hash]);
  return bytes.byteLength;
}

/** Delete every file of a fileset phones may no longer keep. */
export async function purgeFileset(store: BlobStore, fileset: string): Promise<number> {
  const idx = await loadIndex();
  const keys = Object.keys(idx).filter((k) => idx[k]!.fileset === fileset);
  if (keys.length === 0) return 0;
  store.remove(keys.map((k) => ({ hash: idx[k]!.hash, format: idx[k]!.format ?? 'mp3' })));
  for (const k of keys) delete idx[k];
  await saveIndex();
  return keys.length;
}

// ---- what the scope needs -------------------------------------------------------------------

const checkedFilesets = new Set<string>();
/** Links that failed this session; not tried again until the app restarts. */
const failedLinks = new Set<string>();
/** Filesets the Worker said this session may be streamed only: nothing of them is wanted on the phone. */
const streamOnly = new Set<string>();

/**
 * Library documents for working out what is wanted: from the server while
 * the device may ask it, else what this device holds. `failed`: the server
 * could not be asked, so a document missing here may still exist.
 */
async function docsFor(orgId: string, hashes: readonly string[], ask: boolean): Promise<{ docs: Map<string, unknown>; failed: boolean }> {
  if (!hashes.length) return { docs: new Map(), failed: false };
  if (ask) {
    try {
      return { docs: await loadDocs(orgId, [...hashes], { deps: false }), failed: false };
    } catch { /* away: what is here below */ }
  }
  const docs = new Map<string, unknown>();
  for (const h of hashes) {
    const d = await heldDoc(h).catch(() => null);
    if (d) docs.set(h, d);
  }
  return { docs, failed: true };
}

/** What the passages' reference audio was when last worked out, kept so a phone that opens offline knows at once. */
const wantsKey = (orgId: string, languageId: string) => `source-audio:wants:${orgId}/${languageId}`;
interface WantsRecord { wanted: [string, string[]][]; known: string[]; missing: [string, ReferenceMissing][] }
/** The record as last written, with its key, so a pass that learned nothing new writes nothing. */
let savedRecord = '';

/**
 * When a language opens: what its passages' reference audio was when last
 * worked out, and which of it is on this device now, so a download button
 * can count it before the next pass, offline too. Nothing is known of a
 * language never worked out here.
 */
export async function restoreReference(orgId: string, languageId: string, store: BlobStore | null): Promise<void> {
  forgetReference();
  const raw = await AsyncStorage.getItem(wantsKey(orgId, languageId)).catch(() => null);
  if (!raw) return;
  let record: WantsRecord;
  try { record = JSON.parse(raw) as WantsRecord; } catch { return; }
  const idx = await loadIndex();
  const files = store ?? (await getBlobStore());
  const wanted = new Map(record.wanted);
  const here = new Set([...wanted.values()].flat().filter((k) => { const e = idx[k]; return !!e && files.has(e.hash); }));
  publishReference({ wanted, known: new Set(record.known), here, missing: new Map(record.missing.filter(([k]) => !here.has(k))), coming: new Set() });
}

/**
 * Keep the chapters of reference audio that the passages kept with their
 * reference material want, and say which they are (`referenceCounts.ts`).
 * What is wanted is worked out every time, offline too, from what this
 * device holds; fetching waits for a connection and for the microphone to
 * close. Answers whether files are still to fetch that this pass left for
 * the next.
 */
export async function pass(language: LanguageHandle, org: OrgHandle, session: Session): Promise<boolean> {
  const state = language.state;
  if (!state || !language.languageId) return false;
  const fetching = language.online !== false && !isRecording();
  const store = language.blobs.store ?? (await getBlobStore());
  const idx = await loadIndex();
  // The default scope comes worked out from the phone's table too (decisions.md 143). Reference audio is
  // reference material: it comes with every passage kept on this device (`referenceUnits`).
  const scope = referenceUnits(language.blobs);

  const languageId = language.languageId;
  const mineRaw = await AsyncStorage.getItem(`my-bibles:${session.actorId}:${language.orgId}:${languageId}`).catch(() => null);
  const mine: MyBible[] = mineRaw ? (JSON.parse(mineRaw) as MyBible[]) : [];
  const hashes = [...sourceHashes(org.state, state, mine)];
  const sources = await docsFor(language.orgId, hashes, fetching);
  const docs = sources.docs;
  const getDoc = (h: string) => (docs.get(h) as SourceDoc | undefined) ?? null;
  const options = offlineOptions(org.state, state, mine, getDoc);
  // Only the books the scope's passages are in (a source lists all it has).
  const books = await docsFor(language.orgId, [...bookHashesFor(scope, options)], fetching);
  for (const [h, d] of books.docs) docs.set(h, d);
  // Bible Brain picks phones may keep (the Worker said so when they were added; it says again at download).
  for (const m of mine.filter((x) => x.kind === 'biblebrain' && x.bibleId)) {
    const bible = await bibleBrain?.keptBible(m.bibleId!);
    if (bible) {
      const o: SourceOption = { itemId: m.itemId, kind: 'biblebrain', from: 'mine', name: m.name, abbreviation: m.abbreviation, language: m.language, bible };
      if (offlineAllowed(o)) options.push(o);
    }
  }
  const worked = wantsByUnit(scope, options, docs, { sources: sources.failed && hashes.some((h) => !docs.has(h)), books: books.failed });
  // A fileset the Worker said may be streamed only is not wanted: like a source whose document says so, nothing of it is kept.
  const wants = worked.wants.filter((w) => !(w.fileset && streamOnly.has(w.fileset)));
  const keep = new Set(wants.map((w) => w.key));
  const wanted = new Map([...worked.perUnit].map(([unitId, keys]) => [unitId, keys.filter((k) => keep.has(k))]));
  const known = new Set([...scope].filter((u) => !worked.unknown.has(u)));
  const present = (key: string) => { const e = idx[key]; return !!e && store.has(e.hash); };
  // A chapter already in the store under the hash its document names (a teammate's phone handed it over, or another
  // language fetched it) is indexed now, offline too: before this, only a pass that could fetch did it.
  let indexed = false;
  // Only a file known to have come from the library (downloaded, or a teammate's library file): never a recording a document names.
  const fromLibrary = await libraryFilesKnown(wants.flatMap((w) => (w.hash && !present(w.key) && store.has(w.hash) ? [w.hash] : [])));
  for (const w of wants) {
    if (!w.hash || present(w.key) || !fromLibrary.has(w.hash)) continue;
    idx[w.key] = { hash: w.hash, bytes: store.sizeOf(w.hash) ?? 0, format: w.format ?? 'mp3', at: Date.now() };
    indexed = true;
  }
  if (indexed) await saveIndex();
  const missing = new Map<string, ReferenceMissing>();
  const tell = (coming: Set<string>) => publishReference({ wanted, known, here: new Set([...keep].filter(present)), missing: new Map(missing), coming });
  const record: WantsRecord = { wanted: [...wanted], known: [...known], missing: [] };
  const save = async () => {
    const key = wantsKey(language.orgId, languageId);
    const text = JSON.stringify({ ...record, missing: [...missing] });
    if (`${key}\n${text}` === savedRecord) return;
    savedRecord = `${key}\n${text}`;
    await AsyncStorage.setItem(key, text).catch(() => undefined);
  };

  if (fetching) {
    // Over the cap: out-of-scope files go first.
    const evict = sourceEvictions(idx, keep, SOURCE_CACHE_BYTES);
    if (evict.length) {
      store.remove(evict.map((k) => ({ hash: idx[k]!.hash, format: idx[k]!.format ?? 'mp3' })));
      for (const k of evict) delete idx[k];
      await saveIndex();
    }
  }

  let total = Object.values(idx).reduce((n, e) => n + e.bytes, 0);
  const toFetch = wants.filter((w) => !present(w.key));
  // What cannot come, said before anything is fetched: a link that failed this session, a Bible Brain chapter with
  // no service to send it, and, once the space kept for reference audio is full, everything not here.
  // Offline nothing new can be learned of what may come: a chapter that could not be downloaded when last asked is
  // still said to be so.
  const before = referenceState().missing;
  for (const w of toFetch) {
    if (w.url && failedLinks.has(w.url)) missing.set(w.key, 'unavailable');
    else if (w.fileset && !bibleBrain) missing.set(w.key, 'unavailable');
    else if (total >= SOURCE_CACHE_BYTES) missing.set(w.key, 'full');
    else if (!fetching && before.get(w.key) === 'unavailable') missing.set(w.key, 'unavailable');
  }
  const coming = new Set(fetching ? toFetch.map((w) => w.key).filter((k) => !missing.has(k)) : []);
  wantedHashes = new Set(toFetch.filter((w) => w.hash && missing.get(w.key) !== 'full').map((w) => w.hash!));
  tell(coming);
  await save();
  if (!fetching) return false;

  // Once a session, ask again about filesets with files here: FCBH may have withdrawn offline use.
  if (bibleBrain) {
    for (const e of Object.entries(idx)) {
      const [key, entry] = e;
      if (!entry.fileset || checkedFilesets.has(entry.fileset)) continue;
      checkedFilesets.add(entry.fileset);
      const [, , book, chapter] = key.split(':');
      try {
        const link = await bibleBrain.audio(entry.fileset, book!, Number(chapter), { offline: true });
        if (!link.offline) await purgeFileset(store, entry.fileset);
      } catch (err) {
        if (!(err instanceof BibleError)) throw err;
        if (err.kind !== 'offline') checkedFilesets.delete(entry.fileset);
      }
    }
  }

  let fetched = 0;
  let more = false;
  // Tallied for field diagnostics as `source` downloads of the language they are kept for.
  const fetchChapter = (key: string, url: string, opts: Parameters<typeof download>[3]) =>
    timedTransfer('down', { orgId: language.orgId, streamId: languageId, src: 'source' }, () => download(store, key, url, opts));
  const stop = (key: string, why: ReferenceMissing | null) => {
    if (why) missing.set(key, why);
    coming.delete(key);
  };
  for (const w of toFetch) {
    if (!coming.has(w.key)) continue;
    if (fetched >= PER_PASS) { more = true; break; }
    if (isRecording()) break;
    if (total >= SOURCE_CACHE_BYTES) { stop(w.key, 'full'); continue; }
    if (w.fileset && streamOnly.has(w.fileset)) { stop(w.key, null); continue; }
    if (w.hash && store.has(w.hash)) {
      idx[w.key] = { hash: w.hash, bytes: store.sizeOf(w.hash) ?? 0, format: w.format ?? 'mp3', at: Date.now() };
      await saveIndex();
      referenceArrived(w.key);
      coming.delete(w.key);
      continue;
    }
    try {
      if (w.url) {
        try { await fetchChapter(w.key, w.url, { ...(w.hash ? { expectHash: w.hash } : {}), format: w.format ?? 'mp3' }); }
        catch (e) { failedLinks.add(w.url); stop(w.key, 'unavailable'); throw e; }
      } else if (w.fileset && bibleBrain) {
        const link = await bibleBrain.audio(w.fileset, w.book, w.chapter, { offline: true });
        // Stream only from now on: nothing of it stays on the phone, and it is no longer wanted.
        if (!link.offline) {
          streamOnly.add(w.fileset);
          await purgeFileset(store, w.fileset);
          for (const [unitId, keys] of wanted) wanted.set(unitId, keys.filter((k) => !k.startsWith(`bb:${w.fileset}:`)));
          stop(w.key, null);
          continue;
        }
        await fetchChapter(w.key, link.url, { fileset: w.fileset, webPath: bibleFilePath(w.fileset, w.book, w.chapter) });
      } else continue;
      fetched++;
      total += idx[w.key]?.bytes ?? 0;
      referenceArrived(w.key);
      coming.delete(w.key);
    } catch (e) {
      // Offline, the rest are still to come once connected.
      if (e instanceof BibleError && e.kind === 'offline') break;
      // With no service to send them, or signed out of it, the Bible Brain chapters cannot come now (the next pass
      // asks again); the library's still can.
      if (e instanceof BibleError && (e.kind === 'unavailable' || e.kind === 'signed_out')) {
        for (const k of [...coming]) if (k.startsWith('bb:')) stop(k, 'unavailable');
        continue;
      }
      noteExpected('sources offline: download', e, e instanceof BibleError ? e.kind : classifyTransferFailure(e));
    }
  }
  if (!more) coming.clear();
  tell(coming);
  record.wanted = [...wanted];
  await save();
  return more;
}
