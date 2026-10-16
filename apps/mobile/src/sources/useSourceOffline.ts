// Whether a source is kept on this phone, for a screen to follow (sources/offline.ts).
import { useEffect, useRef } from 'react';
import { noteExpected } from '../diagnostics/report';
import type { Session } from '../shell/session';
import type { OrgHandle } from '../sync/useOrg';
import type { LanguageHandle } from '../sync/useLanguage';
import { pass } from './offline';

/**
 * Keep the offline scope's chapters of downloadable sources on the phone.
 * Mounted once beside the library follower (App.tsx). Runs a pass after
 * the record or the library changes, a few seconds later, one file at a
 * time.
 */
export function useSourceOffline(language: LanguageHandle, org: OrgHandle, session: Session): void {
  const running = useRef(false);
  const again = useRef(false);
  const latest = useRef({ language, org, session });
  latest.current = { language, org, session };
  const revision = language.revision;
  const libraryKey = org.state ? Object.keys(org.state.recommendations ?? {}).length + ':' + Object.keys(org.state.library ?? {}).length : '';
  const kept = [...language.blobs.keptUnits].sort().join(',');
  // The default scope comes worked out from the phone's table (decisions.md 134), so a pass runs when it changes.
  const scope = [...language.blobs.scope].sort().join(',');

  useEffect(() => {
    const timer = setTimeout(() => {
      if (running.current) { again.current = true; return; }
      running.current = true;
      void (async () => {
        do {
          again.current = false;
          await pass(latest.current.language, latest.current.org, latest.current.session).catch((e: unknown) => noteExpected('sources offline', e));
        } while (again.current);
      })().finally(() => { running.current = false; });
    }, 4000);
    return () => clearTimeout(timer);
    // Revision covers the record; the key covers recommendations and items.
  }, [revision, libraryKey, kept, scope, language.online]);
}
