// Finding a Bible's numbering without the word "versification" (decision 80;
// the versification research of 2026-10-08, the prototype's round 1): Bibles
// checked against their own text, and a short quiz. A result is a source
// numbering code (eng, org, lxx, vul, rsc, rso), or "custom" for a Bible that
// mixes them (with the nearest). Read by NumberingStep.

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

const NOT_OFFERED = 'The Greek Old Testament numbering is not offered yet. Choose the closest from the list.';

/**
 * What a found Bible or a quiz answer means: the numbering, or the nearest one
 * LangQuest offers, with a note when it is only near or nothing fits.
 */
export function resolveNumbering(code: NumberingCode, nearest: NumberingCode | undefined, offered: readonly string[]): { code: string | null; note?: string } {
  const has = (c: string | undefined) => !!c && offered.includes(c);
  if (has(code)) return { code };
  if (code === 'custom' && has(nearest)) return { code: nearest!, note: 'Your Bible mixes numberings. This is the closest.' };
  if (code === 'lxx' || (code === 'custom' && nearest === 'lxx')) return { code: null, note: NOT_OFFERED };
  return { code: null, note: 'Not sure? Choose from the list.' };
}

/** Shown before anything is typed: Bibles many teams translate from. */
export const COMMON_BIBLES = ['NIV', 'KJV', 'RVR1960', 'LSG', 'RUSSYN'];

export const KNOWN_BIBLES: KnownBible[] = [
 {
  "name": "King James Version",
  "abbr": "KJV",
  "language": "English",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "New International Version (2011)",
  "abbr": "NIV",
  "language": "English",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "English Standard Version",
  "abbr": "ESV",
  "language": "English",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "New Revised Standard Version",
  "abbr": "NRSV",
  "language": "English",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "NET Bible",
  "abbr": "NET",
  "language": "English",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "Revised Standard Version",
  "abbr": "RSV",
  "language": "English",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "Holman Christian Standard Bible",
  "abbr": "HCSB",
  "language": "English",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "New Living Translation",
  "abbr": "NLT",
  "language": "English",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "Russian Synodal",
  "abbr": "RUSSYN",
  "language": "Russian",
  "numbering": "rsc",
  "checked": true
 },
 {
  "name": "Russian Synodal with deuterocanon",
  "abbr": "RUSSYN-DC",
  "language": "Russian",
  "numbering": "rso",
  "checked": true
 },
 {
  "name": "Biblia Hebraica Stuttgartensia",
  "abbr": "BHS",
  "language": "Hebrew",
  "numbering": "org",
  "checked": true
 },
 {
  "name": "Nestle-Aland 28 / UBS Greek New Testament",
  "abbr": "NA28/UBS5",
  "language": "Greek",
  "numbering": "org",
  "checked": true
 },
 {
  "name": "Septuagint (Rahlfs)",
  "abbr": "LXX",
  "language": "Greek",
  "numbering": "lxx",
  "checked": true
 },
 {
  "name": "Stuttgart Vulgate",
  "abbr": "VUL83",
  "language": "Latin",
  "numbering": "vul",
  "checked": true
 },
 {
  "name": "Nova Vulgata",
  "abbr": "NVL98",
  "language": "Latin",
  "numbering": "custom",
  "nearest": "vul",
  "checked": true
 },
 {
  "name": "World English Bible",
  "abbr": "WEB",
  "language": "English",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "Berean Standard Bible",
  "abbr": "BSB",
  "language": "English",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "New King James Version",
  "abbr": "NKJV",
  "language": "English",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "New American Standard Bible",
  "abbr": "NASB",
  "language": "English",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "Good News Translation",
  "abbr": "GNT",
  "language": "English",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "Contemporary English Version",
  "abbr": "CEV",
  "language": "English",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "New American Bible Revised Edition",
  "abbr": "NABRE",
  "language": "English",
  "numbering": "org",
  "checked": true
 },
 {
  "name": "Christian Standard Bible",
  "abbr": "CSB",
  "language": "English",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "Lexham English Bible",
  "abbr": "LEB",
  "language": "English",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "Tree of Life Version",
  "abbr": "TLV",
  "language": "English",
  "numbering": "org",
  "checked": true
 },
 {
  "name": "Complete Jewish Bible",
  "abbr": "CJB",
  "language": "English",
  "numbering": "org",
  "checked": true
 },
 {
  "name": "New Jerusalem Bible",
  "abbr": "NJB",
  "language": "English",
  "numbering": "org",
  "checked": true
 },
 {
  "name": "Revised Standard Version, Catholic Edition",
  "abbr": "RSVCE",
  "language": "English",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "Douay-Rheims (Challoner)",
  "abbr": "DRA",
  "language": "English",
  "numbering": "vul",
  "checked": true
 },
 {
  "name": "Orthodox Study Bible",
  "abbr": "OSB",
  "language": "English",
  "numbering": "custom",
  "nearest": "lxx",
  "checked": true,
  "note": "The Orthodox Study Bible numbers the Old Testament like the Greek Old Testament and the New Testament like English Bibles."
 },
 {
  "name": "Reina-Valera 1960",
  "abbr": "RVR1960",
  "language": "Spanish",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "Nueva Versión Internacional",
  "abbr": "NVI",
  "language": "Spanish",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "Dios Habla Hoy",
  "abbr": "DHH",
  "language": "Spanish",
  "numbering": "custom",
  "nearest": "eng",
  "checked": true,
  "note": "Dios Habla Hoy numbers the Old Testament like English Bibles and the New Testament like the Greek."
 },
 {
  "name": "Louis Segond 1910",
  "abbr": "LSG",
  "language": "French",
  "numbering": "custom",
  "nearest": "eng",
  "checked": true,
  "note": "Louis Segond breaks chapters like English Bibles, but counts Psalm headings as verses and numbers the New Testament like the Greek."
 },
 {
  "name": "Bible du Semeur",
  "abbr": "BDS",
  "language": "French",
  "numbering": "org",
  "checked": true
 },
 {
  "name": "Traduction Œcuménique de la Bible",
  "abbr": "TOB",
  "language": "French",
  "numbering": "org",
  "checked": false
 },
 {
  "name": "Lutherbibel 2017",
  "abbr": "LUT17",
  "language": "German",
  "numbering": "org",
  "checked": true
 },
 {
  "name": "Elberfelder 2006",
  "abbr": "ELB",
  "language": "German",
  "numbering": "org",
  "checked": true
 },
 {
  "name": "Einheitsübersetzung 2016",
  "abbr": "EU",
  "language": "German",
  "numbering": "org",
  "checked": true
 },
 {
  "name": "Almeida Revista e Atualizada",
  "abbr": "ARA",
  "language": "Portuguese",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "Nova Versão Internacional",
  "abbr": "NVI-PT",
  "language": "Portuguese",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "Smith-Van Dyck",
  "abbr": "AVD",
  "language": "Arabic",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "Amharic Bible 1962 (Haile Selassie)",
  "abbr": "AMH1962",
  "language": "Amharic",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "Swahili Union Version",
  "abbr": "SUV",
  "language": "Swahili",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "Biblia Habari Njema",
  "abbr": "BHN",
  "language": "Swahili",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "Hindi O.V. (BSI)",
  "abbr": "HINOV",
  "language": "Hindi",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "Terjemahan Baru",
  "abbr": "TB",
  "language": "Indonesian",
  "numbering": "custom",
  "nearest": "eng",
  "checked": true,
  "note": "Terjemahan Baru breaks chapters like English Bibles, but counts Psalm headings as verses and numbers the New Testament like the Greek."
 },
 {
  "name": "Korean Revised Version (개역한글, 개역개정)",
  "abbr": "KRV",
  "language": "Korean",
  "numbering": "eng",
  "checked": true
 },
 {
  "name": "Chinese Union Version (和合本)",
  "abbr": "CUV",
  "language": "Chinese",
  "numbering": "eng",
  "checked": true
 }
];

/**
 * The quiz, one question a screen: a short title, something to look at (a
 * quote, a picture, big numbers), and the answers as big buttons. Answers
 * lead to another question (`next`) or a numbering (`to`).
 */
export const QUIZ: { start: string; questions: Record<string, QuizQuestion> } = {
  start: 'psalm23',
  questions: {
    psalm23: {
      title: 'Which psalm is it in your Bible?', quote: 'The Lord is my shepherd',
      options: [{ label: 'Psalm 23', tile: '23', next: 'psalm_heading' }, { label: 'Psalm 22', tile: '22', next: 'malachi_greek' }],
      notSure: { label: 'Not sure', next: 'tradition' }
    },
    psalm_heading: {
      title: 'Which looks like Psalm 3 in your Bible?', picture: 'psalm3',
      options: [{ label: 'The heading has no number', to: 'eng' }, { label: 'The heading is verse 1', next: 'malachi_hebrew' }],
      notSure: { label: 'Not sure', next: 'malachi_hebrew' }
    },
    malachi_hebrew: {
      title: 'How many chapters does Malachi have?', small: 'The last book of the Old Testament',
      options: [{ label: '3 chapters', tile: '3', to: 'org' }, { label: '4 chapters', tile: '4', to: 'custom' }],
      notSure: { label: 'Not sure', to: 'org' }
    },
    malachi_greek: {
      title: 'How many chapters does Malachi have?', small: 'The last book of the Old Testament',
      options: [{ label: '3 chapters', tile: '3', to: 'lxx' }, { label: '4 chapters', tile: '4', next: 'romans16' }],
      notSure: { label: 'Not sure', next: 'romans16' }
    },
    romans16: {
      title: 'Romans 16 ends with verse…',
      options: [{ label: 'Verse 27', tile: '27', to: 'vul' }, { label: 'Verse 24', tile: '24', next: 'extra_books_russian' }],
      notSure: { label: 'Not sure', next: 'tradition_greek' }
    },
    extra_books_russian: {
      title: 'Does your Bible have these books?', picture: 'extraBooks',
      options: [{ label: 'Yes', tile: 'Yes', to: 'rso' }, { label: 'No', tile: 'No', to: 'rsc' }],
      notSure: { label: 'Not sure', to: 'rsc' }
    },
    tradition_greek: {
      title: 'Which church is your Bible from?',
      options: [
        { label: 'Russian or Slavic', next: 'extra_books_russian' },
        { label: 'Greek or other Orthodox', to: 'lxx' },
        { label: 'Catholic', to: 'vul' }
      ],
      notSure: { label: 'Not sure', to: 'lxx' }
    },
    tradition: {
      title: 'Which church is your Bible from?',
      options: [
        { label: 'Protestant or evangelical', to: 'eng' },
        { label: 'Catholic', to: 'eng' },
        { label: 'Russian or Slavic Orthodox', to: 'rso' },
        { label: 'Greek or other Orthodox', to: 'lxx' },
        { label: 'Ethiopian or Eritrean Orthodox', to: 'custom' },
        { label: 'Jewish (Tanakh)', to: 'org' }
      ],
      notSure: { label: 'Not sure', to: 'eng' }
    }
  }
};

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
