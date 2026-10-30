// Codes that name one language for a reader (decision 84). It imports
// nothing, so the library's own models can use it without a cycle. Pure,
// so it is tested.

/**
 * Codes a reader takes for one language: a macrolanguage and the language
 * most people mean by it (FIA writes Swahili `swa`, Bible Brain `swh`).
 */
const SAME: readonly (readonly string[])[] = [
  ['swa', 'swh'], ['arb', 'ara'], ['npi', 'nep'], ['cmn', 'zho'], ['fas', 'pes'], ['msa', 'zsm']
];

/** Every code a reader takes for this language: the code itself first, then the others it is taken for. */
export function sameCodes(code: string): string[] {
  const c = code.toLowerCase();
  return [c, ...(SAME.find((g) => g.includes(c)) ?? []).filter((x) => x !== c)];
}

/** Do two codes name the same language for a reader? */
export function sameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = a.toLowerCase(), y = b.toLowerCase();
  return x === y || SAME.some((g) => g.includes(x) && g.includes(y));
}
