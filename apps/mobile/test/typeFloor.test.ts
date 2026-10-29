import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type as T } from '../src/ui/theme';

/**
 * Nothing the app writes is smaller than the type scale's floor (theme.ts,
 * ADR-008: nothing under 13), read in sunlight on a cheap phone (UI audit,
 * finding 22). A number written straight into a style, or the floor made
 * smaller, fails here; a drawn picture's digits use a named constant that
 * says why.
 */
const SRC = join(__dirname, '..', 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('the type floor', () => {
  it('no style sets a font under 13 points', () => {
    const small = files(SRC).flatMap((f) => readFileSync(f, 'utf8').split('\n').flatMap((line, i) => {
      const literal = [...line.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)\b/g)].some((m) => Number(m[1]) < T.xs);
      const under = /fontSize:[^,}]*T\.xs\s*-/.test(line);
      return literal || under ? [`${relative(SRC, f)}:${i + 1}`] : [];
    }));
    expect(small).toEqual([]);
  });
});
