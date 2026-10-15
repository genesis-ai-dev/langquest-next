// The choices behind the Map (decision 71; screens/map.tsx). Pure, so the
// rules are tested without a screen.
import { privilegesFor, type OrgState } from '@langquest-next/core';

/**
 * Languages this person may open: those a role of theirs covers, at the
 * organization's scope or the language's own. Opening any other leaves the
 * session with no privileges at all, which the app reads as having no
 * organization: no tabs and no home (NAV-042). Progress and the Map's
 * language chips list only these.
 */
export function openableLanguages<L extends { languageId: string }>(org: OrgState | null, actorId: string, languages: readonly L[]): L[] {
  if (!org) return [];
  return languages.filter((l) => privilegesFor(org, actorId, l.languageId).size > 0);
}

/**
 * A language's map says it needs a connection (MAP-033, decision 61): the
 * language showing is the one this phone has open, it has not been read from
 * the server this session, the server cannot be reached, and nothing of it is
 * on this device to show.
 */
export function needsConnection(o: { showing: string | null; open: string; pulled: boolean; online: boolean | null; empty: boolean }): boolean {
  return o.showing === o.open && !o.pulled && o.online === false && o.empty;
}
