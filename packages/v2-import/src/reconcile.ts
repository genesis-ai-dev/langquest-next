import { encodeHlc, decodeHlc, type AnyEvent, type EventPayloads, type EventType, type Hlc } from '@langquest-next/core';

/**
 * What v2 says now, against what the import has already said here
 * (docs/v2-import.md section 1).
 *
 * v2 keeps rows; this app keeps a log. A pass reads a v2 project as it is,
 * the mapper turns it into facts (one per thing v2 says: a member, a unit, a
 * take, a review), and this compares them with the ledger, the import's own
 * record of what it last said about each fact. Only the differences become
 * events: a new fact is said, a changed one is said again, a fact v2 no
 * longer says is taken back, and one that comes back is said once more.
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
  /** The events that say it. Must not depend on the statement except in ids it makes for itself. */
  say: (s: Statement) => Said[];
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
  /** v2 still has the row but marks it gone (`active = false`), and when. */
  gone?: boolean;
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
}

export interface Reconciled {
  events: AnyEvent[];
  /** The ledger entries to save once their events are accepted, by key. */
  entries: Map<string, LedgerEntry>;
  /** Which entry each event belongs to, so a refused event leaves its entry unsaved. */
  owner: Map<string, string>;
}

export interface ReconcileContext {
  orgId: string;
  /** The ledger this pass writes: the v2 project's id, or `org:<orgId>` for the organization's own facts. */
  scope: string;
  /** Now, in ms; no event is stamped later (the server refuses clocks ahead of its own). */
  now: number;
}

const REASON = 'removed in LangQuest v2';

export function reconcile(facts: readonly Fact[], ledger: ReadonlyMap<string, LedgerEntry>, ctx: ReconcileContext): Reconciled {
  const events: AnyEvent[] = [];
  const entries = new Map<string, LedgerEntry>();
  const owner = new Map<string, string>();
  const seen = new Set<string>();

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

    if (fact.gone) {
      if (!prior || prior.withdrawn) continue;
      entries.set(fact.key, takeBack(fact, base, at));
      continue;
    }
    const digest = digestOf(fact.say({ n: 0, lastSaid: null }));
    if (prior && !prior.withdrawn && (prior.digest === digest || (fact.restate === false && prior.digest !== ''))) continue;
    const s = { n: base.n + 1, lastSaid: base.lastSaid };
    const said = prior?.withdrawn && fact.resay ? fact.resay(s) : fact.say(s);
    const undo = fact.unsay === 'redact' ? undefined : fact.unsay({ n: s.n + 1, lastSaid: s.n });
    const { undo: _old, ...rest } = emit(base, s.n, said, fact.actorId, at, 'say');
    entries.set(fact.key, { ...rest, digest, ...(undo ? { undo } : {}) });
  }

  // Facts the import said that v2 no longer has at all: taken back now.
  for (const entry of ledger.values()) {
    if (seen.has(entry.key) || entry.withdrawn) continue;
    entries.set(entry.key, takeBack(null, entry, ctx.now));
  }
  return { events, entries, owner };

  function takeBack(fact: Fact | null, entry: LedgerEntry, at: number): LedgerEntry {
    const s = { n: entry.n + 1, lastSaid: entry.lastSaid };
    // A fact whose row is gone from v2 entirely is taken back by the rule the
    // ledger kept when it was last said.
    const rule = fact ? (fact.unsay === 'redact' ? 'redact' : fact.unsay(s)) : entry.undo ?? 'redact';
    const said: Said[] = rule === 'redact'
      ? entry.live.map((eventId) => ({ type: 'v1.Redacted', payload: { eventId, reason: REASON } }))
      : rule;
    return { ...emit(entry, s.n, said, fact?.actorId ?? DEVICE, at, 'unsay'), digest: '' };
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
