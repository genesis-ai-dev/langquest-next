import { DurableObject } from 'cloudflare:workers';
import { jobRunSink } from '../../../server/jobRuns';
import type { Env } from './env';
import {
  AFTER, deadRun, entrypointFor, exitCodeOf, heartbeat, HEARTBEAT_MS, isJobKey, jobEnv, JOBS, stillOwesWholeRead, type Exit, type JobKey, type RunMark
} from './jobsModel';

/** How long to wait for a stopped container to say how it ended. */
const MONITOR_SETTLE_MS = 5_000;

/**
 * The job runner (docs/server-jobs.md, decisions.md 141): one container
 * image (jobs/Dockerfile) holding a Node bundle per server job
 * (scripts/build-jobs.mjs), started by the Worker's job tick through this
 * Durable Object. One object per job, named by the job, so a run is never
 * started twice: a tick that finds the run still going starts nothing. The
 * process writes its own `diag.job_runs` row, on SIGTERM too; the object
 * writes one when the process died without the chance (killed, out of
 * memory, stopped without a code), so a dead run is never silent.
 *
 * It drives the container through the object's own API (`ctx.container`),
 * not the `@cloudflare/containers` class, which starts containers for
 * requests and starts a short batch job twice. An object is held only about
 * a minute after a call, and the container's keep-alive belongs to one live
 * instance of it, so while a run lasts an alarm brings the object back every
 * minute (jobsModel.ts `heartbeat`): it renews the keep-alive, stops a run
 * past its limit, and records a run that ended while nobody watched.
 */
export class JobRunner extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // A restarted object has no keep-alive for a container already running (Cloudflare's container docs): set it again.
    if (ctx.container?.running) {
      ctx.blockConcurrencyWhile(async () => {
        const mark = await ctx.storage.get<RunMark>('run');
        const beat = heartbeat(this.key, mark, true, Date.now());
        if (beat.do === 'renew') await ctx.container!.setInactivityTimeout(beat.keepAliveMs);
        this.watch();
      });
    }
  }

  /** The job this object is for: its name (`idFromName`). */
  private get key(): JobKey {
    const name = this.ctx.id.name;
    if (!isJobKey(name)) throw new Error(`not a job: ${name ?? '(unnamed)'}`);
    return name;
  }

  private get container(): Container {
    const container = this.ctx.container;
    if (!container) throw new Error('no container bound (wrangler.jsonc containers)');
    return container;
  }

  /**
   * Start the job unless a run is under way. `all` owes the import a whole
   * read: it is kept until a run starts with it, so a tick that finds a run
   * going leaves it for the next. `again` asks a run under way for one more
   * when it ends (the filming's films came in while the intake ran). Answers
   * once the start is issued.
   */
  async run(opts: { all?: boolean; again?: boolean } = {}): Promise<'started' | 'running' | 'disabled'> {
    const key = this.key;
    const settings = jobEnv(key, { ...this.env, SUPABASE_URL: this.env.JOBS_SUPABASE_URL ?? this.env.SUPABASE_URL, API_URL: this.env.JOBS_API_URL ?? this.env.API_URL });
    if ('skip' in settings) return 'disabled';
    if ('refuse' in settings) throw new Error(settings.refuse);
    if (opts.all) await this.ctx.storage.put('allDue', true);
    const container = this.container;
    if (container.running) {
      if (opts.again) await this.ctx.storage.put('againDue', true);
      await this.ensureHeartbeat();
      return 'running';
    }
    // A run that ended between beats is recorded before the next starts; one more it was asked for starts there.
    if (await this.ctx.storage.get<RunMark>('run')) await this.recordEnd();
    if (container.running) return 'running';
    await this.ctx.storage.delete('againDue');
    const all = (await this.ctx.storage.get<boolean>('allDue')) === true;
    await this.ctx.storage.put<RunMark>('run', all ? { startedAt: Date.now(), all: true } : { startedAt: Date.now() });
    container.start({ entrypoint: entrypointFor(key, all), env: settings.env, enableInternet: true });
    if (all) await this.ctx.storage.delete('allDue');
    await container.setInactivityTimeout(JOBS[key].timeLimitMs);
    await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
    // Started from the end of the run before (`next`): its watcher is still busy, and watches this one when done.
    if (this.watching) this.watchNext = true;
    else this.watch();
    return 'started';
  }

  /**
   * Whether this job's run is going, for the ops dashboard (jobStatus.ts).
   * Read-only: it starts, stops, signals and renews nothing, touches no
   * alarm and writes no storage. The key comes from the caller because a
   * new object learns its name only here.
   */
  async status(key: JobKey): Promise<{ running: boolean; startedAt: number | null; timeLimitMs: number; all: boolean }> {
    const running = this.ctx.container?.running === true;
    const mark = running ? await this.ctx.storage.get<RunMark>('run') : undefined;
    return { running, startedAt: mark?.startedAt ?? null, timeLimitMs: JOBS[key].timeLimitMs, all: mark?.all === true };
  }

  /** The heartbeat (jobsModel.ts): renew, stop at the limit, or record the end. */
  override async alarm(): Promise<void> {
    const mark = await this.ctx.storage.get<RunMark>('run');
    const beat = heartbeat(this.key, mark, this.container.running, Date.now());
    if (beat.do === 'none') return;
    if (beat.do === 'record') return this.recordEnd();
    if (beat.do === 'stop') {
      console.error(`job ${this.key}: still running at the time limit, stopping it`);
      this.container.signal(15);
    } else {
      await this.container.setInactivityTimeout(beat.keepAliveMs);
      this.watch();
    }
    await this.ctx.storage.setAlarm(beat.next);
  }

  /** A run found going whose heartbeat is missing (an object from before it existed) gets one. */
  private async ensureHeartbeat(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) !== null) return;
    if (!(await this.ctx.storage.get<RunMark>('run'))) await this.ctx.storage.put<RunMark>('run', { startedAt: Date.now() });
    await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
  }

  /** Whether this instance already waits on the run's monitor. */
  private watching = false;
  /** A run started while the watcher was still recording the one before. */
  private watchNext = false;
  /** The end being recorded, so two ends (a watcher and a beat or tick) are recorded one after the other. */
  private ending: Promise<void> = Promise.resolve();

  /**
   * Record how the run ends while this instance is alive: a resolved monitor
   * is exit 0, a rejected one carries the code. Once per instance: each
   * minute's beat used to add a watcher, and a killed run got a row from each.
   * A run started while the last one's end was being recorded (`next`) is
   * watched once that is done.
   */
  private watch(): void {
    if (this.watching) return;
    this.watching = true;
    this.ctx.waitUntil(this.container.monitor()
      .then(() => this.stopped(0), (error: unknown) => this.stopped(exitCodeOf(error)))
      .finally(() => {
        this.watching = false;
        if (this.watchNext) {
          this.watchNext = false;
          this.watch();
        }
      }));
  }

  /** A stopped container still says how it ended when asked; if it does not soon, the end is recorded without a code. */
  private async recordEnd(): Promise<void> {
    const ended = this.container.monitor().then(() => 0 as Exit, (error: unknown) => exitCodeOf(error));
    const timeout = new Promise<Exit>((resolve) => setTimeout(() => resolve(null), MONITOR_SETTLE_MS));
    await this.stopped(await Promise.race([ended, timeout]));
  }

  /** Once per run: clear its mark and heartbeat, and write a row when the process could not. One end at a time; the second finds no mark. */
  private stopped(exit: Exit): Promise<void> {
    const next = this.ending.then(() => this.end(exit));
    this.ending = next.catch(() => {});
    return next;
  }

  private async end(exit: Exit): Promise<void> {
    const mark = await this.ctx.storage.get<RunMark>('run');
    if (!mark) return;
    await this.ctx.storage.delete('run');
    await this.ctx.storage.deleteAlarm();
    // A whole read cut off (a deploy's rollout, a kill) is owed to the next tick, not to the next night.
    if (stillOwesWholeRead(mark, exit)) await this.ctx.storage.put('allDue', true);
    const row = deadRun(this.key, mark, exit, Date.now());
    try {
      if (row) {
        console.error(`job ${this.key} died: ${row.errorClass}`);
        await jobRunSink(this.env.SUPABASE_URL, this.env.SUPABASE_SERVICE_ROLE_KEY)(row);
      }
    } finally {
      await this.next();
    }
  }

  /**
   * After a run: the one more it was asked for, or else the job that follows
   * it (jobsModel.ts AFTER, decisions.md 192), which, if it is going, runs
   * once more when it ends, so what this run made is never left for its
   * next scheduled time.
   */
  private async next(): Promise<void> {
    try {
      if (await this.ctx.storage.get<boolean>('againDue')) {
        await this.run();
        return;
      }
      const after = AFTER[this.key];
      if (after) await this.env.JOBS.get(this.env.JOBS.idFromName(after)).run({ again: true });
    } catch (e) {
      console.error(`job ${this.key}: what follows it did not start`, e);
    }
  }
}
