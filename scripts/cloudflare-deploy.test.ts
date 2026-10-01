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

  it('serves only the built page, never the Vite-built Worker or its copy of .dev.vars beside it', () => {
    expect(parseJsonc(read('apps/web/wrangler.jsonc')).assets.directory).toBe('./dist/client');
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
});
