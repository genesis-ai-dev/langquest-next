import type { EventEnvelope } from './events';
import type { Hlc } from './hlc';
import type { SourceDoc, TimingDoc } from './libraryDocs';
import type { Register } from './state';

/**
 * Reference material a translator sees (docs/reference-material.md).
 *
 * Three levels decide what is offered. An organization recommends items
 * from its library (`v1.ReferenceRecommended`, org partition); a language
 * narrows or adds to that for its team (`v1.LaneReferenceRecommended`,
 * language partition); translators then choose for themselves, on their own
 * device, and may explore anything. A passage gets the recommended items its
 * coordinates match, plus what an admin linked to it by hand
 * (`v1.PassageReferenceLinked`, which can also hide a match).
 *
 * Publishing a version or recording a review names what was offered and
 * what was opened or played (`v1.ReferencesUsed`): a reference to the
 * material, never the material, and part of the record, so it stays inside
 * the organization whatever its license (decision 38).
 *
 * Merges: recommendations and links are registers; what was used is
 * grow-only per subject and item, with `opened` true once any event says so.
 */

export type LaneRecommendation = 'recommended' | 'hidden' | 'inherit';

/** One item in the record of what was used. */
export interface UsedReference {
  /** A library item id, or `biblebrain.<bibleId>` for a Bible explored outside the library. */
  itemId: string;
  /** What people read: "Berean Standard Bible", "FIA · Genesis 1:1–2:3". */
  name: string;
  kind: 'source' | 'guide' | 'note' | 'questions';
  /** The exact document version that was offered. */
  docHash?: string;
  /** The part offered: "GEN 1:1-31", a study step id. */
  ref?: string;
  /** Played, read in a chosen version, opened or expanded, not only offered. */
  opened: boolean;
  /** Provider ids, e.g. "ENGESVO1DA ENGESVO_ET". */
  detail?: string;
  /** The copyright line as it stood. */
  copyright?: string;
}

export interface ReferenceOrgEvents {
  /** The organization recommends (or stops recommending) one of its library items to every language. Register per item. */
  'v1.ReferenceRecommended': { itemId: string; recommended: boolean };
}

export interface ReferenceWorkEvents {
  /** A language's own say on one item: recommend it to the team, hide the organization's recommendation, or follow the organization. Register per language and item. */
  'v1.LaneReferenceRecommended': { laneId: string; itemId: string; state: LaneRecommendation };
  /** An admin places an item on one passage by hand, or hides a match there. Register per language, passage and item. */
  'v1.PassageReferenceLinked': { laneId: string; unitId: string; itemId: string; linked: boolean };
  /** What was in front of the person for a version (`takeId`) or a review (`reviewId`); exactly one of the two. Grow-only. */
  'v1.ReferencesUsed': { laneId: string; unitId: string; takeId?: string; reviewId?: string; items: UsedReference[] };
}

export interface ReferenceState {
  /** laneId -> itemId -> the language's say. */
  laneReferences: Record<string, Record<string, Register<LaneRecommendation>>>;
  /** `${laneId}\u0000${unitId}` -> itemId -> linked (true) or hidden (false). */
  passageLinks: Record<string, Record<string, Register<boolean>>>;
  /** `take:<id>` or `review:<id>` -> itemId -> what was used. */
  referencesUsed: Record<string, Record<string, UsedReference & { by: string; hlc: Hlc; eventId: string }>>;
}

export function emptyReferenceState(): ReferenceState {
  return { laneReferences: {}, passageLinks: {}, referencesUsed: {} };
}

export const passageKey = (laneId: string, unitId: string) => `${laneId}\u0000${unitId}`;
export const usedKey = (s: { takeId?: string; reviewId?: string }) => (s.takeId ? `take:${s.takeId}` : `review:${s.reviewId}`);

const later = (current: Register<unknown> | undefined, e: EventEnvelope) =>
  !current || current.hlc === '' || current.hlc < e.hlc || (current.hlc === e.hlc && current.eventId < e.id);

/** Fold one language-partition reference event. Order-independent and idempotent (the caller guards ids). */
export function applyReferenceEvent(state: ReferenceState, e: EventEnvelope): void {
  switch (e.type) {
    case 'v1.LaneReferenceRecommended': {
      const p = e.payload as ReferenceWorkEvents['v1.LaneReferenceRecommended'];
      const lane = (state.laneReferences[p.laneId] ??= {});
      if (later(lane[p.itemId], e)) lane[p.itemId] = { value: p.state, hlc: e.hlc, eventId: e.id };
      break;
    }
    case 'v1.PassageReferenceLinked': {
      const p = e.payload as ReferenceWorkEvents['v1.PassageReferenceLinked'];
      const links = (state.passageLinks[passageKey(p.laneId, p.unitId)] ??= {});
      if (later(links[p.itemId], e)) links[p.itemId] = { value: p.linked, hlc: e.hlc, eventId: e.id };
      break;
    }
    case 'v1.ReferencesUsed': {
      const p = e.payload as ReferenceWorkEvents['v1.ReferencesUsed'];
      const used = (state.referencesUsed[usedKey(p)] ??= {});
      for (const item of p.items) {
        const prior = used[item.itemId];
        // The earliest event describes the item; `opened` is true once anyone says so.
        const earliest = !prior || e.hlc < prior.hlc || (e.hlc === prior.hlc && e.id < prior.eventId);
        const opened = item.opened || (prior?.opened ?? false);
        used[item.itemId] = earliest
          ? { ...item, opened, by: e.actorId, hlc: e.hlc, eventId: e.id }
          : { ...prior!, opened };
      }
      break;
    }
  }
}

/** Fold the org-partition recommendation into `recommendations` (OrgState). */
export function applyOrgRecommendation(recs: Record<string, Register<boolean>>, e: EventEnvelope): void {
  const p = e.payload as ReferenceOrgEvents['v1.ReferenceRecommended'];
  if (later(recs[p.itemId], e)) recs[p.itemId] = { value: p.recommended, hlc: e.hlc, eventId: e.id };
}

// ---- derivations ----------------------------------------------------------------

export type RecommendationSource = 'organization' | 'language';

/**
 * What a language recommends to its team: the organization's
 * recommendations, minus what the language hid, plus what it added. Each
 * item says where the recommendation comes from.
 */
export function recommendedFor(
  orgRecs: Record<string, Register<boolean>> | undefined,
  state: ReferenceState | null,
  laneId: string | null | undefined
): Map<string, RecommendationSource> {
  const out = new Map<string, RecommendationSource>();
  for (const [itemId, r] of Object.entries(orgRecs ?? {})) if (r.value) out.set(itemId, 'organization');
  const lane = laneId && state ? state.laneReferences[laneId] ?? {} : {};
  for (const [itemId, r] of Object.entries(lane)) {
    if (r.value === 'hidden') out.delete(itemId);
    else if (r.value === 'recommended') out.set(itemId, 'language');
  }
  return out;
}

/** An admin's choice on one passage: true linked by hand, false hidden here, undefined when the coordinates decide. */
export function passageLink(state: ReferenceState, laneId: string, unitId: string, itemId: string): boolean | undefined {
  return state.passageLinks[passageKey(laneId, unitId)]?.[itemId]?.value;
}

/** Items linked to a passage by hand. */
export function linkedTo(state: ReferenceState, laneId: string, unitId: string): string[] {
  return Object.entries(state.passageLinks[passageKey(laneId, unitId)] ?? {}).filter(([, r]) => r.value).map(([id]) => id).sort();
}

/** What a version or review records as used, sources first, then by name. */
export function usedOn(state: ReferenceState, subject: { takeId?: string; reviewId?: string }): (UsedReference & { by: string })[] {
  const order = { source: 0, guide: 1, note: 2, questions: 3 } as const;
  return Object.values(state.referencesUsed[usedKey(subject)] ?? {})
    .map(({ hlc: _h, eventId: _e, ...rest }) => rest)
    .sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name) || (a.itemId < b.itemId ? -1 : 1));
}

/** "Made with BSB (heard), ESV, FIA" for a version card: opened items first. */
export function usedSummary(items: Pick<UsedReference, 'name' | 'opened'>[], limit = 4): string {
  const sorted = [...items].sort((a, b) => Number(b.opened) - Number(a.opened));
  const names = sorted.slice(0, limit).map((i) => i.name);
  const more = sorted.length - names.length;
  return names.join(', ') + (more > 0 ? ` and ${more} more` : '');
}

// ---- sources and timings ---------------------------------------------------------

const OT_BOOKS = new Set([
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST',
  'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM',
  'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL'
]);

/** Which testament a book is in, for picking Bible Brain filesets (many Bibles have New Testament audio only). */
export function testamentOf(book: string): 'OT' | 'NT' {
  return OT_BOOKS.has(book) ? 'OT' : 'NT';
}

/** The Bible Brain fileset a source uses for a book, or null when it has none for that testament. */
export function biblebrainFileset(source: SourceDoc, book: string, media: 'text' | 'audio'): string | null {
  if (source.provider.kind !== 'biblebrain') return null;
  return source.provider[media]?.[testamentOf(book)] ?? null;
}

/** What a source offers for a book: text, audio, and whether phones may keep it. */
export function sourceOffers(source: SourceDoc, book: string): { text: boolean; audio: boolean; offline: boolean } {
  const has = source.books.some((b) => b.book === book);
  if (!has) return { text: false, audio: false, offline: false };
  if (source.provider.kind === 'biblebrain') {
    return { text: !!biblebrainFileset(source, book, 'text'), audio: !!biblebrainFileset(source, book, 'audio'), offline: source.offline === 'allowed' };
  }
  return { text: true, audio: true, offline: source.offline === 'allowed' };
}

/** A verse span in one chapter's recording. */
export interface Span { startMs: number; endMs: number }

/** Where verses `from`..`to` (inclusive) sit in a chapter's recording, by the segments that cover them; null when none do. */
export function verseSpan(timing: Pick<TimingDoc, 'segments'>, from: number, to: number = from): Span | null {
  const hit = timing.segments.filter((s) => s.verseEnd >= from && s.verseStart <= to);
  if (hit.length === 0) return null;
  return { startMs: Math.min(...hit.map((s) => s.startMs)), endMs: Math.max(...hit.map((s) => s.endMs)) };
}

/** The verse (segment) playing at `ms`: before the first verse there is none (the spoken heading). */
export function segmentAt(timing: Pick<TimingDoc, 'segments'>, ms: number): { verseStart: number; verseEnd: number } | null {
  for (const s of timing.segments) if (ms >= s.startMs && ms < s.endMs) return { verseStart: s.verseStart, verseEnd: s.verseEnd };
  const last = timing.segments[timing.segments.length - 1];
  return last && ms >= last.endMs ? { verseStart: last.verseStart, verseEnd: last.verseEnd } : null;
}

/**
 * FCBH's `/timestamps` rows (verse starts in seconds, "0" the spoken
 * heading) as segments that run end to end, the last to the end of the file.
 */
export function segmentsFromStarts(rows: { verse: number; seconds: number }[], durationMs: number): { introEndMs: number; segments: TimingDoc['segments'] } {
  const sorted = [...rows].sort((a, b) => a.verse - b.verse);
  const verses = sorted.filter((r) => r.verse > 0);
  const introEndMs = verses[0] ? Math.round(verses[0].seconds * 1000) : 0;
  const segments = verses.map((r, i) => {
    const startMs = Math.round(r.seconds * 1000);
    const next = verses[i + 1];
    const endMs = next ? Math.round(next.seconds * 1000) : Math.max(startMs, durationMs);
    return { verseStart: r.verse, verseEnd: next ? Math.max(r.verse, next.verse - 1) : r.verse, startMs, endMs: Math.max(startMs, endMs) };
  });
  return { introEndMs, segments };
}
