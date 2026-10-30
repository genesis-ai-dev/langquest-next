// The Bibles Find your Bible lists (decision 80), in the order a team sees
// them: the app's own, checked by hand, and Bible Brain's that the survey of
// their text numbered (decision 198). Loaded with that page only
// (NumberingStep.tsx), not with the web app's first visit (decision 123).
// Pure, so it is tested.
import { sameLanguage } from '../reference/languageCodesModel';
import { KNOWN_BIBLES } from './numberingBibles';
import type { KnownBible, NumberingCode } from './numberingGuide';

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

/** The numberings a surveyed Bible can have (bibleNumberings.ts never holds another). */
const SURVEYED: ReadonlySet<string> = new Set<NumberingCode>(['eng', 'org', 'vul', 'rsc', 'rso']);

/**
 * A Bible Brain Bible as Find your Bible lists it (decision 198): by its
 * name in its own language when it has one, with the numbering the survey
 * of its text found; null when the survey found none.
 */
export function bibleBrainBible(b: { bibleId: string; name: string; vname?: string; language: string; languageName: string; numbering?: string }): KnownBible | null {
  if (!b.numbering || !SURVEYED.has(b.numbering)) return null;
  return { name: b.vname || b.name, abbr: b.bibleId, language: b.languageName, iso: b.language, numbering: b.numbering as NumberingCode, checked: true };
}

/** Bible Brain Bibles as Find your Bible lists them: the numbered ones, whole Bibles before a testament alone. */
export function bibleBrainBibles(list: readonly (Parameters<typeof bibleBrainBible>[0] & { text?: { OT?: string; NT?: string } })[]): KnownBible[] {
  const whole = (b: (typeof list)[number]) => (b.text?.OT && b.text.NT ? 0 : 1);
  return [...list].sort((a, b) => whole(a) - whole(b)).map(bibleBrainBible).filter((b): b is KnownBible => !!b);
}

/** One of the app's Bibles and a Bible Brain one are the same: the KJV and ENGKJV in English, or the same name. */
function sameBible(known: KnownBible, brain: KnownBible): boolean {
  const abbr = brain.abbr.length > 3 ? brain.abbr.slice(3) : brain.abbr;
  return (known.abbr.toUpperCase() === abbr.toUpperCase() && sameLanguage(BIBLE_LANGUAGE_CODES[known.language], brain.iso))
    || known.name.toLowerCase() === brain.name.toLowerCase();
}

/** The app's Bibles, then Bible Brain's that are not among them. */
export function withBibleBrain(known: readonly KnownBible[], brain: readonly KnownBible[]): KnownBible[] {
  return [...known, ...brain.filter((b) => !known.some((k) => sameBible(k, b)))];
}

/**
 * Shown before anything is typed: the Bibles in the team's languages, in
 * the team's order (a Hindi team sees the Hindi O.V. first), the app's own
 * before Bible Brain's (`brain`, a language with none in the app: Thai,
 * Burmese), then the ones many teams translate from.
 */
export function firstBibles(languages: readonly string[] = [], brain: readonly KnownBible[] = []): KnownBible[] {
  const inTeam = languages.flatMap((l) => withBibleBrain(
    KNOWN_BIBLES.filter((b) => sameLanguage(BIBLE_LANGUAGE_CODES[b.language], l)),
    brain.filter((b) => sameLanguage(b.iso, l))
  ).slice(0, PER_LANGUAGE));
  const common = COMMON_BIBLES.map((a) => KNOWN_BIBLES.find((b) => b.abbr === a)).filter((b): b is KnownBible => !!b);
  return [...new Set([...inTeam, ...common])];
}
