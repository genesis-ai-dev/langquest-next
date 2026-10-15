// The icon for a kind of work (ui/kit.tsx).
import { type IconName } from './kit';

/** The icon each shipped review kind reads by (the demo's REVIEW_KINDS icons). */
export function kindIcon(kindId: string): IconName {
  return ({ peer: 'people', bt: 'swap', community: 'globe', consultant: 'check', final: 'star', retell: 'chat', local: 'place' } as Record<string, IconName>)[kindId] ?? 'chat';
}
