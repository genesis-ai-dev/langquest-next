import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Hygiene for the web UI suite (docs/testing.md "Signals, not sleeps"):
 * - a waitForTimeout( needs a trailing `// sleep: <reason>` comment (or `/* sleep: … */` mid-line);
 * - test.setTimeout( above 240_000 needs a trailing `// ceiling: <reason>`;
 * - ui.config.ts keeps `retries: 0`.
 *
 * Offences that predate the rule are listed by text (not line number) in
 * scripts/uiSuiteHygiene.baseline.json. The baseline only shrinks: a new
 * offence fails, and so does an entry that no longer exists. Regenerate with
 * UPDATE_HYGIENE_BASELINE=1 npx vitest run scripts/uiSuiteHygiene.test.ts
 * (only to drop fixed entries; never to excuse new ones).
 */

const DIR = 'smart-tests/ui';
const CONFIG = 'smart-tests/ui.config.ts';
const BASELINE = 'scripts/uiSuiteHygiene.baseline.json';
const CEILING = 240_000;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(`${dir}/${e.name}`) : e.name.endsWith('.ts') ? [`${dir}/${e.name}`] : [],
  );
}

function offences(): string[] {
  const out: string[] = [];
  for (const f of sources(DIR).sort()) {
    for (const raw of readFileSync(f, 'utf8').split('\n')) {
      const line = raw.trim();
      if (line.startsWith('//') || line.startsWith('*')) continue;
      if (line.includes('waitForTimeout(') && !/(\/\/|\/\*)\s*sleep:/.test(line)) out.push(`${f}:${line}`);
      const t = /test\.setTimeout\(\s*([^)]*)\)/.exec(line);
      if (t && !/(\/\/|\/\*)\s*ceiling:/.test(line)) {
        const n = Number(t[1]!.replace(/_/g, ''));
        if (!(n <= CEILING)) out.push(`${f}:${line}`);
      }
    }
  }
  return out;
}

function baseline(): string[] {
  return existsSync(BASELINE) ? (JSON.parse(readFileSync(BASELINE, 'utf8')) as string[]) : [];
}

function count(list: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of list) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

describe('UI suite hygiene', () => {
  const found = offences();

  if (process.env.UPDATE_HYGIENE_BASELINE) {
    writeFileSync(BASELINE, JSON.stringify([...found].sort(), null, 2) + '\n');
  }

  it('has no new sleeps or long timeouts without a reason comment', () => {
    const have = count(baseline());
    const fresh: string[] = [];
    for (const [k, n] of count(offences())) if (n > (have.get(k) ?? 0)) fresh.push(k);
    expect(fresh, 'add `// sleep: why` / `// ceiling: why`, or use a signal instead of a sleep').toEqual([]);
  });

  it('has no baseline entry that is already fixed', () => {
    const now = count(offences());
    const stale: string[] = [];
    for (const [k, n] of count(baseline())) if (n > (now.get(k) ?? 0)) stale.push(k);
    expect(stale, `remove from ${BASELINE} (UPDATE_HYGIENE_BASELINE=1)`).toEqual([]);
  });

  it('does not retry', () => {
    const m = [...readFileSync(CONFIG, 'utf8').matchAll(/^\s*retries:\s*(.+?),?\s*(?:\/\/.*)?$/gm)];
    expect(m.length).toBeGreaterThan(0);
    for (const r of m) expect(r[1]).toBe('0');
  });
});
