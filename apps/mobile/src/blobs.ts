import type { BlobRef } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { blobDisk } from './disk';
import type { BlobDisk } from './diskTypes';

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
const STAGING_SUFFIX = '.part';

/** What the store needs to name a file; the unit is sync's concern, not disk's. */
export type BlobFile = Pick<BlobRef, 'hash' | 'format'>;

export class BlobStore {
  private readonly present = new Set<string>();
  private readonly sizeByHash = new Map<string, number>();
  private listeners = new Set<() => void>();
  /** Disk mutations run one at a time, as they did when they were synchronous. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly disk: BlobDisk = blobDisk) {}

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }

  /** One listing at startup. Additive after that. */
  async init(): Promise<void> {
    for (const entry of await this.disk.list()) {
      if (entry.name.endsWith(STAGING_SUFFIX)) {
        // An unfinished download from before the last exit. Never trusted.
        try { await this.disk.remove(entry.name); } catch { /* retried next launch */ }
        continue;
      }
      const hash = entry.name.split('.')[0];
      if (hash) {
        this.present.add(hash);
        if (entry.size !== null) this.sizeByHash.set(hash, entry.size);
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

  /** SHA-256 hex of bytes: the name a file must have to be trusted. */
  static async hashOf(bytes: Uint8Array): Promise<string> {
    // expo-crypto wants a plain ArrayBuffer-backed view.
    const view = new Uint8Array(bytes.byteLength);
    view.set(bytes);
    return Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, view).then(toHex);
  }

  has(hash: string): boolean {
    return this.present.has(hash);
  }

  /** Snapshot of present hashes for work-list derivation. */
  snapshot(): ReadonlySet<string> {
    return new Set(this.present);
  }

  nameFor(ref: BlobFile): string {
    return `${ref.hash}.${ref.format}`;
  }

  /** Where a download lands before its bytes are verified. */
  stagingNameFor(ref: BlobFile): string {
    return `${ref.hash}.${ref.format}${STAGING_SUFFIX}`;
  }

  /**
   * Promote a verified staging file to its trusted name (an atomic rename on
   * the same volume) and index it. Callers verify first; this does not.
   */
  commitStaged(ref: BlobFile, size: number): Promise<void> {
    return this.serial(async () => {
      const staged = this.stagingNameFor(ref);
      const dest = this.nameFor(ref);
      if (await this.disk.exists(dest)) await this.disk.remove(staged);
      else await this.disk.rename(staged, dest);
      this.markPresent(ref.hash, size);
    });
  }

  /**
   * Delete files from `evictable` until at least `minFreeBytes` is free on
   * the volume and the store holds at most `maxTotalBytes`. The caller
   * decides eligibility (core `evictableBlobs`); this only does the disk
   * work, largest first so the fewest files go.
   */
  reclaim(evictable: readonly BlobFile[], opts: { minFreeBytes: number; maxTotalBytes: number }): Promise<string[]> {
    return this.serial(async () => {
      const removed: string[] = [];
      const bySize = [...evictable].sort((a, b) => (this.sizeOf(b.hash) ?? 0) - (this.sizeOf(a.hash) ?? 0));
      for (const ref of bySize) {
        if (await this.disk.freeBytes() >= opts.minFreeBytes && this.totalBytes() <= opts.maxTotalBytes) break;
        if (!this.present.has(ref.hash)) continue;
        try {
          await this.disk.remove(this.nameFor(ref));
        } catch {
          continue;
        }
        this.present.delete(ref.hash);
        this.sizeByHash.delete(ref.hash);
        removed.push(ref.hash);
      }
      if (removed.length) for (const l of this.listeners) l();
      return removed;
    });
  }

  uriFor(ref: BlobFile): string | null {
    return this.present.has(ref.hash) ? this.disk.uri(this.nameFor(ref)) : null;
  }

  /**
   * Ingest a freshly recorded file: hash its bytes, move it to its
   * content-addressed name, and return the ref. Idempotent: the same bytes
   * land on the same name.
   */
  async ingest(sourceUri: string, format: BlobRef['format'], beforeMove?: (ref: BlobFile, size: number) => Promise<void>): Promise<{ ref: BlobFile; size: number }> {
    const bytes = await this.disk.sourceBytes(sourceUri);
    const hash = await BlobStore.hashOf(bytes);
    const ref: BlobFile = { hash, format };
    const dest = this.nameFor(ref);
    await beforeMove?.(ref, bytes.byteLength);
    await this.serial(async () => {
      if (!await this.disk.exists(dest)) await this.disk.adopt(sourceUri, dest, bytes);
      else await this.disk.discardSource(sourceUri);
      this.markPresent(hash, bytes.byteLength);
    });
    return { ref, size: bytes.byteLength };
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

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

let store: BlobStore | undefined;
export async function getBlobStore(): Promise<BlobStore> {
  if (!store) {
    store = new BlobStore();
    await store.init();
  }
  return store;
}
