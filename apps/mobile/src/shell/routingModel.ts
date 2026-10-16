import type { ScreenId } from './flow';
import { tabsFor, type Session } from './session';

/**
 * The section a web address named (a refresh), if this person may open it
 * there: one of their tabs, the Map where Status stands in for it, or a
 * language's page under the organization's. No organization: "Join your
 * team" is the only place to be (WEB-019). Pure, so it is tested without
 * rendering (test/routingModel.test.ts).
 */
export function addressSection(section: ScreenId | null, session: Session, wide: boolean): ScreenId | null {
  if (!section || session.hasNoOrg) return null;
  const tabScreens = tabsFor(session, undefined, { wide }).map((t) => t.screen);
  const allowed = tabScreens.includes(section)
    || (section === 'map_home' && tabScreens.some((t) => t === 'status_home' || t === 'map_home'))
    || (section === 'language_home' && tabScreens.includes('org_home'));
  return allowed ? section : null;
}

/**
 * Where a signed-in person's first screen left them, for diagnostics
 * (`auth` op `route`): in an organization, in none (the server listed
 * none), or somewhere while which organization is theirs is not known (the
 * list could not be read).
 */
export function routeOutcome(orgId: string | null, noOrganizations: boolean): 'home' | 'no_org' | 'org_unknown' {
  if (orgId) return 'home';
  return noOrganizations ? 'no_org' : 'org_unknown';
}

/**
 * When to ask again for this account's organizations after the list could
 * not be read (useOpenOrganization): soon at first, then less often, then
 * only when the phone wakes (back on screen, back online). Without it, a
 * phone new to the account that missed the list once sat on a blank screen.
 * `failures` counts the failures so far (1 after the first).
 */
const ORG_LIST_RETRY_MS = [2_000, 5_000, 15_000, 30_000, 60_000, 120_000, 300_000];
export function orgListRetryMs(failures: number): number | null {
  return failures >= 1 && failures <= ORG_LIST_RETRY_MS.length ? ORG_LIST_RETRY_MS[failures - 1]! : null;
}
