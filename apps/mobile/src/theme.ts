/**
 * Palette ported from the LangQuest v2 "task-first" prototype (commit
 * 2fe8e1e5). One yellow action per screen; blue = translate, teal = review,
 * orange = reference material, green = done. Tints are the same hues at 6%
 * so a card or row reads by its shading before its icon.
 */
export const colors = {
  background: '#FAF9F7',
  foreground: '#252A37',
  card: '#FFFFFF',
  muted: '#F2F0EC',
  mutedForeground: '#676D7E',
  border: '#DDE0E8',
  action: '#FDC317',
  actionForeground: '#1D212B',
  translate: '#0A5ADB',
  review: '#228FA0',
  reference: '#F3751B',
  done: '#29A376',
  danger: '#D93025',
  white: '#FFFFFF'
} as const;

export const tint = {
  translate: 'rgba(10, 90, 219, 0.06)',
  review: 'rgba(34, 143, 160, 0.06)',
  translateBadge: 'rgba(10, 90, 219, 0.15)',
  reviewBadge: 'rgba(34, 143, 160, 0.15)',
  reviewChip: 'rgba(34, 143, 160, 0.10)',
  done: 'rgba(41, 163, 118, 0.06)',
  doneBorder: 'rgba(41, 163, 118, 0.25)',
  translateBar: 'rgba(10, 90, 219, 0.40)',
  reviewBar: 'rgba(34, 143, 160, 0.40)',
  mutedContainer: 'rgba(242, 240, 236, 0.70)'
} as const;

export const radius = { md: 12, lg: 16, xl: 20, full: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
