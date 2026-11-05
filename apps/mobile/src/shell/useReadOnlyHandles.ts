import { useEffect, useMemo } from 'react';
import { setReadOnlySession } from '../session/readOnly';
import type { LanguageHandle } from '../sync/useLanguage';
import type { OrgHandle } from '../sync/useOrg';
import { readOnlyLanguage, readOnlyOrg } from './readOnly';

/**
 * The handles screens and hooks get: the live ones, or for a read-only
 * session (a Global Viewer looking in) ones that refuse every write, so one
 * guard covers every screen (readOnly.ts). Also tells failureMessage, which has
 * no session, that a refusal from the server is this session's.
 */
export function useReadOnlyHandles(readOnly: boolean, liveOrg: OrgHandle, liveLanguage: LanguageHandle) {
  const org = useMemo(() => (readOnly ? readOnlyOrg(liveOrg) : liveOrg), [liveOrg, readOnly]);
  const language = useMemo(() => (readOnly ? readOnlyLanguage(liveLanguage) : liveLanguage), [liveLanguage, readOnly]);
  useEffect(() => { setReadOnlySession(readOnly); return () => setReadOnlySession(false); }, [readOnly]);
  return { org, language };
}
