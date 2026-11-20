/**
 * expo-sqlite keeps the web's databases in a pool of files in the origin
 * private file system (`expo-sqlite/`). Its worker makes the pool once, six
 * files one after another, and only when the folder holds none: a pool that
 * holds some files is taken as made. A first visit that reloads, signs in or
 * goes to another page while the pool is being made leaves fewer files, and
 * that browser can then never open its storage again, however often it
 * reloads ("cannot create file", then "Error finalizing statement"). Seen on
 * CI, where a test loads the app and loads it again at once (ACCT-040 and
 * WEB-023, 2026-11-20).
 *
 * Before the database opens, this tops the pool up to six. The worker reads a
 * new empty file as a free one. No React Native imports: tests pass a root.
 */

/** expo-sqlite's folder and pool size (AccessHandlePoolVFS: VFS_NAME_PERSISTENT, DEFAULT_CAPACITY). */
export const POOL_DIR = 'expo-sqlite';
export const POOL_FILES = 6;

/** The parts of the File System Access API this uses, so tests can fake them. */
export interface PoolRoot {
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<PoolDir>;
}
export interface PoolDir {
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<unknown>;
  entries(): AsyncIterable<[string, { kind: 'file' | 'directory' }]>;
}

function browserRoot(): Promise<PoolRoot> {
  return navigator.storage.getDirectory() as unknown as Promise<PoolRoot>;
}

/** A name like the worker's own (random base 36). */
function poolName(): string {
  return Math.random().toString(36).slice(2) || 'pool';
}

/**
 * Add files to a pool that holds fewer than six; returns how many it added.
 * No folder or an empty one is left to the worker, which makes the pool.
 */
export async function fillSqlitePool(root: () => Promise<PoolRoot> = browserRoot, name: () => string = poolName): Promise<number> {
  let dir: PoolDir;
  try {
    dir = await (await root()).getDirectoryHandle(POOL_DIR);
  } catch {
    return 0;
  }
  const have = new Set<string>();
  for await (const [entry, handle] of dir.entries()) if (handle.kind === 'file') have.add(entry);
  if (have.size === 0 || have.size >= POOL_FILES) return 0;
  let added = 0;
  while (have.size < POOL_FILES) {
    const file = name();
    if (have.has(file)) continue;
    await dir.getFileHandle(file, { create: true });
    have.add(file);
    added++;
  }
  return added;
}
