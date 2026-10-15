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
