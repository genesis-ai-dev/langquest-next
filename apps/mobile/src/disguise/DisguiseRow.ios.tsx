import type { Ctx } from '../shell/ctx';

/** An iPhone has no App icon row (decisions.md 171, amended 2026-11-03): DisguiseRow.tsx is Android's. */
export function DisguiseRow(_props: { ctx: Ctx; last?: boolean }) {
  return null;
}
