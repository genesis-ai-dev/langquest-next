import { describe, expect, it } from 'vitest';
import { commitsOf, syncPackageAt, vitestConfig } from './old-sync-tests.mjs';

/**
 * Older store builds keep syncing with a pull request's database
 * (scripts/old-sync-tests.mjs, decisions.md 150): the sync test from each
 * supported store build's commit runs against it.
 */

describe('the store builds\' sync tests', () => {
  it('run once per commit, for supported builds only', () => {
    const builds = [
      { platform: 'android', build: 25, commit: 'c25' },
      { platform: 'android', build: 24, commit: 'old' },
      { platform: 'ios', build: 42, commit: 'c23' },
      { platform: 'android', build: 23, commit: 'c23' },
      { platform: 'android', build: 12, commit: 'c12' },
    ];
    const commits = commitsOf(builds, { android: 13, ios: 33 }, [{ platform: 'android', build: 24 }]);
    expect([...commits.keys()]).toEqual(['c25', 'c23']);
    expect(commits.get('c23')!.map((b: { build: number }) => b.build)).toEqual([42, 23]);
  });

  it('find the sync package under its name at that commit', () => {
    expect(syncPackageAt(['packages/sync/test/integration.test.ts'])).toBe('packages/sync');
    expect(syncPackageAt(['packages/client/test/integration.test.ts'])).toBe('packages/client');
    expect(syncPackageAt(['packages/core/src/index.ts'])).toBeNull();
  });

  it('run each commit\'s test with that commit\'s own core', () => {
    const config = vitestConfig('/tmp/x', 'packages/sync');
    expect(config).toContain("'@langquest-next/core': \"/tmp/x/packages/core/src/index.ts\"");
    expect(config).toContain('"packages/sync/test/integration.test.ts"');
    expect(config).toContain('globals: true');
  });
});
