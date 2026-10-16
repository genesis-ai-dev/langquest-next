// Saving what a step shows (decisions.md 128), with Undo (checks/ShowsSection.tsx, screens/checks.tsx).
import { checkShowsSpecs, type EventSpec, type LanguageState } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import type { Ctx } from '../shell/ctx';
import type { ShowPart } from './showsModel';

/** Set several parts at once, with one Undo that puts each back. */
export async function setParts(ctx: Ctx, kindId: string, parts: readonly ShowPart[], shown: boolean, message: string): Promise<void> {
  const s = ctx.language.state;
  if (!s) return;
  const commandId = Crypto.randomUUID();
  const changing = parts.filter((p) => p.on !== shown);
  const specs: EventSpec[] = changing.flatMap((p, i) => checkShowsSpecs(s, { commandId: `${commandId}:${i}`, kindId, what: p.what, shown, ...(p.from !== undefined ? { from: p.from } : {}) }));
  if (!specs.length) return;
  const undo = () => {
    const now: LanguageState | null = ctx.language.state;
    return now ? changing.flatMap((p, i) => checkShowsSpecs(now, { commandId: `${commandId}:undo:${i}`, kindId, what: p.what, shown: !shown, ...(p.from !== undefined ? { from: p.from } : {}) })) : [];
  };
  await ctx.act(specs, message, undo).catch(() => {});
}

