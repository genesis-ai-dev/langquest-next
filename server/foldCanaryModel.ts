import { canonicalJson, ORG_STREAM, PERSON_ORG, type LanguageState, type PassageLine } from '@langquest-next/core';

/**
 * The fold canary's pure part (ops dashboard plan 5.4): which languages a
 * night checks, and whether a fold made afresh agrees with what the server
 * stored. It checks in production what the order-independence and
 * idempotence tests check in CI. server/foldCanary.ts reads and folds.
 */

export interface CanaryStream { orgId: string; streamId: string; /** Its length: `next_seq - 1`. */ events: number }

/** How many languages a night picks at random, besides Sunday's largest. */
export const CANARY_RANDOM = 3;

/**
 * Three language streams at random, and on Sundays (UTC) the one with the
 * most events too. The organization and person streams hold no language
 * state. `random` is Math.random in the job; a test gives its own.
 */
export function pickCanaryLanguages(streams: readonly CanaryStream[], opts: { sunday: boolean; random?: () => number; count?: number }): CanaryStream[] {
  const random = opts.random ?? Math.random;
  const pool = streams.filter((s) => s.streamId !== ORG_STREAM && s.orgId !== PERSON_ORG && s.events > 0);
  // A partial Fisher-Yates shuffle: the first `count` of the pool, each equally likely.
  const picked = [...pool];
  const count = Math.min(opts.count ?? CANARY_RANDOM, picked.length);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(random() * (picked.length - i));
    [picked[i], picked[j]] = [picked[j]!, picked[i]!];
  }
  const out = picked.slice(0, count);
  if (opts.sunday) {
    const largest = pool.reduce<CanaryStream | undefined>((best, s) => (!best || s.events > best.events ? s : best), undefined);
    if (largest && !out.some((s) => s.orgId === largest.orgId && s.streamId === largest.streamId)) out.push(largest);
  }
  return out;
}

/** A snapshot's state is stored without the ids of the events folded into it (the pass blanks them), so neither side counts them. */
const stateText = (state: LanguageState) => canonicalJson({ ...state, appliedEventIds: {} });

export interface CanaryComparison {
  orgId: string;
  streamId: string;
  /** The stored snapshot's state equals the afresh fold's, as canonical JSON. */
  stateMatches: boolean;
  /**
   * Passage lines. `null`: not compared, since the stored lines hold at a
   * seq the fold did not reach (see foldCanary.ts). Otherwise how many
   * passages' lines differ, counting one present on only one side.
   */
  linesDiffering: number | null;
  /** The language agrees on everything compared. */
  ok: boolean;
}

/**
 * Compare the afresh fold with the stored snapshot, and its lines with the
 * stored `passage_lines` rows (unit id to line). Lines are compared passage
 * by passage, canonical JSON to canonical JSON; `storedLines` null skips them.
 */
export function compareFold(
  who: { orgId: string; streamId: string },
  stored: LanguageState, fresh: LanguageState,
  storedLines: ReadonlyMap<string, unknown> | null, freshLines: readonly PassageLine[]
): CanaryComparison {
  const stateMatches = stateText(stored) === stateText(fresh);
  let linesDiffering: number | null = null;
  if (storedLines) {
    const freshById = new Map(freshLines.map((l) => [l.unitId, l]));
    linesDiffering = 0;
    for (const [unitId, json] of storedLines) {
      const line = freshById.get(unitId);
      if (!line || canonicalJson(line) !== canonicalJson(json)) linesDiffering += 1;
    }
    for (const unitId of freshById.keys()) if (!storedLines.has(unitId)) linesDiffering += 1;
  }
  return { ...who, stateMatches, linesDiffering, ok: stateMatches && !linesDiffering };
}
