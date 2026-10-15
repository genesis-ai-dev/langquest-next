// Sections from an earlier break-up of a book (breakup/earlier.tsx).
import { unitPrefixOf, type LanguageState } from '@langquest-next/core';
import { t } from '../i18n';
import { indexesFor } from '../sync/indexes';

/** How an earlier section's numbering is named beside it (the seed's `short` names), in the language showing. */
export function numberedLike(code: string): string | undefined {
  switch (code) {
    case 'eng': return t('breakup.earlier.numbered.eng');
    case 'org': return t('breakup.earlier.numbered.org');
    case 'vul': return t('breakup.earlier.numbered.vul');
    case 'rsc':
    case 'rso': return t('breakup.earlier.numbered.russian');
    default: return undefined;
  }
}

/** A section the language no longer has: a library part outside the current divisions. */
export function isEarlierSection(state: LanguageState | null, unitId: string): boolean {
  if (!state || !state.units[unitId] || unitPrefixOf(unitId) === null) return false;
  const idx = indexesFor(state);
  return !idx.passages.includes(unitId) && !idx.containers.includes(unitId);
}
