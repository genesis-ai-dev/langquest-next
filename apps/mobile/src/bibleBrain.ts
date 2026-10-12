// Bible Brain through the Worker (docs/reference-material.md, "The Worker's
// Bible routes"), for every screen: the admin's Bibles (screens/reference.tsx)
// and the translator's sources and More Bibles (src/sources/). One client
// (sources/bibleBrain.ts), with its answers kept on the phone
// (sources/store.ts); this module is the plain-function face the admin
// screens use. The key stays on the server; a phone asks with the person's
// Supabase token, the way the reports are fetched (src/useOrgSummary.ts).
import { BibleError, type BibleDetail, type BibleLanguage, type BibleSummary } from './sources/bibleBrain';
import { t } from './i18n';
import { bibleBrain } from './sources/store';

export { BibleError, type BibleDetail, type BibleLanguage, type BibleSummary };

/** Is there a Worker to ask in this build? */
export const bibleSearchAvailable = bibleBrain !== null;

function client() {
  if (!bibleBrain) throw new BibleError(t('shell.bibleBrainNotNamed'), 'unavailable', 0);
  return bibleBrain;
}

const details = new Map<string, BibleDetail>();

export function searchLanguages(q: string): Promise<BibleLanguage[]> {
  return client().languages(q);
}

export function biblesIn(lang: string): Promise<BibleSummary[]> {
  return client().bibles(lang);
}

/** One Bible's books, copyright and what may be kept offline; kept for the session (and on the phone, for offline). */
export async function bibleDetail(bibleId: string): Promise<BibleDetail> {
  const held = details.get(bibleId);
  if (held) return held;
  const bible = await client().bible(bibleId);
  details.set(bibleId, bible);
  return bible;
}

/** A detail already fetched this session, without asking. */
export function heldDetail(bibleId: string): BibleDetail | null {
  return details.get(bibleId) ?? null;
}
