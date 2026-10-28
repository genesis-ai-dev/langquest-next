/**
 * The local database as a phone or the web app needs it, from the
 * commands that bring it up:
 *
 *   npm run db:start    supabase start, then the rest below
 *   npm run db:reset    supabase db reset, then the rest below
 *   npm run dev         db:start, then the web Worker on :8787 until Ctrl-C
 *
 * The rest: push delivery every minute on the local Edge Function
 * `push-delivery`, as on a hosted database (decisions.md 68), the
 * LangQuest library seeded when the database has none of its items, and the
 * language list (Glottolog's languoids, docs/languoids.md) loaded when its
 * tables are empty. All are gone after a reset, which is why reset does them
 * again. The languoids are left out on CI (a 110 MB fetch no test needs);
 * locally the release is fetched once and cached (GLOTTOLOG_CACHE), and a
 * load that fails only warns: the database works without the list.
 *
 * The projection pass is not scheduled here: it runs in the app's Worker's
 * job container, as on a hosted project, while `npm run web:dev` fires the
 * job tick every minute (scripts/job-tick.mjs, decisions.md 141, 148). A
 * database without the Worker running gets no Inbox rows from work, no
 * listings and no server snapshots; `npm run dev` starts both.
 *
 * `npm run db:test` resets with `supabase db reset` directly, so no push job
 * runs and no language list is loaded under its smokes; a web Worker left running would still project
 * (they count snapshots and Inbox rows), so stop it first.
 * `npm run guardrails -- --all` runs db:start after it, before the UI tests.
 * Nothing here is in `seed.sql`, which preview branches run too.
 *
 * `npm run dev` is the whole local stack in one command: the web Worker serves
 * Reports and the Bible routes and runs the projection pass (apps/web,
 * `npm run web:dev`, which needs Docker for the job container); the app
 * reaches it at EXPO_PUBLIC_API_URL. Ctrl-C stops the Worker; the database keeps
 * running (`npm run db:stop`). If another session already serves :8787, its
 * Worker is used. The invite-email Worker is not run: it sends through
 * Cloudflare's email binding, which has no local stand-in.
 *
 * Push delivery's secret is local only, in `supabase/functions/.env` (git
 * ignores it), which the local Edge Functions read when the stack starts.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { CRON_JOB, SCHEDULE_MIGRATION, vaultSql } from './secrets.mjs';
import { root } from './env-files.mjs';

const DB = 'supabase_db_langquest-next';
const FUNCTIONS = 'supabase_edge_runtime_langquest-next';
/** The gateway as the database container reaches it (pg_net runs there). */
const FROM_DB = 'http://kong:8000';
const FUNCTIONS_ENV = join(root, 'supabase/functions/.env');
const KEY = 'PUSH_DELIVERY_SECRET';
/** Its name before 2026-10-20 (decisions.md 148): a stack made earlier keeps its value under the new name. */
const OLD_KEY = 'PROJECTION_WORKER_SECRET';
const WEB_PORT = 8787;
/** The Glottolog release the local language list is loaded from (scripts/languoids.ts). */
const GLOTTOLOG_RELEASE = 'v5.3';
const mode = process.argv[2];
/**
 * Services `supabase start` leaves out: CI sets SUPABASE_EXCLUDE=studio,imgproxy,...
 * (guardrails.yml) so a runner pulls and runs only the containers the tests
 * use; a developer's machine gets them all.
 */
const EXCLUDE = process.env.SUPABASE_EXCLUDE?.trim();

function sh(cmd, args, input) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', input, stdio: input === undefined && cmd === 'npx' ? 'inherit' : 'pipe' });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || `${cmd} ${args.join(' ')} failed`).trim());
  return r.stdout ?? '';
}
const psql = (sql) => sh('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], sql);
const running = () => sh('docker', ['ps', '--format', '{{.Names}}']).split('\n').includes(DB);
/**
 * The database up and the Edge Functions not. When Docker starts again (a
 * machine or Docker Desktop restarted), it restarts the database's containers
 * but not the edge runtime's, and `supabase start` counts that stack as
 * running and leaves it so: every function call then fails (a cloud machine,
 * 2026-10-28, all P0 UI tests that sign someone in).
 */
function partial() {
  if (EXCLUDE?.split(',').includes('edge-runtime')) return false;
  const names = sh('docker', ['ps', '--format', '{{.Names}}']).split('\n');
  return names.includes(DB) && !names.includes(FUNCTIONS);
}

/** The local secret, made once. True when it is new. */
function ensureSecret() {
  const text = existsSync(FUNCTIONS_ENV) ? readFileSync(FUNCTIONS_ENV, 'utf8') : '';
  const found = new RegExp(`^${KEY}=(.+)$`, 'm').exec(text)?.[1]?.replace(/^"|"$/g, '');
  if (found) return { secret: found, fresh: false };
  const old = new RegExp(`^${OLD_KEY}=(.+)$`, 'm').exec(text);
  if (old) {
    // The running edge runtime still has the old name, which push-delivery also reads, so nothing needs a restart.
    writeFileSync(FUNCTIONS_ENV, text.replace(old[0], `${KEY}=${old[1]}`));
    return { secret: old[1].replace(/^"|"$/g, ''), fresh: false };
  }
  const secret = randomBytes(32).toString('hex');
  writeFileSync(FUNCTIONS_ENV, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${KEY}=${secret}\n`);
  return { secret, fresh: true };
}

/** What a reset drops: push delivery's Vault values and job, the library, and the language list. */
function prepare(secret) {
  psql(vaultSql({ langquest_project_url: FROM_DB, langquest_push_delivery_secret: secret }));
  // Also unschedules the Edge pass an older checkout scheduled here (decisions.md 148).
  psql(readFileSync(join(root, SCHEDULE_MIGRATION), 'utf8'));
  if (psql(`select count(*) from cron.job where jobname = '${CRON_JOB}';`).trim() !== '1') throw new Error(`${CRON_JOB} was not scheduled`);
  console.log(`✓ push delivery every minute (select * from net._http_response shows its answers); the projection pass runs while npm run web:dev does`);
  // LangQuest's own items: the server smokes leave other orgs' rows behind.
  if (Number(psql("select count(*) from public.library_items where org_id = 'langquest';").trim()) === 0) sh('npx', ['tsx', 'scripts/library-seed.ts']);
  else console.log('✓ library already seeded');
  loadLanguoids();
}

/** The language list people link their languages to, when it is empty (docs/languoids.md). */
function loadLanguoids() {
  if (process.env.CI) {
    console.log('- language list left out on CI');
    return;
  }
  if (Number(psql('select count(*) from public.languoid;').trim()) > 0) {
    console.log('✓ language list already loaded');
    return;
  }
  console.log(`→ loading the language list from Glottolog ${GLOTTOLOG_RELEASE} (the first time fetches about 110 MB)`);
  try {
    sh('npx', ['tsx', 'scripts/languoids.ts', 'apply', '--release', GLOTTOLOG_RELEASE]);
  } catch (err) {
    console.warn(`! language list not loaded (${err instanceof Error ? err.message : err}); load it with npm run languoids -- apply`);
  }
}

/** Is something already listening on the port (another session's Worker)? */
function listening(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

/** The web Worker in the foreground until Ctrl-C, which it gets too (same process group). */
async function serveWeb() {
  if (await listening(WEB_PORT)) {
    console.log(`✓ something already serves :${WEB_PORT} (another session's Worker?); using it`);
    return;
  }
  console.log(`→ web Worker on http://localhost:${WEB_PORT} (Reports, Bible routes); Ctrl-C stops it, the database keeps running`);
  const worker = spawn('npm', ['run', 'web:dev'], { cwd: root, stdio: 'inherit' });
  // Ctrl-C reaches the Worker directly; wait for it to finish rather than leave it behind.
  process.on('SIGINT', () => {});
  const code = await new Promise((resolve) => worker.on('exit', (c, signal) => resolve(signal ? 0 : c ?? 0)));
  if (code !== 0) throw new Error(`the web Worker stopped (exit ${code})`);
}

async function main() {
  if (mode !== 'start' && mode !== 'reset' && mode !== 'dev') throw new Error('usage: local-db.mjs start|reset|dev');
  const { secret, fresh } = ensureSecret();
  // The functions read their .env when the stack starts; one started without it must start again, as must one
  // without its functions (both keep the database).
  const restart = (fresh && running()) || partial();
  if (mode === 'start' || mode === 'dev' || restart) {
    if (restart) sh('npx', ['supabase', 'stop']);
    sh('npx', ['supabase', 'start', ...(EXCLUDE ? ['-x', EXCLUDE] : [])]);
  }
  if (mode === 'reset') sh('npx', ['supabase', 'db', 'reset']);
  prepare(secret);
  if (mode === 'dev') await serveWeb();
}

main().catch((err) => {
  console.error(`x ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
