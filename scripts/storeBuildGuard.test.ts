import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { refusal } from '../apps/mobile/scripts/store-build-guard.mjs';

/**
 * Store builds come only from the EAS workflow on merges into main
 * (decisions.md 156). EAS runs apps/mobile's `eas-build-pre-install` script
 * before each build, and it refuses a production build that the workflow did
 * not start from main.
 */

describe('the store build guard', () => {
  it('lets the workflow on main make a production build', () => {
    expect(refusal({ EAS_BUILD_PROFILE: 'production', LQ_STORE_BUILD_REF: 'refs/heads/main' })).toBeNull();
  });

  it('stops a production build started by hand or from another branch', () => {
    expect(refusal({ EAS_BUILD_PROFILE: 'production', EAS_BUILD_USERNAME: 'rwishart' })).toMatch(/started by rwishart/);
    expect(refusal({ EAS_BUILD_PROFILE: 'production', LQ_STORE_BUILD_REF: 'refs/heads/release/42' })).toMatch(/from refs\/heads\/release\/42/);
    expect(refusal({ EAS_BUILD_PROFILE: 'production' })).toMatch(/outside the workflow/);
  });

  it('lets every other profile build', () => {
    for (const profile of ['preview', 'development', 'simulator']) expect(refusal({ EAS_BUILD_PROFILE: profile }), profile).toBeNull();
  });

  it('runs before every EAS build, and the workflow passes its ref to both store builds', () => {
    const scripts = JSON.parse(readFileSync('apps/mobile/package.json', 'utf8')).scripts;
    expect(scripts['eas-build-pre-install']).toBe('node scripts/store-build-guard.mjs');
    const workflow = readFileSync('apps/mobile/.eas/workflows/deploy-to-testers.yml', 'utf8');
    for (const job of ['build_ios', 'build_android'])
      expect(workflow, job).toMatch(new RegExp(`\\n  ${job}:\\n(?: {4}.*\\n)*? {6}LQ_STORE_BUILD_REF: \\$\\{\\{ github\\.ref \\}\\}\\n`));
  });

  it('leaves no script that makes or uploads a store build by hand', () => {
    const scripts = Object.values(JSON.parse(readFileSync('apps/mobile/package.json', 'utf8')).scripts) as string[];
    expect(scripts.filter((s) => /--profile production|--auto-submit|eas submit/.test(s))).toEqual([]);
    expect(readFileSync('apps/mobile/scripts/ship.mjs', 'utf8')).not.toMatch(/'production'/);
  });
});
