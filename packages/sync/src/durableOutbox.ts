/** Small account writes survive offline use, restarts, and account switches. */
interface OutboxStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
export interface AccountAction {
  id: string;
  kind: 'join_request' | 'profile' | 'user_event' | 'report' | 'block' | 'feedback';
  payload: Record<string, unknown>;
  status: 'queued' | 'sent' | 'failed';
  error?: string;
  /** When it was queued (ms); rows queued before this was kept have none. */
  queuedAt?: number;
  /** Deliveries that failed since it was queued or retried by hand, and when one was last told to `onFailure`. */
  tries?: number;
  notedAt?: number;
}
/** `code`: the server's fixed code for the refusal (a SQLSTATE), or our own; never its message. */
export class DeliveryError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly code?: string) { super(message); }
}

/**
 * A delivery that failed, for diagnostics: what kind of change, whether it
 * will be tried again, how many tries so far and how long it has waited.
 * Never the payload. A change failing again is told at most once an hour.
 */
export interface OutboxFailure {
  kind: AccountAction['kind'];
  outcome: 'retry' | 'failed';
  error: unknown;
  attempt: number;
  ageMs?: number;
}

const NOTE_EVERY_MS = 3_600_000;

/** The action with a new status and no error or tries left over from an earlier one. */
function cleared(r: AccountAction, status: AccountAction['status']): AccountAction {
  const { error: _error, tries: _tries, notedAt: _notedAt, ...rest } = r;
  return { ...rest, status };
}
export class DurableOutbox {
  private writes: Promise<unknown> = Promise.resolve();
  private draining: Promise<boolean> | null = null;
  private listeners = new Set<(reason: 'queued' | 'updated') => void>();
  private key: string;
  constructor(
    readonly actorId: string,
    private storage: OutboxStorage,
    private deliver: (action: AccountAction) => Promise<void>,
    private opts: { onFailure?: (failure: OutboxFailure) => void; now?: () => number } = {}
  ) { this.key = `account-outbox:${actorId}`; }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  subscribe(listener: (reason: 'queued' | 'updated') => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  async list(): Promise<AccountAction[]> {
    await this.writes;
    return this.read();
  }
  private async read(): Promise<AccountAction[]> {
    return JSON.parse(await this.storage.getItem(this.key) ?? '[]');
  }
  private mutate(fn: (rows: AccountAction[]) => AccountAction[], reason: 'queued' | 'updated' = 'updated') {
    const next = this.writes.then(async () => {
      const rows = fn(await this.read());
      const sent = rows.filter((r) => r.status === 'sent').slice(-100);
      await this.storage.setItem(this.key, JSON.stringify([
        ...rows.filter((r) => r.status !== 'sent'), ...sent
      ]));
      for (const listener of this.listeners) listener(reason);
    });
    this.writes = next.catch(() => {});
    return next;
  }
  async enqueue(action: Omit<AccountAction, 'status'>) {
    if (this.actorId === 'guest') throw new Error('Sign in first.');
    const queuedAt = this.now();
    await this.mutate((rows) => rows.some((r) => r.id === action.id)
      ? rows : [...rows, { ...action, status: 'queued', queuedAt }], 'queued');
  }
  retry(id: string) {
    return this.mutate((rows) => rows.map((r) => r.id === id
      ? cleared(r, 'queued') : r), 'queued');
  }
  /** False means retry later. A permanent refusal remains visible. */
  flush(): Promise<boolean> {
    if (this.draining) return this.draining;
    this.draining = this.drain().finally(() => { this.draining = null; });
    return this.draining;
  }
  private async drain(): Promise<boolean> {
    for (;;) {
      const action = (await this.list()).find((r) => r.status === 'queued');
      if (!action) return true;
      try {
        await this.deliver(action);
        await this.mutate((rows) => rows.map((r) => r.id === action.id
          ? cleared(r, 'sent') : r));
      } catch (error) {
        const retryable = !(error instanceof DeliveryError) || error.retryable;
        const now = this.now();
        const tries = (action.tries ?? 0) + 1;
        const note = !retryable || action.notedAt === undefined || now - action.notedAt >= NOTE_EVERY_MS;
        await this.mutate((rows) => rows.map((r) => r.id === action.id
          ? { ...r, status: retryable ? 'queued' : 'failed', tries, ...(note ? { notedAt: now } : {}),
            error: error instanceof Error ? error.message : String(error) } : r));
        if (note) {
          try {
            this.opts.onFailure?.({
              kind: action.kind, outcome: retryable ? 'retry' : 'failed', error, attempt: tries,
              ...(action.queuedAt !== undefined ? { ageMs: now - action.queuedAt } : {})
            });
          } catch { /* diagnostics never stop a delivery */ }
        }
        if (retryable) return false;
      }
    }
  }
}
