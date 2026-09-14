import type { EventStore, LocalEvent } from './types';

/** In-memory EventStore for tests. The SQLite one mirrors this shape. */
export class MemoryStore implements EventStore {
  private events = new Map<string, LocalEvent>();
  private cursors = new Map<string, number>();

  async put(local: LocalEvent): Promise<void> {
    this.events.set(local.event.id, local);
  }

  async get(id: string): Promise<LocalEvent | undefined> {
    return this.events.get(id);
  }

  async pending(orgId: string, projectId: string): Promise<LocalEvent[]> {
    return this.partition(orgId, projectId)
      .filter((e) => e.status === 'pending')
      .sort((a, b) => (a.event.hlc < b.event.hlc ? -1 : 1));
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

  /** Test helper. */
  rejected(): LocalEvent[] {
    return [...this.events.values()].filter((e) => e.status === 'rejected');
  }

  private partition(orgId: string, projectId: string): LocalEvent[] {
    return [...this.events.values()].filter(
      (e) => e.event.orgId === orgId && e.event.projectId === projectId
    );
  }
}
