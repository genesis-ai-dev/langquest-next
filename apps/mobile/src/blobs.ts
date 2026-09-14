import type { BlobRef } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

/**
 * Content-addressed local blob store (PLAN.md section 14, rules 9 and 11).
 * The on-disk path is a pure function of the hash; no table maps names to
 * paths. The index is built from one directory listing at startup and kept
 * current additively by every writer. Nothing here deletes.
 */
const DIR_NAME = 'blobs';

export class BlobStore {
  private readonly dir: Directory;
  private readonly present = new Set<string>();
  private listeners = new Set<() => void>();

  constructor() {
    this.dir = new Directory(Paths.document, DIR_NAME);
  }

  /** One listing at startup. Additive after that. */
  async init(): Promise<void> {
    if (!this.dir.exists) this.dir.create({ intermediates: true, idempotent: true });
    for (const entry of this.dir.list()) {
      if (entry instanceof File) {
        const hash = entry.name.split('.')[0];
        if (hash) this.present.add(hash);
      }
    }
  }

  has(hash: string): boolean {
    return this.present.has(hash);
  }

  /** Snapshot of present hashes for work-list derivation. */
  snapshot(): ReadonlySet<string> {
    return new Set(this.present);
  }

  fileFor(ref: BlobRef): File {
    return new File(this.dir, `${ref.hash}.${ref.format}`);
  }

  uriFor(ref: BlobRef): string | null {
    return this.present.has(ref.hash) ? this.fileFor(ref).uri : null;
  }

  /**
   * Ingest a freshly recorded file: hash its bytes, move it to its
   * content-addressed name, and return the ref. Idempotent: the same bytes
   * land on the same name.
   */
  async ingest(sourceUri: string, format: BlobRef['format']): Promise<{ ref: BlobRef; size: number }> {
    const src = new File(sourceUri);
    const bytes = await src.bytes();
    const hash = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes).then(toHex);
    const ref: BlobRef = { hash, format };
    const dest = this.fileFor(ref);
    if (!dest.exists) src.move(dest);
    else src.delete();
    this.markPresent(hash);
    return { ref, size: bytes.byteLength };
  }

  /** Called by the downloader once a file is on disk. */
  markPresent(hash: string): void {
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
