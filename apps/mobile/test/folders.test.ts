import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * apps/mobile/src is by feature (decisions.md 105): code lives in a folder
 * named for what it is about, never loose in src, and the simple/ folder of
 * the redesign is gone, its parts in their features. ESLint holds what may
 * import what; this holds where a file may be. A new file goes in the folder
 * of its feature, or a new folder named for what it is about.
 */
const SRC = join(__dirname, '../src');

describe('apps/mobile/src is laid out by feature', () => {
  it('has no code loose at its root', () => {
    expect(readdirSync(SRC).filter((name) => /\.(ts|tsx)$/.test(name))).toEqual([]);
  });

  it('has no simple/ folder', () => {
    expect(existsSync(join(SRC, 'simple'))).toBe(false);
  });

  // A file's name says its role (eslint.config.mjs holds what each role may
  // export and import). A model is pure, so it never draws: no .tsx models.
  it('keeps every model a .ts file', () => {
    const files = readdirSync(SRC, { recursive: true }).map(String);
    expect(files.filter((f) => /(^|\/)(model|\w+Model)\.tsx$/.test(f))).toEqual([]);
  });
});
