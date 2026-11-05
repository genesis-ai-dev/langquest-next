import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { NO_LANGUAGE_STATUS, StatusStore, type LanguageStatusStore, type OrgStatusStore, type SyncStatus } from './syncStatusStore';

/** The stores the open language and organization publish their changing status to; the shell provides them. */
export interface SyncStatusSources {
  language: LanguageStatusStore;
  org: OrgStatusStore;
}

const NOTHING: SyncStatusSources = {
  language: new StatusStore(NO_LANGUAGE_STATUS),
  org: new StatusStore({ pending: 0 })
};

export const SyncStatusContext = createContext<SyncStatusSources>(NOTHING);

/**
 * What changes while syncing: pending counts, the last result, transfer
 * progress and the files here. Read it in the component that shows it; it
 * redraws that component alone. Things that change rarely (online, refused,
 * the fold) stay on `ctx.language`.
 */
export function useSyncStatus(): SyncStatus {
  const { language, org } = useContext(SyncStatusContext);
  const lang = useSyncExternalStore(language.subscribe, language.get, language.get);
  const orgNow = useSyncExternalStore(org.subscribe, org.get, org.get);
  return useMemo(() => ({ ...lang, orgPending: orgNow.pending }), [lang, orgNow]);
}
