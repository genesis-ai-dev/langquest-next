import { readFileSync, readdirSync } from 'node:fs';

import { parseJsonc, wranglerFor } from './env-files.mjs';
import {
  ADMIN_KEYS, FILE_KEYS, OPTIONAL_KEYS, REQUIRED_KEYS, SCHEDULE_MIGRATION, WEBHOOK_MIGRATION, WORKERS, destinations, digest, drift, failure, queryRows, relayUrl, summarize, unknownKeys, vaultSql, workersIn
} from './secrets.mjs';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const values = { INVITE_RELAY_SECRET: 'relay', PROJECTION_WORKER_SECRET: 'proj' };

describe('secrets', () => {
  it('sets exactly the secrets each Worker requires, so a deploy never stops for one', () => {
    for (const env of ['production', 'preview']) {
      const wanted = destinations(env, { ...values, DIAG_DATABASE_URL: 'postgresql://diag' }, 'ref', 'service');
      expect(Object.keys(wanted.workers).sort(), env).toEqual(Object.keys(workersIn(env)).sort());
      for (const [worker, config] of Object.entries(workersIn(env))) {
        const required = wranglerFor(parseJsonc(read(config as string)), env).secrets?.required ?? [];
        expect(Object.keys(wanted.workers[worker as keyof typeof WORKERS]).sort(), `${worker} ${env}`).toEqual([...required].sort());
      }
    }
  });

  it("gives the admin page diag_reader's login and the tokens the file has, never the service-role key, and only in production", () => {
    const file = { ...values, DIAG_DATABASE_URL: 'postgresql://diag', ADMIN_PROFILE_IDS: 'a,b', ADMIN_VERCEL_TOKEN: 'v', ADMIN_GITHUB_TOKEN: '' };
    expect(destinations('production', file, 'ref', 'service').workers.admin).toEqual({ DIAG_DATABASE_URL: 'postgresql://diag', ADMIN_PROFILE_IDS: 'a,b', ADMIN_VERCEL_TOKEN: 'v' });
    expect(destinations('preview', file, 'ref', 'service').workers).not.toHaveProperty('admin');
    for (const key of ADMIN_KEYS) {
      expect(FILE_KEYS).toContain(key);
      expect(wranglerFor(parseJsonc(read(WORKERS.admin)), 'production').secrets?.required ?? []).not.toContain(key);
    }
  });

  it('passes the Bible Brain key to the dashboard only when the file has it, and never requires it', () => {
    const withKey = destinations('production', { ...values, BIBLE_BRAIN_ACCESS_KEY: 'bb' }, 'ref', 'service');
    expect(withKey.workers.dashboard).toEqual({ SUPABASE_SERVICE_ROLE_KEY: 'service', BIBLE_BRAIN_ACCESS_KEY: 'bb' });
    expect(destinations('production', { ...values, BIBLE_BRAIN_ACCESS_KEY: '' }, 'ref', 'service').workers.dashboard).toEqual({ SUPABASE_SERVICE_ROLE_KEY: 'service' });
    for (const key of OPTIONAL_KEYS) {
      expect(FILE_KEYS).toContain(key);
      expect(REQUIRED_KEYS).not.toContain(key);
      for (const env of ['production', 'preview']) expect(wranglerFor(parseJsonc(read(WORKERS.dashboard)), env).secrets?.required ?? []).not.toContain(key);
    }
  });

  it('sets every secret an Edge Function reads, except the ones Supabase sets itself', () => {
    // Every function folder, and the `_shared` code they import.
    // Folders only: the ignored local `.env` (scripts/local-db.mjs) sits beside them.
    const names = readdirSync(new URL('../supabase/functions', import.meta.url), { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name)
      .flatMap((dir) => readdirSync(new URL(`../supabase/functions/${dir}`, import.meta.url))
        .filter((file) => file.endsWith('.ts'))
        .map((file) => `supabase/functions/${dir}/${file}`))
      .flatMap((file) => [...read(file).matchAll(/Deno\.env\.get\(['"]([A-Z0-9_]+)['"]\)/g)].map((m) => m[1]))
      .filter((name) => !name.startsWith('SUPABASE_'));
    expect(Object.keys(destinations('production', { ...values, V2_SUPABASE_ANON_KEY: 'v2' }, 'ref', 'k').functions).sort()).toEqual([...new Set(names)].sort());
    // Without v2's key, signing in with a v2 account is simply not set up.
    expect(destinations('production', values, 'ref', 'k').functions).not.toHaveProperty('V2_SUPABASE_ANON_KEY');
  });

  it('writes the Vault names the push delivery job reads, and the schedule leaves the pass off pg_cron', () => {
    const sql = read(SCHEDULE_MIGRATION);
    const { vault } = destinations('preview', values, 'abc', 'k');
    for (const name of Object.keys(vault)) expect(sql).toMatch(new RegExp(`name\\s*=\\s*'${name}'`));
    expect(vault.langquest_project_url).toBe('https://abc.supabase.co');
    // Why: hosted projects run the pass in the Worker's job container (decisions.md 141);
    // a pg_cron pass as well would run it twice, racing the container's writes.
    expect(sql).toMatch(/cron\.unschedule[\s\S]*'langquest-stream-projections'/);
    expect(sql).not.toMatch(/cron\.schedule\(\s*'langquest-stream-projections'/);
  });

  it('gives the dashboard Worker v2\'s keys for the import\'s job, only when the file has them', () => {
    const wanted = destinations('production', { ...values, V2_SUPABASE_ANON_KEY: 'v2', V2_DATABASE_URL: 'postgres://ro' }, 'ref', 'k');
    expect(wanted.workers.dashboard).toMatchObject({ V2_SUPABASE_ANON_KEY: 'v2', V2_DATABASE_URL: 'postgres://ro' });
    expect(Object.keys(destinations('production', values, 'ref', 'k').workers.dashboard)).not.toContain('V2_DATABASE_URL');
    expect(OPTIONAL_KEYS).toContain('V2_DATABASE_URL');
  });

  it('gives the webhook poke one secret at both ends and the Worker\'s own address, only when the file has it', () => {
    const sql = read(WEBHOOK_MIGRATION);
    const wanted = destinations('preview', { ...values, WEBHOOK_POKE_SECRET: 'poke' }, 'abc', 'k');
    expect(wanted.vault.langquest_webhook_poke_secret).toBe(wanted.workers.dashboard.WEBHOOK_POKE_SECRET);
    expect(wanted.vault.langquest_dashboard_url).toBe('https://next-preview.langquest.org');
    for (const name of ['langquest_dashboard_url', 'langquest_webhook_poke_secret']) expect(sql).toMatch(new RegExp(`name\\s*=\\s*'${name}'`));
    expect(destinations('production', { ...values, WEBHOOK_POKE_SECRET: 'poke' }, 'abc', 'k').vault.langquest_dashboard_url).toBe('https://next.langquest.org');
    expect(Object.keys(destinations('preview', values, 'abc', 'k').vault)).not.toContain('langquest_webhook_poke_secret');
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
