/**
 * Door43's catalog of published resources (git.door43.org, stage `prod`),
 * and what LangQuest takes from it (scripts/door43-seed.ts): which entries,
 * in which ISO 639-3 language, under what name, license and credit.
 *
 * Only published releases are read (their zipballs), never a repository's
 * branch. unfoldingWord's license asks that a changed copy drop its
 * trademark, so names never carry "unfoldingWord"; each item says where
 * the original is and that it was converted for LangQuest.
 *
 * Pure: the catalog comes in as data.
 */
import { LABEL_ISO639_3 } from './glottologLabelCodes';

export const CATALOG_URL = 'https://git.door43.org/api/v1/catalog/search';

/** The fields of a catalog entry LangQuest reads. */
export interface CatalogEntry {
  owner: string;
  name: string;
  language: string;
  subject: string;
  /** The release tag. */
  tag: string;
  zipball: string;
  title: string;
  /** The owner's display name ("unfoldingWord®", "Bible Society of Jordan"). */
  ownerName: string;
  /** `Organization` or `User`. */
  ownerType: string;
  /** `rc`, `ts`, `sb`, `tc`. */
  metadataType: string;
  released: string;
  /** The repository's web page. */
  url: string;
  languageTitle?: string;
}

/** A raw `/catalog/search` row as the fields above. */
export function catalogEntry(raw: Record<string, unknown>): CatalogEntry {
  const repo = (raw['repo'] ?? {}) as Record<string, unknown>;
  const owner = (repo['owner'] ?? {}) as Record<string, unknown>;
  return {
    owner: String(raw['owner'] ?? ''),
    name: String(raw['name'] ?? ''),
    language: String(raw['language'] ?? ''),
    subject: String(raw['subject'] ?? ''),
    tag: String(raw['branch_or_tag_name'] ?? ''),
    zipball: String(raw['zipball_url'] ?? ''),
    title: String(repo['title'] ?? raw['name'] ?? ''),
    ownerName: String(owner['full_name'] || raw['owner'] || ''),
    ownerType: String(owner['type'] ?? 'Organization'),
    metadataType: String(repo['metadata_type'] ?? ''),
    released: String(raw['released'] ?? ''),
    url: String(repo['html_url'] ?? `https://git.door43.org/${String(raw['owner'])}/${String(raw['name'])}`),
    ...(repo['language_title'] ? { languageTitle: String(repo['language_title']) } : {})
  };
}

export type Role =
  | 'bible' | 'original'
  | 'notes' | 'questions' | 'wordLinks' | 'words' | 'academy' | 'grammar'
  | 'stories' | 'storyNotes' | 'storyQuestions' | 'storyWordLinks' | 'storyStudyNotes' | 'storyStudyQuestions' | 'formation';

const ROLE_BY_SUBJECT: Record<string, Role> = {
  'Aligned Bible': 'bible',
  Bible: 'bible',
  'Hebrew Old Testament': 'original',
  'Greek New Testament': 'original',
  'TSV Translation Notes': 'notes',
  'Translation Notes': 'notes',
  'TSV Translation Questions': 'questions',
  'Translation Questions': 'questions',
  'TSV Translation Words Links': 'wordLinks',
  'Translation Words': 'words',
  'Translation Academy': 'academy',
  'Hebrew Grammar': 'grammar',
  'Greek Grammar': 'grammar',
  'Aramaic Grammar': 'grammar',
  'Open Bible Stories': 'stories',
  'OBS Translation Notes': 'storyNotes',
  'TSV OBS Translation Notes': 'storyNotes',
  'OBS Translation Questions': 'storyQuestions',
  'TSV OBS Translation Questions': 'storyQuestions',
  'TSV OBS Translation Words Links': 'storyWordLinks',
  'OBS Study Notes': 'storyStudyNotes',
  'TSV OBS Study Notes': 'storyStudyNotes',
  'OBS Study Questions': 'storyStudyQuestions',
  'TSV OBS Study Questions': 'storyStudyQuestions',
  'OBS Theological Formation': 'formation'
};

/** What each role is called, in English. */
export const ROLE_NAMES: Record<Role, string> = {
  bible: 'Bible',
  original: 'Bible',
  notes: 'Translation Notes',
  questions: 'Translation Questions',
  wordLinks: 'Translation Word Links',
  words: 'Translation Words',
  academy: 'Translation Academy',
  grammar: 'Grammar',
  stories: 'Open Bible Stories',
  storyNotes: 'Open Bible Stories Notes',
  storyQuestions: 'Open Bible Stories Questions',
  storyWordLinks: 'Open Bible Stories Word Links',
  storyStudyNotes: 'Open Bible Stories Study Notes',
  storyStudyQuestions: 'Open Bible Stories Study Questions',
  formation: 'Open Bible Stories Theological Formation'
};

/** Repositories that are tests, never released for use, or not about any one language. */
const SKIPPED_OWNERS = new Set(['test_user', 'test_org2']);
const UNRELEASED = new Set(['en_sn', 'en_sq', 'en_ugl', 'en_uhal']);

/** The Hebrew and Greek LangQuest takes: unfoldingWord's own, which their Bibles are aligned to. */
const ORIGINALS = new Set(['unfoldingWord/hbo_uhb', 'unfoldingWord/el-x-koine_ugnt']);

/**
 * Bibles that are versions of unfoldingWord's: their literal and simplified
 * texts (ULT, UST) and the gateway Bibles made from them (GLT, GST and
 * their Russian and Arabic namesakes), the older Unlocked Literal and
 * Dynamic Bibles (ULB, UDB) in every language, and unfoldingWord's own
 * Translation for Translators and Unlocked English Bible. A team's own
 * translation is not one.
 */
const BIBLE_KINDS = new Set(['ult', 'ust', 'glt', 'gst', 'ulb', 'udb', 'rlob', 'rsob', 'arst']);
const UW_BIBLES = new Set(['ult', 'ust', 't4t', 'ueb', 'ulb']);
const NOT_A_VERSION = /indian (easy|revised|standard)/i;
/** Teams' own translations that carry a version's name. */
const OWN_TRANSLATIONS = new Set(['tg', 'rml', 'rmy']);

/** The resource kind in a repository's name: `hi_glt` → `glt`. */
export const kindInName = (name: string) => (name.includes('_') ? name.slice(name.indexOf('_') + 1).toLowerCase() : '');

/** A title without unfoldingWord's trademark, compared loosely. */
export const plainTitle = (t: string) => t.replace(/unfoldingWord®?\s*/gi, '').replace(/\s+/g, ' ').trim();

// ---- languages --------------------------------------------------------------------------

/**
 * A Door43 language code as ISO 639-3: two letters through Glottolog's
 * table (as v2 did), three as they are, region and script tags and
 * private-use suffixes dropped (`es-419` → `spa`, `mr-x-junu` → `mar`),
 * Koine Greek as `grc`. Null for `und` and anything else that is not a
 * language.
 */
/** Two-letter codes Glottolog's table lacks. */
const MORE_ISO639_1: Record<string, string> = { ha: 'hau' };

export function iso639_3(code: string): string | null {
  const c = code.trim().toLowerCase();
  if (c === 'el-x-koine') return 'grc';
  const base = c.split('-')[0]!;
  if (!base || base === 'und' || base === 'x') return null;
  if (/^[a-z]{3}$/.test(base)) return base;
  if (/^[a-z]{2}$/.test(base)) return LABEL_ISO639_3[base] ?? MORE_ISO639_1[base] ?? null;
  return null;
}

/** A language's English name from the platform, else the catalog's, else the code. */
export function englishName(code3: string, catalogTitle?: string): string {
  try {
    const n = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' }).of(code3);
    if (n && n.toLowerCase() !== code3) return n;
  } catch { /* an unknown code */ }
  return catalogTitle?.trim() || code3;
}

// ---- choosing ------------------------------------------------------------------------------

/** A taken entry; `competing` when another publisher has the same thing in its language, so its name says whose it is. */
export type Choice = { entry: CatalogEntry; role: Role; language: string; competing?: boolean } | { entry: CatalogEntry; skip: string };

/**
 * What LangQuest does with each entry: take it in a role, or skip it with
 * the reason. Two sets from different publishers for one language both come
 * in (each named with its publisher); a copy of another publisher's set with
 * the same title (a mirror or a fork) is skipped.
 */
export function choose(entries: CatalogEntry[]): Choice[] {
  const first: Choice[] = entries.map((e) => {
    if (SKIPPED_OWNERS.has(e.owner)) return { entry: e, skip: 'a test repository' };
    if (UNRELEASED.has(e.name)) return { entry: e, skip: 'never released for use' };
    const role = ROLE_BY_SUBJECT[e.subject];
    if (!role) return { entry: e, skip: `subject ${e.subject} is not taken` };
    const language = iso639_3(e.language);
    if (!language) return { entry: e, skip: `language ${e.language} is not a language in the table` };
    if (role === 'original' && !ORIGINALS.has(`${e.owner}/${e.name}`)) return { entry: e, skip: 'a Hebrew or Greek text unfoldingWord\'s Bibles are not aligned to' };
    if (role === 'bible') {
      const kind = kindInName(e.name);
      const ok = (e.owner === 'unfoldingWord' && UW_BIBLES.has(kind)) ||
        (BIBLE_KINDS.has(kind) && !NOT_A_VERSION.test(e.title) && !OWN_TRANSLATIONS.has(e.language.split('-')[0]!));
      if (!ok) return { entry: e, skip: 'not a version of unfoldingWord\'s Bibles' };
      if (e.metadataType !== 'rc') return { entry: e, skip: 'a translationStudio project, one book at a time' };
    }
    if (e.metadataType !== 'rc' && e.metadataType !== 'ts') return { entry: e, skip: `${e.metadataType || 'unknown'} layout is not read` };
    return { entry: e, role, language };
  });
  // Copies: the same title in the same language and role as unfoldingWord's own, or Door43-Catalog's copy of another publisher's.
  type Taken = Extract<Choice, { role: Role }>;
  const title = (c: Taken) => plainTitle(c.entry.title).toLowerCase();
  const taken = first.filter((c): c is Taken => 'role' in c);
  // A copy is Door43-Catalog's, a person's, or one an organization for another language keeps (ru_gt's
  // en_ult). Two organizations for the language with the same title are rivals, not copies.
  const homeLanguage = (owner: string) => /^([a-z]{2,3})(?:-[a-z0-9]+)?_/i.exec(owner)?.[1]?.toLowerCase();
  const copyOf = (c: Taken): Taken | undefined => {
    if (c.entry.owner === 'unfoldingWord') return undefined;
    const home = homeLanguage(c.entry.owner);
    const copier = c.entry.owner === 'Door43-Catalog' || c.entry.ownerType === 'User' || (home !== undefined && home !== c.entry.language.split('-')[0]!.toLowerCase());
    if (!copier) return undefined;
    const rivals = taken.filter((o) => o !== c && o.language === c.language && o.role === c.role && o.entry.owner !== c.entry.owner);
    // Another language's organization copying unfoldingWord's own set: a copy whatever its title.
    const elsewhere = home !== undefined && home !== c.entry.language.split('-')[0]!.toLowerCase();
    const uw = rivals.find((o) => o.entry.owner === 'unfoldingWord');
    if (elsewhere && uw && (c.role !== 'bible' || title(uw) === title(c))) return uw;
    const same = rivals.filter((o) => title(o) === title(c));
    return same.find((o) => o.entry.owner === 'unfoldingWord') ?? same.find((o) => o.entry.owner !== 'Door43-Catalog' && o.entry.ownerType !== 'User');
  };
  const second: Choice[] = first.map((c) => {
    if (!('role' in c)) return c;
    const original = copyOf(c);
    return original ? { entry: c.entry, skip: `a copy of ${original.entry.owner}/${original.entry.name}` } : c;
  });
  const kept = second.filter((c): c is Taken => 'role' in c);
  // The publisher goes in the name when another publisher has the same thing in the language: any set of
  // helps, or a Bible of the same title. unfoldingWord's own keeps the plain name.
  return second.map((c) => {
    if (!('role' in c) || c.entry.owner === 'unfoldingWord') return c;
    const rival = kept.some((o) => o !== c && o.language === c.language && o.role === c.role && o.entry.owner !== c.entry.owner &&
      (c.role === 'bible' || c.role === 'original' ? title(o) === title(c) : true));
    return rival ? { ...c, competing: true } : c;
  });
}

/**
 * Who published an entry, for names and credits: the manifest's publisher,
 * else the owner's display name; never unfoldingWord's trademark, so a
 * publisher that names unfoldingWord gives the owner's name instead.
 */
export function publisherName(e: Pick<CatalogEntry, 'owner' | 'ownerName'>, manifestPublisher?: string): string {
  const fromManifest = manifestPublisher?.trim();
  if (fromManifest && !/unfoldingword/i.test(fromManifest) && !/^door43/i.test(fromManifest)) return fromManifest;
  const n = plainTitle(e.ownerName || e.owner);
  return n || e.owner;
}

/** The language as items name it: its English name, and the dialect when the code had one (`lbm-x-sabar`). */
export function languageLabel(e: Pick<CatalogEntry, 'language' | 'languageTitle'>, code3: string): string {
  const known = englishName(code3);
  const dialect = /-x-([a-z0-9]+)$/i.exec(e.language)?.[1];
  if (!dialect || e.language === 'el-x-koine') return known === code3 ? englishName(code3, e.languageTitle) : known;
  // A dialect: the language's name and the dialect's, or the catalog's own name for it when the language is not known by name.
  const its = e.languageTitle?.trim() || dialect;
  return known === code3 ? its : `${known}, ${its}`;
}

// ---- names, licenses, credits ----------------------------------------------------------------

/** An item's id in LangQuest's library: `langquest.door43.<owner>.<repository>`. */
export const itemIdOf = (e: Pick<CatalogEntry, 'owner' | 'name'>) => `langquest.door43.${e.owner}.${e.name}`.toLowerCase().replace(/[^a-z0-9._-]/g, '-');

/** A license id (core license.ts) for a manifest's `rights`, or null when it does not allow a changed copy. */
export function licenseOf(rights: string | undefined): string | null {
  const r = (rights ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (/by-sa 4\.0|by sa 4\.0|attribution-sharealike 4\.0|licenses\/by-sa\/4\.0/.test(r)) return 'CC-BY-SA-4.0';
  if (/^cc by 4\.0|attribution 4\.0|licenses\/by\/4\.0/.test(r)) return 'CC-BY-4.0';
  if (/^cc0|creative commons zero|public domain/.test(r)) return 'CC0-1.0';
  return null;
}

/**
 * The credit a changed copy must carry: the license file's own words
 * ("The original work by unfoldingWord is available from …") with its
 * links as plain addresses, else the publisher and the repository; then
 * that LangQuest converted it.
 */
export function creditOf(licenseMd: string | undefined, e: Pick<CatalogEntry, 'owner' | 'ownerName' | 'url'>): string {
  const md = (licenseMd ?? '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$2');
  const quoted = /attribute the work as follows:\s*[“"]([^”"]+)[”"]/i.exec(md)?.[1] ?? /(The original work by .+? is available from \S+?)\.?(?:\s|$)/i.exec(md)?.[1];
  const plain = quoted?.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  const publisher = publisherName(e);
  const original = plain || `The original work by ${publisher} is available from ${e.url}`;
  // A translation of another's work names who made this one, too.
  const theirs = plain && !plain.includes(publisher) && e.owner !== 'unfoldingWord' ? ` This edition by ${publisher}: ${e.url}.` : '';
  return `${original}.${theirs} Converted for LangQuest.`;
}

/** An item's name: the role's English name and the language, with the publisher when two publishers have one; a Bible keeps its own title. */
export function itemName(c: Extract<Choice, { role: Role }>, languageName: string, publisher?: string): string {
  const who = c.competing && publisher ? publisher : undefined;
  if (c.role === 'bible' || c.role === 'original' || c.role === 'grammar') return `${plainTitle(c.entry.title)}${who ? ` (${who})` : ''}`;
  return `${ROLE_NAMES[c.role]} (${languageName}${who ? `, ${who}` : ''})`;
}

/** A Bible's abbreviation: the kind in its repository's name (ULT, GST, ULB). */
export const abbreviationOf = (e: Pick<CatalogEntry, 'name'>) => (kindInName(e.name) || e.name).toUpperCase();
