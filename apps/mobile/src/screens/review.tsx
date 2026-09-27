import { StyleSheet } from '../theme';
// Avatar U: review_capture (do-work J-REV-1/2, J-STUDY-6). One screen: listen
// (play once before deciding, PLAN 16), background collapsed (translator
// context, the team's study, earlier reviews), questions inline by type,
// feedback by voice or text, then "Needs changes" or "Looks good". Legacy
// OBT lanes compare the back translation and decide the OBT stage.
// Avatar P: material_editor.
import {
  assertObtStep, commands, deriveObt, derivePassageRecord, deriveTakeStatus, fiaStudyStatus, isObtLane,
  keyTermLinksFor, materialView, obtCanAct, parseTaskId, questionsOf, questionSetsFor, skippedAnswerKey,
  tgMaterialId, REFERENCE_KINDS, templateFields, type ObtStep, type QuestionView, type RecordReview
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { indexesFor } from '../indexes';
import {
  ArrowLeftRight, Ban, Check, CheckCircle2, ChevronDown, ChevronUp, Circle, Clock, EarOff, Headphones,
  KeyRound, ListChecks, MessageSquare, SkipForward, Sparkles, Star, Timer, X
} from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { AudioClip } from '../audioClip';
import type { Ctx } from '../ctx';
import { Footer, Header, Note, Row, Screen, Section } from '../pui';
import { colors, radius, space, tint } from '../theme';
import { ActionButton, Card, text } from '../ui';
import { Byline, usePerson } from '../UserChip';
import { defineFiaProgress, fiaProgressId, FIA_STAGES } from '@langquest-next/core';
import { FiaGuidanceRecorder } from '../fia';
import { ObtHistory } from './obt';
import { Beads, passageOf } from './translate';
import { HoldToRecord } from './recordings';

/**
 * RETIRING: the old review screen. Links that still open it (My Work)
 * land here and are handed to review_capture. Legacy OBT lanes never get
 * here: App.tsx mounts the OBT hub.
 */
export function ReviewPassage(ctx: Ctx) {
  const { unitId, laneId } = passageOf(ctx);
  const stepId = ctx.params['taskId'] ? parseTaskId(ctx.params['taskId'])?.stepId : undefined;
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current || !unitId || !laneId) return;
    sent.current = true;
    ctx.go('review_capture', { unitId, laneId, ...(stepId ? { stepId } : {}) });
  });
  return <Screen><Header title={ctx.project.state?.units[unitId]?.label ?? unitId} onBack={ctx.back} />
    {!unitId || !laneId ? <Note>Task not found.</Note> : null}
  </Screen>;
}

/** Why a required question was left unanswered; stored as its `#skipped` answer. */
const CANT_ANSWER = [
  { icon: EarOff, reason: "Listeners weren't able to judge this" },
  { icon: Ban, reason: 'Not relevant for this passage' },
  { icon: Timer, reason: 'Ran out of time in the session' }
];

export function ReviewCapture(ctx: Ctx) {
  const { unitId, laneId } = passageOf(ctx);
  const state = ctx.project.state;
  const person = usePerson();
  const [played, setPlayed] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [skipFor, setSkipFor] = useState<QuestionView | null>(null);
  const [comment, setComment] = useState('');
  const [voice, setVoice] = useState<string | undefined>();
  const [open, setOpen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  if (!state || !unitId || !laneId || !state.units[unitId]) {
    return <Screen><Header title="" onBack={ctx.back} /><Note>{state ? 'Task not found.' : 'Opening passage…'}</Note></Screen>;
  }
  const title = state.units[unitId]?.label ?? unitId;
  const toggle = (id: string) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  const idx = indexesFor(state);
  const obt = isObtLane(state, laneId);

  // ---- what is being reviewed ----
  let takeId: string | null = null;
  let stepId = '';
  let stepLabel = '';
  /** Set on a v2 step: the kind this check is of. v1 steps keep ReviewSubmitted (old clients read it). */
  let kind: { kindId: string; name: string } | null = null;
  let n = 0;
  let obtStage: ObtStep | null = null;
  const record = obt ? null : derivePassageRecord(state, unitId, laneId, ctx.session.actorId, idx);
  const j = obt ? deriveObt(state, unitId, laneId) : null;
  if (record) {
    takeId = ctx.params['takeId'] && record.versions.some((v) => v.takeId === ctx.params['takeId'])
      ? ctx.params['takeId'] : record.latest?.takeId ?? null;
    const version = record.versions.find((v) => v.takeId === takeId);
    n = version?.n ?? 0;
    const steps = takeId ? deriveTakeStatus(state, takeId, idx).steps : [];
    const mine = steps.find((s) => s.eligible.includes(ctx.session.actorId) && !s.approved.includes(ctx.session.actorId) && !s.rejected.includes(ctx.session.actorId));
    stepId = ctx.params['stepId'] ?? (ctx.params['taskId'] ? parseTaskId(ctx.params['taskId'])?.stepId : undefined) ?? mine?.stepId ?? steps[0]?.stepId ?? '';
    const recStep = record.steps.find((s) => s.stepId === stepId);
    stepLabel = recStep?.label ?? stepId;
    if (recStep && !recStep.legacy) {
      const me = ctx.session.actorId;
      const k = recStep.kinds.find((x) => x.kindId === ctx.params['kindId'])
        ?? recStep.kinds.find((x) => x.state !== 'approved' && x.state !== 'recorded' && !x.checks.some((c) => c.reviewerId === me))
        ?? recStep.kinds[0];
      if (k) { kind = { kindId: k.kindId, name: k.name }; stepLabel = k.name; }
    }
  } else if (j) {
    if ((j.stage === 'consultant' || j.stage === 'final_approval') && obtCanAct(state, ctx.session.actorId, laneId, j.stage)) {
      obtStage = j.stage;
      takeId = j.stage === 'consultant' ? j.draftId : j.finalTakeId;
    }
    stepLabel = obtStage ?? '';
  }
  if (!takeId || (!obt && !stepId)) {
    return <Screen><Header title={title} onBack={ctx.back} />
      <View accessible accessibilityLabel="Nothing is waiting for your review here." style={styles.row}>
        <ListChecks size={28} color={colors.mutedForeground} /><Clock size={20} color={colors.mutedForeground} />
      </View>
    </Screen>;
  }
  const take = state.takes[takeId];
  const questions = obt ? [] : questionsOf(questionSetsFor(state, takeId, stepId));
  const handled = (q: QuestionView) => answers[q.id] !== undefined || answers[skippedAnswerKey(q.id)] !== undefined;
  const left = questions.filter((q) => q.required && !handled(q));
  const saysWhat = !!comment.trim() || !!voice;
  const canDecide = played && left.length === 0 && !busy;
  const response = state.responses[takeId];
  const study = obt ? null : fiaStudyStatus(state, laneId, unitId);
  const termLinks = keyTermLinksFor(state, takeId);
  const tg = state.materials[tgMaterialId(laneId)]?.fields[unitId]?.value;
  const earlier: RecordReview[] = (record?.versions ?? []).flatMap((v) => v.reviews)
    .filter((r) => !(r.takeId === takeId && r.stepId === stepId && r.reviewerId === ctx.session.actorId)).reverse();
  const versionN = (id: string) => record?.versions.find((v) => v.takeId === id)?.n ?? 0;
  const bt = j?.backTranslationId ? state.takes[j.backTranslationId] : undefined;
  const btStep = j?.steps.back_translation?.value;
  const obtClips = j?.inputId ? Object.entries(state.obt.audio).filter(([id]) => id.startsWith(`${j.inputId}:`)) : [];

  async function voiceCard(card: { id: string; ref: { hash: string; format: 'wav' | 'm4a' }; durationMs: number }) {
    if (obt && j?.inputId) {
      // OBT spoken comments are clips named by the stage input they answer.
      await ctx.project.append('v1.ObtAudioAdded', { clipId: `${j.inputId}:${card.id}`, unitId, laneId,
        cards: [{ hash: card.ref.hash, durationMs: card.durationMs, format: card.ref.format === 'wav' ? 'wav' : 'm4a' }] });
      ctx.project.triggerUpload();
    }
    setVoice(card.ref.hash);
  }

  async function decide(outcome: 'approve' | 'suggest_changes') {
    if (!canDecide || lock.current || (outcome === 'suggest_changes' && !saysWhat)) return;
    lock.current = true; setBusy(true); setError('');
    try {
      if (obt && j && obtStage && j.round && j.inputId) {
        const payload = { unitId, laneId, roundId: j.round.value.roundId, step: obtStage, inputId: j.inputId,
          decision: outcome === 'approve' ? 'approve' as const : 'changes_requested' as const,
          clipIds: obtClips.map(([id]) => id), ...(comment.trim() ? { note: comment.trim() } : {}) };
        assertObtStep(state!, ctx.session.actorId, payload);
        await ctx.project.append('v1.ObtStepRecorded', payload);
        ctx.toast(outcome === 'approve' ? 'Approved — looks good' : 'Feedback sent');
        ctx.back();
        return;
      }
      if (kind) {
        // v2 step: one check of one kind. The voice comment travels in the check.
        const skip = skippedAnswerKey('');
        const skippedQuestions = Object.entries(answers).filter(([k]) => k.endsWith(skip)).map(([k, reason]) => ({ questionId: k.slice(0, -skip.length), reason }));
        const given = Object.fromEntries(Object.entries(answers).filter(([k]) => !k.endsWith(skip)));
        await ctx.project.run(commands(state!, indexesFor(state!)).recordCheck({
          commandId: Crypto.randomUUID(), checkId: Crypto.randomUUID(), takeId: takeId!, kindId: kind.kindId, stepId,
          outcome: outcome === 'approve' ? 'looks_good' : 'needs_changes',
          ...(comment.trim() ? { comment: comment.trim() } : {}),
          ...(voice ? { commentBlobHash: voice } : {}),
          ...(Object.keys(given).length ? { answers: given } : {}),
          ...(skippedQuestions.length ? { skippedQuestions } : {})
        }));
        ctx.project.triggerUpload();
        ctx.toast(outcome === 'approve' ? `${kind.name} added — looks good` : `Feedback sent to ${person(take?.actorId ?? '').name}`);
        ctx.go('passage_record', { unitId, laneId });
        return;
      }
      const mineVoice = state!.reviewComments[takeId!]?.[stepId]?.[ctx.session.actorId];
      if (voice && !mineVoice) await ctx.project.append('v1.ReviewCommentRecorded', { takeId: takeId!, stepId, blobHash: voice });
      await ctx.project.run(commands(state!, indexesFor(state!)).reviewTake({
        commandId: Crypto.randomUUID(), takeId: takeId!, stepId, decision: outcome,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
        ...(Object.keys(answers).length ? { answers } : {})
      }));
      ctx.project.triggerUpload();
      ctx.toast(outcome === 'approve' ? `${stepLabel} added — looks good` : `Feedback sent to ${person(take?.actorId ?? '').name}`);
      ctx.go('passage_record', { unitId, laneId });
    } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }

  const hint = !played ? 'Play the version before deciding'
    : left.length ? `${left.length} required question${left.length === 1 ? '' : 's'} left — answer, or say why not`
    : !saysWhat ? 'To ask for changes, say what to change above' : '';
  const myCheck = kind ? record?.versions.find((v) => v.takeId === takeId)?.reviews.filter((r) => r.kindId === kind!.kindId && r.reviewerId === ctx.session.actorId).pop() : undefined;
  const mine = obt ? undefined : kind ? myCheck : state.reviews[takeId]?.[stepId]?.[ctx.session.actorId]?.value;

  return (
    <Screen tint={tint.review} footer={<View style={{ gap: space.sm }}>
      {hint ? <View accessible accessibilityLabel={hint} style={[styles.row, { justifyContent: 'center' }]}>
        {!played ? <Headphones size={18} color={colors.mutedForeground} /> : left.length ? <ListChecks size={18} color={colors.mutedForeground} /> : <MessageSquare size={18} color={colors.mutedForeground} />}
        {left.length && played ? <Text style={text.small}>{left.length}</Text> : null}
      </View> : null}
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel="Needs changes"
          accessibilityState={{ disabled: !canDecide || !saysWhat }} disabled={!canDecide || !saysWhat}
          onPress={() => void decide('suggest_changes')}
          style={[styles.needs, (!canDecide || !saysWhat) && styles.dead]}>
          <MessageSquare size={28} color={canDecide && saysWhat ? colors.review : colors.mutedForeground} />
          {!canDecide || !saysWhat ? <View style={styles.strike} /> : null}
        </Pressable>
        <ActionButton icon={Check} accessibilityLabel="Looks good" disabled={!canDecide}
          onPress={() => void decide('approve')} style={{ flex: 1 }} />
      </View>
    </View>}>
      <Header title={title} sub={obt ? undefined : `v${n}`} onBack={busy ? undefined : ctx.back}
        action={<View accessible accessibilityLabel={`${stepLabel}${mine ? `, you said ${mine.decision === 'approve' ? 'looks good' : 'needs changes'}` : ''}`} style={styles.row}>
          <ListChecks size={22} color={colors.review} />
          {mine ? mine.decision === 'approve' ? <CheckCircle2 size={18} color={colors.done} /> : <MessageSquare size={18} color={colors.review} /> : null}
        </View>} />

      <Card>
        <View accessible accessibilityLabel={obt ? 'Listen' : `Listen to version ${n}`} style={styles.row}>
          <Headphones size={20} color={colors.review} />
          {played ? <Check size={16} color={colors.done} /> : null}
        </View>
        <AudioClip project={ctx.project} hashes={take?.cardHashes ?? []} label={obt ? 'Play the version' : `Play version ${n}`} onPlay={() => setPlayed(true)} />
        {response?.blobHash ? <AudioClip project={ctx.project} hashes={[response.blobHash]} label="Hear what changed" hideActions /> : null}
        {response?.note ? <Text style={text.small} accessibilityLabel={`What changed: ${response.note}`}>{response.note}</Text> : null}
      </Card>

      {obt && bt ? <Card style={{ borderColor: colors.review, borderWidth: 1.5 }}>
        <View accessible style={styles.row}
          accessibilityLabel={`Back translation to compare${btStep?.language ? `, in ${btStep.language}` : ''}. Made for this check: compare its meaning with the source.`}>
          <ArrowLeftRight size={20} color={colors.review} />
          {btStep?.language ? <Text style={text.small}>{btStep.language}</Text> : null}
        </View>
        <AudioClip project={ctx.project} hashes={bt.cardHashes} label="Play the back translation" seekControls />
        {btStep?.note ? <Text style={text.body} accessibilityLabel={`Back translator's note: ${btStep.note}`}>{btStep.note}</Text> : null}
      </Card> : null}

      {!obt && (termLinks.length || tg) ? <Disclosure icon={KeyRound} label={`From the translator: ${termLinks.length} terms, ${tg ? 1 : 0} notes`}
        count={termLinks.length + (tg ? 1 : 0)} open={open.includes('translator')} onToggle={() => toggle('translator')}>
        {termLinks.map(({ term, note }) => <Pressable key={term.termId} style={styles.row} accessibilityRole="button"
          accessibilityLabel={`Key term ${term.term}`} onPress={() => ctx.go('key_term_detail', { termId: term.termId, takeId: takeId! })}>
          <KeyRound size={16} color={colors.reference} />
          <Text style={[text.body, { flex: 1 }]}>{term.term}{term.renderings[0] ? ` · ${term.renderings[0].rendering}` : ''}{note ? ` · ${note}` : ''}</Text>
        </Pressable>)}
        {tg?.blobHash ? <AudioClip project={ctx.project} hashes={[tg.blobHash]} label="Play the translator's note" hideActions /> : null}
        {tg?.text ? <Text style={text.body}>{tg.text}</Text> : null}
      </Disclosure> : null}

      {study ? <Disclosure icon={Sparkles} label={`The team's study: FIA, ${study.doneCount} of ${study.steps.length} steps`}
        count={study.doneCount} open={open.includes('study')} onToggle={() => toggle('study')}>
        <Beads done={study.steps.map((s) => !!s.done)} />
        {study.steps.map((s) => <Pressable key={s.stage.id} style={styles.row} accessibilityRole="button"
          accessibilityLabel={`${s.index + 1}. ${s.stage.label}${s.done ? ', done' : ''}`}
          onPress={() => ctx.go('study_step', { unitId, laneId, stage: s.stage.id })}>
          {s.done ? <CheckCircle2 size={18} color={colors.done} /> : <Circle size={18} color={colors.mutedForeground} />}
          <Text style={[text.body, { flex: 1 }]}>{s.index + 1} · {s.stage.label}</Text>
          {s.done ? <Byline id={s.done.by} /> : null}
        </Pressable>)}
        <ActionButton icon={Sparkles} variant="outline" accessibilityLabel="Open the study" onPress={() => ctx.go('study_guide', { unitId, laneId })} />
      </Disclosure> : null}

      {earlier.length ? <Disclosure icon={MessageSquare} label={`Earlier reviews: ${earlier.length}`}
        count={earlier.length} open={open.includes('earlier')} onToggle={() => toggle('earlier')}>
        {earlier.map((r) => <EarlierReview key={r.eventId} ctx={ctx} review={r} n={versionN(r.takeId)}
          stepLabel={record?.steps.find((s) => s.stepId === r.stepId)?.label ?? r.stepId}
          response={Object.values(state.responses).find((x) => x.respondsToTakeId === r.takeId)} />)}
      </Disclosure> : null}

      {obt ? <Disclosure icon={MessageSquare} label="Earlier rounds and resources" count={0}
        open={open.includes('history')} onToggle={() => toggle('history')}>
        <ObtHistory ctx={ctx} unitId={unitId} laneId={laneId} />
      </Disclosure> : null}

      {questions.length ? <View style={{ gap: space.sm }}>
        <View accessible style={styles.row} accessibilityLabel={`Questions, ${questions.filter((q) => q.required).length} required`}>
          <ListChecks size={20} color={colors.review} /><Text style={text.small}>{questions.length}</Text>
        </View>
        {questions.map((q) => {
          const skipped = answers[skippedAnswerKey(q.id)];
          return <Card key={q.id} style={q.required && !handled(q) ? { borderColor: colors.review } : undefined}>
            <View style={styles.row}>
              {q.required ? <View accessible accessibilityLabel="Required"><Star size={14} color={colors.review} /></View> : null}
              <Text style={[text.body, { flex: 1 }]}>{q.text}</Text>
            </View>
            {skipped !== undefined ? <View style={styles.row} accessible accessibilityLabel={`Left unanswered: ${skipped}`}>
              <SkipForward size={18} color={colors.mutedForeground} />
              <Text style={[text.small, { flex: 1 }]}>{skipped}</Text>
              <ActionButton icon={X} variant="outline" style={styles.small} accessibilityLabel="Answer it instead"
                onPress={() => setAnswers((a) => { const next = { ...a }; delete next[skippedAnswerKey(q.id)]; return next; })} />
            </View> : <>
              <AnswerInput q={q} value={answers[q.id]} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
              {q.required && answers[q.id] === undefined ? <ActionButton icon={SkipForward} variant="outline" style={styles.small}
                accessibilityLabel="Can't answer this?" onPress={() => setSkipFor(q)} /> : null}
            </>}
          </Card>;
        })}
      </View> : null}

      <Card>
        <View accessible accessibilityLabel="Your feedback" style={styles.row}>
          <MessageSquare size={20} color={colors.review} />
        </View>
        <HoldToRecord accessibilityLabel="Record voice feedback" disabled={busy} onCard={voiceCard} />
        {voice ? <AudioClip project={ctx.project} hashes={[voice]} label="Hear your voice feedback" hideActions /> : null}
        {obtClips.filter(([, r]) => r.value.cards[0]?.hash !== voice).map(([id, r]) => <AudioClip key={id} project={ctx.project}
          hashes={r.value.cards.map((c) => c.hash)} label="Play spoken review comment" hideActions />)}
        <TextInput style={styles.input} accessibilityLabel="Or type it — what worked, what didn't"
          placeholder="Or type it" value={comment} onChangeText={setComment} multiline />
      </Card>
      {error ? <Note>{error}</Note> : null}

      <Modal visible={!!skipFor} transparent animationType="fade" onRequestClose={() => setSkipFor(null)}>
        <View style={styles.scrim}>
          <View style={styles.sheet} accessibilityViewIsModal>
            <View accessible style={styles.row}
              accessibilityLabel="Leave this question unanswered? Required questions can be skipped. The reason is saved with your review.">
              <SkipForward size={24} color={colors.review} /><Text style={[text.body, { flex: 1 }]}>{skipFor?.text}</Text>
            </View>
            {CANT_ANSWER.map((c) => <Row key={c.reason} icon={c.icon} label={c.reason}
              onPress={() => { if (skipFor) setAnswers((a) => ({ ...a, [skippedAnswerKey(skipFor.id)]: c.reason })); setSkipFor(null); }} />)}
            <ActionButton icon={X} variant="outline" accessibilityLabel="Cancel" onPress={() => setSkipFor(null)} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

/** A collapsed background section: icon, count, and a chevron. */
function Disclosure(props: { icon: typeof Check; label: string; count: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  return <Card style={{ gap: space.sm }}>
    <Pressable onPress={props.onToggle} accessibilityRole="button" accessibilityLabel={props.label}
      accessibilityState={{ expanded: props.open }} style={styles.row}>
      <props.icon size={20} color={colors.review} />
      <Text style={[text.small, { flex: 1 }]}>{props.count || ''}</Text>
      {props.open ? <ChevronUp size={18} color={colors.mutedForeground} /> : <ChevronDown size={18} color={colors.mutedForeground} />}
    </Pressable>
    {props.open ? props.children : null}
  </Card>;
}

/** What an earlier reviewer said and recorded; recordings play in place. */
function EarlierReview(props: { ctx: Ctx; review: RecordReview; n: number; stepLabel: string;
  response: { note?: string; blobHash?: string } | undefined }) {
  const [open, setOpen] = useState(false);
  const r = props.review;
  const good = r.decision === 'approve';
  return <View style={{ gap: space.xs }}>
    <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}
      accessibilityLabel={`${props.stepLabel}, version ${props.n}, ${good ? 'looks good' : 'needs changes'}`} style={styles.row}>
      {good ? <CheckCircle2 size={18} color={colors.done} /> : <MessageSquare size={18} color={colors.review} />}
      <Byline before={`v${props.n} · ${props.stepLabel} ·`} id={r.reviewerId} />
    </Pressable>
    {open ? <View style={{ gap: space.xs, paddingLeft: space.lg }}>
      {r.voiceHash ? <AudioClip project={props.ctx.project} hashes={[r.voiceHash]} label="Hear the voice feedback" hideActions /> : null}
      {r.comment ? <Text style={text.body}>{r.comment}</Text> : null}
      {!good && props.response?.blobHash ? <AudioClip project={props.ctx.project} hashes={[props.response.blobHash]} label="Hear the translator's response" hideActions /> : null}
      {!good && props.response?.note ? <Text style={text.small} accessibilityLabel={`Revised: ${props.response.note}`}>{props.response.note}</Text> : null}
    </View> : null}
  </View>;
}

/** The answer control a question's type asks for. Selected is review teal, never yellow. */
function AnswerInput(props: { q: QuestionView; value?: string; onChange: (v: string) => void }) {
  if (props.q.type === 'text') {
    return <TextInput style={[styles.input, { minHeight: 64 }]} accessibilityLabel="Your answer" placeholder="Your answer"
      value={props.value ?? ''} onChangeText={props.onChange} multiline />;
  }
  const options = props.q.type === 'rating'
    ? ['1', '2', '3', '4', '5'].map((v) => ({ v, label: `${v} of 5`, node: <Text style={styles.optText}>{v}</Text> }))
    : [{ v: 'Yes', label: 'Yes', node: <Check size={22} color={colors.foreground} /> },
       { v: 'No', label: 'No', node: <X size={22} color={colors.foreground} /> }];
  return <View style={styles.row}>
    {options.map((o) => {
      const on = props.value === o.v;
      return <Pressable key={o.v} onPress={() => props.onChange(o.v)} accessibilityRole="button"
        accessibilityLabel={o.label} accessibilityState={{ selected: on }}
        style={[styles.opt, on && { backgroundColor: tint.reviewBadge, borderColor: colors.review }]}>
        {o.node}
      </Pressable>;
    })}
  </View>;
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
  const expected = kind === 'fia_study' ? FIA_STAGES.map(s => s.id)
    : templateFields(existing?.templateRef);
  const editableFields = (existing?.fields ?? [])
    .filter(f => !f.fieldId.startsWith('fia-progress:'));
  const fieldIds = [...new Set([...expected, ...editableFields.map(f => f.fieldId)])];
  const [fields, setFields] = useState<Record<string, string>>(Object.fromEntries(editableFields.map((f) => [f.fieldId, f.text ?? ''])));
  const [newField, setNewField] = useState('');
  const canManage = ctx.session.can('manage_reference');
  const canFill = canManage || (ctx.session.can('fill_reference') && !existing?.locked);
  const isNew = !existing;
  async function save() {
    const id = existing?.materialId ?? `${kind}-${Date.now()}`;
    const events: Parameters<typeof appendMany>[0] = [];
    if (kind === 'fia_study' && laneId && canManage &&
      !state?.materials[fiaProgressId(laneId)]) {
      events.push(defineFiaProgress(laneId));
    }
    if (isNew) events.push({ type: 'v1.MaterialDefined', payload: { materialId: id, kind, title: title.trim() || kind, scope: { ...(laneId ? { laneId } : {}), ...(unitId ? { unitId } : {}) }, ...(kind === 'fia_study' ? { templateRef: 'fia_study/guided@1' } : {}) } });
    for (const [fieldId, value] of Object.entries(fields)) {
      if (fieldId.startsWith('fia-progress:')) continue;
      const previous = existing?.fields.find((f) => f.fieldId === fieldId);
      if (value.trim() !== (previous?.text ?? '')) events.push({
        type: 'v1.MaterialFieldSet', payload: { materialId: id, fieldId,
          text: value.trim(), ...(previous?.blobHash ? { blobHash: previous.blobHash } : {}) }
      });
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
            {existing?.kind === 'fia_study' && FIA_STAGES.some(s => s.id === fieldId)
              ? <FiaGuidanceRecorder ctx={ctx} materialId={existing.materialId}
                  stage={fieldId as (typeof FIA_STAGES)[number]['id']} /> : null}
          </Card>
        ))}
        {canFill ? (
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
            <TextInput style={[styles.input, { flex: 1, minHeight: 44 }]} placeholder={existing?.kind === 'questions' || kind === 'questions' ? 'New question id (e.g. q3)' : 'New field (e.g. body)'} autoCapitalize="none" value={newField} onChangeText={setNewField} />
            <Pressable
              onPress={() => {
                const id = newField.trim();
                if (id && !id.startsWith('fia-progress:') && !(id in fields)) setFields((f) => ({ ...f, [id]: '' }));
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
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  needs: { flex: 1, height: 64, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.review,
    backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  dead: { borderStyle: 'dashed', borderColor: colors.border, backgroundColor: colors.muted },
  strike: { position: 'absolute', width: 48, height: 2, backgroundColor: colors.mutedForeground, transform: [{ rotate: '-35deg' }] },
  small: { height: 44, paddingHorizontal: space.md, alignSelf: 'flex-start' },
  opt: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  optText: { fontSize: 18, fontWeight: '700', color: colors.foreground },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, padding: space.lg, gap: space.md, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, minHeight: 100, backgroundColor: colors.card, color: colors.foreground }
});

import { contractsFor } from '../screenContracts';
export const contracts = contractsFor('review_passage', 'review_capture', 'material_editor');
