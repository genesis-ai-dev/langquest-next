import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

/**
 * One Node version for every place that installs or runs this code
 * (decisions.md 244): `.node-version` says it, GitHub CI and Cloudflare's
 * builds read that file, and the places that cannot read it (EAS builds and
 * workflows, the job image) name the same version. npm is the one that Node
 * version ships with, named exactly in `packageManager` so Cloudflare's builds
 * install with it rather than their image's npm 10. Every third-party action
 * runs at a commit, not a tag that can move.
 */

const read = (path: string) => readFileSync(path, 'utf8');
const node = read('.node-version').trim();
const major = node.split('.')[0];
const yamlIn = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.yml'))
    .map((f) => [`${dir}/${f}`, read(`${dir}/${f}`)] as const);
const workflows = [
  ...yamlIn('.github/workflows'),
  ...readdirSync('.github/actions').map((a) => [`.github/actions/${a}/action.yml`, read(`.github/actions/${a}/action.yml`)] as const),
];

describe('the toolchain', () => {
  it('names one exact Node 24 version in .node-version', () => {
    expect(node).toMatch(/^24\.\d+\.\d+$/);
  });

  it('builds on EAS with that version, in every profile that sets one and every workflow', () => {
    const build = JSON.parse(read('apps/mobile/eas.json')).build as Record<string, { node?: string; extends?: string }>;
    for (const profile of ['development', 'preview', 'production']) expect(build[profile].node, profile).toBe(node);
    for (const [name, profile] of Object.entries(build)) if (profile.node) expect(profile.node, name).toBe(node);
    const eas = yamlIn('apps/mobile/.eas/workflows');
    expect(eas.length).toBeGreaterThan(0);
    for (const [path, text] of eas) for (const [, v] of text.matchAll(/^\s+node: '([^']+)'/gm)) expect(v, path).toBe(node);
  });

  it('runs server jobs on that version', () => {
    expect(read('apps/web/jobs/Dockerfile')).toMatch(new RegExp(`^FROM node:${node.replaceAll('.', '\\.')}-slim$`, 'm'));
  });

  it('sets up Node in CI from .node-version only', () => {
    let steps = 0;
    for (const [path, text] of workflows) {
      expect(text, path).not.toMatch(/node-version:/);
      for (const m of text.matchAll(/uses: actions\/setup-node@[^\n]*\n\s+with: ([^\n]*)/g)) {
        steps++;
        expect(m[1], path).toMatch(/node-version-file: \.node-version/);
        // setup-node caches on its own once package.json names a packageManager; a step that
        // sets no cache must say so, as a job running untrusted code must share none.
        expect(m[1], path).toMatch(/cache: npm|package-manager-cache: false/);
      }
    }
    expect(steps).toBeGreaterThan(0);
  });

  it('runs every third-party action at a commit, with the release it is in a comment', () => {
    for (const [path, text] of workflows)
      for (const [, uses] of text.matchAll(/uses:\s*([^\s]+(?:\s*#\s*\S+)?)/g)) {
        if (uses.startsWith('./')) continue;
        expect(uses, path).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+(\.\d+)*$/);
      }
  });

  it('type-checks with TypeScript 7 and lends the TypeScript 6 API to the tools that need one (decisions.md 246)', () => {
    // Two installed packages ship a `tsc`: TypeScript 7 (`@typescript/native`) and the TypeScript 6
    // that `@typescript/typescript6` re-exports. npm links the direct dependency's; this holds it.
    expect(execFileSync('node_modules/.bin/tsc', ['-v'], { encoding: 'utf8' })).toMatch(/^Version 7\./);
    expect(execFileSync('node_modules/.bin/tsc6', ['-v'], { encoding: 'utf8' })).toMatch(/^Version 6\./);
    expect(createRequire(import.meta.url)('typescript').version).toMatch(/^6\./);
    const pkg = JSON.parse(read('package.json'));
    const mobile = JSON.parse(read('apps/mobile/package.json'));
    expect(pkg.devDependencies.typescript).toBe(mobile.devDependencies.typescript);
    expect(pkg.devDependencies['@typescript/native']).toMatch(/^npm:typescript@7\.\d+\.\d+$/);
  });

  it('installs with the npm that Node ships with, and types only the Node it runs on', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.packageManager).toMatch(/^npm@11\.\d+\.\d+$/);
    expect(pkg.devEngines.runtime.name).toBe('node');
    expect(pkg.devEngines.runtime.version).toMatch(new RegExp(`^\\^${major}\\.`));
    expect(pkg.devEngines.packageManager).toMatchObject({ name: 'npm', version: '^11.0.0' });
    expect(pkg.devDependencies['@types/node']).toMatch(new RegExp(`^\\^${major}\\.`));
  });
});
