// The verses a version's parts cover (passage/versionParts.tsx).
import { partMarksFor, versesInChapter, type LanguageState, type TemplateDoc, type VersificationDoc } from '@langquest-next/core';
import { useCallback, useMemo } from 'react';
import type { Ctx } from '../shell/ctx';
import { useLibraryDocs } from '../library/useLibrary';
import { catalogVerses, unitCoordinates } from '../sources/model';
import { passageVerseKeys, readPartVerses, versesHeld } from '../recording/verseModel';

/** The passage's verses in order ("chapter:verse"), counted as the recorder counts them; empty for a unit with no verses. */
export function useVerseKeys(ctx: Ctx, unitId: string | undefined): string[] {
  const template = ctx.language.state?.template?.value.docHash;
  const { get } = useLibraryDocs(ctx.language.orgId, [template]);
  const doc = get<TemplateDoc>(template);
  const v11n = doc?.bible ? get<VersificationDoc>(doc.bible.versification) : null;
  return useMemo(() => {
    if (!unitId) return [];
    const versesIn = (b: string, c: number) => (v11n ? versesInChapter(v11n, b, c) : undefined) ?? catalogVerses(b, c);
    return passageVerseKeys(unitCoordinates(unitId, versesIn), versesIn);
  }, [unitId, v11n]);
}

/** Each part's verses, for parts of one passage. */
export function usePartVerses(ctx: Ctx, state: LanguageState | null | undefined, unitId: string | undefined, hashes: readonly string[]) {
  const verses = useVerseKeys(ctx, unitId);
  const rows = useMemo(() => (state && unitId ? readPartVerses(partMarksFor(state, unitId, hashes, verses), verses.length) : hashes.map(() => ({ label: null, same: false }))),
    [state, unitId, hashes, verses]);
  return { verses, rows, numbered: rows.some((r) => r.label) };
}

/** "Verses 1–4" for a list of parts, or null when none has a verse. */
export function useVersesHeld(ctx: Ctx, state: LanguageState | null | undefined, unitId: string | undefined): (hashes: readonly string[]) => string | null {
  const verses = useVerseKeys(ctx, unitId);
  return useCallback((hashes) => (state && unitId ? versesHeld(partMarksFor(state, unitId, hashes, verses), verses) : null), [state, unitId, verses]);
}
