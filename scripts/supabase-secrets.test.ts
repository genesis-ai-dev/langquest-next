import { readFileSync, readdirSync } from 'node:fs';

import { FUNCTION_SECRETS, LOCAL_KEYS, digest, drift, unknownKeys, vaultSecrets, vaultSql } from './supabase-secrets.mjs';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

describe('supabase secrets', () => {
  it('pushes every secret an Edge Function reads, except the ones Supabase sets itself', () => {
    const read_ = readdirSync(new URL('../supabase/functions', import.meta.url))
      .flatMap((fn) => [...read(`supabase/functions/${fn}/index.ts`).matchAll(/Deno\.env\.get\(['"]([A-Z_]+)['"]\)/g)].map((m) => m[1]))
      .filter((name) => !name.startsWith('SUPABASE_'));
    expect([...new Set(read_)].sort()).toEqual([...FUNCTION_SECRETS].sort());
  });

  it('writes the Vault names the projection cron job reads', () => {
    const sql = read('server/schedule-projections.sql');
    for (const name of Object.keys(vaultSecrets({}))) expect(sql).toContain(`name='${name}'`);
    expect(vaultSecrets({ SUPABASE_PROJECT_REF: 'abc', PROJECTION_WORKER_SECRET: 's' }))
      .toEqual({ langquest_project_url: 'https://abc.supabase.co', langquest_projection_worker_secret: 's' });
  });

  it('refuses a key it would neither push nor knowingly keep local', () => {
    expect(unknownKeys([...FUNCTION_SECRETS, ...LOCAL_KEYS, 'STRAY'])).toEqual(['STRAY']);
  });

  it('compares digests, never values', () => {
    expect(drift({ A: 'x', B: 'y', C: 'z' }, { A: digest('x'), B: digest('other') }))
      .toEqual({ A: 'same', B: 'differs', C: 'missing' });
  });

  it('quotes Vault values so a quote cannot end the literal', () => {
    const sql = vaultSql({ n: "a'b" });
    expect(sql).toContain("vault.create_secret('a''b', 'n')");
    expect(sql).toContain("vault.update_secret(existing, 'a''b')");
  });
});
