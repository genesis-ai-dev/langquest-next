import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * `.easignore` filters the archive EAS builds from when the source is uploaded
 * rather than cloned. A rule that drops one of the app's source files breaks
 * the Bundle JavaScript phase ("Unable to resolve module"), as `build/` did to
 * apps/mobile/src/build (LAN-334). git applies the same ignore rules, so the
 * tracked files it says the file excludes are the ones the upload loses.
 */

const dropped = execFileSync('git', ['ls-files', '--cached', '--ignored', '--exclude-from=.easignore'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

/** Env files are dropped on purpose (builds get their variables from EAS environments). */
const isEnvFile = (path: string) => /(^|\/)\.env[^/]*$/.test(path) && !path.endsWith('.env.example');
/** Native projects are made by prebuild on EAS, so the upload leaves them out. */
const isNativeProject = (path: string) => /^apps\/mobile\/(ios|android)\//.test(path);

describe('.easignore', () => {
  it('keeps every tracked file of the phone app and the packages it bundles', () => {
    const lost = dropped.filter(
      (path) => (path.startsWith('apps/mobile/') || path.startsWith('packages/')) && !isEnvFile(path) && !isNativeProject(path),
    );
    expect(lost).toEqual([]);
  });

  it('keeps the app source folder named build', () => {
    expect(dropped.filter((path) => path.startsWith('apps/mobile/src/build/'))).toEqual([]);
  });

  it('still drops env files but keeps the lockfile', () => {
    expect(dropped).not.toContain('package-lock.json');
    expect(dropped).toContain('.env.production');
    expect(dropped).not.toContain('apps/mobile/.env.example');
  });
});
