import type { JobRun } from '../../../server/jobRuns';
import { HEARTBEAT_MS, JOBS, STOPPED_EARLY, type JobKey, type RunMark } from '../worker/jobsModel';

/**
 * The job runner's Durable Object (worker/jobs.ts, decision 141) against
 * the platform events that broke it in production, which `wrangler dev`
 * never produces: an object dropped and made again mid-run, a deploy's
 * rollout (SIGTERM, the process drains and exits 75), a kill, the time
 * limit, an end nobody watched. The object, its storage and its container
 * are fakes; the monitor rejects the way Cloudflare's does, with the code
 * only in its message.
 */

const rows: JobRun[] = [];
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(public ctx: unknown, public env: unknown) {}
  }
}));
vi.mock('../../../server/jobRuns', () => ({ jobRunSink: () => async (row: JobRun) => { rows.push(row); } }));
const { JobRunner } = await import('../worker/jobs');

/**
 * A container the test ends by hand: `exit(0)` resolves its monitors, any
 * other code rejects them as Cloudflare does. A monitor asked for by an
 * object instance since dropped never settles, as that instance is gone.
 */
class FakeContainer {
  running = false;
  starts: { entrypoint?: string[]; env?: Record<string, string> }[] = [];
  signals: number[] = [];
  timeouts: number[] = [];
  /** Which object instance is alive; monitors of earlier ones never settle. */
  instance = 0;
  private lastExit: number | null = null;
  private waiting: { instance: number; settle: (code: number) => void }[] = [];
  start(opts: { entrypoint?: string[]; env?: Record<string, string> }) {
    this.running = true;
    this.lastExit = null;
    this.starts.push(opts);
  }
  monitor(): Promise<void> {
    const p = new Promise<void>((resolve, reject) => {
      const settle = (code: number) => (code === 0 ? resolve() : reject(new Error(`Container exited with unexpected exit code: ${code}`)));
      if (!this.running && this.lastExit !== null) settle(this.lastExit);
      else this.waiting.push({ instance: this.instance, settle });
    });
    p.catch(() => {});
    return p;
  }
  signal(n: number) { this.signals.push(n); }
  async setInactivityTimeout(ms: number) { this.timeouts.push(ms); }
  exit(code: number) {
    this.running = false;
    this.lastExit = code;
    for (const w of this.waiting.splice(0)) if (w.instance === this.instance) w.settle(code);
  }
}

class FakeStorage {
  data = new Map<string, unknown>();
  alarm: number | null = null;
  async get<T>(key: string) { return this.data.get(key) as T | undefined; }
  async put(key: string, value: unknown) { this.data.set(key, value); }
  async delete(key: string) { return this.data.delete(key); }
  async getAlarm() { return this.alarm; }
  async setAlarm(at: number) { this.alarm = at; }
  async deleteAlarm() { this.alarm = null; }
}

/** What a run's end asked of the other jobs' objects (jobsModel.ts AFTER): each object by name, and how. */
const followed: { name: string; opts: unknown }[] = [];
const env = {
  SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', API_URL: 'https://next.langquest.org',
  V2_IMPORT_ENABLED: 'true', V2_SUPABASE_ANON_KEY: 'anon',
  JOBS: {
    idFromName: (name: string) => name,
    get: (name: string) => ({ run: async (opts: unknown) => { followed.push({ name, opts }); return 'started'; } })
  }
};

/** One job's object, as the platform holds it: storage and container outlive any instance of the object. */
function job(name: JobKey) {
  const storage = new FakeStorage();
  const container = new FakeContainer();
  const ctx = {
    id: { name }, storage, container,
    waitUntil: () => {},
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn()
  };
  /** The object, made again: what eviction, a restart or a deploy's rollout does. The instance before it is gone. */
  const object = () => {
    container.instance += 1;
    return new JobRunner(ctx as never, env as never);
  };
  /** The object dropped, with no new one yet: its watcher goes with it. */
  const drop = () => { container.instance += 1; };
  /** Let what the live instance waits on run. */
  const settle = async () => { for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0); };
  return { storage, container, drop, object, settle };
}

beforeEach(() => {
  rows.length = 0;
  followed.length = 0;
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
  vi.setSystemTime(Date.parse('2026-10-21T03:15:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('the job runner object', () => {
  it('starts one run, and a tick that finds it going starts nothing', async () => {
    const { container, object, storage } = job('projection');
    const o = object();
    expect(await o.run()).toBe('started');
    expect(await o.run()).toBe('running');
    expect(container.starts).toHaveLength(1);
    expect(container.starts[0]!.env).toMatchObject({ LANGQUEST_JOB: 'projection', NODE_OPTIONS: '--max-old-space-size=3072' });
    expect(container.timeouts).toEqual([JOBS.projection.timeLimitMs]);
    expect(storage.alarm).toBe(Date.now() + HEARTBEAT_MS);
  });

  it('writes no row of its own when the process wrote one: a plain exit, a failure, a drain', async () => {
    for (const code of [0, 1, STOPPED_EARLY]) {
      const { container, object, settle, storage } = job('projection');
      await object().run();
      container.exit(code);
      await settle();
      expect(storage.data.has('run'), String(code)).toBe(false);
      expect(storage.alarm, String(code)).toBeNull();
    }
    expect(rows).toEqual([]);
  });

  it('writes one row for a kill, however many times it watched the run', async () => {
    const { container, object, settle, storage } = job('projection');
    const o = object();
    await o.run();
    // Each minute's beat renews the keep-alive and watches again.
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
      await o.alarm();
    }
    container.exit(137);
    await settle();
    expect(rows).toEqual([expect.objectContaining({ job: 'projection', outcome: 'error', errorClass: 'killed:137' })]);
    expect(storage.data.has('run')).toBe(false);
  });

  it('made again mid-run, renews the keep-alive and still sees how the run ends', async () => {
    // Why: an object is held about 70 s after a call; a new one had no keep-alive for the running container (2026-10-19).
    const { container, object, settle, storage } = job('v2-import');
    await object().run({ all: true });
    expect(storage.data.get('allDue')).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    object();
    await settle();
    expect(container.timeouts.at(-1)).toBe(JOBS['v2-import'].timeLimitMs - 10 * 60_000);
    // A deploy's rollout: SIGTERM, the import drains and exits 75, having written its own row.
    container.exit(STOPPED_EARLY);
    await settle();
    expect(rows).toEqual([]);
    expect(storage.data.get('allDue')).toBe(true);
  });

  it('gives the whole read owed to the next tick, and clears it once a run takes it', async () => {
    const { container, object, settle, storage } = job('v2-import');
    const o = object();
    await o.run({ all: true });
    container.exit(STOPPED_EARLY);
    await settle();
    expect(await o.run()).toBe('started');
    expect(container.starts[1]!.entrypoint).toEqual(['node', 'v2.mjs', 'sync', '--all']);
    expect(storage.data.get<RunMark>('run' as never)).toMatchObject({ all: true });
    expect(storage.data.has('allDue')).toBe(false);
    container.exit(0);
    await settle();
    expect(await o.run()).toBe('started');
    expect(container.starts[2]!.entrypoint).toEqual(['node', 'v2.mjs', 'sync']);
  });

  it('records an end nobody watched, once, before the next run starts', async () => {
    const { container, drop, object, settle, storage } = job('projection');
    await object().run();
    // The object is gone; the run is killed while no instance watches it.
    drop();
    container.exit(137);
    const later = object();
    await settle();
    // The constructor saw no running container, so the beat or the next tick records the end.
    expect(rows).toEqual([]);
    expect(await later.run()).toBe('started');
    expect(rows).toEqual([expect.objectContaining({ errorClass: 'killed:137' })]);
    expect(storage.data.has('run')).toBe(true);
  });

  it('records the end at the next beat when no tick comes first', async () => {
    const { container, drop, object, settle, storage } = job('projection');
    await object().run();
    drop();
    container.exit(137);
    await object().alarm();
    await settle();
    expect(rows).toEqual([expect.objectContaining({ errorClass: 'killed:137' })]);
    expect(storage.alarm).toBeNull();
  });

  it('runs once more when asked while going, then starts the job that follows it (decision 192)', async () => {
    // Why: the filming says its films are in as each language ends; films that come in while the intake runs go up that night too.
    const { container, object, settle } = job('tutorial-intake');
    const o = object();
    expect(await o.run()).toBe('started');
    expect(await o.run({ again: true })).toBe('running');
    expect(await o.run({ again: true })).toBe('running');
    container.exit(0);
    await settle();
    expect(container.starts).toHaveLength(2);
    expect(followed).toEqual([]);
    container.exit(1);
    await settle();
    expect(container.starts).toHaveLength(2);
    expect(followed).toEqual([{ name: 'tutorial-publish', opts: { again: true } }]);
  });

  it('starts nothing after a job nothing follows', async () => {
    const { container, object, settle } = job('projection');
    await object().run();
    container.exit(0);
    await settle();
    expect(followed).toEqual([]);
    expect(container.starts).toHaveLength(1);
  });

  it('starts the run asked for once when a tick finds the end nobody watched', async () => {
    const { container, drop, object, settle } = job('tutorial-intake');
    const o = object();
    await o.run();
    await o.run({ again: true });
    drop();
    container.exit(0);
    const later = object();
    await settle();
    // Recording the end starts the one more it was asked for; the tick's own start finds it going.
    expect(await later.run()).toBe('running');
    expect(container.starts).toHaveLength(2);
  });

  it('sends SIGTERM at the time limit and keeps beating until the run ends', async () => {
    const { container, object, storage } = job('projection');
    const o = object();
    await o.run();
    vi.setSystemTime(Date.now() + JOBS.projection.timeLimitMs);
    await o.alarm();
    expect(container.signals).toEqual([15]);
    expect(storage.alarm).toBe(Date.now() + HEARTBEAT_MS);
  });
});

describe('the job runner status call', () => {
  /** Everything that would change the object or its container, which a status question must leave alone. */
  const untouched = (container: FakeContainer, storage: FakeStorage, before: { puts: number }) => {
    expect(container.starts).toEqual([]);
    expect(container.signals).toEqual([]);
    expect(container.timeouts).toEqual([]);
    expect(storage.alarm).toBeNull();
    expect(storage.data.size).toBe(before.puts);
  };

  it('answers an idle object without touching it', async () => {
    const { container, object, storage } = job('v2-import');
    const writes = vi.spyOn(storage, 'put');
    const deletes = vi.spyOn(storage, 'delete');
    const alarms = vi.spyOn(storage, 'setAlarm');
    expect(await object().status('v2-import')).toEqual({ running: false, startedAt: null, timeLimitMs: JOBS['v2-import'].timeLimitMs, all: false });
    untouched(container, storage, { puts: 0 });
    expect([writes, deletes, alarms].map((f) => f.mock.calls.length)).toEqual([0, 0, 0]);
  });

  it('answers a running object with its start and whole-read mark, changing nothing', async () => {
    const { container, object, storage } = job('v2-import');
    const o = object();
    await o.run({ all: true });
    const startedAt = Date.now();
    const alarm = storage.alarm;
    const stored = new Map(storage.data);
    const startsBefore = container.starts.length;
    const timeoutsBefore = container.timeouts.length;
    const writes = vi.spyOn(storage, 'put');
    const deletes = vi.spyOn(storage, 'delete');
    const alarms = vi.spyOn(storage, 'setAlarm');
    vi.setSystemTime(startedAt + 60_000);
    expect(await o.status('v2-import')).toEqual({ running: true, startedAt, timeLimitMs: JOBS['v2-import'].timeLimitMs, all: true });
    expect(container.starts).toHaveLength(startsBefore);
    expect(container.timeouts).toHaveLength(timeoutsBefore);
    expect(container.signals).toEqual([]);
    expect(storage.alarm).toBe(alarm);
    expect(storage.data).toEqual(stored);
    expect([writes, deletes, alarms].map((f) => f.mock.calls.length)).toEqual([0, 0, 0]);
  });
});
