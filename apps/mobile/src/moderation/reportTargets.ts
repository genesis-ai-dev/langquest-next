// What a report is about, and how it names who wrote it (moderation/reportSheet.tsx).
import type { Ctx } from '../shell/ctx';
import { hiddenText, type ReportKind, type ReportTarget } from './model';

/** A piece of the open language's record, as something to report. */
export function recordTarget(ctx: Ctx, kind: Exclude<ReportKind, 'person'>, id: string, by: string, unitId?: string): ReportTarget {
  return { kind, id, profileId: by, orgId: ctx.language.orgId, languageId: ctx.language.languageId, ...(unitId ? { unitId } : {}) };
}

/** Someone's words in a line of text, unless this person blocked them. */
export function authoredText(ctx: Ctx, by: string | undefined, text: string): string {
  return by && by !== ctx.session.actorId && ctx.blocks.has(by) ? hiddenText() : text;
}
