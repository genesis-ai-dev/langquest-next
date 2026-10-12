import type { FileLedger, LostFile } from '@langquest-next/client';
import type { BlobRef } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { readDirectoryAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { getFileLedger } from './store';
import { onWake } from './wake';
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
 * Some phones claim more storage than they have and delete files behind
 * the app's back (decisions.md 87). So every file kept is also written down
 * in a ledger (`FileLedger`), and the folder is compared with it: at
 * startup against the ledger, and while the app is in use against the index,
 * when new files arrive or the app comes back on screen, at most every
 * `RECHECK_MS`. A file the store deletes itself is crossed out of the ledger
 * before it is deleted, so a crash between the two can never look like a
 * loss. What is found missing is taken off the index (so kept passages
 * download it again) and kept as lost until someone has seen the alert.
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
/** While the app is in use, the folder is listed again at most this often. */
const RECHECK_MS = 10 * 60 * 1000;
/** New files are written down together, this long after the first of them. */
const KEEP_DELAY_MS = 1000;
/** Missing files checked one by one before a listing is believed: a listing that is wrong about one of these is not trusted. */
const SPOT_CHECKS = 100;

/** A file name in the folder as hash and extension; staging names and strays are not files of the store. */
function parseName(name: string): StoredFile | null {
  if (name.endsWith(STAGING_SUFFIX)) return null;
  const [hash, ext, more] = name.split('.');
  return hash && isStoredFormat(ext) && more === undefined ? { hash, format: ext } : null;
}

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
  private lostListeners = new Set<() => void>();
  private readonly ledger: Promise<FileLedger | null>;
  /** Ledger work, one piece at a time, so a check never sees half a removal. */
  private chain: Promise<void> = Promise.resolve();
  /** Arrived and not yet written down. */
  private readonly toKeep = new Map<string, StoredFormat>();
  private keepTimer: ReturnType<typeof setTimeout> | null = null;
  /** Off the index, not yet deleted from disk: never counted as lost. */
  private readonly removing = new Set<string>();
  /** Files that arrived while the folder was being listed: missing from that listing for a good reason. */
  private arrivedDuringListing: Set<string> | null = null;
  private lastCheck = 0;

  constructor(files: WebFiles | null = WEB ? webFiles(DIR_NAME) : null, ledger: Promise<FileLedger | null> | FileLedger | null = null) {
    this.files = files;
    this.dir = files ? null : new Directory(Paths.document, DIR_NAME);
    // A ledger that will not open costs the alert, never the store.
    this.ledger = Promise.resolve(ledger).catch(() => null);
  }

  /** One listing at startup. Additive after that, apart from the checks for lost files. */
  async init(): Promise<void> {
    await this.listAll();
    this.lastCheck = Date.now();
    this.enqueue(() => this.compareWithLedger());
  }

  private async listAll(): Promise<void> {
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
   * (decisions.md 77).
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
   * work, largest first so the fewest files go. What to free is worked out
   * once, up front: the files themselves go a moment later (`discard`).
   */
  reclaim(evictable: readonly StoredFile[], opts: { minFreeBytes: number; maxTotalBytes: number }): string[] {
    // The browser reports no free space synchronously; on the web the total alone is bounded.
    const short = this.dir ? opts.minFreeBytes - Paths.availableDiskSpace : 0;
    let toFree = Math.max(short, this.totalBytes() - opts.maxTotalBytes);
    if (toFree <= 0) return [];
    const bySize = [...evictable].sort((a, b) => (this.sizeOf(b.hash) ?? 0) - (this.sizeOf(a.hash) ?? 0));
    const chosen = new Map<string, StoredFile>();
    for (const ref of bySize) {
      if (toFree <= 0) break;
      if (!this.present.has(ref.hash) || chosen.has(ref.hash)) continue;
      chosen.set(ref.hash, ref);
      toFree -= this.sizeOf(ref.hash) ?? 0;
    }
    return this.discard([...chosen.values()]);
  }

  /**
   * Delete these files whatever the space: a source's audio whose license
   * no longer lets phones keep it, or one the sources cache evicts
   * (sources/offline.ts). Recordings never come through here.
   */
  remove(refs: readonly BlobFile[]): string[] {
    return this.discard(refs);
  }

  /**
   * Take files off the index now; then cross them out of the ledger, and
   * only then delete them, so a crash in between leaves a stray file (listed
   * and kept again at the next start) rather than a false alarm.
   */
  private discard(refs: readonly StoredFile[]): string[] {
    const gone: StoredFile[] = [];
    for (const ref of refs) {
      if (!this.present.has(ref.hash) || this.removing.has(ref.hash)) continue;
      // By the name it is stored under, which the index forgets next.
      gone.push(this.here(ref));
      this.unindex(ref.hash);
      this.removing.add(ref.hash);
      this.toKeep.delete(ref.hash);
    }
    if (gone.length === 0) return [];
    this.enqueue(async () => {
      await (await this.ledger)?.forget(gone.map((r) => r.hash)).catch(() => undefined);
      for (const ref of gone) {
        // Downloaded again while waiting: the file on disk is the same bytes, so it stays.
        if (this.present.has(ref.hash)) this.queueKeep(ref.hash, this.formatByHash.get(ref.hash) ?? ref.format);
        else if (this.dir) { try { this.fileFor(ref).delete(); } catch { /* listed and kept again at the next start */ } }
        else await this.web().remove(nameOf(ref)).catch(() => undefined);
        this.removing.delete(ref.hash);
      }
    });
    for (const l of this.listeners) l();
    return gone.map((r) => r.hash);
  }

  /** Off the index: not present, no size, no format, no playback URL. */
  private unindex(hash: string): void {
    this.present.delete(hash);
    this.sizeByHash.delete(hash);
    this.formatByHash.delete(hash);
    const url = this.urls.get(hash);
    if (url) URL.revokeObjectURL(url);
    this.urls.delete(hash);
  }

  // ---- lost files (decisions.md 87) ----

  /** Ledger work runs in order; a failure is dropped, and the next check tries again. */
  private enqueue(work: () => Promise<void>): void {
    this.chain = this.chain.then(work).catch(() => undefined);
  }

  /** Write down a file that just arrived, with others that arrive soon after. */
  private queueKeep(hash: string, format: StoredFormat): void {
    this.toKeep.set(hash, format);
    if (this.keepTimer) return;
    this.keepTimer = setTimeout(() => this.flushKeeps(), KEEP_DELAY_MS);
  }

  private flushKeeps(): void {
    if (this.keepTimer) clearTimeout(this.keepTimer);
    this.keepTimer = null;
    this.enqueue(async () => {
      const files = [...this.toKeep].map(([hash, format]) => ({ hash, format }));
      this.toKeep.clear();
      await (await this.ledger)?.keep(files);
    });
  }

  /**
   * At startup: files the ledger says were kept that the listing did not
   * find went while the app was closed. Files on disk the ledger lacks are
   * written down (everything, the first time a phone runs this).
   */
  private async compareWithLedger(): Promise<void> {
    const ledger = await this.ledger;
    if (!ledger) return;
    const kept = await ledger.kept();
    const missing: StoredFile[] = [];
    for (const [hash, format] of kept) {
      if (!this.present.has(hash) && !this.removing.has(hash) && isStoredFormat(format)) missing.push({ hash, format });
    }
    const fresh: StoredFile[] = [];
    for (const hash of this.present) {
      const format = this.formatByHash.get(hash);
      if (format && !kept.has(hash) && !this.toKeep.has(hash)) fresh.push({ hash, format });
    }
    if (fresh.length) await ledger.keep(fresh);
    if (missing.length && this.believable(missing)) await this.lose(ledger, missing.map((r) => r.hash));
  }

  /**
   * While the app is in use: list the folder again and compare it with the
   * index. Names only, read off the JS thread on a phone; the ledger is
   * written only when something is missing. At most every `RECHECK_MS`
   * unless `now`.
   */
  recheck(now = false): void {
    if (!now && Date.now() - this.lastCheck < RECHECK_MS) return;
    this.lastCheck = Date.now();
    this.enqueue(async () => {
      const arrived = new Set<string>();
      this.arrivedDuringListing = arrived;
      let names: string[];
      try {
        names = await this.listNames();
      } finally {
        this.arrivedDuringListing = null;
      }
      const listed = new Set<string>();
      for (const name of names) { const f = parseName(name); if (f) listed.add(f.hash); }
      const missing: StoredFile[] = [];
      for (const hash of this.present) {
        if (listed.has(hash) || arrived.has(hash) || this.removing.has(hash)) continue;
        const format = this.formatByHash.get(hash);
        if (format) missing.push({ hash, format });
      }
      if (missing.length === 0 || !this.believable(missing)) return;
      for (const ref of missing) { this.unindex(ref.hash); this.toKeep.delete(ref.hash); }
      for (const l of this.listeners) l();
      const ledger = await this.ledger;
      if (ledger) await this.lose(ledger, missing.map((r) => r.hash));
    });
  }

  /** Every name in the folder. On a phone, one native call that returns strings, off the JS thread. */
  private async listNames(): Promise<string[]> {
    if (!this.dir) return (await this.web().list()).map((f) => f.name);
    try {
      return await readDirectoryAsync(this.dir.uri);
    } catch (e) {
      // The whole folder gone is the worst loss of all, not a failed check.
      if (this.dir.exists) throw e;
      this.dir.create({ intermediates: true, idempotent: true });
      return [];
    }
  }

  /**
   * A listing says these are gone; ask the disk about some of them one by
   * one before believing it. If any is there after all, the listing was
   * wrong and nothing is reported (the next check looks again).
   */
  private believable(missing: readonly StoredFile[]): boolean {
    if (!this.dir) return true;
    for (const ref of missing.slice(0, SPOT_CHECKS)) {
      try { if (this.fileFor(ref).exists) return false; } catch { return false; }
    }
    return true;
  }

  private async lose(ledger: FileLedger, hashes: readonly string[]): Promise<void> {
    await ledger.markLost(hashes, Date.now());
    for (const l of this.lostListeners) l();
  }

  /** Write down what is waiting now, and resolve once every piece of ledger work so far has finished. */
  async settle(): Promise<void> {
    if (this.keepTimer) this.flushKeeps();
    await this.chain;
  }

  /** Files lost that nobody has seen the alert for yet, oldest first. */
  async lostFiles(): Promise<LostFile[]> {
    return (await (await this.ledger)?.lost()) ?? [];
  }

  /** The alert for these was seen. */
  async lostSeen(hashes: readonly string[]): Promise<void> {
    await (await this.ledger)?.clearLost(hashes);
    for (const l of this.lostListeners) l();
  }

  /** Hear when files are found lost, or the alert for them was seen. */
  onLost(l: () => void): () => void {
    this.lostListeners.add(l);
    return () => this.lostListeners.delete(l);
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
    this.arrivedDuringListing?.add(hash);
    const stored = this.formatByHash.get(hash);
    if (stored) this.queueKeep(hash, stored);
    for (const l of this.listeners) l();
    // New files are what fill a phone that has less room than it says: look again now and then.
    this.recheck();
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

let store: Promise<BlobStore> | undefined;
/** The device's one store, opened and listed once; it checks for lost files when the app comes back on screen. */
export function getBlobStore(): Promise<BlobStore> {
  store ??= (async () => {
    const s = new BlobStore(undefined, getFileLedger());
    await s.init();
    onWake(() => s.recheck());
    return s;
  })().catch((e: unknown) => { store = undefined; throw e; });
  return store;
}
