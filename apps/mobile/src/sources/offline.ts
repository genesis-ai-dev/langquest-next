// Sources kept on the phone (docs/reference-material.md, PLAN.md section 14).
//
// Only sources phones may keep are downloaded: a library source whose
// document says `offline: 'allowed'`, or a Bible Brain fileset the Worker
// says `/download` allows (`offline: true` on its audio link). Stream-only
// sources are never written to disk. Chapters are fetched for the passages
// in the person's offline scope (core `defaultOfflineScope` plus the units
// they keep offline), hashed after download and kept in the app's
// hash-addressed blob store under that hash; playback reads the file when
// it is there and streams otherwise. When the Worker later says a fileset
// may no longer be kept, its files are deleted.
//
// The index (AsyncStorage) says which file holds which chapter: Bible Brain
// files have no hash until downloaded. The sources share of the cache is
// bounded (`SOURCE_CACHE_BYTES`): files outside the scope go first, oldest
// first, and nothing new is fetched past the cap. Like every transfer, this
// waits while the microphone is open and while offline.
import { defaultOfflineScope, isHash, recommendedFor, libraryItemView, type LanguageState, type SourceBookDoc, type SourceDoc } from '@langquest-next/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { BlobStore, getBlobStore, type BlobFile } from '../blobs';
import { loadDocs } from '../library/docStore';
import { noteExpected } from '../report';
import type { Session } from '../session';
import type { OrgHandle } from '../useOrg';
import type { LanguageHandle } from '../useLanguage';
import { isRecording } from '../useRecorder';
import { BibleError } from './bibleBrain';
import { chaptersOf, filesetsFor, offlineAllowed, sourceEvictions, unitCoordinates, type SourceOption } from './model';
import { bibleBrain, type MyBible } from './store';

/** The sources' share of the 2 GB blob cache. */
export const SOURCE_CACHE_BYTES = 1024 * 1024 * 1024;
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

export const bbKey = (fileset: string, book: string, chapter: number) => `bb:${fileset}:${book}:${chapter}`;
export const libKey = (hash: string) => `lib:${hash}`;
/** A library chapter's audio: by its hash when the document gives one, else by its link. */
export const libAudioKey = (a: { hash?: string; url?: string }) => (a.hash ? libKey(a.hash) : `url:${a.url ?? ''}`);

/** Re-render when files arrive or go. */
export function onSourceFiles(l: () => void): () => void {
  indexListeners.add(l);
  return () => { indexListeners.delete(l); };
}

export type AudioFormat = BlobFile['format'];

/** A library audio's format as the store names it. */
export function audioFormatOf(format: string | undefined): AudioFormat {
  return format === 'm4a' || format === 'wav' ? format : 'mp3';
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

/** Fetch one chapter's audio, hash it, and keep it under its hash. A known hash must match. */
async function download(store: BlobStore, key: string, url: string, opts: { expectHash?: string; fileset?: string; format?: AudioFormat }): Promise<void> {
  const format = opts.format ?? 'mp3';
  let bytes: Uint8Array<ArrayBuffer>;
  let staged: File | null = null;
  if (Platform.OS === 'web') {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
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

interface Want {
  key: string;
  /** Library audio: its URL and the hash it must have. */
  url?: string;
  hash?: string;
  format?: AudioFormat;
  /** Bible Brain audio: asked for at download time. */
  fileset?: string;
  book: string;
  chapter: number;
}

/** The source options a language offers for downloading: recommended library sources and the person's own picks. */
function offlineOptions(org: OrgHandle, state: LanguageState, mine: MyBible[], getDoc: (h: string) => SourceDoc | null): SourceOption[] {
  const out: SourceOption[] = [];
  const library = org.state?.library ?? {};
  const recs = recommendedFor(org.state?.recommendations, state);
  const ids = new Set([...recs.keys(), ...mine.filter((m) => m.kind === 'library').map((m) => m.itemId)]);
  for (const itemId of ids) {
    const hash = libraryItemView(library, itemId)?.current;
    const doc = hash ? getDoc(hash) : null;
    if (doc && doc.format === 'source@1') out.push({ itemId, kind: 'library', from: recs.get(itemId) ?? 'mine', name: doc.name, abbreviation: doc.abbreviation, language: doc.language, doc, docHash: hash! });
  }
  return out.filter((o) => o.doc?.offline === 'allowed');
}

/**
 * Keep the offline scope's chapters of downloadable sources on the phone.
 * Mounted once beside the library follower (App.tsx). Runs a pass after
 * the record or the library changes, a few seconds later, one file at a
 * time.
 */
export function useSourceOffline(language: LanguageHandle, org: OrgHandle, session: Session): void {
  const running = useRef(false);
  const again = useRef(false);
  const latest = useRef({ language, org, session });
  latest.current = { language, org, session };
  const revision = language.revision;
  const libraryKey = org.state ? Object.keys(org.state.recommendations ?? {}).length + ':' + Object.keys(org.state.library ?? {}).length : '';
  const kept = [...language.blobs.keptUnits].sort().join(',');

  useEffect(() => {
    const timer = setTimeout(() => {
      if (running.current) { again.current = true; return; }
      running.current = true;
      void (async () => {
        do {
          again.current = false;
          await pass(latest.current.language, latest.current.org, latest.current.session).catch((e: unknown) => noteExpected('sources offline', e));
        } while (again.current);
      })().finally(() => { running.current = false; });
    }, 4000);
    return () => clearTimeout(timer);
    // Revision covers the record; the key covers recommendations and items.
  }, [revision, libraryKey, kept, language.online]);
}

const checkedFilesets = new Set<string>();
/** Links that failed this session (on the web, a host that does not allow cross-origin reads); not tried again until the app restarts. */
const failedLinks = new Set<string>();

async function pass(language: LanguageHandle, org: OrgHandle, session: Session): Promise<void> {
  const state = language.state;
  if (!state || !language.languageId || language.online === false || isRecording()) return;
  const store = language.blobs.store ?? (await getBlobStore());
  const idx = await loadIndex();
  const scope = defaultOfflineScope(state, session.actorId);
  for (const u of language.blobs.keptUnits) scope.add(u);

  const wants: Want[] = [];
  const languageId = language.languageId;
  const mineRaw = await AsyncStorage.getItem(`my-bibles:${session.actorId}:${language.orgId}:${languageId}`).catch(() => null);
  const mine: MyBible[] = mineRaw ? (JSON.parse(mineRaw) as MyBible[]) : [];
  const hashes = new Set<string>();
  for (const itemId of [...recommendedFor(org.state?.recommendations, state).keys(), ...mine.map((m) => m.itemId)]) {
    const h = libraryItemView(org.state?.library ?? {}, itemId)?.current;
    if (h) hashes.add(h);
  }
  const docs: Map<string, unknown> = hashes.size ? await loadDocs(language.orgId, [...hashes], { deps: false }).catch(() => new Map()) : new Map();
  const getDoc = (h: string) => (docs.get(h) as SourceDoc | undefined) ?? null;
  const options = offlineOptions(org, state, mine, getDoc);
  // Only the books the scope's passages are in (a source lists all it has).
  const bookHashes = new Set<string>();
  for (const unitId of scope) {
    const book = unitCoordinates(unitId)?.book;
    for (const o of options) { const h = book ? o.doc?.books.find((b) => b.book === book)?.doc : undefined; if (h) bookHashes.add(h); }
  }
  if (bookHashes.size) for (const [h, d] of await loadDocs(language.orgId, [...bookHashes], { deps: false }).catch(() => new Map())) docs.set(h, d);
  // Bible Brain picks phones may keep (the Worker said so when they were added; it says again at download).
  for (const m of mine.filter((x) => x.kind === 'biblebrain' && x.bibleId)) {
    const bible = await bibleBrain?.keptBible(m.bibleId!);
    if (bible) {
      const o: SourceOption = { itemId: m.itemId, kind: 'biblebrain', from: 'mine', name: m.name, abbreviation: m.abbreviation, language: m.language, bible };
      if (offlineAllowed(o)) options.push(o);
    }
  }
  for (const unitId of scope) {
    const range = unitCoordinates(unitId);
    if (!range) continue;
    for (const o of options) {
      const chapters = chaptersOf(range);
      if (o.doc?.provider.kind === 'library') {
        const bookHash = o.doc.books.find((b) => b.book === range.book)?.doc;
        const book = bookHash ? (docs.get(bookHash) as SourceBookDoc | undefined) : undefined;
        for (const c of chapters) {
          const a = book?.chapters.find((x) => x.chapter === c)?.audio;
          // TODO(sources): audio carried only by hash (no URL) needs the library media route the guide editor adds.
          if (a?.url) wants.push({ key: libAudioKey(a), url: a.url, ...(isHash(a.hash) ? { hash: a.hash } : {}), format: audioFormatOf(a.format), book: range.book, chapter: c });
        }
      } else {
        const fileset = filesetsFor(o, range.book).audio;
        if (fileset) for (const c of chapters) wants.push({ key: bbKey(fileset, range.book, c), fileset, book: range.book, chapter: c });
      }
    }
  }

  const keep = new Set(wants.map((w) => w.key));
  // Over the cap: out-of-scope files go first.
  const evict = sourceEvictions(idx, keep, SOURCE_CACHE_BYTES);
  if (evict.length) {
    store.remove(evict.map((k) => ({ hash: idx[k]!.hash, format: idx[k]!.format ?? 'mp3' })));
    for (const k of evict) delete idx[k];
    await saveIndex();
  }

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

  let total = Object.values(idx).reduce((n, e) => n + e.bytes, 0);
  let fetched = 0;
  const refused = new Set<string>();
  for (const w of wants) {
    if (fetched >= PER_PASS || total >= SOURCE_CACHE_BYTES) break;
    if (isRecording()) break;
    const have = idx[w.key];
    if (have && store.has(have.hash)) continue;
    if (w.hash && store.has(w.hash)) {
      idx[w.key] = { hash: w.hash, bytes: store.sizeOf(w.hash) ?? 0, format: w.format ?? 'mp3', at: Date.now() };
      await saveIndex();
      continue;
    }
    try {
      if (w.url) {
        if (failedLinks.has(w.url)) continue;
        try { await download(store, w.key, w.url, { ...(w.hash ? { expectHash: w.hash } : {}), format: w.format ?? 'mp3' }); }
        catch (e) { failedLinks.add(w.url); throw e; }
      }
      else if (w.fileset && bibleBrain && !refused.has(w.fileset)) {
        const link = await bibleBrain.audio(w.fileset, w.book, w.chapter, { offline: true });
        // Stream only from now on: nothing of it stays on the phone.
        if (!link.offline) { refused.add(w.fileset); await purgeFileset(store, w.fileset); continue; }
        await download(store, w.key, link.url, { fileset: w.fileset });
      } else continue;
      fetched++;
      total += idx[w.key]?.bytes ?? 0;
    } catch (e) {
      if (e instanceof BibleError && (e.kind === 'offline' || e.kind === 'unavailable' || e.kind === 'signed_out')) break;
      noteExpected('sources offline: download', e);
    }
  }
}
