// The key-word lists' words on a passage as a check shows them (decision
// 149): every list word there, the team's own included, found in the Bible
// this person reads (the one chosen last for the language) as well as by
// the lists' own links, so each word can say its verses.
import type { Ctx } from '../shell/ctx';
import { choiceKey } from '../sources/sourceText';
import { useChoice } from '../sources/useSourceChoice';
import { usePassageSource, useSources } from '../sources/useSources';
import { usePassageKeyWords, type PassageKeyWords } from './usePassageKeyWords';

export function useCheckKeyWords(ctx: Ctx, unitId: string | null | undefined): PassageKeyWords {
  const sources = useSources(ctx, unitId ?? null, ctx.language.languageId);
  const [chosen] = useChoice(choiceKey(ctx.session.actorId, ctx.language.orgId, ctx.language.languageId ?? ''));
  const option = sources.options.find((o) => o.itemId === chosen) ?? sources.options[0];
  const bible = usePassageSource(ctx, option, sources);
  return usePassageKeyWords(ctx, unitId, { includeOwn: true, rows: bible?.rows ?? null, rowsLanguage: option?.language ?? null });
}
