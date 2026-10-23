import { useCallback, useEffect, useState } from 'react';
import { noteExpected } from '../diagnostics/report';
import { userState } from '../server/account';
import { onAuthChange } from '../server/auth';
import { globalViewerDirectory } from '../server/globalViewer';
import { accessOf, type GlobalViewerAccess } from './globalViewerModel';

/**
 * Each account's Global Viewer access in this run, shared by every caller:
 * the shell derives the session from it and the Global Viewer screen
 * changes it (decisions.md 158). Not kept on the device: it is the server's
 * answer for this sign-in, and offline there is nothing to read anyway.
 */
const known = new Map<string, GlobalViewerAccess | null>();
const listeners = new Set<() => void>();

async function read(actorId: string): Promise<void> {
  const { data, error } = await userState();
  if (error) { noteExpected('global viewer state', error); return; }
  known.set(actorId, accessOf(data));
  for (const hear of listeners) hear();
}

/**
 * This account's Global Viewer access: null for most accounts, and until
 * the server has said. Read again whenever the sign-in changes, as entering
 * an authenticator code does.
 */
export function useGlobalViewer(actorId: string, signedIn: boolean): { access: GlobalViewerAccess | null; refresh: () => Promise<void> } {
  const [access, setAccess] = useState<GlobalViewerAccess | null>(() => known.get(actorId) ?? null);
  useEffect(() => {
    const hear = () => setAccess(known.get(actorId) ?? null);
    listeners.add(hear);
    hear();
    return () => { listeners.delete(hear); };
  }, [actorId]);
  useEffect(() => {
    if (!signedIn || actorId === 'guest') return;
    void read(actorId).catch((e: unknown) => noteExpected('global viewer state', e));
    return onAuthChange((event) => {
      if (event === 'MFA_CHALLENGE_VERIFIED' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
        void read(actorId).catch((e: unknown) => noteExpected('global viewer state', e));
      }
    });
  }, [actorId, signedIn]);
  const refresh = useCallback(() => read(actorId), [actorId]);
  return { access, refresh };
}

const NO_NAMES: Record<string, string> = {};

/**
 * The names of the members of an organization a Global Viewer is viewing:
 * their own directory (my_directory) holds only organizations they belong
 * to. Read once per organization opened.
 */
export function useGlobalViewerNames(orgId: string, viewing: boolean): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>(NO_NAMES);
  useEffect(() => {
    if (!viewing || !orgId) { setNames(NO_NAMES); return; }
    let active = true;
    void globalViewerDirectory(orgId).then(({ data, error }) => {
      if (error) { noteExpected('global viewer names', error); return; }
      if (active) setNames(Object.fromEntries((data ?? []).flatMap((p) => (p.display_name ? [[p.id, p.display_name] as const] : []))));
    }, (e: unknown) => noteExpected('global viewer names', e));
    return () => { active = false; };
  }, [orgId, viewing]);
  return names;
}
