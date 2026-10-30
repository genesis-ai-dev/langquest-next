// The Bibles Find your Bible lists (decision 80), in the order a team sees
// them. Loaded with that page only (NumberingStep.tsx), not with the web
// app's first visit (decision 123). Pure, so it is tested.
import { sameLanguage } from '../reference/languageCodesModel';
import { KNOWN_BIBLES } from './numberingBibles';
import type { KnownBible } from './numberingGuide';

/** Shown before anything is typed: Bibles many teams translate from. */
export const COMMON_BIBLES = ['NIV', 'KJV', 'RVR1960', 'LSG', 'RUSSYN'];

export { KNOWN_BIBLES };

/** A listed Bible's language as material writes it ("hin"), by the English name the list keeps. */
const BIBLE_LANGUAGE_CODES: Record<string, string> = {
  English: 'eng', Spanish: 'spa', French: 'fra', Portuguese: 'por', Swahili: 'swa', Arabic: 'arb', Amharic: 'amh', Hindi: 'hin',
  Indonesian: 'ind', Chinese: 'cmn', German: 'deu', Russian: 'rus', Greek: 'ell', Latin: 'lat', Hebrew: 'heb', Korean: 'kor'
};

/** How many of one language's Bibles come before the common ones. */
const PER_LANGUAGE = 3;

/**
 * Shown before anything is typed: the Bibles in the team's languages, in
 * the team's order (a Hindi team sees the Hindi O.V. first), then the ones
 * many teams translate from.
 */
export function firstBibles(languages: readonly string[] = []): KnownBible[] {
  const inTeam = languages.flatMap((l) => KNOWN_BIBLES.filter((b) => sameLanguage(BIBLE_LANGUAGE_CODES[b.language], l)).slice(0, PER_LANGUAGE));
  const common = COMMON_BIBLES.map((a) => KNOWN_BIBLES.find((b) => b.abbr === a)).filter((b): b is KnownBible => !!b);
  return [...new Set([...inTeam, ...common])];
}
