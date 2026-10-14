import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * packages/sync keeps and moves what a device queues for the server
 * (decisions.md 104), for every runtime that does so: the phone, the
 * Worker, server jobs and scripts. A platform gets in as a constructor
 * argument, never as an import, so this package imports only core,
 * supabase-js and its own files. `src/testing` runs in Node only and may
 * use Node's built-ins as well.
 */
const SRC = join(__dirname, '../src');
const ALLOWED = new Set(['@langquest-next/core', '@supabase/supabase-js']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

function specifiers(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm)) found.push(m[1]!);
  return found;
}

describe('packages/sync imports no platform', () => {
  it('imports only core, supabase-js and its own files', () => {
    const outside: string[] = [];
    for (const file of files(SRC)) {
      const name = relative(SRC, file);
      const nodeOnly = name.startsWith('testing/');
      for (const spec of specifiers(readFileSync(file, 'utf8'))) {
        if (spec.startsWith('.') || ALLOWED.has(spec)) continue;
        if (nodeOnly && spec.startsWith('node:')) continue;
        outside.push(`${name}: ${spec}`);
      }
    }
    expect(outside, 'Pass the platform in through an interface instead (AGENTS.md, decisions.md 104).').toEqual([]);
  });
});
