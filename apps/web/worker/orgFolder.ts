import {
  emptyLanguageState, emptyOrgState, foldLanguage, foldOrg, languageInfo, languageReport, mayViewLanguage, ORG_STREAM, orgLanguages,
  REDUCER_VERSION, renderLanguageReport, REPORT_VERSION, type AnyEvent, type LanguageReport, type LanguageState, type OrgState, type ReportInputs
} from '@langquest-next/core';
import { fetchSnapshot, type Transport } from '@langquest-next/sync';
import type { OrgReportsResponse } from '@langquest-next/core';

/** What the folder reads from the server, with the service role. */
export type Source = Pick<Transport, 'pull' | 'snapshotMeta' | 'snapshotChunk'> & {
  /**
   * The newest serverSeq of every stream in the organization, in one
   * query (`stream_heads`). Optional: without it a pass pulls each
   * stream's tail to find out whether it moved.
   */
  heads?(orgId: string): Promise<Record<string, number>>;
  /**
   * The report inputs the projection pass stored for this REPORT_VERSION
   * (`language_report_inputs`, decisions.md 142): each language's stream
   * position and when they were written, in one query. Optional: without
   * it, or for a language it does not list, the report is folded.
   */
  reportHeads?(orgId: string): Promise<Record<string, StoredInputs>>;
  /** One language's stored report inputs, or null when there are none for this REPORT_VERSION. */
  reportInputs?(orgId: string, languageId: string): Promise<(StoredInputs & { inputs: ReportInputs }) | null>;
};

/** Where a language's stored report inputs stand: the stream position they were extracted at, and when (ms). */
export interface StoredInputs { seq: number; at: number }

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
const MAX_AGE_MS = 60_000;
/** A language's fold is written to the cache when it has moved this far since the last write. */
export const STATE_SAVE_EVERY = 500;
/**
 * Whole folds kept in memory, most recently used first out, by the size of
 * their serialized text. A parsed fold takes about twice that in V8's heap,
 * and the isolate is reset past 128 MB, so held folds stay well under half
 * of it: a pass still folds, packs and measures a language on top of them.
 * At 40 MB an organization's Durable Object ran out of memory (2026-10-16,
 * test/memory). The rest are read back from the cache when they move. One
 * fold is always kept, however large.
 */
export const STATE_BUDGET_BYTES = 12_000_000;
/** A language whose fold is at least this big is refreshed alone; smaller ones run PARALLEL at a time. */
export const LARGE_STATE_BYTES = 2_000_000;
const PAGE = 1000;
const PARALLEL = 4;

/** Memory limits; tests set small ones. */
export interface FolderLimits {
  stateBudgetBytes?: number;
  largeStateBytes?: number;
}

interface Held<S> {
  state: S;
  /** serverSeq of the newest event folded in. */
  cursor: number;
  /** Length of the fold as serialized text: read, packed or measured. Absent until one of those has happened. */
  bytes?: number | undefined;
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
  /** Serialized size of the fold when the summary was made; decides whether a pass refreshes the language alone. Absent in summaries written before it existed (treated as large). */
  bytes?: number;
  /** Rendered from the inputs the projection pass stored, not from a fold here; `cursor` is the inputs' stream position. */
  fromInputs?: true;
  /** How current the report is (ms): the inputs' writing when the stream has moved past them. Absent: as of the pass. */
  asOf?: number;
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
  /** When orgOnly last caught the organization stream up. */
  private orgCheckedAt = 0;
  private running: Promise<void> | null = null;
  private queued: Promise<void> | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly source: Source,
    private readonly orgId: string,
    private readonly cache: OrgCache = new MemoryCache(),
    private readonly now: () => number = Date.now,
    private readonly maxAgeMs = MAX_AGE_MS,
    limits: FolderLimits = {}
  ) {
    this.stateBudget = limits.stateBudgetBytes ?? STATE_BUDGET_BYTES;
    this.largeState = limits.largeStateBytes ?? LARGE_STATE_BYTES;
  }

  private readonly stateBudget: number;
  private readonly largeState: number;

  /** The languages whose folds are held in memory, least recently used first (for tests and diagnostics). */
  heldLanguages(): string[] {
    return [...this.states.keys()];
  }

  /**
   * The caller's languages, caught up if the snapshot is stale or `fresh` is
   * asked for; null when they are not in the organization at all.
   */
  async reportsFor(profileId: string, fresh = false): Promise<OrgReportsResponse | null> {
    await this.refresh(fresh);
    const org = this.org!.state;
    const rows: OrgReportsResponse['rows'] = [];
    // The oldest figures shown: a report rendered from inputs the stream has since passed is as of their writing.
    let asOf = this.refreshedAt;
    for (const { languageId } of orgLanguages(org)) {
      const summary = this.summaries.get(languageId);
      if (summary?.report && mayViewLanguage(org, profileId, languageId)) {
        rows.push({ languageId, report: summary.report });
        asOf = Math.min(asOf, summary.asOf ?? this.refreshedAt);
      }
    }
    if (rows.length === 0 && !this.knows(profileId)) return null;
    return { rows, asOf: new Date(asOf).toISOString() };
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
    this.running = this.exclusive(() => this.pass()).finally(() => { this.running = null; });
    return this.running;
  }

  /**
   * Folding mutates a state in place, so a pass and an API read must never
   * catch up the same language at once: both would apply the same tail to
   * one object. Everything that folds runs here, one at a time.
   */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** The organization's state, caught up like a report (the access-token API, decision 70). */
  async orgState(fresh = false): Promise<OrgState> {
    await this.refresh(fresh);
    return this.org!.state;
  }

  /**
   * A language's whole fold, caught up to the log's tail now: a fold read
   * back from the cache can be up to STATE_SAVE_EVERY events behind its
   * summary. Null when the organization does not list the language.
   */
  async languageState(languageId: string, fresh = false): Promise<{ org: OrgState; state: LanguageState } | null> {
    await this.refresh(fresh);
    return this.exclusive(async () => {
      const org = this.org!.state;
      if (!languageInfo(org, languageId)) return null;
      const held = await this.catchUp(languageId, await this.stateOf(languageId), emptyLanguageState, foldLanguage);
      this.keep(languageId, held);
      return { org, state: held.state };
    });
  }

  /**
   * The organization stream alone, caught up when older than a pass would
   * be, without folding any language: who belongs, with which role, in
   * which languages. Access checks need nothing more. A full pass folds
   * every language first, and a language too big to fold inside the
   * isolate made /connect answer 502 for its whole organization
   * (2026-10-19, decisions.md 141).
   */
  async orgOnly(): Promise<OrgState> {
    if (this.org && this.now() - Math.max(this.refreshedAt, this.orgCheckedAt) < this.maxAgeMs) return this.org.state;
    return this.exclusive(async () => {
      const checkedAt = this.now();
      await this.catchUpOrg((await this.source.heads?.(this.orgId)) ?? null);
      this.orgCheckedAt = checkedAt;
      return this.org!.state;
    });
  }

  /** Restore the organization's fold once, then fold what the log has past it, when the log moved (or its head is unknown). */
  private async catchUpOrg(heads: Record<string, number> | null): Promise<void> {
    if (!this.restored) {
      this.org = await this.restore<OrgState>('org');
      this.restored = true;
    }
    const orgMoved = !this.org || heads === null || (heads[ORG_STREAM] ?? 0) > this.org.cursor;
    if (!orgMoved) return;
    const next = await this.catchUp(ORG_STREAM, this.org, emptyOrgState, foldOrg);
    if (next !== this.org && next.cursor > 0) await this.cache.put('org', this.pack(next));
    this.org = next;
  }

  private async pass(): Promise<void> {
    const startedAt = this.now();
    const day = isoDay(startedAt);
    const heads = (await this.source.heads?.(this.orgId)) ?? null;
    await this.catchUpOrg(heads);
    const ids = orgLanguages(this.org!.state).map((l) => l.languageId);
    // Small languages run PARALLEL at a time; a large one (by the size its
    // last summary recorded) runs alone, since one parsed fold can fill the
    // isolate. A language with no recorded size (a cold object, or a summary
    // written before sizes were recorded) runs alone too: four large
    // languages folded at once do not fit.
    for (const id of ids) {
      if (this.summaries.has(id)) continue;
      const restored = await this.restoreSummary(id);
      if (restored) this.summaries.set(id, restored);
    }
    // What the projection pass stored (decisions.md 142). Before its table
    // exists, or when the read fails, every language is folded as before.
    const stored = this.source.reportHeads ? await this.source.reportHeads(this.orgId).catch(() => null) : null;
    const run = (id: string) => this.refreshLanguage(id, heads ? (heads[id] ?? 0) : undefined, day, startedAt, stored?.[id]);
    let batch: string[] = [];
    const flush = async () => {
      const now = batch;
      batch = [];
      await Promise.all(now.map(run));
    };
    for (const id of ids) {
      // Rendering stored inputs folds nothing, so it never needs to run alone.
      if (!stored?.[id] && this.isLarge(id)) {
        await flush();
        await run(id);
      } else {
        batch.push(id);
        if (batch.length >= PARALLEL) await flush();
      }
    }
    await flush();
    this.refreshedAt = startedAt;
  }

  private isLarge(id: string): boolean {
    const bytes = this.summaries.get(id)?.bytes ?? this.states.get(id)?.bytes;
    return bytes === undefined || bytes >= this.largeState;
  }

  /**
   * Bring one language's summary up to date. With inputs the projection pass
   * stored, render the report from them (decisions.md 142), reading them
   * again only when they moved, the day turned or the organization changed;
   * otherwise fold, only when the language moved, the day turned or the
   * organization changed.
   */
  private async refreshLanguage(id: string, head: number | undefined, day: string, at: number, stored?: StoredInputs): Promise<void> {
    const org = this.org!;
    const summary = this.summaries.get(id) ?? (await this.restoreSummary(id));
    if (summary) this.summaries.set(id, summary);
    if (stored && this.source.reportInputs) {
      const asOf = (s: StoredInputs) => (head !== undefined && s.seq >= head ? at : s.at);
      if (summary?.fromInputs && summary.day === day && summary.orgCursor === org.cursor && summary.cursor === stored.seq) {
        summary.asOf = asOf(stored);
        return;
      }
      const read = await this.source.reportInputs(this.orgId, id);
      if (read) {
        const info = languageInfo(org.state, id);
        const next: Summary = {
          cursor: read.seq, orgCursor: org.cursor, day, report: info ? renderLanguageReport(read.inputs, info, at) : null,
          fromInputs: true, asOf: asOf(read)
        };
        this.summaries.set(id, next);
        await this.cache.put(`summary:${id}`, JSON.stringify({ v: REDUCER_VERSION, rv: REPORT_VERSION, ...next }));
        return;
      }
    }
    let peeked: AnyEvent[] | undefined;
    if (summary && !summary.fromInputs && summary.day === day && summary.orgCursor === org.cursor) {
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
    const info = languageInfo(org.state, id);
    const next: Summary = { cursor: held.cursor, orgCursor: org.cursor, day, report: info ? languageReport(held.state, info, at) : null };
    if (held.cursor === 0) { // nothing in the log yet, nothing worth keeping
      this.summaries.set(id, next);
      this.keep(id, held);
      return;
    }
    // Like a phone's checkpoint: a fold read back later catches up from its own cursor, so it need not be written every pass.
    const last = this.saved.get(id);
    if (last === undefined || held.refolded || held.cursor - last >= STATE_SAVE_EVERY) {
      // The packed text is a temporary: nothing holds it once the write is done.
      await this.cache.put(`state:${id}`, this.pack(held));
      this.saved.set(id, held.cursor);
    }
    if (held.bytes !== undefined) next.bytes = held.bytes;
    this.summaries.set(id, next);
    await this.cache.put(`summary:${id}`, JSON.stringify({ v: REDUCER_VERSION, rv: REPORT_VERSION, ...next }));
    // A large fold that is in the cache at this cursor is let go rather than
    // held until the budget needs the room; an API read restores it.
    if (held.bytes !== undefined && held.bytes >= this.largeState && this.saved.get(id) === held.cursor) this.states.delete(id);
    else this.keep(id, held);
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
    const meta = await this.source.snapshotMeta(this.orgId, id, REDUCER_VERSION);
    if (!meta) return null;
    const snapshot = await fetchSnapshot(this.source, this.orgId, id, REDUCER_VERSION, { meta });
    return snapshot ? { state: snapshot.state, cursor: snapshot.serverSeq, bytes: meta.bytes } : null;
  }

  /**
   * Hold a fold in memory, dropping the least recently used until the held
   * folds fit the byte budget (the newest always stays). A fold of unknown
   * size is measured once.
   */
  private keep(id: string, held: Held<LanguageState>): void {
    held.bytes ??= JSON.stringify(held.state).length;
    this.states.delete(id);
    this.states.set(id, { state: held.state, cursor: held.cursor, bytes: held.bytes });
    let total = 0;
    for (const h of this.states.values()) total += h.bytes ?? 0;
    for (const [oldest, h] of this.states) {
      if (total <= this.stateBudget || this.states.size <= 1) break;
      this.states.delete(oldest);
      total -= h.bytes ?? 0;
    }
  }

  /** The text kept in the cache; its length becomes the fold's recorded size. */
  private pack<S>(held: Held<S>): string {
    const text = JSON.stringify({ v: REDUCER_VERSION, cursor: held.cursor, state: held.state });
    held.bytes = text.length;
    return text;
  }

  private async restore<S>(key: string): Promise<Held<S> | null> {
    const text = await this.cache.get(key);
    if (!text) return null;
    const saved = JSON.parse(text) as { v: number; cursor: number; state: S };
    return saved.v === REDUCER_VERSION ? { state: saved.state, cursor: saved.cursor, bytes: text.length } : null;
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
    // The size is the old fold's until it is packed or measured again.
    return { state, cursor: events.at(-1)?.serverSeq ?? known?.cursor ?? 0, bytes: redactsFolded ? undefined : known?.bytes, refolded: redactsFolded };
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
