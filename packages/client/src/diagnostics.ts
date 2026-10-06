/**
 * Field diagnostics (docs/diagnostics.md, decisions.md 39): small,
 * content-free records of how the app behaved on this phone, kept on disk
 * and delivered later to our own database, so support can answer "why is
 * this translator's download slow" without asking them to describe it.
 *
 * What a record may hold is an allowlist, `DIAG_SCHEMA`, not a denylist.
 * Numbers are measurements (ms, bytes, counts). Tags are either one of a
 * fixed set of values or a short code-like token that code, never a person,
 * wrote. The only free-form field is an error's stack frames, with the
 * message line and file paths removed. Nothing here can carry audio, text
 * people typed, names, emails, invite codes or locations, and the server
 * applies the same allowlist again (`diag.clean` in the migration; a test
 * holds the two equal).
 *
 * Recording never throws and never waits: diagnostics must not be the thing
 * that breaks or slows the app they are describing.
 */

/** A tag whose value is a code-like token (release ids, error class names), not an enum. */
const TOKEN = 'token';

/**
 * Short code-like text: letters, digits, spaces and a few separators, no @,
 * quotes or commas. Tags are written by code, never from what someone typed;
 * this keeps an accidental email or sentence out, it does not prove intent.
 */
export const DIAG_TOKEN = /^[A-Za-z0-9 _.:()/#-]{1,80}$/;

export const DIAG_SCHEMA = {
  /** One sync run (push then pull); recorded when it moved something, was slow, or changed outcome. */
  sync: {
    n: ['ms', 'pushNetMs', 'pullNetMs', 'applyMs', 'pushed', 'rejected', 'pulled', 'pages', 'pending', 'offlineMs'],
    t: { outcome: ['ok', 'offline', 'refused', 'too_old', 'error'], error: TOKEN }
  },
  /** Folding the local log at open. */
  load: { n: ['ms', 'events', 'fromSnapshot'], t: {} },
  /** Adopting a server snapshot on a cold start. */
  snapshot: {
    n: ['ms', 'chunks', 'resumedChunks', 'bytes', 'seq'],
    t: { outcome: ['ok', 'none', 'stale'] }
  },
  /** Blob transfers in one direction, tallied over a window rather than one record per file. */
  transfer: {
    n: ['count', 'bytes', 'ms', 'maxMs', 'signMs', 'fetchMs', 'verifyMs', 'failOffline', 'failHttp4xx', 'failHttp5xx', 'failHash', 'failDisk', 'failOther'],
    t: { dir: ['up', 'down'] }
  },
  /** The phone's own state, sampled when records are delivered. */
  device: { n: ['freeDiskMb', 'totalDiskMb', 'blobCacheMb', 'blobsWanted'], t: {} },
  /** A fault that reached a boundary (apps/mobile/src/report.ts). */
  error: { n: [], t: { name: TOKEN, where: TOKEN, errorId: TOKEN, fatal: ['yes', 'no'] } }
} as const;

/** Describes the phone and build; sent once per delivery, not per record. */
export const DIAG_CONTEXT = [
  'installId', 'os', 'osVersion', 'model', 'appVersion', 'runtimeVersion', 'updateId', 'channel',
  'embedded', 'reducerVersion', 'protocolVersion'
] as const;

export type DiagKind = keyof typeof DIAG_SCHEMA;
export type DiagContextKey = (typeof DIAG_CONTEXT)[number];
export type DiagContext = Partial<Record<DiagContextKey, string>>;

export interface DiagRecord {
  id: string;
  kind: DiagKind;
  /** Device wall time at capture, ms. Arrival can be weeks later; the gap is itself a clue. */
  at: number;
  orgId?: string;
  streamId?: string;
  n: Record<string, number>;
  t: Record<string, string>;
  /** Error records only: stack frames, no message line, file names without paths. */
  stack?: string;
}

export interface DiagInput {
  orgId?: string;
  streamId?: string;
  n?: Record<string, number>;
  t?: Record<string, string>;
  stack?: string;
}

const MAX_NUMBER = 1e12;
const MAX_FRAMES = 40;

/**
 * Keep only frames from a JS stack. The first line of `Error.stack` is
 * `Name: message`, and messages can carry what someone typed, so it goes;
 * so does anything else that is not a frame. Paths shrink to file names
 * (an iOS container path is noise, and a dev build's path names a person's
 * home folder).
 */
export function stackFrames(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  const frames = stack
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^at \S/.test(l) || /^[\w$.<>]*@\S+:\d+:\d+$/.test(l))
    .slice(0, MAX_FRAMES)
    .map((l) => l.replace(/(?:[A-Za-z]+:\/\/)?(?:\/[^/\s():]+)+\/([^/\s():]+)/g, '$1'));
  return frames.length > 0 ? frames.join('\n') : undefined;
}

/** Apply the allowlist. Returns null when the record is not one we know how to keep. */
export function sanitizeDiag(input: unknown): DiagRecord | null {
  if (!input || typeof input !== 'object') return null;
  const r = input as Record<string, unknown>;
  const kind = r.kind as DiagKind;
  const spec = Object.prototype.hasOwnProperty.call(DIAG_SCHEMA, kind as string) ? DIAG_SCHEMA[kind] : undefined;
  if (!spec || typeof r.id !== 'string' || !DIAG_TOKEN.test(r.id)) return null;
  if (typeof r.at !== 'number' || !Number.isFinite(r.at)) return null;
  const n: Record<string, number> = {};
  const inN = (r.n ?? {}) as Record<string, unknown>;
  for (const key of spec.n as readonly string[]) {
    const v = inN[key];
    if (typeof v === 'number' && Number.isFinite(v)) n[key] = Math.round(Math.min(MAX_NUMBER, Math.max(-MAX_NUMBER, v)));
  }
  const t: Record<string, string> = {};
  const inT = (r.t ?? {}) as Record<string, unknown>;
  for (const [key, allowed] of Object.entries(spec.t) as [string, readonly string[] | typeof TOKEN][]) {
    const v = inT[key];
    if (typeof v !== 'string') continue;
    if (allowed === TOKEN ? DIAG_TOKEN.test(v) : allowed.includes(v)) t[key] = v;
  }
  const out: DiagRecord = { id: r.id, kind, at: Math.round(r.at), n, t };
  if (typeof r.orgId === 'string' && DIAG_TOKEN.test(r.orgId)) out.orgId = r.orgId;
  if (out.orgId && typeof r.streamId === 'string' && DIAG_TOKEN.test(r.streamId)) out.streamId = r.streamId;
  if (kind === 'error' && typeof r.stack === 'string') {
    const frames = stackFrames(r.stack);
    if (frames) out.stack = frames;
  }
  return out;
}

/** Keep only known context keys with token values. */
export function sanitizeContext(input: Partial<Record<DiagContextKey, string | null | undefined>>): DiagContext {
  const out: DiagContext = {};
  for (const key of DIAG_CONTEXT) {
    const v = input[key];
    if (typeof v === 'string' && DIAG_TOKEN.test(v)) out[key] = v;
  }
  return out;
}

/**
 * Where records wait for delivery. Bounded: past `max` the oldest go first,
 * error records last, because a crash is never the record we sample away.
 */
export interface DiagStore {
  addDiag(record: DiagRecord, max: number): Promise<void>;
  /** Oldest first. */
  diagBatch(limit: number): Promise<DiagRecord[]>;
  removeDiag(ids: string[]): Promise<void>;
  diagCount(): Promise<number>;
}

export class MemoryDiagStore implements DiagStore {
  records: DiagRecord[] = [];
  async addDiag(record: DiagRecord, max: number): Promise<void> {
    if (!this.records.some((r) => r.id === record.id)) this.records.push(record);
    while (this.records.length > max) {
      const victim = this.records.findIndex((r) => r.kind !== 'error');
      this.records.splice(victim === -1 ? 0 : victim, 1);
    }
  }
  async diagBatch(limit: number): Promise<DiagRecord[]> {
    return [...this.records].sort((a, b) => a.at - b.at).slice(0, limit);
  }
  async removeDiag(ids: string[]): Promise<void> {
    const gone = new Set(ids);
    this.records = this.records.filter((r) => !gone.has(r.id));
  }
  async diagCount(): Promise<number> {
    return this.records.length;
  }
}

export interface DiagnosticsOptions {
  store: DiagStore;
  newId: () => string;
  now?: () => number;
  /** Records kept on the phone before the oldest are dropped. Sized for weeks offline. */
  maxRecords?: number;
  /** A transfer tally closes after this long or this many files. */
  tallyWindowMs?: number;
  tallyMaxCount?: number;
}

type FailureClass = 'offline' | 'http4xx' | 'http5xx' | 'hash' | 'disk' | 'other';

const FAIL_FIELD: Record<FailureClass, string> = {
  offline: 'failOffline', http4xx: 'failHttp4xx', http5xx: 'failHttp5xx', hash: 'failHash', disk: 'failDisk', other: 'failOther'
};

export interface TransferSample {
  orgId: string;
  streamId: string;
  bytes: number;
  ms: number;
  failure?: FailureClass;
  /** Download phases: signing the URL, the network fetch, reading and hashing on the phone. */
  signMs?: number;
  fetchMs?: number;
  verifyMs?: number;
}

/** Why a transfer failed, from our own error texts (apps/mobile/src/blobTransport.ts). Never from user content. */
export function classifyTransferFailure(error: unknown): FailureClass {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'OfflineError' || /network|fetch failed|failed to fetch|timed out|timeout|unable to resolve|offline/i.test(message)) return 'offline';
  if (/hash mismatch/i.test(message)) return 'hash';
  if (/\b5\d\d\b/.test(message)) return 'http5xx';
  if (/\b4\d\d\b/.test(message)) return 'http4xx';
  if (/no space|disk|ENOSPC|storage full/i.test(message)) return 'disk';
  return 'other';
}

/**
 * The recorder. One per app; the sync client, the transfer workers and the
 * error reporter all write through it.
 */
export class Diagnostics {
  private enabled = true;
  private readonly now: () => number;
  private readonly max: number;
  private readonly tallies = new Map<string, { opened: number; orgId: string; streamId: string; dir: 'up' | 'down'; n: Record<string, number> }>();
  private readonly o: Required<Pick<DiagnosticsOptions, 'tallyWindowMs' | 'tallyMaxCount'>>;
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly opts: DiagnosticsOptions) {
    this.now = opts.now ?? (() => Date.now());
    this.max = opts.maxRecords ?? 3000;
    this.o = { tallyWindowMs: opts.tallyWindowMs ?? 60_000, tallyMaxCount: opts.tallyMaxCount ?? 50 };
  }

  /** Off means nothing is recorded or sent (the person's choice, docs/diagnostics.md). */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.tallies.clear();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Record something. Never throws, never blocks the caller. */
  record(kind: DiagKind, input: DiagInput = {}): void {
    if (!this.enabled) return;
    const clean = sanitizeDiag({ ...input, id: this.opts.newId(), kind, at: this.now() });
    if (!clean) return;
    this.writes = this.writes.then(() => this.opts.store.addDiag(clean, this.max)).catch(() => {});
  }

  /** Tally one blob transfer; a record is written when the window closes. */
  transfer(dir: 'up' | 'down', s: TransferSample): void {
    if (!this.enabled) return;
    const key = `${dir}|${s.orgId}|${s.streamId}`;
    let tally = this.tallies.get(key);
    if (!tally) {
      tally = { opened: this.now(), orgId: s.orgId, streamId: s.streamId, dir, n: {} };
      this.tallies.set(key, tally);
    }
    const n = tally.n;
    const add = (field: string, v: number | undefined) => { if (v !== undefined) n[field] = (n[field] ?? 0) + v; };
    add('count', 1);
    add('ms', s.ms);
    add('signMs', s.signMs);
    add('fetchMs', s.fetchMs);
    add('verifyMs', s.verifyMs);
    n.maxMs = Math.max(n.maxMs ?? 0, s.ms);
    if (s.failure) add(FAIL_FIELD[s.failure], 1);
    else add('bytes', s.bytes);
    if ((n.count ?? 0) >= this.o.tallyMaxCount || this.now() - tally.opened >= this.o.tallyWindowMs) this.closeTally(key);
  }

  /** Close every open tally so the next delivery carries it. */
  closeTallies(): void {
    for (const key of [...this.tallies.keys()]) this.closeTally(key);
  }

  private closeTally(key: string): void {
    const tally = this.tallies.get(key);
    if (!tally) return;
    this.tallies.delete(key);
    this.record('transfer', { orgId: tally.orgId, streamId: tally.streamId, n: tally.n, t: { dir: tally.dir } });
  }

  /** Wait for queued writes; tests and delivery use it. */
  settle(): Promise<void> {
    return this.writes;
  }

  pendingCount(): Promise<number> {
    return this.opts.store.diagCount();
  }

  /**
   * Deliver up to `batches` batches, oldest first. A batch is removed only
   * after `send` resolves, so a dropped link resends it; the server ignores
   * ids it already holds. Returns how many were delivered.
   */
  async flush(send: (records: DiagRecord[]) => Promise<void>, opts: { batchSize?: number; batches?: number } = {}): Promise<number> {
    if (!this.enabled) return 0;
    this.closeTallies();
    await this.settle();
    let sent = 0;
    for (let i = 0; i < (opts.batches ?? 3); i++) {
      const batch = await this.opts.store.diagBatch(opts.batchSize ?? 100);
      if (batch.length === 0) break;
      await send(batch);
      await this.opts.store.removeDiag(batch.map((r) => r.id));
      sent += batch.length;
    }
    return sent;
  }
}
