// Files the guide editor adds: pictures, maps, films and audio picked in the
// browser, kept in the blob store by SHA-256 like recordings (blobs.ts), so
// a draft's media survive a reload and the published guide names them by
// hash. Pictures get a low-resolution copy made here (canvas, about 500px on
// the longest side, JPEG) for phones. Films are kept as they are: making a
// small copy in the browser would mean re-encoding in real time or a heavy
// library, so a film has no phone copy yet and the editor says so.
//
// Web only: a phone records step audio with the recorder and leaves big
// uploads to the web app. Uploading goes to the organization's guide files
// (`<org>/_org/<hash>.<ext>`), where study/media.ts fetches them.
import { ORG_STREAM, type MediaRef } from '@langquest-next/core';
import { Platform } from 'react-native';
import { getBlobStore, isStoredFormat, type StoredFile, type StoredFormat } from '../blobs';
import { uploadBlob } from '../blobTransport';
import { formatNumber } from '../i18n/format';
import { t } from '../i18n';
import type { StudyMediaKind } from '../study/guides';
import type { GuideDraft } from './draft';
import { draftFiles } from './draft';

/** Supabase Storage's limit for one file (supabase/config.toml). */
const MAX_BYTES = 50 * 1024 * 1024;
/** The phone copy's longest side, in pixels (core MediaRef: "pictures 500px"). */
const LOW_SIDE = 500;

export const canPickFiles = Platform.OS === 'web';

export type PickKind = 'image' | 'video' | 'audio';
const ACCEPT: Record<PickKind, string> = { image: 'image/jpeg,image/png,image/webp,image/gif', video: 'video/mp4,video/webm', audio: 'audio/*' };

const BY_TYPE: Record<string, StoredFormat> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
  'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/webm': 'webm'
};

/** The stored format of a picked file, from its media type or else its extension; null when the store cannot keep it. */
function formatOfFile(type: string, name: string): StoredFormat | null {
  const byType = BY_TYPE[type.toLowerCase()];
  if (byType) return byType;
  const ext = name.toLowerCase().split('.').pop()?.replace(/^jpeg$/, 'jpg');
  return isStoredFormat(ext) ? ext : null;
}

/** Ask the browser for one file. Null when the person closes the picker. */
export function pickFile(kind: PickKind): Promise<File | null> {
  if (!canPickFiles) return Promise.reject(new Error('Add files in the web app.'));
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT[kind];
    input.style.display = 'none';
    input.addEventListener('change', () => { resolve(input.files?.[0] ?? null); input.remove(); });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

/** A picture's size and its scale to fit the phone copy (never enlarged). */
function lowSize(width: number, height: number, side = LOW_SIDE): { width: number; height: number } {
  const scale = Math.min(1, side / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The phone copy of a picture: drawn on a canvas at most LOW_SIDE on its longest side, as JPEG. */
async function lowCopy(file: File): Promise<Uint8Array<ArrayBuffer>> {
  const bitmap = await createImageBitmap(file);
  const size = lowSize(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('This browser cannot make a smaller copy of the picture.');
  // JPEG has no transparency: a white ground, not black, under transparent PNGs.
  g.fillStyle = '#FFFFFF';
  g.fillRect(0, 0, size.width, size.height);
  g.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  if (!blob) throw new Error('This browser cannot make a smaller copy of the picture.');
  return bytesOf(blob);
}

/** How long an audio file plays, read by the browser; undefined if it cannot tell. */
function audioSeconds(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    const done = (s?: number) => { URL.revokeObjectURL(url); resolve(s); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : undefined);
    a.onerror = () => done(undefined);
    a.src = url;
  });
}

export class FileProblem extends Error {}

/**
 * Keep a picked file in the blob store and say how the guide names it: a
 * picture with its phone copy (`lowHash`), a film or an audio file as it is.
 */
export async function keepPicked(file: File, kind: PickKind): Promise<MediaRef> {
  if (file.size > MAX_BYTES) {
    throw new FileProblem(t('guides.files.tooBig', { size: formatNumber(Math.round(file.size / 1024 / 1024)), max: formatNumber(MAX_BYTES / 1024 / 1024) }));
  }
  const format = formatOfFile(file.type, file.name);
  if (!format) throw new FileProblem(t('guides.files.cannotKeep', { name: file.name }));
  const store = await getBlobStore();
  const original = await store.ingestBytes(await bytesOf(file), format);
  if (kind === 'image') {
    // A picture already small and JPEG is its own phone copy.
    const low = format === 'jpg' && file.size < 120_000 ? original : await store.ingestBytes(await lowCopy(file), 'jpg');
    return { hash: original.hash, lowHash: low.hash, format };
  }
  if (kind === 'audio') {
    const seconds = await audioSeconds(file);
    return { hash: original.hash, format, ...(seconds !== undefined ? { seconds: Math.round(seconds) } : {}) };
  }
  return { hash: original.hash, format };
}

/** The media kind a picked picture becomes in the guide: a map in the map panel, else a photo. */
export function mediaKindFor(kind: PickKind, panel: 'media' | 'map'): StudyMediaKind {
  if (kind === 'video') return 'video';
  return panel === 'map' ? 'map' : 'photo';
}

// ---- for any library material with audio or pictures (notes for translators, later) ----

/** A recording from the app's recorder (useRecorder / VoiceNote) as a MediaRef: it is already in the blob store. */
export function mediaFromRecording(card: { hash: string; format: StoredFormat; durationMs?: number }): MediaRef {
  return { hash: card.hash, format: card.format, ...(card.durationMs !== undefined ? { seconds: Math.round(card.durationMs / 1000) } : {}) };
}

/** Pick a file in the browser and keep it (web only): the MediaRef to put in a document, or null when the picker is closed. */
export async function pickMedia(kind: PickKind): Promise<MediaRef | null> {
  const file = await pickFile(kind);
  return file ? keepPicked(file, kind) : null;
}

/** The stored files a MediaRef names: the original and, for a picture or film, its phone copy. */
function storedFilesOfMedia(m: MediaRef, kind: PickKind): StoredFile[] {
  const out: StoredFile[] = [];
  const fallback: StoredFormat = kind === 'audio' ? 'm4a' : kind === 'video' ? 'mp4' : 'jpg';
  if (m.hash) out.push({ hash: m.hash, format: isStoredFormat(m.format) ? m.format : fallback });
  if (m.lowHash && m.lowHash !== m.hash) out.push({ hash: m.lowHash, format: kind === 'video' ? 'mp4' : 'jpg' });
  return out;
}

/**
 * Upload what a MediaRef names to the organization's library files
 * (`<org>/_org/<hash>.<ext>`, where study/media.ts fetches them), before
 * publishing the document that names it. Files not on this device are
 * skipped: whoever added them uploaded them. Safe to repeat.
 */
export async function uploadMedia(orgId: string, m: MediaRef, kind: PickKind): Promise<void> {
  const store = await getBlobStore();
  for (const f of storedFilesOfMedia(m, kind)) if (store.has(f.hash)) await uploadBlob(orgId, ORG_STREAM, f, store);
}

/** The stored name of each file the draft's document names (phone copies are always JPEG pictures or MP4 films). */
function storedFilesOf(d: GuideDraft): StoredFile[] {
  const out = new Map<string, StoredFile>();
  for (const f of draftFiles(d)) {
    const fallback: StoredFormat = f.kind === 'audio' ? 'm4a' : f.kind === 'video' ? 'mp4' : 'jpg';
    const format = !f.low && isStoredFormat(f.format) ? f.format : fallback;
    out.set(f.hash, { hash: f.hash, format });
  }
  return [...out.values()];
}

/**
 * Upload every file of the draft that is on this device to the
 * organization's guide files. Content-addressed and upserted, so uploading
 * again is harmless; a file not on this device was uploaded by whoever added
 * it. Returns how many were sent.
 */
export async function uploadDraftFiles(orgId: string, d: GuideDraft, onProgress?: (done: number, total: number) => void): Promise<number> {
  const store = await getBlobStore();
  const here = storedFilesOf(d).filter((f) => store.has(f.hash));
  let done = 0;
  for (const f of here) {
    onProgress?.(done, here.length);
    await uploadBlob(orgId, ORG_STREAM, f, store);
    done++;
  }
  onProgress?.(done, here.length);
  return done;
}
