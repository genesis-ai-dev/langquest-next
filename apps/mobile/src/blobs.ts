import type { BlobRef } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { webFiles, type WebFiles } from './webFiles';

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
 *
 * On the web there is no expo-file-system: files live in the browser's
 * origin private file system (webFiles.ts) under the same names, so a
 * recording that has not uploaded survives a reload, as it survives a
 * restart on a phone. Writes there commit whole, so no staging name is
 * needed. Playing one needs an object URL, made from its bytes on first
 * ask and kept for the most recent files.
 */
const DIR_NAME = 'blobs';
const STAGING_SUFFIX = '.part';

/** What the store needs to name a file; the unit is sync's concern, not disk's. MP3 is a source's chapter audio (sources/offline.ts), never a recording. */
export type BlobFile = { hash: string; format: BlobRef['format'] | 'mp3' };
/** A recording's file: always one of the formats the recorder makes. */
export type RecordingFile = Pick<BlobRef, 'hash' | 'format'>;

/**
 * Every kind of file the store keeps: recordings (wav, m4a), and the audio,
 * pictures and films of guides an organization writes (study@2, the guide
 * editor). The extension is part of the name, as for recordings.
 */
const STORED_FORMATS = ['wav', 'm4a', 'mp3', 'ogg', 'aac', 'jpg', 'png', 'webp', 'gif', 'mp4', 'webm'] as const;
export type StoredFormat = (typeof STORED_FORMATS)[number];
export type StoredFile = { hash: string; format: StoredFormat };

export function isStoredFormat(v: unknown): v is StoredFormat {
  return typeof v === 'string' && (STORED_FORMATS as readonly string[]).includes(v);
}

const WEB = Platform.OS === 'web';
const MIME: Record<StoredFormat, string> = {
  wav: 'audio/wav', m4a: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', aac: 'audio/aac',
  jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm'
};

/** The media type a stored file is uploaded and played as. */
export function mimeOf(format: StoredFormat): string {
  return MIME[format];
}
/** Object URLs kept for playback on the web, most recently used last. */
const URLS_KEPT = 64;
const nameOf = (ref: StoredFile) => `${ref.hash}.${ref.format}`;

export class BlobStore {
  /** Null on web, where `files` holds them instead. */
  private readonly dir: Directory | null;
  private readonly files: WebFiles | null;
  /** Web: object URLs for playback, and loads under way. */
  private readonly urls = new Map<string, string>();
  private readonly loading = new Set<string>();
  private readonly present = new Set<string>();
  private readonly sizeByHash = new Map<string, number>();
  /** The format each present file was stored as: its name's extension. */
  private readonly formatByHash = new Map<string, StoredFormat>();
  private listeners = new Set<() => void>();
  private urlListeners = new Set<() => void>();

  constructor(files: WebFiles | null = WEB ? webFiles(DIR_NAME) : null) {
    this.files = files;
    this.dir = files ? null : new Directory(Paths.document, DIR_NAME);
  }

  /** One listing at startup. Additive after that. */
  async init(): Promise<void> {
    if (this.files) {
      for (const { name, size } of await this.files.list()) {
        const [hash, ext] = name.split('.');
        if (hash) {
          this.present.add(hash);
          this.sizeByHash.set(hash, size);
          if (isStoredFormat(ext)) this.formatByHash.set(hash, ext);
        }
      }
      return;
    }
    if (!this.dir) return;
    if (!this.dir.exists) this.dir.create({ intermediates: true, idempotent: true });
    for (const entry of this.dir.list()) {
      if (entry instanceof File) {
        if (entry.name.endsWith(STAGING_SUFFIX)) {
          // An unfinished download from before the last exit. Never trusted.
          try { entry.delete(); } catch { /* retried next launch */ }
          continue;
        }
        const [hash, ext] = entry.name.split('.');
        if (hash) {
          this.present.add(hash);
          if (entry.size !== null) this.sizeByHash.set(hash, entry.size);
          if (isStoredFormat(ext)) this.formatByHash.set(hash, ext);
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

  /**
   * The format this file is stored as here, whatever the log says: a voice
   * note a browser recorded as WAV is `<hash>.wav` before any event says so
   * (decisions.md 73).
   */
  formatOf(hash: string): StoredFormat | undefined {
    return this.formatByHash.get(hash);
  }

  /** Its name here: a file this store holds keeps the format it was stored as. */
  private here(ref: StoredFile): StoredFile {
    const format = this.formatByHash.get(ref.hash);
    return format && format !== ref.format ? { hash: ref.hash, format } : ref;
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

  /** Whether this file is stored. On the web the index is the truth: it is marked only after a write commits. */
  exists(ref: StoredFile): boolean {
    return this.dir ? this.fileFor(ref).exists : this.present.has(ref.hash);
  }

  /** Its size as stored; ask `exists` first. */
  storedSize(ref: StoredFile): number {
    return this.dir ? this.fileFor(ref).size : this.sizeByHash.get(ref.hash) ?? 0;
  }

  /** Native only: the file on disk. */
  fileFor(ref: StoredFile): File {
    return new File(this.disk(), `${ref.hash}.${ref.format}`);
  }

  /** Native only: where a download lands before its bytes are verified. */
  stagingFor(ref: StoredFile): File {
    return new File(this.disk(), `${ref.hash}.${ref.format}${STAGING_SUFFIX}`);
  }

  /** Web only: the bytes to upload. */
  async readBytes(ref: StoredFile): Promise<Uint8Array<ArrayBuffer> | null> {
    return this.web().read(nameOf(this.here(ref)));
  }

  /** Web only: keep downloaded bytes the caller has verified against their hash. */
  async putVerified(ref: StoredFile, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    if (!this.present.has(ref.hash)) await this.web().write(nameOf(ref), bytes);
    this.markPresent(ref.hash, bytes.byteLength, ref.format);
  }

  private disk(): Directory {
    if (!this.dir) throw new Error('No expo-file-system on the web; files are in webFiles there.');
    return this.dir;
  }

  private web(): WebFiles {
    if (!this.files) throw new Error('webFiles is the web store only.');
    return this.files;
  }

  /**
   * Promote a verified staging file to its trusted name (an atomic rename on
   * the same volume) and index it. Callers verify first; this does not.
   */
  commitStaged(ref: StoredFile, size: number): void {
    const staged = this.stagingFor(ref);
    const dest = this.fileFor(ref);
    if (dest.exists) staged.delete();
    else staged.move(dest);
    this.markPresent(ref.hash, size, ref.format);
  }

  /**
   * Delete files from `evictable` until at least `minFreeBytes` is free on
   * the volume and the store holds at most `maxTotalBytes`. The caller
   * decides eligibility (core `evictableBlobs`); this only does the disk
   * work, largest first so the fewest files go.
   */
  reclaim(evictable: readonly StoredFile[], opts: { minFreeBytes: number; maxTotalBytes: number }): string[] {
    const removed: string[] = [];
    const bySize = [...evictable].sort((a, b) => (this.sizeOf(b.hash) ?? 0) - (this.sizeOf(a.hash) ?? 0));
    for (const ref of bySize) {
      // The browser reports no free space synchronously; on the web the total alone is bounded.
      const roomy = this.dir ? Paths.availableDiskSpace >= opts.minFreeBytes : true;
      if (roomy && this.totalBytes() <= opts.maxTotalBytes) break;
      if (!this.present.has(ref.hash)) continue;
      if (this.dir) {
        try {
          this.fileFor(ref).delete();
        } catch {
          continue;
        }
      } else {
        const url = this.urls.get(ref.hash);
        if (url) URL.revokeObjectURL(url);
        this.urls.delete(ref.hash);
        // Off the index now; if the delete is lost, the next start lists the file again, and its bytes still match its name.
        void this.web().remove(nameOf(ref)).catch(() => undefined);
      }
      this.present.delete(ref.hash);
      this.sizeByHash.delete(ref.hash);
      this.formatByHash.delete(ref.hash);
      removed.push(ref.hash);
    }
    if (removed.length) for (const l of this.listeners) l();
    return removed;
  }

  /**
   * Delete these files whatever the space: a source's audio whose license
   * no longer lets phones keep it, or one the sources cache evicts
   * (sources/offline.ts). Recordings never come through here.
   */
  remove(refs: readonly BlobFile[]): string[] {
    const removed: string[] = [];
    for (const ref of refs) {
      if (!this.present.has(ref.hash)) continue;
      if (this.dir) {
        try { this.fileFor(ref).delete(); } catch { continue; }
      } else {
        const url = this.urls.get(ref.hash);
        if (url) URL.revokeObjectURL(url);
        this.urls.delete(ref.hash);
        void this.web().remove(nameOf(ref)).catch(() => undefined);
      }
      this.present.delete(ref.hash);
      this.sizeByHash.delete(ref.hash);
      this.formatByHash.delete(ref.hash);
      removed.push(ref.hash);
    }
    if (removed.length) for (const l of this.listeners) l();
    return removed;
  }

  /**
   * Where to play it from. On the web the first ask starts reading the file
   * and answers null; listeners hear when its URL is ready, by which time a
   * screen that asked while drawing has it for the tap.
   */
  uriFor(asked: StoredFile): string | null {
    if (!this.present.has(asked.hash)) return null;
    if (this.dir) return this.fileFor(asked).uri;
    const ref = this.here(asked);
    const url = this.urls.get(ref.hash);
    if (url) {
      this.urls.delete(ref.hash);
      this.urls.set(ref.hash, url);
      return url;
    }
    if (!this.loading.has(ref.hash)) {
      this.loading.add(ref.hash);
      void this.web().read(nameOf(ref)).then((bytes) => {
        if (bytes) this.keepUrl(ref, bytes);
      }).catch(() => undefined).finally(() => this.loading.delete(ref.hash));
    }
    return null;
  }

  private keepUrl(ref: StoredFile, bytes: Uint8Array<ArrayBuffer>): void {
    if (!this.urls.has(ref.hash)) this.urls.set(ref.hash, URL.createObjectURL(new Blob([bytes], { type: MIME[ref.format] })));
    while (this.urls.size > URLS_KEPT) {
      const [oldest, url] = this.urls.entries().next().value!;
      URL.revokeObjectURL(url);
      this.urls.delete(oldest);
    }
    for (const l of this.urlListeners) l();
  }

  /** Web: hear when a file asked for by `uriFor` can be played, so the screen that asked draws again. */
  onUrlReady(l: () => void): () => void {
    this.urlListeners.add(l);
    return () => this.urlListeners.delete(l);
  }

  /**
   * Ingest a freshly recorded file: hash its bytes, move it to its
   * content-addressed name, and return the ref. Idempotent: the same bytes
   * land on the same name.
   */
  async ingest(sourceUri: string, format: BlobRef['format'], beforeMove?: (ref: RecordingFile, size: number) => Promise<void>): Promise<{ ref: RecordingFile; size: number }> {
    if (!this.dir) return this.ingestOnWeb(sourceUri, format, beforeMove);
    const src = new File(sourceUri);
    const bytes = await src.bytes();
    const hash = await BlobStore.hashOf(bytes);
    const ref: RecordingFile = { hash, format };
    const dest = this.fileFor(ref);
    await beforeMove?.(ref, bytes.byteLength);
    if (!dest.exists) src.move(dest);
    else src.delete();
    this.markPresent(hash, bytes.byteLength, format);
    return { ref, size: bytes.byteLength };
  }

  /** Web: the recorder hands over a blob: URL; read it, store the bytes under their hash, let the URL go. */
  private async ingestOnWeb(sourceUri: string, format: BlobRef['format'], beforeMove?: (ref: RecordingFile, size: number) => Promise<void>): Promise<{ ref: RecordingFile; size: number }> {
    const bytes = new Uint8Array(await (await fetch(sourceUri)).arrayBuffer());
    const hash = await BlobStore.hashOf(bytes);
    const ref: RecordingFile = { hash, format };
    await beforeMove?.(ref, bytes.byteLength);
    if (!this.present.has(hash)) await this.web().write(nameOf(ref), bytes);
    if (sourceUri.startsWith('blob:')) URL.revokeObjectURL(sourceUri);
    this.markPresent(hash, bytes.byteLength, format);
    this.keepUrl(ref, bytes);
    return { ref, size: bytes.byteLength };
  }

  /**
   * Keep bytes picked or made on this device (a picture, its phone copy, an
   * audio file for a guide): hashed first, so the name is trusted like a
   * recording's. Idempotent.
   */
  async ingestBytes(bytes: Uint8Array<ArrayBuffer>, format: StoredFormat): Promise<StoredFile & { size: number }> {
    const hash = await BlobStore.hashOf(bytes);
    const ref: StoredFile = { hash, format };
    if (this.files) {
      if (!this.present.has(hash)) await this.files.write(nameOf(ref), bytes);
      this.keepUrl(ref, bytes);
    } else {
      const dest = this.fileFor(ref);
      if (!dest.exists) {
        dest.create({ overwrite: true });
        dest.write(bytes);
      }
    }
    this.markPresent(hash, bytes.byteLength, format);
    return { ...ref, size: bytes.byteLength };
  }

  /** Called by the downloader once a file is on disk and verified. */
  markPresent(hash: string, size?: number, format?: StoredFormat): void {
    if (size !== undefined) this.sizeByHash.set(hash, size);
    if (this.present.has(hash)) return;
    if (format) this.formatByHash.set(hash, format);
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
