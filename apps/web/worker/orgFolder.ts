import {
  emptyOrgState, emptyState, fold, foldOrg, laneReports, mayViewLane, ORG_PARTITION, partitionOfLane, REDUCER_VERSION,
  workPartitionOf, type AnyEvent, type LaneReport, type OrgState, type ProjectState
} from '@langquest-next/core';
import { fetchSnapshot, type Transport } from '@langquest-next/client';
import type { OrgReportsResponse } from '../src/types';

/** What the folder reads from the server, with the service role. */
export type Source = Pick<Transport, 'pull' | 'snapshotMeta' | 'snapshotChunk'>;

/** A snapshot older than this is caught up before it answers. */
export const MAX_AGE_MS = 60_000;
const PAGE = 1000;
const PARALLEL = 4;

interface Partition<S> {
  state: S;
  /** serverSeq of the newest event folded in. */
  cursor: number;
}

interface Cached {
  key: string;
  reports: LaneReport[];
}

/**
 * One organization's state, kept by the dashboard's server (decision 44):
 * the org partition and every language partition, folded with the same
 * reducer the phones run and caught up from the log's tail on request.
 * It starts from the server snapshots the projection worker writes, so it
 * keeps nothing durable of its own. Raw state never leaves it; callers get
 * the reports of the languages they may view.
 */
export class OrgFolder {
  private org: Partition<OrgState> | null = null;
  private readonly partitions = new Map<string, Partition<ProjectState>>();
  private readonly cache = new Map<string, Cached>();
  private refreshedAt = 0;
  private running: Promise<void> | null = null;
  private queued: Promise<void> | null = null;

  constructor(
    private readonly source: Source,
    private readonly orgId: string,
    private readonly now: () => number = Date.now,
    private readonly maxAgeMs = MAX_AGE_MS
  ) {}

  /** The caller's languages, caught up if the snapshot is stale or `fresh` is asked for. */
  async reportsFor(profileId: string, fresh = false): Promise<OrgReportsResponse> {
    await this.refresh(fresh);
    const org = this.org!.state;
    const at = this.now();
    const rows: OrgReportsResponse['rows'] = [];
    for (const [projectId, p] of [...this.partitions].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      for (const report of this.reports(projectId, p, at)) {
        // A language copied out of the shared partition shows once, from where it syncs now.
        if (partitionOfLane(org, report.laneId) !== projectId) continue;
        if (!mayViewLane(org, p.state, profileId, projectId, report.laneId)) continue;
        rows.push({ projectId, laneId: report.laneId, report });
      }
    }
    return { rows, asOf: new Date(this.refreshedAt).toISOString() };
  }

  /** Is this person in the organization at all (any membership, active or not)? */
  knows(profileId: string): boolean {
    if (this.org?.state.members[profileId]) return true;
    for (const p of this.partitions.values()) if (p.state.members[profileId]) return true;
    return false;
  }

  /**
   * Catch up when stale, or always when forced. Requests during a pass share
   * it; a forced request during a pass waits for one more pass that starts
   * after it, so a setting saved just before is in the answer.
   */
  refresh(force = false): Promise<void> {
    if (!force && this.org && this.now() - this.refreshedAt < this.maxAgeMs) return Promise.resolve();
    if (!this.running) return this.start();
    if (!force) return this.running;
    this.queued ??= this.running.catch(() => undefined).then(() => {
      this.queued = null;
      return this.start();
    });
    return this.queued;
  }

  private start(): Promise<void> {
    this.running = this.pass().finally(() => { this.running = null; });
    return this.running;
  }

  private async pass(): Promise<void> {
    const startedAt = this.now();
    this.org = await this.catchUp(ORG_PARTITION, this.org, emptyOrgState, foldOrg);
    const org = this.org.state;
    const ids = [...new Set([...Object.keys(org.projects), workPartitionOf(org)])];
    for (let i = 0; i < ids.length; i += PARALLEL) {
      await Promise.all(ids.slice(i, i + PARALLEL).map(async (projectId) => {
        const known = this.partitions.get(projectId) ?? await this.fromSnapshot(projectId);
        this.partitions.set(projectId, await this.catchUp(projectId, known, emptyState, fold));
      }));
    }
    this.refreshedAt = startedAt;
  }

  private async fromSnapshot(projectId: string): Promise<Partition<ProjectState> | null> {
    const snapshot = await fetchSnapshot(this.source, this.orgId, projectId, REDUCER_VERSION);
    return snapshot ? { state: snapshot.state, cursor: snapshot.serverSeq } : null;
  }

  /**
   * Fold what arrived after the cursor. A redaction of something already
   * folded refolds the whole log, so what it targets really disappears.
   */
  private async catchUp<S extends { appliedEventIds: Record<string, boolean> }>(
    projectId: string, known: Partition<S> | null, empty: () => S, apply: (events: AnyEvent[], state: S) => S
  ): Promise<Partition<S>> {
    const tail = await this.pullAll(projectId, known?.cursor ?? 0);
    if (known && tail.length === 0) return known;
    const inTail = new Set(tail.map((e) => e.id));
    const redactsFolded = !!known && tail.some((e) => e.type === 'v1.Redacted' && !inTail.has(e.payload.eventId));
    const events = redactsFolded ? await this.pullAll(projectId, 0) : tail;
    const state = apply(events, known && !redactsFolded ? known.state : empty());
    // Events at or below the cursor are never pulled again, so their ids need not be kept.
    state.appliedEventIds = {};
    return { state, cursor: events.at(-1)?.serverSeq ?? known?.cursor ?? 0 };
  }

  private async pullAll(projectId: string, after: number): Promise<AnyEvent[]> {
    const all: AnyEvent[] = [];
    for (;;) {
      const page = await this.source.pull(this.orgId, projectId, after, PAGE);
      all.push(...page);
      if (page.length < PAGE) return all;
      after = page[page.length - 1]!.serverSeq!;
    }
  }

  /** Reports change with the log and with the date (overdue requests, the windows). */
  private reports(projectId: string, p: Partition<ProjectState>, at: number): LaneReport[] {
    const key = `${p.cursor}:${new Date(at).toISOString().slice(0, 10)}`;
    const cached = this.cache.get(projectId);
    if (cached?.key === key) return cached.reports;
    const reports = laneReports(p.state, at);
    this.cache.set(projectId, { key, reports });
    return reports;
  }
}
