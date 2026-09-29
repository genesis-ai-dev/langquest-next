// Which study guide belongs to a passage (ADR-018, STUDY-1, docs/library.md).
// Guides are library material: a collection (FIA in one language) or a single
// guide, each numbered in its own versification. A passage's verses come from
// its unit id (library templates) or its label (older units), read in its
// template's versification. The two meet through org (core versification.ts),
// so guides numbered in English land on passages a team numbers another way.
// Pure: documents in, a choice out.
import {
  libraryUnitRange, parseRef, sharedVerses, studyEntriesFor, usfmOf, versesInChapter,
  type CollectionDoc, type LibraryDoc, type ProjectState, type StudyDoc, type TemplateDoc, type VerseRange, type VersificationDoc
} from '@langquest-next/core';
import type { GlossaryEntry, StudyGuide } from './guides';
import { unitRange } from './range';

/** A document that may hold guides: an item this organization has, or one another shares. `key` names it in guide ids. */
export interface GuideSource {
  key: string;
  hash: string;
}

type Get = (hash: string | null | undefined) => LibraryDoc | null;

/** A library study document as the app's guide. The id is stable across versions: notes and finished steps keep their place. */
export function guideFromDoc(id: string, doc: StudyDoc): StudyGuide {
  return {
    id,
    pattern: doc.pattern,
    about: doc.about,
    source: doc.source,
    passage: doc.title,
    steps: doc.steps.map((s) => ({
      id: s.id, title: s.title, ...(s.phase ? { phase: s.phase } : {}), purpose: s.purpose ?? '', text: s.text,
      audio: { ...(s.audio?.url ? { url: s.audio.url } : {}), seconds: s.audio?.seconds ?? Math.max(30, Math.round(s.text.length / 15)) }
    })),
    resources: doc.resources.map((r) => ({
      ref: r.ref, kind: r.kind, title: r.title, ...(r.description ? { description: r.description } : {}),
      ...(r.media ? { media: r.media.map((m) => ({ id: m.id, kind: m.kind, title: m.title, caption: m.caption, ...(m.url ? { url: m.url } : {}) })) } : {})
    })),
    glossary: Object.fromEntries(doc.terms.map((t) => [t.id, { term: t.term, ...(t.hint ? { hint: t.hint } : {}), body: t.body, ...(t.audioUrl ? { audioUrl: t.audioUrl } : {}) }]))
  };
}

/** A guide id from where it lives; never ':' (study mark keys are ':'-separated). */
export const guideId = (source: string, ref: string) => `${source}~${ref}`.replace(/[:\s]/g, '.');

/** The passage's verses and the versification they are in (null when its template names none). */
export function passageVerses(state: ProjectState, unitId: string, laneId: string | null, get: Get): { range: VerseRange; versification: VersificationDoc | null } | null {
  const sel = laneId ? state.laneTemplates[laneId]?.value : undefined;
  const template = sel?.docHash ? (get(sel.docHash) as TemplateDoc | null) : null;
  const v11n = template?.bible ? (get(template.bible.versification) as VersificationDoc | null) : null;
  const lib = libraryUnitRange(unitId, v11n ? (b, c) => versesInChapter(v11n, b, c) : undefined);
  if (lib) return { range: lib, versification: v11n };
  // Older units: verses from the label (range.ts), the book as a USFM code.
  const old = unitRange(state, unitId);
  if (!old) return null;
  return { range: { book: usfmOf(old.book), start: old.start, end: { chapter: old.end.chapter, verse: old.end.verse ?? 999 } }, versification: null };
}

/**
 * The guide for a passage: the first group with any match wins (the
 * organization's own material before shared material), and within it a
 * guide in the reader's language before others (FIA in five languages all
 * cover the same passage), then the one sharing the most verses. Returns
 * the guide's document hash to load, or null. A passage without a
 * versification is read in each guide's own.
 */
export function bestGuide(
  passage: { range: VerseRange; versification: VersificationDoc | null },
  groups: GuideSource[][],
  get: Get,
  language = 'eng'
): { id: string; hash: string; shared: number } | null {
  type Pick = { id: string; hash: string; shared: number; mine: boolean };
  const better = (a: Pick, b: Pick | null) => !b || (a.mine !== b.mine ? a.mine : a.shared > b.shared);
  for (const group of groups) {
    let best: Pick | null = null;
    for (const s of group) {
      const doc = get(s.hash);
      if (!doc) continue;
      if (doc.format === 'collection@1') {
        const v11n = get(doc.versification) as VersificationDoc | null;
        if (!v11n) continue;
        const top = studyEntriesFor({ range: passage.range, versification: passage.versification ?? v11n }, { doc: doc as CollectionDoc, versification: v11n })[0];
        const pick = top ? { id: guideId(s.key, top.entry.ref), hash: top.entry.doc, shared: top.shared, mine: (doc as CollectionDoc).language === language } : null;
        if (pick && better(pick, best)) best = pick;
      } else if (doc.format === 'study@1') {
        const v11n = get(doc.versification) as VersificationDoc | null;
        const r = parseRef(doc.ref);
        if (!v11n || !r) continue;
        const n = sharedVerses({ doc: passage.versification ?? v11n, range: passage.range }, { doc: v11n, range: r });
        const pick = { id: guideId(s.key, doc.ref), hash: s.hash, shared: n, mine: doc.language === language };
        if (n > 0 && better(pick, best)) best = pick;
      }
    }
    if (best) return { id: best.id, hash: best.hash, shared: best.shared };
  }
  return null;
}

/** What a glossary link shows: the guide's own glossary entry, or the resource's description of the term. */
export function glossaryEntryOf(guide: StudyGuide, ref: string): GlossaryEntry | null {
  const r = guide.resources.find((x) => x.ref === ref && x.kind === 'term');
  if (!r) return null;
  return guide.glossary?.[ref] ?? { term: r.title, ...(r.description ? { hint: r.description } : {}) };
}
