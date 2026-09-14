import { actorRole, type ProjectState, type Role } from '@langquest-next/core';
import type { ScreenId } from './flow';

/**
 * Session facets derived from the fold (UX spec `domain/session.ts`), not
 * stored anywhere. Who you are is your membership role in the open project.
 */
export interface Session {
  actorId: string;
  email: string | null;
  role: Role | null;
  /** owner or coordinator: may configure and assign. */
  isAdmin: boolean;
  isWorker: boolean;
  isViewer: boolean;
  hasNoOrg: boolean;
  /** Has not yet accepted terms and seen the vision steps on this device. */
  isFirstTime: boolean;
}

export function deriveSession(
  actorId: string,
  email: string | null,
  state: ProjectState | null,
  seenVision: boolean
): Session {
  const role = state ? actorRole(state, actorId) : null;
  const isAdmin = role === 'owner' || role === 'coordinator';
  const isWorker = role === 'translator' || role === 'reviewer' || isAdmin;
  const isViewer = role === 'viewer';
  return {
    actorId,
    email,
    role,
    isAdmin,
    isWorker,
    isViewer,
    hasNoOrg: role === null,
    isFirstTime: !seenVision
  };
}

/** UX spec `homeScreenFor`: where Home goes for this session. */
export function homeScreenFor(s: Session): ScreenId {
  if (s.hasNoOrg) return 'intent_chooser';
  if (s.isViewer) return 'status_home';
  if (s.role === 'owner') return 'org_home';
  if (s.role === 'coordinator') return 'project_home';
  return 'assignments_home';
}

/** UX spec `postSignInScreen`: first-time users see terms, then vision. */
export function postSignInScreen(s: Session): ScreenId {
  return s.isFirstTime ? 'terms_privacy' : homeScreenFor(s);
}

/** Bottom tabs for signed-in users (spec: Home or My Work or Status, Status, Inbox, Settings). */
export function tabsFor(s: Session): ScreenId[] {
  const home = homeScreenFor(s);
  const tabs: ScreenId[] = [home];
  if (home !== 'status_home' && !s.hasNoOrg) tabs.push('status_home');
  tabs.push('inbox_home', 'settings_home');
  return tabs;
}
