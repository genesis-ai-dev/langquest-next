import { encodeHlc, decodeHlc, type AnyEvent, type EventPayloads, type EventType, type Hlc } from '@langquest-next/core';

/**
 * What v2 says now, against what the import has already said here
 * (docs/v2-import.md section 1).
 *
 * v2 keeps rows; this app keeps a log. A pass reads a v2 project as it is,
 * the mapper turns it into facts (one per thing v2 says: a member, a unit, a
 * take, a review), and this compares them with the ledger, the import's own
 * record of what it last said about each fact. Only the differences become
 * events: a new fact is said and a changed one is said again. What v2
 * removes is never taken back here: the log keeps everything, and nothing
 * said here disappears because v2 deleted or turned off a row (Caleb,
 * 2026-10-14). A fact is taken back only when someone here decides so (the
 * dashboard's Leave out, a link that moves a person to their Next account),
 * and the organization's own facts, which are the dashboard's decisions, are
 * taken back when the dashboard drops them.
 * Nothing here reads v2's timestamps to decide what changed, because v2's
 * `last_updated` comes from phones and some rows are deleted outright.
 *
 * Pure and deterministic: the same facts and ledger give the same events
 * with the same ids, so a pass that dies after appending and before saving
 * the ledger is finished by the next one as duplicates.
 */

export const DEVICE = 'v2import';

/** One event a fact is said with. The actor defaults to the fact's. */
export interface Said<T extends EventType = EventType> {
  type: T;
  payload: EventPayloads[T];
  actorId?: string;
}

/** Context a fact's events are built with. */
export interface Statement {
  /** 1 for the first statement of this fact, then 2, 3… across says, takes-back and says-again. */
  n: number;
  /** The number of the last statement that said it (not one that took it back), or null the first time. */
  lastSaid: number | null;
}

export interface Fact {
  /** What the fact is about, stable from pass to pass: `member:<person>`, `take:<quest>`. */
  key: string;
  /** `_org` or the language's id. */
  streamId: string;
  actorId: string;
  /** When it happened in v2 (ISO 8601). */
  at: string;
  /**
   * The events that say it. They may depend on the statement only for ids
   * the fact makes for itself, and on other facts (through `look`) only when
   * `value` says what the fact is.
   */
  say: (s: Statement, look: Look) => Said[];
  /**
   * What the fact says, when its events also carry something that is not
   * the fact's own (a review names the take that was current when it was
   * given). A change here is said again; a change in the rest is not.
   */
  value?: unknown;
  /** v2 says something that is not ready to come over yet (its audio has not arrived): leave what was said as it is. */
  hold?: boolean;
  /**
   * How it is taken back when v2 stops saying it: redact everything it said
   * (recordings, takes, reviews, notes), or say something else (a member
   * removed, a unit hidden).
   */
  unsay: 'redact' | ((s: Statement) => Said[]);
  /** How it comes back after being taken back; by default it is said again. */
  resay?: (s: Statement) => Said[];
  /** False when a change is not worth saying again (a unit's label: `UnitAdded` keeps the first). */
  restate?: boolean;
  /** v2 still has the row but marks it gone (`active = false`): left here as it is, and not brought over if it never was. */
  gone?: boolean;
  /** Taken back because someone here decided so, never because of v2: the dashboard's Leave out, or a link that moved a person. */
  withdraw?: boolean;
  /**
   * When v2's server got what statement `n` says, by its own clock, keyed as
   * the access-token API asks (`review:<reviewId>`, `file:<hash>`,
   * `segment:<hash>`; decisions.md 188); null where v2 has no stamp. Kept
   * beside the log, never said in it, so a change is kept again without a
   * new statement.
   */
  stamps?: (n: number) => Record<string, string | null>;
}

/** What the import last said about one fact. */
export interface LedgerEntry {
  key: string;
  streamId: string;
  /** Statements made so far. */
  n: number;
  /** The last statement that said it, or null. */
  lastSaid: number | null;
  /** Digest of what it last said; '' to say it again next pass. */
  digest: string;
  /** Clock of its last event: the next one is always later. */
  hlc: Hlc;
  /** Events a redaction would have to take back: every event it said and has not taken back. */
  live: string[];
  /**
   * How to take it back if its v2 row disappears outright, when that is not
   * a redaction: kept from the fact's own rule when it was last said, since a
   * deleted row leaves nothing to ask.
   */
  undo?: Said[];
  withdrawn: boolean;
  /** Digest of the stamps last kept for it (`Fact.stamps`): different ones are kept again. */
  stamped?: string;
}

/** What the import has said about another fact, as of this point in the pass. */
export type Look = (key: string) => LedgerEntry | undefined;

export interface Reconciled {
  events: AnyEvent[];
  /** The ledger entries to save once their events are accepted, by key. */
  entries: Map<string, LedgerEntry>;
  /** Which entry each event belongs to, so a refused event leaves its entry unsaved. */
  owner: Map<string, string>;
  /** v2's stamps to keep, before the events they are about are appended (`Fact.stamps`). */
  stamps: Stamp[];
}

/** One time v2's server stamped on something the import brought over, in one language. */
export interface Stamp {
  streamId: string;
  key: string;
  at: string;
}

export interface ReconcileContext {
  orgId: string;
  /** The ledger this pass writes: the v2 project's id, or `org:<orgId>` for the organization's own facts. */
  scope: string;
  /** Now, in ms; no event is stamped later (the server refuses clocks ahead of its own). */
  now: number;
  /**
   * Who signs the taking back of a fact that is no longer stated (there is
   * no fact to say who): a member who may, such as an admin. Without one the
   * import's own device id signs, which the server only accepts where no
   * membership is needed.
   */
  actor?: string;
  /**
   * Take back what the import said that this pass no longer states at all:
   * only for the organization's own facts, which are the dashboard's
   * decisions, or for the keys it names (a project's guide, chosen here by
   * the language its team reads). A project's facts come from v2, and v2's
   * removals are kept.
   */
  takeBackAbsent?: boolean | ((key: string) => boolean);
}

const REASON = 'removed in LangQuest v2';

export function reconcile(facts: readonly Fact[], ledger: ReadonlyMap<string, LedgerEntry>, ctx: ReconcileContext): Reconciled {
  const events: AnyEvent[] = [];
  const entries = new Map<string, LedgerEntry>();
  const owner = new Map<string, string>();
  /** One stamp per key, the earliest: facts that use the same file name its stamps alike, and one upsert may not touch a row twice. */
  const stamps = new Map<string, Stamp>();
  const seen = new Set<string>();
  const look: Look = (key) => entries.get(key) ?? ledger.get(key);

  /** The entry with the fact's stamps for statement `n` kept, when they are not the ones it kept last. */
  const stamped = (fact: Fact, entry: LedgerEntry, n: number): LedgerEntry | null => {
    if (!fact.stamps) return null;
    const now = fact.stamps(n);
    const digest = hash53(canonical(now));
    if (entry.stamped === digest) return null;
    for (const [key, at] of Object.entries(now)) {
      if (!at) continue;
      const had = stamps.get(`${entry.streamId}\n${key}`);
      if (!had || Date.parse(at) < Date.parse(had.at)) stamps.set(`${entry.streamId}\n${key}`, { streamId: entry.streamId, key, at });
    }
    return { ...entry, stamped: digest };
  };

  const emit = (entry: LedgerEntry, n: number, said: Said[], actorId: string, at: number, verb: 'say' | 'unsay'): LedgerEntry => {
    const wall = Math.max(Math.min(at, ctx.now), entry.hlc ? decodeHlc(entry.hlc).wallMs + 1 : 0);
    const ids: string[] = [];
    said.forEach((s, i) => {
      const id = `v2:${ctx.scope}:${entry.key}#${n}:${s.type.slice(s.type.indexOf('.') + 1)}${said.filter((x) => x.type === s.type).length > 1 ? `.${i}` : ''}`;
      ids.push(id);
      owner.set(id, entry.key);
      events.push({
        id, type: s.type, orgId: ctx.orgId, streamId: entry.streamId, actorId: s.actorId ?? actorId,
        deviceId: DEVICE, hlc: encodeHlc(wall, i, DEVICE), payload: s.payload
      } as AnyEvent);
    });
    const hlc = said.length > 0 ? encodeHlc(wall, said.length - 1, DEVICE) : entry.hlc;
    return verb === 'say'
      ? { ...entry, n, lastSaid: n, hlc, live: [...entry.live, ...ids], withdrawn: false }
      : { ...entry, n, hlc, live: [], withdrawn: true };
  };

  for (const fact of facts) {
    if (seen.has(fact.key)) throw new Error(`fact ${fact.key} said twice in one pass`);
    seen.add(fact.key);
    const at = Date.parse(fact.at);
    if (Number.isNaN(at)) throw new Error(`fact ${fact.key} has no usable time: ${fact.at}`);
    const prior = ledger.get(fact.key);
    const base: LedgerEntry = prior ?? { key: fact.key, streamId: fact.streamId, n: 0, lastSaid: null, digest: '', hlc: '', live: [], withdrawn: false };

    // Not ready yet, or turned off in v2: what was said stays as it is.
    if (fact.hold || fact.gone) continue;
    if (fact.withdraw) {
      if (prior && !prior.withdrawn) entries.set(fact.key, takeBack(fact, base, at));
      continue;
    }
    const digest = fact.value !== undefined ? hash53(canonical(fact.value)) : digestOf(fact.say({ n: 0, lastSaid: null }, look));
    if (prior && !prior.withdrawn && (prior.digest === digest || (fact.restate === false && prior.digest !== ''))) {
      // Said already, but v2 may have stamped it since (audio that reached v2 later), or it was said before stamps were kept.
      const restamped = prior.lastSaid !== null ? stamped(fact, prior, prior.lastSaid) : null;
      if (restamped) entries.set(fact.key, restamped);
      continue;
    }
    const s = { n: base.n + 1, lastSaid: base.lastSaid };
    const said = prior?.withdrawn && fact.resay ? fact.resay(s) : fact.say(s, look);
    // Nothing to say yet (a review of a version that has not come over): as if held.
    if (said.length === 0) continue;
    const undo = fact.unsay === 'redact' ? undefined : fact.unsay({ n: s.n + 1, lastSaid: s.n });
    const { undo: _old, ...rest } = emit(base, s.n, said, fact.actorId, at, 'say');
    const entry = { ...rest, digest, ...(undo ? { undo } : {}) };
    entries.set(fact.key, stamped(fact, entry, s.n) ?? entry);
  }

  // Facts the import said that are no longer stated at all: kept, unless they are the dashboard's to drop.
  if (!ctx.takeBackAbsent) return { events, entries, owner, stamps: [...stamps.values()] };
  const drops = typeof ctx.takeBackAbsent === 'function' ? ctx.takeBackAbsent : () => true;
  for (const entry of ledger.values()) {
    if (seen.has(entry.key) || entry.withdrawn || !drops(entry.key)) continue;
    entries.set(entry.key, takeBack(null, entry, ctx.now));
  }
  return { events, entries, owner, stamps: [...stamps.values()] };

  function takeBack(fact: Fact | null, entry: LedgerEntry, at: number): LedgerEntry {
    const s = { n: entry.n + 1, lastSaid: entry.lastSaid };
    // A fact whose row is gone from v2 entirely is taken back by the rule the
    // ledger kept when it was last said.
    const rule = fact ? (fact.unsay === 'redact' ? 'redact' : fact.unsay(s)) : entry.undo ?? 'redact';
    const said: Said[] = rule === 'redact'
      ? entry.live.map((eventId) => ({ type: 'v1.Redacted', payload: { eventId, reason: REASON } }))
      : rule;
    return { ...emit(entry, s.n, said, fact?.actorId ?? ctx.actor ?? DEVICE, at, 'unsay'), digest: '' };
  }
}

/** A stable digest of what a fact says: its events' types and payloads, keys sorted. */
export function digestOf(said: readonly Said[]): string {
  return hash53(canonical(said.map((s) => [s.type, s.actorId ?? null, s.payload])));
}

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

/** cyrb53: a 53-bit string hash, plenty to tell one fact's statements apart. */
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
