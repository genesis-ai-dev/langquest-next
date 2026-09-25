import type { BlobRef } from '@langquest-next/core';
import { BlobStore } from './blobs';
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
 * Same request supabase-js would make (POST object, x-upsert), with the
 * session token, so bucket policies apply unchanged. Native streams the file.
 */
export async function uploadBlob(orgId: string, projectId: string, ref: BlobRef, store: BlobStore): Promise<void> {
  const { data, error: authError } = await supabase.auth.getSession();
  if (authError) throw new Error(authError.message);
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in.');
  const res = await store.disk.upload(store.nameFor(ref), `${supabaseUrl}/storage/v1/object/${BUCKET}/${objectPath(orgId, projectId, ref)}`, {
    Authorization: `Bearer ${token}`,
    apikey: supabaseAnonKey,
    'x-upsert': 'true',
    'Content-Type': ref.format === 'jpg' ? 'image/jpeg' : ref.format === 'wav' ? 'audio/wav' : 'audio/mp4'
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`Upload failed (${res.status}): ${res.body.slice(0, 200)}`);
}

export async function downloadBlob(orgId: string, projectId: string, ref: BlobRef, store: BlobStore): Promise<void> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(objectPath(orgId, projectId, ref), 600);
  if (error || !data) throw new Error(error?.message ?? 'no signed url');
  // Land in a staging name; only a verified hash earns the trusted name.
  const staged = store.stagingNameFor(ref);
  await store.disk.remove(staged);
  await store.disk.download(data.signedUrl, staged);
  const bytes = await store.disk.bytes(staged);
  const actual = await BlobStore.hashOf(bytes);
  if (actual !== ref.hash) {
    await store.disk.remove(staged);
    throw new Error(`hash mismatch for ${ref.hash}: got ${actual}`);
  }
  await store.commitStaged(ref, bytes.byteLength);
}
