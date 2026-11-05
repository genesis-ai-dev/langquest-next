// A language list that offers only languages with something to pick in them
// (Bibles in Bible Brain, the library's guides): typing shows the matches in
// the same dropdown as the world's language list (org/languoidPicker.tsx),
// found by any of their names or their code, and by every name the world's
// list knows them by (Glottolog's aliases, so "Kiswahili" finds Swahili).
// What is offered comes from the data, never a fixed list. Pure, so it is
// tested.
import { LANGUOID_RESULTS, type LanguoidHit } from '../org/languoidModel';
import type { LanguoidSearch } from '../org/useLanguoids';
import { matchRanges } from '../ui/textMatch';
import { sameLanguage } from './languages';

/** A language on offer: its ISO 639-3 code and the names it may be found by, the one to show first. */
export interface OfferedLanguage {
  code: string;
  names: readonly string[];
}

/** Found where a word of the name starts ("spa" finds "Spanish", not "Coatzospan"). */
const found = (name: string, query: string) => matchRanges(name, query).some(([at]) => at === 0 || /[\s\-(:,/]/.test(name[at - 1]!));
const starts = (name: string | null, query: string) => !!name && matchRanges(name, query)[0]?.[0] === 0;

/**
 * The offered languages matching `query`, closest first: the world list's
 * matches that are on offer (with its name for them), then those found by
 * their own names (where a word starts) or code. A code typed in full
 * comes first, then names that start with what was typed. Nothing under
 * two letters.
 */
export function offeredHits(offered: readonly OfferedLanguage[], world: readonly LanguoidHit[], query: string): LanguoidHit[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const out: LanguoidHit[] = [];
  const has = (code: string) => out.some((h) => sameLanguage(h.code, code));
  for (const h of world) {
    const o = offered.find((x) => sameLanguage(x.code, h.code));
    if (o && !has(o.code)) out.push({ ...h, code: o.code });
  }
  for (const o of offered) {
    if (has(o.code)) continue;
    const first = o.names[0] ?? o.code;
    const by = o.names.find((n) => found(n, q));
    if (!by && o.code !== q.toLowerCase()) continue;
    out.push({ id: `offered:${o.code}`, name: first, dialect: false, parentName: null, alsoCalled: by && !found(first, q) ? by : null, code: o.code });
  }
  const rank = (h: LanguoidHit) => (h.code === q.toLowerCase() ? 0 : starts(h.name, q) || starts(h.alsoCalled, q) ? 1 : 2);
  return out.map((h, i) => ({ h, i })).sort((a, b) => rank(a.h) - rank(b.h) || a.i - b.i).map((x) => x.h).slice(0, LANGUOID_RESULTS);
}

/** The search without languages found to have nothing after all (a Bible Brain language none of whose Bibles open). */
export function withoutEmpty(search: LanguoidSearch, empty: (code: string) => boolean): LanguoidSearch {
  const hits = search.hits.filter((h) => !empty(h.code));
  if (hits.length === search.hits.length) return search;
  return { ...search, hits, status: hits.length || search.status !== 'found' ? search.status : 'none' };
}

/** Names to find a language by, without repeats or blanks: the one the app shows first. */
export function namesOf(...names: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const n of names) if (n && n.trim() && !out.some((x) => x.toLowerCase() === n.trim().toLowerCase())) out.push(n.trim());
  return out;
}
