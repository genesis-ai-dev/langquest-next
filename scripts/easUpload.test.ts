import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * What a run started from a laptop uploads to EAS (`eas workflow:run` without `--ref`, `eas build`):
 * every tracked file but the encrypted env files. `.easignore` replaces `.gitignore` for that upload,
 * and its bare `build/` once left out apps/mobile/src/build, which is source, so the carried build
 * started by hand on 2026-11-25 could not bundle (docs/environments.md, The carried build). Runs a
 * merge or the schedule starts clone the repo from GitHub and never read it. git reads `.easignore`
 * by the same rules as the `ignore` package eas-cli uses.
 */

const root = fileURLToPath(new URL('..', import.meta.url));

it('an upload to EAS leaves out no tracked file but the encrypted env files', () => {
  const r = spawnSync('git', ['ls-files', '--cached', '--ignored', '--exclude-from=.easignore'], { cwd: root, encoding: 'utf8' });
  expect(r.status).toBe(0);
  const left = r.stdout.split('\n').filter(Boolean);
  expect(left.filter((file) => !/(^|\/)\.env\.(development|preview|production)$/.test(file))).toEqual([]);
  expect(left).toContain('apps/mobile/.env.production');
});
