import {
  emptyLanguageState, emptyOrgState, foldLanguage, foldOrg, languageInfo, languageReport, mayViewLanguage, ORG_STREAM, orgLanguages,
  REDUCER_VERSION, REPORT_VERSION, type AnyEvent, type LanguageReport, type LanguageState, type OrgState
} from '@langquest-next/core';
import { fetchSnapshot, type Transport } from '@langquest-next/client';
import type { OrgReportsResponse } from '@langquest-next/core';

/** What the folder reads from the server, with the service role. */
export type Source = Pick<Transport, 'pull' | 'snapshotMeta' | 'snapshotChunk'> & {
  /**
   * The newest serverSeq of every stream in the organization, in one
   * query (`stream_heads`). Optional: without it a pass pulls each
   * stream's tail to find out whether it moved.
   */
  heads?(orgId: string): Promise<Record<string, number>>;
};

/**
 * Text the folder keeps across evictions: the object's own SQLite in
 * production, a Map in tests. It only ever holds what the server snapshots
 * and the log can rebuild, tagged with the reducer and report versions, so
 * losing it costs a cold start and nothing else.
 */
export interface OrgCache {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export class MemoryCache implements OrgCache {
  readonly data = new Map<string, string>();
  async get(key: string) { return this.data.get(key) ?? null; }
  async put(key: string, value: string) { this.data.set(key, value); }
}

/** A snapshot older than this is caught up before it answers. */
export const MAX_AGE_MS = 60_000;
/** A language's fold is written to the cache when it has moved this far since the last write. */
export const STATE_SAVE_EVERY = 500;
/** Whole folds kept in memory, most recently used; the rest are read back from the cache when they move. */
export const STATES_IN_MEMORY = 8;
const PAGE = 1000;
const PARALLEL = 4;

interface Held<S> {
  state: S;
  /** serverSeq of the newest event folded in. */
  cursor: number;
  /** Folded again from the start because a redaction reached into it; the cache must not keep the old fold. */
  refolded?: boolean;
}

/**
 * What a language answers with, small enough to keep for every language.
 * Its name, country and target come from the organization stream, so a
 * summary is good for one organization cursor as well as one day.
 */
interface Summary {
  cursor: number;
  orgCursor: number;
  day: string;
  report: LanguageReport | null;
}

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * One organization's reports, kept by the dashboard's server (decision 44):
 * the organization stream and every language stream, folded with the same
 * reducer the phones run and caught up from the log's tail on request.
 * A language starts from the cache, else from the server snapshot the
 * projection worker writes. Between requests it keeps each language's
 * report, and only the most recent folds; a pass first asks for every
 * stream's head and touches only languages that moved (or whose reports
 * turned a day older, or whose organization settings changed). Raw state never leaves it; callers
 * get the reports of the languages they may view.
 */
export class OrgFolder {
  private org: Held<OrgState> | null = null;
  private readonly summaries = new Map<string, Summary>();
  private readonly states = new Map<string, Held<LanguageState>>();
  /** Cursor of each language's fold as last written to the cache. */
  private readonly saved = new Map<string, number>();
  private restored = false;
  private refreshedAt = 0;
  private running: Promise<void> | null = null;
  private queued: Promise<void> | null = null;

  constructor(
    private readonly source: Source,
    private readonly orgId: string,
    private readonly cache: OrgCache = new MemoryCache(),
    private readonly now: () => number = Date.now,
    private readonly maxAgeMs = MAX_AGE_MS
  ) {}

  /**
   * The caller's languages, caught up if the snapshot is stale or `fresh` is
   * asked for; null when they are not in the organization at all.
   */
  async reportsFor(profileId: string, fresh = false): Promise<OrgReportsResponse | null> {
    await this.refresh(fresh);
    const org = this.org!.state;
    const rows: OrgReportsResponse['rows'] = [];
    for (const { languageId } of orgLanguages(org)) {
      const report = this.summaries.get(languageId)?.report;
      if (report && mayViewLanguage(org, profileId, languageId)) rows.push({ languageId, report });
    }
    if (rows.length === 0 && !this.knows(profileId)) return null;
    return { rows, asOf: new Date(this.refreshedAt).toISOString() };
  }

  /** Is this person in the organization at all (any membership, active or not)? */
  knows(profileId: string): boolean {
    return !!this.org?.state.members[profileId];
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
    const day = isoDay(startedAt);
    const heads = (await this.source.heads?.(this.orgId)) ?? null;
    if (!this.restored) {
      this.org = await this.restore<OrgState>('org');
      this.restored = true;
    }
    const orgMoved = !this.org || heads === null || (heads[ORG_STREAM] ?? 0) > this.org.cursor;
    if (orgMoved) {
      const next = await this.catchUp(ORG_STREAM, this.org, emptyOrgState, foldOrg);
      if (next !== this.org && next.cursor > 0) await this.cache.put('org', this.pack(next));
      this.org = next;
    }
    const ids = orgLanguages(this.org!.state).map((l) => l.languageId);
    for (let i = 0; i < ids.length; i += PARALLEL) {
      await Promise.all(ids.slice(i, i + PARALLEL).map((id) => this.refreshLanguage(id, heads ? (heads[id] ?? 0) : undefined, day, startedAt)));
    }
    this.refreshedAt = startedAt;
  }

  /** Bring one language's summary up to date, folding only when it moved, the day turned or the organization changed. */
  private async refreshLanguage(id: string, head: number | undefined, day: string, at: number): Promise<void> {
    const org = this.org!;
    const summary = this.summaries.get(id) ?? (await this.restoreSummary(id));
    if (summary) this.summaries.set(id, summary);
    let peeked: AnyEvent[] | undefined;
    if (summary && summary.day === day && summary.orgCursor === org.cursor) {
      if (head !== undefined && head <= summary.cursor) return;
      if (head === undefined) {
        peeked = await this.pullAll(id, summary.cursor);
        if (peeked.length === 0) return;
      }
    }
    const known = await this.stateOf(id);
    // The peeked tail is reusable only when it starts where the fold ends; a fold already at the head needs no pull.
    const tail = peeked && known?.cursor === summary?.cursor ? peeked
      : known && head !== undefined && head <= known.cursor ? [] : undefined;
    const held = await this.catchUp(id, known, emptyLanguageState, foldLanguage, tail);
    this.keep(id, { state: held.state, cursor: held.cursor });
    const info = languageInfo(org.state, id);
    const next: Summary = { cursor: held.cursor, orgCursor: org.cursor, day, report: info ? languageReport(held.state, info, at) : null };
    this.summaries.set(id, next);
    if (held.cursor === 0) return; // nothing in the log yet, nothing worth keeping
    // Like a phone's checkpoint: a fold read back later catches up from its own cursor, so it need not be written every pass.
    const last = this.saved.get(id);
    if (last === undefined || held.refolded || held.cursor - last >= STATE_SAVE_EVERY) {
      await this.cache.put(`state:${id}`, this.pack(held));
      this.saved.set(id, held.cursor);
    }
    await this.cache.put(`summary:${id}`, JSON.stringify({ v: REDUCER_VERSION, rv: REPORT_VERSION, ...next }));
  }

  /** A language's fold: from memory, else the cache, else the server snapshot, else nothing (fold from zero). */
  private async stateOf(id: string): Promise<Held<LanguageState> | null> {
    const inMemory = this.states.get(id);
    if (inMemory) return inMemory;
    const cached = await this.restore<LanguageState>(`state:${id}`);
    if (cached) {
      this.saved.set(id, cached.cursor);
      return cached;
    }
    const snapshot = await fetchSnapshot(this.source, this.orgId, id, REDUCER_VERSION);
    return snapshot ? { state: snapshot.state, cursor: snapshot.serverSeq } : null;
  }

  /** Hold a fold in memory, dropping the least recently used beyond the limit. */
  private keep(id: string, held: Held<LanguageState>): void {
    this.states.delete(id);
    this.states.set(id, held);
    while (this.states.size > STATES_IN_MEMORY) this.states.delete(this.states.keys().next().value!);
  }

  private pack<S>(held: Held<S>): string {
    return JSON.stringify({ v: REDUCER_VERSION, cursor: held.cursor, state: held.state });
  }

  private async restore<S>(key: string): Promise<Held<S> | null> {
    const text = await this.cache.get(key);
    if (!text) return null;
    const saved = JSON.parse(text) as { v: number; cursor: number; state: S };
    return saved.v === REDUCER_VERSION ? { state: saved.state, cursor: saved.cursor } : null;
  }

  private async restoreSummary(id: string): Promise<Summary | null> {
    const text = await this.cache.get(`summary:${id}`);
    if (!text) return null;
    const { v, rv, ...summary } = JSON.parse(text) as Summary & { v: number; rv: number };
    return v === REDUCER_VERSION && rv === REPORT_VERSION ? summary : null;
  }

  /**
   * Fold what arrived after the cursor. A redaction of something already
   * folded refolds the whole log, so what it targets really disappears.
   */
  private async catchUp<S extends { appliedEventIds: Record<string, boolean> }>(
    streamId: string, known: Held<S> | null, empty: () => S, apply: (events: AnyEvent[], state: S) => S, pulled?: AnyEvent[]
  ): Promise<Held<S>> {
    const tail = pulled ?? await this.pullAll(streamId, known?.cursor ?? 0);
    if (known && tail.length === 0) return known;
    const inTail = new Set(tail.map((e) => e.id));
    const redactsFolded = !!known && tail.some((e) => e.type === 'v1.Redacted' && !inTail.has(e.payload.eventId));
    const events = redactsFolded ? await this.pullAll(streamId, 0) : tail;
    const state = apply(events, known && !redactsFolded ? known.state : empty());
    // Events at or below the cursor are never pulled again, so their ids need not be kept.
    state.appliedEventIds = {};
    return { state, cursor: events.at(-1)?.serverSeq ?? known?.cursor ?? 0, refolded: redactsFolded };
  }

  private async pullAll(streamId: string, after: number): Promise<AnyEvent[]> {
    const all: AnyEvent[] = [];
    for (;;) {
      const page = await this.source.pull(this.orgId, streamId, after, PAGE);
      all.push(...page);
      if (page.length < PAGE) return all;
      after = page[page.length - 1]!.serverSeq!;
    }
  }
}
