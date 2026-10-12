// What the reference screens show and write (docs/reference-material.md):
// who recommends an item at this level and what an admin may do about it,
// the facts of a source (text, audio, timings, offline, copyright), a new
// Bible Brain source as a `source@1` document. Pure: no React Native, so it
// is tested.
import {
  privilegesFor, recommendedFor, testamentOf,
  type LanguageRecommendation, type LibraryDoc, type OrgState, type Privilege, type LanguageState,
  type RecommendationSource, type Register, type SourceBookDoc, type SourceDoc, type TimingDoc
} from '@langquest-next/core';
import { t } from '../i18n';
import type { BibleDetail } from '../sources/bibleBrain';

// ---- who may recommend ----------------------------------------------------------

/** Does this person hold a privilege through an organization-wide membership (what the server asks of organization writes)? */
export function orgLevelCan(org: OrgState | null, profileId: string, p: Privilege): boolean {
  return !!org && privilegesFor(org, profileId).has(p);
}

// ---- recommendations ------------------------------------------------------------

/** Where a screen is: the organization, or one language (whose state is the open language's). */
export type Level = { kind: 'org' } | { kind: 'language'; languageId: string };

interface RecState {
  /** The organization recommends it. */
  org: boolean;
  /** The language's own say, when it has one other than following the organization. */
  language: Exclude<LanguageRecommendation, 'inherit'> | null;
  /** Whether it reaches translators at this level, and from whom. */
  effective: RecommendationSource | null;
}

export function recState(orgRecs: Record<string, Register<boolean>> | undefined, state: LanguageState | null, level: Level, itemId: string): RecState {
  const org = orgRecs?.[itemId]?.value === true;
  if (level.kind === 'org') return { org, language: null, effective: org ? 'organization' : null };
  const say = state?.languageReferences[itemId]?.value;
  const language = say === 'recommended' || say === 'hidden' ? say : null;
  return { org, language, effective: recommendedFor(orgRecs, state).get(itemId) ?? null };
}

/** "Recommended by the organization", "Hidden for this language", for a line or badge. */
export function recLabel(r: RecState, level: Level): string {
  if (level.kind === 'org') return r.org ? t('reference.rec.recommended') : t('reference.rec.notRecommended');
  if (r.language === 'hidden') return t('reference.rec.hiddenForLanguage');
  if (r.effective === 'language') return t('reference.rec.forLanguage');
  if (r.effective === 'organization') return t('reference.rec.byOrganization');
  return t('reference.rec.notRecommended');
}

/** How a badge colours `recLabel`: recommended green, hidden amber, else plain. */
export function recTone(r: RecState): 'green' | 'amber' | 'default' {
  if (r.language === 'hidden') return 'amber';
  return r.effective ? 'green' : 'default';
}

/** Does it reach translators here (what `recLabel` calls recommended)? */
export function recOn(r: RecState): boolean {
  return r.language !== 'hidden' && !!r.effective;
}

export type RecAction = 'recommend' | 'stop' | 'hide' | 'inherit';

/** What an admin may do at this level: the organization recommends or stops; a language recommends, hides or follows the organization. */
export function recActions(r: RecState, level: Level): { id: RecAction; label: string }[] {
  if (level.kind === 'org') return [r.org ? { id: 'stop', label: t('reference.rec.stop') } : { id: 'recommend', label: t('reference.rec.recommend') }];
  if (r.language === 'hidden') return [{ id: 'inherit', label: t('reference.rec.follow') }];
  if (r.language === 'recommended') return [{ id: 'inherit', label: r.org ? t('reference.rec.follow') : t('reference.rec.stop') }];
  return [r.org ? { id: 'hide', label: t('reference.rec.hide') } : { id: 'recommend', label: t('reference.rec.recommend') }];
}

/** The write an action makes: an organization event, or an event in the language's own log. */
export type RecWrite =
  | { to: 'org'; type: 'v1.ReferenceRecommended'; payload: { itemId: string; recommended: boolean } }
  | { to: 'language'; languageId: string; type: 'v1.ReferenceSet'; payload: { itemId: string; state: LanguageRecommendation } };

export function recWrite(level: Level, itemId: string, action: RecAction): RecWrite {
  if (level.kind === 'org') return { to: 'org', type: 'v1.ReferenceRecommended', payload: { itemId, recommended: action === 'recommend' } };
  const state: LanguageRecommendation = action === 'recommend' ? 'recommended' : action === 'hide' ? 'hidden' : 'inherit';
  return { to: 'language', languageId: level.languageId, type: 'v1.ReferenceSet', payload: { itemId, state } };
}

/** The write that puts things back as they were before `action` (Undo). */
export function recUndo(r: RecState, level: Level, itemId: string): RecWrite {
  if (level.kind === 'org') return { to: 'org', type: 'v1.ReferenceRecommended', payload: { itemId, recommended: r.org } };
  return { to: 'language', languageId: level.languageId, type: 'v1.ReferenceSet', payload: { itemId, state: r.language ?? 'inherit' } };
}

/** What the toast says after an action. */
export function recMessage(name: string, action: RecAction, level: Level): string {
  switch (action) {
    case 'recommend': return level.kind === 'org' ? t('reference.rec.done.recommendedEverywhere', { name }) : t('reference.rec.done.recommendedHere', { name });
    case 'stop': return t('reference.rec.done.stopped', { name });
    case 'hide': return t('reference.rec.done.hidden', { name });
    case 'inherit': return t('reference.rec.done.follows', { name });
  }
}

// ---- what kind of reference an item is -------------------------------------------

export type RefKind = 'source' | 'guide' | 'note' | 'questions' | 'other';

/** What a document is to a translator: a Bible, a guide, a note, a question set or other material. */
export function refKindOf(doc: LibraryDoc | null | undefined): RefKind | null {
  if (!doc) return null;
  switch (doc.format) {
    case 'source@1': return 'source';
    case 'study@1': case 'study@2': case 'collection@1': return 'guide';
    case 'material@1': return doc.kind === 'note' ? 'note' : doc.kind === 'questions' ? 'questions' : 'other';
    default: return null;
  }
}

/** What a kind of reference is called, in the language showing. */
export function refKindLabel(kind: RefKind): string {
  switch (kind) {
    case 'source': return t('reference.kind.source');
    case 'guide': return t('reference.kind.guide');
    case 'note': return t('reference.kind.note');
    case 'questions': return t('reference.kind.questions');
    case 'other': return t('reference.kind.other');
  }
}

/** The books an item speaks to (USFM), from its ref, entries, links or books. */
export function booksOf(doc: LibraryDoc | null | undefined): string[] {
  if (!doc) return [];
  const out = new Set<string>();
  const add = (ref: string | undefined) => { const m = ref ? /^([A-Z0-9]{3})/.exec(ref.trim()) : null; if (m) out.add(m[1]!); };
  switch (doc.format) {
    case 'source@1': for (const b of doc.books) out.add(b.book); break;
    case 'study@1': add(doc.ref); break;
    case 'study@2': add(doc.ref); for (const l of doc.links ?? []) if ('ref' in l) add(l.ref); break;
    case 'collection@1': for (const e of doc.entries) add(e.ref); break;
    case 'material@1': for (const l of doc.links ?? []) if ('ref' in l) add(l.ref); break;
    default: break;
  }
  return [...out];
}

// ---- source facts -----------------------------------------------------------------

type Testament = 'OT' | 'NT';
type TimingSource = 'fcbh' | 'generated' | 'manual';

interface BookTimings {
  book: string;
  name: string;
  /** Chapters with a timing in this source's book document. */
  timed: number;
  /** Chapters the book has, when known (Bible Brain's detail). */
  chapters: number | null;
  /** Where its stored timings came from. */
  sources: TimingSource[];
}

interface SourceFacts {
  text: Record<Testament, boolean>;
  audio: Record<Testament, boolean>;
  /** Per testament: FCBH answers live (`timestamps` in the Worker's detail), stored timings, or none. */
  timings: Record<Testament, 'fcbh' | 'stored' | 'some' | 'none' | 'unknown'>;
  books: BookTimings[];
  offline: boolean;
  copyright: string[];
  provider: 'library' | 'biblebrain';
}

const TIMING_SOURCE: Record<TimingDoc['source'], TimingSource> = { fcbh: 'fcbh', ctc: 'generated', manual: 'manual' };

/**
 * What a source offers, per testament: text, audio, timings (FCBH's own,
 * stored in its books, or none), and whether phones may keep it. `get`
 * reads loaded documents; `detail` is the Worker's answer for a Bible
 * Brain source when it is at hand.
 */
export function sourceFacts(source: SourceDoc, get: (hash: string | null | undefined) => LibraryDoc | null, detail?: BibleDetail | null): SourceFacts {
  const has = (t: Testament) => source.books.some((b) => testamentOf(b.book) === t);
  const books: BookTimings[] = source.books.map((b) => {
    const doc = get(b.doc) as SourceBookDoc | null;
    const timed = (doc?.chapters ?? []).filter((c) => c.timing);
    const sources = [...new Set(timed.map((c) => (get(c.timing) as TimingDoc | null)?.source).filter((s): s is TimingDoc['source'] => !!s).map((s) => TIMING_SOURCE[s]))].sort();
    const chapters = detail?.books.find((d) => d.book === b.book)?.chapters ?? (doc ? doc.chapters.length || null : null);
    return { book: b.book, name: b.name, timed: timed.length, chapters, sources };
  });
  const text = { OT: false, NT: false };
  const audio = { OT: false, NT: false };
  if (source.provider.kind === 'biblebrain') {
    for (const t of ['OT', 'NT'] as const) {
      text[t] = has(t) && !!source.provider.text?.[t];
      audio[t] = has(t) && !!source.provider.audio?.[t];
    }
  } else {
    for (const b of source.books) {
      const t = testamentOf(b.book);
      const doc = get(b.doc) as SourceBookDoc | null;
      // A book not loaded yet: the source's own copyright lines say whether it has audio.
      if (!doc) { text[t] = true; if (source.copyright.audio) audio[t] = true; continue; }
      if (doc.chapters.some((c) => c.verses?.length)) text[t] = true;
      if (doc.chapters.some((c) => c.audio)) audio[t] = true;
    }
  }
  const timings = { OT: 'none', NT: 'none' } as SourceFacts['timings'];
  for (const t of ['OT', 'NT'] as const) {
    if (!audio[t]) { timings[t] = 'none'; continue; }
    if (detail?.timestamps[t]) { timings[t] = 'fcbh'; continue; }
    const inT = books.filter((b) => testamentOf(b.book) === t);
    const timed = inT.filter((b) => b.timed > 0);
    timings[t] = timed.length === 0
      ? ((source.provider.kind === 'biblebrain' && !detail) || inT.some((b) => b.chapters === null) ? 'unknown' : 'none')
      : timed.length === inT.length && timed.every((b) => b.chapters === null || b.timed >= b.chapters) ? 'stored' : 'some';
  }
  const copyright = [source.copyright.text, source.copyright.audio && source.copyright.audio !== source.copyright.text ? source.copyright.audio : undefined, source.license]
    .filter((s): s is string => !!s && s.trim() !== '');
  return { text, audio, timings, books, offline: source.offline === 'allowed', copyright, provider: source.provider.kind };
}

const testamentName = (x: Testament) => (x === 'OT' ? t('reference.facts.oldTestament') : t('reference.facts.newTestament'));

/** "Text and audio · timings by FCBH", per testament the source has, for a card. */
export function testamentLines(f: SourceFacts): { testament: Testament; label: string; line: string }[] {
  return (['OT', 'NT'] as const).filter((x) => f.text[x] || f.audio[x] || f.books.some((b) => testamentOf(b.book) === x)).map((x) => {
    const media = f.text[x] && f.audio[x] ? t('reference.facts.textAndAudio') : f.audio[x] ? t('reference.facts.audioOnly')
      : f.text[x] ? t('reference.facts.textOnly') : t('reference.facts.listedOnly');
    const timing = !f.audio[x] ? null : timingWords(f.timings[x]);
    return { testament: x, label: testamentName(x), line: timing ? [media, timing].join(' · ') : media };
  });
}

function timingWords(timings: SourceFacts['timings'][Testament]): string | null {
  switch (timings) {
    case 'fcbh': return t('reference.facts.timingsByFcbh');
    case 'stored': return t('reference.media.verseTimings');
    case 'some': return t('reference.facts.timingsSomeBooks');
    case 'none': return t('reference.facts.noVerseTimings');
    case 'unknown': return null;
  }
}

/** "Keep offline" or why not. */
export function offlineLine(f: SourceFacts): string {
  return f.offline ? t('reference.facts.keptOffline') : t('reference.facts.streamOnly');
}

/** One line for a list: "Text and audio (NT) · offline". */
export function sourceSummary(f: SourceFacts): string {
  const parts: string[] = [];
  parts.push(f.text.OT && f.text.NT ? t('reference.media.textWhole') : f.text.OT ? t('reference.media.textOT') : f.text.NT ? t('reference.media.textNT') : t('reference.media.noText'));
  parts.push(f.audio.OT && f.audio.NT ? t('reference.media.audioWhole') : f.audio.OT ? t('reference.media.audioOT') : f.audio.NT ? t('reference.media.audioNT') : t('reference.media.noAudio'));
  const withAudio = (['OT', 'NT'] as const).filter((x) => f.audio[x]);
  const timed = withAudio.filter((x) => f.timings[x] === 'fcbh' || f.timings[x] === 'stored');
  // Until Bible Brain has said whether FCBH has timestamps, say nothing about timings.
  if (withAudio.length && !withAudio.every((x) => f.timings[x] === 'unknown')) {
    parts.push(timed.length === withAudio.length ? t('reference.media.verseTimings')
      : timed.length || withAudio.some((x) => f.timings[x] === 'some') ? t('reference.media.someTimings') : t('reference.media.noTimings'));
  }
  parts.push(f.offline ? t('reference.media.offline') : t('reference.media.streamOnly'));
  return parts.join(' · ');
}

// ---- verse timings to ask for -------------------------------------------------------

interface TimingRequest {
  testament: Testament;
  bibleId: string;
  audioFileset: string;
  textFileset: string | null;
  books: string[];
}

/**
 * Books whose audio has no verse timings: no FCBH timestamps for their
 * testament and not every chapter timed in the source's book. One request
 * per audio fileset. `allowed` is false when Bible Brain lets the audio be
 * streamed only: the timing job may not download it.
 */
export function timingsNeeded(source: SourceDoc, f: SourceFacts, detail: BibleDetail | null): { requests: TimingRequest[]; allowed: boolean; reason: string | null } {
  if (source.provider.kind !== 'biblebrain') return { requests: [], allowed: false, reason: null };
  const provider = source.provider;
  const requests: TimingRequest[] = [];
  for (const t of ['OT', 'NT'] as const) {
    const audio = provider.audio?.[t];
    if (!audio || f.timings[t] === 'fcbh' || (detail === null && f.timings[t] === 'unknown')) continue;
    const books = f.books.filter((b) => testamentOf(b.book) === t && (b.timed === 0 || (b.chapters !== null && b.timed < b.chapters))).map((b) => b.book);
    if (books.length) requests.push({ testament: t, bibleId: provider.bibleId, audioFileset: audio, textFileset: provider.text?.[t] ?? null, books });
  }
  const allowed = detail ? detail.offline.audio : source.offline === 'allowed';
  const reason = requests.length && !allowed
    ? t('reference.facts.streamOnlyNoTimings')
    : null;
  return { requests, allowed, reason };
}

// ---- a Bible Brain Bible as a source ------------------------------------------------

/** The library item id of a Bible Brain source: the same on every phone, so two admins adding it offline agree. */
export function biblebrainItemId(bibleId: string): string {
  return `biblebrain.${bibleId.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}`.slice(0, 120);
}

const only = (t: { OT?: string; NT?: string }) => ({ ...(t.OT ? { OT: t.OT } : {}), ...(t.NT ? { NT: t.NT } : {}) });

/**
 * A Bible Brain Bible as a `source@1` document, numbered in `versification`
 * (the organization's English versification). Phones may keep it only when
 * Bible Brain allows downloading every medium it has.
 */
export function sourceFromBible(detail: BibleDetail, versification: string): SourceDoc {
  const text = only(detail.text);
  const audio = only(detail.audio);
  const hasText = Object.keys(text).length > 0;
  const hasAudio = Object.keys(audio).length > 0;
  const offline = (hasText || hasAudio) && (!hasText || detail.offline.text) && (!hasAudio || detail.offline.audio);
  const covered = (t: Testament) => !!text[t] || !!audio[t];
  const books = detail.books.filter((b) => covered(b.testament)).map((b) => ({ book: b.book, name: b.name }));
  const copyright = { ...(detail.copyright.text ? { text: detail.copyright.text } : {}), ...(detail.copyright.audio ? { audio: detail.copyright.audio } : {}) };
  return {
    format: 'source@1',
    name: detail.name,
    abbreviation: detail.abbreviation || detail.bibleId,
    language: detail.language,
    versification,
    provider: { kind: 'biblebrain', bibleId: detail.bibleId, ...(hasText ? { text } : {}), ...(hasAudio ? { audio } : {}) },
    offline: offline ? 'allowed' : 'stream',
    copyright,
    books,
    deps: []
  };
}
