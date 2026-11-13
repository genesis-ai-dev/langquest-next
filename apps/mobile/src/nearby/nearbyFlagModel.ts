/**
 * What `get_user_state` says of nearby sync (docs/nearby-sync-plan.md 5.5): each organization's
 * features and its newest revocation list. Apart from nearbyModel.ts because every client reads
 * the user state (nearbyFlag.ts), and the web, which never runs nearby sync, need not load the
 * rest of it (the web budget, decision 233). Pure.
 */

/** `orgFeatures` of `get_user_state`'s answer, or null from a server before the field: then nothing is known, and nothing is dropped. */
export function orgFeaturesOf(userState: unknown): Record<string, string[]> | null {
  const v = (userState as { orgFeatures?: unknown } | null)?.orgFeatures;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const out: Record<string, string[]> = {};
  for (const [org, features] of Object.entries(v)) {
    if (Array.isArray(features)) out[org] = features.filter((f): f is string => typeof f === 'string');
  }
  return out;
}

/** `nearbyRevokedSeq`: each organization's newest revocation list, by its `seq`. */
export function revokedSeqsOf(userState: unknown): Record<string, number> {
  const v = (userState as { nearbyRevokedSeq?: unknown } | null)?.nearbyRevokedSeq;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [org, seq] of Object.entries(v)) if (typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 1) out[org] = seq;
  return out;
}

