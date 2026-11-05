import { useCallback, useEffect, useRef, useState } from 'react';
import { failureMessage, noteExpected } from '../diagnostics/report';
import { t } from '../i18n';
import { userState } from '../server/account';
import { onAuthChange } from '../server/auth';
import {
  authenticatorFactors, enrollAuthenticator, globalViewerDirectory, globalViewerOrganizations, unenrollAuthenticator, verifyAuthenticator,
  type ViewableOrganization
} from '../server/globalViewer';
import { accessOf, codeIsWrong, hasMore, ORGANIZATIONS_PAGE, unfinishedSetups, type GlobalViewerAccess } from './globalViewerModel';

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

/**
 * Checking a 6-digit code from the authenticator: the server decides; on
 * success this sign-in is verified (aal2) and `refresh` reads the access again.
 * `factorId` is the authenticator to check against, null if there is none.
 */
export function useVerifyCode(refresh: () => Promise<void>): {
  busy: boolean; error: string; check: (factorId: () => Promise<string | null>, code: string) => Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function check(factorId: () => Promise<string | null>, code: string) {
    setBusy(true);
    setError('');
    try {
      const id = await factorId();
      if (!id) { setError(t('globalViewer.noAuthenticator')); return; }
      const { error: refused } = await verifyAuthenticator(id, code);
      if (refused) {
        noteExpected('global viewer code', refused);
        setError(codeIsWrong(refused) ? t('globalViewer.codeWrong') : failureMessage('global viewer code', refused));
        return;
      }
      await refresh();
    } catch (e) {
      setError(failureMessage('global viewer code', e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, check };
}

/**
 * Setting up the authenticator: `start` clears an unfinished set-up left
 * before (so starting again never collides with it), then enrolls a new one.
 */
export function useAuthenticatorSetup(): {
  started: { factorId: string; uri: string; secret: string } | null; busy: boolean; error: string;
  start: () => Promise<void>; fail: (text: string) => void;
} {
  const [started, setStarted] = useState<{ factorId: string; uri: string; secret: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function start() {
    setBusy(true);
    setError('');
    try {
      for (const id of unfinishedSetups(await authenticatorFactors())) await unenrollAuthenticator(id);
      // i18n-ignore: the factor's name, kept on the server
      setStarted(await enrollAuthenticator('LangQuest'));
    } catch (e) {
      setError(failureMessage('global viewer setup', e));
    } finally {
      setBusy(false);
    }
  }
  return { started, busy, error, start, fail: setError };
}

/**
 * Every organization whose name, or a language's, holds `query`, a page at a
 * time (the query waits 300 ms after typing stops). `more` loads the next page.
 * `busy` from the moment a search is due until its answer is in, so a blank
 * list or an old "No organization matches" is not read as the answer (UI
 * audit, finding 78).
 */
export function useViewableOrganizations(query: string): {
  rows: ViewableOrganization[] | null; hasMore: boolean; error: string; busy: boolean; more: () => void; fail: (text: string) => void;
} {
  const [rows, setRows] = useState<ViewableOrganization[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const asked = useRef(0);
  async function load(q: string, after?: ViewableOrganization) {
    const mine = ++asked.current;
    setBusy(true);
    const { data, error: refused } = await globalViewerOrganizations(q, ORGANIZATIONS_PAGE, after ? { name: after.name, orgId: after.org_id } : undefined);
    if (mine !== asked.current) return;
    setBusy(false);
    if (refused) { setError(failureMessage('global viewer organizations', refused)); return; }
    setError('');
    const page = data ?? [];
    setRows((before) => (after ? [...(before ?? []), ...page] : page));
    setMore(hasMore(page));
  }
  useEffect(() => {
    setBusy(true);
    const timer = setTimeout(() => { void load(query.trim()); }, query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [query]);
  return { rows, hasMore: more, error, busy, more: () => { if (rows?.length) void load(query.trim(), rows[rows.length - 1]); }, fail: setError };
}
