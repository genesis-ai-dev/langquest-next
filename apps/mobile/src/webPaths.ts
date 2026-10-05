import { TITLES, type ScreenId } from './flow';
import type { Route } from './nav';

/**
 * The web app's addresses (webHistory.ts, decisions.md 58): pure, so tested
 * without React Native. An address names a section, never a screen's params.
 */
export const SECTION_PATHS: Partial<Record<ScreenId, string>> = {
  my_work: '/work',
  status_home: '/map',
  map_home: '/map/language',
  reports_home: '/reports',
  org_home: '/manage',
  language_home: '/manage/language',
  inbox_home: '/inbox',
  settings_home: '/settings'
};

export function pathFor(stack: readonly Route[]): string {
  const bottom = stack[0]?.screen;
  return (bottom && SECTION_PATHS[bottom]) || '/';
}

/** The section a path names, or null; the caller still checks the person may open it. */
export function sectionOfPath(path: string): ScreenId | null {
  const clean = path.replace(/\/+$/, '') || '/';
  for (const [screen, p] of Object.entries(SECTION_PATHS) as [ScreenId, string][]) if (p === clean) return screen;
  return null;
}

export function titleFor(screen: ScreenId): string {
  return `${TITLES[screen]} · LangQuest`;
}
