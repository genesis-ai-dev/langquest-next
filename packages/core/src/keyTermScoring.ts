/** Version 1: chapter TF-IDF with an occurrence-based nesting penalty. */
export const TERM_SCORER_VERSION = 1;
const STOP_WORDS = new Set((
  'a an the and or but if then than as at by for from in into of on onto ' +
  'to with without is am are was were be been being do does did have has ' +
  'had he she it they we you i me him her them us my your his its our their ' +
  'mine yours hers ours theirs this that these those who whom whose which ' +
  'what when where why how not no nor so yet also very there here up down ' +
  'out over under again now all any each every both either neither some ' +
  'such other another only own same more most much many few less least ' +
  'will would shall should can could may might must let said say says ' +
  'according upon through throughout about among between before after ' +
  'during until toward towards against beyond within because although ' +
  'therefore thus saw see sees made make makes became become becomes ' +
  'called call calls'
).split(' '));
const PHRASE_CONNECTORS = new Set('of the and in on for with to'.split(' '));

export type TermStatistics = Record<string, [documents: number, frequency: number]>;
export type RankedTerm = { term: string; score: number; frequency: number };

/** Punctuation breaks phrases; we never join across verses or sentences. */
export function termOccurrences(text: string): Map<string, number[]> {
  const result = new Map<string, number[]>();
  let offset = 0;
  for (const sentence of text.toLowerCase().replace(/[’']/g, "'")
    .split(/[^\p{L}\p{N}'\s-]+/u)) {
    const words = sentence.match(/[\p{L}]+(?:'[\p{L}]+)?/gu) ?? [];
    for (let i = 0; i < words.length; i++) {
      if (STOP_WORDS.has(words[i]!)) continue;
      for (let size = 1; size <= 4 && i + size <= words.length; size++) {
        if (STOP_WORDS.has(words[i + size - 1]!)) continue;
        // Keep noun-like connectors ("Spirit of God"), not clause fragments
        // ("creature that crawls") or possessive sentence fragments.
        if (words.slice(i + 1, i + size - 1).some(word =>
          STOP_WORDS.has(word) && !PHRASE_CONNECTORS.has(word))) continue;
        const term = words.slice(i, i + size).join(' ');
        const positions = result.get(term) ?? [];
        positions.push(offset + i);
        result.set(term, positions);
      }
    }
    offset += words.length + 5;
  }
  return result;
}

export function rankTerms(
  verses: readonly string[], statistics: TermStatistics, documents: number
): RankedTerm[] {
  const occurrences = new Map<string, number[]>();
  verses.forEach((verse, index) => {
    for (const [term, positions] of termOccurrences(verse)) {
      // Repeated corpus phrases, plus every non-stopword single word.
      if (term.includes(' ') && (statistics[term]?.[1] ?? 0) < 3) continue;
      const prior = occurrences.get(term) ?? [];
      prior.push(...positions.map(p => index * 10000 + p));
      occurrences.set(term, prior);
    }
  });
  const nested = new Map<string, Set<number>>();
  for (const [longer, positions] of occurrences) {
    const words = longer.split(' ');
    for (let start = 0; start < words.length; start++) {
      for (let length = 1; length < words.length - start + 1; length++) {
        if (length === words.length) continue;
        const shorter = words.slice(start, start + length).join(' ');
        if (!occurrences.has(shorter)) continue;
        const covered = nested.get(shorter) ?? new Set<number>();
        positions.forEach(p => covered.add(p + start));
        nested.set(shorter, covered);
      }
    }
  }
  return [...occurrences].map(([term, positions]) => {
    const frequency = positions.length;
    const covered = positions.filter(p => nested.get(term)?.has(p)).length;
    const idf = 1 + Math.log((documents + 1) /
      ((statistics[term]?.[0] ?? 0) + 1));
    const score = Math.log2(1 + term.split(' ').length) *
      (1 + Math.log(frequency)) * idf * (1 - 0.9 * covered / frequency);
    return { term, frequency, score };
  }).sort((a, b) => b.score - a.score ||
    (a.term < b.term ? -1 : a.term > b.term ? 1 : 0));
}

/** Higher density always contains the lower-density shortlist. */
export function termsAtDensity(ranked: RankedTerm[], density: number): RankedTerm[] {
  if (!ranked.length) return [];
  const value = Number.isFinite(density) ? Math.max(0, Math.min(100, density)) : 35;
  const minimum = Math.min(3, ranked.length);
  return ranked.slice(0, minimum + Math.round(
    (ranked.length - minimum) * value / 100));
}
