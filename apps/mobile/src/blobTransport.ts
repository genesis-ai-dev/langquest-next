import type { BlobRef } from '@langquest-next/core';
import { File, UploadType } from 'expo-file-system';
import { Platform } from 'react-native';
import { BlobStore } from './blobs';
import type { TransferTimings } from './diagnostics';
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';

/**
 * Blob transfers over Supabase Storage. Upload is an idempotent upsert of a
 * content-addressed object (rule 2). The server's storage trigger appends
 * v1.BlobStored; the device learns of it through the normal pull.
 */
const BUCKET = 'blobs';

export function objectPath(orgId: string, projectId: string, ref: BlobRef): string {
  return `${orgId}/${projectId}/${ref.hash}.${ref.format}`;
}

/**
 * Native streaming upload: the file never enters the JS heap. Same request
 * supabase-js would make (POST object, x-upsert), with the session token,
 * so bucket policies apply unchanged.
 */
export async function uploadBlob(orgId: string, projectId: string, ref: BlobRef, store: BlobStore, timings: TransferTimings = {}): Promise<void> {
  const { data, error: authError } = await supabase.auth.getSession();
  if (authError) throw new Error(authError.message);
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in.');
  const url = `${supabaseUrl}/storage/v1/object/${BUCKET}/${objectPath(orgId, projectId, ref)}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    apikey: supabaseAnonKey,
    'x-upsert': 'true',
    'Content-Type': ref.format === 'wav' ? 'audio/wav' : 'audio/mp4'
  };
  const sent = Date.now();
  // Web keeps blobs in the browser's file storage (webFiles.ts): the same request, from those bytes.
  const res = Platform.OS === 'web'
    ? await uploadFromWeb(url, headers, ref, store)
    : await store.fileFor(ref).upload(url, { httpMethod: 'POST', uploadType: UploadType.BINARY_CONTENT, headers });
  timings.fetchMs = Date.now() - sent;
  if (res.status < 200 || res.status >= 300) throw new Error(`Upload failed (${res.status}): ${res.body.slice(0, 200)}`);
}

/**
 * `timings` splits the time for field diagnostics: signing the URL, the
 * network fetch, and reading plus hashing on the phone, which on a slow
 * phone can outweigh the network.
 */
export async function downloadBlob(orgId: string, projectId: string, ref: BlobRef, store: BlobStore, timings: TransferTimings = {}): Promise<void> {
  let mark = Date.now();
  const lap = () => { const now = Date.now(); const ms = now - mark; mark = now; return ms; };
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(objectPath(orgId, projectId, ref), 600);
  timings.signMs = lap();
  if (error || !data) throw new Error(error?.message ?? 'no signed url');
  if (Platform.OS === 'web') return downloadOnWeb(data.signedUrl, ref, store, timings, lap);
  // Land in a staging name; only a verified hash earns the trusted name.
  const staged = store.stagingFor(ref);
  if (staged.exists) staged.delete();
  await File.downloadFileAsync(data.signedUrl, staged);
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

async function uploadFromWeb(url: string, headers: Record<string, string>, ref: BlobRef, store: BlobStore): Promise<{ status: number; body: string }> {
  const bytes = await store.readBytes(ref);
  if (!bytes) throw new Error(`no bytes for ${ref.hash} in this browser`);
  const res = await fetch(url, { method: 'POST', headers, body: bytes });
  return { status: res.status, body: await res.text() };
}

/** Web: the same verification as on disk, with the bytes kept only if their hash matches. */
async function downloadOnWeb(signedUrl: string, ref: BlobRef, store: BlobStore, timings: TransferTimings, lap: () => number): Promise<void> {
  const res = await fetch(signedUrl);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  timings.fetchMs = lap();
  const actual = await BlobStore.hashOf(bytes);
  timings.verifyMs = lap();
  if (actual !== ref.hash) throw new Error(`hash mismatch for ${ref.hash}: got ${actual}`);
  await store.putVerified(ref, bytes);
}
