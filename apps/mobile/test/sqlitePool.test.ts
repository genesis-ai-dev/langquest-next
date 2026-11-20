/**
 * A first visit cut off while expo-sqlite made its file pool left fewer than
 * six files, and that browser could never open its storage again (ACCT-040
 * and WEB-023 in the merge queue, 2026-11-20). The pool is topped up first.
 */
import { fillSqlitePool, POOL_DIR, POOL_FILES, type PoolDir, type PoolRoot } from '../src/web/sqlitePool';

function fakeRoot(files: string[] | null, extra: string[] = []) {
  const made: string[] = [];
  const dir: PoolDir = {
    async getFileHandle(name, opts) {
      if (!opts?.create && !files!.includes(name)) throw new Error('NotFoundError');
      if (!files!.includes(name)) { files!.push(name); made.push(name); }
      return {};
    },
    async *entries() {
      for (const f of files!) yield [f, { kind: 'file' as const }];
      for (const d of extra) yield [d, { kind: 'directory' as const }];
    }
  };
  const root: PoolRoot = {
    async getDirectoryHandle(name) {
      if (name !== POOL_DIR || files === null) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
      return dir;
    }
  };
  return { root: async () => root, made };
}

let n = 0;
const names = () => `f${n++}`;

describe('fillSqlitePool', () => {
  it('tops a short pool up to six files', async () => {
    const files = ['abc'];
    const { root, made } = fakeRoot(files);
    expect(await fillSqlitePool(root, names)).toBe(POOL_FILES - 1);
    expect(files).toHaveLength(POOL_FILES);
    expect(made).not.toContain('abc');
  });

  it('leaves a full pool alone', async () => {
    const { root, made } = fakeRoot(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(await fillSqlitePool(root, names)).toBe(0);
    expect(made).toEqual([]);
  });

  it('leaves the first pool to the worker: no folder, or an empty one', async () => {
    expect(await fillSqlitePool(fakeRoot(null).root, names)).toBe(0);
    const empty = fakeRoot([]);
    expect(await fillSqlitePool(empty.root, names)).toBe(0);
    expect(empty.made).toEqual([]);
  });

  it('counts only files, and never reuses a name the pool has', async () => {
    const files = ['f100', 'x'];
    const { root } = fakeRoot(files, ['sub']);
    let i = 99;
    expect(await fillSqlitePool(root, () => `f${++i}`)).toBe(4);
    expect(new Set(files).size).toBe(POOL_FILES);
  });
});
