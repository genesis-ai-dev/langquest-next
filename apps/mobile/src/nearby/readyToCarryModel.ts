import { decodeHlc } from '@langquest-next/core';

/**
 * Ready to carry on Share nearby (docs/nearby-sync-plan.md 5.8): whether this phone holds
 * everything it knows of, or how much is missing and why, and each teammate with how recent the
 * newest work held from them is. Pure, so every rule is tested without radios; the facts come from
 * the language's store (nearbyCarry.android.ts) and the room's run, and the words are the screen's.
 *
 * Teammates come from the vector, the holdings and the language's members, never from who met
 * whom, since no phone can know about work on a phone it has not met since. The newest work held
 * from someone is the newest `firstHlc` of their batches here (the author's clock), which counts
 * work a third phone relayed and keeps no meeting time. "Since you were last online" compares it
 * with the newest row this phone has from the server, the latest moment it is known to have been
 * online without keeping a time of its own.
 */

export interface CarryFacts {
  /** Whoever is signed in: never listed as a teammate. */
  me: string;
  /** This install's key: its own holdings entry is not a teammate's. */
  myKey: string | null;
  /** Everyone with a role covering the language (`languagePeople`). */
  members: readonly string[];
  /** `nearbyNames`: install key to person, from checked chains. */
  names: ReadonlyMap<string, string>;
  /** Signers this phone counts batches from. */
  vectorKeys: readonly string[];
  /** What each phone last said it holds of unconfirmed files, by install key. */
  holdings: ReadonlyMap<string, { files: readonly string[] }>;
  /** Files on this phone now, by hash. */
  present: ReadonlySet<string>;
  /** Batches held here (`batchKeys`). */
  batches: readonly { key: string; actorId: string; firstHlc: string | null }[];
  /** Install keys of teammates heard on this screen now. */
  inRange: readonly (string | null)[];
  /** "Hold teammates' recordings". */
  hold: boolean;
  /** A session stopped asking for files: too little room. */
  noRoom: boolean;
  /** Rows pulled past what the Worker has vouched for: they can be shared only after the next sync. */
  pulledUnshared: boolean;
  /** A teammate could not send what was pruned: older work comes from the server. */
  olderFromServer: boolean;
  /** Authors of batches stamped far ahead. */
  farAhead: readonly { actorId: string }[];
  /** The clock of the newest row this phone has from the server, or null when it has none here. */
  lastOnlineMs: number | null;
  /** Local midnight today. */
  todayStartMs: number;
}

/** How recent the newest work held from a teammate is. */
export type CarrySeen = 'today' | 'since-online' | 'not-since-online';

export interface CarryTeammate {
  profileId: string;
  seen: CarrySeen;
  /** When they made the newest work held from them; null with none here. */
  newestMs: number | null;
}

/** Recordings held only by phones not in range, by the person whose phone holds them (null: not known). */
export interface CarryElsewhere {
  profileId: string | null;
  files: number;
}

export interface ReadyToCarry {
  /** Holds everything it knows of: no recording missing, nothing waiting to be vouched for, every recording held. */
  everything: boolean;
  /** Recordings teammates' phones hold that this phone does not. */
  missing: number;
  /** Of those, held by a phone in range: still coming. */
  coming: number;
  /** Of those, held only by phones not in range. */
  elsewhere: CarryElsewhere[];
  noRoom: boolean;
  /** "Hold teammates' recordings" is off: the team's work, but not all of their recordings. */
  notAllRecordings: boolean;
  pulledUnshared: boolean;
  olderFromServer: boolean;
  /** Each author of a far-ahead stamp, once. */
  farAhead: string[];
  teammates: CarryTeammate[];
}

/** An hlc's wall time, or null when it cannot be read. */
export function wallOf(hlc: string | null): number | null {
  if (!hlc) return null;
  try {
    const ms = decodeHlc(hlc).wallMs;
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

const RANK: Record<CarrySeen, number> = { today: 0, 'since-online': 1, 'not-since-online': 2 };

export function seenOf(newestMs: number | null, lastOnlineMs: number | null, todayStartMs: number): CarrySeen {
  if (newestMs === null) return 'not-since-online';
  if (newestMs >= todayStartMs) return 'today';
  return lastOnlineMs === null || newestMs > lastOnlineMs ? 'since-online' : 'not-since-online';
}

export function readyToCarryOf(f: CarryFacts): ReadyToCarry {
  const theirs = [...f.holdings].filter(([key]) => key !== f.myKey).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const inRange = new Set(f.inRange.filter((k): k is string => k !== null));
  const missingFiles = new Set<string>();
  for (const [, entry] of theirs) for (const file of entry.files) if (!f.present.has(file)) missingFiles.add(file);
  let coming = 0;
  const elsewhere = new Map<string | null, number>();
  for (const file of missingFiles) {
    const holders = theirs.filter(([, entry]) => entry.files.includes(file)).map(([key]) => key);
    if (holders.some((k) => inRange.has(k))) { coming += 1; continue; }
    const known = holders.map((k) => f.names.get(k)).find((p): p is string => p !== undefined && p !== f.me);
    const who = known ?? null;
    elsewhere.set(who, (elsewhere.get(who) ?? 0) + 1);
  }

  const people = new Set<string>(f.members);
  for (const key of [...f.vectorKeys, ...f.holdings.keys()]) {
    const p = f.names.get(key);
    if (p) people.add(p);
  }
  const newest = new Map<string, number>();
  for (const b of f.batches) {
    people.add(b.actorId);
    const ms = wallOf(b.firstHlc);
    if (ms !== null && ms > (newest.get(b.actorId) ?? -Infinity)) newest.set(b.actorId, ms);
  }
  people.delete(f.me);
  const teammates = [...people].map((profileId): CarryTeammate => {
    const newestMs = newest.get(profileId) ?? null;
    return { profileId, newestMs, seen: seenOf(newestMs, f.lastOnlineMs, f.todayStartMs) };
  }).sort((a, b) => RANK[a.seen] - RANK[b.seen] || (b.newestMs ?? -1) - (a.newestMs ?? -1) || (a.profileId < b.profileId ? -1 : 1));

  const missing = missingFiles.size;
  return {
    everything: missing === 0 && f.hold && !f.noRoom && !f.pulledUnshared,
    missing,
    coming,
    elsewhere: [...elsewhere].map(([profileId, files]) => ({ profileId, files })).sort((a, b) => (a.profileId === null ? 1 : b.profileId === null ? -1 : a.profileId < b.profileId ? -1 : 1)),
    noRoom: f.noRoom,
    notAllRecordings: !f.hold,
    pulledUnshared: f.pulledUnshared,
    olderFromServer: f.olderFromServer,
    farAhead: [...new Set(f.farAhead.map((x) => x.actorId))],
    teammates
  };
}

/** Before anything is known: nothing to say yet. */
export const NOTHING_TO_CARRY: ReadyToCarry = {
  everything: true, missing: 0, coming: 0, elsewhere: [], noRoom: false, notAllRecordings: false, pulledUnshared: false, olderFromServer: false, farAhead: [], teammates: []
};
