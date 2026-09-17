// Avatar U. Passage hub, question slides and notes. One yellow next action.
import * as Crypto from 'expo-crypto';
import { useRecorder, type RecordedCard } from '../useRecorder';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  commands, currentTake, deriveTakeStatus, materialsFor, tgMaterialId,
  type Task
} from '@langquest-next/core';
import {
  ArrowRight, BookOpen, Check, CheckCircle2, Circle, Clock, Headphones,
  HelpCircle, KeyRound, MessageSquare, Mic, MicOff, Send
} from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Ctx } from '../ctx';
import { AudioClip } from '../audioClip';
import { passageProgress, type PassageAction } from '../passageFlow';
import { getReferenceSlides, referenceRunSignature } from '../passageResources';
import { indexesFor } from '../indexes';
import { useQuery } from '../useQuery';
import { Footer, Header, Note, Screen } from '../pui';
import { colors, radius, space, tint } from '../theme';
import { ActionButton, Card, ProgressRing, text } from '../ui';

/**
 * The task this screen was opened for: one persisted row, never the
 * project. `task` is undefined until the row is read (`ready` false) and
 * when there is no such task (`ready` true).
 */
export function useTask(ctx: Ctx): { task: Task | undefined; ready: boolean } {
  const taskId = ctx.params['taskId'] ?? '';
  const actorId = ctx.session.actorId;
  const r = useQuery(ctx.project, (q) => q.getTask(taskId, actorId), [taskId, actorId], undefined as Task | undefined);
  return { task: r.data, ready: r.ready };
}

const ACTION = {
  reference: { icon: Headphones, label: 'Listen to reference material' },
  terms: { icon: KeyRound, label: 'Record remaining key terms' },
  record: { icon: Mic, label: 'Record the passage' },
  submit: { icon: Send, label: 'Prepare hand-off for review' },
  done: { icon: Clock, label: 'View hand-off status' }
};

export function TranslatePassage(ctx: Ctx) {
  const { state } = ctx.project;
  const { task, ready } = useTask(ctx);
  const [listened, setListened] = useState<string | null>(null);
  const items = state && task ? getReferenceSlides(state, task.laneId, task.unitId) : [];
  const signature = referenceRunSignature(items);
  const key = `reference-run:${ctx.project.orgId}:${ctx.project.projectId}:${ctx.session.actorId}:${task?.laneId ?? ''}:${task?.unitId ?? ''}`;
  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(key).then((value) => { if (mounted) setListened(value ?? ''); })
      .catch(() => { if (mounted) setListened(''); });
    return () => { mounted = false; };
  }, [key]);
  if (!state || !task) return <Screen><Header title="" onBack={ctx.back} />{ready ? <Note>Task not found.</Note> : <></>}</Screen>;
  const progress = passageProgress(state, task.laneId, task.unitId, !!items.length && listened !== signature);
  const questions = materialsFor(state, { laneId: task.laneId, unitId: task.unitId })
    .filter((m) => m.kind === 'questions' && (!m.scope.laneId || m.scope.laneId === task.laneId));
  const note = state.materials[tgMaterialId(task.laneId)]?.fields[task.unitId];
  const takeId = progress.takeId;
  const suggestions = takeId ? Object.values(state.reviews[takeId] ?? {}).flatMap((byActor) =>
    Object.values(byActor).filter((r) => r.value.decision === 'suggest_changes').map((r) => r.value.comment).filter(Boolean)) : [];
  const params = { taskId: task.id, unitId: task.unitId, laneId: task.laneId };
  function advance(action: PassageAction) {
    if (action === 'reference') ctx.go('passage_references', params);
    if (action === 'terms') ctx.go('passage_terms', params);
    if (action === 'record') ctx.go('quest_assets', params);
    if (action === 'submit') ctx.go('attach_questions', params);
    if (action === 'done') ctx.go('done_await', { ...params, ...(takeId ? { takeId } : {}) });
  }
  const next = ACTION[progress.next];
  return (
    <Screen footer={<ActionButton icon={next.icon} accessibilityLabel={next.label}
      onPress={() => advance(progress.next)} disabled={listened === null} />}>
      <Header title={state.units[task.unitId]?.label ?? task.unitId} onBack={ctx.back} />
      <View style={styles.grid}>
        <TaskTile icon={Headphones} label="Reference material" color={colors.reference}
          done={!!items.length && listened === signature} onPress={() => advance('reference')} />
        <TaskTile icon={KeyRound} label={`Key terms: ${progress.recordedTerms} of ${progress.totalTerms} recorded`}
          color={colors.reference} done={progress.terms.length > 0 && !progress.remainingTerms.length}
          onPress={() => advance('terms')}
          extra={<ProgressRing completed={progress.recordedTerms} total={progress.totalTerms} size={30} />} />
        <TaskTile icon={Mic} label="Recordings" color={colors.translate}
          done={!!takeId && (state.takes[takeId]?.cardHashes.length ?? 0) > 0} onPress={() => advance('record')} />
        <TaskTile icon={Send} label={progress.canSubmit ? 'Hand off for review' : progress.status?.submitted ? 'View hand-off status' : 'Hand-off needs a recording'}
          color={colors.review} blocked={!progress.canSubmit && !progress.status?.submitted}
          onPress={() => advance(progress.canSubmit ? 'submit' : 'done')} />
        <TaskTile icon={HelpCircle} label={`Review question sets: ${questions.length}`} color={colors.review}
          onPress={() => ctx.go('attach_questions', { ...params, mode: 'questions' })} />
        <TaskTile icon={MessageSquare} label="Passage notes" color={colors.foreground}
          done={!!note} onPress={() => ctx.go('add_to_tg', params)} />
      </View>
      {suggestions.map((comment, i) => <Card key={i}><MessageSquare color={colors.review} size={24} /><Text style={text.body}>{comment}</Text></Card>)}
      {task.instructions ? <Card><BookOpen color={colors.reference} size={24} /><Text style={text.body}>{task.instructions}</Text></Card> : null}
    </Screen>
  );
}

function TaskTile(props: {
  icon: typeof Mic; label: string; color: string; done?: boolean;
  blocked?: boolean; onPress: () => void; extra?: React.ReactNode;
}) {
  const Icon = props.icon;
  return (
    <Pressable onPress={props.onPress} disabled={props.blocked}
      accessibilityRole="button" accessibilityLabel={props.label}
      accessibilityState={{ disabled: !!props.blocked }}
      style={({ pressed }) => [styles.tile, { backgroundColor: `${props.color}0F` },
        props.done && styles.done, props.blocked && styles.blocked, pressed && { opacity: 0.8 }]}>
      <Icon size={40} color={props.blocked ? colors.mutedForeground : props.color} />
      {props.done ? <View style={styles.corner}><CheckCircle2 size={18} color={colors.done} /></View> : null}
      {props.blocked ? <View style={styles.corner}><MicOff size={18} color={colors.mutedForeground} /></View> : null}
      {props.blocked ? <View style={styles.strike} /> : null}
      {props.extra ? <View style={styles.ring}>{props.extra}</View> : null}
    </Pressable>
  );
}

/** One question set per slide, followed by an explicit hand-off. */
export function AttachQuestions(ctx: Ctx) {
  const { state, run } = ctx.project;
  const { task, ready } = useTask(ctx);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [response, setResponse] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  if (!state || !task) return ready ? <Note>Task not found.</Note> : <></>;
  const sets = materialsFor(state, { laneId: task.laneId, unitId: task.unitId })
    .filter((m) => m.kind === 'questions' && (!m.scope.laneId || m.scope.laneId === task.laneId));
  const idx = indexesFor(state);
  const takeId = currentTake(state, task.unitId, task.laneId, idx);
  const take = takeId ? state.takes[takeId] : undefined;
  const status = takeId ? deriveTakeStatus(state, takeId, idx) : null;
  const respondsTo = take?.parentTakeId;
  const isResponse = !!respondsTo && !!state.submissions[respondsTo];
  const canSubmit = !!takeId && !!take?.cardHashes.length && status?.outcome === 'draft';
  const browsing = ctx.params['mode'] === 'questions';
  const set = sets[index];

  async function submit() {
    if (!takeId || !canSubmit || saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try {
      await run(commands(state!, idx).submitTake({
        commandId: Crypto.randomUUID(), unitId: task!.unitId, laneId: task!.laneId,
        questionSetIds: picked.filter((id) => sets.some((s) => s.materialId === id)),
        ...(isResponse ? { responseNote: response } : {})
      }));
      ctx.go('done_await', { takeId });
    } catch (e) { setError((e as Error).message); }
    finally { saving.current = false; setBusy(false); }
  }
  return (
    <Screen footer={set ? <ActionButton icon={ArrowRight} accessibilityLabel="Next question set" onPress={() => setIndex(index + 1)} />
      : browsing ? <ActionButton icon={Check} accessibilityLabel="Back to passage" onPress={ctx.back} />
      : <ActionButton icon={Send} accessibilityLabel={canSubmit ? 'Queue hand-off for review' : 'Record a take before handing off'} onPress={() => void submit()} disabled={busy || !canSubmit} />}>
      <Header title={state.units[task.unitId]?.label ?? task.unitId}
        onBack={index > 0 ? () => setIndex(index - 1) : ctx.back} />
      {set ? <Card>
        <HelpCircle size={36} color={colors.review} />
        <Text style={text.small} accessibilityLabel={`Question set ${index + 1} of ${sets.length}`}>{index + 1} / {sets.length}</Text>
        {set.fields.map((f) => <View key={f.fieldId} style={{ gap: space.sm }}>
          {f.blobHash ? <AudioClip project={ctx.project} hashes={[f.blobHash]} label="Play question" /> : null}
          {f.text ? <Text style={text.body}>{f.text}</Text> : null}
        </View>)}
        {!browsing ? <ActionButton icon={picked.includes(set.materialId) ? CheckCircle2 : Circle}
          variant="outline" accessibilityLabel={picked.includes(set.materialId) ? 'Remove this question set' : 'Include this question set'}
          onPress={() => setPicked((p) => p.includes(set.materialId) ? p.filter((id) => id !== set.materialId) : [...p, set.materialId])} /> : null}
      </Card> : <Card style={{ alignItems: 'center' }}>
        {browsing ? <CheckCircle2 size={48} color={colors.done} /> : canSubmit ? <><Mic size={36} color={colors.translate} /><CheckCircle2 size={32} color={colors.done} /></> : <MicOff size={48} color={colors.mutedForeground} />}
      </Card>}
      {!set && isResponse && !browsing ? <TextInput style={styles.input} accessibilityLabel="Optional response to review suggestions" placeholder="Optional response" value={response} onChangeText={setResponse} multiline /> : null}
      {error ? <Text style={text.muted} accessibilityRole="alert">{error}</Text> : null}
    </Screen>
  );
}

/** Passage notes accept speech and preserve the existing written fallback. */
export function AddToTg(ctx: Ctx) {
  const { state, run } = ctx.project;
  const unitId = ctx.params['unitId'] ?? '';
  const laneId = ctx.params['laneId'] ?? '';
  const materialId = tgMaterialId(laneId);
  const field = state?.materials[materialId]?.fields[unitId]?.value;
  const [note, setNote] = useState(field?.text ?? '');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');
  const saveLock = useRef(false);
  async function saveCard(card: RecordedCard) {
    if (!state) return;
    await run(commands(state, indexesFor(state)).savePassageNote({
      commandId: Crypto.randomUUID(), materialId, laneId, unitId, text: note,
      recordingId: Crypto.randomUUID(),
      card: { hash: card.ref.hash, format: card.ref.format, durationMs: card.durationMs }
    }));
    ctx.project.triggerUpload();
  }
  const rec = useRecorder(saveCard);
  async function save() {
    if (saveLock.current || rec.busy || rec.manualOn || rec.failureCount || recording) return;
    saveLock.current = true; setBusy(true); setError('');
    try {
      if (!state) return;
      await run(commands(state, indexesFor(state)).savePassageNote({
        commandId: Crypto.randomUUID(), materialId, laneId, unitId, text: note,
        ...(field?.blobHash ? { blobHash: field.blobHash } : {})
      }));
      ctx.back();
    } catch (e) { setError((e as Error).message); }
    finally { saveLock.current = false; setBusy(false); }
  }
  return <Screen footer={field?.blobHash || note.trim() ? <ActionButton icon={Check}
    accessibilityLabel="Save passage note" onPress={() => void save()}
    disabled={busy || rec.busy || rec.manualOn || !!rec.failureCount || recording || !laneId || !unitId} /> : undefined}>
    <Header title={state?.units[unitId]?.label ?? unitId}
      onBack={rec.busy || recording || busy ? undefined : ctx.back} />
    {field?.blobHash && !recording ? <AudioClip project={ctx.project} hashes={[field.blobHash]} label="Play passage note" /> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="Hold to record passage note"
      onPressIn={() => { if (rec.busy || rec.failureCount || busy) return; setRecording(true); void rec.manualDown(); }}
      onPressOut={() => { void rec.manualUp().finally(() => setRecording(false)); }}
      style={{ alignSelf: 'center', alignItems: 'center', justifyContent: 'center',
        width: 82, height: 82, borderRadius: 41,
        backgroundColor: rec.manualOn ? '#A8120A' : field?.blobHash || note.trim() ? colors.muted : colors.action }}>
      <Mic size={32} color={rec.manualOn ? 'white' : colors.foreground} />
    </Pressable>
    <TextInput style={styles.input} accessibilityLabel="Optional written note"
      placeholder="Optional written note" value={note} onChangeText={setNote} multiline />
    {rec.failureCount ? <ActionButton icon={ArrowRight} accessibilityLabel="Retry saving audio note"
      variant="outline" onPress={() => void rec.retryFailed()} disabled={rec.busy} /> : null}
    {error || rec.error ? <Note>{error || rec.error}</Note> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: { width: '47%', flexGrow: 1, height: 124, borderWidth: 1,
    borderColor: colors.border, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center' },
  done: { backgroundColor: tint.done, borderColor: tint.doneBorder },
  blocked: { borderStyle: 'dashed', backgroundColor: colors.muted },
  corner: { position: 'absolute', right: 10, top: 10 },
  ring: { position: 'absolute', right: 10, bottom: 10 },
  strike: { position: 'absolute', width: 65, height: 2,
    backgroundColor: colors.mutedForeground, transform: [{ rotate: '-35deg' }] },
  input: { borderWidth: 1, borderColor: colors.border,
    borderRadius: 10, padding: 12, minHeight: 100,
    backgroundColor: colors.card, color: colors.foreground }
});

import { contractsFor } from '../screenContracts';
export const contracts = contractsFor('translate_passage', 'attach_questions', 'add_to_tg');
