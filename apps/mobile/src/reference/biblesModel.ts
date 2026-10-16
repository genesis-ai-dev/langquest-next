// What the Bibles screen and its Add a Bible sheet decide (screens/reference.tsx;
// docs/reference-material.md): which Bibles sit under Recommended, Hidden and
// Not recommended, which of LangQuest's ready sources can still be added, how
// a Bible Brain search result reads, and which language a search settles on.
// Pure: no React, so it is tested.
import type { LanguageState, LibraryDoc, LibraryItemView, Register } from '@langquest-next/core';
import { t } from '../i18n';
import type { BibleLanguage, BibleSummary } from '../sources/bibleBrain';
import type { SharedItem } from '../library/model';
import { recState, type Level, type RefKind } from './model';

/** A list of short things ("GEN, EXO"), with the language's separator. */
export const list = (items: string[]) => items.join(t('reference.listSeparator'));

/** Where a source comes from, for its line: Bible Brain or the library. */
export const providerName = (kind: 'library' | 'biblebrain') => (kind === 'biblebrain' ? t('reference.provider.bibleBrain') : t('reference.provider.library'));

interface SourceRow { it: { itemId: string; archived: boolean }; doc: LibraryDoc | null; kind: RefKind | null }

/**
 * The Bibles under their three headings at this level: recommended (the
 * organization's or the language's say counts), hidden for this language, and
 * the rest. `loading` is true while any row's document has not arrived.
 */
export function splitBibles<R extends SourceRow>(
  rows: R[], orgRecs: Record<string, Register<boolean>> | undefined, state: LanguageState | null, level: Level
) {
  const sources = rows.filter((r) => r.kind === 'source' && !r.it.archived);
  const withRec = sources.map((r) => ({ r, s: recState(orgRecs, state, level, r.it.itemId) }));
  return {
    loading: rows.some((r) => r.doc === null),
    on: withRec.filter((x) => x.s.effective),
    hidden: withRec.filter((x) => !x.s.effective && x.s.language === 'hidden'),
    off: withRec.filter((x) => !x.s.effective && x.s.language !== 'hidden')
  };
}

/** The Bible Brain ids among these rows, sorted and comma-joined: a stable key for asking each one's detail once. */
export function bibleBrainIds(rows: { doc: LibraryDoc | null }[]): string {
  return rows.flatMap((r) => (r.doc?.format === 'source@1' && r.doc.provider.kind === 'biblebrain' ? [r.doc.provider.bibleId] : [])).sort().join(',');
}

/** LangQuest's ready sources this library has not followed yet (an active subscription hides one). */
export function readySources(
  shared: SharedItem[], docs: { get(hash: string): LibraryDoc | null | undefined },
  followed: readonly Pick<LibraryItemView, 'subscription'>[]
): SharedItem[] {
  return shared.filter((s) => docs.get(s.latest_hash)?.format === 'source@1')
    .filter((s) => !followed.some((it) => it.subscription?.sourceItemId === s.item_id && it.subscription.sourceOrgId === s.org_id && it.subscription.active));
}

/**
 * The language a Bible Brain search settles on: the one the person has
 * chosen while it is still among the results, else the result whose code is
 * what they typed, else the first.
 */
export function settledLanguage(found: readonly BibleLanguage[], needle: string, current: string | null): string | null {
  const exact = found.find((l) => l.code === needle.toLowerCase()) ?? found[0];
  return current && found.some((l) => l.code === current) ? current : exact?.code ?? null;
}

/** The description a Bible Brain source is published with, stored in the organization's library (its event log), not shown through `t`. */
export function bibleBrainDescription(languageName: string): string {
  // i18n-ignore: the item's description is stored in the organization's library (its event log)
  return `Bible Brain · ${languageName}`;
}

/** "Text OT NT · audio NT · FCBH timings" for a search result. */
export function bibleLine(b: BibleSummary): string {
  const text = b.text.OT && b.text.NT ? t('reference.media.textOTNT') : b.text.OT ? t('reference.media.textOT') : b.text.NT ? t('reference.media.textNT') : t('reference.media.noText');
  const hasAudio = !!(b.audio.OT || b.audio.NT);
  const audio = b.audio.OT && b.audio.NT ? t('reference.media.audioOTNT') : b.audio.OT ? t('reference.media.audioOT') : b.audio.NT ? t('reference.media.audioNT') : t('reference.media.noAudio');
  const timed = (b.timestamps.OT && b.audio.OT) || (b.timestamps.NT && b.audio.NT);
  return [text, audio, hasAudio ? (timed ? t('reference.media.fcbhTimings') : t('reference.media.noTimings')) : ''].filter(Boolean).join(' · ');
}
