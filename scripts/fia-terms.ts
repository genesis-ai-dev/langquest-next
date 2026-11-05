/**
 * FIA's key words into key-word lists (docs/library.md, decision 172).
 *
 * FIA's Master Glossary names each word once, with its translation in each
 * language (the word, other forms, a short meaning, the full meaning in
 * markdown, a recording) and the pericopes that link to it. FIA's
 * `get_terms.py` (genesis-ai-dev/fia) writes that as one JSON file.
 * `fiaKeyWordList` turns it into one `material@1` key-word list per
 * language: its words keep FIA's term ids ("t104", the ids FIA's guides
 * link to), their meanings keep FIA's links to other words (`[mercy](#t91)`),
 * and each pericope becomes the verses it covers, numbered as English Bibles
 * number them, as FIA's guides are.
 *
 * Pure: JSON in, documents out. `scripts/library-seed.ts` reads the file.
 */
import { withDeps, type KeyWordDoc, type MaterialDoc } from '@langquest-next/core';
import { FIA_ATTRIBUTION } from './fia-adapter';

interface FiaTermTranslation {
  id: string;
  translatedTerm: string | null;
  alternates?: string[] | null;
  descriptionHint?: string | null;
  textAsMarkdown?: string | null;
  textPlain?: string | null;
  audioUrlVbr4?: string | null;
  language: { id: string; nameEnglish?: string | null };
}

interface FiaTermsJson {
  fetched?: string;
  terms: { id: string; uniqueIdentifier?: string | null; pericopes: string[]; translations: FiaTermTranslation[] }[];
}

/** The file `get_terms.py` writes. */
export function fiaTerms(json: unknown): FiaTermsJson {
  const terms = (json as { terms?: unknown } | null)?.terms;
  if (!Array.isArray(terms) || !terms.every((x) => x && typeof x === 'object' && 'id' in x && Array.isArray((x as { translations?: unknown }).translations))) {
    throw new Error('not an FIA terms file');
  }
  return json as FiaTermsJson;
}

/** A translation that can stand as a key word: a word and a meaning to read (Russian has names alone, 2026-10). */
const usable = (t: FiaTermTranslation): boolean => !!t.translatedTerm?.trim() && !!(t.textAsMarkdown ?? t.textPlain)?.trim();

/** The languages with key words, English first, with their English names and how many words each has. */
export function fiaTermLanguages(json: unknown): { id: string; name: string; words: number }[] {
  const out = new Map<string, { id: string; name: string; words: number }>();
  for (const term of fiaTerms(json).terms) {
    for (const t of term.translations) {
      if (!usable(t)) continue;
      const l = out.get(t.language.id) ?? { id: t.language.id, name: t.language.nameEnglish ?? t.language.id, words: 0 };
      l.words++;
      out.set(l.id, l);
    }
  }
  return [...out.values()].sort((a, b) => (a.id === 'eng' ? -1 : b.id === 'eng' ? 1 : a.id < b.id ? -1 : 1));
}

/** What a list is, as its description and the line above its words say it. */
export const FIA_WORDS_ABOUT =
  "The key words FIA's study guides link to, from FIA's Master Glossary: each with a short meaning, the full meaning to read, and FIA's recording of it.";

/**
 * One language's key-word list, or null when FIA has no words in it.
 * `place` gives a pericope's verses ("GEN 2:4-25") and its place in FIA's
 * order, or null for a pericope it does not know (that link is left out).
 */
export function fiaKeyWordList(
  json: unknown,
  lang: string,
  englishVersification: string,
  place: (pericopeId: string) => { ref: string; order: number } | null
): MaterialDoc | null {
  const words: KeyWordDoc[] = [];
  let name = lang;
  for (const term of fiaTerms(json).terms) {
    const t = term.translations.find((x) => x.language.id === lang);
    if (!t || !usable(t)) continue;
    name = t.language.nameEnglish ?? lang;
    const word = t.translatedTerm!.trim();
    // Other forms FIA lists, without the word itself or a repeat.
    const match = [...new Set((t.alternates ?? []).map((a) => a.trim()).filter((a) => a && a.toLowerCase() !== word.toLowerCase()))];
    const links = term.pericopes
      .map((id) => place(id))
      .filter((p): p is { ref: string; order: number } => p !== null)
      .sort((a, b) => a.order - b.order)
      .map((p) => ({ ref: p.ref }));
    words.push({
      id: `t${term.id}`,
      term: word,
      gloss: t.descriptionHint?.trim() ?? '',
      ...(match.length ? { match } : {}),
      body: (t.textAsMarkdown ?? t.textPlain)!.trim(),
      ...(t.audioUrlVbr4 ? { audio: { url: t.audioUrlVbr4 } } : {}),
      ...(links.length ? { links: [...new Map(links.map((l) => [l.ref, l])).values()] } : {})
    });
  }
  if (!words.length) return null;
  // By word, then id: the same file gives the same document, whatever order the API sent.
  words.sort((a, b) => a.term.localeCompare(b.term, 'en') || (a.id < b.id ? -1 : 1));
  return withDeps<MaterialDoc>({
    format: 'material@1',
    kind: 'key_terms',
    title: `FIA key words (${name})`,
    language: lang,
    pattern: 'FIA',
    // FIA is CC BY-SA 4.0 and asks for attribution; the source line is what readers see.
    source: `fia.bible · ${name} · ${FIA_ATTRIBUTION}`,
    body: FIA_WORDS_ABOUT,
    versification: englishVersification,
    terms: words,
    deps: []
  });
}
