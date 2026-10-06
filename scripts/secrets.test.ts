import { readFileSync, readdirSync } from 'node:fs';

import { parseJsonc, wranglerFor } from './env-files.mjs';
import {
  FILE_KEYS, REQUIRED_KEYS, SCHEDULE_MIGRATION, WORKERS, destinations, digest, drift, failure, queryRows, relayUrl, summarize, unknownKeys, vaultSql
} from './secrets.mjs';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const values = { INVITE_RELAY_SECRET: 'relay', PROJECTION_WORKER_SECRET: 'proj' };

describe('secrets', () => {
  it('sets exactly the secrets each Worker requires, so a deploy never stops for one', () => {
    for (const env of ['production', 'preview']) {
      const wanted = destinations(env, values, 'ref', 'service');
      for (const [worker, config] of Object.entries(WORKERS)) {
        const required = wranglerFor(parseJsonc(read(config)), env).secrets?.required ?? [];
        expect(Object.keys(wanted.workers[worker as keyof typeof WORKERS]).sort(), `${worker} ${env}`).toEqual([...required].sort());
      }
    }
  });

  it('sets every secret an Edge Function reads, except the ones Supabase sets itself', () => {
    // Every function folder, and the `_shared` code they import.
    const names = readdirSync(new URL('../supabase/functions', import.meta.url))
      .flatMap((dir) => readdirSync(new URL(`../supabase/functions/${dir}`, import.meta.url))
        .filter((file) => file.endsWith('.ts'))
        .map((file) => `supabase/functions/${dir}/${file}`))
      .flatMap((file) => [...read(file).matchAll(/Deno\.env\.get\(['"]([A-Z_]+)['"]\)/g)].map((m) => m[1]))
      .filter((name) => !name.startsWith('SUPABASE_'));
    expect(Object.keys(destinations('production', values, 'ref', 'k').functions).sort()).toEqual([...new Set(names)].sort());
  });

  it('writes the Vault names the projection cron job reads', () => {
    const sql = read(SCHEDULE_MIGRATION);
    const { vault } = destinations('preview', values, 'abc', 'k');
    for (const name of Object.keys(vault)) expect(sql).toMatch(new RegExp(`name\\s*=\\s*'${name}'`));
    expect(vault.langquest_project_url).toBe('https://abc.supabase.co');
  });

  it('sends one relay secret to both ends, so they cannot drift apart', () => {
    const wanted = destinations('production', values, 'ref', 'k');
    expect(wanted.workers['invite-email'].INVITE_RELAY_SECRET).toBe(wanted.functions.INVITE_RELAY_SECRET);
  });

  it('points the relay at each environment\'s invite-email Worker', () => {
    const name = (env: string) => (env === 'production' ? '' : `-${env}`);
    for (const env of ['production', 'preview']) {
      expect(relayUrl(env)).toMatch(new RegExp(`^https://${parseJsonc(read(WORKERS['invite-email'])).name}${name(env)}\\.`));
    }
  });

  it('refuses a key it would neither place nor knowingly keep local', () => {
    expect(unknownKeys([...FILE_KEYS, 'STRAY'])).toEqual(['STRAY']);
    for (const key of REQUIRED_KEYS) expect(FILE_KEYS).toContain(key);
  });

  it('compares digests, never values', () => {
    expect(drift({ A: 'x', B: 'y', C: 'z' }, { A: digest('x'), B: digest('other') }))
      .toEqual({ A: 'same', B: 'differs', C: 'missing' });
  });

  it('reports a missing Worker secret or cron job as behind', () => {
    const ok = { workers: { dashboard: { K: 'set' } }, functions: { A: 'same' }, vault: { V: 'same' }, scheduled: true };
    expect(summarize(ok).behind).toBe(false);
    expect(summarize({ ...ok, workers: { dashboard: { K: 'missing' } } }).behind).toBe(true);
    expect(summarize({ ...ok, scheduled: false }).behind).toBe(true);
  });

  it('reads query rows in either shape the Supabase CLI prints', () => {
    expect(queryRows([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(queryRows({ boundary: 'x', rows: [{ a: 1 }] })).toEqual([{ a: 1 }]);
  });

  it('shows the command\'s own error, not npm\'s notices', () => {
    const stdout = '{"_tag":"Error","error":{"code":"X","message":"--project-ref only applies with --linked"}}\n';
    expect(failure(stdout, 'npm notice run langquest-next@0.0.1 npx\nnpm notice run supabase db query\n'))
      .toBe('--project-ref only applies with --linked');
  });

  it('quotes Vault values so a quote cannot end the literal', () => {
    const sql = vaultSql({ n: "a'b" });
    expect(sql).toContain("vault.create_secret('a''b', 'n')");
    expect(sql).toContain("vault.update_secret(existing, 'a''b')");
  });
});
