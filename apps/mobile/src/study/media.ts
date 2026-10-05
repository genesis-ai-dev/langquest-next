// Where a guide's audio or picture plays from (study@2): a file in the blob
// store by SHA-256, kept on the device like a recording so it works offline,
// or a URL elsewhere (FIA's). A file not on the device yet is fetched once
// from the organization's guide files (`<org>/_org/<hash>.<ext>`, where the
// guide editor puts them); until it arrives, or if it cannot, the URL stands
// in when there is one.
import { ORG_PARTITION } from '@langquest-next/core';
import { useEffect, useState } from 'react';
import { getBlobStore, isStoredFormat, type BlobStore, type StoredFile } from '../blobs';
import { downloadBlob } from '../blobTransport';
import { noteExpected } from '../report';
import type { StudyFile } from './guides';

/** Downloads under way, by hash, so two screens asking for one file fetch it once. */
const inflight = new Map<string, Promise<void>>();
/** Hashes that could not be fetched, and when: tried again after a minute. */
const failedAt = new Map<string, number>();
const RETRY_MS = 60_000;

/** The blob store's name for a guide file, or null when its format is not one the store keeps. */
export function storedFileOf(file: StudyFile | undefined): StoredFile | null {
  return file && isStoredFormat(file.format) ? { hash: file.hash, format: file.format } : null;
}

/** Fetch a guide file into the blob store from the organization's guide files. */
export function fetchGuideFile(orgId: string, ref: StoredFile, store: BlobStore): Promise<void> {
  const last = failedAt.get(ref.hash);
  if (last && Date.now() - last < RETRY_MS) return Promise.reject(new Error('Not available yet.'));
  let p = inflight.get(ref.hash);
  if (!p) {
    p = downloadBlob(orgId, ORG_PARTITION, ref, store)
      .catch((e: unknown) => { failedAt.set(ref.hash, Date.now()); throw e; })
      .finally(() => inflight.delete(ref.hash));
    inflight.set(ref.hash, p);
  }
  return p;
}

/**
 * The URI to play or show: the stored file when it is on the device (asking
 * the server for it once), else the URL. `waiting` while a stored file is
 * being read or fetched and there is no URL to use meanwhile.
 */
export function useStudyFileUri(orgId: string | null | undefined, file: StudyFile | undefined, url: string | undefined): { uri: string | undefined; waiting: boolean } {
  const ref = storedFileOf(file);
  const [store, setStore] = useState<BlobStore | null>(null);
  const [, bump] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!ref) return;
    let live = true;
    let off: (() => void)[] = [];
    void getBlobStore().then((s) => {
      if (!live) return;
      setStore(s);
      const redraw = () => bump((n) => n + 1);
      off = [s.onChange(redraw), s.onUrlReady(redraw)];
    }).catch((e: unknown) => noteExpected('guide file: store', e));
    return () => { live = false; off.forEach((f) => f()); };
  }, [ref?.hash]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setFailed(false);
    if (!ref || !store || store.has(ref.hash) || !orgId) return;
    let live = true;
    fetchGuideFile(orgId, ref, store).catch((e: unknown) => {
      // Offline, or a file another organization keeps: the URL (or a stand-in) is shown instead.
      noteExpected('guide file: fetch', e);
      if (live) setFailed(true);
    });
    return () => { live = false; };
  }, [store, ref?.hash, orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ref) return { uri: url, waiting: false };
  const local = store?.has(ref.hash) ? store.uriFor(ref) : null;
  if (local) return { uri: local, waiting: false };
  return { uri: url, waiting: !url && !failed };
}
