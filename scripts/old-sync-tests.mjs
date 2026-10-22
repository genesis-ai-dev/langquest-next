// When a pull request changes the database, the sync integration test from
// each supported store build's commit runs against the pull request's
// database (decisions.md 152), so a migration that breaks how an older build
// syncs fails here instead of on people's phones. It runs in the guardrails
// `server` job after this checkout's own integration test, on the stack
// that the job started from this pull request's migrations.
//
// Each commit's sync code and its test (packages/sync, or packages/client
// in builds from before 2026-10-14) and the core that they use are taken
// out of git into .old-sync/<commit>, and run with this checkout's
// dependencies: @langquest-next/core points at that commit's own core. A
// test that the old test file skips counts as a failure, so a test that did
// not reach the database never passes quietly.
//
//   node scripts/old-sync-tests.mjs            when this branch changes supabase/migrations
//   node scripts/old-sync-tests.mjs --always   whatever this branch changes
//
// The store builds come from storeBuilds() in scripts/server-calls.mjs (EAS
// with EXPO_TOKEN, otherwise apps/mobile/store-builds.json).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storeBuilds } from './server-calls.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(root, '.old-sync');

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

/** Whether this branch changes the database since it met main. */
export function changesDatabase(base = 'origin/main') {
  const from = git(['merge-base', base, 'HEAD']).trim();
  return git(['diff', '--name-only', from, 'HEAD', '--', 'supabase/migrations']).trim() !== '';
}

/** The supported store builds, grouped by commit: one test run per commit. */
export function commitsOf(builds, oldestSupported, retired) {
  const byCommit = new Map();
  for (const b of builds) {
    if (b.build < oldestSupported[b.platform] || retired.some((r) => r.platform === b.platform && r.build === b.build)) continue;
    byCommit.set(b.commit, [...(byCommit.get(b.commit) ?? []), b]);
  }
  return byCommit;
}

/** Where a commit keeps its sync package: packages/sync, or packages/client before the rename. */
export function syncPackageAt(paths) {
  return paths.includes('packages/sync/test/integration.test.ts') ? 'packages/sync' : paths.includes('packages/client/test/integration.test.ts') ? 'packages/client' : null;
}

/** The vitest config that runs one commit's integration test with its own core. */
export function vitestConfig(dir, pkg) {
  return `export default {
  root: ${JSON.stringify(dir)},
  resolve: { alias: { '@langquest-next/core': ${JSON.stringify(join(dir, 'packages/core/src/index.ts'))} } },
  server: { fs: { allow: [${JSON.stringify(root)}] } },
  test: { globals: true, include: [${JSON.stringify(`${pkg}/test/integration.test.ts`)}], testTimeout: 60000, hookTimeout: 60000 }
};
`;
}

/** Take a commit's core and sync package out of git into .old-sync/<commit>. */
function extract(commit) {
  const paths = git(['ls-tree', '-r', '--name-only', commit, 'packages']).split('\n');
  const pkg = syncPackageAt(paths);
  if (!pkg) return null;
  const dir = join(OUT, commit.slice(0, 12));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // The test also drives the server's own code of that commit (the projection worker, the Worker's blob routes).
  const tar = execFileSync('git', ['archive', '--format=tar', commit, 'packages', 'server', 'apps/web/worker', 'supabase/functions'], { cwd: root, maxBuffer: 1 << 30 });
  spawnSync('tar', ['-x', '-C', dir], { input: tar });
  writeFileSync(join(dir, 'vitest.config.mjs'), vitestConfig(dir, pkg));
  return { dir, pkg };
}

const label = (b) => `Build ${b.build} (${b.platform === 'ios' ? 'iPhone' : 'Android'})`;

async function main() {
  if (!process.argv.includes('--always') && !changesDatabase()) {
    console.log('This branch changes no migration, so the store builds\' sync tests do not run.');
    return;
  }
  const { source, oldestSupported, retired, builds } = await storeBuilds();
  const commits = commitsOf(builds, oldestSupported, retired);
  console.log(`Sync tests from ${commits.size} store build commits (from ${source}), against this branch's database.`);
  const failed = [];
  for (const [commit, which] of commits) {
    const names = which.map(label).join(', ');
    try {
      git(['cat-file', '-e', `${commit}^{commit}`]);
    } catch {
      git(['fetch', '--quiet', '--no-tags', 'origin', commit]);
    }
    const out = extract(commit);
    if (!out) {
      failed.push(`${names}: commit ${commit.slice(0, 8)} has no sync integration test`);
      continue;
    }
    const report = join(out.dir, 'report.json');
    const run = spawnSync('node', ['scripts/with-local-keys.mjs', 'npx', 'vitest', 'run', '--config', join(out.dir, 'vitest.config.mjs'), '--reporter=default', '--reporter=json', `--outputFile.json=${report}`],
      { cwd: root, stdio: 'inherit' });
    const result = existsSync(report) ? JSON.parse((await import('node:fs')).readFileSync(report, 'utf8')) : null;
    const skipped = result ? result.numPendingTests + result.numTodoTests : 0;
    if (run.status !== 0 || !result || result.numTotalTests === 0 || skipped > 0) {
      const why = !result ? 'did not run' : run.status !== 0 ? `${result.numFailedTests} of ${result.numTotalTests} tests failed` : skipped ? `${skipped} tests were skipped` : 'ran no test';
      failed.push(`${names} (commit ${commit.slice(0, 8)}): its sync test ${why} against this database`);
    } else {
      console.log(`ok: ${names} (commit ${commit.slice(0, 8)}), ${result.numPassedTests} tests`);
    }
  }
  rmSync(OUT, { recursive: true, force: true });
  if (!failed.length) return console.log('Every store build still syncs with this database.');
  for (const f of failed) console.log(`::error::${f}. A migration must keep older builds syncing (decisions.md 152).`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
