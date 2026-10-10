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

export interface QuizOption { label: string; next?: string; to?: NumberingCode; confidence?: string }
export interface QuizQuestion { ask: string; hint?: string; options: QuizOption[]; notSure?: QuizOption; skip?: QuizOption }

const NOT_OFFERED = 'The Greek Old Testament (Septuagint) numbering is not offered yet. Choose the nearest by name.';

/**
 * What a found Bible or a quiz answer means: the numbering, or the nearest one
 * LangQuest offers, with a note when it is only near or nothing fits.
 */
export function resolveNumbering(code: NumberingCode, nearest: NumberingCode | undefined, offered: readonly string[]): { code: string | null; note?: string } {
  const has = (c: string | undefined) => !!c && offered.includes(c);
  if (has(code)) return { code };
  if (code === 'custom' && has(nearest)) return { code: nearest!, note: 'Your Bible mixes numberings. This is the closest; a consultant may want to check the places it differs.' };
  if (code === 'lxx' || (code === 'custom' && nearest === 'lxx')) return { code: null, note: NOT_OFFERED };
  return { code: null, note: 'We could not tell. Choose the numbering by name, or take the quiz.' };
}

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
  "name": "Russian Synodal (Bible Brain RUSSYN)",
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

export const QUIZ: { start: string; questions: Record<string, QuizQuestion> } = {
 "start": "psalm23",
 "questions": {
  "psalm23": {
   "ask": "Open the psalm that begins 'The Lord is my shepherd'. What number is it?",
   "hint": "If two numbers are printed, such as 22 (23), choose the first one.",
   "options": [
    {
     "label": "Psalm 23",
     "next": "psalm_heading"
    },
    {
     "label": "Psalm 22",
     "next": "malachi_greek"
    }
   ],
   "notSure": {
    "label": "Not sure / can't check",
    "next": "tradition"
   },
   "skip": {
    "label": "Skip",
    "to": "eng",
    "confidence": "default"
   }
  },
  "psalm_heading": {
   "ask": "Look at the top of Psalm 3. Is the heading 'A psalm of David, when he fled from his son Absalom' numbered as verse 1?",
   "hint": "Answer No if the heading has no number and verse 1 starts 'Lord, how many are my foes'.",
   "options": [
    {
     "label": "No, the heading has no number",
     "to": "eng",
     "confidence": "checked"
    },
    {
     "label": "Yes, the heading is verse 1",
     "next": "malachi_hebrew"
    }
   ],
   "notSure": {
    "label": "Not sure",
    "next": "malachi_hebrew"
   },
   "skip": {
    "label": "Skip",
    "to": "eng",
    "confidence": "likely"
   }
  },
  "malachi_hebrew": {
   "ask": "How many chapters does Malachi (the last book of the Old Testament) have?",
   "options": [
    {
     "label": "3 chapters",
     "to": "org",
     "confidence": "checked"
    },
    {
     "label": "4 chapters",
     "to": "custom",
     "confidence": "checked"
    }
   ],
   "notSure": {
    "label": "Not sure",
    "to": "org",
    "confidence": "likely"
   },
   "skip": {
    "label": "Skip",
    "to": "org",
    "confidence": "likely"
   }
  },
  "malachi_greek": {
   "ask": "How many chapters does Malachi have?",
   "options": [
    {
     "label": "3 chapters",
     "to": "lxx",
     "confidence": "checked"
    },
    {
     "label": "4 chapters",
     "next": "romans16"
    }
   ],
   "notSure": {
    "label": "Not sure",
    "next": "romans16"
   },
   "skip": {
    "label": "Skip",
    "next": "tradition_greek"
   }
  },
  "romans16": {
   "ask": "What is the last verse number of Romans chapter 16?",
   "hint": "Look at the very end of the letter to the Romans.",
   "options": [
    {
     "label": "27 (or 25-27)",
     "to": "vul",
     "confidence": "checked"
    },
    {
     "label": "24",
     "next": "extra_books_russian"
    }
   ],
   "notSure": {
    "label": "Not sure",
    "next": "tradition_greek"
   },
   "skip": {
    "label": "Skip",
    "next": "tradition_greek"
   }
  },
  "extra_books_russian": {
   "ask": "Does your Bible include Tobit, Judith or the books of Maccabees?",
   "options": [
    {
     "label": "Yes",
     "to": "rso",
     "confidence": "checked"
    },
    {
     "label": "No",
     "to": "rsc",
     "confidence": "checked"
    }
   ],
   "notSure": {
    "label": "Not sure",
    "to": "rsc",
    "confidence": "likely"
   },
   "skip": {
    "label": "Skip",
    "to": "rsc",
    "confidence": "likely"
   }
  },
  "tradition_greek": {
   "ask": "Which church tradition is your Bible from?",
   "options": [
    {
     "label": "Russian or another Slavic Bible",
     "next": "extra_books_russian"
    },
    {
     "label": "Greek, Arabic or other Orthodox",
     "to": "lxx",
     "confidence": "likely"
    },
    {
     "label": "Catholic",
     "to": "vul",
     "confidence": "likely"
    }
   ],
   "notSure": {
    "label": "Not sure",
    "to": "lxx",
    "confidence": "likely"
   }
  },
  "tradition": {
   "ask": "Which church tradition is your team's Bible from?",
   "hint": "This only gives a starting guess. You can change it later.",
   "options": [
    {
     "label": "Protestant or evangelical",
     "to": "eng",
     "confidence": "guess"
    },
    {
     "label": "Catholic",
     "to": "eng",
     "confidence": "guess"
    },
    {
     "label": "Russian, Ukrainian or other Slavic Orthodox",
     "to": "rso",
     "confidence": "guess"
    },
    {
     "label": "Greek or other Eastern Orthodox",
     "to": "lxx",
     "confidence": "guess"
    },
    {
     "label": "Ethiopian or Eritrean Orthodox",
     "to": "custom",
     "confidence": "guess"
    },
    {
     "label": "Jewish (Tanakh)",
     "to": "org",
     "confidence": "guess"
    }
   ],
   "notSure": {
    "label": "Not sure",
    "to": "eng",
    "confidence": "default"
   }
  }
 }
};
