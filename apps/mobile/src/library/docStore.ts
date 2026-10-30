import { canonicalJson, validateDoc, withDeps, type LibraryDoc } from '@langquest-next/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { noteExpected } from '../diagnostics/report';
import * as server from '../server/library';
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
 * A document made here, in the page's saved keys, where the browser cannot
 * write files: Safari before 26 has no way to write one from a page, and a
 * private window may have no file storage at all (LAN-194). Only documents
 * made here go there, so the outbox can still send them after a reload;
 * fetched ones stay in memory, as the server has them.
 */
const webKey = (hash: string) => `library-doc:${hash}`;

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
  if (WEB) {
    // A browser that cannot read its files has none of them: the document comes from the server.
    const bytes = await WEB.read(`${hash}.json`).catch(() => null);
    const text = bytes ? new TextDecoder().decode(bytes) : await AsyncStorage.getItem(webKey(hash));
    if (!text) return null;
    const doc = await admit(hash, text);
    if (!doc) {
      await WEB.remove(`${hash}.json`).catch(() => undefined);
      await AsyncStorage.removeItem(webKey(hash));
    }
    return doc;
  }
  if (!DIR) return null;
  ensureDir();
  const file = new File(DIR, `${hash}.json`);
  if (!file.exists) return null;
  const doc = await admit(hash, await file.text());
  // A damaged file is dropped; the server has the document.
  if (!doc) { try { file.delete(); } catch { /* retried next time */ } }
  return doc;
}

/** Keep a document's text; `made` (made here, not yet on the server) falls back to the page's saved keys on the web. */
async function toDisk(hash: string, text: string, made = false): Promise<void> {
  if (WEB) {
    try {
      await WEB.write(`${hash}.json`, new TextEncoder().encode(text));
    } catch (e) {
      if (!made) throw e;
      noteExpected('library document kept in saved keys', e);
      await AsyncStorage.setItem(webKey(hash), text);
    }
    return;
  }
  if (!DIR) return;
  ensureDir();
  const file = new File(DIR, `${hash}.json`);
  if (!file.exists) file.write(text);
}

/** Keep a document made here, and queue it for the server. */
export async function keepNewDoc(orgId: string, text: string, hash: string): Promise<void> {
  if (!(await admit(hash, text))) throw new Error('The document did not match its name.');
  await toDisk(hash, text, true);
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
 * A source's books and a collection's guides are not followed: each is
 * fetched by its own hash when a passage reads it. `deps: false` fetches
 * only the documents named.
 */
/** The browser refused to write a document once: the rest of this visit keeps them in memory only. */
let diskRefused = false;

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
        out.set(row.hash, doc);
        // The copy on disk is for being offline. A browser that cannot write files still shows every
        // document from memory; stopping here showed one Bible of many on New language's step 4 (LAN-194).
        if (!diskRefused) {
          await toDisk(row.hash, row.body).catch((e: unknown) => {
            diskRefused = true;
            noteExpected('library documents on disk', e);
          });
        }
      }
    }
    const next = new Set<string>();
    if (opts.deps === false) break;
    for (const doc of out.values()) {
      if (doc.format === 'versification@1' || doc.format === 'sourceBook@1') continue;
      // A source's books (and their timings) and a collection's guides load when a passage reads
      // them; only the numbering comes along. FIA's English guides alone are 1,525 documents (65 MB).
      const deps = doc.format === 'source@1' || doc.format === 'collection@1' ? [doc.versification] : doc.deps;
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
