import { StyleSheet } from '../theme';
// Avatar U. The workspace: one recording screen (docs/ux/mobbin-overhaul,
// do-work J-REC-1..5). It replaced the passage hub, recordings, the notes
// screen and the question-set picker. Vocabulary (reference word → ours):
// a "take" or part is one card (`v1.RecordingAdded` card); a version is a
// kept take (`v1.TakeComposed`) that was submitted (`v1.TakeSubmitted`);
// "Save Version N" is keepTake then submitTake; a revision's "what changed"
// is `v1.ResponseRecorded`. Reference copy lives in accessibility labels.
import * as Crypto from 'expo-crypto';
import {
  commands, deriveTakeStatus, derivePassageRecord, fiaStudyStatus, isObtLane, deriveObt,
  keyTermLinksFor, keyTermsForUnit, obtCanAct, parseTaskId, passageNotes, passageReading, tgMaterialId, versionNotes,
  type KeyTermView, type Task
} from '@langquest-next/core';
import {
  BookOpen, Check, CheckCircle2, Circle, History, KeyRound, Link2, ListChecks, MessageSquare,
  Mic, Send, Sparkles, X
} from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Ctx } from '../ctx';
import { AudioClip } from '../audioClip';
import { indexesFor } from '../indexes';
import { PassageSourceAudio } from '../passageSourceAudio';
import { Header, Note, Screen } from '../pui';
import { colors, radius, space, tint } from '../theme';
import { ActionButton, Card, text } from '../ui';
import { Byline } from '../UserChip';
import { useQuery } from '../useQuery';
import { useRecorder, type RecordedCard } from '../useRecorder';
import { NoteRow, NoteSheet } from '../noteSheet';
import { HoldToRecord, PartsList, RecordControls, RecordingTakeover, useRecordingParts } from './recordings';

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

/** The passage a work screen is about: `unitId` + `laneId`, or a task id that names them. */
export function passageOf(ctx: Ctx): { unitId: string; laneId: string } {
  const parsed = ctx.params['taskId'] ? parseTaskId(ctx.params['taskId']) : null;
  return {
    unitId: ctx.params['unitId'] ?? parsed?.unitId ?? '',
    laneId: ctx.params['laneId'] ?? parsed?.laneId ?? ''
  };
}

/**
 * RETIRING: the old passage hub. Links that still open it (My Work, Inbox,
 * the Bible picker, open work) land here and are handed straight to the
 * workspace. Legacy OBT lanes never get here: App.tsx mounts the OBT hub.
 */
export function TranslatePassage(ctx: Ctx) {
  const { unitId, laneId } = passageOf(ctx);
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current || !unitId || !laneId) return;
    sent.current = true;
    ctx.go('workspace', { unitId, laneId, ...(ctx.params['taskId'] ? { taskId: ctx.params['taskId'] } : {}) });
  });
  return <Screen><Header title={ctx.project.state?.units[unitId]?.label ?? unitId} onBack={ctx.back} />
    {!unitId || !laneId ? <Note>Task not found.</Note> : null}
  </Screen>;
}

type TrayTab = 'terms' | 'study' | 'notes' | 'history';

export function Workspace(ctx: Ctx) {
  const { unitId, laneId } = passageOf(ctx);
  const state = ctx.project.state;
  const obt = !!state && !!laneId && isObtLane(state, laneId);
  const parts = useRecordingParts(ctx, unitId, laneId, !obt);
  const { task } = useTask(ctx);
  const [tray, setTray] = useState<TrayTab | null>(null);
  const [source, setSource] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [about, setAbout] = useState<{ takeId: string; n: number } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  if (!state || !unitId || !laneId || !state.units[unitId]) {
    return <Screen><Header title="" onBack={ctx.back} /><Note>{state ? 'Task not found.' : 'Opening passage…'}</Note></Screen>;
  }
  const title = state.units[unitId]?.label ?? unitId;
  if (obt) {
    // Legacy OBT lanes: record and keep here; the OBT hub selects the take.
    const stage = deriveObt(state, unitId, laneId).stage;
    if (!['first_draft', 'revision', 'final_recording'].includes(stage) || !obtCanAct(state, ctx.session.actorId, laneId, stage)) {
      return <Screen><Header title={title} onBack={ctx.back} /><Note>This stage does not accept passage recordings.</Note></Screen>;
    }
    return <Screen footer={<RecordControls parts={parts} keepLabel="Keep take and return to passage" onKept={ctx.back} />}>
      <Header title={title} onBack={parts.blocked ? undefined : ctx.back} />
      <PassageSourceAudio ctx={ctx} unitId={unitId} laneId={laneId} disabled={parts.blocked} />
      <PartsList ctx={ctx} parts={parts} />
      {parts.error || parts.rec.error ? <Note>{parts.error || parts.rec.error}</Note> : null}
      <RecordingTakeover parts={parts} />
    </Screen>;
  }

  const idx = indexesFor(state);
  const record = derivePassageRecord(state, unitId, laneId, ctx.session.actorId, idx);
  const respondsTo = ctx.params['respondsTo'];
  const revised = respondsTo ? record.versions.find((v) => v.takeId === respondsTo) ?? null
    : record.openFeedback.length ? record.latest : null;
  const feedback = revised?.reviews.filter((r) => r.decision === 'suggest_changes') ?? [];
  const revising = !!revised && feedback.length > 0;
  const stepLabel = (stepId: string) => record.steps.find((s) => s.stepId === stepId)?.label ?? stepId;
  const status = parts.takeId ? deriveTakeStatus(state, parts.takeId, idx) : null;
  const n = record.versions.length + 1;
  // Kept and not yet saved as a version: the footer's yellow is "Save Version N".
  const ready = status?.outcome === 'draft' && !parts.changed && parts.parts.length > 0;
  const blocked = busy || parts.blocked;
  const study = fiaStudyStatus(state, laneId, unitId);
  const notes = passageNotes(state, unitId, laneId);
  const terms = keyTermsForUnit(state, laneId, unitId);
  const tied = new Set(parts.takeId ? keyTermLinksFor(state, parts.takeId).map((l) => l.term.termId) : []);

  async function save(response?: { note: string; blobHash?: string }) {
    if (!ready || blocked || lock.current) return;
    if (revising && !response) { setSaveOpen(true); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      await ctx.project.run(commands(state!, indexesFor(state!)).submitTake({
        commandId: Crypto.randomUUID(), unitId, laneId, questionSetIds: [],
        ...(response?.note.trim() ? { responseNote: response.note } : {}),
        ...(response?.blobHash ? { responseBlobHash: response.blobHash } : {})
      }));
      ctx.project.triggerUpload();
      setSaveOpen(false);
      ctx.toast(revising ? `Version ${n} saved · answers the ${stepLabel(feedback[0]!.stepId)} feedback` : `Version ${n} saved to the record`);
      ctx.go('passage_record', { unitId, laneId });
    } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }

  const chips: { id: TrayTab; icon: typeof Mic; color: string; count: string; label: string }[] = [
    { id: 'terms', icon: KeyRound, color: colors.reference, count: String(terms.length), label: `Key terms, ${terms.length}` },
    ...(study ? [{ id: 'study' as const, icon: Sparkles, color: colors.reference, count: `${study.doneCount}/${study.steps.length}`,
      label: `FIA study, ${study.doneCount} of ${study.steps.length} steps done` }] : []),
    { id: 'notes', icon: MessageSquare, color: colors.foreground, count: String(notes.length), label: `Notes, ${notes.length}` },
    { id: 'history', icon: History, color: colors.foreground, count: String(record.versions.length),
      label: record.versions.length ? `History, ${record.versions.length} versions` : 'History. This will be the first version.' }
  ];

  const footer = <View style={{ gap: space.sm }}>
    <View style={styles.chips}>
      {chips.map((c) => <Pressable key={c.id} onPress={() => setTray(tray === c.id ? null : c.id)} disabled={blocked}
        accessibilityRole="button" accessibilityLabel={c.label} accessibilityState={{ selected: tray === c.id }}
        style={[styles.chip, tray === c.id && styles.chipOn]}>
        <c.icon size={18} color={tray === c.id ? colors.card : c.color} />
        <Text style={[text.small, tray === c.id && { color: colors.card }]}>{c.count}</Text>
      </Pressable>)}
    </View>
    {tray ? <ScrollView style={styles.tray} contentContainerStyle={{ gap: space.sm, paddingBottom: space.sm }}>
      {tray === 'terms' ? <TermsTray ctx={ctx} terms={terms} tied={tied} takeId={parts.takeId} unitId={unitId} laneId={laneId} /> : null}
      {tray === 'study' && study ? <>
        <Beads done={study.steps.map((s) => !!s.done)} />
        {study.steps.map((s) => <Pressable key={s.stage.id} style={styles.trayRow} accessibilityRole="button"
          accessibilityLabel={`${s.index + 1}. ${s.stage.label}${s.done ? ', done' : ''}`}
          onPress={() => ctx.go('study_step', { unitId, laneId, stage: s.stage.id })}>
          {s.done ? <CheckCircle2 size={20} color={colors.done} /> : <Circle size={20} color={colors.mutedForeground} />}
          <Text style={[text.body, { flex: 1 }]}>{s.index + 1} · {s.stage.label}</Text>
        </Pressable>)}
        <ActionButton icon={Sparkles} variant="outline" accessibilityLabel="Open the study"
          onPress={() => ctx.go('study_guide', { unitId, laneId })} />
      </> : null}
      {tray === 'notes' ? <>
        {notes.map((n) => <NoteRow key={n.itemId} ctx={ctx} note={n} />)}
        <ActionButton icon={MessageSquare} variant="outline"
          accessibilityLabel={notes.length ? 'Add a note' : 'Add a note. Notes you leave here follow the passage — reviewers and the next translator will see them.'}
          disabled={!ctx.session.can('fill_reference')} onPress={() => setNotesOpen(true)} />
      </> : null}
      {tray === 'history' ? <>
        {!record.versions.length ? <View accessible accessibilityLabel="This will be the first version." style={styles.trayRow}>
          <History size={20} color={colors.mutedForeground} /><Text style={text.small}>v1</Text>
        </View> : null}
        {[...record.versions].reverse().map((v) => {
          const r = state.responses[v.takeId];
          return <Card key={v.takeId}>
            <Byline before={`v${v.n} ·`} id={v.authorId} />
            <AudioClip project={ctx.project} hashes={state.takes[v.takeId]?.cardHashes ?? []} label={`Play version ${v.n}`} hideActions />
            {r?.blobHash ? <AudioClip project={ctx.project} hashes={[r.blobHash]} label={`Hear what changed in version ${v.n}`} hideActions /> : null}
            {r?.note ? <Text style={text.small}>{r.note}</Text> : null}
            {versionNotes(state, v.takeId).map((n) => <NoteRow key={n.itemId} ctx={ctx} note={n} />)}
            {ctx.session.can('fill_reference') ? <ActionButton icon={MessageSquare} variant="outline" style={styles.headerButton}
              accessibilityLabel={`Add a note to Version ${v.n}`} onPress={() => setAbout({ takeId: v.takeId, n: v.n })} /> : null}
          </Card>;
        })}
      </> : null}
    </ScrollView> : null}
    {ready
      ? <View style={styles.controls}>
          <RecordControls parts={parts} quiet />
          <ActionButton icon={Send} accessibilityLabel={`Save Version ${n}`} disabled={blocked}
            onPress={() => void save()} style={{ flex: 1 }} />
        </View>
      : <RecordControls parts={parts} />}
  </View>;

  return (
    <Screen footer={footer}>
      <Header title={title} onBack={blocked ? undefined : ctx.back}
        action={<ActionButton icon={BookOpen} variant="outline" style={styles.headerButton}
          accessibilityLabel={source ? 'Hide the source text' : 'Show the source text'} onPress={() => setSource(!source)} />} />
      {revising ? <Card style={{ backgroundColor: tint.review, borderColor: colors.review }}>
        <View accessible accessibilityLabel={`Revising after ${feedback.map((f) => stepLabel(f.stepId)).join(', ')}`} style={styles.row}>
          <MessageSquare size={22} color={colors.review} />
          <ListChecks size={18} color={colors.review} />
        </View>
        {feedback.map((f) => <View key={f.eventId} style={{ gap: space.xs }}>
          <Byline before={`${stepLabel(f.stepId)} ·`} id={f.reviewerId} />
          {f.voiceHash ? <AudioClip project={ctx.project} hashes={[f.voiceHash]} label="Hear the voice feedback" hideActions /> : null}
          {f.comment ? <Text style={text.body}>“{f.comment}”</Text> : null}
        </View>)}
      </Card> : null}
      {task?.instructions ? <Card><BookOpen color={colors.reference} size={20} /><Text style={text.body}>{task.instructions}</Text></Card> : null}
      <PassageSourceAudio ctx={ctx} unitId={unitId} laneId={laneId} disabled={blocked} />
      {source ? <SourceText ctx={ctx} unitId={unitId} terms={terms} tied={tied} takeId={parts.takeId} /> : null}
      <PartsList ctx={ctx} parts={parts} />
      {revising && !parts.changed && !ready && parts.parts.length ? <View accessible style={styles.row}
        accessibilityLabel={`These are Version ${revised!.n}'s takes. Record a new take or delete one to save a new version.`}>
        <History size={16} color={colors.mutedForeground} /><Text style={text.small}>v{revised!.n}</Text>
      </View> : null}
      {error || parts.error || parts.rec.error ? <Note>{error || parts.error || parts.rec.error}</Note> : null}
      {parts.rec.failureCount ? <ActionButton icon={Mic} variant="outline" accessibilityLabel="Retry saving recording"
        disabled={parts.rec.busy} onPress={() => void parts.rec.retryFailed()} /> : null}
      <RecordingTakeover parts={parts} />
      <NotesSheet ctx={ctx} unitId={unitId} laneId={laneId} visible={notesOpen} onClose={() => setNotesOpen(false)} />
      {about ? <NotesSheet ctx={ctx} unitId={unitId} laneId={laneId} visible aboutTakeId={about.takeId} n={about.n} onClose={() => setAbout(null)} /> : null}
      {saveOpen ? <SaveSheet project={ctx.project} n={n} busy={busy} error={error}
        answers={feedback.map((f) => stepLabel(f.stepId)).join(', ')}
        onClose={() => setSaveOpen(false)} onSave={(r) => void save(r)} /> : null}
    </Screen>
  );
}

/** Progress as beads: a filled bead per finished step. */
export function Beads(props: { done: boolean[] }) {
  const finished = props.done.filter(Boolean).length;
  return <View style={styles.beads} accessible accessibilityRole="progressbar"
    accessibilityLabel={`${finished} of ${props.done.length} steps done`}>
    {props.done.map((d, i) => <View key={i} style={[styles.bead, d && { backgroundColor: colors.done, borderColor: colors.done }]} />)}
  </View>;
}

function TermsTray(props: { ctx: Ctx; terms: KeyTermView[]; tied: Set<string>; takeId: string | null; unitId: string; laneId: string }) {
  const { ctx } = props;
  return <>
    {!props.terms.length ? <View accessible accessibilityLabel="No key terms matched this passage's source." style={styles.trayRow}>
      <KeyRound size={20} color={colors.mutedForeground} /><Text style={text.small}>0</Text>
    </View> : null}
    {props.terms.map((t) => {
      const tied = props.tied.has(t.termId);
      return <Pressable key={t.termId} style={styles.trayRow} accessibilityRole="button"
        accessibilityLabel={`${t.term}${t.renderings.length ? `, ${t.renderings.map((r) => r.rendering).join(', ')}` : ', no rendering yet'}${tied ? ', tied to this recording' : ''}`}
        onPress={() => ctx.go('key_term_detail', { termId: t.termId, ...(props.takeId ? { takeId: props.takeId } : {}) })}>
        <KeyRound size={18} color={colors.reference} />
        <View style={{ flex: 1 }}>
          <Text style={text.body}>{t.term}</Text>
          {t.renderings.length ? <Text style={text.small}>{t.renderings.map((r) => r.rendering).join(' · ')}</Text> : null}
        </View>
        {tied ? <Link2 size={18} color={colors.done} /> : null}
      </Pressable>;
    })}
    <View style={styles.controls}>
      <ActionButton icon={Mic} variant="outline" accessibilityLabel="Record key terms" style={{ flex: 1 }}
        disabled={!ctx.session.can('translate')}
        onPress={() => ctx.go('passage_terms', { taskId: `translate:${props.unitId}:${props.laneId}`, unitId: props.unitId, laneId: props.laneId })} />
      <ActionButton icon={ListChecks} variant="outline" accessibilityLabel="All key terms" style={{ flex: 1 }}
        onPress={() => ctx.go('key_terms', { laneId: props.laneId, unitId: props.unitId, ...(props.takeId ? { takeId: props.takeId } : {}) })} />
    </View>
  </>;
}

/** The first word of a term ("flesh (sarx)" → "flesh") as it would appear in the source. */
function termWord(term: string): string {
  return term.split(' (')[0]!.trim();
}

/** Source text (reference material, so it may show) with the passage's key terms underlined. */
function SourceText(props: { ctx: Ctx; unitId: string; terms: KeyTermView[]; tied: Set<string>; takeId: string | null }) {
  const reading = passageReading(props.unitId);
  if (!reading) return <View accessible accessibilityLabel="Source text isn't available for this passage." style={styles.row}>
    <BookOpen size={20} color={colors.mutedForeground} /><X size={16} color={colors.mutedForeground} />
  </View>;
  const words = props.terms.map((t) => ({ w: termWord(t.term), t })).filter((x) => x.w.length > 2)
    .sort((a, b) => b.w.length - a.w.length);
  const re = words.length ? new RegExp(`\\b(${words.map((x) => x.w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi') : null;
  const open = (termId: string) => props.ctx.go('key_term_detail', { termId, ...(props.takeId ? { takeId: props.takeId } : {}) });
  return <Card>
    <Text style={styles.source}>
      {reading.verses.map((v) => {
        const pieces: React.ReactNode[] = [<Text key="n" style={text.small}>{v.verse} </Text>];
        let last = 0;
        for (const m of re ? v.text.matchAll(re) : []) {
          const i = m.index ?? 0;
          if (i > last) pieces.push(v.text.slice(last, i));
          const hit = words.find((x) => x.w.toLowerCase() === m[0].toLowerCase())!;
          const tied = props.tied.has(hit.t.termId);
          pieces.push(<Text key={i} onPress={() => open(hit.t.termId)} accessibilityRole="link"
            accessibilityLabel={`Key term ${hit.t.term}${tied ? ', tied' : ''}`}
            style={[styles.term, tied && { color: colors.done }]}>{m[0]}</Text>);
          last = i + m[0].length;
        }
        pieces.push(`${v.text.slice(last)} `);
        return <Text key={`${v.chapter}:${v.verse}`}>{pieces}</Text>;
      })}
    </Text>
  </Card>;
}

/**
 * The notes on a passage (J-REC-2): every note left here, then a new one.
 * Each is a `v1.ContextItemAdded` homed on the passage in this language;
 * the old one-note guideline field shows as a note, never overwritten.
 * `aboutTakeId` makes it a note on one version (J-REC-1).
 */
export function NotesSheet(props: { ctx: Ctx; unitId: string; laneId: string; visible: boolean; onClose: () => void; aboutTakeId?: string; n?: number }) {
  const { ctx, unitId, laneId } = props;
  const state = ctx.project.state;
  if (!state) return null;
  const notes = props.aboutTakeId ? versionNotes(state, props.aboutTakeId) : passageNotes(state, unitId, laneId);
  return <NoteSheet ctx={ctx} visible={props.visible} onClose={props.onClose}
    title={props.n ? `v${props.n}` : state.units[unitId]?.label ?? unitId}
    place={props.aboutTakeId ? `On Version ${props.n ?? ''}. It stays with this version in the record.` : 'Anchored to Whole passage. It follows the passage into reviews and later versions.'}
    home={{ level: 'unit', laneId, unitId }}
    anchors={props.aboutTakeId ? [{ type: 'take', takeId: props.aboutTakeId }] : [{ type: 'unit', unitId }]}
    {...(props.aboutTakeId ? { aboutTakeId: props.aboutTakeId } : {})}
    notes={notes} saved={props.aboutTakeId ? `Note added to Version ${props.n ?? ''}` : 'Note added — it follows this passage'} />;
}

/**
 * OBT lanes keep their path (D13): the one passage note in the lane's
 * Translation Guidelines field, which older clients on those lanes read.
 */
export function GuidelineNoteSheet(props: { ctx: Ctx; unitId: string; laneId: string; visible: boolean; onClose: () => void }) {
  const { ctx, unitId, laneId } = props;
  const { state, run } = ctx.project;
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
    if (saveLock.current || rec.busy || rec.manualOn || rec.failureCount || recording || !state) return;
    saveLock.current = true; setBusy(true); setError('');
    try {
      await run(commands(state, indexesFor(state)).savePassageNote({
        commandId: Crypto.randomUUID(), materialId, laneId, unitId, text: note,
        ...(field?.blobHash ? { blobHash: field.blobHash } : {})
      }));
      ctx.toast('Note added — it follows this passage');
      props.onClose();
    } catch (e) { setError((e as Error).message); }
    finally { saveLock.current = false; setBusy(false); }
  }
  const locked = busy || rec.busy || recording;
  return <Modal visible={props.visible} animationType="slide" onRequestClose={() => { if (!locked) props.onClose(); }}>
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <Screen footer={field?.blobHash || note.trim() ? <ActionButton icon={Check}
        accessibilityLabel="Save note" onPress={() => void save()}
        disabled={locked || rec.manualOn || !!rec.failureCount} /> : undefined}>
        <Header title={state?.units[unitId]?.label ?? unitId} onBack={locked ? undefined : props.onClose} />
        <View accessible accessibilityLabel="Add a note. It follows the passage into reviews and later versions." style={styles.row}>
          <MessageSquare size={24} color={colors.foreground} />
        </View>
        {field?.blobHash && !recording ? <AudioClip project={ctx.project} hashes={[field.blobHash]} label="Play passage note" /> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Hold to record the note"
          onPressIn={() => { if (rec.busy || rec.failureCount || busy) return; setRecording(true); void rec.manualDown(); }}
          onPressOut={() => { void rec.manualUp().finally(() => setRecording(false)); }}
          style={[styles.noteMic, { backgroundColor: rec.manualOn ? '#A8120A' : field?.blobHash || note.trim() ? colors.muted : colors.action }]}>
          <Mic size={32} color={rec.manualOn ? 'white' : colors.foreground} />
        </Pressable>
        <TextInput style={styles.input} accessibilityLabel="Or type it"
          placeholder="Or type it" value={note} onChangeText={setNote} multiline />
        {rec.failureCount ? <ActionButton icon={Mic} accessibilityLabel="Retry saving audio note"
          variant="outline" onPress={() => void rec.retryFailed()} disabled={rec.busy} /> : null}
        {error || rec.error ? <Note>{error || rec.error}</Note> : null}
      </Screen>
    </SafeAreaView>
  </Modal>;
}

/** "Save Version N" when revising: say what changed (voice first, text optional). */
function SaveSheet(props: {
  project: Ctx['project']; n: number; busy: boolean; error: string; answers: string;
  onClose: () => void; onSave: (r: { note: string; blobHash?: string }) => void;
}) {
  const [note, setNote] = useState('');
  const [blobHash, setBlobHash] = useState<string | undefined>();
  return <Modal visible animationType="slide" onRequestClose={() => { if (!props.busy) props.onClose(); }}>
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <Screen footer={<ActionButton icon={Send} accessibilityLabel={`Save Version ${props.n}`}
        disabled={props.busy || (!note.trim() && !blobHash)}
        onPress={() => props.onSave({ note, ...(blobHash ? { blobHash } : {}) })} />}>
        <Header title={`v${props.n}`} onBack={props.busy ? undefined : props.onClose} />
        <View accessible style={styles.row}
          accessibilityLabel={`Save Version ${props.n}. Say what changed, so reviewers know what to listen for. Answers the ${props.answers} feedback.`}>
          <MessageSquare size={24} color={colors.review} /><Check size={18} color={colors.review} />
        </View>
        <HoldToRecord accessibilityLabel="Say what changed" disabled={props.busy}
          onCard={(card) => { setBlobHash(card.ref.hash); }} />
        {blobHash ? <AudioClip project={props.project} hashes={[blobHash]} label="Hear what you said changed" hideActions /> : null}
        <TextInput style={styles.input} accessibilityLabel="Or type it" placeholder="Or type it"
          value={note} onChangeText={setNote} multiline />
        {props.error ? <Note>{props.error}</Note> : null}
      </Screen>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md },
  chips: { flexDirection: 'row', gap: space.sm, justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: space.md,
    borderRadius: radius.full, backgroundColor: colors.muted },
  chipOn: { backgroundColor: colors.foreground },
  tray: { maxHeight: 300 },
  trayRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48, paddingHorizontal: space.sm,
    borderRadius: radius.md, backgroundColor: colors.background },
  beads: { flexDirection: 'row', gap: 6, justifyContent: 'center', paddingVertical: space.xs },
  bead: { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  headerButton: { height: 44, paddingHorizontal: space.md },
  source: { fontSize: 16, lineHeight: 26, color: colors.foreground },
  term: { color: colors.translate, textDecorationLine: 'underline', textDecorationStyle: 'dotted', fontWeight: '600' },
  noteMic: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center', width: 82, height: 82, borderRadius: 41 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, minHeight: 100,
    backgroundColor: colors.card, color: colors.foreground }
});

import { contractsFor } from '../screenContracts';
export const contracts = contractsFor('translate_passage', 'workspace');
