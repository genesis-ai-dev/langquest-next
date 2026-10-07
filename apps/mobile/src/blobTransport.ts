import type { SupabaseClient } from '@supabase/supabase-js';
import { File, UploadType } from 'expo-file-system';
import { Platform } from 'react-native';
import { BlobStore, mimeOf, type StoredFile } from './blobs';
import type { TransferTimings } from './diagnostics';
import { supabase } from './supabase';

/**
 * Blob transfers through the app's Worker, which keeps them in Cloudflare R2
 * (decisions.md 69, apps/web/worker/blobs.ts). Upload is an idempotent PUT
 * of a content-addressed object (rule 2); R2 refuses bytes that do not hash
 * to their name, and the Worker appends v1.BlobStored before it answers, so
 * the device learns of it through the normal pull.
 */

/** The Worker's address. The web app is served by it, so there it is the page's own; a phone build without one cannot move files. */
const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') || (Platform.OS === 'web' ? '' : null);

function api(): string {
  if (apiUrl === null) throw new Error('No file server is set up for this build (EXPO_PUBLIC_API_URL).');
  return apiUrl;
}

/** `<org>/<stream>/<hash>.<ext>`: a recording belongs to its language's stream, so the stream is the language id. */
function objectPath(orgId: string, streamId: string, ref: StoredFile): string {
  return [orgId, streamId, `${ref.hash}.${ref.format}`].map(encodeURIComponent).join('/');
}

async function tokenOf(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in.');
  return token;
}

/**
 * Native streaming upload: the file never enters the JS heap. `as` is the
 * session to send under: a hand-over sends a signed-out person's recordings
 * as them (handOver.ts).
 */
export async function uploadBlob(orgId: string, streamId: string, ref: StoredFile, store: BlobStore, timings: TransferTimings = {}, as: SupabaseClient = supabase): Promise<void> {
  const url = `${api()}/api/blobs/${objectPath(orgId, streamId, ref)}`;
  const headers = { Authorization: `Bearer ${await tokenOf(as)}`, 'Content-Type': mimeOf(ref.format) };
  const sent = Date.now();
  // Web keeps blobs in the browser's file storage (webFiles.ts): the same request, from those bytes.
  const res = Platform.OS === 'web'
    ? await uploadFromWeb(url, headers, ref, store)
    : await store.fileFor(ref).upload(url, { httpMethod: 'PUT', uploadType: UploadType.BINARY_CONTENT, headers });
  timings.fetchMs = Date.now() - sent;
  if (res.status < 200 || res.status >= 300) throw new UploadError(res.status, res.body.slice(0, 200));
}

/** The server answered and did not take the file; `refused` means trying again will not help. */
export class UploadError extends Error {
  constructor(readonly status: number, body: string) { super(`Upload failed (${status}): ${body}`); }
  get refused(): boolean { return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429; }
}

/**
 * A link to read a file the server has, valid for ten minutes. Downloads
 * use it, and so does playing without keeping the file on this phone:
 * audio of a passage outside the offline scope plays while connected
 * (decisions.md 61), asked for at play time. The Worker asks the database
 * whether this person may read it.
 */
export async function streamUrl(orgId: string, streamId: string, ref: StoredFile): Promise<string> {
  const res = await fetch(`${api()}/api/blob-urls/${objectPath(orgId, streamId, ref)}`, {
    headers: { Authorization: `Bearer ${await tokenOf(supabase)}` }
  });
  if (!res.ok) throw new Error(`No link to the file (${res.status})`);
  return `${api()}${((await res.json()) as { path: string }).path}`;
}

/**
 * `timings` splits the time for field diagnostics: signing the URL, the
 * network fetch, and reading plus hashing on the phone, which on a slow
 * phone can outweigh the network.
 */
export async function downloadBlob(orgId: string, streamId: string, ref: StoredFile, store: BlobStore, timings: TransferTimings = {}): Promise<void> {
  let mark = Date.now();
  const lap = () => { const now = Date.now(); const ms = now - mark; mark = now; return ms; };
  const signedUrl = await streamUrl(orgId, streamId, ref);
  timings.signMs = lap();
  if (Platform.OS === 'web') return downloadOnWeb(signedUrl, ref, store, timings, lap);
  // Land in a staging name; only a verified hash earns the trusted name.
  const staged = store.stagingFor(ref);
  if (staged.exists) staged.delete();
  await File.downloadFileAsync(signedUrl, staged);
  timings.fetchMs = lap();
  const bytes = await staged.bytes();
  const actual = await BlobStore.hashOf(bytes);
  timings.verifyMs = lap();
  if (actual !== ref.hash) {
    staged.delete();
    throw new Error(`hash mismatch for ${ref.hash}: got ${actual}`);
  }
  store.commitStaged(ref, bytes.byteLength);
}

async function uploadFromWeb(url: string, headers: Record<string, string>, ref: StoredFile, store: BlobStore): Promise<{ status: number; body: string }> {
  const bytes = await store.readBytes(ref);
  if (!bytes) throw new Error(`no bytes for ${ref.hash} in this browser`);
  const res = await fetch(url, { method: 'POST', headers, body: bytes });
  return { status: res.status, body: await res.text() };
}

/** Web: the same verification as on disk, with the bytes kept only if their hash matches. */
async function downloadOnWeb(signedUrl: string, ref: StoredFile, store: BlobStore, timings: TransferTimings, lap: () => number): Promise<void> {
  const res = await fetch(signedUrl);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  timings.fetchMs = lap();
  const actual = await BlobStore.hashOf(bytes);
  timings.verifyMs = lap();
  if (actual !== ref.hash) throw new Error(`hash mismatch for ${ref.hash}: got ${actual}`);
  await store.putVerified(ref, bytes);
}
