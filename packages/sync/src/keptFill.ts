import {
  eventPassage, hangsOn, keptVerdict, LINES_VERSION, markChanged, PART_OF_KIND, passageInMemory, putEntry,
  type AnyEvent, type LanguageState, type PassageLine, type PassageOf
} from '@langquest-next/core';
import { entryRows, FILE, type KeptLanguage } from './keptLanguage';
import type { KeptLines } from './keptLines';
import { NO_UNIT } from './serverCut';
import type { EventStore, KeptRecord, SnapshotHead, Transport, WriteBatch } from './types';

type Verdict = LanguageState['blobs'][string];

/** A passage whose rows are all on the phone: a row of its own, written with the passage's last row. */
export const FILLED = 'filled';
/** Rows asked for at once: about the size of a snapshot piece (decision 18) at Koro's 250 bytes a row. */
export const ROWS_PER_PAGE = 1_000;

/**
 * What a fill knows, kept beside the checkpoint (`fill:<org>/<stream>`) and
 * written with it: which passages the server has rows for, and how far
 * the lines it gave hold.
 */
export interface FillMeta {
  /** The snapshot the shared part came from: rows come from it or a later one, never an earlier. */
  base: number;
  /** The stream's seq the server's lines hold at: a pulled event past it on a passage not filled in fills that passage first. */
  linesSeq: number;
  /** The LINES_VERSION the server's lines are of. */
  linesVersion: number;
  /** Each passage the server has rows for, with how many, in the server's order. */
  todo: [string, number][];
  /** The newest snapshot any row came from: a redaction of an event at or before it waits for a snapshot past it. */
  rowsSeq: number;
  /**
   * What every line says changed after `linesSeq` (a flow, kind or team
   * event at this seq), or this build reads lines of another
   * LINES_VERSION (0): the lines of passages not filled in yet are asked for
   * again. Null when they stand.
   */
  stale: number | null;
}

/**
 * The fill (decisions.md 145): a phone downloads what the whole language
 * shares and every passage's line, opens the Map on them, and fills in the
 * passages' rows behind, until every passage's rows are on disk, which is
 * where a phone under decision 143 ends anyway.
 *
 * Every line a list shows stays exact while it runs. A line is the phone's
 * own reading of rows it holds, or the server's line for a passage no
 * pulled event touched past the seq those lines hold at: before a pulled
 * event past it is folded, its passage is filled in (`beforeFold`). The
 * phone's own unsent work on a passage not filled in yet waits for the
 * passage to be filled first; until then its line is the server's.
 *
 * Rows combine with what the phone already holds of a passage (the tail
 * folded since the shared part, its own checkpoints) by each part's
 * `merge`, as a checkpoint combines rows (decision 143). They may come from
 * any snapshot at or past the shared part's, since the phone pulls every
 * event after that one: an entry the rows lack is in the tail, and one the
 * tail holds again joins to itself.
 */
export class KeptFill {
  private meta: FillMeta | null = null;
  private total = 0;

  constructor(
    private readonly store: EventStore,
    private readonly transport: Transport,
    private readonly orgId: string,
    private readonly streamId: string,
    private readonly reducerVersion: number,
    private readonly kept: KeptLanguage,
    private readonly lines: KeptLines,
    /** Writes go through the sync client's single writer. */
    private readonly commit: (batch: WriteBatch) => Promise<void>,
    private readonly live: () => LanguageState,
    /** Rows asked for at once; small in tests, so a fill has many points to be cut at. */
    private readonly pageRows = ROWS_PER_PAGE
  ) {}

  /** Can this phone fill a language from the server's cut at all? */
  get possible(): boolean {
    return !!this.transport.snapshotHead && !!this.transport.snapshotRows;
  }

  key(): string {
    return `fill:${this.orgId}/${this.streamId}`;
  }

  /** Read what is filled and what is still to fill, with the checkpoint. */
  async open(): Promise<void> {
    let meta: FillMeta | null = null;
    try { meta = JSON.parse((await this.store.meta(this.key())) || 'null') as FillMeta | null; } catch { meta = null; }
    this.meta = meta;
    if (!meta) {
      this.kept.setUnfilled([]);
      this.total = 0;
      return;
    }
    const filled = new Set((await this.store.keptAll(this.orgId, this.streamId, FILLED)).map((r) => r.id));
    this.kept.setUnfilled(meta.todo.map(([u]) => u).filter((u) => !filled.has(u)));
    this.total = meta.todo.filter(([u]) => u !== NO_UNIT).length;
    // Lines of another build's LINES_VERSION: asked for again while passages wait for their rows.
    if (meta.linesVersion !== LINES_VERSION && this.kept.unfilledCount() > 0) meta.stale ??= 0;
  }

  /** Is anything left to fill in? */
  active(): boolean {
    return this.kept.unfilledCount() > 0;
  }

  /** Passages filled of those with rows, for the banner; null when the fill is done or there is none. */
  progress(): { filled: number; total: number } | null {
    if (!this.active() || this.total === 0) return null;
    const left = this.kept.unfilledCount() - (this.kept.isFilled(NO_UNIT) ? 0 : 1);
    return { filled: this.total - left, total: this.total };
  }

  /** The newest snapshot any row came from (0 with no fill). */
  get rowsSeq(): number {
    return this.meta?.rowsSeq ?? 0;
  }

  /** The seq the server's lines hold at; past it, an event on a passage not filled in fills that passage first. */
  get linesSeq(): number {
    return this.meta?.linesSeq ?? 0;
  }

  /**
   * The meta a first download writes beside its checkpoint, taken from the
   * server's head; the in-memory state follows it once `open` reads it back.
   */
  begin(head: SnapshotHead & { lines: { seq: number; lines: unknown[] } }): Record<string, string> {
    const meta: FillMeta = {
      base: head.serverSeq, linesSeq: head.lines.seq, linesVersion: LINES_VERSION,
      todo: head.units.map((u) => [u.unitId, u.rows]), rowsSeq: 0, stale: null
    };
    return { [this.key()]: JSON.stringify(meta) };
  }

  /** Forget the fill: the checkpoint it belongs to is gone. Written by the caller in the same commit. */
  clear(): Record<string, string> {
    this.meta = null;
    this.kept.setUnfilled([]);
    this.total = 0;
    return { [this.key()]: '' };
  }

  /**
   * Before a pulled page is folded: fill in every passage an event past
   * the server's lines touches, so no list shows a server line for a
   * passage the phone has news of. Throws when the server cannot be
   * reached; the page is then not folded, and the pull tries again.
   */
  async beforeFold(page: readonly AnyEvent[]): Promise<void> {
    const meta = this.meta;
    if (!meta || !this.active()) return;
    const live = this.live();
    const fresh = page.filter((e) => (e.serverSeq ?? 0) > meta.linesSeq);
    if (fresh.length === 0) return;
    // What the page itself says about where things are, for what hangs on something composed in it.
    const inPage = new Map<string, string>();
    const reviewTake = new Map<string, string>();
    for (const e of page) {
      if (e.type === 'v1.TakeComposed') inPage.set(`take\u0000${e.payload.takeId}`, e.payload.unitId);
      else if (e.type === 'v1.DepartureRecorded') inPage.set(`departure\u0000${e.payload.departureId}`, e.payload.unitId);
      else if (e.type === 'v1.RequestMade') inPage.set(`request\u0000${e.payload.requestId}`, e.payload.unitId);
      else if (e.type === 'v1.NoteAdded') inPage.set(`note\u0000${e.payload.noteId}`, e.payload.unitId);
      else if (e.type === 'v1.ReviewRecorded') reviewTake.set(e.payload.reviewId, e.payload.takeId);
    }
    const units = new Set<string>();
    const look: { kind: string; id: string }[] = [];
    let stale = meta.stale;
    for (const e of fresh) {
      let of: PassageOf | 'settings' | null = eventPassage(e);
      if (of === 'settings') { stale = Math.max(stale ?? 0, e.serverSeq ?? 0); continue; }
      if (!of) continue;
      if ('review' in of && reviewTake.has(of.review)) of = { take: reviewTake.get(of.review)! };
      const here = passageInMemory(live, of);
      const on = hangsOn(of);
      const unitId = here ?? (on ? inPage.get(`${on.kind}\u0000${on.id}`) : undefined);
      if (unitId) units.add(unitId);
      else if (on) look.push(on);
    }
    if (stale !== meta.stale) await this.saveMeta({ ...meta, stale });
    for (const u of await this.locate(look)) units.add(u);
    const need = [...units].filter((u) => !this.kept.isFilled(u));
    if (need.length > 0) await this.fill(need, Infinity);
  }

  /** The passages these takes, reviews, departures, requests and notes are in: from the rows kept, else from the server. */
  private async locate(items: { kind: string; id: string }[]): Promise<string[]> {
    if (items.length === 0) return [];
    const out = new Set<string>();
    const missing: { kind: string; id: string }[] = [];
    for (const [kind, ids] of groupBy(items)) {
      const found = new Map((await this.store.keptById(this.orgId, this.streamId, kind, ids)).map((r) => [r.id, r.unitId]));
      for (const id of ids) {
        const u = found.get(id);
        if (u) out.add(u); else missing.push({ kind, id });
      }
    }
    // Not on this phone yet: the server's newest snapshot says. What it does not know either was made since, and arrives in the tail.
    if (missing.length > 0 && this.transport.snapshotPassages) {
      for (const r of await this.transport.snapshotPassages(this.orgId, this.streamId, this.reducerVersion, missing)) out.add(r.unitId);
    }
    return [...out];
  }

  /**
   * Fill in for up to `budgetMs`: first what a screen or this phone's own
   * work asked for, then `first` (the person's offline scope, decision 61),
   * then the rest in the server's order. Lines of passages not filled in are
   * asked for again first when what every line says has changed. Returns
   * the passages filled.
   */
  async step(budgetMs: number, first: () => Iterable<string> = () => [], now: () => number = Date.now): Promise<string[]> {
    const meta = this.meta;
    if (!meta || !this.active()) return [];
    if (meta.stale !== null) await this.refreshLines(meta);
    const started = now();
    const done: string[] = [];
    // At least one batch, then more while the time lasts.
    do {
      const batch = this.next(first);
      if (batch.length === 0) break;
      const filled = await this.fill(batch, budgetMs - (now() - started), now);
      if (filled.length === 0) break;
      done.push(...filled);
    } while (this.active() && now() - started < budgetMs);
    return done;
  }

  /** Fill in every passage asked for now (a screen opened one, this phone's own work touched one). */
  async fillWanted(): Promise<string[]> {
    const wanted = this.kept.wantedUnits();
    return wanted.length > 0 ? this.fill(wanted, Infinity) : [];
  }

  /** The next passages to fill: about a page of rows, the most wanted first. */
  private next(first: () => Iterable<string>): string[] {
    const counts = new Map(this.meta!.todo);
    const out: string[] = [];
    let rows = 0;
    const seen = new Set<string>();
    const take = (u: string) => {
      if (seen.has(u) || !counts.has(u) || this.kept.isFilled(u)) return true;
      seen.add(u);
      out.push(u);
      rows += counts.get(u) ?? 0;
      return rows < this.pageRows;
    };
    for (const u of this.kept.wantedUnits()) if (!take(u)) return out;
    for (const u of first()) if (!take(u)) return out;
    for (const [u] of this.meta!.todo) if (!take(u)) return out;
    return out;
  }

  /**
   * Fetch these passages' rows a page at a time and keep them, combined with
   * what the phone holds of them, until done or out of time. A passage is
   * filled once its last row is written, in the same commit.
   */
  private async fill(units: readonly string[], budgetMs: number, now: () => number = Date.now): Promise<string[]> {
    const meta = this.meta!;
    const asked = [...units].sort();
    const done: string[] = [];
    const started = now();
    let after: { unitId: string; kind: string; id: string } | null = null;
    const pending = new Set(asked);
    do {
      const page = await this.transport.snapshotRows!(this.orgId, this.streamId, this.reducerVersion, meta.base, asked, after, this.pageRows);
      // No snapshot at or past the shared part's with a cut: nothing to fill from now; the next sync asks again.
      if (!page) return done;
      // Passages before the next page's first are complete.
      const complete = page.next ? [...pending].filter((u) => u < page.next!.unitId) : [...pending];
      await this.keep(page.rows, complete, Math.max(meta.rowsSeq, page.serverSeq));
      for (const u of complete) pending.delete(u);
      done.push(...complete);
      after = page.next;
    } while (after && now() - started < budgetMs);
    return done;
  }

  /**
   * Keep a page of rows: each combined with the row already kept for it,
   * and with memory when its passage is held whole there; then mark these
   * passages filled, all in one commit, so a fill cut short keeps what came
   * and never marks a passage it has not finished.
   */
  private async keep(rows: readonly KeptRecord[], complete: readonly string[], rowsSeq: number): Promise<void> {
    const live = this.live();
    const priors = new Map<string, string>();
    for (const [kind, ids] of groupBy(rows.map((r) => ({ kind: r.kind, id: r.id })))) {
      for (const r of await this.store.keptById(this.orgId, this.streamId, kind, ids)) priors.set(`${kind}\u0000${r.id}`, r.json);
    }
    const out: KeptRecord[] = [];
    const placed: { part: NonNullable<ReturnType<typeof PART_OF_KIND.get>>; id: string; unitId: string }[] = [];
    let memory = false;
    for (const row of rows) {
      const value = JSON.parse(row.json) as unknown;
      const prior = priors.get(`${row.kind}\u0000${row.id}`);
      if (row.kind === FILE) {
        const v = value as Verdict;
        out.push({ kind: FILE, id: row.id, unitId: '', ref: '', json: JSON.stringify(prior ? keptVerdict(JSON.parse(prior) as Verdict, v) : v) });
        // A file memory names: its verdict there too.
        const here = live.blobs[row.id];
        if (here) { live.blobs[row.id] = keptVerdict(here, v); memory = true; }
        continue;
      }
      const part = PART_OF_KIND.get(row.kind);
      if (!part) continue;
      out.push(...entryRows(part, row.id, row.unitId, prior === undefined ? value : part.merge(JSON.parse(prior), value)));
      placed.push({ part, id: row.id, unitId: row.unitId });
      // A passage held whole in memory takes the row there too, so memory still holds all the disk does.
      if (this.kept.isHeld(row.unitId)) { putEntry(live, part, row.id, value); memory = true; }
    }
    for (const u of complete) out.push({ kind: FILLED, id: u, unitId: u, ref: '', json: '1' });
    const meta = { ...this.meta!, rowsSeq };
    await this.commit({ kept: { orgId: this.orgId, streamId: this.streamId, upsert: out }, meta: { [this.key()]: JSON.stringify(meta) } });
    this.meta = meta;
    this.kept.stored(placed);
    this.kept.changed();
    if (memory) markChanged(live);
    this.kept.filled(complete);
    this.lines.filledIn(complete.filter((u) => u !== NO_UNIT));
  }

  /**
   * The server's lines again, for passages not filled in yet, after what
   * every line says changed past the lines this phone has (a flow or team
   * change, a new LINES_VERSION). Taken only when they hold at or past the
   * phone's and no further than it has pulled; otherwise asked again next
   * time, and until then the old lines stand (the transient decision 145
   * names) or the fill reaches them.
   */
  private async refreshLines(meta: FillMeta): Promise<void> {
    const head = await this.transport.snapshotHead!(this.orgId, this.streamId, this.reducerVersion, LINES_VERSION, false);
    const lines = head?.lines;
    const cursor = await this.store.cursor(this.orgId, this.streamId);
    if (!lines || lines.seq < meta.linesSeq || lines.seq > cursor) return;
    const rows = this.lines.replaceUnfilled(lines.lines as PassageLine[]);
    const next: FillMeta = { ...meta, linesSeq: lines.seq, linesVersion: LINES_VERSION, stale: meta.stale !== null && meta.stale > lines.seq ? meta.stale : null };
    await this.commit({ meta: { [this.key()]: JSON.stringify(next) }, ...(rows.length ? { kept: { orgId: this.orgId, streamId: this.streamId, upsert: rows } } : {}) });
    this.meta = next;
  }

  private async saveMeta(meta: FillMeta): Promise<void> {
    await this.commit({ meta: { [this.key()]: JSON.stringify(meta) } });
    this.meta = meta;
  }
}

/** `{kind, id}` pairs as kind -> distinct ids. */
function groupBy(items: readonly { kind: string; id: string }[]): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  for (const { kind, id } of items) {
    const ids = out.get(kind);
    if (ids) ids.add(id); else out.set(kind, new Set([id]));
  }
  return new Map([...out].map(([k, ids]) => [k, [...ids]]));
}
