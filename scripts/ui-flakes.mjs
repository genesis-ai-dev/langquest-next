#!/usr/bin/env node
/**
 * Pass rates per web UI test across kept Playwright reports (docs/testing.md,
 * "Zero retries, quarantine instead"). Retries are off, so every run is one
 * verdict per test; this reads many runs and lists the tests that did not
 * pass every time.
 *
 *   node scripts/ui-flakes.mjs keep                 copy this run's report into smart-tests/results/history/
 *   node scripts/ui-flakes.mjs [dir-or-report ...]  pass rates over the given reports (default: the history)
 *   node scripts/ui-flakes.mjs --min 3              only tests seen in at least 3 runs
 *
 * CI uploads each run's report.json as an artifact (guardrails.yml); download
 * a few into a folder and point the script at it.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const results = join(root, 'smart-tests/results/ui');
const history = join(root, 'smart-tests/results/history');
const args = process.argv.slice(2);

if (args[0] === 'keep') {
  const report = join(results, 'report.json');
  if (!existsSync(report)) throw new Error(`${report} is not there: run the suite first`);
  const { stats } = JSON.parse(readFileSync(report, 'utf8'));
  mkdirSync(history, { recursive: true });
  const to = join(history, `${(stats?.startTime ?? new Date().toISOString()).replace(/[:.]/g, '-')}.json`);
  copyFileSync(report, to);
  console.log(`kept ${to}`);
  process.exit(0);
}

const minIndex = args.indexOf('--min');
const min = minIndex >= 0 ? Number(args[minIndex + 1]) : 1;
const paths = args.filter((a, i) => a !== '--min' && i !== minIndex + 1);
const files = (paths.length ? paths : [history]).flatMap((p) => {
  if (!existsSync(p)) return [];
  return statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith('.json')).map((f) => join(p, f)) : [p];
});
if (!files.length) {
  console.error('no reports: run the suite, then `node scripts/ui-flakes.mjs keep`, or name report.json files');
  process.exit(1);
}

/** title -> { runs, passed, failed: [report names] } */
const tests = new Map();
function walk(suite, file, report) {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const key = `${file} › ${spec.title}${t.projectName ? ` [${t.projectName}]` : ''}`;
      const row = tests.get(key) ?? { runs: 0, passed: 0, failed: [] };
      for (const r of t.results ?? []) {
        if (r.status === 'skipped') continue;
        row.runs++;
        if (r.status === 'passed') row.passed++;
        else row.failed.push(report);
      }
      tests.set(key, row);
    }
  }
  for (const child of suite.suites ?? []) walk(child, file, report);
}
for (const f of files) {
  const r = JSON.parse(readFileSync(f, 'utf8'));
  for (const s of r.suites ?? []) walk(s, s.file ?? s.title, basename(f));
}

const rows = [...tests].filter(([, r]) => r.runs >= min && r.passed < r.runs)
  .map(([title, r]) => ({ title, rate: r.passed / r.runs, ...r }))
  .sort((a, b) => a.rate - b.rate || b.runs - a.runs);
console.log(`${files.length} report(s), ${tests.size} tests, ${rows.length} did not pass every run${min > 1 ? ` (seen in ≥ ${min} runs)` : ''}`);
for (const r of rows) {
  console.log(`${String(Math.round(r.rate * 100)).padStart(3)}%  ${r.passed}/${r.runs}  ${r.title}`);
  console.log(`       failed in: ${[...new Set(r.failed)].join(', ')}`);
}
