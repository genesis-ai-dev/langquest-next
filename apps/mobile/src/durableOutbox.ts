/** Small account writes survive offline use, restarts, and account switches. */
interface OutboxStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
export interface AccountAction {
  id: string;
  kind: 'join_request' | 'profile' | 'user_event' | 'report' | 'block';
  payload: Record<string, unknown>;
  status: 'queued' | 'sent' | 'failed';
  error?: string;
}
export class DeliveryError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}
export class DurableOutbox {
  private writes: Promise<unknown> = Promise.resolve();
  private draining: Promise<boolean> | null = null;
  private listeners = new Set<(reason: 'queued' | 'updated') => void>();
  private key: string;
  constructor(
    readonly actorId: string,
    private storage: OutboxStorage,
    private deliver: (action: AccountAction) => Promise<void>
  ) { this.key = `account-outbox:${actorId}`; }

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
    await this.mutate((rows) => rows.some((r) => r.id === action.id)
      ? rows : [...rows, { ...action, status: 'queued' }], 'queued');
  }
  retry(id: string) {
    return this.mutate((rows) => rows.map((r) => r.id === id
      ? { ...r, status: 'queued', error: undefined } : r), 'queued');
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
          ? { ...r, status: 'sent', error: undefined } : r));
      } catch (error) {
        const retryable = !(error instanceof DeliveryError) || error.retryable;
        await this.mutate((rows) => rows.map((r) => r.id === action.id
          ? { ...r, status: retryable ? 'queued' : 'failed',
            error: error instanceof Error ? error.message : String(error) } : r));
        if (retryable) return false;
      }
    }
  }
}
