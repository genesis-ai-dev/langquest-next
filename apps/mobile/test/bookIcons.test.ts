// Every catalog book must resolve to a book icon: a missing one is an invisible
// blank in the status and setup lists, not a crash, so tests are the only guard.
import { BIBLE_BOOKS } from '../../../packages/core/src/catalogData';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const source = readFileSync(join(root, 'src/bookIcons.tsx'), 'utf8');

describe('book icons', () => {
  const map = new Map(
    [...source.matchAll(/^ {2}'?([a-z0-9]+)'?: require\('\.\.\/assets\/book-icons\/([a-z0-9]+)\.webp'\)/gm)]
      .map((m) => [m[1]!, m[2]!])
  );

  it('covers every book in the catalog', () => {
    expect([...map.keys()].sort()).toEqual(BIBLE_BOOKS.map((b) => b.itemId).sort());
  });

  it('points at files that exist', () => {
    for (const file of map.values()) {
      expect(existsSync(join(root, 'assets/book-icons', `${file}.webp`)), file).toBe(true);
    }
  });
});
