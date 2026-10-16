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
  /**
   * One sync run (push then pull); recorded when it moved something, was
   * slow, or changed outcome. `rejected` is split by reason (`rej*`, from
   * `rejectCodeOf`); `requeued` counts refused work queued again after a
   * membership change. `unrenewed`: the sign-in could not be renewed (a
   * rate limit, a 5xx or a captive portal), which once read as offline.
   * On `error`, `code` is the server's SQLSTATE or PostgREST code, or
   * `http<status>`, and `phase` says where it failed.
   */
  sync: {
    n: ['ms', 'pushNetMs', 'pullNetMs', 'applyMs', 'pushed', 'rejected', 'pulled', 'pages', 'pending', 'offlineMs',
      'rejNotMember', 'rejNotAllowed', 'rejNotListed', 'rejInvalid', 'rejClockAhead', 'rejOther', 'requeued', 'more'],
    t: {
      outcome: ['ok', 'offline', 'unrenewed', 'refused', 'too_old', 'error'], error: TOKEN, code: TOKEN,
      phase: ['push', 'pull', 'snapshot', 'checkpoint', 'load', 'store']
    }
  },
  /**
   * Folding the local log. `staleCheckpointSeq`: an update changed the
   * reducer, so the checkpoint up to this seq was dropped and the stream is
   * fetched again (syncClient.ts `dropStaleCheckpoint`). `reason` says why
   * the fold ran (only `open` is the person waiting on a screen);
   * `checkpoint` whether one was there to start from. `readMs` and
   * `foldMs` split `ms` into reading the store and folding.
   */
  load: {
    n: ['ms', 'events', 'fromSnapshot', 'staleCheckpointSeq', 'readMs', 'foldMs'],
    t: {
      reason: ['open', 'rejected', 'requeue', 'redaction', 'snapshot', 'membership', 'other'],
      checkpoint: ['none', 'ok', 'old_reducer']
    }
  },
  /** A phone rolling its confirmed prefix into a local checkpoint and pruning the log behind it. */
  checkpoint: { n: ['ms', 'kb', 'seq', 'pruned'], t: { path: ['fast', 'slow'] } },
  /** A stream opened on this phone until its first full pull: what the person waits through on a first open. */
  open: { n: ['ms', 'syncs', 'pulled', 'snapshotMs', 'loadMs'], t: { cold: ['yes', 'no'] } },
  /** Adopting a server snapshot: on a cold start, after a redaction inside the checkpoint, or after a reducer update. */
  snapshot: {
    n: ['ms', 'chunks', 'resumedChunks', 'bytes', 'seq'],
    t: { outcome: ['ok', 'none', 'stale'], why: ['cold', 'redaction', 'reducer'] }
  },
  /**
   * Blob transfers in one direction from one source, tallied over a window
   * rather than one record per file. Failures by cause; HTTP refusals the
   * Worker gives a meaning to have their own field (401/403 auth, 404,
   * 413 too large, 422 bad digest), the rest stay `failHttp4xx`. `failGone`:
   * the file to upload was no longer on the device.
   */
  transfer: {
    n: ['count', 'bytes', 'ms', 'maxMs', 'signMs', 'fetchMs', 'verifyMs', 'failOffline', 'failHttp4xx', 'failHttp5xx', 'failHash', 'failDisk', 'failOther',
      'failAuth', 'failNotFound', 'failTooLarge', 'failBadDigest', 'failGone'],
    t: { dir: ['up', 'down'], src: ['lang', 'guide', 'handover', 'stream', 'source', 'help', 'study'] }
  },
  /**
   * The phone's own state, sampled when records are delivered. Counts and
   * ages only: files lost behind the app's back (decision 92), recordings
   * waiting to be saved or sent, the oldest unsent recording and oldest
   * wanted download in minutes, how many streams and events the phone
   * holds, and the diagnostics queue itself (`diagDropped` since the last
   * delivery, past its 3000-record bound).
   */
  device: {
    n: ['freeDiskMb', 'totalDiskMb', 'blobCacheMb', 'blobsWanted',
      'lostFiles', 'lostRecordings', 'journalPending', 'journalFailed', 'uploadsWaiting', 'oldestUnsentMin', 'wantedStuckMin',
      'streams', 'localEvents', 'dbMb', 'diagQueued', 'diagDropped'],
    t: {}
  },
  /**
   * A fault that reached a boundary (apps/mobile/src/diagnostics/report.ts).
   * `code` is a fixed code the app gives the cause (a recorder's `nospace`,
   * a SQLSTATE), never a message.
   */
  error: { n: [], t: { name: TOKEN, where: TOKEN, errorId: TOKEN, fatal: ['yes', 'no'], code: TOKEN } },
  /**
   * Failures that are expected and already shown to the person
   * (`noteExpected`), tallied per hour by where, class and code: a refused
   * microphone, an invite that cannot be checked, a link that would not
   * sign. Counts, so a pattern shows without one record per tap.
   */
  expected: { n: ['count'], t: { where: TOKEN, name: TOKEN, code: TOKEN } },
  /** Recording and playback on this phone, tallied per hour per language. */
  audio: {
    n: ['takes', 'takeMs', 'tooShort', 'micRefused', 'startFail', 'stopFail', 'saveFail', 'encodeFail', 'wavKept', 'interrupted',
      'plays', 'playFail', 'playNotHere', 'streamFail'],
    t: {}
  },
  /**
   * Signing in, staying signed in and getting into an organization, one
   * record per attempt or change. `op` is what was tried, `outcome` how it
   * ended, `code` an Auth error code, SQLSTATE or our own code (never a
   * message). Hand-over (`courier`) counts what another person's sign-in
   * left to send, never who they are.
   */
  auth: {
    n: ['ms', 'status', 'attempt', 'ageH', 'pending', 'eventsLeft', 'uploadsLeft', 'accountLeft', 'sinceOkMs'],
    t: {
      op: ['sign_in', 'sign_up', 'code', 'v2', 'redeem', 'join', 'renew', 'ended', 'courier', 'outbox', 'route', 'delete', 'org_list'],
      outcome: ['ok', 'offline', 'http', 'refused', 'rate_limited', 'server', 'expired', 'used', 'not_found', 'retired', 'needs_name',
        'done', 'keep', 'gone', 'unreachable', 'retry', 'failed', 'home', 'no_org', 'org_unknown'],
      code: TOKEN,
      action: TOKEN
    }
  }
} as const;

/** Describes the phone and build; sent once per delivery, not per record. */
export const DIAG_CONTEXT = [
  'installId', 'os', 'osVersion', 'model', 'appVersion', 'runtimeVersion', 'updateId', 'channel',
  'embedded', 'reducerVersion', 'protocolVersion'
] as const;

export type DiagKind = keyof typeof DIAG_SCHEMA;
type DiagContextKey = (typeof DIAG_CONTEXT)[number];
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

interface DiagInput {
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
 * `addDiag` answers how many it dropped to stay in bounds, so the drop is
 * itself reported (`device.diagDropped`).
 */
export interface DiagStore {
  addDiag(record: DiagRecord, max: number): Promise<number>;
  /** Oldest first. */
  diagBatch(limit: number): Promise<DiagRecord[]>;
  removeDiag(ids: string[]): Promise<void>;
  diagCount(): Promise<number>;
}

export class MemoryDiagStore implements DiagStore {
  records: DiagRecord[] = [];
  async addDiag(record: DiagRecord, max: number): Promise<number> {
    if (!this.records.some((r) => r.id === record.id)) this.records.push(record);
    let dropped = 0;
    while (this.records.length > max) {
      const victim = this.records.findIndex((r) => r.kind !== 'error');
      this.records.splice(victim === -1 ? 0 : victim, 1);
      dropped += 1;
    }
    return dropped;
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

interface DiagnosticsOptions {
  store: DiagStore;
  newId: () => string;
  now?: () => number;
  /** Records kept on the phone before the oldest are dropped. Sized for weeks offline. */
  maxRecords?: number;
  /** A transfer tally closes after this long or this many files. */
  tallyWindowMs?: number;
  tallyMaxCount?: number;
  /** An `audio` or `expected` tally closes after this long. */
  hourlyWindowMs?: number;
}

export type FailureClass = 'offline' | 'http4xx' | 'http5xx' | 'hash' | 'disk' | 'other' | 'auth' | 'notFound' | 'tooLarge' | 'badDigest' | 'gone';

const FAIL_FIELD: Record<FailureClass, string> = {
  offline: 'failOffline', http4xx: 'failHttp4xx', http5xx: 'failHttp5xx', hash: 'failHash', disk: 'failDisk', other: 'failOther',
  auth: 'failAuth', notFound: 'failNotFound', tooLarge: 'failTooLarge', badDigest: 'failBadDigest', gone: 'failGone'
};

/** Where a blob transfer came from: a language's work list, or one of the paths beside it. */
export type TransferSource = (typeof DIAG_SCHEMA.transfer.t.src)[number];

interface TransferSample {
  orgId: string;
  streamId: string;
  bytes: number;
  ms: number;
  failure?: FailureClass;
  /** Download phases: signing the URL, the network fetch, reading and hashing on the phone. */
  signMs?: number;
  fetchMs?: number;
  verifyMs?: number;
  /** Defaults to `lang`, a language's own upload and download lists. */
  src?: TransferSource;
}

/** A counter on the hourly `audio` tally. */
export type AudioCounter = (typeof DIAG_SCHEMA.audio.n)[number];

/** The status in our own error texts and expo's: "(413)", "status 503", or a bare 4xx/5xx. */
function httpStatusIn(message: string): number | null {
  const m = /\((\d{3})\)|status (?:code )?(\d{3})|\b([45]\d\d)\b/i.exec(message);
  const s = m ? Number(m[1] ?? m[2] ?? m[3]) : NaN;
  return s >= 400 && s < 600 ? s : null;
}

/**
 * Why a transfer failed, from our own error texts
 * (apps/mobile/src/server/blobTransport.ts), the Worker's statuses
 * (apps/web/worker/blobs.ts) and the platform's network errors. Never from
 * user content.
 */
export function classifyTransferFailure(error: unknown): FailureClass {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'OfflineError' || /network|fetch failed|failed to fetch|timed out|timeout|unable to resolve|offline|hostname could not be found|could not connect|failed to connect|connection (?:was lost|reset|refused|abort)|internet connection/i.test(message)) return 'offline';
  if (/is gone from this device|no bytes for .* in this browser/i.test(message)) return 'gone';
  if (/hash mismatch/i.test(message)) return 'hash';
  if (/no space|not enough space|isn.t enough space|disk|ENOSPC|storage full|quota/i.test(message)) return 'disk';
  const status = httpStatusIn(message);
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'notFound';
  if (status === 413) return 'tooLarge';
  if (status === 422) return 'badDigest';
  if (status !== null && status >= 500) return 'http5xx';
  if (status !== null) return 'http4xx';
  if (/not signed in/i.test(message)) return 'auth';
  return 'other';
}

interface Tally {
  opened: number;
  kind: 'transfer' | 'audio' | 'expected';
  orgId?: string;
  streamId?: string;
  t: Record<string, string>;
  n: Record<string, number>;
}

/**
 * The recorder. One per app; the sync client, the transfer workers and the
 * error reporter all write through it.
 */
export class Diagnostics {
  private enabled = true;
  private readonly now: () => number;
  private readonly max: number;
  private readonly tallies = new Map<string, Tally>();
  private readonly o: Required<Pick<DiagnosticsOptions, 'tallyWindowMs' | 'tallyMaxCount' | 'hourlyWindowMs'>>;
  private writes: Promise<void> = Promise.resolve();
  private droppedSinceTaken = 0;

  constructor(private readonly opts: DiagnosticsOptions) {
    this.now = opts.now ?? (() => Date.now());
    this.max = opts.maxRecords ?? 3000;
    this.o = {
      tallyWindowMs: opts.tallyWindowMs ?? 60_000,
      tallyMaxCount: opts.tallyMaxCount ?? 50,
      hourlyWindowMs: opts.hourlyWindowMs ?? 3_600_000
    };
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
    this.writes = this.writes
      .then(async () => { this.droppedSinceTaken += (await this.opts.store.addDiag(clean, this.max)) || 0; })
      .catch(() => {});
  }

  /** Records dropped to keep the queue in bounds since the last call; the count restarts. */
  takeDropped(): number {
    const n = this.droppedSinceTaken;
    this.droppedSinceTaken = 0;
    return n;
  }

  /** Tally one blob transfer; a record is written when the window closes. */
  transfer(dir: 'up' | 'down', s: TransferSample): void {
    if (!this.enabled) return;
    const src = s.src ?? 'lang';
    const key = `transfer|${dir}|${src}|${s.orgId}|${s.streamId}`;
    const tally = this.openTally(key, { kind: 'transfer', orgId: s.orgId, streamId: s.streamId, t: { dir, src } });
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

  /**
   * Count recording or playback on the hourly `audio` tally for a language.
   * `ms` adds to `takeMs` when the counter is `takes`.
   */
  audio(where: { orgId?: string; streamId?: string }, counter: AudioCounter, by = 1): void {
    if (!this.enabled) return;
    const key = `audio|${where.orgId ?? ''}|${where.streamId ?? ''}`;
    const tally = this.openTally(key, { kind: 'audio', ...where, t: {} });
    tally.n[counter] = (tally.n[counter] ?? 0) + by;
    this.closeIfOld(key, tally);
  }

  /**
   * Count an expected failure (`noteExpected`) on the hourly `expected`
   * tally, by where it happened, the error's class and a fixed code. The
   * message is never kept.
   */
  expected(where: string, name: string, code?: string): void {
    if (!this.enabled) return;
    const t: Record<string, string> = { where, name };
    if (code) t.code = code;
    const key = `expected|${where}|${name}|${code ?? ''}`;
    const tally = this.openTally(key, { kind: 'expected', t });
    tally.n.count = (tally.n.count ?? 0) + 1;
    this.closeIfOld(key, tally);
  }

  private openTally(key: string, init: Omit<Tally, 'opened' | 'n'>): Tally {
    let tally = this.tallies.get(key);
    if (!tally) {
      tally = { ...init, opened: this.now(), n: {} };
      this.tallies.set(key, tally);
    }
    return tally;
  }

  private closeIfOld(key: string, tally: Tally): void {
    if (this.now() - tally.opened >= this.o.hourlyWindowMs) this.closeTally(key);
  }

  /** Close every open tally so the next delivery carries it. */
  closeTallies(): void {
    for (const key of [...this.tallies.keys()]) this.closeTally(key);
  }

  private closeTally(key: string): void {
    const tally = this.tallies.get(key);
    if (!tally) return;
    this.tallies.delete(key);
    this.record(tally.kind, {
      ...(tally.orgId ? { orgId: tally.orgId } : {}),
      ...(tally.streamId ? { streamId: tally.streamId } : {}),
      n: tally.n,
      t: tally.t
    });
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
