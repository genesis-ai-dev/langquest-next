/**
 * How a window's width shapes the app (decisions.md 55). Pure, so the rules
 * are tested without a device: a phone keeps the demo's portrait layout
 * exactly; a tablet-wide window puts the tabs in a rail on the left and
 * centres a column; a desktop-wide one gets a labelled sidebar and shows a
 * list beside what it opened (panes.ts).
 */
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
 * Chapters across in a book's grid: four on a phone (the demo had five); on a wider
 * column, as many tiles of about `chapterTile` as fit, so they stay tile-sized.
 */
export function chapterColumns(contentWidth: number, kind: LayoutKind): number {
  // Four across on a phone: each tile big enough for a thumb and its download button (decisions.md 166).
  if (kind === 'phone') return 4;
  const inner = Math.min(contentWidth, measure.column) - 2 * space.lg;
  const fit = Math.floor((inner + space.sm) / (measure.chapterTile + space.sm));
  return Math.min(8, Math.max(4, fit));
}
