import type { Ctx } from './ctx';

/**
 * Sharing while LangQuest is open, which only a phone does (docs/nearby-sync-plan.md 15.6;
 * NearbyWhileOpen.native.tsx, Android and iPhones). A plain stub, so the web build carries none of it.
 */
export function NearbyWhileOpen(_props: { ctx: Ctx }) {
  return null;
}
