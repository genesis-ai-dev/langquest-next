import { createHash } from 'node:crypto';
import { emptyLanguageState, foldLanguage } from '@langquest-next/core';
import { FakeServer } from '../fakeServer';
import { seededRandom, type Random } from '../random';
import { VirtualTime } from '../virtualTime';
import { OFFICE_HOURS, SimDevice, type FleetContext, type WorkPattern } from './device';
import { always, NETWORKS, TIME, type Link } from './links';
import { coordinator, REVIEW_KINDS, reviewer, translator, type Persona } from './personas';

/** Monday 5 January 2026, 00:00 UTC: weekdays line up with work patterns. */
export const FLEET_EPOCH = Date.UTC(2026, 0, 5);

export interface CrewOptions {
  passages: number;
  translators: number;
  reviewers: number;
  /** Each translator's and reviewer's link, by role and index. The coordinator is on Wi-Fi. */
  link: (role: 'translator' | 'reviewer', index: number, random: Random) => Link;
  work?: WorkPattern;
  /** The coordinator moderates: on this share of its turns it redacts a note. */
  redactShare?: number;
}

export interface FleetOptions {
  seed: number;
  crew: CrewOptions;
  /** The server's projection pass: how often, and how many new events it waits for (1 is what it does today). */
  snapshots?: { everyMs: number; minNewEvents: number } | null;
  /** Characters per snapshot piece; the server's is 256 KB. */
  chunkChars?: number;
  realtime?: { on: boolean; delayMs: number };
  /**
   * The server refuses the language's events as not listed until this
   * simulated time, as it does when a phone pushes a new language's events
   * before the organization stream lists it (they are re-queued on every push).
   */
  unlistedUntil?: number;
}

/**
 * Many phones and one server in one process, on simulated time
 * (docs/fleet-simulation.md). Every phone runs the app's real sync code;
 * the people on them are personas; the server is the in-memory fake, so
 * this measures the clients and the protocol, not Postgres.
 */
export class Fleet {
  readonly time = new VirtualTime(FLEET_EPOCH);
  readonly server = new FakeServer();
  readonly devices: SimDevice[] = [];
  readonly orgId = 'org-fleet';
  readonly streamId = 'lang-fleet';
  snapshotsTaken = 0;
  private readonly random: Random;
  private readonly appendedAt = new Map<string, number>();
  private working = true;
  private lastSnapshotSeq = 0;
  private readonly context: FleetContext;

  constructor(readonly options: FleetOptions) {
    this.random = seededRandom(options.seed);
    this.server.chunkChars = options.chunkChars ?? 256 * 1024;
    this.context = {
      time: this.time,
      server: this.server,
      orgId: this.orgId,
      streamId: this.streamId,
      appendedAt: this.appendedAt,
      realtime: options.realtime ?? { on: true, delayMs: 1_000 },
      working: () => this.working
    };
    const { crew } = options;
    const work = crew.work ?? OFFICE_HOURS;
    this.add('coord', 'coordinator', coordinator(crew.passages, { redactShare: crew.redactShare ?? 0, random: this.random.fork('coord') }), work, always(NETWORKS.wifi, 'wifi'));
    for (let i = 0; i < crew.translators; i++) {
      const r = this.random.fork(`t${i}`);
      this.add(`t${i}`, `translator-${i}`, translator({ actorId: `translator-${i}`, index: i, of: crew.translators, random: r }), work, crew.link('translator', i, r));
    }
    for (let i = 0; i < crew.reviewers; i++) {
      const r = this.random.fork(`r${i}`);
      const kindId = REVIEW_KINDS[i % REVIEW_KINDS.length]!;
      this.add(`r${i}`, `reviewer-${i}`, reviewer({ actorId: `reviewer-${i}`, kindId, random: r }), work, crew.link('reviewer', i, r));
    }
  }

  private add(id: string, actorId: string, persona: Persona, work: WorkPattern, link: Link): void {
    this.devices.push(new SimDevice(id, actorId, persona, work, link, this.context, this.random.fork(`device:${id}`)));
  }

  /** Install every app; the coordinator sets the language up at once. */
  async start(): Promise<void> {
    const { realtime } = this.context;
    const unlisted = this.options.unlistedUntil;
    if (unlisted !== undefined) this.server.authorize = () => (this.time.now() < unlisted ? 'language not listed yet' : null);
    this.server.appended.add(() => {
      if (!realtime.on) return;
      for (const d of this.devices) this.time.setTimeout(() => d.poke(), realtime.delayMs);
    });
    for (const d of this.devices) await d.install();
    const coord = this.devices[0]!;
    const setup = coord.persona.next();
    if (setup) {
      const events = await coord.client.appendMany(setup);
      coord.metrics.appended += events.length;
      for (const e of events) this.appendedAt.set(e.id, this.time.now());
    }
    const snapshots = this.options.snapshots === undefined ? { everyMs: 5 * TIME.MINUTE, minNewEvents: 1 } : this.options.snapshots;
    if (snapshots) this.snapshotPass(snapshots);
  }

  /** What the projection pass does to snapshots (server/projectionWorker.ts, every 5 minutes). */
  private snapshotPass(o: { everyMs: number; minNewEvents: number }): void {
    this.time.setTimeout(() => {
      const head = this.server.head(this.orgId, this.streamId);
      if (head - this.lastSnapshotSeq >= o.minNewEvents) {
        this.server.makeSnapshot(this.orgId, this.streamId);
        this.lastSnapshotSeq = head;
        this.snapshotsTaken += 1;
      }
      this.snapshotPass(o);
    }, o.everyMs);
  }

  runFor(ms: number): Promise<void> {
    return this.time.runFor(ms);
  }

  /** Run `fn` at simulated time `at` (ms since FLEET_EPOCH). */
  at(at: number, fn: () => void | Promise<void>): void {
    this.time.setTimeout(() => {
      void Promise.resolve(fn()).catch((err) => this.time.errors.push(err));
    }, FLEET_EPOCH + at - this.time.now());
  }

  /**
   * End of the run: people stop working, every phone gets a good signal,
   * and the fleet runs until each phone has sent everything and has
   * everything, or `maxMs` passes. Then every phone's fold is compared with
   * the server's log folded from scratch.
   */
  async settle(maxMs = 12 * TIME.HOUR): Promise<Agreement> {
    this.working = false;
    const started = this.time.now();
    for (const d of this.devices) d.setLink(always(NETWORKS.wifi, 'wifi'));
    let caughtUp = false;
    while (this.time.now() - started < maxMs) {
      await this.time.runFor(TIME.MINUTE);
      const all = await Promise.all(this.devices.map((d) => d.caughtUp()));
      if (all.every(Boolean)) { caughtUp = true; break; }
    }
    const settleMs = this.time.now() - started;
    for (const d of this.devices) d.stop();
    const expected = digest(foldLanguage(this.server.stream(this.orgId, this.streamId), emptyLanguageState()));
    const disagree = this.devices.filter((d) => digest(d.client.getState()) !== expected).map((d) => d.id);
    return { caughtUp, settleMs, agree: caughtUp && disagree.length === 0, disagree, digest: expected };
  }

  report(agreement: Agreement | null, realMs: number): FleetReport {
    const all = this.devices;
    const flat = (pick: (d: SimDevice) => number[]) => all.flatMap(pick);
    const sum = (pick: (d: SimDevice) => number) => all.reduce((n, d) => n + pick(d), 0);
    const diag = all.flatMap((d) => d.diag.records);
    const snapshotOutcomes: Record<string, number> = {};
    for (const r of diag) if (r.kind === 'snapshot') snapshotOutcomes[r.t.outcome ?? '?'] = (snapshotOutcomes[r.t.outcome ?? '?'] ?? 0) + 1;
    const loads = diag.filter((r) => r.kind === 'load').length;
    const installs = all.reduce((n, d) => n + 1 + d.metrics.coldStarts.length, 0);
    const colds = all.flatMap((d) => d.metrics.coldStarts.map((c) => ({ device: d.id, link: d.link.name, minutes: c.ms === null ? null : round(c.ms / TIME.MINUTE) })));
    return {
      simulated: {
        days: round((this.time.now() - FLEET_EPOCH) / TIME.DAY),
        devices: all.length,
        passages: this.options.crew.passages,
        seed: this.options.seed
      },
      realSeconds: round(realMs / 1000),
      heapMb: round(process.memoryUsage().heapUsed / 1e6),
      events: { appended: sum((d) => d.metrics.appended), onServer: this.server.head(this.orgId, this.streamId) },
      server: {
        appendCalls: this.server.appendCalls,
        pullCalls: this.server.pullCalls,
        snapshotChunkCalls: this.server.chunkCalls,
        snapshotsTaken: this.snapshotsTaken
      },
      phones: {
        syncs: sum((d) => d.metrics.syncs),
        offlineSyncs: sum((d) => d.metrics.offlineSyncs),
        syncErrors: sum((d) => d.metrics.syncErrors),
        syncCpuMs: stats(flat((d) => d.metrics.syncCpuMs)),
        appendCpuMs: stats(flat((d) => d.metrics.appendCpuMs)),
        // Each install loads once, and so does each adopted server snapshot; the rest are refolds.
        refolds: loads - installs - (snapshotOutcomes.ok ?? 0),
        snapshotOutcomes,
        pulled: sum((d) => d.metrics.pulled),
        mbDown: round(sum((d) => d.metrics.bytesDown) / 1e6),
        pushedDuplicates: sum((d) => d.metrics.pushedDuplicates),
        maxPending: Math.max(0, ...all.map((d) => d.metrics.maxPending)),
        propagationMinutes: stats(flat((d) => d.metrics.propagationMs).map((ms) => ms / TIME.MINUTE)),
        pushDelayMinutes: stats(flat((d) => d.metrics.pushDelayMs).map((ms) => ms / TIME.MINUTE))
      },
      coldStarts: colds,
      agreement,
      errors: this.time.errors.map((e) => (e instanceof Error ? e.message : String(e)))
    };
  }
}

export interface Agreement {
  /** Every phone sent everything and has everything. */
  caughtUp: boolean;
  /** Simulated ms settling took. */
  settleMs: number;
  /** Every phone's fold equals the server log folded from scratch (invariant 2, across a fleet). */
  agree: boolean;
  disagree: string[];
  digest: string;
}

export interface Stats {
  n: number;
  p50: number;
  p95: number;
  max: number;
  total: number;
}

export interface FleetReport {
  simulated: { days: number; devices: number; passages: number; seed: number };
  realSeconds: number;
  heapMb: number;
  events: { appended: number; onServer: number };
  server: { appendCalls: number; pullCalls: number; snapshotChunkCalls: number; snapshotsTaken: number };
  phones: {
    syncs: number;
    offlineSyncs: number;
    syncErrors: number;
    syncCpuMs: Stats;
    appendCpuMs: Stats;
    /** Full refolds of the local log, beyond the load at install and after adopting a snapshot. */
    refolds: number;
    snapshotOutcomes: Record<string, number>;
    pulled: number;
    mbDown: number;
    pushedDuplicates: number;
    maxPending: number;
    propagationMinutes: Stats;
    pushDelayMinutes: Stats;
  };
  coldStarts: { device: string; link: string; minutes: number | null }[];
  agreement: Agreement | null;
  errors: string[];
}

export function stats(values: number[]): Stats {
  if (values.length === 0) return { n: 0, p50: 0, p95: 0, max: 0, total: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return { n: sorted.length, p50: round(at(0.5)), p95: round(at(0.95)), max: round(sorted[sorted.length - 1]!), total: round(sorted.reduce((a, b) => a + b, 0)) };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * A fingerprint of a fold, leaving out `appliedEventIds` (an idempotency
 * guard that snapshots compact away). Keys are sorted, because two folds
 * of the same events in different orders insert keys in different orders.
 */
function digest(state: object): string {
  const { appliedEventIds: _ignored, ...rest } = state as { appliedEventIds?: unknown };
  return createHash('sha256').update(canonical(rest)).digest('hex').slice(0, 16);
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}
