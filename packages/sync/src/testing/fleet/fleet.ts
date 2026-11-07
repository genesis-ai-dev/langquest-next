import { createHash } from 'node:crypto';
import { CLOCK_AHEAD_TOLERANCE_MS, decodeHlc, emptyLanguageState, foldLanguage, isHlc, type AnyEvent, type Role } from '@langquest-next/core';
import { SNAPSHOT_SCHEDULE } from '../../snapshotWorker';
import { FakeServer } from '../fakeServer';
import { fakeSha256 } from '../memoryNearbyLink';
import { seededRandom, type Random } from '../random';
import { VirtualTime } from '../virtualTime';
import { OFFICE_HOURS, SimDevice, type FleetContext, type WorkPattern } from './device';
import { always, NETWORKS, TIME, type Link } from './links';
import { FleetNearby, type FleetNearbyOptions, type NearbyStats } from './nearby';
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
  /**
   * The server's projection pass: how often it runs, and when it writes a new
   * snapshot (after `minNewEvents`, or `maxAgeMs` once the stream moved) and
   * how long a replaced one stays downloadable. Defaults to the server's own
   * rule (SNAPSHOT_SCHEDULE, decisions.md 88). The rule before it was
   * `{ minNewEvents: 1, maxAgeMs: 0, retainMs: 0 }`.
   */
  snapshots?: { everyMs: number; minNewEvents: number; maxAgeMs?: number; retainMs?: number } | null;
  /** Characters per snapshot piece; the server's is 256 KB. */
  chunkChars?: number;
  realtime?: { on: boolean; delayMs: number };
  /**
   * Move the audio too: each card is a file of this many bytes per second
   * of recording (the app's AAC is about 16,000), uploaded and downloaded
   * by the app's transfer workers over the same link as sync. Off by
   * default, so runs without it count exactly what they always did.
   */
  audio?: { bytesPerSecond: number } | null;
  /**
   * The server refuses the language's events as not listed until this
   * simulated time, as it does when a phone pushes a new language's events
   * before the organization stream lists it (they are re-queued on every push).
   */
  unlistedUntil?: number;
  /**
   * Phones that keep the language on disk (decisions.md 143): every one, or
   * every other one, so the fleet's agreement covers both kinds of phone.
   */
  keepOnDisk?: boolean | 'half';
  /** Confirmed events between a phone's checkpoints; the app's is 2000. Fewer puts more through them in a short run. */
  /** Each phone's `checkpointEvery` (the app's is 2000), so a short run checkpoints and prunes. */
  checkpointEvery?: number;
  /**
   * The pass cuts each snapshot by passage and writes every line each run
   * (decisions.md 147), so phones that keep the language on disk take a
   * first download by fill. Off, the server is one from before.
   */
  serverCut?: boolean;
  /**
   * Phones can share nearby (docs/nearby-sync-plan.md): each SyncClient takes the nearby
   * platform, holds a fake-worker certificate, and the server attests what a phone pulled.
   * Off, a fleet runs exactly as it did before nearby existed.
   */
  nearby?: FleetNearbyOptions | null;
  /** The server refuses a clock over 5 minutes ahead of it, as `append_events` does; the phone re-stamps. Off by default, so runs without it count what they always did. */
  clockAhead?: boolean;
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
  /** Phones lost or broken (`lose`): out of the run, their unsent work with them. */
  readonly lost: SimDevice[] = [];
  /** Sharing between phones, when `FleetOptions.nearby` turns it on. */
  readonly nearby: FleetNearby | null = null;
  readonly orgId = 'org-fleet';
  readonly streamId = 'lang-fleet';
  snapshotsTaken = 0;
  private readonly random: Random;
  private readonly appendedAt = new Map<string, number>();
  private working = true;
  private lastSnapshotSeq = 0;
  private lastSnapshotAt = 0;
  private readonly context: FleetContext;

  constructor(readonly options: FleetOptions) {
    this.random = seededRandom(options.seed);
    this.server.chunkChars = options.chunkChars ?? 256 * 1024;
    this.server.serverCut = options.serverCut ?? false;
    this.context = {
      time: this.time,
      server: this.server,
      orgId: this.orgId,
      streamId: this.streamId,
      appendedAt: this.appendedAt,
      realtime: options.realtime ?? { on: true, delayMs: 1_000 },
      working: () => this.working,
      audio: options.audio ?? null,
      recordedAt: new Map(),
      keepsOnDisk: (index) => options.keepOnDisk === true || (options.keepOnDisk === 'half' && index % 2 === 1),
      ...(options.checkpointEvery !== undefined ? { checkpointEvery: options.checkpointEvery } : {}),
      ...(options.nearby ? { nearbyPlatform: { sha256: fakeSha256, holdsCertificate: () => true } } : {})
    };
    if (options.nearby) {
      const roles = new Map<string, Role>();
      this.nearby = new FleetNearby({
        time: this.time, orgId: this.orgId, streamId: this.streamId,
        roleOf: (actorId) => roles.get(actorId) ?? 'viewer'
      }, options.nearby);
      this.server.attester = (orgId, streamId, rows) => this.nearby!.worker.attestRows(orgId, streamId, rows);
      this.roles = roles;
    }
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

  private roles: Map<string, Role> | null = null;

  private add(id: string, actorId: string, persona: Persona, work: WorkPattern, link: Link): void {
    this.roles?.set(actorId, persona.role);
    this.devices.push(new SimDevice(id, actorId, persona, work, link, this.context, this.random.fork(`device:${id}`), this.devices.length));
  }

  /** Install every app; the coordinator sets the language up at once. */
  async start(): Promise<void> {
    const { realtime } = this.context;
    const unlisted = this.options.unlistedUntil;
    if (unlisted !== undefined) this.server.authorize = () => (this.time.now() < unlisted ? 'language not listed yet' : null);
    if (this.options.clockAhead) {
      const before = this.server.authorize;
      this.server.authorize = (e: AnyEvent) => {
        const now = this.time.now();
        if (isHlc(e.hlc) && decodeHlc(e.hlc).wallMs > now + CLOCK_AHEAD_TOLERANCE_MS) return `clock ahead: server time ${now}`;
        return before(e);
      };
    }
    this.server.appended.add(() => {
      if (!realtime.on) return;
      for (const d of this.devices) this.time.setTimeout(() => d.poke(), realtime.delayMs);
    });
    for (const d of this.devices) await d.install();
    if (this.nearby) for (const d of this.devices) await this.nearby.enrol(d);
    const coord = this.devices[0]!;
    const setup = coord.persona.next();
    if (setup) {
      const events = await coord.client.appendMany(setup);
      coord.metrics.appended += events.length;
      for (const e of events) this.appendedAt.set(e.id, this.time.now());
    }
    const snapshots = this.options.snapshots === undefined ? { everyMs: 5 * TIME.MINUTE, minNewEvents: SNAPSHOT_SCHEDULE.minNewEvents } : this.options.snapshots;
    if (snapshots) {
      this.server.now = this.time.now;
      this.server.retainMs = snapshots.retainMs ?? 6 * TIME.HOUR;
      this.snapshotPass({ ...snapshots, maxAgeMs: snapshots.maxAgeMs ?? SNAPSHOT_SCHEDULE.maxAgeMs });
    }
  }

  /** What the projection pass does to snapshots (server/projectionWorker.ts, every 5 minutes; snapshotWorker shouldWriteSnapshot). */
  private snapshotPass(o: { everyMs: number; minNewEvents: number; maxAgeMs: number }): void {
    this.time.setTimeout(() => {
      const head = this.server.head(this.orgId, this.streamId);
      const moved = head - this.lastSnapshotSeq;
      // As the server: write at once when there is no snapshot for the reducer it runs.
      const first = head > 0 && this.server.snapshots.get(`${this.orgId}/${this.streamId}`)?.reducerVersion !== this.server.reducerVersion;
      const redaction = !first && this.server.stream(this.orgId, this.streamId).slice(this.lastSnapshotSeq).some((e) => e.type === 'v1.Redacted');
      if (first || redaction || moved >= o.minNewEvents || (moved > 0 && this.time.now() - this.lastSnapshotAt >= o.maxAgeMs)) {
        this.server.makeSnapshot(this.orgId, this.streamId);
        this.lastSnapshotSeq = head;
        this.lastSnapshotAt = this.time.now();
        this.snapshotsTaken += 1;
      } else if (this.server.serverCut && head > (this.server.lines.get(`${this.orgId}/${this.streamId}`)?.seq ?? 0)) {
        // The pass folds every changed language and writes its lines, with or without a snapshot.
        this.server.writeLines(this.orgId, this.streamId);
      }
      this.snapshotPass(o);
    }, o.everyMs);
  }

  /**
   * A release that changes REDUCER_VERSION reaches the server: from its next
   * pass the snapshot worker writes snapshots for `version`, and until then
   * there is none for it. Phones get it later, with `SimDevice.update`.
   */
  deployReducer(version: number): void {
    this.server.reducerVersion = version;
  }

  /** Audio recorded on phones that the server does not hold yet. */
  audioBacklog(): number {
    let n = 0;
    for (const hash of this.context.recordedAt.keys()) if (!this.server.blobs.has(hash)) n += 1;
    return n;
  }

  runFor(ms: number): Promise<void> {
    return this.time.runFor(ms);
  }

  /** A phone lost or broken: it stops, and what it never sent goes with it. */
  async lose(device: SimDevice): Promise<void> {
    const at = this.devices.indexOf(device);
    if (at < 0) return;
    await this.nearby?.leave([device]);
    device.stop();
    this.devices.splice(at, 1);
    this.lost.push(device);
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
  async settle(maxMs = 12 * TIME.HOUR, o: { unsentBy?: ReadonlySet<string> } = {}): Promise<Agreement> {
    this.working = false;
    const started = this.time.now();
    for (const d of this.devices) d.setLink(always(NETWORKS.wifi, 'wifi'));
    let caughtUp = false;
    while (this.time.now() - started < maxMs) {
      await this.time.runFor(TIME.MINUTE);
      const all = await Promise.all(this.devices.map((d) => d.caughtUp(o)));
      if (all.every(Boolean)) { caughtUp = true; break; }
    }
    const settleMs = this.time.now() - started;
    for (const d of this.devices) d.stop();
    const log = this.server.stream(this.orgId, this.streamId);
    const expected = foldDigest(foldLanguage(log, emptyLanguageState()));
    // Work only a lost author could send stays nearby until delivery (phase 4). A phone holding any of it must hold all
    // that any phone holds, and agree on the server's log plus it; a phone that never met the team agrees on the log.
    const unsent = new Map<string, AnyEvent>();
    const held = new Map<SimDevice, number>();
    if (o.unsentBy) {
      for (const d of this.devices) {
        const mine = (await d.nearbyRows()).filter((e) => o.unsentBy!.has(e.actorId));
        held.set(d, mine.length);
        for (const e of mine) unsent.set(e.id, e);
      }
    }
    const withUnsent = unsent.size === 0 ? expected : foldDigest(foldLanguage([...log, ...unsent.values()], emptyLanguageState()));
    const disagree: string[] = [];
    for (const d of this.devices) if (foldDigest(await d.wholeState()) !== ((held.get(d) ?? 0) > 0 ? withUnsent : expected)) disagree.push(d.id);
    return { caughtUp, settleMs, agree: caughtUp && disagree.length === 0, disagree, digest: withUnsent };
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
        snapshotsTaken: this.snapshotsTaken,
        snapshotRowsCalls: this.server.rowsCalls
      },
      phones: {
        syncs: sum((d) => d.metrics.syncs),
        offlineSyncs: sum((d) => d.metrics.offlineSyncs),
        fills: sum((d) => d.metrics.fills),
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
      audio: this.context.audio ? {
        recorded: this.context.recordedAt.size,
        onServer: this.server.blobs.size,
        lost: all.reduce((n, d) => n + d.unsentAudio(), 0),
        uploads: sum((d) => d.metrics.uploads),
        uploadFailures: sum((d) => d.metrics.uploadFailures),
        mbUp: round(sum((d) => d.metrics.uploadBytes) / 1e6),
        downloads: sum((d) => d.metrics.downloads),
        downloadFailures: sum((d) => d.metrics.downloadFailures),
        mbDown: round(sum((d) => d.metrics.downloadBytes) / 1e6),
        toServerMinutes: stats(flat((d) => d.metrics.uploadDelayMs).map((ms) => ms / TIME.MINUTE)),
        playableElsewhereMinutes: stats(flat((d) => d.metrics.playableMs).map((ms) => ms / TIME.MINUTE)),
        workLists: sum((d) => d.metrics.workLists),
        workListCpuSeconds: round(sum((d) => d.metrics.workListCpuMs) / 1000)
      } : null,
      agreement,
      ...(this.nearby ? { nearby: this.nearbyReport(this.nearby.stats) } : {}),
      errors: this.time.errors.map((e) => (e instanceof Error ? e.message : String(e)))
    };
  }

  private nearbyReport(n: NearbyStats): NearbyReport {
    return {
      pairings: n.pairings, ended: n.ended, eventsSent: n.eventsSent, eventsTaken: n.eventsTaken, refused: n.refused, overBudget: n.overBudget,
      filesGot: n.filesGot, mbBluetooth: round((n.bytes['bluetooth'] ?? 0) / 1e6), mbWifi: round((n.bytes['wifi'] ?? 0) / 1e6),
      farAhead: n.farAhead, clockOff: n.clockOff,
      propagationMinutes: stats([...this.devices, ...this.lost].flatMap((d) => d.metrics.nearbyPropagationMs).map((ms) => ms / TIME.MINUTE))
    };
  }
}

/** What nearby sharing did over a run. */
export interface NearbyReport {
  /** Sessions a phone opened (each pairing once). */
  pairings: number;
  /** Sessions on either side, by how they ended. */
  ended: Record<string, number>;
  eventsSent: number;
  eventsTaken: number;
  refused: number;
  overBudget: number;
  filesGot: number;
  mbBluetooth: number;
  mbWifi: number;
  farAhead: number;
  clockOff: number;
  /** From an append on one phone to its arrival on another from a teammate. */
  propagationMinutes: Stats;
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
  server: { appendCalls: number; pullCalls: number; snapshotChunkCalls: number; snapshotsTaken: number; snapshotRowsCalls: number };
  phones: {
    syncs: number;
    offlineSyncs: number;
    /** Passages filled in from the server's cut. */
    fills: number;
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
  /** Audio, when the run moved it (FleetOptions.audio). */
  audio: {
    /** Files recorded on phones, and how many the server holds. */
    recorded: number;
    onServer: number;
    /** Recorded but still only on a phone when the run ended: work a lost phone would take with it. */
    lost: number;
    uploads: number;
    uploadFailures: number;
    mbUp: number;
    downloads: number;
    downloadFailures: number;
    mbDown: number;
    /** From recording to the server holding the file. */
    toServerMinutes: Stats;
    /** From recording on one phone to the file being playable on another. */
    playableElsewhereMinutes: Stats;
    /** How often the transfer workers worked out what to move, and the real CPU it cost. */
    workLists: number;
    workListCpuSeconds: number;
  } | null;
  agreement: Agreement | null;
  /** When the run shared nearby (FleetOptions.nearby). */
  nearby?: NearbyReport;
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
export function foldDigest(state: object): string {
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
