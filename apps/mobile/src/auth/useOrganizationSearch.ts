import { useEffect, useMemo, useState } from 'react';
import { searchListedOrganizations, type ListedOrganization } from '../account/accountData';
import { noteExpected } from '../diagnostics/report';
import { matchOrganizations } from './model';

/** Request Access's matches for `query` (lower case, trimmed): the phone's list at once, the server's search a moment after typing stops. */
export function useOrganizationSearch(listed: ListedOrganization[], query: string): ListedOrganization[] {
  const [found, setFound] = useState<{ query: string; list: ListedOrganization[] }>({ query: '', list: [] });
  useEffect(() => {
    if (!query) return;
    let active = true;
    const wait = setTimeout(() => {
      searchListedOrganizations(query)
        .then((list) => { if (active) setFound({ query, list }); })
        .catch((e: unknown) => noteExpected('request access search', e));
    }, 300);
    return () => { active = false; clearTimeout(wait); };
  }, [query]);
  return useMemo(() => matchOrganizations(listed, query, found), [listed, query, found]);
}
