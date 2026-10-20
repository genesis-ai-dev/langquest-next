#!/usr/bin/env node
/**
 * Which spec files a CI shard of the web UI suite runs (docs/testing.md,
 * decisions.md 102, amended 2026-10-20). Playwright's own `--shard` splits
 * by test count in file order, and test counts are not time: 06-recording is
 * 7 tests and 154 s, 03-home-and-navigation 16 tests and 47 s, so shard 2 of
 * two held the recording, reviewing, sync and journey files and took 250 to
 * 315 s against 160 to 200 s for shard 1, and was the shard that failed.
 *
 * Here every file has a weight, its seconds in recent CI runs
 * (scripts/ui-shard-weights.json), and files are dealt largest first to the
 * shard with the least so far (longest-processing-time-first), which is
 * within a third of the best split and needs no search. A file not in the
 * table (a new one) weighs the median. The same files go to the same shards
 * until the table or the set of files changes, and nothing else varies.
 *
 *   node scripts/ui-shards.mjs <index> <count> [--tag @p0]
 *       the files of shard <index> (1-based) of <count>, as paths to give
 *       `playwright test`, one line, separated by spaces. --tag leaves out
 *       the files that do not mention the tag, which would run nothing. The
 *       split goes to stderr. Fails when a shard would be empty, because
 *       `playwright test` with no file runs everything.
 *   node scripts/ui-shards.mjs weights <report.json | dir> ...
 *       the table, as JSON, from kept CI reports (the artifacts
 *       ui-web-p0-results-*): each file's seconds, averaged over the reports
 *       that name it. Reports of the shards of one run add up. Paste it over
 *       scripts/ui-shard-weights.json when the suite has changed a lot.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SPECS = 'e2e/ui';
const WEIGHTS = join(root, 'scripts/ui-shard-weights.json');

/** The median of the weights, for a file the table does not know. */
export function medianWeight(weights) {
  const values = Object.values(weights).sort((a, b) => a - b);
  return values.length ? values[Math.floor(values.length / 2)] : 30;
}

/**
 * Deal `files` into `count` shards, largest first to the lightest shard.
 * Returns [{ files, seconds }] by shard.
 */
export function assign(files, weights, count) {
  const fallback = medianWeight(weights);
  const weigh = (f) => weights[f] ?? fallback;
  const shards = Array.from({ length: count }, () => ({ files: [], seconds: 0 }));
  for (const file of [...files].sort((a, b) => weigh(b) - weigh(a) || a.localeCompare(b))) {
    const lightest = shards.reduce((best, s) => (s.seconds < best.seconds ? s : best));
    lightest.files.push(file);
    lightest.seconds += weigh(file);
  }
  for (const s of shards) s.files.sort();
  return shards;
}

/** The spec files in the folder, by name, that mention the tag (all when there is none). */
export function specFiles(dir, tag) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.spec.ts'))
    .filter((f) => !tag || readFileSync(join(dir, f), 'utf8').includes(tag))
    .sort();
}

/** Seconds per spec file from parsed Playwright reports; those of one run's shards share `run`. */
export function weightsFrom(reports) {
  const runs = new Map(); // run -> file -> ms
  for (const { run, report } of reports) {
    const files = runs.get(run) ?? new Map();
    runs.set(run, files);
    const walk = (suite) => {
      for (const spec of suite.specs ?? []) {
        for (const t of spec.tests ?? []) {
          for (const r of t.results ?? []) {
            if (r.status !== 'skipped') files.set(spec.file, (files.get(spec.file) ?? 0) + r.duration);
          }
        }
      }
      for (const child of suite.suites ?? []) walk(child);
    };
    for (const s of report.suites ?? []) walk(s);
  }
  const total = new Map(); // file -> { ms, runs }
  for (const files of runs.values()) {
    for (const [file, ms] of files) {
      const t = total.get(file) ?? { ms: 0, runs: 0 };
      total.set(file, { ms: t.ms + ms, runs: t.runs + 1 });
    }
  }
  return Object.fromEntries([...total].sort(([a], [b]) => a.localeCompare(b)).map(([f, t]) => [f, Math.max(1, Math.round(t.ms / t.runs / 1000))]));
}

function main(argv) {
  if (argv[0] === 'weights') {
    const reports = [];
    const add = (path, run) => {
      if (statSync(path).isDirectory()) {
        for (const f of readdirSync(path)) {
          const p = join(path, f);
          // A folder per downloaded artifact, named <run>-<shard>: the shards of a run share the run.
          if (statSync(p).isDirectory() || f.endsWith('.json')) add(p, run ?? f.replace(/-\d+$/, ''));
        }
      } else if (path.endsWith('.json')) {
        reports.push({ run: run ?? path, report: JSON.parse(readFileSync(path, 'utf8')) });
      }
    };
    for (const p of argv.slice(1)) add(p);
    if (!reports.length) throw new Error('no report.json found');
    console.log(JSON.stringify(weightsFrom(reports), null, 2));
    return;
  }
  const [indexText, countText] = argv;
  const index = Number(indexText);
  const count = Number(countText);
  if (!Number.isInteger(index) || !Number.isInteger(count) || index < 1 || count < 1 || index > count) {
    throw new Error('usage: ui-shards.mjs <index> <count> [--tag @p0] | weights <report.json | dir> ...');
  }
  const tagAt = argv.indexOf('--tag');
  const tag = tagAt >= 0 ? argv[tagAt + 1] : undefined;
  const weights = existsSync(WEIGHTS) ? JSON.parse(readFileSync(WEIGHTS, 'utf8')) : {};
  const shards = assign(specFiles(join(root, SPECS), tag), weights, count);
  shards.forEach((s, i) => console.error(`shard ${i + 1}/${count}${i + 1 === index ? ' (this one)' : ''}: ${s.files.length} files, about ${s.seconds} s of tests`));
  const mine = shards[index - 1].files;
  if (!mine.length) throw new Error(`shard ${index} of ${count} has no files: playwright would run everything`);
  console.log(mine.map((f) => `${SPECS}/${f}`).join(' '));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
