/**
 * How a person is shown: display name when they set one, otherwise an
 * anonymous label ("Teal Diamond"). Colour and shape come from a hash of the
 * id, so every device derives the same look without syncing anything.
 * Labels are colours and shapes only: nothing that can read as an insult in
 * any culture, unlike animal names. The label is said in the language
 * showing; the colour and shape it names are the same on every device.
 */
import { t } from './i18n';

export const PERSON_COLORS = [
  { id: 'blue', hex: '#2563EB' },
  { id: 'teal', hex: '#0F8B8D' },
  { id: 'green', hex: '#2F9E44' },
  { id: 'amber', hex: '#B7791F' },
  { id: 'orange', hex: '#DD6B20' },
  { id: 'rose', hex: '#D6336C' },
  { id: 'purple', hex: '#7048E8' },
  { id: 'slate', hex: '#495057' }
] as const;
export const PERSON_SHAPES = ['circle', 'square', 'diamond', 'triangle', 'hexagon'] as const;
type PersonShape = typeof PERSON_SHAPES[number];

export interface PersonLook {
  id: string;
  /** Display name, or the anonymous label when none is set. */
  name: string;
  anonymous: boolean;
  color: string;
  /** Named people get a circle with initials; anonymous ones their shape. */
  shape: PersonShape;
  initials?: string;
}

/** FNV-1a: stable, fast, no dependencies. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** First two letters (code points, so non-Latin scripts are not split). */
export function initials(name: string): string {
  const letters = Array.from(name.trim()).filter((c) => c.trim() !== '');
  return (letters[0]?.toUpperCase() ?? '') + (letters[1] ?? '');
}

export function personLook(id: string, displayName?: string | null): PersonLook {
  const h = hash(id);
  const color = PERSON_COLORS[h % PERSON_COLORS.length]!;
  const shape = PERSON_SHAPES[Math.floor(h / PERSON_COLORS.length) % PERSON_SHAPES.length]!;
  const name = displayName?.trim();
  if (name) return { id, name, anonymous: false, color: color.hex, shape: 'circle', initials: initials(name) };
  return { id, name: t('shell.person.anonymous', { color: t(`shell.person.colors.${color.id}`), shape: t(`shell.person.shapes.${shape}`) }), anonymous: true, color: color.hex, shape };
}
