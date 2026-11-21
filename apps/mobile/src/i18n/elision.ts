// French drops the vowel of "le" and "la" before a word that starts with a
// vowel: "Faire l’approbation finale", never "Faire la approbation finale".
// A catalog cannot know how a name put into its sentence starts
// ("Faire la {{check}}": a check's name, a language's, a Bible's), so this
// does it after i18next has put the name in
// (docs/decisions/2026-11-18-french-elides-before-a-name.md). It touches only
// an article that stands right before a name the sentence was given; the
// catalog's own words stay as written. It is in every visit's first
// JavaScript, so it is kept small.

/**
 * A name that takes "l’": it starts with a vowel. Not with h or y, which do
 * not always take it, nor "onze" and "oui", said with the whole article.
 */
const VOWEL = /^(?!onz|oui)[aeiouàâäæéèêëîïôöœùûü]/i;
/** "le " or "la " as a word of its own at the end: not the end of another word ("elle "), nor after a verb ("Dites-le "). */
const ARTICLE = /(^|[\s(«“])[lL][ae] $/;

/** `text` with "le " or "la " right before each of `names` that starts with a vowel made "l’". */
export function elide(text: string, names: readonly string[]): string {
  let out = text;
  for (const name of names) {
    if (!VOWEL.test(name)) continue;
    for (let at = out.indexOf(name); at >= 0; at = out.indexOf(name, at + 1)) {
      if (ARTICLE.test(out.slice(0, at))) out = `${out.slice(0, at - 2)}’${out.slice(at)}`;
    }
  }
  return out;
}

/** The i18next post-processor: in French, what `t` returns passes through `elide` with the names the call gave. */
export const frenchElision = {
  type: 'postProcessor' as const,
  name: 'frenchElision',
  process: (value: string, _key: unknown, options: Record<string, unknown>, translator: { language?: string }): string =>
    translator.language === 'fr' && typeof value === 'string'
      ? elide(value, Object.values(options).filter((v): v is string => typeof v === 'string'))
      : value
};
