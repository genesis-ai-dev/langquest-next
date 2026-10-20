// A passage's translation helps from the library, for screens to follow
// (libraryHelpsModel.ts): the sets it is offered, then only the parts of
// them its book and chapters need, and the chosen Bible's alignment of that
// book, each fetched by its hash when the passage is open (docStore.ts).
import { checkHelps, libraryItemView, type ContentsDoc, type LibraryDoc, type SourceDoc, type SourcedQuestion } from '@langquest-next/core';
import { useMemo } from 'react';
import type { Ctx } from '../shell/ctx';
import { useLibraryDocs } from '../library/useLibrary';
import { teamLanguages } from '../reference/languages';
import { offeredGuideSources } from '../reference/offered';
import {
  alignmentHash, helpsPassage, linkedQuestions, offeredHelps, partsFor, passageKeyWords, passageNotes, passagePlace, usesTemplate,
  type NoteGroup, type OfferedHelps, type PassageKeyWord
} from './libraryHelpsModel';

export interface LibraryHelps {
  sets: OfferedHelps;
  notes: NoteGroup[];
  keyWords: PassageKeyWord[];
  /** The chosen Bible's alignment of the passage's book, when it has one and it is here. */
  alignment: ReturnType<typeof alignmentOf>;
  /** Every document fetched for the passage, by hash. */
  get: (hash: string | null | undefined) => LibraryDoc | null;
  /** Documents the passage needs are still on their way. */
  loading: boolean;
}

const alignmentOf = (doc: LibraryDoc | null) => (doc?.format === 'alignment@1' ? doc : null);

/** The sets a passage is offered (and `extra` items first, a check's helps), and where the passage is for them. */
function useOffered(ctx: Ctx, unitId: string | null | undefined, extra: readonly string[] = NONE) {
  const state = ctx.language.state;
  const library = ctx.org.state?.library;
  const groups = useMemo(() => {
    if (!unitId || !state) return { recommended: [], own: [] };
    const o = offeredGuideSources(library ?? {}, ctx.org.state?.recommendations, state, unitId);
    const first = extra.flatMap((itemId) => { const h = libraryItemView(library ?? {}, itemId)?.current; return h ? [{ key: itemId, hash: h }] : []; });
    return { recommended: [...first, ...o.recommended.filter((s) => !extra.includes(s.key))], own: o.own };
  }, [library, ctx.org.state, state, unitId, extra]);
  const reads = useMemo(() => teamLanguages(ctx.org.state, state, ctx.language.languageId), [ctx.org.state, state, ctx.language.languageId]);
  const hashes = useMemo(() => [...groups.recommended, ...groups.own].map((s) => s.hash), [groups]);
  const index = useLibraryDocs(ctx.language.orgId, unitId ? [...hashes, state?.template?.value?.docHash] : []);
  const sets = useMemo(() => offeredHelps(groups, index.get, reads), [groups, index.get, reads]);
  const passage = useMemo(() => {
    if (!state || !unitId) return null;
    // An outline template that a set of story helps is placed on: the passage is its story.
    const placedOn = [...sets.notes, ...sets.questions, ...sets.wordLinks].map((s) => s.doc.template).find(Boolean);
    const stories = !!placedOn && usesTemplate(state, library ?? {}, placedOn);
    return helpsPassage(state, unitId, index.get, stories);
  }, [state, unitId, sets, library, index.get]);
  return { sets, passage, index };
}

const NONE: readonly string[] = [];

/**
 * The passage's notes and key words from the library, and the Bible's
 * alignment of its book. `extra` items come first: a check's own helps.
 */
export function useLibraryHelps(ctx: Ctx, unitId: string | null | undefined, source?: SourceDoc | null, extra: readonly string[] = NONE): LibraryHelps {
  const { sets, passage, index } = useOffered(ctx, unitId, extra);
  const align = passage ? alignmentHash(source, passagePlace(passage).book) : undefined;
  const pieces = useMemo(() => (passage ? [...partsFor(passage, [...sets.notes, ...sets.wordLinks]), align] : []), [passage, sets, align]);
  const parts = useLibraryDocs(ctx.language.orgId, pieces, { deps: false });
  const get = parts.get;
  return useMemo(() => {
    const notes = passage ? passageNotes(passage, sets.notes, get) : [];
    const keyWords = passage ? passageKeyWords(passage, sets.wordLinks, sets.words, get) : [];
    const loading = pieces.some((h) => !!h && !get(h)) && !parts.error;
    return { sets, notes, keyWords, alignment: alignmentOf(get(align)), get, loading };
  }, [passage, sets, get, align, pieces, parts.error, index.revision]); // eslint-disable-line react-hooks/exhaustive-deps -- index.revision: the sets' own documents arriving
}

/**
 * The questions a check asks of a passage from the library sets linked to
 * it (decision 91, amended 2026-10-19): `questionsForKind` takes these.
 */
export function useCheckQuestions(ctx: Ctx, unitId: string | null | undefined, kindId: string | null | undefined): SourcedQuestion[] {
  const state = ctx.language.state;
  const library = ctx.org.state?.library;
  const linked = useMemo(() => {
    if (!state || !kindId) return [];
    return checkHelps(state, kindId).flatMap((h) => {
      if (!('itemId' in h)) return [];
      const it = libraryItemView(library ?? {}, h.itemId);
      return it?.current ? [{ itemId: h.itemId, hash: it.current }] : [];
    });
  }, [state, kindId, library]);
  const getLinked = useLibraryDocs(ctx.language.orgId, linked.map((l) => l.hash)).get;
  const { passage } = useOffered(ctx, unitId);
  const questionSets = useMemo(() => linked.map((l) => ({ itemId: l.itemId, doc: getLinked(l.hash) })), [linked, getLinked]);
  const pieces = useMemo(() => {
    if (!passage) return [];
    const sets = questionSets.flatMap((q) => (q.doc?.format === 'helps@1' ? [{ itemId: q.itemId, hash: '', doc: q.doc }] : []));
    return partsFor(passage, sets);
  }, [passage, questionSets]);
  const parts = useLibraryDocs(ctx.language.orgId, pieces, { deps: false });
  return useMemo(() => linkedQuestions(passage, questionSets, parts.get), [passage, questionSets, parts.get]);
}

/** One article's document, fetched when it is opened. */
export function useArticle(ctx: Ctx, hash: string | null | undefined) {
  const docs = useLibraryDocs(ctx.language.orgId, hash ? [hash] : [], { deps: false });
  const doc = docs.get(hash);
  return { doc: doc?.format === 'material@1' ? doc : null, error: docs.error };
}

/** The contents sets a passage's links may open: the manual's articles and the key words. */
export type ArticleSets = { academy: { itemId: string; hash: string; doc: ContentsDoc }[]; words: { itemId: string; hash: string; doc: ContentsDoc }[] };
