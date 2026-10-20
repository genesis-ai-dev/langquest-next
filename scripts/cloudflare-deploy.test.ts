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

  it('points the admin page at the production project and the dashboard\'s account, with no secret in its vars', () => {
    const admin = parseJsonc(read('apps/admin/wrangler.jsonc'));
    const web = parseJsonc(read('apps/web/wrangler.jsonc'));
    const ref = projectRef(read('supabase/config.toml'), 'production');
    expect(admin.vars.SUPABASE_URL).toBe(`https://${ref}.supabase.co`);
    expect(admin.vars.SUPABASE_PROJECTS.split(',')[0]).toMatch(new RegExp(`^${ref}:`));
    expect(admin.vars.SUPABASE_ANON_KEY).toBe(web.vars.SUPABASE_ANON_KEY);
    expect([admin.account_id, admin.vars.CLOUDFLARE_ACCOUNT_ID]).toEqual([web.account_id, web.account_id]);
    expect(admin.vars.CLOUDFLARE_WORKERS.split(',')).toEqual(expect.arrayContaining([web.name, admin.name]));
    expect(Object.keys(admin.vars).filter((k) => /TOKEN|SECRET|PASSWORD|DATABASE_URL|PROFILE_IDS|_KEY$/.test(k) && k !== 'SUPABASE_ANON_KEY')).toEqual([]);
    // The app the store and Expo sections read is the one the app's own config names.
    const app = JSON.parse(read('apps/mobile/app.json')).expo;
    const eas = JSON.parse(read('apps/mobile/eas.json'));
    expect(admin.vars.GOOGLE_PLAY_PACKAGE).toBe(app.android.package);
    expect(admin.vars.EXPO_PROJECT_ID).toBe(app.extra.eas.projectId);
    expect(admin.vars.APP_STORE_APP_ID).toBe(eas.submit.production.ios.ascAppId);
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

  // The job runner (docs/server-jobs.md, decisions.md 141).
  it('runs the job container in both environments, one instance per job, through the object that locks each', () => {
    const config = parseJsonc(read('apps/web/wrangler.jsonc'));
    for (const env of ['production', 'preview']) {
      const c = wranglerFor(config, env);
      expect(c.containers, env).toEqual([
        { class_name: 'JobRunner', image: './jobs/Dockerfile', instance_type: 'standard-1', max_instances: 2, constraints: { regions: ['ENAM'] } }
      ]);
      expect(c.durable_objects?.bindings, env).toContainEqual({ name: 'JOBS', class_name: 'JobRunner' });
    }
    // The job tick starts the jobs; preview never imports from v2.
    expect(config.triggers.crons).toContain('*/5 * * * *');
    expect(wranglerFor(config, 'production').vars?.V2_IMPORT_ENABLED).toBe('true');
    expect(wranglerFor(config, 'preview').vars?.V2_IMPORT_ENABLED).toBe('false');
    for (const env of ['production', 'preview']) expect(wranglerFor(config, env).vars?.API_URL, env).toBe(`https://${wranglerFor(config, env).routes[0].pattern}`);
    const classes = (config.migrations as { new_sqlite_classes?: string[] }[]).flatMap((m) => m.new_sqlite_classes ?? []);
    expect(classes).toContain('JobRunner');
  });

  it('builds the job image from bundles alone, never installing the dependency tree beside the key', () => {
    // Its instructions, without the comments that explain them.
    const dockerfile = read('apps/web/jobs/Dockerfile').split('\n').filter((l) => !l.startsWith('#')).join('\n');
    expect(dockerfile).not.toMatch(/\b(npm|npx|yarn|pnpm|corepack)\b/);
    // The one system package: psql, for the v2 import's people (server/v2.ts).
    expect(dockerfile.match(/^RUN .*/gm)).toEqual([expect.stringMatching(/^RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && /)]);
    expect(dockerfile).toMatch(/^COPY dist\/ /m);
    // The bundles are built before every deploy and dev run, not committed.
    const scripts = (JSON.parse(read('apps/web/package.json')) as { scripts: Record<string, string> }).scripts;
    for (const name of ['dev', 'build', 'build:preview']) expect(scripts[name], name).toContain('build-jobs.mjs');
    expect(read('.gitignore')).toContain('apps/web/jobs/dist/');
  });
});
