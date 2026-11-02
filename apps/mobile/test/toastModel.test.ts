import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toastLook } from '../src/ui/toastModel';

const SRC = join(__dirname, '..', 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Each `toast(...)` call in a file, with its arguments (strings skipped, so their brackets do not count). */
function toastCalls(source: string): string[] {
  const calls: string[] = [];
  for (const m of source.matchAll(/(?<![A-Za-z_])(?:\w+\.)*toast\(/g)) {
    let depth = 1;
    let j = m.index + m[0].length;
    let quote: string | null = null;
    for (; j < source.length && depth; j++) {
      const c = source[j]!;
      if (quote) { if (c === '\\') j++; else if (c === quote) quote = null; } else if (`'"\``.includes(c)) quote = c;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    calls.push(source.slice(m.index + m[0].length, j - 1));
  }
  return calls;
}

describe('toasts (UI audit, finding 20)', () => {
  it('a problem never wears the check, and stays until closed', () => {
    expect(toastLook({ tone: 'problem' })).toEqual({ icon: 'warning', color: 'amber', goesBy: false, live: 'assertive' });
    expect(toastLook({})).toEqual({ icon: 'check', color: 'green', goesBy: true, live: 'polite' });
  });

  it('every toast that says a save failed, or gives a fault code, is a problem toast', () => {
    const fails = /failureMessage\(|[a-z]Failure\(|\bfailure\(|reportError\(|commandErrorText\(/;
    const bare = files(SRC).flatMap((f) =>
      toastCalls(readFileSync(f, 'utf8')).filter((args) => fails.test(args) && !args.includes("'problem'")).map(() => relative(SRC, f)));
    expect(bare).toEqual([]);
  });
});
