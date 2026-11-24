import type { Ctx } from '../shell/ctx';

/**
 * Me's reminder that recordings are only on this phone (docs/nearby-sync-plan.md 15.5;
 * useOnlyHereNote.native.ts). The web shares nothing nearby, so it never says it, and a first
 * visit carries only this.
 */
export function useOnlyHereNote(_ctx: Ctx): { line: string; help: string } | null {
  return null;
}
