import { toFreeOf } from '../src/sync/blobsModel';

// Freeing space in three levels, worked out once (docs/nearby-sync-plan.md 5.6, section 8's freeing-space row).
const MB = 1024 * 1024;
const sizes = new Map([['l1-big', 120 * MB], ['l1-small', 30 * MB], ['unnamed', 5 * MB], ['backup-3', 40 * MB], ['backup-1', 60 * MB], ['review', 80 * MB]]);
const present = new Set(sizes.keys());
const level1 = [{ hash: 'l1-big' }, { hash: 'l1-small' }];
const level2 = [{ hash: 'unnamed' }, { hash: 'backup-3' }, { hash: 'backup-1' }, { hash: 'review' }];
const freed = (short: number, over = -1) => toFreeOf([level1, level2], { short, over, present, sizes }).map((r) => r.hash);

describe('what reclaim frees', () => {
  it('nothing when nothing is short', () => {
    expect(freed(0)).toEqual([]);
    expect(freed(-5 * MB)).toEqual([]);
  });

  it('level 1 first: a backup goes only once level 1 cannot free enough', () => {
    // 100 MB short: the phone's 120 MB level 1 file frees it.
    expect(freed(100 * MB)).toEqual(['l1-big']);
    // 150 MB short: both level 1 files, and no backup.
    expect(freed(150 * MB)).toEqual(['l1-big', 'l1-small']);
    // 160 MB short: level 1 gives 150, then the unnamed file, then the backup with more copies.
    expect(freed(160 * MB)).toEqual(['l1-big', 'l1-small', 'unnamed', 'backup-3']);
  });

  it('a file open for review goes after every backup, and only when it must', () => {
    expect(freed(255 * MB)).toEqual(['l1-big', 'l1-small', 'unnamed', 'backup-3', 'backup-1']);
    expect(freed(256 * MB)).toEqual(['l1-big', 'l1-small', 'unnamed', 'backup-3', 'backup-1', 'review']);
  });

  it('the cap alone frees from level 1 and never reaches a teammate\'s file', () => {
    expect(freed(0, 500 * MB)).toEqual(['l1-big', 'l1-small']);
    expect(freed(0, 10 * MB)).toEqual(['l1-big']);
  });

  it('one pass: a file listed twice or gone already counts once, or not at all', () => {
    const out = toFreeOf([[{ hash: 'l1-big' }, { hash: 'gone' }], [{ hash: 'l1-big' }, { hash: 'backup-3' }]], { short: 150 * MB, over: -1, present, sizes });
    expect(out.map((r) => r.hash)).toEqual(['l1-big', 'backup-3']);
  });
});
