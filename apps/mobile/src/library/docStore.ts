import { canonicalJson, validateDoc, withDeps, type LibraryDoc } from '@langquest-next/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import * as server from '../server/library';
import { evictionOrder } from './model';
import { webFiles } from '../web/webFiles';

/**
 * Library documents on this phone (docs/library.md). A document is named by
 * the SHA-256 of its canonical text, so a file is trusted only once its
 * text hashes to its name; that holds for documents fetched from the server
 * and for ones made here. Documents made here wait in an outbox until the
 * server has them: the event that publishes a version may reach the server
 * first, and the server finishes the job (automatic updates) when the
 * document arrives.
 */

// expo-file-system does not exist on the web; there documents live in the
// browser's file storage under the same names (webFiles.ts), so one made
// here survives a reload while it waits in the outbox.
const WEB = Platform.OS === 'web' ? webFiles('library') : null;
const DIR = WEB ? null : new Directory(Paths.document, 'library');
const memory = new Map<string, LibraryDoc>();
const listeners = new Set<() => void>();
const outboxKey = (orgId: string) => `library-outbox:${orgId}`;

/**
 * Documents a passage fetches for itself (a source's book, a set's book of
 * helps, an alignment, an article): these count toward the phone's storage
 * limit, and those outside the person's kept passages go first when it is
 * reached (`evictDocs`, from sources/offline.ts, which knows what the kept
 * passages need). Everything else stays: an item's version, a numbering, a
 * list of books or articles, and guides and timings, which the offline
 * pass does not yet work out for the kept passages.
 */
const PIECES = new Set(['sourceBook@1', 'helpBook@1', 'alignment@1', 'material@1']);
const isPiece = (doc: LibraryDoc) => PIECES.has(doc.format) && (doc.format !== 'material@1' || doc.kind === 'document');

/** hash -> its size on disk, when it was last read or written, and whether it is a piece. */
type DocIndex = Record<string, { bytes: number; at: number; piece: boolean }>;
const INDEX_KEY = 'library-docs:index';
let docIndex: DocIndex | null = null;
let indexSaving: ReturnType<typeof setTimeout> | null = null;

async function loadDocIndex(): Promise<DocIndex> {
  if (docIndex) return docIndex;
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    docIndex = raw ? (JSON.parse(raw) as DocIndex) : {};
  } catch {
    docIndex = {};
  }
  return docIndex;
}

/** Note a document on disk; the index is written a moment later, once for a burst of documents. */
async function noteOnDisk(hash: string, text: string, doc: LibraryDoc): Promise<void> {
  const idx = await loadDocIndex();
  idx[hash] = { bytes: text.length, at: Date.now(), piece: isPiece(doc) };
  if (indexSaving) return;
  indexSaving = setTimeout(() => {
    indexSaving = null;
    void AsyncStorage.setItem(INDEX_KEY, JSON.stringify(docIndex ?? {})).catch(() => undefined);
  }, 1000);
}

function ensureDir() {
  if (DIR && !DIR.exists) DIR.create({ intermediates: true, idempotent: true });
}

/** SHA-256 hex of a document's canonical text. */
export async function hashOf(text: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);
}

/** The canonical text and hash of a new document, with `deps` filled in. Throws when it is not a valid document. */
export async function prepareDoc<T extends LibraryDoc>(doc: T): Promise<{ doc: T; text: string; hash: string }> {
  const full = withDeps(doc);
  const invalid = validateDoc(full);
  if (invalid) throw new Error(invalid);
  const text = canonicalJson(full);
  return { doc: full, text, hash: await hashOf(text) };
}

/** Trust a text only if it hashes to its name and is a valid document. */
async function admit(hash: string, text: string): Promise<LibraryDoc | null> {
  if ((await hashOf(text)) !== hash) return null;
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { return null; }
  if (validateDoc(doc)) return null;
  memory.set(hash, doc as LibraryDoc);
  return doc as LibraryDoc;
}

/** A document this phone already holds, without waiting (memory only). */
export function cachedDoc(hash: string | null | undefined): LibraryDoc | null {
  return hash ? memory.get(hash) ?? null : null;
}

async function fromDisk(hash: string): Promise<LibraryDoc | null> {
  let text: string | null = null;
  if (WEB) {
    const bytes = await WEB.read(`${hash}.json`);
    if (!bytes) return null;
    text = new TextDecoder().decode(bytes);
    const doc = await admit(hash, text);
    if (!doc) await WEB.remove(`${hash}.json`);
    if (doc) await noteOnDisk(hash, text, doc);
    return doc;
  }
  if (!DIR) return null;
  ensureDir();
  const file = new File(DIR, `${hash}.json`);
  if (!file.exists) return null;
  text = await file.text();
  const doc = await admit(hash, text);
  // A damaged file is dropped; the server has the document.
  if (!doc) { try { file.delete(); } catch { /* retried next time */ } }
  else await noteOnDisk(hash, text, doc);
  return doc;
}

async function toDisk(hash: string, text: string, doc: LibraryDoc): Promise<void> {
  if (WEB) {
    await WEB.write(`${hash}.json`, new TextEncoder().encode(text));
  } else {
    if (!DIR) return;
    ensureDir();
    const file = new File(DIR, `${hash}.json`);
    if (!file.exists) file.write(text);
  }
  await noteOnDisk(hash, text, doc);
}

/**
 * Make room among the pieces a passage fetched for itself (sources' books,
 * books of helps, alignments, guides, articles): over `capBytes`, those not
 * in `keep` (what the person's kept passages and the organization's items
 * need) go first, least lately used first; with `lowSpace` every piece
 * outside `keep` goes. A document waiting for the server never goes. Like
 * source audio (sources/offline.ts). Answers how many went.
 */
export async function evictDocs(orgIds: readonly string[], keep: ReadonlySet<string>, opts: { capBytes: number; lowSpace: boolean }): Promise<number> {
  const idx = await loadDocIndex();
  const waiting = new Set<string>();
  for (const orgId of orgIds) {
    const raw = await AsyncStorage.getItem(outboxKey(orgId)).catch(() => null);
    for (const h of raw ? (JSON.parse(raw) as string[]) : []) waiting.add(h);
  }
  const pieces = Object.fromEntries(Object.entries(idx).filter(([h, e]) => e.piece && !waiting.has(h)));
  const gone = evictionOrder(pieces, keep, opts.lowSpace ? 0 : opts.capBytes);
  for (const h of gone) {
    try {
      if (WEB) await WEB.remove(`${h}.json`);
      else if (DIR) { const f = new File(DIR, `${h}.json`); if (f.exists) f.delete(); }
    } catch { continue; }
    memory.delete(h);
    delete idx[h];
  }
  if (gone.length) await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(idx)).catch(() => undefined);
  return gone.length;
}

/** The bytes of documents on this phone: all of them, and the pieces among them. */
export async function docBytes(): Promise<{ all: number; pieces: number }> {
  const idx = await loadDocIndex();
  let all = 0;
  let pieces = 0;
  for (const e of Object.values(idx)) { all += e.bytes; if (e.piece) pieces += e.bytes; }
  return { all, pieces };
}

/** Keep a document made here, and queue it for the server. */
export async function keepNewDoc(orgId: string, text: string, hash: string): Promise<void> {
  const doc = await admit(hash, text);
  if (!doc) throw new Error('The document did not match its name.');
  await toDisk(hash, text, doc);
  const raw = await AsyncStorage.getItem(outboxKey(orgId));
  const queued: string[] = raw ? JSON.parse(raw) : [];
  if (!queued.includes(hash)) await AsyncStorage.setItem(outboxKey(orgId), JSON.stringify([...queued, hash]));
  notify();
}

/**
 * Send queued documents to the server, dependencies first (the server
 * refuses a document whose dependencies it cannot read). Safe to call often;
 * what fails stays queued.
 */
export async function flushOutbox(orgId: string): Promise<number> {
  const raw = await AsyncStorage.getItem(outboxKey(orgId));
  const queued: string[] = raw ? JSON.parse(raw) : [];
  if (queued.length === 0) return 0;
  const docs = new Map<string, { doc: LibraryDoc; text: string }>();
  for (const h of queued) {
    const doc = memory.get(h) ?? (await fromDisk(h));
    if (doc) docs.set(h, { doc, text: canonicalJson(doc) });
  }
  const sent = new Set<string>();
  const send = async (h: string): Promise<void> => {
    if (sent.has(h) || !docs.has(h)) return;
    const { doc, text } = docs.get(h)!;
    for (const d of doc.format === 'versification@1' ? [] : doc.deps) await send(d);
    const { data, error } = await server.putDocument(orgId, text);
    if (error) throw new Error(error.message);
    if (data !== h) throw new Error('The server named the document differently.');
    sent.add(h);
  };
  try {
    for (const h of queued) await send(h);
  } finally {
    // A queued document this device cannot read now stays queued: dropping it
    // would leave the server without a document an event may already name.
    const left = queued.filter((h) => !sent.has(h));
    await AsyncStorage.setItem(outboxKey(orgId), JSON.stringify(left));
  }
  return sent.size;
}

/**
 * The documents for these hashes, and everything they depend on: from
 * memory, then disk, then the server (which gives only what this
 * organization may read). Missing ones are simply absent from the result.
 * A source's books, a collection's guides, a set of helps' books and a
 * contents list's articles are not followed: each is fetched by its own
 * hash when a passage reads it. `deps: false` fetches only the documents
 * named.
 */
export async function loadDocs(orgId: string, hashes: (string | null | undefined)[], opts: { deps?: boolean } = {}): Promise<Map<string, LibraryDoc>> {
  const out = new Map<string, LibraryDoc>();
  let want = [...new Set(hashes.filter((h): h is string => !!h))];
  const seen = new Set<string>();
  // Offline, the server's refusal must not hide what is on disk: keep walking
  // the documents here (and their deps), tell the screens, then report it.
  let failed: Error | null = null;
  while (want.length) {
    const missing: string[] = [];
    for (const h of want) {
      seen.add(h);
      const doc = memory.get(h) ?? (await fromDisk(h));
      if (doc) out.set(h, doc);
      else missing.push(h);
    }
    // One refusal is enough to know the server is away this time.
    for (let i = 0; i < missing.length && !failed; i += 100) {
      let rows: { hash: string; body: string }[];
      try {
        const { data, error } = await server.getDocuments(orgId, missing.slice(i, i + 100));
        if (error) throw new Error(error.message);
        rows = (data ?? []) as { hash: string; body: string }[];
      } catch (e) {
        failed ??= e instanceof Error ? e : new Error(String(e));
        continue;
      }
      for (const row of rows) {
        const doc = await admit(row.hash, row.body);
        if (!doc) continue;
        await toDisk(row.hash, row.body, doc);
        out.set(row.hash, doc);
      }
    }
    const next = new Set<string>();
    if (opts.deps === false) break;
    for (const doc of out.values()) {
      if (doc.format === 'versification@1' || doc.format === 'sourceBook@1') continue;
      // A source's books (and their timings), a collection's guides, a set of helps' books and a
      // contents list's articles load when a passage reads them; only the numbering comes along.
      // FIA's English guides alone are 1,525 documents (65 MB); English Translation Notes 36 MB.
      const deps = doc.format === 'source@1' || doc.format === 'collection@1' ? [doc.versification]
        : doc.format === 'helps@1' ? (doc.versification ? [doc.versification] : [])
          : doc.format === 'contents@1' || doc.format === 'alignment@1' ? [] : doc.deps;
      for (const d of deps) if (!seen.has(d)) next.add(d);
    }
    want = [...next];
  }
  if (out.size) notify();
  if (failed) throw failed;
  return out;
}

function notify() {
  for (const l of listeners) l();
}

/** Re-render when documents arrive. */
export function onDocs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
