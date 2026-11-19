import type { Ctx } from './ctx';

/** The web has no app lock (decisions.md 253), so More settings has no row for it. Phones take AppLockRow.tsx. */
export function AppLockRow(_props: { ctx: Ctx; last?: boolean }) {
  return null;
}
