import type { AnyEvent } from '@langquest-next/core';
import { Diagnostics, MemoryDiagStore } from '../../diagnostics';
import { MemoryStore } from '../../memoryStore';
import { SyncClient } from '../../syncClient';
import { SyncScheduler } from '../../syncScheduler';
import type { Transport } from '../../types';
import type { FakeServer } from '../fakeServer';
import type { Random } from '../random';
import { shapeTransport } from '../shapedTransport';
import type { VirtualTime } from '../virtualTime';
import type { Link } from './links';
import type { Persona } from './personas';

/** When a person uses the app: weekdays (0 = Sunday) and hours, UTC, and how often they act. */
export interface WorkPattern {
  days: readonly number[];
  startHour: number;
  endHour: number;
  /** Mean minutes between actions while working. */
  everyMinutes: number;
}

export const OFFICE_HOURS: WorkPattern = { days: [1, 2, 3, 4, 5], startHour: 8, endHour: 16, everyMinutes: 30 };

/** What the fleet shares with its devices. */
export interface FleetContext {
  time: VirtualTime;
  server: FakeServer;
  orgId: string;
  streamId: string;
  /** When each event was appended on its phone, for propagation times. */
  appendedAt: Map<string, number>;
  /** Realtime pokes: on, and how long they take to arrive. */
  realtime: { on: boolean; delayMs: number };
  /** False once the fleet is settling: people stop working. */
  working: () => boolean;
}

/** One device's numbers. CPU is real milliseconds in this process; delays are simulated milliseconds. */
export class DeviceMetrics {
  syncs = 0;
  offlineSyncs = 0;
  syncErrors = 0;
  /** Real CPU per sync run, network waits excluded. */
  syncCpuMs: number[] = [];
  /** Real CPU per local append (fold, commit, publish). */
  appendCpuMs: number[] = [];
  appended = 0;
  pulled = 0;
  pushedDuplicates = 0;
  /** From append on another phone to arriving here. */
  propagationMs: number[] = [];
  /** From append here to the server accepting it. */
  pushDelayMs: number[] = [];
  maxPending = 0;
  bytesDown = 0;
  /** Cold starts: simulated ms to catch up to where the server was when it began. */
  coldStarts: { ms: number | null; startedAt: number; targetSeq: number }[] = [];
}

/**
 * A phone: the app's real SyncClient and SyncScheduler, on a MemoryStore,
 * over a shaped link to the fake server, on simulated time. Wired the way
 * `apps/mobile/src/useLanguage.ts` wires them: a nudge after each append
 * and on each realtime poke, `connection()` when the channel comes and
 * goes, `wake()` when the signal returns.
 */
export class SimDevice {
  readonly metrics = new DeviceMetrics();
  client!: SyncClient;
  /** Every diagnostics record this device made, across reinstalls (a phone would lose them; the fleet keeps them to count). */
  readonly diag = new MemoryDiagStore();
  private scheduler!: SyncScheduler;
  private linkTimer: unknown = null;
  private workTimer: unknown = null;
  private netWallMs = 0;
  private maxSeen = 0;
  private installs = 0;

  constructor(
    readonly id: string,
    readonly actorId: string,
    readonly persona: Persona,
    readonly work: WorkPattern,
    public link: Link,
    private readonly fleet: FleetContext,
    private readonly random: Random
  ) {}

  /** Install the app and open the language. */
  async install(): Promise<void> {
    this.installs += 1;
    const { time } = this.fleet;
    const shaped = shapeTransport(this.fleet.server.transportFor(), {
      link: () => this.link,
      now: time.now,
      sleep: time.sleep,
      random: this.random
    });
    this.client = new SyncClient({
      orgId: this.fleet.orgId,
      streamId: this.fleet.streamId,
      actorId: this.actorId,
      deviceId: `${this.id}.${this.installs}`,
      store: new MemoryStore(),
      transport: this.observed(shaped),
      now: time.now,
      newId: () => this.random.uuid(),
      diag: new Diagnostics({ store: this.diag, newId: () => this.random.uuid(), now: time.now, maxRecords: Infinity })
    });
    await this.client.load();
    this.scheduler = new SyncScheduler({
      run: () => this.run(),
      setTimeout: time.setTimeout,
      clearTimeout: time.clearTimeout,
      now: time.now,
      random: this.random
    });
    this.scheduler.start();
    this.applyLink();
    this.scheduleWork();
  }

  /**
   * A fresh install, or a new reducer version that throws the checkpoint
   * away: an empty store that catches up through the server snapshot. The
   * person (persona) is the same.
   */
  async reinstall(): Promise<void> {
    this.stop();
    this.metrics.coldStarts.push({ ms: null, startedAt: this.fleet.time.now(), targetSeq: this.fleet.server.head(this.fleet.orgId, this.fleet.streamId) });
    await this.install();
  }

  setLink(link: Link): void {
    this.link = link;
    this.applyLink();
  }

  /** A realtime poke reached the phone. */
  poke(): void {
    if (this.link.online(this.fleet.time.now())) this.scheduler.nudge();
  }

  stop(): void {
    this.scheduler?.stop();
    this.fleet.time.clearTimeout(this.linkTimer);
    this.fleet.time.clearTimeout(this.workTimer);
  }

  /** Has this phone everything the server has, and sent everything it made? */
  async caughtUp(): Promise<boolean> {
    const view = await this.client.inspect();
    return view.pending.length === 0 && view.cursor >= this.fleet.server.head(this.fleet.orgId, this.fleet.streamId);
  }

  private async run(): Promise<{ offline: boolean; more?: boolean }> {
    const started = performance.now();
    const net = this.netWallMs;
    try {
      const r = await this.client.sync();
      this.metrics.syncs += 1;
      if (r.offline) this.metrics.offlineSyncs += 1;
      this.metrics.syncCpuMs.push(performance.now() - started - (this.netWallMs - net));
      this.metrics.maxPending = Math.max(this.metrics.maxPending, await this.client.pendingCount());
      await this.checkColdStart();
      return { offline: r.offline, more: r.more };
    } catch (err) {
      this.metrics.syncErrors += 1;
      this.fleet.time.errors.push(err);
      return { offline: false };
    }
  }

  private async checkColdStart(): Promise<void> {
    const open = this.metrics.coldStarts.find((c) => c.ms === null);
    if (!open) return;
    if ((await this.client.inspect()).cursor >= open.targetSeq) open.ms = this.fleet.time.now() - open.startedAt;
  }

  /** Watch what crosses the wire: wait time (to keep it out of CPU), arrivals, acceptances. */
  private observed(t: Transport): Transport {
    const { time, appendedAt } = this.fleet;
    const timed = async <T>(f: () => Promise<T>): Promise<T> => {
      const started = performance.now();
      try {
        return await f();
      } finally {
        this.netWallMs += performance.now() - started;
      }
    };
    return {
      append: async (events) => {
        const results = await timed(() => t.append(events));
        for (const r of results) {
          if (r.reason === 'duplicate') this.metrics.pushedDuplicates += 1;
          else if (r.accepted) this.metrics.pushDelayMs.push(time.now() - (appendedAt.get(r.id) ?? time.now()));
        }
        return results;
      },
      pull: async (orgId, streamId, after, limit) => {
        const page = await timed(() => t.pull(orgId, streamId, after, limit));
        this.metrics.pulled += page.length;
        this.metrics.bytesDown += JSON.stringify(page).length;
        for (const e of page) this.arrived(e);
        return page;
      },
      snapshotMeta: (...a) => timed(() => t.snapshotMeta(...a)),
      snapshotChunk: async (...a) => {
        const text = await timed(() => t.snapshotChunk(...a));
        this.metrics.bytesDown += text?.length ?? 0;
        return text;
      }
    };
  }

  private arrived(e: AnyEvent): void {
    const seq = e.serverSeq ?? 0;
    if (seq <= this.maxSeen) return;
    this.maxSeen = seq;
    const at = this.fleet.appendedAt.get(e.id);
    if (at !== undefined && !e.deviceId.startsWith(`${this.id}.`)) this.metrics.propagationMs.push(this.fleet.time.now() - at);
    this.persona.observe(e);
  }

  private applyLink(): void {
    const { time, realtime } = this.fleet;
    time.clearTimeout(this.linkTimer);
    const up = this.link.online(time.now());
    this.scheduler.connection(up && realtime.on);
    if (up) this.scheduler.wake();
    const next = this.link.nextChange(time.now());
    if (Number.isFinite(next)) this.linkTimer = time.setTimeout(() => this.applyLink(), next - time.now());
  }

  private scheduleWork(): void {
    const { time } = this.fleet;
    const at = nextWorkTime(time.now(), this.work, this.random);
    this.workTimer = time.setTimeout(() => void this.act(), at - time.now());
  }

  private async act(): Promise<void> {
    if (!this.fleet.working()) return;
    const action = this.persona.next();
    if (action) {
      const started = performance.now();
      try {
        const events = await this.client.appendMany(action);
        this.metrics.appendCpuMs.push(performance.now() - started);
        this.metrics.appended += events.length;
        for (const e of events) this.fleet.appendedAt.set(e.id, this.fleet.time.now());
        this.scheduler.nudge();
      } catch (err) {
        this.fleet.time.errors.push(err);
      }
    }
    this.scheduleWork();
  }
}

const HOUR = 3_600_000;

/** The next moment this person acts: soon if they are at work, else some way into their next working hours. */
export function nextWorkTime(now: number, w: WorkPattern, random: Random): number {
  const gap = Math.max(1, Math.round(w.everyMinutes * (0.5 + random()))) * 60_000;
  const t = now + gap;
  if (atWork(t, w)) return t;
  // Start of the next working day, plus up to one gap.
  const day = Math.floor(t / (24 * HOUR));
  for (let d = day; d < day + 8; d++) {
    const start = d * 24 * HOUR + w.startHour * HOUR;
    if (start > t && w.days.includes(new Date(start).getUTCDay())) return start + Math.round(random() * gap);
  }
  return t + 24 * HOUR;
}

function atWork(t: number, w: WorkPattern): boolean {
  const d = new Date(t);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return w.days.includes(d.getUTCDay()) && h >= w.startHour && h < w.endHour;
}
