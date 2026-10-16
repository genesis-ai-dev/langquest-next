// Saving what a step shows (decisions.md 130): a switch flipped back is the
// way back, so there is no Undo (checks/ShowsSection.tsx, screens/checks.tsx).
import { checkShowsSpecs, type EventSpec } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import type { Ctx } from '../shell/ctx';
import type { ShowPart } from './showsModel';

/** Set several parts at once. */
export async function setParts(ctx: Ctx, kindId: string, parts: readonly ShowPart[], shown: boolean, message: string): Promise<void> {
  const s = ctx.language.state;
  if (!s) return;
  const commandId = Crypto.randomUUID();
  const changing = parts.filter((p) => p.on !== shown);
  const specs: EventSpec[] = changing.flatMap((p, i) => checkShowsSpecs(s, { commandId: `${commandId}:${i}`, kindId, what: p.what, shown, ...(p.from !== undefined ? { from: p.from } : {}) }));
  if (!specs.length) return;
  await ctx.act(specs, message).catch(() => {});
}
