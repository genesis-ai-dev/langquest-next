// Getting a language ready, read from the record (decision 71, demo
// ADR-039): which of the four questions are answered, what each answer says
// in plain words, who translates there and who is waiting to be let in. The
// language's page (screens/org.tsx LanguageHome) and Get ready
// (screens/getReady.tsx) both read it, so they always agree.
import { View } from 'react-native';
import type { Ctx } from '../shell/ctx';
import { space } from '../ui/theme';
import { ChecklistRow } from './admin';
import { QUESTIONS, questionLabel } from './adminModel';
import { type ReadySummary } from './useReadySummary';

/** The four questions as a checklist; each opens its own step screen. */
export function ReadyChecklist(props: { ctx: Ctx; s: ReadySummary }) {
  const { ctx, s } = props;
  return (
    <View style={{ gap: space.md }}>
      {QUESTIONS.map((q, i) => (
        <ChecklistRow key={q.id} icon={q.icon} label={questionLabel(q.id)} sub={s.lines[i]}
          state={s.readiness.done[i] ? 'done' : i === s.readiness.current ? 'now' : 'later'}
          onPress={() => ctx.go('get_ready', { languageId: s.languageId, step: String(i + 1) })} />
      ))}
    </View>
  );
}
