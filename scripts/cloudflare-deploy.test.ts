import { readFileSync } from 'node:fs';

import { deployArgs } from './cloudflare-deploy.mjs';
import { parseJsonc, projectRef, wranglerFor } from './env-files.mjs';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const CONFIGS = ['apps/invite-email/wrangler.jsonc', 'apps/web/wrangler.jsonc'];

describe('cloudflare deploy', () => {
  it('deploys code and vars only, so no build needs a key', () => {
    expect(deployArgs({ config: 'apps/web/wrangler.jsonc', workersCi: true }))
      .toEqual(['deploy', '-c', 'apps/web/wrangler.jsonc', '--env=']);
  });

  it('deploys preview to the -preview Worker', () => {
    expect(deployArgs({ config: 'apps/web/wrangler.jsonc', workersCi: true, environment: 'preview' }))
      .toEqual(['deploy', '-c', 'apps/web/wrangler.jsonc', '--env=preview']);
  });

  it('uses the local profile off Workers Builds', () => {
    expect(deployArgs({ config: 'c', workersCi: false })).toContain('--profile');
  });

  it('gives preview the same secrets and vars as production, which wrangler does not inherit', () => {
    for (const file of CONFIGS) {
      const config = parseJsonc(read(file));
      const [prod, preview] = ['production', 'preview'].map((env) => wranglerFor(config, env));
      expect(preview.secrets?.required, file).toEqual(prod.secrets?.required);
      // The preview SUPABASE_URL waits for [remotes.preview]; see the next test.
      const keys = (vars: Record<string, string> = {}) => Object.keys(vars).filter((k) => k !== 'SUPABASE_URL');
      expect(keys(preview.vars), file).toEqual(keys(prod.vars));
    }
  });

  it('points each dashboard at the project supabase/config.toml names for its environment', () => {
    const toml = read('supabase/config.toml');
    const config = parseJsonc(read('apps/web/wrangler.jsonc'));
    for (const env of ['production', 'preview']) {
      const ref = projectRef(toml, env);
      const url = wranglerFor(config, env).vars?.SUPABASE_URL;
      if (env === 'production') expect(ref).toBeTruthy();
      if (ref || url) expect(url, env).toBe(`https://${ref}.supabase.co`);
    }
  });

  it('serves the app\'s web export, which holds no Worker code, .dev.vars or source maps', () => {
    expect(parseJsonc(read('apps/web/wrangler.jsonc')).assets.directory).toBe('../mobile/dist');
  });

  it('keeps every secret out of vars, where a deploy would publish it', () => {
    for (const file of CONFIGS) {
      const config = parseJsonc(read(file));
      for (const env of ['production', 'preview']) {
        const { vars = {}, secrets } = wranglerFor(config, env);
        for (const name of secrets?.required ?? []) expect(Object.keys(vars), `${file} ${env}`).not.toContain(name);
      }
    }
  });

  // The job runner (docs/server-jobs.md, decisions.md 140).
  it('runs the job container in both environments, one instance, through the object that locks it', () => {
    const config = parseJsonc(read('apps/web/wrangler.jsonc'));
    for (const env of ['production', 'preview']) {
      const c = wranglerFor(config, env);
      expect(c.containers, env).toEqual([
        { class_name: 'JobRunner', image: './jobs/Dockerfile', instance_type: 'standard-1', max_instances: 1 }
      ]);
      expect(c.durable_objects?.bindings, env).toContainEqual({ name: 'JOBS', class_name: 'JobRunner' });
    }
    const classes = (config.migrations as { new_sqlite_classes?: string[] }[]).flatMap((m) => m.new_sqlite_classes ?? []);
    expect(classes).toContain('JobRunner');
  });

  it('builds the job image from bundles alone, never installing the dependency tree beside the key', () => {
    const dockerfile = read('apps/web/jobs/Dockerfile');
    expect(dockerfile).not.toMatch(/\b(npm|npx|yarn|pnpm|RUN)\b/);
    expect(dockerfile).toMatch(/^COPY dist\/ /m);
    // The bundles are built before every deploy and dev run, not committed.
    const scripts = (JSON.parse(read('apps/web/package.json')) as { scripts: Record<string, string> }).scripts;
    for (const name of ['dev', 'build', 'build:preview']) expect(scripts[name], name).toContain('build-jobs.mjs');
    expect(read('.gitignore')).toContain('apps/web/jobs/dist/');
  });
});
