import { readFileSync } from 'node:fs';

import { deployArgs, envKeyNames, requiredSecretNames, secretsFor } from './cloudflare-deploy.mjs';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

const WORKERS = ['apps/invite-email', 'apps/web'].flatMap((dir) =>
  (['production', 'preview'] as const).map((environment) => ({
    config: `${dir}/wrangler.jsonc`,
    env: `${dir}/.env.${environment}`,
    environment
  })));

describe('cloudflare deploy', () => {
  it('reads required secret names from a wrangler file that has comments', () => {
    const text = `{
      "$schema": "https://example.com/schema.json",
      // the url is not configured here
      "secrets": { "required": ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] }
    }`;
    expect(requiredSecretNames(text)).toEqual(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  });

  it('reads a named environment\'s own secrets, which wrangler does not inherit', () => {
    const text = `{
      "secrets": { "required": ["A"] },
      "env": { "preview": { "secrets": { "required": ["B"] } } }
    }`;
    expect(requiredSecretNames(text, 'production')).toEqual(['A']);
    expect(requiredSecretNames(text, 'preview')).toEqual(['B']);
  });

  it('uploads every declared key as a secret', () => {
    const env = {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role'
    };
    expect(secretsFor(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'])).toEqual({
      secrets: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' },
      missing: [],
      undeclared: []
    });
  });

  it('refuses a required key the env file does not hold', () => {
    expect(secretsFor({ INVITE_FROM: 'invites@frontierrnd.com' }, ['INVITE_FROM', 'INVITE_RELAY_SECRET']).missing)
      .toEqual(['INVITE_RELAY_SECRET']);
  });

  it('refuses a key the wrangler file does not declare, so no value goes up as a plain var', () => {
    expect(secretsFor({ STRAY: 'x', INVITE_FROM: 'a' }, ['INVITE_FROM']).undeclared).toEqual(['STRAY']);
  });

  it('keeps every value off the command line', () => {
    const args = deployArgs({ config: 'apps/web/wrangler.jsonc', secretsFile: '/tmp/secrets.json', workersCi: false });
    expect(args).toEqual(['deploy', '-c', 'apps/web/wrangler.jsonc', '--secrets-file', '/tmp/secrets.json', '--profile', 'langquest-email']);
  });

  it('deploys a preview env file to the -preview Worker', () => {
    const args = deployArgs({ config: 'apps/web/wrangler.jsonc', secretsFile: '/tmp/s.json', workersCi: true, environment: 'preview' });
    expect(args).toEqual(['deploy', '-c', 'apps/web/wrangler.jsonc', '--secrets-file', '/tmp/s.json', '--env', 'preview']);
    expect(deployArgs({ config: 'c', secretsFile: 's', workersCi: true, environment: 'production' })).not.toContain('--env');
  });

  it('uses Cloudflare\'s build token instead of a local profile on Workers Builds', () => {
    const args = deployArgs({ config: 'apps/invite-email/wrangler.jsonc', secretsFile: '/tmp/secrets.json', workersCi: true });
    expect(args).not.toContain('--profile');
  });

  it('declares every key each worker env file holds, so the deploy and wrangler types agree', () => {
    for (const { config, env, environment } of WORKERS) {
      const declared = requiredSecretNames(read(config), environment);
      for (const key of envKeyNames(read(env))) expect(declared, `${env}: ${key}`).toContain(key);
    }
  });

  it('gives the preview Worker the same settings as production', () => {
    for (const dir of ['apps/invite-email', 'apps/web']) {
      const text = read(`${dir}/wrangler.jsonc`);
      expect(requiredSecretNames(text, 'preview'), dir).toEqual(requiredSecretNames(text, 'production'));
    }
  });

  it('does not hardcode the hosted project url in either worker config', () => {
    for (const { config } of WORKERS) expect(read(config)).not.toContain('xymxnebdwtbkfxlbylch');
  });
});
