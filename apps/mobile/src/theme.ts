/**
 * The UX demo's palette (ng-langquest-ux `C` and `TINT`, ADR-010) with its
 * purple brand replaced by black on white (decisions.md 49): black is the
 * one brand colour on a neutral grey ground, and status colours never change
 * with the brand (green looks good, amber needs changes or waiting, red is
 * danger). Every control is at least 48pt, primary actions 56pt, text at
 * least 13pt and body 17pt (ADR-008).
 */
export const C = {
  primary: '#000000',
  /** Lighter partner of primary, for step bars and gradients. */
  soft: '#8A8A8A',
  bg: '#F5F5F5',
  dark: '#0A0A0A',
  muted: '#6B6B6B',
  border: '#E5E5E5',
  card: '#FFFFFF',
  light: '#EDEDED',
  /** Placeholder icons and locked marks on white. */
  faint: '#C4C4C4',
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
  gray: '#F2F2F2',
  grayText: '#5C5C5C',
  note: '#FFFBEA',
  noteBorder: '#F5E6B0'
} as const;

/**
 * The previous token names, kept so screens written against them take the
 * new look without a rewrite. New code uses `C` and `TINT`.
 */
export const colors = {
  background: C.bg,
  foreground: C.dark,
  card: C.card,
  muted: C.bg,
  mutedForeground: C.muted,
  border: C.border,
  action: C.primary,
  actionForeground: C.white,
  translate: C.primary,
  review: C.primary,
  reference: C.amber,
  done: C.green,
  danger: C.red,
  white: C.white
} as const;

export const tint = {
  translate: C.light,
  review: C.light,
  translateBadge: C.light,
  reviewBadge: C.light,
  reviewChip: C.light,
  done: TINT.green,
  doneBorder: 'rgba(16, 185, 129, 0.25)',
  translateBar: 'rgba(0, 0, 0, 0.35)',
  reviewBar: 'rgba(0, 0, 0, 0.35)',
  mutedContainer: 'rgba(245, 245, 245, 0.70)'
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

export const shadow = {
  shadowColor: '#000000',
  shadowOpacity: 0.06,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 },
  elevation: 2
} as const;
