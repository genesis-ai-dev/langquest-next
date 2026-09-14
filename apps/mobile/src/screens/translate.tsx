// Avatar U. Translate passage, recordings, key terms, add to TG, attach questions. One yellow action per screen.
import { currentTake, deriveTakeStatus, deriveTasks, takesFor, type Task } from '@langquest-next/core';
import { BookOpen, Check, KeyRound, ListMusic, MessageSquare, Mic, Plus, RotateCcw, Send } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Ctx } from '../ctx';
import { Footer, Header, Note, Row, Screen, Section } from '../pui';
import { colors, radius, space, tint } from '../theme';
import { ActionButton, BackButton, Card, StatusIcon, TASK_META, text } from '../ui';

export function taskFor(ctx: Ctx): Task | undefined {
  const { state } = ctx.project;
  if (!state) return undefined;
  return deriveTasks(state, ctx.session.actorId).find((t) => t.id === ctx.params['taskId']);
}

export function TranslatePassage(ctx: Ctx) {
  const { state } = ctx.project;
  const task = taskFor(ctx);
  if (!state || !task) return <Note>Task not found.</Note>;
  const meta = TASK_META[task.type];
  const unit = state.units[task.unitId];
  const refs = Object.values(state.references).filter((r) => r.unitId === task.unitId && r.kind !== 'review_questions');
  const takeId = currentTake(state, task.unitId, task.laneId);
  const status = takeId ? deriveTakeStatus(state, takeId) : null;
  const count = takesFor(state, task.unitId, task.laneId).length;
  const isDraft = status?.outcome === 'draft';
  const suggestions = takeId
    ? Object.values(state.reviews[takeId] ?? {}).flatMap((byActor) =>
        Object.values(byActor).filter((r) => r.value.decision === 'suggest_changes').map((r) => r.value.comment)
      )
    : [];

  return (
    <View style={[styles.screen, { backgroundColor: meta.tint }]}>
      <View style={styles.content}>
        <BackButton onPress={ctx.back} />
        <View style={styles.titleRow}>
          <BookOpen size={22} color={meta.color} />
          <Text style={[text.h3, { flex: 1 }]}>{unit?.label ?? task.unitId}</Text>
          {task.dueDate ? <Text style={text.small}>{task.dueDate}</Text> : null}
        </View>

        {task.instructions ? (
          <Card style={{ backgroundColor: colors.muted }}>
            <Text style={text.body}>{task.instructions}</Text>
          </Card>
        ) : null}

        {suggestions.length > 0 ? (
          <Card style={{ backgroundColor: tint.review }}>
            <View style={styles.titleRow}>
              <MessageSquare size={18} color={colors.review} />
              <Text style={text.h4}>{suggestions.length}</Text>
            </View>
            {suggestions.map((c, i) => (
              <Text key={i} style={text.body}>
                {c ?? '…'}
              </Text>
            ))}
          </Card>
        ) : null}

        {/* Recordings: the mic is the yellow action until a draft exists. */}
        <Pressable onPress={() => ctx.go('quest_assets', { taskId: task.id })} accessibilityRole="button" accessibilityLabel="Recordings">
          <Card style={{ alignItems: 'center', gap: space.md }}>
            <View style={styles.titleRow} accessibilityLabel={`${count} takes${status ? `, ${status.outcome}` : ''}`}>
              <ListMusic size={16} color={colors.mutedForeground} />
              <Text style={text.small}>{count}</Text>
              {status ? <StatusIcon outcome={status.outcome} /> : null}
            </View>
            <ActionButton
              icon={takeId ? RotateCcw : Mic}
              accessibilityLabel="Open recordings"
              variant={takeId ? 'outline' : 'action'}
              onPress={() => ctx.go('quest_assets', { taskId: task.id })}
              style={{ alignSelf: 'stretch' }}
            />
          </Card>
        </Pressable>

        <Pressable onPress={() => ctx.go('key_terms', { unitId: task.unitId })} accessibilityRole="button" accessibilityLabel="Key terms">
          <Card style={{ backgroundColor: tint.translate }}>
            <View style={styles.titleRow}>
              <KeyRound size={18} color={colors.reference} />
              <Text style={text.h4}>{refs.length}</Text>
              <View style={{ flex: 1 }} />
              <Pressable onPress={() => ctx.go('add_to_tg', { unitId: task.unitId })} hitSlop={8} accessibilityLabel="Add to translation guidelines">
                <Plus size={18} color={colors.reference} />
              </Pressable>
            </View>
            {refs.map((r, i) => (
              <View key={i} style={styles.refRow}>
                <Text style={text.small}>{r.kind.replace('_', ' ')}</Text>
                <Text style={text.body}>{r.text ?? r.blobHash}</Text>
              </View>
            ))}
          </Card>
        </Pressable>

        {isDraft ? (
          <ActionButton icon={Send} accessibilityLabel="Submit for review" onPress={() => ctx.go('attach_questions', { taskId: task.id })} />
        ) : null}
      </View>
    </View>
  );
}

/** Spec attach_questions: pick question sets (reference material) to send with the submission. */
export function AttachQuestions(ctx: Ctx) {
  const { state, append } = ctx.project;
  const task = taskFor(ctx);
  const [picked, setPicked] = useState<string[]>([]);
  if (!state || !task) return <Note>Task not found.</Note>;
  const sets = Object.entries(state.references).filter(([, r]) => r.kind === 'review_questions');
  const takeId = currentTake(state, task.unitId, task.laneId);

  async function submit() {
    if (!takeId) return;
    await append('v1.TakeSubmitted', { takeId, questionSetIds: picked });
    ctx.go('done_await');
  }

  return (
    <Screen footer={<ActionButton icon={Send} accessibilityLabel="Submit for review" onPress={() => void submit()} />}>
      <Header title="Review questions" onBack={ctx.back} />
      {sets.length === 0 ? <Note>No question sets yet. Submit without questions, or add one from the reference library.</Note> : null}
      {sets.length > 0 ? (
        <Section label={`Question sets · ${sets.length}`}>
          {sets.map(([id, r], i) => (
            <Row
              key={id}
              label={r.text?.split('\n')[0] ?? id}
              onPress={() => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
              right={picked.includes(id) ? <Check size={18} color={colors.translate} /> : <View />}
              last={i === sets.length - 1}
            />
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}

/** Spec add_to_tg: a translator adds a guideline note for this passage. */
export function AddToTg(ctx: Ctx) {
  const { append } = ctx.project;
  const [note, setNote] = useState('');
  const unitId = ctx.params['unitId'] ?? '';
  async function save() {
    await append('v1.ReferenceAttached', { unitId, refId: `tg-${Date.now()}`, kind: 'tg', text: note.trim() });
    ctx.back();
  }
  return (
    <Screen footer={<Footer label="Done" onPress={() => void save()} disabled={!note.trim()} />}>
      <Header title="Add to TG" onBack={ctx.back} />
      <TextInput style={styles.input} placeholder="Guideline for this passage" value={note} onChangeText={setNote} multiline />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: space.lg, padding: space.lg },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  refRow: { gap: 2, paddingVertical: space.xs },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, minHeight: 100, backgroundColor: colors.card, color: colors.foreground }
});
