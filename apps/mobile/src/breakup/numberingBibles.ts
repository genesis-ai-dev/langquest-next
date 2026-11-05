// i18n-ignore-file: published Bibles by their own names, with the language each is in as an id (bibleLanguage shows it in the language showing).
// Bibles checked against their own text for the numbering they use (decision 80,
// numberingGuide.ts). Data, not the app's words.
import type { KnownBible } from './numberingGuide';

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
