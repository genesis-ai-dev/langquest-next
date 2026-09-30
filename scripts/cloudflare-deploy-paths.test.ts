import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

import { jobsFor } from './cloudflare-deploy-paths.mjs';

// Which worker a changed file deploys. The literals are the path split:
// invite email stays off the dashboard, and the dashboard stays off email.

describe('cloudflare deploy paths', () => {
  it('deploys invite email alone when only that worker changed', () => {
    expect(jobsFor([
      'apps/invite-email/src/index.ts',
      'apps/invite-email/wrangler.jsonc'
    ])).toEqual({ email: true, web: false });
  });

  it('deploys the dashboard alone when the web app, core, client, or the lockfile changed', () => {
    for (const file of [
      'apps/web/src/main.tsx',
      'apps/web/wrangler.jsonc',
      'packages/core/src/events.ts',
      'packages/core/package.json',
      'packages/client/src/sync.ts',
      'package-lock.json'
    ]) {
      expect(jobsFor([file])).toEqual({ email: false, web: true });
    }
  });

  it('deploys both workers when one push changes both', () => {
    expect(jobsFor([
      'apps/invite-email/src/index.ts',
      'packages/core/src/events.ts'
    ])).toEqual({ email: true, web: true });
  });

  it('deploys neither for a path outside either worker', () => {
    expect(jobsFor([
      'docs/decisions.md',
      'apps/mobile/src/flow.ts',
      'apps/invite-email-extra/src/index.ts',
      'apps/web-extra/src/main.tsx',
      'packages/core-extra/src/index.ts'
    ])).toEqual({ email: false, web: false });
  });

  it('prints email= and web= for the workflow to record', () => {
    const out = spawnSync(process.execPath, ['scripts/cloudflare-deploy-paths.mjs'], {
      input: 'apps/invite-email/src/index.ts\npackages/client/src/sync.ts\n',
      encoding: 'utf8'
    });
    expect(out.status).toBe(0);
    expect(out.stdout).toBe('email=true\nweb=true\n');
  });
});

describe('deploy-cloudflare workflow', () => {
  const wf = () => parse(readFileSync(new URL('../.github/workflows/deploy-cloudflare.yml', import.meta.url), 'utf8'));

  it('runs on push to main for exactly the paths that select a worker', () => {
    expect(wf().on.push.branches).toEqual(['main']);
    expect(wf().on.push.paths).toEqual([
      'apps/invite-email/**',
      'apps/web/**',
      'packages/core/**',
      'packages/client/**',
      'package-lock.json'
    ]);
  });

  it('lets a newer main push wait instead of cancelling a deploy', () => {
    expect(wf().concurrency).toEqual({
      group: 'deploy-cloudflare',
      'cancel-in-progress': false
    });
  });

  it('typechecks and tests, then deploys each worker only when its paths changed', () => {
    const jobs = wf().jobs;
    const runs = (job) => job.steps.map((step) => step.run).filter(Boolean);
    expect(runs(jobs.checks).join('\n')).toContain('node scripts/cloudflare-deploy-paths.mjs');
    expect(runs(jobs.checks)).toEqual(expect.arrayContaining(['npm run typecheck', 'npx vitest run']));
    expect(jobs.email.needs).toEqual(['checks']);
    expect(jobs.web.needs).toEqual(['checks']);
    expect(jobs.email.if).toBe("needs.checks.outputs.email == 'true'");
    expect(jobs.web.if).toBe("needs.checks.outputs.web == 'true'");
    expect(runs(jobs.email)).toContain('npm run email:deploy');
    expect(runs(jobs.web)).toContain('npm run web:deploy');
  });
});
