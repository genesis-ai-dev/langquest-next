import { buildIndexes, referencedBlobs, type LanguageState } from '@langquest-next/core';
import { AUDIO, FILE, NO_UNIT, SyncClient, type EventStore, type SqlDriver, type Transport } from '@langquest-next/sync';
import type { SqlStore } from './sqlCache';

/**
 * A language as the organization's Durable Object reads it for the
 * access-token API, MCP, review links and webhooks (decisions.md 147):
 * what the whole language shares, held in memory, and any passages'
 * records read from the object's SQLite on demand. The object never holds
 * a whole language, so a Bible-size one answers inside the isolate's
 * 128 MB (decision 132), and nothing here reimplements sync: each language
 * is sync's own `SyncClient`, keeping the language on disk as a phone does
 * (decision 143) and taking its first download from the server's cut,
 * filling passages in behind (decision 147).
 */
export interface LanguageRecords {
  /** What the whole language shares: its passages and their order, flow, kinds, teams, external values. Read-only. */
  shared: LanguageState;
  /** The passages in display order. */
  passages: readonly string[];
  /**
   * The language with these passages' records whole, read from disk (their
   * rows filled in from the server first when a first download has not
   * reached them). A separate copy: the caller may keep it for one answer.
   */
  view(unitIds: readonly string[]): Promise<LanguageState>;
  /**
   * Of these audio files, which any record of the language names, and when
   * the server stored each it holds: what tells a fresh voice note from
   * audio already in the language. Reads the whole language's file rows, so
   * a first download is filled in first.
   */
  files(hashes: readonly string[]): Promise<{ named: ReadonlySet<string>; stored: ReadonlyMap<string, string> }>;
}

/** A language held whole, read as records: tests, and a language small enough to fold. */
export function wholeRecords(state: LanguageState): LanguageRecords {
  return {
    shared: state, passages: buildIndexes(state).passages, view: async () => state,
    files: async (hashes) => filesIn(state, hashes)
  };
}

/** Which of these files a state's records name, and when the server stored those it has. */
function filesIn(state: LanguageState, hashes: readonly string[]): { named: Set<string>; stored: Map<string, string> } {
  const known = referencedBlobs(state);
  const named = new Set(hashes.filter((h) => known.has(h)));
  const stored = new Map<string, string>();
  for (const h of hashes) { const v = state.blobs[h]; if (v) stored.set(h, v.hlc); }
  return { named, stored };
}

/** Passages read at once by a reader going through a whole language: a bounded slice in memory. */
export const PASSAGES_PER_READ = 25;

/** Every passage of a language, a slice at a time, each slice's records whole. */
export async function* inSlices(records: LanguageRecords, unitIds: readonly string[] = records.passages, size = PASSAGES_PER_READ): AsyncGenerator<{ unitIds: readonly string[]; state: LanguageState }> {
  for (let i = 0; i < unitIds.length; i += size) {
    const slice = unitIds.slice(i, i + size);
    yield { unitIds: slice, state: await records.view(slice) };
  }
}

/** What the object reads from the server with the service role: the log, the snapshot's pieces and its cut. */
export type RecordsSource = Pick<Transport, 'append' | 'pull' | 'snapshotMeta' | 'snapshotChunk' | 'snapshotHead' | 'snapshotRows' | 'snapshotPassages'>;

/** How many languages keep a client (its shared part, lines and a few passages) in memory at once. */
export const LANGUAGES_OPEN = 4;
/** Wall time each background slice of a first download's fill may take before letting answers through. */
const FILL_SLICE_MS = 1_000;

/**
 * Each language's kept client, the few most recently read held open. A
 * client let go keeps everything in the store; opening it again reads its
 * checkpoint and lines back, as a phone does when it starts.
 */
export class LanguageRecordsKeeper {
  private readonly open = new Map<string, Promise<SyncClient>>();
  private readonly filling = new Set<string>();
  private opened: Promise<EventStore> | null = null;

  constructor(
    private readonly source: RecordsSource,
    private readonly orgId: string,
    /** The store every language of the organization keeps in: the object's SQLite (`objectSqlDriver`), opened once. */
    private readonly openStore: () => Promise<EventStore>,
    private readonly opts: { languagesOpen?: number; checkpointEvery?: number; fillPageRows?: number; fillInBackground?: boolean } = {}
  ) {}

  private store(): Promise<EventStore> {
    this.opened ??= this.openStore();
    this.opened.catch(() => { this.opened = null; });
    return this.opened;
  }

  /** Languages with a client in memory now, least recently read first (tests and diagnostics). */
  openLanguages(): string[] {
    return [...this.open.keys()];
  }

  /**
   * A language caught up to the log's head now (`head`, when the caller
   * knows it, saves the pull of a language that has not moved).
   */
  async records(languageId: string, head?: number): Promise<LanguageRecords> {
    const store = await this.store();
    const client = await this.clientFor(languageId, store);
    if (head === undefined || head > (await store.cursor(this.orgId, languageId))) await client.pull();
    // A first download still filling in: go on with it between answers.
    if (this.opts.fillInBackground !== false) this.fillBehind(languageId, client);
    const shared = client.getState();
    /** Fill these in; when the cut a fill read from went away (a server rolled back), the language started over: catch it up and fill again. */
    const filled = async (unitIds: readonly string[]) => {
      const before = client.restarts;
      await client.fillUnits(unitIds);
      if (client.restarts !== before) {
        await client.pull();
        await client.fillUnits(unitIds);
      }
    };
    return {
      shared,
      passages: buildIndexes(shared).passages,
      view: async (unitIds) => {
        await filled(unitIds);
        return client.withPassages(unitIds);
      },
      files: async (hashes) => {
        // Every passage's rows, and the verdicts on files no passage names, before anything can be said to be new.
        await filled([...buildIndexes(client.getState()).passages, NO_UNIT]);
        // What memory holds (the tail since the last checkpoint), then which record names each file on disk, and its verdict.
        const { named, stored } = filesIn(client.getState(), hashes);
        for (const r of await store.keptById(this.orgId, languageId, AUDIO, hashes)) named.add(r.id);
        for (const r of await store.keptById(this.orgId, languageId, FILE, hashes)) {
          if (!stored.has(r.id)) stored.set(r.id, (JSON.parse(r.json) as LanguageState['blobs'][string]).hlc);
        }
        return { named, stored };
      }
    };
  }

  private clientFor(languageId: string, store: EventStore): Promise<SyncClient> {
    const known = this.open.get(languageId);
    if (known) {
      // Most recently read last.
      this.open.delete(languageId);
      this.open.set(languageId, known);
      return known;
    }
    const opening = (async () => {
      const client = new SyncClient({
        orgId: this.orgId, streamId: languageId, actorId: 'langquest-org-object', deviceId: `org-object:${this.orgId}`,
        store, transport: this.source, keepOnDisk: true,
        ...(this.opts.checkpointEvery !== undefined ? { checkpointEvery: this.opts.checkpointEvery } : {}),
        ...(this.opts.fillPageRows !== undefined ? { fillPageRows: this.opts.fillPageRows } : {})
      });
      await client.load();
      return client;
    })();
    this.open.set(languageId, opening);
    opening.catch(() => this.open.delete(languageId));
    const limit = this.opts.languagesOpen ?? LANGUAGES_OPEN;
    for (const id of this.open.keys()) {
      if (this.open.size <= limit) break;
      if (id !== languageId) this.open.delete(id);
    }
    return opening;
  }

  /** Fill a language's passages in, a slice at a time, until every one is here; one runner per language. */
  private fillBehind(languageId: string, client: SyncClient): void {
    if (this.filling.has(languageId) || client.fillProgress() === null) return;
    this.filling.add(languageId);
    void (async () => {
      try {
        for (let r = await client.fillSome(FILL_SLICE_MS); r.filling && !r.offline; r = await client.fillSome(FILL_SLICE_MS)) { /* next slice */ }
      } catch { /* the next read tries again */ } finally {
        this.filling.delete(languageId);
      }
    })();
  }
}

/**
 * Sync's SQLite driver over a Durable Object's own SQLite (`ctx.storage.sql`).
 * Statements run at once; a transaction's statements are gathered and run
 * together inside `transactionSync`, which is how such an object commits
 * atomically. A store's commit only writes inside its transaction, so
 * nothing it reads waits on a statement gathered there. Pragmas a phone
 * sets for durability are the object's to manage, and are skipped.
 */
export function objectSqlDriver(db: SqlStore): SqlDriver {
  const pragma = (sql: string) => /^\s*pragma\b/i.test(sql);
  const exec = (sql: string, params: unknown[] = []) => db.exec(sql, ...params).toArray();
  const all = async <T,>(sql: string, params: unknown[] = []): Promise<T[]> => {
    if (pragma(sql)) return [];
    try {
      return exec(sql, params) as T[];
    } catch (err) {
      // A table-valued pragma (the store's check for an old schema) where the object refuses them: there is no old schema here.
      if (/pragma_/i.test(sql)) return [];
      throw err;
    }
  };
  return {
    run: async (sql, params = []) => { if (!pragma(sql)) exec(sql, params); },
    all,
    transaction: async (fn) => {
      const gathered: [string, unknown[]][] = [];
      await fn({ run: async (sql, params = []) => { if (!pragma(sql)) gathered.push([sql, params]); }, all });
      db.transactionSync(() => { for (const [sql, params] of gathered) exec(sql, params); });
    }
  };
}
