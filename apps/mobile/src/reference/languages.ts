// The language each piece of reference material is in (decision 84). Bibles,
// guides and notes name theirs with an ISO 639-3 code, as Bible Brain, FIA
// and the library write them ("eng", "fra"), so whoever chooses one sees
// whether their team can read it. The app's own language (decision 81) is
// the reader's first guess at what they read. Pure, so it is tested.
import { languageInfo, type LanguageState, type LibraryDoc, type OrgState } from '@langquest-next/core';
import { currentLanguage, t, type UiLanguage } from '../i18n';
import { joinAnd, languageLabel } from '../admin/adminModel';

/** The app's languages as material writes them: the code it is usually written with first. */
const CONTENT_CODES: Record<UiLanguage, readonly string[]> = {
  en: ['eng'], es: ['spa'], pt: ['por'], fr: ['fra'], ar: ['arb', 'ara'], sw: ['swa', 'swh'], ha: ['hau'], am: ['amh'],
  hi: ['hin'], bn: ['ben'], ne: ['npi', 'nep'], id: ['ind'], 'zh-Hans': ['cmn', 'zho'], th: ['tha'], my: ['mya']
};

/**
 * Codes a reader takes for one language: a macrolanguage and the language
 * most people mean by it (FIA writes Swahili `swa`, Bible Brain `swh`).
 */
const SAME: readonly (readonly string[])[] = [
  ['swa', 'swh'], ['arb', 'ara'], ['npi', 'nep'], ['cmn', 'zho'], ['fas', 'pes'], ['msa', 'zsm']
];

/** Do two codes name the same language for a reader? */
export function sameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = a.toLowerCase(), y = b.toLowerCase();
  return x === y || SAME.some((g) => g.includes(x) && g.includes(y));
}

/** The language the app is showing, as material writes it ("fra"). */
export function readerLanguage(ui: UiLanguage = currentLanguage()): string {
  return CONTENT_CODES[ui]?.[0] ?? 'eng';
}

/** The language a library document's words are in, when it says. */
export function docLanguage(doc: LibraryDoc | null | undefined): string | null {
  if (!doc) return null;
  switch (doc.format) {
    case 'source@1': case 'study@1': case 'study@2': return doc.language || null;
    case 'collection@1': case 'material@1': return doc.language || null;
    default: return null;
  }
}

/** "English", "English and French", or "Language not given" when material says nothing. */
export function languagesLine(codes: readonly (string | null | undefined)[]): string {
  const known = codes.filter((c): c is string => !!c);
  return known.length ? joinAnd(known.map(languageLabel)) : t('reference.language.notGiven');
}

/**
 * The language a team's reference material is in (decision 84): its own
 * setting (`v1.ReferenceLanguageSet`), else the language it was added with
 * (`sourceCode`), else English.
 */
export function teamLanguage(org: OrgState | null | undefined, state: LanguageState | null | undefined, languageId: string | null | undefined): string {
  return state?.referenceLanguage?.value ?? (languageId ? languageInfo(org ?? null, languageId)?.sourceCode : undefined) ?? 'eng';
}

/**
 * Every language a team's reference material may be in (decision 110): the
 * main one (`teamLanguage`), then the others it added, by code.
 */
export function teamLanguages(org: OrgState | null | undefined, state: LanguageState | null | undefined, languageId: string | null | undefined): string[] {
  const main = teamLanguage(org, state, languageId);
  const added = Object.entries(state?.referenceLanguagesAdded ?? {}).filter(([code, r]) => r.value && !sameLanguage(code, main)).map(([code]) => code).sort();
  return [main, ...added];
}

/** Is a piece of material, by the language it says it is in, in one of the team's languages? Material that says none is. */
export function inLanguages(language: string | null | undefined, languages: readonly string[]): boolean {
  return !language || languages.some((l) => sameLanguage(l, language));
}

/**
 * The events that make the team's languages `next` (the first is the main
 * one), from `now`: the main one when it moves, and each other one added or
 * taken away. Undo is the same from `next` back to `now`.
 */
export function languagesSays(now: readonly string[], next: readonly string[]): { type: 'v1.ReferenceLanguageSet' | 'v1.ReferenceLanguageAdded'; payload: object }[] {
  const out: { type: 'v1.ReferenceLanguageSet' | 'v1.ReferenceLanguageAdded'; payload: object }[] = [];
  if (next[0] && !sameLanguage(next[0], now[0])) out.push({ type: 'v1.ReferenceLanguageSet', payload: { language: next[0] } });
  const others = (list: readonly string[]) => list.slice(1);
  for (const l of others(next)) if (!others(now).some((x) => sameLanguage(x, l))) out.push({ type: 'v1.ReferenceLanguageAdded', payload: { language: l, added: true } });
  for (const l of others(now)) if (!others(next).some((x) => sameLanguage(x, l))) out.push({ type: 'v1.ReferenceLanguageAdded', payload: { language: l, added: false } });
  return out;
}
