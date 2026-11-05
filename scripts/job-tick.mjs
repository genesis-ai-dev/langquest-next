/**
 * Runs a command (`wrangler dev`) and fires the app's Worker's job tick at
 * it every minute while it runs, so a local stack gets the projection pass
 * in the job container as a hosted one does (decisions.md 141, 148).
 * wrangler dev fires no cron on its own; it must be started with
 * `--test-scheduled`, and the config must send `/__scheduled` to the Worker
 * ahead of the page (scripts/web-dev-vars.ts writes such a copy).
 *
 *   node scripts/job-tick.mjs <port> -- wrangler dev -c .wrangler.dev.jsonc --port <port> --test-scheduled
 *
 * Every minute rather than the Worker's five, so what one phone asks shows
 * on the other within a minute and the web UI tests find Inbox rows and
 * listings soon (decision 68). A tick that finds the pass still running
 * starts nothing (JobRunner is the lock). The command's exit is this one's.
 */
import { spawn } from 'node:child_process';

const EVERY_MS = 60_000;
/** The cron expression of the job tick (apps/web/worker/jobsModel.ts JOB_TICK). */
const JOB_TICK = '*/5 * * * *';

const split = process.argv.indexOf('--');
const port = process.argv[2];
const command = split > 0 ? process.argv.slice(split + 1) : [];
if (!port || command.length === 0) {
  console.error('usage: job-tick.mjs <port> -- <command…>');
  process.exit(2);
}

const child = spawn(command[0], command.slice(1), { stdio: 'inherit' });
const url = `http://localhost:${port}/__scheduled?cron=${encodeURIComponent(JOB_TICK)}`;
let ticks = 0;
let failing = false;

async function tick() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (ticks++ === 0 || failing) console.log(`job tick: fired at :${port} (every minute; the projection pass runs in the job container)`);
    failing = false;
  } catch (error) {
    // Not listening yet (the image is still building) is the usual case: said once, retried next minute.
    if (!failing) console.log(`job tick: not answered yet at :${port} (${error instanceof Error ? error.message : error}); trying every minute`);
    failing = true;
  }
}

/** The first tick as soon as the Worker answers, then one a minute. */
async function firstTick() {
  for (let i = 0; i < 600 && child.exitCode === null; i++) {
    try {
      const response = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(5_000) });
      await response.body?.cancel();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  if (child.exitCode === null) await tick();
}

void firstTick();
const timer = setInterval(() => void tick(), EVERY_MS);
// Ctrl-C reaches the child directly (same process group); a SIGTERM to this one is passed on.
process.on('SIGINT', () => {});
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('exit', (code, signal) => {
  clearInterval(timer);
  process.exit(signal ? 0 : code ?? 0);
});
