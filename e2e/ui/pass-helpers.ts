// Waiting for the server's projection pass without waiting for the clock.
//
// The pass (server/projections.ts) writes what only it writes: the public
// listing behind Explore and Find your organization, the report inputs
// Reports renders from, server snapshots and their cuts. It runs in the job
// container behind the app's Worker, which `scripts/job-tick.mjs` pokes once
// a minute (decisions.md 148, docs/server-jobs.md). A test that needs one of
// those used to wait a minute or two for the screen; `projectionPass()` asks
// for a pass now and returns when a pass that STARTED after the call has
// finished, so what was written before the call is in what the pass wrote.
//
// What the pass does not write, and a test must not wait for it: the
// Inbox's updates (the phone derives them from its own fold), people asking
// to join and open reports (the database's triggers make those Inbox rows,
// and My Work reads `join_requests` itself), a phone's own sync.
//
// Two ways, one function:
//
// - The Worker's tick (default). GET `/__scheduled?cron=<JOB_TICK>` on the
//   Worker the suite runs against (the export's own port, UI_PORT), then poll
//   `diag.job_runs` for a 'projection' run started at or after the call. The
//   JobRunner Durable Object is the lock: a tick that finds a pass running
//   starts nothing, so the tick is sent again every few seconds until a new
//   pass has started and finished. Any number of Playwright workers may call
//   at once; they share the run. `diag` is not exposed through PostgREST, so
//   the row is read with `docker exec <db container> psql`, as other scripts
//   here do (scripts/sample-history.ts); times are the database's own, so the
//   clocks of the test runner and the container do not matter.
//
// - `UI_PASS=direct`, for a LOCAL run without the job container (another
//   checkout may share the stack and its Worker, and a second job container
//   must never start beside it): this process runs
//   `node scripts/with-local-keys.mjs npx tsx server/projections.ts` itself,
//   one at a time across Playwright workers (an exclusive mkdir lock under
//   e2e/results), and a caller whose request is older than a pass that
//   started since shares that pass. Never use it in CI, and never beside a
//   Worker that runs passes of its own: passes must not overlap.
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localServer } from './fixture';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The cron expression of the Worker's job tick (apps/web/worker/jobsModel.ts JOB_TICK; scripts/job-tick.mjs sends the same). */
const JOB_TICK = '*/5 * * * *';
/** How often the tick is sent again while waiting: a tick during a running pass starts nothing. */
const TICK_EVERY_MS = 5_000;
const POLL_EVERY_MS = 1_000;
/** Longer than a pass on a loaded runner, shorter than a test's 180 s ceiling. */
const DEFAULT_TIMEOUT_MS = 150_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface PassOptions {
  /** Give up after this long (default 150 s). */
  timeoutMs?: number;
}

/** Ask for a projection pass and wait until one that started after this call has finished. */
export async function projectionPass(options: PassOptions = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (process.env['UI_PASS'] === 'direct') return directPass(timeoutMs);
  return tickedPass(timeoutMs);
}

// ---- the Worker's tick ---------------------------------------------------------------

/** The Worker the suite runs against: the export's own port; on Metro (UI_TARGET=dev) the Worker beside it. */
function workerOrigin(): string {
  if (process.env['UI_TARGET'] === 'dev') return localServer().api;
  return `http://localhost:${process.env['UI_PORT'] ?? '8787'}`;
}

function dbContainer(): string {
  const toml = readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8');
  const id = /^project_id\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  if (!id) throw new Error('supabase/config.toml has no project_id');
  return `supabase_db_${id}`;
}

function psql(sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('docker', ['exec', dbContainer(), 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt', '-F', '|', '-c', sql],
      { encoding: 'utf8', timeout: 20_000 }, (error, stdout, stderr) => {
        if (error) reject(new Error(`psql in ${dbContainer()}: ${(stderr || error.message).trim().slice(0, 300)} (is the local Supabase running?)`));
        else resolve(stdout.trim());
      });
  });
}

async function fireTick(origin: string): Promise<string> {
  try {
    const response = await fetch(`${origin}/__scheduled?cron=${encodeURIComponent(JOB_TICK)}`, { signal: AbortSignal.timeout(10_000) });
    await response.body?.cancel();
    return response.ok ? 'sent' : `HTTP ${response.status}`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function tickedPass(timeoutMs: number): Promise<void> {
  const origin = workerOrigin();
  // The database's own clock, so a run's started_at is compared with a time from the same one.
  const since = await psql(`select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
  const deadline = Date.now() + timeoutMs;
  let tick = 'not sent';
  let nextTick = 0;
  let ticks = 0;
  for (;;) {
    if (Date.now() >= nextTick) {
      tick = await fireTick(origin);
      ticks++;
      nextTick = Date.now() + TICK_EVERY_MS;
    }
    const row = await psql(`select outcome || '|' || ms || '|' || coalesce(error_class, '') from diag.job_runs
      where job = 'projection' and started_at >= '${since}'::timestamptz order by started_at limit 1`);
    if (row) {
      const [outcome, ms, errorClass] = row.split('|');
      if (outcome === 'error') throw new Error(`The projection pass that ran for this test failed (${errorClass || 'no error class'}, ${ms} ms): see \`npm run diag -- jobs\`.`);
      return;
    }
    if (Date.now() >= deadline) {
      const last = await psql(`select outcome || ' at ' || started_at || ' (' || ms || ' ms)' from diag.job_runs where job = 'projection' order by started_at desc limit 1`).catch(() => '');
      throw new Error(`No projection pass finished within ${Math.round(timeoutMs / 1000)} s of this call (since ${since}). `
        + `Tick ${origin}/__scheduled sent ${ticks} time(s), last answer: ${tick}. Last pass on record: ${last || 'none'}. `
        + 'Is the Worker running with its job container (e2e/ui-web.sh), and was it started with --test-scheduled? For a local run without the job container, set UI_PASS=direct.');
    }
    await sleep(POLL_EVERY_MS);
  }
}

// ---- UI_PASS=direct --------------------------------------------------------------------

const LOCK = path.join(ROOT, 'e2e', 'results', 'projection-pass.lock');
const STAMP = path.join(ROOT, 'e2e', 'results', 'projection-pass.started');
/** A lock this old belongs to a run that died. */
const STALE_LOCK_MS = 10 * 60_000;

async function takeLock(deadline: number): Promise<void> {
  mkdirSync(path.dirname(LOCK), { recursive: true });
  for (;;) {
    try {
      mkdirSync(LOCK);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (existsSync(LOCK) && Date.now() - statSync(LOCK).mtimeMs > STALE_LOCK_MS) { rmSync(LOCK, { recursive: true, force: true }); continue; }
      if (Date.now() >= deadline) throw new Error(`Another projection pass held ${LOCK} for the whole wait.`);
      await sleep(500);
    }
  }
}

async function directPass(timeoutMs: number): Promise<void> {
  const requested = Date.now();
  const deadline = requested + timeoutMs;
  await takeLock(deadline);
  try {
    // A pass that started since this call (run by another worker while this one waited) has this call's data.
    const last = existsSync(STAMP) ? Number(readFileSync(STAMP, 'utf8')) : 0;
    if (last >= requested) return;
    writeFileSync(STAMP, String(Date.now()));
    const s = localServer();
    await new Promise<void>((resolve, reject) => {
      const child = spawn('node', ['scripts/with-local-keys.mjs', 'npx', 'tsx', 'server/projections.ts'], {
        cwd: ROOT, env: { ...process.env, SUPABASE_URL: s.url, SUPABASE_SERVICE_ROLE_KEY: s.service }, stdio: ['ignore', 'pipe', 'pipe']
      });
      let tail = '';
      const keep = (chunk: Buffer) => { tail = (tail + chunk.toString()).slice(-1500); };
      child.stdout.on('data', keep);
      child.stderr.on('data', keep);
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`The projection pass (UI_PASS=direct) ran over ${Math.round(timeoutMs / 1000)} s. Last output:\n${tail}`)); }, Math.max(1, deadline - Date.now()));
      child.on('error', (error) => { clearTimeout(timer); reject(error); });
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`The projection pass (UI_PASS=direct) exited ${code}. Last output:\n${tail}`));
      });
    });
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}
