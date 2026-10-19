import { DurableObject } from 'cloudflare:workers';
import { jobRunSink } from '../../../server/jobRuns';
import type { Env } from './env';
import { deadRun, entrypointFor, exitCodeOf, isJobKey, jobEnv, JOBS, type Exit, type JobKey, type RunMark } from './jobsModel';

/**
 * The job runner (docs/server-jobs.md, decisions.md 141): one container
 * image (jobs/Dockerfile) holding a Node bundle per server job
 * (scripts/build-jobs.mjs), started by the Worker's job tick through this
 * Durable Object. One object per job, named by the job, so a run is never
 * started twice: a tick that finds the run still going starts nothing. The
 * process writes its own `diag.job_runs` row; the object writes one only
 * when the process died without the chance (killed, out of memory, stopped
 * at the time limit), so a dead run is never silent.
 *
 * It drives the container through the object's own API
 * (`ctx.container`), not the `@cloudflare/containers` class: that class
 * starts a container for requests, polls until it is running and starts it
 * again when the poll finds it gone, so a pass that finished in under a
 * second ran twice and was reported as a failed start. A pending `monitor`
 * keeps the object in memory for up to 15 minutes; a longer run's exit can
 * go unobserved, and its own job run is then the record of it.
 */
export class JobRunner extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // A restart of the object (a deploy, an eviction) drops a pending monitor; watch the run again.
    if (ctx.container?.running) this.watch();
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
   * going leaves it for the next. Answers once the start is issued.
   */
  async run(opts: { all?: boolean } = {}): Promise<'started' | 'running' | 'disabled'> {
    const key = this.key;
    const settings = jobEnv(key, { ...this.env, SUPABASE_URL: this.env.JOBS_SUPABASE_URL ?? this.env.SUPABASE_URL, API_URL: this.env.JOBS_API_URL ?? this.env.API_URL });
    if ('skip' in settings) return 'disabled';
    if ('refuse' in settings) throw new Error(settings.refuse);
    if (opts.all) await this.ctx.storage.put('allDue', true);
    const container = this.container;
    if (container.running) return 'running';
    const stale = await this.ctx.storage.get<RunMark>('run');
    if (stale) console.warn(`job ${key}: the run started at ${new Date(stale.startedAt).toISOString()} ended unobserved`);
    const all = (await this.ctx.storage.get<boolean>('allDue')) === true;
    await this.ctx.storage.put<RunMark>('run', { startedAt: Date.now() });
    container.start({ entrypoint: entrypointFor(key, all), env: settings.env, enableInternet: true });
    if (all) await this.ctx.storage.delete('allDue');
    // The container outlives the object's idle spells up to the time limit; the alarm stops a run past it.
    await container.setInactivityTimeout(JOBS[key].timeLimitMs);
    await this.ctx.storage.setAlarm(Date.now() + JOBS[key].timeLimitMs);
    this.watch();
    return 'started';
  }

  /** Record how the run ends: a resolved monitor is exit 0, a rejected one carries the code. */
  private watch(): void {
    this.ctx.waitUntil(this.container.monitor().then(() => this.stopped(0), (error: unknown) => this.stopped(exitCodeOf(error))));
  }

  /** The time limit: a run still going is sent SIGTERM, which the monitor then reports as exit 143. */
  override async alarm(): Promise<void> {
    if (!this.container.running) return;
    console.error(`job ${this.key}: still running at the time limit, stopping it`);
    this.container.signal(15);
  }

  private async stopped(exit: Exit): Promise<void> {
    const mark = await this.ctx.storage.get<RunMark>('run');
    await this.ctx.storage.delete('run');
    await this.ctx.storage.deleteAlarm();
    const row = deadRun(this.key, mark, exit, Date.now());
    if (!row) return;
    console.error(`job ${this.key} died: ${row.errorClass}`);
    await jobRunSink(this.env.SUPABASE_URL, this.env.SUPABASE_SERVICE_ROLE_KEY)(row);
  }
}
