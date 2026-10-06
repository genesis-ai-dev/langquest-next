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

/** Every web store's files, for signing out on a shared computer. */
export async function clearAllWebFiles(root: () => Promise<DirHandle> = browserRoot): Promise<void> {
  try {
    await (await root()).removeEntry(ROOT_DIR, { recursive: true });
  } catch (e) {
    if (!notFound(e)) throw e;
  }
}
