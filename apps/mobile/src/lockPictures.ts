// i18n-ignore-file: pictures, not words; each has a spoken label in the catalogs (shell.pattern.picture).
/**
 * What a person taps on Sign In to find themselves on a shared phone before
 * drawing their pattern (decision 88): things people know in any language
 * and culture, drawn by the phone's own emoji font, all old enough to show on
 * phones from 2016 on. Stored by position, so the order never changes; add
 * new ones at the end.
 */
export const PICTURES = ['🐘', '🐟', '🐦', '🐢', '🐝', '🦋', '🌳', '🌻', '🌙', '⭐', '☀️', '🍌', '🍉', '⚽', '🏠', '🚲'] as const;

export function isPicture(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < PICTURES.length;
}
