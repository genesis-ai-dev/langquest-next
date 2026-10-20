// A check page opened with `draft: '1'` works on New language's draft (decisions.md 145).
import { useMemo } from 'react';
import type { Ctx } from '../shell/ctx';
import { draftCtx, goneCtx } from './draftCtx';
import { useChecksDraft } from './useChecksDraft';

export function useDraftAware(ctx: Ctx): Ctx {
  const snap = useChecksDraft();
  const on = ctx.params['draft'] === '1';
  return useMemo(() => (!on ? ctx : snap ? draftCtx(ctx, snap) : goneCtx(ctx)), [ctx, on, snap]);
}
