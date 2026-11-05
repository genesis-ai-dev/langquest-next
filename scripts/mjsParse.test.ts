import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * The plain-JavaScript scripts (`.mjs`) parse as Node runs them. Neither the
 * typecheck nor lint reads them, so a TypeScript-only `!` in
 * scripts/local-db.mjs reached CI and stopped both ui-web jobs at
 * `npm run db:start` (2026-10-20).
 */

const root = fileURLToPath(new URL('..', import.meta.url));

it('every committed .mjs file parses as plain JavaScript', () => {
  const files = spawnSync('git', ['ls-files', '*.mjs'], { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  expect(files.length).toBeGreaterThan(20);
  const broken = files
    .map((file) => ({ file, r: spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8' }) }))
    .filter(({ r }) => r.status !== 0)
    .map(({ file, r }) => `${file}: ${r.stderr.split('\n').find((l) => l.includes('Error')) ?? r.stderr}`);
  expect(broken).toEqual([]);
});
