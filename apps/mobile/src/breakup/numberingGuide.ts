// Finding a Bible's numbering without the word "versification" (decision 80;
// the versification research of 2026-10-08, the prototype's round 1): Bibles
// checked against their own text, and a short quiz. A result is a source
// numbering code (eng, org, lxx, vul, rsc, rso), or "custom" for a Bible that
// mixes them (with the nearest). Read by NumberingStep.

import { bookName } from '../coreText';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';

export type NumberingCode = 'eng' | 'org' | 'lxx' | 'vul' | 'rsc' | 'rso' | 'custom' | 'unknown';

export interface KnownBible {
  name: string;
  abbr: string;
  language: string;
  numbering: NumberingCode;
  nearest?: NumberingCode;
  /** Checked against its text (BibleGateway, bible.com, eBible). */
  checked: boolean;
  /** For a mix: how it differs, in plain words. */
  note?: string;
}

export interface QuizOption { label: string; /** A big button's face: "23", "Yes". */ tile?: string; next?: string; to?: NumberingCode }
export interface QuizQuestion {
  title: string;
  /** Words to find in the Bible, shown large. */
  quote?: string;
  small?: string;
  /** Drawn above the answers: Psalm 3's top lines, or the extra books. */
  picture?: 'psalm3' | 'extraBooks';
  options: QuizOption[];
  notSure?: QuizOption;
}


/**
 * What a found Bible or a quiz answer means: the numbering, or the nearest one
 * LangQuest offers, with a note when it is only near or nothing fits.
 */
export function resolveNumbering(code: NumberingCode, nearest: NumberingCode | undefined, offered: readonly string[]): { code: string | null; note?: string } {
  const has = (c: string | undefined) => !!c && offered.includes(c);
  if (has(code)) return { code };
  if (code === 'custom' && has(nearest)) return { code: nearest!, note: t('breakup.numberingStep.notes.mixes') };
  if (code === 'lxx' || (code === 'custom' && nearest === 'lxx')) return { code: null, note: t('breakup.numberingStep.notes.notOffered') };
  return { code: null, note: t('breakup.numberingStep.notes.notSure') };
}

/** Shown before anything is typed: Bibles many teams translate from. */
export const COMMON_BIBLES = ['NIV', 'KJV', 'RVR1960', 'LSG', 'RUSSYN'];

export { KNOWN_BIBLES } from './numberingBibles';

/**
 * The quiz, one question a screen: a short title, something to look at (a
 * quote, a picture, big numbers), and the answers as big buttons. Answers
 * lead to another question (`next`) or a numbering (`to`).
 */
export const QUIZ: { start: string; questions: Record<string, QuizQuestion> } = {
  start: 'psalm23',
  // The words are getters, read in the language showing when a question is drawn.
  questions: {
    psalm23: {
      get title() { return t('breakup.numberingStep.quiz.psalm23.title'); }, get quote() { return t('breakup.numberingStep.quiz.psalm23.quote'); },
      options: [psalmOption(23, { next: 'psalm_heading' }), psalmOption(22, { next: 'malachi_greek' })],
      notSure: notSure({ next: 'tradition' })
    },
    psalm_heading: {
      get title() { return t('breakup.numberingStep.quiz.psalmHeading.title'); }, picture: 'psalm3',
      options: [{ get label() { return t('breakup.numberingStep.quiz.psalmHeading.noNumber'); }, to: 'eng' }, { get label() { return t('breakup.numberingStep.quiz.psalmHeading.verseOne'); }, next: 'malachi_hebrew' }],
      notSure: notSure({ next: 'malachi_hebrew' })
    },
    malachi_hebrew: {
      get title() { return malachiTitle(); }, get small() { return t('breakup.numberingStep.quiz.malachi.small'); },
      options: [chaptersOption(3, { to: 'org' }), chaptersOption(4, { to: 'custom' })],
      notSure: notSure({ to: 'org' })
    },
    malachi_greek: {
      get title() { return malachiTitle(); }, get small() { return t('breakup.numberingStep.quiz.malachi.small'); },
      options: [chaptersOption(3, { to: 'lxx' }), chaptersOption(4, { next: 'romans16' })],
      notSure: notSure({ next: 'romans16' })
    },
    romans16: {
      get title() { return t('breakup.numberingStep.quiz.romans16.title', { book: bookName('rom') }); },
      options: [verseOption(27, { to: 'vul' }), verseOption(24, { next: 'extra_books_russian' })],
      notSure: notSure({ next: 'tradition_greek' })
    },
    extra_books_russian: {
      get title() { return t('breakup.numberingStep.quiz.extraBooks.title'); }, picture: 'extraBooks',
      options: [
        { get label() { return t('common.yes'); }, get tile() { return t('common.yes'); }, to: 'rso' },
        { get label() { return t('common.no'); }, get tile() { return t('common.no'); }, to: 'rsc' }
      ],
      notSure: notSure({ to: 'rsc' })
    },
    tradition_greek: {
      get title() { return t('breakup.numberingStep.quiz.church.title'); },
      options: [church('slavic', { next: 'extra_books_russian' }), church('greek', { to: 'lxx' }), church('catholic', { to: 'vul' })],
      notSure: notSure({ to: 'lxx' })
    },
    tradition: {
      get title() { return t('breakup.numberingStep.quiz.church.title'); },
      options: [
        church('protestant', { to: 'eng' }), church('catholic', { to: 'eng' }), church('slavicOrthodox', { to: 'rso' }),
        church('greek', { to: 'lxx' }), church('ethiopian', { to: 'custom' }), church('jewish', { to: 'org' })
      ],
      notSure: notSure({ to: 'eng' })
    }
  }
};

type Lead = Pick<QuizOption, 'next' | 'to'>;
function notSure(lead: Lead): QuizOption {
  return { get label() { return t('breakup.numberingStep.quiz.notSure'); }, ...lead };
}
function psalmOption(n: number, lead: Lead): QuizOption {
  return { get label() { return t('breakup.numberingStep.quiz.psalm23.psalm', { book: bookName('psa'), n: formatNumber(n) }); }, get tile() { return formatNumber(n); }, ...lead };
}
function chaptersOption(n: number, lead: Lead): QuizOption {
  return { get label() { return t('breakup.numberingStep.facts.chapters', { count: n }); }, get tile() { return formatNumber(n); }, ...lead };
}
function verseOption(n: number, lead: Lead): QuizOption {
  return { get label() { return t('breakup.numberingStep.quiz.romans16.verse', { n: formatNumber(n) }); }, get tile() { return formatNumber(n); }, ...lead };
}
function church(which: 'slavic' | 'greek' | 'catholic' | 'protestant' | 'slavicOrthodox' | 'ethiopian' | 'jewish', lead: Lead): QuizOption {
  return { get label() { return t(`breakup.numberingStep.quiz.church.${which}`); }, ...lead };
}
function malachiTitle(): string {
  return t('breakup.numberingStep.quiz.malachi.title', { book: bookName('mal') });
}

/** A listed Bible's language, in the language showing (the list keeps the English name as its id). */
export function bibleLanguage(english: string): string {
  switch (english) {
    case 'English': return t('uiLanguage.names.en');
    case 'Spanish': return t('uiLanguage.names.es');
    case 'French': return t('uiLanguage.names.fr');
    case 'Portuguese': return t('breakup.numberingStep.bibleLanguages.portuguese');
    case 'Swahili': return t('uiLanguage.names.sw');
    case 'Arabic': return t('uiLanguage.names.ar');
    case 'Amharic': return t('uiLanguage.names.am');
    case 'Hindi': return t('uiLanguage.names.hi');
    case 'Indonesian': return t('uiLanguage.names.id');
    case 'Chinese': return t('breakup.numberingStep.bibleLanguages.chinese');
    case 'German': return t('breakup.numberingStep.bibleLanguages.german');
    case 'Russian': return t('breakup.numberingStep.bibleLanguages.russian');
    case 'Greek': return t('breakup.numberingStep.bibleLanguages.greek');
    case 'Latin': return t('breakup.numberingStep.bibleLanguages.latin');
    case 'Hebrew': return t('breakup.numberingStep.bibleLanguages.hebrew');
    case 'Korean': return t('breakup.numberingStep.bibleLanguages.korean');
    default: return english;
  }
}

/** What tells the numberings apart at a glance, read from the numbering itself. */
export interface NumberingFacts {
  books: number;
  /** Malachi's chapters: 4 in English Bibles, 3 in the Hebrew. */
  malachi: number;
  /** Whether a psalm's heading is verse 1 (Psalm 3 has 9 verses, not 8). */
  headings: boolean;
}

export function factsOf(doc: { maxVerses: Record<string, number[]> } | null | undefined): NumberingFacts | null {
  if (!doc) return null;
  return {
    books: Object.keys(doc.maxVerses).length,
    malachi: doc.maxVerses['MAL']?.length ?? 0,
    headings: (doc.maxVerses['PSA']?.[2] ?? 0) > 8
  };
}

/** "Russian Synodal · 77 books (Orthodox)" -> "Russian Synodal (Orthodox)": the books are shown beside it. */
export const shortName = (name: string) => name.replace(/ · \d+ books/, '');
