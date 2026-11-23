// Whether a source is kept on this phone, for a screen to follow (sources/offline.ts).
import { useEffect, useMemo, useRef } from 'react';
import { noteExpected } from '../diagnostics/report';
import type { Session } from '../shell/session';
import type { OrgHandle } from '../sync/useOrg';
import type { LanguageHandle } from '../sync/useLanguage';
import { referenceUnits } from '../sync/offlineModel';
import { pass, restoreReference } from './offline';

/** How long after a change a pass runs: a sync changes the record many times a second, and one pass covers them all. */
const PASS_AFTER_MS = 4000;

/**
 * Keep the offline scope's chapters of downloadable sources on the phone,
 * and say which each passage wants and has (sources/referenceCounts.ts).
 * Mounted once beside the library follower (App.tsx). When a language opens
 * it says at once what was last worked out for it, offline too. A pass runs
 * a few seconds after the record changes and stops changing (a sync changes
 * it many times a second, and seldom changes what is wanted), and a few
 * seconds after the passages kept, the library or the connection change,
 * however much else changes meanwhile, since a passage just kept waits on
 * the pass to be counted. It fetches one file at a time, and runs again
 * while files are left for it.
 */
export function useSourceOffline(language: LanguageHandle, org: OrgHandle, session: Session): void {
  const running = useRef(false);
  const again = useRef(false);
  const settled = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soon = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ language, org, session });
  latest.current = { language, org, session };
  const revision = language.revision;
  const libraryKey = org.state ? Object.keys(org.state.recommendations ?? {}).length + ':' + Object.keys(org.state.library ?? {}).length : '';
  // The passages whose reference audio is kept (`referenceUnits`): a pass runs when they change. Worked out when
  // the sets change, not on every render of the app root. The default scope comes worked out from the phone's
  // table (decisions.md 143).
  const { scope: scopeUnits, keptUnits } = language.blobs;
  const scope = useMemo(() => [...referenceUnits({ scope: scopeUnits, keptUnits })].sort().join(','), [scopeUnits, keptUnits]);
  const { orgId, languageId } = language;

  useEffect(() => {
    if (!orgId || !languageId) return;
    void restoreReference(orgId, languageId, latest.current.language.blobs.store).catch((e: unknown) => noteExpected('sources offline: restore', e));
  }, [orgId, languageId]);

  const run = useRef(() => {
    if (running.current) { again.current = true; return; }
    running.current = true;
    void (async () => {
      do {
        again.current = false;
        const more = await pass(latest.current.language, latest.current.org, latest.current.session).catch((e: unknown) => { noteExpected('sources offline', e); return false; });
        if (more) again.current = true;
      } while (again.current);
    })().finally(() => { running.current = false; });
  });

  // The record: once it stops changing.
  useEffect(() => {
    if (settled.current) clearTimeout(settled.current);
    settled.current = setTimeout(() => { settled.current = null; run.current(); }, PASS_AFTER_MS);
  }, [revision]);

  // What is kept, recommendations and items, and the connection: soon, whatever else changes.
  useEffect(() => {
    if (soon.current) return;
    soon.current = setTimeout(() => { soon.current = null; run.current(); }, PASS_AFTER_MS);
  }, [libraryKey, scope, language.online]);

  useEffect(() => () => {
    if (settled.current) clearTimeout(settled.current);
    if (soon.current) clearTimeout(soon.current);
  }, []);
}
