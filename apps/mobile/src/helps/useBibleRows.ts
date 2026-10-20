// A passage's verses in the Bible the team member chose (useBible.ts's
// choice), without its player: what a check's library notes are headed
// with where that Bible is word-aligned (libraryHelpsModel.ts noteQuote).
import type { Ctx } from '../shell/ctx';
import { choiceKey } from '../sources/sourceText';
import { useChoice } from '../sources/useSourceChoice';
import { usePassageSource, useSources } from '../sources/useSources';

export function useBibleRows(ctx: Ctx, unitId: string | null, languageId: string | null) {
  const passage = useSources(ctx, unitId, languageId);
  const [chosen] = useChoice(choiceKey(ctx.session.actorId, ctx.language.orgId, languageId ?? ''));
  const option = passage.options.find((o) => o.itemId === chosen) ?? passage.options[0];
  const src = usePassageSource(ctx, option, passage);
  return { source: option?.doc ?? null, rows: src?.rows ?? null };
}
