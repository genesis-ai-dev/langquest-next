/**
 * Files on the web, in the origin private file system (OPFS): what
 * expo-file-system is to a phone, for the few stores that need it (audio,
 * library documents). Each store gets its own directory under `langquest/`,
 * apart from expo-sqlite's `expo-sqlite/` pool, and uses the async API, so it
 * never contends with the database's exclusive handles. A write lands through
 * a writable stream, which the browser commits whole on close, so a reload
 * mid-write leaves the old file or none, never half of one.
 *
 * No React Native imports: the stores pass a root in tests.
 */
export interface WebFiles {
  list(): Promise<{ name: string; size: number }[]>;
  read(name: string): Promise<Uint8Array<ArrayBuffer> | null>;
  write(name: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  remove(name: string): Promise<void>;
  /** Remove every file in this directory (signing out on a shared computer). */
  clear(): Promise<void>;
}

/** The parts of the File System Access API these stores use, so tests can fake them. */
interface DirHandle {
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandle>;
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterable<[string, { kind: 'file' | 'directory' }]>;
}
interface FileHandle {
  getFile(): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable(): Promise<{ write(data: Uint8Array<ArrayBuffer>): Promise<void>; close(): Promise<void> }>;
}

const ROOT_DIR = 'langquest';

function browserRoot(): Promise<DirHandle> {
  return navigator.storage.getDirectory() as unknown as Promise<DirHandle>;
}

const notFound = (e: unknown) => e instanceof Error && e.name === 'NotFoundError';

export function webFiles(path: string, root: () => Promise<DirHandle> = browserRoot): WebFiles {
  let dir: Promise<DirHandle> | null = null;
  const open = () => (dir ??= root().then((r) => r.getDirectoryHandle(ROOT_DIR, { create: true })).then((r) => r.getDirectoryHandle(path, { create: true })));
  return {
    async list() {
      const d = await open();
      const out: { name: string; size: number }[] = [];
      for await (const [name, entry] of d.entries()) {
        if (entry.kind !== 'file') continue;
        out.push({ name, size: (await (await d.getFileHandle(name)).getFile()).size });
      }
      return out;
    },
    async read(name) {
      try {
        const file = await (await (await open()).getFileHandle(name)).getFile();
        return new Uint8Array(await file.arrayBuffer());
      } catch (e) {
        if (notFound(e)) return null;
        throw e;
      }
    },
    async write(name, bytes) {
      const w = await (await (await open()).getFileHandle(name, { create: true })).createWritable();
      await w.write(bytes);
      await w.close();
    },
    async remove(name) {
      try {
        await (await open()).removeEntry(name);
      } catch (e) {
        if (!notFound(e)) throw e;
      }
    },
    async clear() {
      const d = await open();
      const names: string[] = [];
      for await (const [name] of d.entries()) names.push(name);
      for (const name of names) await d.removeEntry(name, { recursive: true });
    }
  };
}

/**
 * A write in the directory is open, or is opening or closing as the removal
 * runs: the browser refuses the whole removal, as NoModificationAllowedError
 * while the write is open and as InvalidModificationError when the two cross
 * (Chrome, measured 2026-10-15: about 1 removal in 25 under steady downloads).
 */
const writeInTheWay = (e: unknown) => e instanceof Error && (e.name === 'NoModificationAllowedError' || e.name === 'InvalidModificationError');

/**
 * Every web store's files, for signing out on a shared computer. A download
 * may be writing its file as this runs, and while it is, the browser refuses
 * the whole removal and every file stays; so it tries again until the write
 * is out of the way, for up to `patienceMs`. A write that starts after the
 * removal holds a handle to the removed directory and fails, so it leaves
 * nothing.
 */
export async function clearAllWebFiles(
  root: () => Promise<DirHandle> = browserRoot,
  patienceMs = 10_000,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<void> {
  const until = Date.now() + patienceMs;
  for (;;) {
    try {
      await (await root()).removeEntry(ROOT_DIR, { recursive: true });
      return;
    } catch (e) {
      if (notFound(e)) return;
      if (!writeInTheWay(e) || Date.now() >= until) throw e;
      await pause(50);
    }
  }
}
