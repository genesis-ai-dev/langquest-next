// The nightly mutation run over packages/core, in shards (decisions.md 167).
// One Stryker run over all of core takes hours on a CI runner, past any
// nightly job's limit, so it never finished and never kept its incremental
// file. Each shard mutates a share of core's files, dealt by what they cost
// so the shards end about together, with its own incremental file; `merge` puts
// their reports back into one, with the score over all of core.
//
//   run <i> <n>          Stryker over shard i (1-based) of n
//   merge <dir> <out>    every mutation.json under dir, as one report in out
//
// `npm run test:mutation` still runs all of core at once, on a laptop.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'packages/core/src';
/** A GitHub runner has four cores: seven workers left Stryker's own timeouts killing mutants (2026-10-23). */
const CONCURRENCY = 4;

/** Core's source files, relative to the repository root, as Stryker mutates them (no .d.ts). */
export function coreFiles(root = ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(path.join(root, dir)).sort()) {
      const rel = `${dir}/${name}`;
      if (statSync(path.join(root, rel)).isDirectory()) walk(rel);
      else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(rel);
    }
  };
  walk(SOURCE);
  return out;
}

/**
 * What a file costs Stryker, in seconds on a laptop with four workers
 * (2026-10-26): its mutants times the tests each one runs, so not its size.
 * passage.ts and validate.ts each take about ten minutes alone, and no shard
 * can be shorter than its longest file, so four shards end as soon as eight
 * would. A file not listed counts as DEFAULT_SECONDS; when one shard stands
 * out in the job's timings, measure again and list its slow file here.
 */
export const SLOW_SECONDS = {
  'packages/core/src/passage.ts': 629,
  'packages/core/src/validate.ts': 579,
  'packages/core/src/reducer.ts': 173,
  'packages/core/src/passageLines.ts': 84,
  'packages/core/src/commands.ts': 47,
  'packages/core/src/portfolio.ts': 36,
  'packages/core/src/indexes.ts': 33,
  'packages/core/src/changes.ts': 32,
  'packages/core/src/blobs.ts': 30,
  'packages/core/src/coverage.ts': 28,
  'packages/core/src/references.ts': 26,
  'packages/core/src/reports.ts': 21
};

/** About what an unlisted file costs. */
export const DEFAULT_SECONDS = 10;

/**
 * The files of shard `index` (1-based) of `count`: each file goes to the
 * lightest shard so far, the slowest first, so the shards end about
 * together. Ties go by path, so every runner deals the same shards.
 */
export function shardOf(files, index, count) {
  const weight = (f) => SLOW_SECONDS[f] ?? DEFAULT_SECONDS;
  const shards = Array.from({ length: count }, () => ({ seconds: 0, files: [] }));
  const order = [...files].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : a > b ? 1 : 0));
  for (const f of order) {
    const lightest = shards.reduce((min, s) => (s.seconds < min.seconds ? s : min));
    lightest.seconds += weight(f);
    lightest.files.push(f);
  }
  return shards[index - 1].files.sort();
}

/** stryker.config.json narrowed to one shard: its files, its incremental file, its reports. */
export function shardConfig(base, files, index) {
  const dir = `reports/mutation/shard-${index}`;
  return {
    ...base,
    mutate: files,
    concurrency: CONCURRENCY,
    incrementalFile: `.stryker-tmp/incremental-${index}.json`,
    jsonReporter: { fileName: `${dir}/mutation.json` },
    htmlReporter: { fileName: `${dir}/index.html` },
    reporters: (base.reporters ?? []).map((r) => (r === 'progress' ? 'progress-append-only' : r))
  };
}

/** Several shards' reports (mutation-testing-report-schema) as one: their files together. */
export function mergeReports(reports) {
  if (!reports.length) throw new Error('no shard left a report');
  const [first] = reports;
  return { ...first, files: Object.assign({}, ...reports.map((r) => r.files)) };
}

/** Stryker's score: killed and timed out, of every mutant a test could have noticed or did not reach. */
export function mutationScore(report) {
  const count = { Killed: 0, Timeout: 0, Survived: 0, NoCoverage: 0 };
  for (const file of Object.values(report.files)) {
    for (const m of file.mutants) if (m.status in count) count[m.status] += 1;
  }
  const detected = count.Killed + count.Timeout;
  const valid = detected + count.Survived + count.NoCoverage;
  return { ...count, score: valid ? Math.round((detected / valid) * 1000) / 10 : 0 };
}

function reportsUnder(dir) {
  const found = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === 'mutation.json') found.push(JSON.parse(readFileSync(p, 'utf8')));
    }
  };
  walk(dir);
  return found;
}

function run(index, count) {
  const mine = shardOf(coreFiles(), index, count);
  const base = JSON.parse(readFileSync(path.join(ROOT, 'stryker.config.json'), 'utf8'));
  const config = path.join('.stryker-tmp', `shard-${index}.config.json`);
  mkdirSync(path.join(ROOT, '.stryker-tmp'), { recursive: true });
  writeFileSync(path.join(ROOT, config), JSON.stringify(shardConfig(base, mine, index), null, 2));
  console.log(`shard ${index} of ${count}: ${mine.length} files\n${mine.map((f) => `  ${f}`).join('\n')}`);
  const result = spawnSync('npx', ['stryker', 'run', config], { cwd: ROOT, stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

function merge(dir, out) {
  const merged = mergeReports(reportsUnder(dir));
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(merged));
  const s = mutationScore(merged);
  const line = `Mutation score over packages/core: ${s.score}% (${s.Killed} killed, ${s.Timeout} timed out, ${s.Survived} survived, ${s.NoCoverage} with no test reaching them; ${Object.keys(merged.files).length} files)`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`, { flag: 'a' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, a, b] = process.argv.slice(2);
  if (command === 'run' && Number(a) >= 1 && Number(b) >= Number(a)) run(Number(a), Number(b));
  else if (command === 'merge' && a && b) merge(a, b);
  else {
    console.error('usage: node scripts/mutation-shards.mjs run <i> <n> | merge <dir> <out>');
    process.exit(2);
  }
}
