// Typing a language where only some are on offer (reference/offeredLanguagesModel.ts):
// the world's language list is searched as everywhere else, and its matches
// are kept only when on offer; the offered languages' own names are matched
// on the phone, so a list kept from before works offline.
import { useMemo } from 'react';
import type { LanguoidSearch } from '../org/useLanguoids';
import { useLanguoidSearch } from '../org/useLanguoids';
import { offeredHits, type OfferedLanguage } from './offeredLanguagesModel';

/** A search shaped like the world list's, for org/languoidPicker.tsx; `offered` is null while it loads. */
export function useOfferedLanguageSearch(query: string, offered: readonly OfferedLanguage[] | null, enabled = true): LanguoidSearch {
  const world = useLanguoidSearch(query, enabled);
  const q = query.trim();
  const hits = useMemo(() => (enabled && offered ? offeredHits(offered, world.hits, q) : []), [enabled, offered, world.hits, q]);
  const status: LanguoidSearch['status'] = !enabled || q.length < 2 ? 'idle'
    : hits.length ? (world.status === 'searching' ? 'searching' : 'found')
      : world.status === 'searching' || offered === null ? 'searching'
        : world.status === 'unreachable' && !offered.length ? 'unreachable'
          : 'none';
  return { status, hits, query: world.query, retry: world.retry };
}
