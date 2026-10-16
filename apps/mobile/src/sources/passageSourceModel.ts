// What a source says of a passage, by where its text comes from (the carried
// Bible, a library source's book document, Bible Brain): whether it is still
// loading, why there is no text, whether its audio is not here, and its
// copyright. Pure, so it is tested (test/passageSourceModel.test.ts);
// `usePassageSource` gathers the documents and calls these.
import { t } from '../i18n';

/** The carried Bible's built-in source whose audio is read from the web. */
export const BUILTIN_AUDIO_ID = 'builtin.BSB';

/** What the carried Bibles say of a passage. */
export function builtinFacts(f: { rows: unknown; hasReading: boolean; audioChapters: number; linkDown: boolean }): { textProblem: string | null; audioNotHere: boolean } {
  // A chapter the bundle never carried still belongs to this Bible; offline, its audio was never cached (STUDY-036).
  const audioNotHere = !f.hasReading && f.linkDown && f.audioChapters > 0;
  return { textProblem: f.rows || audioNotHere ? null : t('sources.text.noPassageText'), audioNotHere };
}

/** The carried Bible's copyright: the Berean Standard Bible is also read aloud. */
export function builtinCopyright(itemId: string): { text: string; audio?: string } {
  return itemId === BUILTIN_AUDIO_ID ? { text: t('sources.text.publicDomain'), audio: t('sources.text.publicDomainRead') } : { text: t('sources.text.publicDomain') };
}

/** A library source: waiting for its book, or stopped waiting because offline it was never opened. */
export function libraryFacts(f: { bookHash: string | undefined; hasBook: boolean; booksFailed: boolean; rows: unknown }): { loading: boolean; audioNotHere: boolean; textProblem: string | null } {
  // Offline, a book that was never opened stops waiting. Its audio is not here; the Bible is.
  const bookMissing = !!f.bookHash && !f.hasBook && f.booksFailed;
  const loading = !!f.bookHash && !f.hasBook && !bookMissing;
  return {
    loading, audioNotHere: bookMissing,
    textProblem: loading || bookMissing ? null : f.rows ? null : f.bookHash ? t('sources.text.noTextInSource') : t('sources.text.noBookInSource')
  };
}

/** A Bible Brain source (in the library or explored outside it). */
export function bibleBrainFacts(f: { keyed: boolean; done: boolean; hasText: boolean; rows: unknown; problem: string | null | undefined }): { loading: boolean; textProblem: string | null } {
  const loading = f.keyed && !f.done && !f.rows;
  return { loading, textProblem: loading ? null : !f.hasText ? t('sources.text.noBookInBible') : f.rows ? null : f.problem ?? t('sources.text.noPassageText') };
}
