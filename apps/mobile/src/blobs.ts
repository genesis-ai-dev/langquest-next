import type { BlobRef } from '@langquest-next/core';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { hashChunks } from './sha256';

/**
 * Content-addressed local blob store (PLAN.md section 14, rules 9 and 11).
 * The on-disk path is a pure function of the hash; no table maps names to
 * paths. The index is built from one directory listing at startup and kept
 * current additively by every writer.
 *
 * A file at its final name is trusted because only two writers create one,
 * and both hash first: `ingest` hashes before naming, and downloads land in
 * a `.part` staging name that is renamed only after its hash matches.
 * Startup discards leftover staging files, so an interrupted download can
 * never be mistaken for a verified one. Deletion happens only in `reclaim`,
 * and only for files the caller has proven the server can give back.
 */
const DIR_NAME = 'blobs';
const STAGING_SUFFIX = '.part';

/** What the store needs to name a file; the unit is sync's concern, not disk's. */
export type BlobFile = Pick<BlobRef, 'hash' | 'format'>;

export class BlobStore {
  private readonly dir: Directory;
  private readonly present = new Set<string>();
  private readonly sizeByHash = new Map<string, number>();
  private listeners = new Set<() => void>();

  constructor() {
    this.dir = new Directory(Paths.document, DIR_NAME);
  }

  /** One listing at startup. Additive after that. */
  async init(): Promise<void> {
    if (!this.dir.exists) this.dir.create({ intermediates: true, idempotent: true });
    for (const entry of this.dir.list()) {
      if (entry instanceof File) {
        if (entry.name.endsWith(STAGING_SUFFIX)) {
          // An unfinished download from before the last exit. Never trusted.
          try { entry.delete(); } catch { /* retried next launch */ }
          continue;
        }
        const hash = entry.name.split('.')[0];
        if (hash) {
          this.present.add(hash);
          if (entry.size !== null) this.sizeByHash.set(hash, entry.size);
        }
      }
    }
  }

  /** Byte sizes of present files, for the size check against confirmations. */
  sizes(): ReadonlyMap<string, number> {
    return new Map(this.sizeByHash);
  }

  sizeOf(hash: string): number | undefined {
    return this.sizeByHash.get(hash);
  }

  /** Bytes on disk across every present file. */
  totalBytes(): number {
    let total = 0;
    for (const n of this.sizeByHash.values()) total += n;
    return total;
  }

  /**
   * SHA-256 hex of a file's bytes (the name it must have to be trusted) and
   * its size. Read in bounded chunks, so the file never sits whole in the JS
   * heap; peak memory is one chunk whatever the file's size.
   */
  static async hashFile(file: File): Promise<{ hash: string; size: number }> {
    const handle = file.open(FileMode.ReadOnly);
    try {
      return await hashChunks((max) => handle.readBytes(max));
    } finally {
      handle.close();
    }
  }

  has(hash: string): boolean {
    return this.present.has(hash);
  }

  /** Snapshot of present hashes for work-list derivation. */
  snapshot(): ReadonlySet<string> {
    return new Set(this.present);
  }

  fileFor(ref: BlobFile): File {
    return new File(this.dir, `${ref.hash}.${ref.format}`);
  }

  /** Where a download lands before its bytes are verified. */
  stagingFor(ref: BlobFile): File {
    return new File(this.dir, `${ref.hash}.${ref.format}${STAGING_SUFFIX}`);
  }

  /**
   * Promote a verified staging file to its trusted name (an atomic rename on
   * the same volume) and index it. Callers verify first; this does not.
   */
  commitStaged(ref: BlobFile, size: number): void {
    const staged = this.stagingFor(ref);
    const dest = this.fileFor(ref);
    if (dest.exists) staged.delete();
    else staged.move(dest);
    this.markPresent(ref.hash, size);
  }

  /**
   * Delete files from `evictable` until at least `minFreeBytes` is free on
   * the volume and the store holds at most `maxTotalBytes`. The caller
   * decides eligibility (core `evictableBlobs`); this only does the disk
   * work, largest first so the fewest files go.
   */
  reclaim(evictable: readonly BlobFile[], opts: { minFreeBytes: number; maxTotalBytes: number }): string[] {
    const removed: string[] = [];
    const bySize = [...evictable].sort((a, b) => (this.sizeOf(b.hash) ?? 0) - (this.sizeOf(a.hash) ?? 0));
    for (const ref of bySize) {
      if (Paths.availableDiskSpace >= opts.minFreeBytes && this.totalBytes() <= opts.maxTotalBytes) break;
      if (!this.present.has(ref.hash)) continue;
      try {
        this.fileFor(ref).delete();
      } catch {
        continue;
      }
      this.present.delete(ref.hash);
      this.sizeByHash.delete(ref.hash);
      removed.push(ref.hash);
    }
    if (removed.length) for (const l of this.listeners) l();
    return removed;
  }

  uriFor(ref: BlobFile): string | null {
    return this.present.has(ref.hash) ? this.fileFor(ref).uri : null;
  }

  /**
   * Ingest a freshly recorded file: hash its bytes, move it to its
   * content-addressed name, and return the ref. Idempotent: the same bytes
   * land on the same name.
   */
  async ingest(sourceUri: string, format: BlobRef['format'], beforeMove?: (ref: BlobFile, size: number) => Promise<void>): Promise<{ ref: BlobFile; size: number }> {
    const src = new File(sourceUri);
    const { hash, size } = await BlobStore.hashFile(src);
    const ref: BlobFile = { hash, format };
    const dest = this.fileFor(ref);
    await beforeMove?.(ref, size);
    if (!dest.exists) src.move(dest);
    else src.delete();
    this.markPresent(hash, size);
    return { ref, size };
  }

  /** Called by the downloader once a file is on disk and verified. */
  markPresent(hash: string, size?: number): void {
    if (size !== undefined) this.sizeByHash.set(hash, size);
    if (this.present.has(hash)) return;
    this.present.add(hash);
    for (const l of this.listeners) l();
  }

  onChange(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

let store: BlobStore | undefined;
export async function getBlobStore(): Promise<BlobStore> {
  if (!store) {
    store = new BlobStore();
    await store.init();
  }
  return store;
}
