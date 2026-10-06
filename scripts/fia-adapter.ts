/**
 * FIA study material into library documents (docs/library.md).
 *
 * FIA (Familiarize, Internalize, Articulate, fia.bible) sends each pericope
 * as GraphQL JSON: per language, six step renderings of markdown with audio,
 * plus the pictures, map and Master Glossary terms the text links to
 * (`#m387`, `#c47`, `#t63`). `fiaStudyDoc` turns one of those into a
 * `study@1` document, with the same meaning the app gives it today
 * (`fiaGuideFromApi` and `fiaGlossaryFromApi` in apps/mobile/src/study/fia.ts):
 * the same step ids, phases and purposes, the smallest audio encoding, and
 * resources as media, then maps, then terms. FIA numbers verses as English
 * Bibles do, so every guide names the English versification.
 *
 * Pure: JSON in, document out. `scripts/library-seed.ts` reads the files.
 */
import { formatRef, usfmOf, withDeps, type StudyDoc, type StudyResourceDoc } from '@langquest-next/core';

/** FIA's licence and holder, as its Aquifer releases state them (github.com/BibleAquifer/FIATranslationGuide). */
export const FIA_ATTRIBUTION = '© 2025 Word Collective, CC BY-SA 4.0';

const FIA_ABOUT =
  'FIA takes the team through six steps for each passage, in audio and text, before anyone drafts: Familiarize, then Internalize, then Articulate. Each step asks you to listen to the passage again. Answers and notes the team adds stay with the passage, so reviewers can see the study behind the draft.';

/** FIA's steps by their API identifier; the ids are the app's, because study records point at them. */
export const FIA_STEPS: Record<string, { id: string; phase: string; purpose: string }> = {
  'hear-and-heart': { id: 'hear', phase: 'Familiarize', purpose: 'Hear the passage in more than one translation, then talk about it together.' },
  'setting-the-stage': { id: 'stage', phase: 'Familiarize', purpose: 'Where the passage sits in the bigger story, and its culture, history and places.' },
  'defining-the-scenes': { id: 'scenes', phase: 'Internalize', purpose: 'Frame the passage: its scenes, settings and people. Draw or build them.' },
  'embodying-the-text': { id: 'embody', phase: 'Internalize', purpose: 'Act the passage out twice: first straight through, then stopping to ask how people feel.' },
  'filling-the-gaps': { id: 'gaps', phase: 'Articulate', purpose: "The words to choose, with the key terms in FIA's Master Glossary." },
  'speaking-the-word': { id: 'speak', phase: 'Articulate', purpose: 'Tell it in your own language, together, until everyone agrees on a version.' }
};

/** About 140 words a minute, with room for the pauses FIA asks for (the app's estimate). */
const secondsFor = (words: number) => Math.round(words / 2.2);

// ---- the API's shape (only what is read) ------------------------------------------

type Edges<T> = { edges: { node: T }[] };
type ByLanguage = { language: { id: string; nameEnglish?: string } };

interface FiaPericopeJson {
  id: string;
  startChapter: number;
  startVerse: number;
  startPortion?: string | null;
  endChapter: number;
  endVerse: number;
  endPortion?: string | null;
  book: { id: string };
  pericopeTranslations: Edges<ByLanguage & {
    bookTranslation?: { title: string } | null;
    stepRenderings: Edges<{
      step: { uniqueIdentifier: string };
      stepTranslation: { title: string };
      /** Some queries ask only for the plain text; it reads as markdown too. */
      textAsMarkdown?: string | null;
      textPlain?: string | null;
      textWordCount: number;
      audioUrlVbr6?: string | null;
    }>;
  }>;
  mediaItems: Edges<{
    id: string;
    mediaItemTranslations: Edges<ByLanguage & { title: string; description: string | null }>;
    mediaAssets: Edges<{
      id: string;
      assetType: { id: string };
      attachment: { url500: string };
      mediaAssetTranslations: Edges<ByLanguage & { title: string; description: string | null }>;
    }>;
  }>;
  map: Edges<{ id: string; mapTranslations: Edges<ByLanguage & { title: string; imageUrl1500: string | null }> }>;
  terms: Edges<{
    id: string;
    termTranslations: Edges<ByLanguage & { translatedTerm: string; descriptionHint: string | null; textPlain: string | null; audioUrlVbr4?: string | null }>;
  }>;
}

/** The pericope in a file as the API returns it (`{ pericope }`), or the pericope itself. */
export function fiaPericope(json: unknown): FiaPericopeJson {
  const p = (json as { pericope?: unknown }).pericope ?? json;
  if (!p || typeof p !== 'object' || !('pericopeTranslations' in p)) throw new Error('not an FIA pericope');
  return p as FiaPericopeJson;
}

/**
 * The text in one language. Pictures, maps and terms are often translated
 * into fewer languages than the steps, so those fall back to English, then
 * to whatever there is (the app falls back to the first).
 */
const inLanguage = <T extends ByLanguage>(edges: Edges<T>, lang: string): T | undefined => {
  const nodes = edges.edges.map((e) => e.node);
  return nodes.find((n) => n.language.id === lang) ?? nodes.find((n) => n.language.id === 'eng') ?? nodes[0];
};

/** The languages a pericope's steps are rendered in, with their English names. */
export function fiaLanguages(json: unknown): { id: string; name: string }[] {
  return fiaPericope(json).pericopeTranslations.edges
    .filter(({ node }) => node.stepRenderings.edges.length > 0)
    .map(({ node }) => ({ id: node.language.id, name: node.language.nameEnglish ?? node.language.id }));
}

/** The pericope's range in English numbering, portions kept: "GEN 2:4-25", "JDG 5:1-11a". */
export function fiaRef(p: FiaPericopeJson): string {
  const book = usfmOf(p.book.id);
  const start = `${p.startChapter}:${p.startVerse}${p.startPortion ?? ''}`;
  const end = `${p.endVerse}${p.endPortion ?? ''}`;
  if (p.startChapter === p.endChapter && p.startVerse === p.endVerse && (p.startPortion ?? '') === (p.endPortion ?? '')) return `${book} ${start}`;
  return p.startChapter === p.endChapter ? `${book} ${start}-${end}` : `${book} ${start}-${p.endChapter}:${end}`;
}

/** "Genesis 2:4–25", in the language's own book name, as the app titles a guide. */
function fiaTitle(p: FiaPericopeJson, bookTitle: string): string {
  const range = formatRef({ book: '', start: { chapter: p.startChapter, verse: p.startVerse }, end: { chapter: p.endChapter, verse: p.endVerse } }).trim();
  return `${bookTitle} ${range.replace('-', '–')}`;
}

/**
 * One FIA pericope in one language as a `study@1` document, numbered in the
 * English versification (`englishVersification` is that document's hash).
 * Null when FIA has no steps for the pericope in that language.
 */
export function fiaStudyDoc(json: unknown, lang: string, englishVersification: string): StudyDoc | null {
  const p = fiaPericope(json);
  const rendering = p.pericopeTranslations.edges.map((e) => e.node).find((n) => n.language.id === lang);
  if (!rendering || rendering.stepRenderings.edges.length === 0) return null;
  const steps: StudyDoc['steps'] = rendering.stepRenderings.edges.map(({ node }) => {
    const info = FIA_STEPS[node.step.uniqueIdentifier];
    return {
      id: info?.id ?? node.step.uniqueIdentifier,
      title: node.stepTranslation.title,
      ...(info ? { phase: info.phase } : {}),
      purpose: info?.purpose ?? '',
      text: node.textAsMarkdown ?? node.textPlain ?? '',
      audio: { ...(node.audioUrlVbr6 ? { url: node.audioUrlVbr6 } : {}), seconds: secondsFor(node.textWordCount) }
    };
  });
  const media: StudyResourceDoc[] = p.mediaItems.edges.map(({ node }) => {
    const t = inLanguage(node.mediaItemTranslations, lang);
    return {
      ref: `m${node.id}`, kind: 'media', title: t?.title ?? 'Pictures', ...(t?.description ? { description: t.description } : {}),
      media: node.mediaAssets.edges.map(({ node: a }) => {
        const at = inLanguage(a.mediaAssetTranslations, lang);
        return { id: a.id, kind: a.assetType.id === 'video' ? 'video' : 'photo', title: at?.title ?? '', caption: at?.description ?? '', url: a.attachment.url500 };
      })
    };
  });
  const maps: StudyResourceDoc[] = p.map.edges.map(({ node }) => {
    const t = inLanguage(node.mapTranslations, lang);
    const title = t?.title ?? 'Map';
    return { ref: `c${node.id}`, kind: 'map', title, media: [{ id: `c${node.id}`, kind: 'map', title, caption: '', ...(t?.imageUrl1500 ? { url: t.imageUrl1500 } : {}) }] };
  });
  const termResources: StudyResourceDoc[] = [];
  const terms: StudyDoc['terms'] = [];
  for (const { node } of p.terms.edges) {
    const t = inLanguage(node.termTranslations, lang);
    termResources.push({ ref: `t${node.id}`, kind: 'term', title: t?.translatedTerm ?? '', ...(t?.descriptionHint ? { description: t.descriptionHint } : {}) });
    terms.push({
      id: `t${node.id}`,
      term: t?.translatedTerm ?? '',
      ...(t?.descriptionHint ? { hint: t.descriptionHint } : {}),
      body: t?.textPlain ?? '',
      ...(t?.audioUrlVbr4 ? { audioUrl: t.audioUrlVbr4 } : {})
    });
  }
  const languageName = rendering.language.nameEnglish ?? lang;
  return withDeps<StudyDoc>({
    format: 'study@1',
    title: fiaTitle(p, rendering.bookTranslation?.title ?? usfmOf(p.book.id)),
    pattern: 'FIA',
    about: FIA_ABOUT,
    // FIA is CC BY-SA 4.0 and asks for attribution; the source line is what readers see.
    source: `fia.bible · ${languageName} · ${FIA_ATTRIBUTION}`,
    language: lang,
    ref: fiaRef(p),
    versification: englishVersification,
    steps,
    resources: [...media, ...maps, ...termResources],
    terms,
    deps: []
  });
}
