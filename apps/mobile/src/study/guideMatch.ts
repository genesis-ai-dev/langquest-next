// Which study guide belongs to a passage (ADR-018, STUDY-1, docs/library.md).
// Guides are library material: a collection (FIA in one language) or a single
// guide, each numbered in its own versification. A passage's verses come from
// its unit id (library templates) or its label (older units), read in its
// template's versification. The two meet through org (core versification.ts),
// so guides numbered in English land on passages a team numbers another way.
// Pure: documents in, a choice out.
import {
  libraryUnitRange, parseRef, sharedVerses, studyEntriesFor, unitPrefixFor, usfmOf, versesInChapter,
  type CollectionDoc, type LibraryDoc, type MediaRef, type LanguageState, type StudyDoc, type StudyDoc2, type TemplateDoc, type VerseRange, type VersificationDoc
} from '@langquest-next/core';
import type { GlossaryEntry, GuideOrigin, StudyFile, StudyGuide, StudyMediaKind } from './guides';
import { unitRange } from './range';

/** A document that may hold guides: an item this organization has, or one another shares. `key` names it in guide ids. */
export interface GuideSource {
  key: string;
  hash: string;
  /** The organization's own item (not a subscription): its single guides can be edited here. */
  itemId?: string;
}

type Get = (hash: string | null | undefined) => LibraryDoc | null;

/** What a stored file is when the guide does not say: audio is the recorder's m4a, pictures JPEG, films MP4. */
const DEFAULT_FORMAT = { audio: 'm4a', image: 'jpg', video: 'mp4' } as const;
type FileKind = keyof typeof DEFAULT_FORMAT;
const FORMAT = /^[a-z0-9]{2,5}$/;

/**
 * The stored file to use for a media reference: on a phone the smaller copy
 * when there is one (pictures 500px, always JPEG; films MP4), else the
 * original. None when the media is only a URL.
 */
export function mediaFile(ref: MediaRef | undefined, kind: FileKind, phone: boolean): StudyFile | undefined {
  if (!ref?.hash) return undefined;
  if (phone && ref.lowHash) return { hash: ref.lowHash, format: DEFAULT_FORMAT[kind] };
  const f = ref.format?.toLowerCase().replace(/^jpeg$/, 'jpg');
  return { hash: ref.hash, format: f && FORMAT.test(f) ? f : DEFAULT_FORMAT[kind] };
}

const fileKindOf = (k: StudyMediaKind): FileKind => (k === 'video' ? 'video' : 'image');
const secondsFor = (text: string) => Math.max(30, Math.round(text.length / 15));

/**
 * A library study document as the app's guide. The id is stable across
 * versions: notes and finished steps keep their place. `study@2` media come
 * from the blob store by hash (the phone copy on a phone) or from a URL.
 */
export function guideFromDoc(id: string, doc: StudyDoc | StudyDoc2, opts: { phone?: boolean; origin?: GuideOrigin } = {}): StudyGuide {
  const phone = opts.phone ?? false;
  const common = { id, pattern: doc.pattern, about: doc.about, source: doc.source, passage: doc.title, ...(opts.origin ? { origin: opts.origin } : {}) };
  if (doc.format === 'study@1') {
    return {
      ...common,
      steps: doc.steps.map((s) => ({
        id: s.id, title: s.title, ...(s.phase ? { phase: s.phase } : {}), purpose: s.purpose ?? '', text: s.text,
        audio: { ...(s.audio?.url ? { url: s.audio.url } : {}), seconds: s.audio?.seconds ?? secondsFor(s.text) }
      })),
      resources: doc.resources.map((r) => ({
        ref: r.ref, kind: r.kind, title: r.title, ...(r.description ? { description: r.description } : {}),
        ...(r.media ? { media: r.media.map((m) => ({ id: m.id, kind: m.kind, title: m.title, caption: m.caption, ...(m.url ? { url: m.url } : {}) })) } : {})
      })),
      glossary: Object.fromEntries(doc.terms.map((t) => [t.id, { term: t.term, ...(t.hint ? { hint: t.hint } : {}), body: t.body, ...(t.audioUrl ? { audioUrl: t.audioUrl } : {}) }]))
    };
  }
  return {
    ...common,
    ...(doc.license ? { license: doc.license } : {}),
    ...(doc.credit ? { credit: doc.credit } : {}),
    steps: doc.steps.map((s) => {
      const file = mediaFile(s.audio, 'audio', phone);
      return {
        id: s.id, title: s.title, ...(s.phase ? { phase: s.phase } : {}), purpose: s.purpose ?? '', text: s.text,
        audio: { ...(s.audio?.url ? { url: s.audio.url } : {}), ...(file ? { file } : {}), seconds: s.audio?.seconds ?? secondsFor(s.text) }
      };
    }),
    resources: doc.resources.map((r) => ({
      ref: r.ref, kind: r.kind, title: r.title, ...(r.description ? { description: r.description } : {}),
      ...(r.media ? {
        media: r.media.map((m) => {
          const file = mediaFile(m.file, fileKindOf(m.kind), phone);
          const noPhoneCopy = m.kind === 'video' && !!m.file.hash && !m.file.lowHash;
          return {
            id: m.id, kind: m.kind, title: m.title, caption: m.caption,
            ...(m.file.url ? { url: m.file.url } : {}), ...(file ? { file } : {}), ...(noPhoneCopy ? { noPhoneCopy } : {})
          };
        })
      } : {})
    })),
    glossary: Object.fromEntries(doc.terms.map((t): [string, GlossaryEntry] => {
      const file = mediaFile(t.audio, 'audio', phone);
      return [t.id, {
        term: t.term, ...(t.hint ? { hint: t.hint } : {}), body: t.body,
        ...(t.audio?.url ? { audioUrl: t.audio.url } : {}), ...(file ? { audioFile: file } : {})
      }];
    }))
  };
}

/** A guide id from where it lives; never ':' (study mark keys are ':'-separated). */
const guideId = (source: string, ref: string) => `${source}~${ref}`.replace(/[:\s]/g, '.');

/** The passage's verses and the versification they are in (null when its template names none). */
export function passageVerses(state: LanguageState, unitId: string, get: Get): { range: VerseRange; versification: VersificationDoc | null } | null {
  const sel = state.template?.value;
  const template = sel?.docHash ? (get(sel.docHash) as TemplateDoc | null) : null;
  const v11n = template?.bible ? (get(template.bible.versification) as VersificationDoc | null) : null;
  const lib = libraryUnitRange(unitId, v11n ? (b, c) => versesInChapter(v11n, b, c) : undefined);
  if (lib) return { range: lib, versification: v11n };
  // Older units: verses from the label (range.ts), the book as a USFM code.
  const old = unitRange(state, unitId);
  if (!old) return null;
  return { range: { book: usfmOf(old.book), start: old.start, end: { chapter: old.end.chapter, verse: old.end.verse ?? 999 } }, versification: null };
}

/** Is this unit the template node a link names, or inside it? */
function inNode(unitId: string, link: { template: string; node: string }): boolean {
  const at = `${unitPrefixFor(link.template)}/${link.node}`;
  return unitId === at || unitId.startsWith(`${at}.`);
}

/** Placed by template node: always a better match than any verse overlap. */
const NODE_MATCH = 100_000;

/**
 * How well a `study@2` guide fits a passage: verses shared through its ref
 * or verse links (in its versification, or the passage's when it names
 * none), or NODE_MATCH when one of its links names the passage's part of a
 * template. 0 when it does not apply.
 */
export function study2Fit(passage: { unitId?: string; range: VerseRange | null; versification: VersificationDoc | null }, doc: StudyDoc2, get: Get): number {
  const own = doc.versification ? (get(doc.versification) as VersificationDoc | null) : null;
  const overlap = (ref: string) => {
    const v11n = own ?? passage.versification;
    const r = parseRef(ref);
    if (!passage.range || !v11n || !r) return 0;
    return sharedVerses({ doc: passage.versification ?? v11n, range: passage.range }, { doc: v11n, range: r });
  };
  let best = doc.ref ? overlap(doc.ref) : 0;
  for (const link of doc.links ?? []) {
    if ('node' in link) { if (passage.unitId && inNode(passage.unitId, link)) return NODE_MATCH; continue; }
    best = Math.max(best, overlap(link.ref));
  }
  return best;
}

/**
 * The guide for a passage: the first group with any match wins (the
 * organization's own material before shared material), and within it a
 * guide in the reader's language before others (FIA in five languages all
 * cover the same passage), then the one sharing the most verses. Returns
 * the guide's document hash to load, or null. A passage without a
 * versification is read in each guide's own; one without verses (a part of
 * an outline template) is found only by `study@2` template links.
 */
export function bestGuide(
  passage: { unitId?: string; range: VerseRange | null; versification: VersificationDoc | null },
  groups: GuideSource[][],
  get: Get,
  language = 'eng'
): { id: string; hash: string; shared: number; source: GuideSource } | null {
  type Pick = { id: string; hash: string; shared: number; mine: boolean; source: GuideSource };
  const better = (a: Pick, b: Pick | null) => !b || (a.mine !== b.mine ? a.mine : a.shared > b.shared);
  for (const group of groups) {
    let best: Pick | null = null;
    for (const s of group) {
      const doc = get(s.hash);
      if (!doc) continue;
      if (doc.format === 'collection@1') {
        const v11n = get(doc.versification) as VersificationDoc | null;
        if (!v11n || !passage.range) continue;
        const top = studyEntriesFor({ range: passage.range, versification: passage.versification ?? v11n }, { doc: doc as CollectionDoc, versification: v11n })[0];
        const pick = top ? { id: guideId(s.key, top.entry.ref), hash: top.entry.doc, shared: top.shared, mine: (doc as CollectionDoc).language === language, source: s } : null;
        if (pick && better(pick, best)) best = pick;
      } else if (doc.format === 'study@1') {
        const v11n = get(doc.versification) as VersificationDoc | null;
        const r = parseRef(doc.ref);
        if (!v11n || !r || !passage.range) continue;
        const n = sharedVerses({ doc: passage.versification ?? v11n, range: passage.range }, { doc: v11n, range: r });
        const pick = { id: guideId(s.key, doc.ref), hash: s.hash, shared: n, mine: doc.language === language, source: s };
        if (n > 0 && better(pick, best)) best = pick;
      } else if (doc.format === 'study@2') {
        const n = study2Fit(passage, doc, get);
        const pick = { id: guideId(s.key, doc.ref ?? 'guide'), hash: s.hash, shared: n, mine: doc.language === language, source: s };
        if (n > 0 && better(pick, best)) best = pick;
      }
    }
    if (best) return { id: best.id, hash: best.hash, shared: best.shared, source: best.source };
  }
  return null;
}

/** What a glossary link shows: the guide's own glossary entry, or the resource's description of the term. */
export function glossaryEntryOf(guide: StudyGuide, ref: string): GlossaryEntry | null {
  const r = guide.resources.find((x) => x.ref === ref && x.kind === 'term');
  if (!r) return null;
  return guide.glossary?.[ref] ?? { term: r.title, ...(r.description ? { hint: r.description } : {}) };
}
