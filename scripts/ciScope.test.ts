import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { changedFiles, eventRange, JOBS, RULES, scopeFor, SHARED } from './ci-scope.mjs';

/**
 * Which guardrails jobs a pull request needs, from the files that it
 * changes (scripts/ci-scope.mjs, decisions.md 150). Leaving a job out
 * wrongly lets a red change into main, so a file that no rule names, and
 * any shared code, runs every shared job. Only the nearby module and what it
 * compiles against compile its Kotlin (docs/nearby-sync-plan.md section 7).
 */

const needs = (...files: string[]) => JOBS.filter((job) => scopeFor(files)[job]);

describe('the jobs that changed files need', () => {
  it('a change to the decision log or the docs needs only checks', () => {
    expect(needs('docs/decisions.md')).toEqual([]);
    expect(needs('docs/testing.md', 'PLAN.md', 'AGENTS.md', 'apps/mobile/README.md')).toEqual([]);
  });

  it('shared code, the database, dependencies and CI run every shared job, and compile no Kotlin', () => {
    expect(SHARED).toEqual(JOBS.filter((job) => job !== 'android-native'));
    for (const file of [
      'packages/core/src/reducer.ts',
      'packages/sync/src/push.ts',
      'supabase/migrations/20261022000000_x.sql',
      'supabase/functions/push-delivery/index.ts',
      'package.json',
      'packages/core/package.json',
      'apps/web/package.json',
      '.github/workflows/guardrails.yml',
      '.githooks/pre-push',
      'vitest.config.ts',
      'scripts/ci-scope.mjs',
      'scripts/README.md',
      'library/flows/x.json',
    ])
      expect(needs(file), file).toEqual(SHARED);
  });

  it('a file that no rule names runs every shared job', () => {
    expect(needs('something-new/x.ts')).toEqual(SHARED);
    expect(scopeFor(['something-new/x.ts']).server).toContain('no rule names it');
  });

  it('the nearby module compiles its Kotlin and keeps the browser jobs', () => {
    for (const file of [
      'apps/mobile/modules/nearby-link/android/src/main/java/expo/modules/nearbylink/Frames.kt',
      'apps/mobile/modules/nearby-link/android/src/main/AndroidManifest.xml',
      'apps/mobile/modules/nearby-link/package.json',
      'apps/mobile/modules/nearby-link/README.md',
      'apps/mobile/modules/nearby-link/src/wire.ts',
    ])
      expect(needs(file), file).toEqual(['web-smoke', 'ui-web', 'android-native']);
    expect(needs('apps/mobile/modules/microphone-energy/android/src/main/java/x.kt')).toEqual(['web-smoke', 'ui-web']);
  });

  it('the app\'s dependencies and the root lockfile run every job, Kotlin included', () => {
    expect(needs('apps/mobile/package.json')).toEqual(JOBS);
    expect(needs('package-lock.json')).toEqual(JOBS);
  });

  it('the app and the browser tests run the two browser jobs, the SQL smokes the server job', () => {
    expect(needs('apps/mobile/src/screens/home.tsx')).toEqual(['web-smoke', 'ui-web']);
    expect(needs('apps/web/worker/index.ts', 'e2e/ui/home.spec.ts')).toEqual(['web-smoke', 'ui-web']);
    expect(needs('server/inviteChecksSmoke.sql')).toEqual(['server']);
    expect(needs('server/inviteChecksSmoke.sql', 'apps/mobile/App.tsx')).toEqual(SHARED);
  });

  it('the module and the app\'s dependencies are matched ahead of the dependency rule and the app rule', () => {
    const at = (file: string) => RULES.findIndex((r) => r.pattern.test(file));
    const dependencyRule = at('apps/web/package.json');
    const appRule = at('apps/mobile/src/x.ts');
    expect(at('apps/mobile/package.json')).toBeLessThan(dependencyRule);
    expect(at('package-lock.json')).toBeLessThan(dependencyRule);
    expect(at('apps/mobile/modules/nearby-link/package.json')).toBeLessThan(dependencyRule);
    expect(dependencyRule).toBeLessThan(appRule);
  });

  it('names the first file that needs each job', () => {
    expect(scopeFor(['docs/a.md', 'apps/mobile/src/x.tsx', 'apps/mobile/src/y.tsx'])).toEqual({
      server: null,
      'web-smoke': 'apps/mobile/src/x.tsx',
      'ui-web': 'apps/mobile/src/x.tsx',
      'android-native': null,
    });
  });
});

describe('the changed files', () => {
  it('are the change since the branch met main, not what main did since', () => {
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    expect(changedFiles(process.cwd(), base, base)).toEqual([]);
  });
});

describe('which files a run measures', () => {
  it('a pull request: its own change from where it meets its base', () => {
    expect(eventRange('pull_request', { pull_request: { base: { ref: 'main' }, head: { sha: 'abc' } } })).toEqual({ what: 'pull request', base: 'origin/main', head: 'abc' });
  });

  it('a merge queue entry: what it changes on main, the pull requests ahead of it included', () => {
    expect(eventRange('merge_group', { merge_group: { base_sha: 'b0', head_sha: 'h1', base_ref: 'refs/heads/main' } })).toEqual({ what: 'merge queue entry', base: 'b0', head: 'h1' });
  });

  it('a push, the nightly and a manual run measure nothing: every job runs', () => {
    for (const name of ['push', 'schedule', 'workflow_dispatch', undefined]) expect(eventRange(name, {})).toBeNull();
  });
});
