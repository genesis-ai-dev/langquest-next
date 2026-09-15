import type { BlobRef } from '@langquest-next/core';
import { File } from 'expo-file-system';
import { BlobStore } from './blobs';
import { supabase } from './supabase';

/**
 * Blob transfers over Supabase Storage. Upload is an idempotent upsert of a
 * content-addressed object (rule 2). The server's storage trigger appends
 * v1.BlobStored; the device learns of it through the normal pull.
 */
const BUCKET = 'blobs';

export function objectPath(orgId: string, projectId: string, ref: BlobRef): string {
  return `${orgId}/${projectId}/${ref.hash}.${ref.format}`;
}

export async function uploadBlob(orgId: string, projectId: string, ref: BlobRef, store: BlobStore): Promise<void> {
  const file = store.fileFor(ref);
  const bytes = await file.bytes();
  const { error } = await supabase.storage.from(BUCKET).upload(objectPath(orgId, projectId, ref), bytes, {
    upsert: true,
    contentType: ref.format === 'wav' ? 'audio/wav' : 'audio/mp4'
  });
  if (error) throw new Error(error.message);
}

export async function downloadBlob(orgId: string, projectId: string, ref: BlobRef, store: BlobStore): Promise<void> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(objectPath(orgId, projectId, ref), 600);
  if (error || !data) throw new Error(error?.message ?? 'no signed url');
  const dest = store.fileFor(ref);
  // A file already on disk but not in the index is a previous download that
  // never finished verification (partial or corrupt). Verify before trusting.
  if (!dest.exists) await File.downloadFileAsync(data.signedUrl, dest);
  const bytes = await dest.bytes();
  const actual = await BlobStore.hashOf(bytes);
  if (actual !== ref.hash) {
    dest.delete();
    throw new Error(`hash mismatch for ${ref.hash}: got ${actual}`);
  }
  store.markPresent(ref.hash, bytes.byteLength);
}
