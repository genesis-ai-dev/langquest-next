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
import type { SourceDoc } from '@langquest-next/core';
import { classifyTransferFailure } from '@langquest-next/sync';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { BlobStore, getBlobStore, type BlobFile } from '../sync/blobs';
import { evictDocs, loadDocs } from '../library/docStore';
import { libraryItems, type LibraryDoc } from '@langquest-next/core';
import { alignmentHash, helpsPassage, offeredHelps, offlineHelpDocs, usesTemplate } from '../helps/libraryHelpsModel';
import { offeredGuideSources } from '../reference/offered';
import { teamLanguages } from '../reference/languages';
import { noteExpected } from '../diagnostics/report';
import { timedTransfer } from '../diagnostics/diagnostics';
import type { Session } from '../shell/session';
import type { OrgHandle } from '../sync/useOrg';
import type { LanguageHandle } from '../sync/useLanguage';
import { isRecording } from '../recording/recorderState';
import { BibleError } from './bibleBrain';
import { offlineAllowed, sourceEvictions, type SourceOption } from './model';
import { audioFormatOf, bbKey, bookHashesFor, libAudioKey, offlineOptions, offlineScope, sourceHashes, wantedChapters, type AudioFormat, type Want } from './offlineModel';
import { bibleBrain, type MyBible } from './store';

// The key and format helpers are offlineModel.ts's; other files still import them from here.
export { audioFormatOf, bbKey, libAudioKey };

/** The sources' share of the 2 GB blob cache. */
const SOURCE_CACHE_BYTES = 1024 * 1024 * 1024;
/** What passages fetch of the library for themselves (books of sources and helps, alignments, guides, articles) may keep on the phone. */
const LIBRARY_DOC_BYTES = 256 * 1024 * 1024;
/** The room kept free for recording (sync/useLanguage.ts LIMITS): below it, every fetched document outside the kept passages goes. */
const MIN_FREE_BYTES = 500 * 1024 * 1024;
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

/** Fetch one chapter's audio, hash it, and keep it under its hash. A known hash must match. Answers its size. */
export async function download(store: BlobStore, key: string, url: string, opts: { expectHash?: string; fileset?: string; format?: AudioFormat }): Promise<number> {
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
/** Links that failed this session (on the web, a host that does not allow cross-origin reads); not tried again until the app restarts. */
const failedLinks = new Set<string>();

/**
 * Fetch what the scope's passages need of their library helps, and answer
 * every document they need (to keep when space runs low).
 */
async function helpsOffline(language: LanguageHandle, org: OrgHandle, scope: ReadonlySet<string>, sources: readonly SourceDoc[]): Promise<string[]> {
  const state = language.state;
  if (!state) return [];
  const library = org.state?.library ?? {};
  const reads = teamLanguages(org.state, state, language.languageId);
  const units = [...scope];
  const groups = units.map((u) => offeredGuideSources(library, org.state?.recommendations, state, u));
  const index = new Map<string, LibraryDoc>();
  const want = [...new Set(groups.flatMap((g) => [...g.recommended, ...g.own].map((s) => s.hash)).concat(state.template?.value?.docHash ? [state.template.value.docHash] : []))];
  for (const [h, d] of await loadDocs(language.orgId, want)) index.set(h, d);
  const get = (h: string | null | undefined) => (h ? index.get(h) ?? null : null);
  const out = new Set<string>(index.keys());
  const passages = [];
  const books = new Set<string>();
  for (const [i, u] of units.entries()) {
    const sets = offeredHelps(groups[i]!, get, reads);
    const placedOn = [...sets.notes, ...sets.questions, ...sets.wordLinks].map((s) => s.doc.template).find(Boolean);
    const p = helpsPassage(state, u, get, !!placedOn && usesTemplate(state, library, placedOn));
    if (!p) continue;
    passages.push({ p, sets });
    if (p.kind === 'bible') books.add(p.range.book);
  }
  const pieces = new Set<string>();
  for (const { p, sets } of passages) for (const h of offlineHelpDocs([p], sets, get).pieces) pieces.add(h);
  for (const s of sources) for (const b of books) { const a = alignmentHash(s, b); if (a) pieces.add(a); }
  for (const [h, d] of await loadDocs(language.orgId, [...pieces], { deps: false })) { index.set(h, d); out.add(h); }
  const articles = new Set<string>();
  for (const { p, sets } of passages) for (const h of offlineHelpDocs([p], sets, get).articles) articles.add(h);
  for (const h of (await loadDocs(language.orgId, [...articles], { deps: false })).keys()) out.add(h);
  return [...out];
}

export async function pass(language: LanguageHandle, org: OrgHandle, session: Session): Promise<void> {
  const state = language.state;
  if (!state || !language.languageId || language.online === false || isRecording()) return;
  const store = language.blobs.store ?? (await getBlobStore());
  const idx = await loadIndex();
  const scope = offlineScope(state, session.actorId, language.blobs.keptUnits);

  const languageId = language.languageId;
  const mineRaw = await AsyncStorage.getItem(`my-bibles:${session.actorId}:${language.orgId}:${languageId}`).catch(() => null);
  const mine: MyBible[] = mineRaw ? (JSON.parse(mineRaw) as MyBible[]) : [];
  const hashes = sourceHashes(org.state, state, mine);
  const docs: Map<string, unknown> = hashes.size ? await loadDocs(language.orgId, [...hashes], { deps: false }).catch(() => new Map()) : new Map();
  const getDoc = (h: string) => (docs.get(h) as SourceDoc | undefined) ?? null;
  const options = offlineOptions(org.state, state, mine, getDoc);
  // Only the books the scope's passages are in (a source lists all it has).
  const bookHashes = bookHashesFor(scope, options);
  if (bookHashes.size) for (const [h, d] of await loadDocs(language.orgId, [...bookHashes], { deps: false }).catch(() => new Map())) docs.set(h, d);
  // Bible Brain picks phones may keep (the Worker said so when they were added; it says again at download).
  for (const m of mine.filter((x) => x.kind === 'biblebrain' && x.bibleId)) {
    const bible = await bibleBrain?.keptBible(m.bibleId!);
    if (bible) {
      const o: SourceOption = { itemId: m.itemId, kind: 'biblebrain', from: 'mine', name: m.name, abbreviation: m.abbreviation, language: m.language, bible };
      if (offlineAllowed(o)) options.push(o);
    }
  }
  const wants: Want[] = wantedChapters(scope, options, docs);

  // The kept passages' helps from the library go offline with them: their books' notes, questions and
  // key-word links, the Bibles' alignments of those books, and their key words' articles.
  const keptDocs = new Set<string>([...docs.keys()]);
  try {
    for (const h of await helpsOffline(language, org, scope, options.flatMap((o) => (o.doc ? [o.doc] : [])))) keptDocs.add(h);
  } catch (e) {
    noteExpected('sources offline: helps', e, classifyTransferFailure(e));
  }
  // Fetched documents count toward the phone's storage: outside the kept passages and the organization's
  // own items, the least lately used go first (docStore.ts evictDocs).
  for (const it of libraryItems(org.state?.library ?? {})) if (it.current) keptDocs.add(it.current);
  const lowSpace = Platform.OS !== 'web' && Paths.availableDiskSpace < MIN_FREE_BYTES;
  await evictDocs([language.orgId], keptDocs, { capBytes: LIBRARY_DOC_BYTES, lowSpace }).catch((e: unknown) => noteExpected('library documents: evict', e));

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
  // Tallied for field diagnostics as `source` downloads of the language they are kept for.
  const fetchChapter = (key: string, url: string, opts: Parameters<typeof download>[3]) =>
    timedTransfer('down', { orgId: language.orgId, streamId: languageId, src: 'source' }, () => download(store, key, url, opts));
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
        try { await fetchChapter(w.key, w.url, { ...(w.hash ? { expectHash: w.hash } : {}), format: w.format ?? 'mp3' }); }
        catch (e) { failedLinks.add(w.url); throw e; }
      }
      else if (w.fileset && bibleBrain && !refused.has(w.fileset)) {
        const link = await bibleBrain.audio(w.fileset, w.book, w.chapter, { offline: true });
        // Stream only from now on: nothing of it stays on the phone.
        if (!link.offline) { refused.add(w.fileset); await purgeFileset(store, w.fileset); continue; }
        await fetchChapter(w.key, link.url, { fileset: w.fileset });
      } else continue;
      fetched++;
      total += idx[w.key]?.bytes ?? 0;
    } catch (e) {
      if (e instanceof BibleError && (e.kind === 'offline' || e.kind === 'unavailable' || e.kind === 'signed_out')) break;
      noteExpected('sources offline: download', e, e instanceof BibleError ? e.kind : classifyTransferFailure(e));
    }
  }
}
