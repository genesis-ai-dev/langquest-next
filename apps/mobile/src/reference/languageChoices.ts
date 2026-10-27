// The languages a team's reference material can be in, and what is there in
// each (decision 84): a guide set's passages (FIA), a key-word list's words
// (decision 172), Bibles and other guides,
// from the organization's library and what other organizations share, and
// Bible Brain's Bibles beside the library's (`biblesFor`). The
// reference language page lists them so an admin sees, before choosing,
// whether their team will have anything to read. Pure, so it is tested.
import type { LibraryDoc } from '@langquest-next/core';
import { isWordSet, type GuideSet, type SetMember } from './guideSets';
import { docLanguage, sameCodes, sameLanguage } from './languages';

export interface LanguageChoice {
  /** ISO 639-3 (or a glottocode for a language searched for). */
  language: string;
  /** Each guide set in this language, with its passages. */
  sets: { name: string; passages: number }[];
  /** Each set of key-word lists in this language (FIA's key words), with its words. */
  words: { name: string; words: number }[];
  bibles: number;
  /** The Bible Brain editions among `bibles`, by id: each is counted once, here and beside Bible Brain's own. */
  bibleIds: string[];
  /** Study guides and notes outside a set. */
  other: number;
}

const blank = (language: string): LanguageChoice => ({ language, sets: [], words: [], bibles: 0, bibleIds: [], other: 0 });
const amount = (c: LanguageChoice) => c.sets.reduce((n, s) => n + s.passages, 0) * 10 + c.bibles * 5 + c.words.length + c.other;

/**
 * One choice per language anything is in, the most to read first; `keep`
 * (the language chosen now, the reader's, English) are listed even with
 * nothing in them, after the rest. `docs` are the documents of everything
 * outside the sets, Bibles and guides alike.
 */
export function languageChoices(sets: readonly GuideSet[], docs: readonly (LibraryDoc | null)[], keep: readonly string[]): LanguageChoice[] {
  const out: LanguageChoice[] = [];
  const at = (language: string) => {
    let c = out.find((x) => sameLanguage(x.language, language));
    if (!c) { c = blank(language); out.push(c); }
    return c;
  };
  for (const set of sets) {
    for (const m of set.members) {
      if (isWordSet(set)) at(m.language).words.push({ name: set.name, words: m.passages });
      else at(m.language).sets.push({ name: set.name, passages: m.passages });
    }
  }
  for (const doc of docs) {
    const language = docLanguage(doc);
    if (!doc || !language) continue;
    if (doc.format === 'source@1') {
      const c = at(language);
      if (doc.provider.kind === 'biblebrain') {
        // The organization's own copy of a Bible LangQuest shares too is one Bible.
        if (c.bibleIds.includes(doc.provider.bibleId)) continue;
        c.bibleIds.push(doc.provider.bibleId);
      }
      c.bibles++;
    } else if (doc.format !== 'material@1' || doc.kind !== 'questions') at(language).other++;
  }
  const sorted = out.sort((a, b) => amount(b) - amount(a) || a.language.localeCompare(b.language));
  for (const language of keep) if (language && !sorted.some((c) => sameLanguage(c.language, language))) sorted.push(blank(language));
  return sorted;
}

/**
 * Every Bible a team could read in this language: the library's, and Bible
 * Brain's that the library does not have, so the number is what Add a Bible
 * opens. `bibleBrain` holds Bible Brain's Bibles by id for each code it has
 * answered (`swh` for Swahili written `swa`); until it answers, the
 * library's alone.
 */
export function biblesFor(c: LanguageChoice, bibleBrain: ReadonlyMap<string, readonly string[]>): number {
  const more = new Set(sameCodes(c.language).flatMap((code) => bibleBrain.get(code) ?? []));
  for (const id of c.bibleIds) more.delete(id);
  return c.bibles + more.size;
}

/** Does anything wait in this language? */
export const hasMaterial = (c: LanguageChoice | undefined) => !!c && (c.sets.length > 0 || c.words.length > 0 || c.bibles > 0 || c.other > 0);

/** The language to start from: the reader's when there is anything in it, else English. */
export function startingLanguage(choices: readonly LanguageChoice[], reader: string): string {
  return hasMaterial(choices.find((c) => sameLanguage(c.language, reader))) ? reader : 'eng';
}

/** A set's member in a language, if the set has one. */
export function memberIn(set: GuideSet, language: string): SetMember | null {
  return set.members.find((m) => sameLanguage(m.language, language)) ?? null;
}
