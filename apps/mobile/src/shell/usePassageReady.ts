import { useRef } from 'react';
import type { Ctx } from './ctx';

/**
 * Does a screen about one passage have that passage's whole record in
 * memory yet? A language kept on disk (decisions.md 143) brings a passage
 * in when it opens (`usePassagesInMemory`), and until then the state holds
 * only part of it: drawn early, a recorded passage would read as not
 * started. Asked until the passage first arrives; a screen once shown
 * stays, even if a later passage pushes this one out of memory behind it.
 */
export function usePassageReady(ctx: Ctx | null, params: Record<string, string> | undefined): 'ready' | 'waiting' | 'notHere' {
  const shown = useRef(false);
  if (shown.current || !ctx) return 'ready';
  const unitId = params?.['unitId'];
  const languageId = params?.['languageId'] ?? ctx.language.languageId;
  const waiting = !!unitId && languageId === ctx.language.languageId && !!ctx.language.state?.units[unitId] && !ctx.language.isLoaded(unitId);
  if (!waiting) {
    shown.current = true;
    return 'ready';
  }
  // A passage whose rows are still on the server, with no connection to fetch them (decisions.md 147): say so rather than wait.
  return ctx.language.online === false && !ctx.language.isFilled(unitId) ? 'notHere' : 'waiting';
}
