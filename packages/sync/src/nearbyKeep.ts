import { parseHoldings, parseRevocationList, type HoldingEntry, type Holdings, type RevocationList } from '@langquest-next/core/nearby';

/**
 * What a session keeps between phones, in device meta and never in the log
 * (docs/nearby-sync-plan.md 5.12, The store): one row each, written at the moments the
 * contract gives, never per file. A row that cannot be read reads as nothing, because
 * every one of these only saves a re-send.
 */

export interface SignedRevocation {
  text: string;
  kid: string;
  sig: string;
}

/** One line of `nearbyPeers`: no time, device or person. */
export interface NearbyPeerRecord {
  tag: string;
  gen: number;
  mine: string;
  theirs: string;
  /**
   * The fingerprint of the files this phone held when the two finished (`filesFingerprint`,
   * 2026-11-25): a different one now makes the pair worth another session. Absent from a record
   * written before it, which then counts as unchanged.
   */
  files?: string;
}

/**
 * One line of `nearbyMet:<org>` (docs/nearby-sync-plan.md 15.8, decision 230 as amended): the day
 * this phone last met a teammate's phone on Share nearby, so that sharing while LangQuest is open
 * takes them for a while after, though their certificate is older than its window. Only the day,
 * counted from the epoch by Hello's clock, and none older than that window.
 */
export interface NearbyMetRecord {
  key: string;
  profileId: string;
  day: number;
}

const DAY_MS = 86_400_000;

/** The day `ms` falls in, as `nearbyMet` counts it. */
export function nearbyDayOf(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

/** The first day that began no longer than `withinMs` before `nowMs`: a day met counts from its start, never longer. */
export function nearbyFirstDayWithin(nowMs: number, withinMs: number): number {
  return Math.ceil((nowMs - withinMs) / DAY_MS);
}

/**
 * Share nearby's greeting (15.8): a teammate not met here on a day that began within half the
 * window is due a Hello with nothing to swap, so a gathering notes every pair again well before
 * their days run out. A key not yet known counts as due.
 */
export function nearbyGreetDue(met: readonly NearbyMetRecord[], nowMs: number, withinMs: number): (key: string | null) => boolean {
  const from = nearbyFirstDayWithin(nowMs, withinMs / 2);
  const lately = new Set(met.filter((m) => m.day >= from).map((m) => m.key));
  return (key) => key === null || !lately.has(key);
}

export interface NearbyKeep {
  holdings(): Promise<Holdings>;
  /** Only what changed, so that a phone holding many entries writes one row per entry that moved. */
  saveHoldings(changed: Holdings): Promise<void>;
  revoked(): Promise<{ signed: SignedRevocation; list: RevocationList } | null>;
  saveRevoked(signed: SignedRevocation): Promise<void>;
  /** Filled from every checked chain, which does not by itself say a meeting took place. */
  noteName(key: string, profileId: string): Promise<void>;
  peers(): Promise<readonly NearbyPeerRecord[]>;
  /** Most recent last. A pair's line moves to the end, so the list is also partner order. */
  recordPeer(record: NearbyPeerRecord): Promise<void>;
  /** `nearbyMet:<org>` from `fromDay` on. A day before it is forgotten as it is read, so none is kept longer than asked. */
  met(fromDay: number): Promise<readonly NearbyMetRecord[]>;
  /** Notes this teammate's day, one line each, and forgets every day before `fromDay`. */
  noteMet(record: NearbyMetRecord, fromDay: number): Promise<void>;
  /**
   * `nearbyLetIn:<org>/<language>` (2026-11-24, review item 7): the people this phone let in under
   * each of its passes, by id. This phone is a pass's only user, so the count is exact. It says
   * who joined the team through this phone, so the app clears it at any sign-out, as `nearbyPeers`.
   */
  letIn(passId: string): Promise<readonly string[]>;
  /** Notes this person under the pass, unless it has let in `max` others already: then false, and nothing is written. */
  noteLetIn(passId: string, profileId: string, max: number): Promise<boolean>;
  /**
   * `nearbyListed:<org>/<language>` (2026-11-24, review item 17): the documents this language's list once named, newest
   * first, at most `NEARBY_LISTED_KEPT`. A phone serves them too, so a teammate whose organization data is behind still
   * gets the version of a followed guide its own data names. Only hashes of library documents: nothing of anyone.
   */
  listedDocs?(): Promise<readonly string[]>;
  noteListedDocs?(list: readonly string[]): Promise<void>;
}

/** Documents of a language's earlier lists a phone keeps naming (`listedDocs`): far above the versions a team moves through between trips to town. */
export const NEARBY_LISTED_KEPT = 2_000;

/** The two calls `SyncClient` gives this: reads outside the stream's turn, and one commit under it. */
export interface NearbyMeta {
  nearbyMeta(key: string): Promise<string | null>;
  writeNearbyMeta(rows: Record<string, string>): Promise<void>;
}

/** Far above a room: the oldest pair loses only its place in partner order. */
const PEERS_KEPT = 64;

/** Far above a team: the teammate met longest ago would only wait for their certificate or the next Share nearby. */
const MET_KEPT = 256;

/** Passes whose people are kept: a window's and the next's, with room; an older pass has expired and lets nobody in. */
const LET_IN_PASSES_KEPT = 8;
/** People kept under one pass, whatever its `maxUses` says: far above the 10 a pass allows (core `JOIN_PASS_USES`). */
const LET_IN_PER_PASS_MAX = 256;

const parsed = (raw: string | null): unknown => {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const isMet = (m: unknown): m is NearbyMetRecord => {
  const r = m as Partial<NearbyMetRecord> | null;
  return typeof r === 'object' && r !== null && typeof r.key === 'string' && typeof r.profileId === 'string' && Number.isSafeInteger(r.day);
};

const isPeer = (p: unknown): p is NearbyPeerRecord => {
  const r = p as Partial<NearbyPeerRecord> | null;
  return typeof r === 'object' && r !== null && typeof r.tag === 'string' && typeof r.gen === 'number' && typeof r.mine === 'string' && typeof r.theirs === 'string' &&
    (r.files === undefined || typeof r.files === 'string');
};

export function nearbyKeepOf(meta: NearbyMeta, at: { orgId: string; streamId: string }): NearbyKeep {
  const where = `${at.orgId}/${at.streamId}`;
  const entryKey = (key: string) => `nearbyHoldings:${where}:${key}`;
  const indexKey = `nearbyHoldingsIndex:${where}`;
  const peersKey = `nearbyPeers:${where}`;
  const namesKey = `nearbyNames:${at.orgId}`;
  const revokedKey = `nearbyRevoked:${at.orgId}`;
  const metKey = `nearbyMet:${at.orgId}`;
  const letInKey = `nearbyLetIn:${where}`;
  const listedKey = `nearbyListed:${where}`;
  const listed = async (): Promise<string[]> => {
    const raw = parsed(await meta.nearbyMeta(listedKey));
    return Array.isArray(raw) ? raw.filter((h): h is string => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h)).slice(0, NEARBY_LISTED_KEPT) : [];
  };
  /** Each pass's people, oldest pass first: only lists of ids, so a row that cannot be read reads as nothing. */
  const letInAll = async (): Promise<[string, string[]][]> => {
    const raw = parsed(await meta.nearbyMeta(letInKey));
    if (!Array.isArray(raw)) return [];
    return raw.filter((e): e is [string, string[]] => Array.isArray(e) && e.length === 2 && typeof e[0] === 'string' && Array.isArray(e[1]) && e[1].every((x) => typeof x === 'string'));
  };
  const allMet = async (): Promise<NearbyMetRecord[]> => {
    const raw = parsed(await meta.nearbyMeta(metKey));
    return Array.isArray(raw) ? raw.filter(isMet) : [];
  };
  const index = async (): Promise<string[]> => {
    const raw = parsed(await meta.nearbyMeta(indexKey));
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : [];
  };
  const keep: NearbyKeep = {
    async holdings() {
      const out = new Map<string, HoldingEntry>();
      for (const key of await index()) {
        const entry = parseHoldings({ [key]: parsed(await meta.nearbyMeta(entryKey(key))) })?.get(key);
        if (entry) out.set(key, entry);
      }
      return out;
    },
    async saveHoldings(changed) {
      if (changed.size === 0) return;
      const keys = new Set(await index());
      const rows: Record<string, string> = {};
      for (const [key, entry] of changed) {
        keys.add(key);
        rows[entryKey(key)] = JSON.stringify(entry);
      }
      rows[indexKey] = JSON.stringify([...keys]);
      await meta.writeNearbyMeta(rows);
    },
    async revoked() {
      const raw = parsed(await meta.nearbyMeta(revokedKey)) as Partial<SignedRevocation> | null;
      if (typeof raw?.text !== 'string' || typeof raw.kid !== 'string' || typeof raw.sig !== 'string') return null;
      const list = parseRevocationList(raw.text, { orgId: at.orgId, kid: raw.kid });
      return list ? { signed: { text: raw.text, kid: raw.kid, sig: raw.sig }, list } : null;
    },
    async saveRevoked(signed) {
      await meta.writeNearbyMeta({ [revokedKey]: JSON.stringify(signed) });
    },
    async noteName(key, profileId) {
      const raw = parsed(await meta.nearbyMeta(namesKey));
      const names = new Map(Array.isArray(raw) ? (raw as [string, string][]) : []);
      if (names.get(key) === profileId) return;
      names.set(key, profileId);
      await meta.writeNearbyMeta({ [namesKey]: JSON.stringify([...names]) });
    },
    async peers() {
      const raw = parsed(await meta.nearbyMeta(peersKey));
      return Array.isArray(raw) ? raw.filter(isPeer) : [];
    },
    async recordPeer(record) {
      const rest = (await keep.peers()).filter((p) => p.tag !== record.tag || p.gen !== record.gen);
      await meta.writeNearbyMeta({ [peersKey]: JSON.stringify([...rest, record].slice(-PEERS_KEPT)) });
    },
    async met(fromDay) {
      const all = await allMet();
      const kept = all.filter((m) => m.day >= fromDay);
      if (kept.length < all.length) await meta.writeNearbyMeta({ [metKey]: JSON.stringify(kept) });
      return kept;
    },
    async noteMet(record, fromDay) {
      const rest = (await allMet()).filter((m) => m.day >= fromDay && (m.key !== record.key || m.profileId !== record.profileId));
      await meta.writeNearbyMeta({ [metKey]: JSON.stringify([...rest, { key: record.key, profileId: record.profileId, day: record.day }].slice(-MET_KEPT)) });
    },
    async letIn(passId) {
      return (await letInAll()).find(([p]) => p === passId)?.[1] ?? [];
    },
    listedDocs: listed,
    async noteListedDocs(list) {
      const held = await listed();
      const known = new Set(held);
      const fresh = [...new Set(list)].filter((h) => !known.has(h) && /^[0-9a-f]{64}$/.test(h));
      // Written only when the list named something new: most sessions write nothing.
      if (fresh.length === 0) return;
      await meta.writeNearbyMeta({ [listedKey]: JSON.stringify([...fresh, ...held].slice(0, NEARBY_LISTED_KEPT)) });
    },
    async noteLetIn(passId, profileId, max) {
      const all = await letInAll();
      const people = all.find(([p]) => p === passId)?.[1] ?? [];
      if (people.includes(profileId)) return true;
      if (people.length >= Math.min(max, LET_IN_PER_PASS_MAX)) return false;
      const rest = all.filter(([p]) => p !== passId);
      await meta.writeNearbyMeta({ [letInKey]: JSON.stringify([...rest, [passId, [...people, profileId]]].slice(-LET_IN_PASSES_KEPT)) });
      return true;
    }
  };
  return keep;
}
