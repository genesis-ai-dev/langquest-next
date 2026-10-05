import { canonicalJson, validateDoc, withDeps, type LibraryDoc } from '@langquest-next/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { supabase } from '../supabase';
import { webFiles } from '../webFiles';

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
    const bytes = await WEB.read(`${hash}.json`);
    if (!bytes) return null;
    const doc = await admit(hash, new TextDecoder().decode(bytes));
    if (!doc) await WEB.remove(`${hash}.json`);
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

async function toDisk(hash: string, text: string): Promise<void> {
  if (WEB) {
    await WEB.write(`${hash}.json`, new TextEncoder().encode(text));
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
  await toDisk(hash, text);
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
    const { data, error } = await supabase.rpc('library_put_document', { p_org: orgId, p_body: text });
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
 */
export async function loadDocs(orgId: string, hashes: (string | null | undefined)[]): Promise<Map<string, LibraryDoc>> {
  const out = new Map<string, LibraryDoc>();
  let want = [...new Set(hashes.filter((h): h is string => !!h))];
  const seen = new Set<string>();
  while (want.length) {
    const missing: string[] = [];
    for (const h of want) {
      seen.add(h);
      const doc = memory.get(h) ?? (await fromDisk(h));
      if (doc) out.set(h, doc);
      else missing.push(h);
    }
    for (let i = 0; i < missing.length; i += 100) {
      const { data, error } = await supabase.rpc('library_get_documents', { p_org: orgId, p_hashes: missing.slice(i, i + 100) });
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as { hash: string; body: string }[]) {
        const doc = await admit(row.hash, row.body);
        if (!doc) continue;
        await toDisk(row.hash, row.body);
        out.set(row.hash, doc);
      }
    }
    const next = new Set<string>();
    for (const doc of out.values()) {
      if (doc.format === 'versification@1') continue;
      for (const d of doc.deps) if (!seen.has(d)) next.add(d);
    }
    want = [...next];
  }
  if (out.size) notify();
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
