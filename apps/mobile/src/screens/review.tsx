// Avatar U. Review passage, review questions, done. Material editor is Avatar P.
import { commands, isStored, deriveTakeStatus, keyTermLinksFor, materialView, questionsOf, questionSetsFor, REFERENCE_KINDS, templateFields } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { indexesFor } from '../indexes';
import { BookOpen, Check, CloudAlert, CloudCheck, CloudOff, Clock, KeyRound, MessageSquare, Play, RotateCcw, Users } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AudioClip } from '../audioClip';
import { handoffState } from '../passageFlow';
import type { Ctx } from '../ctx';
import { Footer, Header, Note, Row, Screen, Section } from '../pui';
import { colors, radius, space, tint } from '../theme';
import { ActionButton, BackButton, Card, StatusIcon, text } from '../ui';
import { useTask } from './translate';

/** Answers live here between review_questions and review_passage (screen-local, not synced). */
const draftAnswers = new Map<string, Record<string, string>>();

export function ReviewPassage(ctx: Ctx) {
  const { state, run } = ctx.project;
  const { task, ready } = useTask(ctx);
  const [changing, setChanging] = useState(false);
  if (!state || !task || !task.takeId) return ready ? <Note>Task not found.</Note> : <></>;
  const takeId = task.takeId;
  const take = state.takes[takeId];
  const idx = indexesFor(state);
  const status = deriveTakeStatus(state, takeId, idx);
  const stepId = task.id.split(':')[3]!;
  const step = status.steps.find((s) => s.stepId === stepId);
  const mine = state.reviews[takeId]?.[stepId]?.[ctx.session.actorId]?.value;
  const questionSets = questionSetsFor(state, takeId, stepId);
  const termsUsed = keyTermLinksFor(state, takeId);
  const answered = questionSets.length === 0 || draftAnswers.has(takeId);
  const showButtons = !mine || changing;

  async function decide(decision: 'approve' | 'suggest_changes') {
    const answers = draftAnswers.get(takeId);
    await run(commands(state!, idx).reviewTake({ commandId: Crypto.randomUUID(), takeId, stepId, decision, ...(answers ? { answers } : {}) }));
    draftAnswers.delete(takeId);
    setChanging(false);
    ctx.go('done_await', { takeId });
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
          <AudioClip project={ctx.project} hashes={take?.cardHashes ?? []} label="Play translation" />
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

        {termsUsed.length > 0 ? (
          <Card style={{ backgroundColor: tint.translate }}>
            {termsUsed.map(({ term, note }) => (
              <Pressable key={term.termId} onPress={() => ctx.go('key_term_detail', { termId: term.termId })} style={styles.titleRow} accessibilityLabel={`key term ${term.term}`}>
                <KeyRound size={16} color={colors.reference} />
                <Text style={[text.body, { flex: 1 }]}>{term.term}{note ? ` · ${note}` : ''}</Text>
              </Pressable>
            ))}
          </Card>
        ) : null}

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
  const { task, ready } = useTask(ctx);
  const takeId = task?.takeId ?? '';
  const [answers, setAnswers] = useState<Record<string, string>>(draftAnswers.get(takeId) ?? {});
  if (!state || !task) return ready ? <Note>Task not found.</Note> : <></>;
  const stepId = task.id.split(':')[3] ?? '';
  const questions = questionsOf(questionSetsFor(state, takeId, stepId));

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
  const state = ctx.project.state;
  const takeId = ctx.params['takeId'];
  const take = takeId && state ? state.takes[takeId] : undefined;
  const delivery = handoffState({
    pending: ctx.project.pending,
    online: ctx.project.online,
    refused: ctx.project.refused,
    tooOld: ctx.project.tooOld,
    audioStored: !take || take.cardHashes.every((hash) => !!state && isStored(state, hash))
  });
  const Icon = delivery === 'blocked' ? CloudAlert : delivery === 'queued' ? CloudOff : CloudCheck;
  const label = delivery === 'blocked' ? 'Saved locally. Sync needs attention.'
    : delivery === 'queued' ? 'Saved on this phone. Waiting to sync.'
    : 'Synced. Review status is separate.';
  return (
    <View style={[styles.screen, styles.center, { backgroundColor: colors.background }]}>
      <View style={styles.doneMark} accessible accessibilityLabel={label}>
        <Icon size={44} color={delivery === 'sent' ? colors.done : colors.mutedForeground} />
      </View>
      {delivery !== 'sent' ? <Clock size={28} color={colors.mutedForeground} /> : null}
      {takeId && state?.takes[takeId] ? <StatusIcon outcome={deriveTakeStatus(state, takeId, indexesFor(state)).outcome} size={32} /> : null}
      {delivery === 'blocked' ? <Note>{ctx.project.refused ?? 'Update the app to sync this work.'}</Note> : null}
      <ActionButton icon={Check} accessibilityLabel="Back to my work" onPress={() => ctx.go('assignments_home')} style={{ alignSelf: 'stretch' }} />
    </View>
  );
}

/** Avatar P. Fill the blanks of a material (each field is its own register), or define a new one. Lock restricts editing, never hides (A7). */
export function MaterialEditor(ctx: Ctx) {
  const { state, append, appendMany } = ctx.project;
  const materialId = ctx.params['materialId'];
  const laneId = ctx.params['laneId'] ?? '';
  const unitId = ctx.params['unitId'];
  const existing = materialId && state ? materialView(state, materialId) : null;
  const [kind, setKind] = useState(existing?.kind ?? 'tg');
  const [title, setTitle] = useState(existing?.title ?? '');
  const expected = templateFields(existing?.templateRef);
  const fieldIds = [...new Set([...expected, ...(existing?.fields.map((f) => f.fieldId) ?? [])])];
  const [fields, setFields] = useState<Record<string, string>>(Object.fromEntries((existing?.fields ?? []).map((f) => [f.fieldId, f.text ?? ''])));
  const [newField, setNewField] = useState('');
  const canManage = ctx.session.can('manage_reference');
  const canFill = canManage || (ctx.session.can('fill_reference') && !existing?.locked);
  const isNew = !existing;
  async function save() {
    const id = existing?.materialId ?? `${kind}-${Date.now()}`;
    const events: Parameters<typeof appendMany>[0] = [];
    if (isNew) events.push({ type: 'v1.MaterialDefined', payload: { materialId: id, kind, title: title.trim() || kind, scope: { ...(laneId ? { laneId } : {}), ...(unitId ? { unitId } : {}) } } });
    for (const [fieldId, value] of Object.entries(fields)) {
      const before = existing?.fields.find((f) => f.fieldId === fieldId)?.text ?? '';
      if (value.trim() !== before) events.push({ type: 'v1.MaterialFieldSet', payload: { materialId: id, fieldId, text: value.trim() } });
    }
    await appendMany(events);
    ctx.back();
  }
  const allFieldIds = [...new Set([...fieldIds, ...Object.keys(fields)])];
  return (
    <Screen footer={canFill ? <Footer label="Save changes" onPress={() => void save()} disabled={isNew && !title.trim() && !Object.values(fields).some((v) => v.trim())} /> : undefined}>
      <Header title={existing?.title ?? 'New material'} sub={existing ? `${REFERENCE_KINDS.find((k) => k.id === existing.kind)?.name ?? existing.kind}${existing.locked ? ' · locked' : ''}` : undefined} onBack={ctx.back} />
      {isNew ? (
        <Section label="Kind">
          {REFERENCE_KINDS.filter((k) => k.id !== 'key_terms').map((k, i, a) => (
            <Row key={k.id} label={k.name} sub={k.code} onPress={() => setKind(k.id)} right={kind === k.id ? <Check size={18} color={colors.translate} /> : <View />} last={i === a.length - 1} />
          ))}
        </Section>
      ) : null}
      {isNew ? <TextInput style={styles.input} placeholder="Title" value={title} onChangeText={setTitle} /> : null}
      {existing && canManage ? (
        <Section label="Editing">
          <Row label={existing.locked ? 'Locked: only managers edit' : 'Open: anyone with Fill Reference edits'} onPress={() => void append('v1.MaterialLocked', { materialId: existing.materialId, locked: !existing.locked })} right={existing.locked ? <Check size={18} color={colors.review} /> : <View />} last />
        </Section>
      ) : null}
      <Section label={existing?.kind === 'questions' || kind === 'questions' ? 'Questions' : 'Fields'}>
        {allFieldIds.map((fieldId) => (
          <Card key={fieldId}>
            <Text style={text.small}>{fieldId}</Text>
            <TextInput style={styles.input} editable={canFill} placeholder="Empty" value={fields[fieldId] ?? ''} onChangeText={(v) => setFields((f) => ({ ...f, [fieldId]: v }))} multiline />
          </Card>
        ))}
        {canFill ? (
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
            <TextInput style={[styles.input, { flex: 1, minHeight: 44 }]} placeholder={existing?.kind === 'questions' || kind === 'questions' ? 'New question id (e.g. q3)' : 'New field (e.g. body)'} autoCapitalize="none" value={newField} onChangeText={setNewField} />
            <Pressable
              onPress={() => {
                const id = newField.trim();
                if (id && !(id in fields)) setFields((f) => ({ ...f, [id]: '' }));
                setNewField('');
              }}
              accessibilityLabel="Add field"
            >
              <Check size={22} color={colors.translate} />
            </Pressable>
          </View>
        ) : null}
      </Section>
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
