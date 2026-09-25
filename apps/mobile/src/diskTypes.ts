/**
 * The disk under the content-addressed blob store (blobs.ts). `disk.ts`
 * implements it with expo-file-system; `disk.web.ts` with the browser's
 * origin-private file system, where web is a test target. Names are file
 * names inside the store's one directory; URIs point outside it.
 */
export interface BlobDisk {
  /** Every file in the store's directory, creating the directory if missing. */
  list(): Promise<{ name: string; size: number | null }[]>;
  exists(name: string): Promise<boolean>;
  /** Idempotent. */
  remove(name: string): Promise<void>;
  /** Atomic on the same volume. */
  rename(from: string, to: string): Promise<void>;
  bytes(name: string): Promise<Uint8Array>;
  /** Playable URI of a stored file. Synchronous: screens render from it. */
  uri(name: string): string;
  /** Bytes of a file outside the store: a fresh recording, photo, or render. */
  sourceBytes(uri: string): Promise<Uint8Array>;
  /** Take an outside file into the store under `name`. `bytes` is its content, already read. */
  adopt(uri: string, name: string, bytes: Uint8Array): Promise<void>;
  /** Drop an outside file the store already holds a copy of. */
  discardSource(uri: string): Promise<void>;
  download(url: string, name: string): Promise<void>;
  upload(name: string, url: string, headers: Record<string, string>): Promise<{ status: number; body: string }>;
  freeBytes(): Promise<number>;
}
