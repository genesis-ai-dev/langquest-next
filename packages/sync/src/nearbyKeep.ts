import { parseHoldings, parseRevocationList, type HoldingEntry, type Holdings, type RevocationList } from '@langquest-next/core';

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
}

/** The two calls `SyncClient` gives this: reads outside the stream's turn, and one commit under it. */
export interface NearbyMeta {
  nearbyMeta(key: string): Promise<string | null>;
  writeNearbyMeta(rows: Record<string, string>): Promise<void>;
}

/** Far above a room: the oldest pair loses only its place in partner order. */
const PEERS_KEPT = 64;

const parsed = (raw: string | null): unknown => {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const isPeer = (p: unknown): p is NearbyPeerRecord => {
  const r = p as Partial<NearbyPeerRecord> | null;
  return typeof r === 'object' && r !== null && typeof r.tag === 'string' && typeof r.gen === 'number' && typeof r.mine === 'string' && typeof r.theirs === 'string';
};

export function nearbyKeepOf(meta: NearbyMeta, at: { orgId: string; streamId: string }): NearbyKeep {
  const where = `${at.orgId}/${at.streamId}`;
  const entryKey = (key: string) => `nearbyHoldings:${where}:${key}`;
  const indexKey = `nearbyHoldingsIndex:${where}`;
  const peersKey = `nearbyPeers:${where}`;
  const namesKey = `nearbyNames:${at.orgId}`;
  const revokedKey = `nearbyRevoked:${at.orgId}`;
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
    }
  };
  return keep;
}
