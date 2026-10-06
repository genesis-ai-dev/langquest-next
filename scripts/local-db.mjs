/**
 * The local database as a phone or the web app needs it, from the two
 * commands that bring it up:
 *
 *   npm run db:start    supabase start, then the rest below
 *   npm run db:reset    supabase db reset, then the rest below
 *
 * The rest: the projection worker scheduled every minute (decisions.md 42),
 * as `npm run secrets` schedules it every five on a hosted database, and the
 * LangQuest library seeded when the database has none. Both are gone after a
 * reset, which is why reset does them again.
 *
 * `npm run db:test` resets with `supabase db reset` directly, so no worker
 * pass runs under its smokes (they count snapshots and Inbox rows). Nothing
 * here is in `seed.sql`, which preview branches run too.
 *
 * The worker's secret is local only, in `supabase/functions/.env` (git
 * ignores it), which the local Edge Functions read when the stack starts.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { CRON_JOB, SCHEDULE_MIGRATION, vaultSql } from './secrets.mjs';
import { root } from './env-files.mjs';

const DB = 'supabase_db_langquest-next';
/** The gateway as the database container reaches it (pg_net runs there). */
const FROM_DB = 'http://kong:8000';
const FUNCTIONS_ENV = join(root, 'supabase/functions/.env');
const KEY = 'PROJECTION_WORKER_SECRET';
const mode = process.argv[2];

function sh(cmd, args, input) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', input, stdio: input === undefined && cmd === 'npx' ? 'inherit' : 'pipe' });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || `${cmd} ${args.join(' ')} failed`).trim());
  return r.stdout ?? '';
}
const psql = (sql) => sh('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], sql);
const running = () => sh('docker', ['ps', '--format', '{{.Names}}']).split('\n').includes(DB);

/** The local secret, made once. True when it is new. */
function ensureSecret() {
  const text = existsSync(FUNCTIONS_ENV) ? readFileSync(FUNCTIONS_ENV, 'utf8') : '';
  const found = new RegExp(`^${KEY}=(.+)$`, 'm').exec(text)?.[1]?.replace(/^"|"$/g, '');
  if (found) return { secret: found, fresh: false };
  const secret = randomBytes(32).toString('hex');
  writeFileSync(FUNCTIONS_ENV, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${KEY}=${secret}\n`);
  return { secret, fresh: true };
}

/** What a reset drops: the worker's Vault values and job, and the library. */
function prepare(secret) {
  psql(vaultSql({ langquest_project_url: FROM_DB, langquest_projection_worker_secret: secret }));
  psql(readFileSync(join(root, SCHEDULE_MIGRATION), 'utf8'));
  // Every minute here, so what one phone asks shows on the other without waiting.
  const scheduled = psql(`select cron.schedule(jobname, '* * * * *', command) from cron.job where jobname = '${CRON_JOB}';`).trim();
  if (!scheduled) throw new Error(`${CRON_JOB} was not scheduled`);
  console.log(`✓ projection worker every minute (select * from net._http_response shows its answers)`);
  if (Number(psql('select count(*) from public.library_items;').trim()) === 0) sh('npx', ['tsx', 'scripts/library-seed.ts']);
  else console.log('✓ library already seeded');
}

function main() {
  if (mode !== 'start' && mode !== 'reset') throw new Error('usage: local-db.mjs start|reset');
  const { secret, fresh } = ensureSecret();
  // The functions read their .env when the stack starts; one started without it must start again (keeps the database).
  if (mode === 'start' || (fresh && running())) {
    if (fresh && running()) sh('npx', ['supabase', 'stop']);
    sh('npx', ['supabase', 'start']);
  }
  if (mode === 'reset') sh('npx', ['supabase', 'db', 'reset']);
  prepare(secret);
}

try {
  main();
} catch (err) {
  console.error(`x ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
