/**
 * Review flows from Translation Academy's Checking Manual
 * (scripts/door43-seed.ts): one flow per manual, in its language, with the
 * shape Caleb chose (2026-10-20): a peer check; a team check with the
 * passage's notes and key words; a community check with no Bible on screen
 * that asks the passage's Translation Questions (the checker sees the
 * suggested answer) and the manual's evaluation form; a church leader check
 * with notes and key words that asks the affirmation of accuracy and must
 * pass; a back translation; and a quality check that must pass. The quality
 * checker's whole-book questions are left out until a check can cover a
 * book, and so is formatting and publishing.
 *
 * Pure: the manual comes in as its table of contents and articles.
 */
import { links } from './door43-helps';

export type CheckId = 'peer' | 'team' | 'community' | 'leader' | 'bt' | 'quality';
export const CHECK_ORDER: readonly CheckId[] = ['peer', 'team', 'community', 'leader', 'bt', 'quality'];

/** Each check's article in the manual, newest layout first. */
const ARTICLES: Record<CheckId, string[]> = {
  peer: ['peer-check'],
  team: ['team-oral-chunk-check'],
  community: ['language-community-check'],
  leader: ['church-leader-check'],
  bt: ['vol2-backtranslation'],
  quality: ['vol2-steps', 'level3-questions']
};

/** Who does each check, in the manual's words, for the English flow. */
const ENGLISH: Record<CheckId, { usualReviewer: string; description: string }> = {
  peer: { usualReviewer: 'A teammate who did not work on it', description: 'The translator plays it to a teammate, who listens for natural speech, then again with the source for anything added, missing or changed.' },
  team: { usualReviewer: 'The translation team', description: 'The team hears each piece: one listens for natural speech, one follows the source, one watches the key words. Then a fresh recording is made.' },
  community: { usualReviewer: 'People in the community who did not work on it', description: 'Play it to people who did not work on it, with no Bible open. Ask the questions for the passage and compare their answers with the suggested ones.' },
  leader: { usualReviewer: 'Church leaders', description: 'Church leaders who know the Bible compare it with the source for anything added, left out or changed, and affirm its accuracy.' },
  bt: { usualReviewer: 'A bilingual speaker who did not work on it', description: 'Someone who speaks both languages and did not work on the translation says it back in the gateway language.' },
  quality: { usualReviewer: 'Church network delegates or quality checkers', description: 'Delegates the church leaders chose check the meaning against the Hebrew and Greek, asking about anything that might be wrong.' }
};

export interface TocEntry { title: string; link?: string; sections?: TocEntry[] }

export interface CheckingManual {
  /** Each check's name in the manual's language; absent when the manual has no article for it. */
  names: Partial<Record<CheckId, string>>;
  /** The community evaluation: statements the team affirms, then questions answered in words. */
  evaluation?: { title: string; affirm: string[]; answer: string[] };
  /** The church leaders' affirmation of accuracy. */
  affirmation?: { title: string; affirm: string[] };
}

/**
 * A check's name from the manual's table of contents: the entry's own
 * title, or, when the entry is the first under a section of its own (a
 * section that groups the check's articles), that section's.
 */
function nameIn(toc: TocEntry[], slug: string): string | null {
  const walk = (entries: TocEntry[], depth: number, parent: TocEntry | null): string | null => {
    for (const [i, e] of entries.entries()) {
      if (e.link === slug) return parent && depth >= 2 && i === 0 && !parent.link ? parent.title : e.title;
      if (e.sections) {
        const found = walk(e.sections, depth + 1, e);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(toc, 1, null);
}

const clean = (s: string) => links(s.replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim());

/** The bullets of the evaluation page: the first list is affirmed, every later bullet answered. */
export function evaluationQuestions(md: string): { affirm: string[]; answer: string[] } {
  const affirm: string[] = [];
  const answer: string[] = [];
  let list = 0;
  let inList = false;
  for (const line of md.replace(/\r\n?/g, '\n').split('\n')) {
    const b = /^\s*[*-]\s+(.*)$/.exec(line);
    if (b) {
      if (!inList) { list++; inList = true; }
      const t = clean(b[1]!);
      if (t) (list === 1 ? affirm : answer).push(t);
    } else if (line.trim() && !/^<br/i.test(line.trim())) inList = false;
  }
  return { affirm, answer };
}

/** The numbered statements of the affirmation page. */
export function affirmationStatements(md: string): string[] {
  const out: string[] = [];
  for (const line of md.replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (m) out.push(clean(m[1]!));
  }
  return out;
}

/** What a manual says about its checks. `read(slug)` gives an article's `title.md` and `01.md`. */
export function checkingManual(toc: unknown, read: (slug: string) => { title?: string | undefined; body?: string | undefined }): CheckingManual {
  const sections = ((toc as { sections?: TocEntry[] } | null)?.sections ?? []) as TocEntry[];
  const names: Partial<Record<CheckId, string>> = {};
  for (const id of CHECK_ORDER) {
    for (const slug of ARTICLES[id]) {
      // The table of contents names a check even where the article itself is not translated yet.
      const n = nameIn(sections, slug) ?? (read(slug).body !== undefined ? read(slug).title?.trim() : undefined);
      if (n) { names[id] = n.replace(/^"|"$/g, '').trim(); break; }
    }
  }
  const out: CheckingManual = { names };
  const ev = read('community-evaluation');
  if (ev.body) {
    const q = evaluationQuestions(ev.body);
    if (q.affirm.length || q.answer.length) out.evaluation = { title: ev.title?.trim() || 'Community evaluation', ...q };
  }
  const af = read('good');
  if (af.body) {
    const affirm = affirmationStatements(af.body);
    if (affirm.length) out.affirmation = { title: af.title?.trim() || 'Affirmation of accuracy', affirm };
  }
  return out;
}

/** Library items a flow links to its checks, by what they are. */
export interface FlowHelps {
  notes?: string | undefined;
  wordLinks?: string | undefined;
  words?: string | undefined;
  questions?: string | undefined;
  evaluation?: string | undefined;
  affirmation?: string | undefined;
}

/**
 * The flow for one manual. Checks the manual has no article for take the
 * English manual's name (`fallback`), so every flow has the same checks.
 */
export function checkingFlow(input: {
  name: string;
  description: string;
  language: string;
  /** The gateway language a back translation is said in, by name. */
  languageName: string;
  manual: CheckingManual;
  fallback: Partial<Record<CheckId, string>>;
  helps: FlowHelps;
  pattern: string;
}): { doc: Record<string, unknown>; fromEnglish: CheckId[] } {
  const english = input.language === 'eng';
  const fromEnglish: CheckId[] = [];
  const kinds = CHECK_ORDER.map((id) => {
    const name = input.manual.names[id] ?? input.fallback[id] ?? id;
    if (!input.manual.names[id]) fromEnglish.push(id);
    return {
      id: `door43-${id}`,
      name,
      // Who does it and how, in English for the English flow; another language's manual says it in its articles.
      description: english ? ENGLISH[id].description : '',
      usualReviewer: english ? ENGLISH[id].usualReviewer : '',
      ...(id === 'bt' ? { withholdsContext: true, produces: { what: name, into: input.languageName, action: name, checkedBy: 'door43-quality' } } : {})
    };
  });
  const steps = CHECK_ORDER.map((id, i) => ({ stepId: `s${i + 1}`, kindIds: [`door43-${id}`], ...(id === 'leader' || id === 'quality' ? { checkpoint: true } : {}) }));
  const help = (kindId: CheckId, ...items: (string | undefined)[]) => items.filter((x): x is string => !!x).map((itemId) => ({ kindId: `door43-${kindId}`, itemId }));
  const h = input.helps;
  const helps = [
    ...help('team', h.notes, h.wordLinks, h.words),
    ...help('community', h.questions, h.evaluation),
    ...help('leader', h.notes, h.wordLinks, h.words, h.affirmation)
  ];
  const shows = [
    { kindId: 'door43-community', what: 'bibleText', shown: false },
    { kindId: 'door43-community', what: 'bibleAudio', shown: false }
  ];
  return {
    doc: withFlowLanguage({ format: 'flow@1', name: input.name, description: input.description, kinds, steps, helps, shows, pattern: input.pattern, deps: [] }, input.language),
    fromEnglish
  };
}

/**
 * The one place a flow's (or template's) language is written: `language`,
 * an ISO 639-3 code beside `name`, the language its words are in. The field,
 * its type and `docLanguage()` come with the change that gives flows and
 * templates a language (branch caleb/bible-counts); core already accepts it.
 */
export function withFlowLanguage<T extends Record<string, unknown>>(doc: T, language: string): T & { language: string } {
  return { ...doc, language };
}

/** A question set from one of the manual's forms, as `material@1` kind `questions` for every passage. */
export function formQuestions(input: { title: string; language: string; kindId: CheckId; affirm: string[]; answer?: string[] | undefined }): Record<string, unknown> {
  const questions = [
    ...input.affirm.map((text, i) => ({ id: `a${i + 1}`, text, type: 'yesno' })),
    ...(input.answer ?? []).map((text, i) => ({ id: `q${i + 1}`, text, type: 'text' }))
  ];
  return { format: 'material@1', kind: 'questions', title: input.title, language: input.language, reviewKindId: `door43-${input.kindId}`, questions, deps: [] };
}
