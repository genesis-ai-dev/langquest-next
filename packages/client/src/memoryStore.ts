import type { EventStore, LocalEvent } from './types';

/** In-memory EventStore for tests. The SQLite one mirrors this shape. */
export class MemoryStore implements EventStore {
  private events = new Map<string, LocalEvent>();
  private cursors = new Map<string, number>();
  private metas = new Map<string, string>();

  async put(local: LocalEvent): Promise<void> {
    this.events.set(local.event.id, local);
  }

  async putMany(locals: LocalEvent[]): Promise<void> {
    for (const l of locals) this.events.set(l.event.id, l);
  }

  async get(id: string): Promise<LocalEvent | undefined> {
    return this.events.get(id);
  }

  async pending(orgId: string, projectId: string): Promise<LocalEvent[]> {
    return this.partition(orgId, projectId)
      .filter((e) => e.status === 'pending')
      .sort((a, b) => (a.event.hlc < b.event.hlc ? -1 : 1));
  }

  async pendingPage(orgId: string, projectId: string, afterHlc: string | null, limit: number): Promise<LocalEvent[]> {
    const all = await this.pending(orgId, projectId);
    return all.filter((e) => afterHlc === null || e.event.hlc > afterHlc).slice(0, limit);
  }

  async pendingCount(orgId: string, projectId: string): Promise<number> {
    return this.partition(orgId, projectId).filter((e) => e.status === 'pending').length;
  }

  async all(orgId: string, projectId: string): Promise<LocalEvent[]> {
    return this.partition(orgId, projectId).filter((e) => e.status !== 'rejected');
  }

  async cursor(orgId: string, projectId: string): Promise<number> {
    return this.cursors.get(`${orgId}/${projectId}`) ?? 0;
  }

  async setCursor(orgId: string, projectId: string, seq: number): Promise<void> {
    this.cursors.set(`${orgId}/${projectId}`, seq);
  }

  async prune(orgId: string, projectId: string, uptoSeq: number): Promise<void> {
    for (const [id, e] of this.events) {
      if (e.status === 'confirmed' && e.event.orgId === orgId && e.event.projectId === projectId
          && (e.event.serverSeq ?? Infinity) <= uptoSeq) this.events.delete(id);
    }
  }

  async meta(key: string): Promise<string | undefined> {
    return this.metas.get(key);
  }

  async setMeta(key: string, value: string): Promise<void> {
    this.metas.set(key, value);
  }

  async rejected(orgId?: string, projectId?: string): Promise<LocalEvent[]> {
    return [...this.events.values()]
      .filter((e) => e.status === 'rejected')
      .filter((e) => orgId === undefined || (e.event.orgId === orgId && e.event.projectId === projectId))
      .sort((a, b) => (a.event.hlc < b.event.hlc ? -1 : 1));
  }

  private partition(orgId: string, projectId: string): LocalEvent[] {
    return [...this.events.values()].filter(
      (e) => e.event.orgId === orgId && e.event.projectId === projectId
    );
  }
}
