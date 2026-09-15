// Avatar U. Translate passage, recordings, key terms, add to TG, attach questions. One yellow action per screen.
import { currentTake, deriveTakeStatus, deriveTasks, keyTermLinksFor, keyTermsForUnit, materialsFor, takesFor, tgMaterialId, type Task } from '@langquest-next/core';
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
  const terms = keyTermsForUnit(state, task.laneId, task.unitId);
  const tied = takeId ? keyTermLinksFor(state, takeId).length : 0;
  const materials = materialsFor(state, { laneId: task.laneId, unitId: task.unitId }).filter((m) => m.kind !== 'questions');
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

        <Pressable onPress={() => ctx.go('key_terms', { unitId: task.unitId, laneId: task.laneId, ...(takeId ? { takeId } : {}) })} accessibilityRole="button" accessibilityLabel={`Key terms: ${terms.length} relevant, ${tied} tied to this translation`}>
          <Card style={{ backgroundColor: tint.translate }}>
            <View style={styles.titleRow}>
              <KeyRound size={18} color={colors.reference} />
              <Text style={text.h4}>{terms.length}</Text>
              {tied ? <Text style={text.small}>· {tied}</Text> : null}
              <View style={{ flex: 1 }} />
              <Pressable onPress={() => ctx.go('add_to_tg', { unitId: task.unitId, laneId: task.laneId })} hitSlop={8} accessibilityLabel="Add to translation guidelines">
                <Plus size={18} color={colors.reference} />
              </Pressable>
            </View>
            {materials.map((m) => (
              <View key={m.materialId} style={styles.refRow}>
                <Text style={text.small}>{m.title}</Text>
                {m.fields.filter((f) => f.fieldId === task.unitId || m.fields.length <= 3).map((f) => (
                  <Text key={f.fieldId} style={text.body}>{f.text ?? f.blobHash}</Text>
                ))}
              </View>
            ))}
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
  const [response, setResponse] = useState('');
  if (!state || !task) return <Note>Task not found.</Note>;
  const sets = materialsFor(state, { laneId: task.laneId, unitId: task.unitId }).filter((m) => m.kind === 'questions');
  const takeId = currentTake(state, task.unitId, task.laneId);
  const respondsTo = takeId ? state.takes[takeId]?.parentTakeId ?? null : null;
  const isResponse = task.type === 'respond' || (!!respondsTo && !!state.submissions[respondsTo]);

  async function submit() {
    if (!takeId) return;
    // The translator's answer to suggestions travels with the resubmission
    // (UX spec PieceReviewResponse; audit 5.F).
    if (isResponse && respondsTo && response.trim()) {
      await append('v1.ResponseRecorded', { takeId, respondsToTakeId: respondsTo, note: response.trim() });
    }
    await append('v1.TakeSubmitted', { takeId, questionSetIds: picked });
    ctx.go('done_await');
  }

  return (
    <Screen footer={<ActionButton icon={Send} accessibilityLabel="Submit for review" onPress={() => void submit()} />}>
      <Header title="Review questions" onBack={ctx.back} />
      {isResponse ? (
        <TextInput style={styles.input} placeholder="What you changed, and why the rest stayed" value={response} onChangeText={setResponse} multiline />
      ) : null}
      {sets.length === 0 ? <Note>No question sets yet. Submit without questions, or write one from the reference library.</Note> : null}
      {sets.length > 0 ? (
        <Section label={`Question sets · ${sets.length}`}>
          {sets.map((m, i) => (
            <Row
              key={m.materialId}
              label={m.title}
              sub={`${m.fields.length} questions`}
              onPress={() => setPicked((p) => (p.includes(m.materialId) ? p.filter((x) => x !== m.materialId) : [...p, m.materialId]))}
              right={picked.includes(m.materialId) ? <Check size={18} color={colors.translate} /> : <View />}
              last={i === sets.length - 1}
            />
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}

/** Spec add_to_tg: the note lands in the language's Translation Guidelines document, keyed by this passage (audit 5.E). */
export function AddToTg(ctx: Ctx) {
  const { state, appendMany } = ctx.project;
  const [note, setNote] = useState('');
  const unitId = ctx.params['unitId'] ?? '';
  const laneId = ctx.params['laneId'] ?? Object.keys(state?.lanes ?? {})[0] ?? '';
  const materialId = tgMaterialId(laneId);
  async function save() {
    const events: Parameters<typeof appendMany>[0] = [];
    if (!state?.materials[materialId]) events.push({ type: 'v1.MaterialDefined', payload: { materialId, kind: 'tg', title: 'Translation Guidelines', scope: { laneId } } });
    events.push({ type: 'v1.MaterialFieldSet', payload: { materialId, fieldId: unitId, text: note.trim() } });
    await appendMany(events);
    ctx.back();
  }
  return (
    <Screen footer={<Footer label="Done" onPress={() => void save()} disabled={!note.trim() || !laneId} />}>
      <Header title="Add to TG" sub={state?.units[unitId]?.label} onBack={ctx.back} />
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
