/**
 * The UX demo's palette (ng-langquest-ux `C` and `TINT`, ADR-010): one brand
 * colour on a soft lavender ground, and status colours that never change
 * with the brand (green looks good, amber needs changes or waiting, red is
 * danger). Every control is at least 48pt, primary actions 56pt, text at
 * least 13pt and body 17pt (ADR-008).
 */
export const C = {
  primary: '#6B48C8',
  /** Lighter partner of primary, for step bars and gradients. */
  soft: '#8B6FE8',
  bg: '#F4F2FA',
  dark: '#1C1440',
  /** The demo's #7D72A8 darkened to read at 4.5:1 on white, the ground and `light` (WCAG AA; decisions.md 58). */
  muted: '#6E629E',
  border: '#E6E2F3',
  card: '#FFFFFF',
  light: '#F0EAFF',
  /** Placeholder icons and locked marks on white. */
  faint: '#C4BEDC',
  green: '#10B981',
  amber: '#F59E0B',
  red: '#EF4444',
  white: '#FFFFFF'
} as const;

/** Status tints: a pale ground and the text colour that reads on it. */
export const TINT = {
  green: '#E7F8F1',
  greenText: '#047857',
  amber: '#FEF4E2',
  amberText: '#B45309',
  red: '#FDECEC',
  redText: '#B91C1C',
  gray: '#F1F0F5',
  grayText: '#6B6785',
  note: '#FFFBEA',
  noteBorder: '#F5E6B0'
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, sheet: 28, full: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Type scale for the field (ADR-008): nothing under 13, body 17. */
export const type = {
  xs: 13,
  sm: 15,
  base: 17,
  lg: 19,
  xl: 22,
  xxl: 26,
  /** Welcome and entry headlines. */
  display: 30
} as const;

/** Minimum touch targets. */
export const target = { min: 48, primary: 56, row: 64 } as const;

/** Sizes of the icon tile beside a row or card title. */
export const tile = { sm: 44, md: 48, lg: 56 } as const;

/**
 * Window widths where the layout changes (decisions.md 55). A phone is
 * always under `tablet`, so phones keep the demo's layout exactly; wider
 * windows get a side rail, then a sidebar and list–detail panes.
 */
export const breakpoint = { tablet: 768, desktop: 1100 } as const;

/** Widths on wide windows: the content column, a sheet shown as a dialog, footer actions, nav chrome, the list pane. */
export const measure = {
  column: 720, sheet: 560, action: 360, toast: 480, rail: 88, sidebar: 248, paneMin: 320, paneMax: 400, chapterTile: 72,
  /** Reports read across a wide window: tables and charts side by side. */
  report: 1120
} as const;

/**
 * Filled buttons in a status colour carry white text, which the bright
 * status colours cannot hold at 4.5:1; these deeper shades can. The hue (and
 * its meaning) stays the same.
 */
export const onColor = { green: '#047857', amber: '#B45309', red: '#B91C1C' } as const;

/** A token colour at an opacity, instead of pasting hex alpha onto it. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

