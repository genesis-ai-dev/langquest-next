/**
 * How a window's width shapes the app (decisions.md 55). Pure, so the rules
 * are tested without a device: a phone keeps the demo's portrait layout
 * exactly; a tablet-wide window puts the tabs in a rail on the left and
 * centres a column; a desktop-wide one gets a labelled sidebar and shows a
 * list beside what it opened (panes.ts).
 */
import { TAB_SCREENS, type ScreenId } from './flow';
import { breakpoint, measure, space } from './theme';

export type LayoutKind = 'phone' | 'tablet' | 'desktop';

export function layoutKind(width: number): LayoutKind {
  if (width >= breakpoint.desktop) return 'desktop';
  if (width >= breakpoint.tablet) return 'tablet';
  return 'phone';
}

interface Frame {
  kind: LayoutKind;
  /** The rail or sidebar; 0 on a phone, whose tabs sit along the bottom. */
  chromeWidth: number;
  /** The list pane; 0 when nothing is split. */
  paneWidth: number;
  /** What is left for the stack. */
  detailWidth: number;
}

/** Splits a window into nav chrome, an optional list pane, and the stack. Panes only split a desktop-wide window. */
export function frame(width: number, opts: { chrome: boolean; split: boolean }): Frame {
  const kind = layoutKind(width);
  const chromeWidth = !opts.chrome || kind === 'phone' ? 0 : kind === 'tablet' ? measure.rail : measure.sidebar;
  const rest = Math.max(0, width - chromeWidth);
  const paneWidth = opts.split && kind === 'desktop'
    ? Math.min(measure.paneMax, Math.max(measure.paneMin, Math.round(rest * 0.4)))
    : 0;
  return { kind, chromeWidth, paneWidth, detailWidth: rest - paneWidth };
}

/**
 * Chapters across in a book's grid: the demo's five on a phone; on a wider
 * column, as many tiles of about `chapterTile` as fit, so they stay tile-sized.
 */
export function chapterColumns(contentWidth: number, kind: LayoutKind): number {
  if (kind === 'phone') return 5;
  const inner = Math.min(contentWidth, measure.column) - 2 * space.lg;
  const fit = Math.floor((inner + space.sm) / (measure.chapterTile + space.sm));
  return Math.min(10, Math.max(5, fit));
}

/**
 * Drill-downs under Manage and Settings that keep the rail or sidebar on a
 * wide window, so it does not vanish while a list and its editor sit side by
 * side. Task screens (recording, reviewing, asking, signing in) still hide it
 * at any width (ADR-021).
 */
export const WIDE_CHROME: readonly ScreenId[] = [
  'members_list', 'edit_member', 'invite_member', 'invite_qr', 'new_language', 'review_teams', 'review_team_editor',
  'roles_home', 'role_editor', 'flows_home', 'flow_editor', 'templates_home', 'template_picker', 'template_editor', 'book_structure',
  'reference_home', 'material_editor', 'guide_editor', 'key_terms', 'key_term_detail', 'profile_edit', 'org_switcher', 'sync_status',
  'reference_bibles', 'reference_source', 'reference_guides', 'reference_coverage',
  // The Reports tab exists only on a wide window (decisions.md 57).
  'reports_home', 'reports_language'
];

/** Whether the tabs (bar, rail or sidebar) show on this screen. On a phone, exactly the demo's tab screens. */
export function chromeVisible(kind: LayoutKind, screen: ScreenId): boolean {
  if (TAB_SCREENS.includes(screen)) return true;
  return kind !== 'phone' && WIDE_CHROME.includes(screen);
}
