import { useEffect, useState } from 'react';
import type { Ctx } from '../ctx';
import { failureMessage as failure, noteExpected } from '../report';
import { languageListing, setLanguageListing } from '../server/languages';
import { listingFailure } from './model';

/** Whether the open language is listed on Explore (one listing per language). */
export function usePublicListing(ctx: Ctx) {
  const may = ctx.session.can('manage_structure');
  const { orgId, languageId } = ctx.language;
  const [listed, setListed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!may || !languageId) return;
    let active = true;
    void languageListing(orgId, languageId)
      .then(({ data, error: failed }) => {
        if (!active) return;
        // Offline or refused: say so rather than showing "not listed".
        if (failed) { noteExpected('read listing', failed); setError(listingFailure(failed)); } else setListed(data?.listed ?? false);
      });
    return () => { active = false; };
  }, [may, orgId, languageId]);
  async function set(value: boolean) {
    setBusy(true);
    try {
      const { error: failed } = await setLanguageListing(orgId, languageId, value);
      if (failed) { noteExpected('change listing', failed); setError(listingFailure(failed)); } else { setListed(value); setError(''); }
    } catch (e) {
      setError(failure('change listing', e));
    } finally {
      setBusy(false);
    }
  }
  return { may, listed, error, busy, set };
}
