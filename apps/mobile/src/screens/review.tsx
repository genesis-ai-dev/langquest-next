// Avatar U. Review passage, review questions, done. Material editor is Avatar P.
import { deriveTakeStatus } from '@langquest-next/core';
import { BookOpen, Check, MessageSquare, Play, RotateCcw, Users } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Ctx } from '../ctx';
import { Footer, Header, Note, Row, Screen, Section } from '../pui';
import { colors, radius, space, tint } from '../theme';
import { ActionButton, BackButton, Card, StatusIcon, text } from '../ui';
import { taskFor } from './translate';

/** Answers live here between review_questions and review_passage (screen-local, not synced). */
const draftAnswers = new Map<string, Record<string, string>>();

export function ReviewPassage(ctx: Ctx) {
  const { state, append } = ctx.project;
  const task = taskFor(ctx);
  const [changing, setChanging] = useState(false);
  if (!state || !task || !task.takeId) return <Note>Task not found.</Note>;
  const takeId = task.takeId;
  const take = state.takes[takeId];
  const status = deriveTakeStatus(state, takeId);
  const stepId = task.id.split(':')[3]!;
  const step = status.steps.find((s) => s.stepId === stepId);
  const mine = state.reviews[takeId]?.[stepId]?.[ctx.session.actorId]?.value;
  const questionSets = state.submissions[takeId]?.questionSetIds ?? [];
  const answered = questionSets.length === 0 || draftAnswers.has(takeId);
  const showButtons = !mine || changing;

  async function decide(decision: 'approve' | 'suggest_changes') {
    const answers = draftAnswers.get(takeId);
    await append('v1.ReviewSubmitted', { takeId, stepId, decision, ...(answers ? { answers } : {}) });
    draftAnswers.delete(takeId);
    setChanging(false);
    ctx.go('done_await');
  }

  return (
    <View style={[styles.screen, { backgroundColor: tint.review }]}>
      <View style={styles.content}>
        <BackButton onPress={ctx.back} />
        <View style={styles.titleRow}>
          <BookOpen size={22} color={colors.review} />
          <Text style={[text.h3, { flex: 1 }]}>{state.units[task.unitId]?.label}</Text>
        </View>

        <Card>
          <View style={styles.chip} accessibilityLabel="Play take">
            <View style={styles.chipPlay}>
              <Play size={14} color={colors.white} />
            </View>
            <Text style={text.body}>{take?.cardHashes.length ?? 0}</Text>
          </View>
          <View style={styles.chips}>
            <View style={styles.chip} accessibilityLabel={`waiting on ${step?.waitingOn.length ?? 0}`}>
              <Users size={14} color={colors.mutedForeground} />
              <Text style={text.small}>{step?.waitingOn.length ?? 0}</Text>
            </View>
            <View style={styles.chip} accessibilityLabel={`status ${status.outcome}`}>
              <StatusIcon outcome={status.outcome} size={16} />
              {mine ? mine.decision === 'approve' ? <Check size={14} color={colors.done} /> : <MessageSquare size={14} color={colors.review} /> : null}
            </View>
          </View>
        </Card>

        {questionSets.length > 0 ? (
          <ActionButton
            icon={answered ? Check : MessageSquare}
            accessibilityLabel={answered ? 'Edit answers' : 'Answer questions'}
            variant={answered ? 'outline' : 'action'}
            onPress={() => ctx.go('review_questions', { taskId: task.id })}
          />
        ) : null}

        {showButtons ? (
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <ActionButton icon={MessageSquare} accessibilityLabel="Suggest changes" variant="outline" onPress={() => void decide('suggest_changes')} disabled={!answered} style={{ flex: 1 }} />
            <ActionButton icon={Check} accessibilityLabel="Approve" onPress={() => void decide('approve')} disabled={!answered} style={{ flex: 1 }} />
          </View>
        ) : (
          <ActionButton icon={RotateCcw} accessibilityLabel="Change decision" variant="outline" onPress={() => setChanging(true)} />
        )}
      </View>
    </View>
  );
}

export function ReviewQuestions(ctx: Ctx) {
  const { state } = ctx.project;
  const task = taskFor(ctx);
  const takeId = task?.takeId ?? '';
  const [answers, setAnswers] = useState<Record<string, string>>(draftAnswers.get(takeId) ?? {});
  if (!state || !task) return <Note>Task not found.</Note>;
  const sets = (state.submissions[takeId]?.questionSetIds ?? []).map((id) => state.references[id]).filter(Boolean);
  const questions = sets.flatMap((s, si) => (s!.text ?? '').split('\n').slice(1).map((q, qi) => ({ id: `${si}:${qi}`, text: q })));

  function save() {
    draftAnswers.set(takeId, answers);
    ctx.back();
  }

  return (
    <Screen footer={<Footer label="Save answers" onPress={save} />}>
      <Header title="Review questions" onBack={ctx.back} />
      {questions.length === 0 ? <Note>The attached sets have no questions.</Note> : null}
      {questions.map((q) => (
        <Card key={q.id}>
          <Text style={text.body}>{q.text}</Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {['Yes', 'Partly', 'No'].map((v) => (
              <Pressable
                key={v}
                onPress={() => setAnswers((a) => ({ ...a, [q.id]: v }))}
                style={[styles.opt, answers[q.id] === v && { backgroundColor: colors.translate }]}
              >
                <Text style={[text.small, answers[q.id] === v && { color: colors.white }]}>{v}</Text>
              </Pressable>
            ))}
          </View>
        </Card>
      ))}
    </Screen>
  );
}

export function DoneAwait(ctx: Ctx) {
  return (
    <View style={[styles.screen, styles.center, { backgroundColor: colors.background }]}>
      <View style={styles.doneMark}>
        <Check size={44} color={colors.done} />
      </View>
      <ActionButton icon={Check} accessibilityLabel="Back to my work" onPress={() => ctx.go('assignments_home')} style={{ alignSelf: 'stretch' }} />
    </View>
  );
}

/** Avatar P. Fill or edit a reference item; a new one is attached to the unit in params. */
export function MaterialEditor(ctx: Ctx) {
  const { state, append } = ctx.project;
  const refId = ctx.params['refId'];
  const existing = refId && state ? state.references[refId] : undefined;
  const unitId = ctx.params['unitId'] ?? existing?.unitId ?? '';
  const [kind, setKind] = useState(existing?.kind ?? 'tg');
  const [body, setBody] = useState(existing?.text ?? '');
  async function save() {
    await append('v1.ReferenceAttached', { unitId, refId: `ref-${Date.now()}`, kind, text: body.trim() });
    ctx.back();
  }
  return (
    <Screen footer={<Footer label="Save changes" onPress={() => void save()} disabled={!body.trim() || !unitId} />}>
      <Header title="Fill reference" sub={state?.units[unitId]?.label ?? unitId} onBack={ctx.back} />
      <Section label="Kind">
        {['key_terms', 'tg', 'tvp', 'tr', 'review_questions'].map((k, i, a) => (
          <Row key={k} label={k.replace('_', ' ')} onPress={() => setKind(k)} right={kind === k ? <Check size={18} color={colors.translate} /> : <View />} last={i === a.length - 1} />
        ))}
      </Section>
      <Note>For review questions, put the title on the first line and one question per line after it.</Note>
      <TextInput style={styles.input} placeholder="Content" value={body} onChangeText={setBody} multiline />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.xl },
  content: { gap: space.lg, padding: space.lg },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, borderRadius: radius.full, backgroundColor: tint.reviewChip, paddingVertical: 6, paddingLeft: 6, paddingRight: space.md },
  chipPlay: { width: 28, height: 28, borderRadius: radius.full, backgroundColor: colors.review, alignItems: 'center', justifyContent: 'center' },
  doneMark: { width: 96, height: 96, borderRadius: 20, backgroundColor: 'rgba(41, 163, 118, 0.12)', alignItems: 'center', justifyContent: 'center' },
  opt: { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.md, backgroundColor: colors.muted },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, minHeight: 140, backgroundColor: colors.card, color: colors.foreground }
});
