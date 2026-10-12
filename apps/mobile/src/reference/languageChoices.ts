// The languages a team's reference material can be in, and what is there in
// each (decision 84): a guide set's passages (FIA), Bibles and other guides,
// from the organization's library and what other organizations share. The
// reference language page lists them so an admin sees, before choosing,
// whether their team will have anything to read. Pure, so it is tested.
import type { LibraryDoc } from '@langquest-next/core';
import type { GuideSet, SetMember } from './guideSets';
import { docLanguage, sameLanguage } from './languages';

export interface LanguageChoice {
  /** ISO 639-3 (or a glottocode for a language searched for). */
  language: string;
  /** Each guide set in this language, with its passages. */
  sets: { name: string; passages: number }[];
  bibles: number;
  /** Study guides and notes outside a set. */
  other: number;
}

const blank = (language: string): LanguageChoice => ({ language, sets: [], bibles: 0, other: 0 });
const amount = (c: LanguageChoice) => c.sets.reduce((n, s) => n + s.passages, 0) * 10 + c.bibles * 5 + c.other;

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
  for (const set of sets) for (const m of set.members) at(m.language).sets.push({ name: set.name, passages: m.passages });
  for (const doc of docs) {
    const language = docLanguage(doc);
    if (!doc || !language) continue;
    if (doc.format === 'source@1') at(language).bibles++;
    else if (doc.format !== 'material@1' || doc.kind !== 'questions') at(language).other++;
  }
  const sorted = out.sort((a, b) => amount(b) - amount(a) || a.language.localeCompare(b.language));
  for (const language of keep) if (language && !sorted.some((c) => sameLanguage(c.language, language))) sorted.push(blank(language));
  return sorted;
}

/** Does anything wait in this language? */
export const hasMaterial = (c: LanguageChoice | undefined) => !!c && (c.sets.length > 0 || c.bibles > 0 || c.other > 0);

/** The language to start from: the reader's when there is anything in it, else English. */
export function startingLanguage(choices: readonly LanguageChoice[], reader: string): string {
  return hasMaterial(choices.find((c) => sameLanguage(c.language, reader))) ? reader : 'eng';
}

/** A set's member in a language, if the set has one. */
export function memberIn(set: GuideSet, language: string): SetMember | null {
  return set.members.find((m) => sameLanguage(m.language, language)) ?? null;
}
