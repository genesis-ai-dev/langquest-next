import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { changedFiles, JOBS, RULES, scopeFor } from './ci-scope.mjs';

/**
 * Which guardrails jobs a pull request needs, from the files that it
 * changes (scripts/ci-scope.mjs, decisions.md 150). Leaving a job out
 * wrongly lets a red change into main, so a file that no rule names, and
 * any shared code, runs every job.
 */

const needs = (...files: string[]) => JOBS.filter((job) => scopeFor(files)[job]);

describe('the jobs that changed files need', () => {
  it('a change to the decision log or the docs needs only checks', () => {
    expect(needs('docs/decisions.md')).toEqual([]);
    expect(needs('docs/testing.md', 'PLAN.md', 'AGENTS.md', 'apps/mobile/README.md')).toEqual([]);
  });

  it('shared code, the database, dependencies and CI run every job', () => {
    for (const file of [
      'packages/core/src/reducer.ts',
      'packages/sync/src/push.ts',
      'supabase/migrations/20261022000000_x.sql',
      'supabase/functions/push-delivery/index.ts',
      'package.json',
      'package-lock.json',
      'apps/mobile/package.json',
      '.github/workflows/guardrails.yml',
      '.githooks/pre-push',
      'vitest.config.ts',
      'scripts/ci-scope.mjs',
      'scripts/README.md',
      'library/flows/x.json',
    ])
      expect(needs(file), file).toEqual(JOBS);
  });

  it('a file that no rule names runs every job', () => {
    expect(needs('something-new/x.ts')).toEqual(JOBS);
    expect(scopeFor(['something-new/x.ts']).server).toContain('no rule names it');
  });

  it('the app and the browser tests run the two browser jobs, the SQL smokes the server job', () => {
    expect(needs('apps/mobile/src/screens/home.tsx')).toEqual(['web-smoke', 'ui-web']);
    expect(needs('apps/web/worker/index.ts', 'e2e/ui/home.spec.ts')).toEqual(['web-smoke', 'ui-web']);
    expect(needs('server/inviteChecksSmoke.sql')).toEqual(['server']);
    expect(needs('server/inviteChecksSmoke.sql', 'apps/mobile/App.tsx')).toEqual(JOBS);
  });

  it('a dependency of the app runs every job, ahead of the app rule', () => {
    expect(RULES.findIndex((r) => r.pattern.test('apps/mobile/package.json'))).toBe(1);
  });

  it('names the first file that needs each job', () => {
    expect(scopeFor(['docs/a.md', 'apps/mobile/src/x.tsx', 'apps/mobile/src/y.tsx'])).toEqual({
      server: null,
      'web-smoke': 'apps/mobile/src/x.tsx',
      'ui-web': 'apps/mobile/src/x.tsx',
    });
  });
});

describe('the changed files', () => {
  it('are the change since the branch met main, not what main did since', () => {
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    expect(changedFiles(process.cwd(), base, base)).toEqual([]);
  });
});
