// Avatar U for the passage record and the work screens; Avatar P for Ask someone,
// Log what happened, and the version and review details.
// Screens still marked Placeholder show their passage and say they are not
// wired yet (docs/ux/mobbin-overhaul/CHECKLIST.md); later phases build them out.
import {
  decodeHlc, deriveObt, derivePassageRecord, deriveTakeStatus, keyTermLinksFor, OBT_LABELS, questionsOf, questionSetsFor,
  checkCredit, clockOf, commands, recordHeadline, recordNextAction, reviewKind, reviewKinds, type DepartureKind, type PassageRecord as Rec, type RecordDeparture, type RecordEntry,
  type RecordKind, type RecordReview, type RecordStep
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import type { LucideIcon } from 'lucide-react-native';
import {
  ArrowUpDown, Ban, BookmarkCheck, CalendarClock, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, Clock, CopyCheck, Globe, Grid3x3,
  Headphones, History, ListChecks, Lock, Languages, MapPin, MessageSquare, Mic, Octagon, Reply, RotateCcw, ShieldCheck,
  KeyRound, Minus, Plus, SkipForward, StickyNote, Star, Undo2, UserPlus, UserX, Users, X
} from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { AudioClip } from '../audioClip';
import type { Ctx } from '../ctx';
import { edgeFor, TITLES, type ScreenId } from '../flow';
import { indexesFor } from '../indexes';
import { Footer, Header, Note, NotWired, Row, Screen, Section } from '../pui';
import { ReasonSheet, type Reason } from '../reasonSheet';
import { edgeAllowed } from '../session';
import { colors, radius, space, StyleSheet, tint } from '../theme';
import { ActionButton, Card, ProgressRing, StatusIcon, text } from '../ui';
import { Byline, PersonAvatar, usePerson } from '../UserChip';
import { HoldToRecord } from './recordings';

/** The passage a screen is about, from `unitId` in its params. */
export function passageLabel(ctx: Ctx): string {
  const unitId = ctx.params['unitId'] ?? '';
  return ctx.project.state?.units[unitId]?.label ?? unitId;
}

export function Placeholder(props: { ctx: Ctx; id: ScreenId }) {
  return (
    <Screen>
      <Header title={TITLES[props.id]} sub={passageLabel(props.ctx) || undefined} onBack={props.ctx.back} />
      <NotWired what={TITLES[props.id]} />
    </Screen>
  );
}

// ─── passage_record (Avatar U) ────────────────────────────────────────────────
// Where a passage stands and whose turn it is (J-REC-1), from the pure
// `derivePassageRecord` in core. Reference copy is the accessibility label;
// the passage reference, language code and step names are the only text.
// Kinds in one step show as stacked tiles ("Either order"); a checkpoint
// carries a stop badge and later steps show locked until it clears.
// Departures (J-REC-5/6/7): "Set aside" a kind or step with a reason, "Move
// past this checkpoint…" (manage_flows), and Undo from the toast or the
// history, each a compensating fact. Still absent: Log what happened.

/** Reference ReasonSheet copy for the departures (ref:passage.tsx:31-39). */
const SET_ASIDE_QUICK = [
  { icon: UserX, reason: 'No one available for this right now' },
  { icon: CopyCheck, reason: 'Another review already covered this' },
  { icon: Ban, reason: 'Not needed for this passage' }
];
const OVERRIDE_QUICK = [
  { icon: CalendarClock, reason: 'Consultant visit is months away; church needs it now' },
  { icon: ClipboardCheck, reason: 'Checked informally — will record it later' }
];

/** "Keep it, say why" (J-REC-4, ref:passage.tsx:40-44). No new version is made. */
const KEEP_SHEET = {
  title: 'Keep it as it is?',
  sub: 'No new version is made. Your reason goes back to the reviewer and into the record.',
  quick: [
    { icon: Users, reason: 'Listeners preferred the current wording' },
    { icon: KeyRound, reason: 'Matches our key terms decision' },
    { icon: MessageSquare, reason: 'The suggestion changes the meaning' }
  ],
  confirmIcon: BookmarkCheck,
  confirmLabel: 'Keep and send reason'
};

/** Answer feedback by keeping the version: a FeedbackKept naming the check, or the legacy review. */
async function keepFeedback(ctx: Ctx, f: RecordReview, why: Reason) {
  await ctx.project.append('v1.FeedbackKept', {
    keptId: Crypto.randomUUID(),
    ...(f.checkId !== undefined ? { checkId: f.checkId } : { legacyTarget: { takeId: f.takeId, stepId: f.stepId, reviewerId: f.reviewerId } }),
    ...why
  });
  ctx.project.triggerUpload();
  // No toast Undo: there is no fact to take a kept answer back yet.
  ctx.toast('Kept · your reason is on the record');
}

/** What the reason sheet is for. */
type Departing = { kind: DepartureKind; stepId: string; kindId?: string; name: string };

const canGo = (ctx: Ctx, from: ScreenId, to: ScreenId) => {
  const edge = edgeFor(from, to);
  return edge !== undefined && edgeAllowed(edge, ctx.session);
};

/** "Sep 25" from a clock; the record's dates are short on purpose. */
function shortDate(hlc: string): string {
  const d = new Date(decodeHlc(hlc).wallMs);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getDate()}`;
}

/** A step's icon: by its id where the flow names the kind of check, else by role. */
function stepIcon(step: Pick<RecordStep, 'stepId' | 'role'>): LucideIcon {
  if (/local/.test(step.stepId)) return MapPin;
  if (/final/.test(step.stepId)) return Star;
  if (/community|retell|playback/.test(step.stepId)) return Users;
  if (/back_?translation/.test(step.stepId)) return Languages;
  if (/consult|approv/.test(step.stepId) || step.role === 'coordinator' || step.role === 'owner') return ShieldCheck;
  return ListChecks;
}

function useRecord(ctx: Ctx): { rec: Rec; unitId: string; laneId: string } | null {
  const { state } = ctx.project;
  const unitId = ctx.params['unitId'] ?? '';
  const laneId = ctx.params['laneId'] ?? (state ? Object.keys(state.lanes)[0] ?? '' : '');
  if (!state || !state.units[unitId]) return null;
  return { rec: derivePassageRecord(state, unitId, laneId, ctx.session.actorId, indexesFor(state)), unitId, laneId };
}

export function PassageRecord(ctx: Ctx) {
  const person = usePerson();
  const [sheet, setSheet] = useState<string | null>(null);
  const [open, setOpen] = useState<{ reviews: boolean; history: boolean }>({ reviews: false, history: false });
  const [departing, setDeparting] = useState<Departing | null>(null);
  const [keeping, setKeeping] = useState<RecordReview | null>(null);
  const loaded = useRecord(ctx);
  const { state } = ctx.project;
  if (!state || !loaded) return <Note>Passage not found.</Note>;
  const { rec, unitId, laneId } = loaded;
  const me = ctx.session.actorId;
  const nameOf = (id: string) => (id === me ? 'you' : person(id).name);
  const headline = recordHeadline(rec, nameOf);
  const action = recordNextAction(rec, me, { record: ctx.session.can('translate'), review: ctx.session.can('review'), ask: ctx.session.can('send_to_reviewers') });
  const params = { unitId, laneId };
  const depart = (d: Departing) => { setSheet(null); setDeparting(d); };
  const mayUndo = (d: RecordDeparture) => ctx.session.can(d.kind === 'set_aside' ? 'translate' : 'manage_flows');

  async function undoDeparture(departureId: string, departureKind: DepartureKind) {
    await ctx.project.append('v1.DepartureUndone', { undoId: Crypto.randomUUID(), departureId, departureKind });
    ctx.project.triggerUpload();
    ctx.toast('Brought back — it\'s a suggested step again');
  }

  async function confirmDeparture(d: Departing, why: Reason) {
    const departureId = Crypto.randomUUID();
    if (d.kind === 'set_aside') {
      await ctx.project.append('v1.StepSetAside', { departureId, unitId, laneId, stepId: d.stepId, ...(d.kindId ? { kindId: d.kindId } : {}), ...why });
      ctx.project.triggerUpload();
      setDeparting(null);
      ctx.toast(`${d.name} set aside · reason saved`, () => void undoDeparture(departureId, 'set_aside'));
    } else {
      await ctx.project.append('v1.CheckpointOverridden', { departureId, unitId, laneId, stepId: d.stepId, ...why });
      ctx.project.triggerUpload();
      setDeparting(null);
      // Reference: no toast Undo for an override; the history Undo works.
      ctx.toast('Moved past the checkpoint · reason saved');
    }
  }

  const footer = (() => {
    switch (action.kind) {
      case 'record_fix':
        return canGo(ctx, 'passage_record', 'workspace') ? <ActionButton icon={Reply} accessibilityLabel="Record a fix" onPress={() => ctx.go('workspace', { ...params, respondsTo: action.respondsTo })} /> : null;
      case 'record':
        return canGo(ctx, 'passage_record', 'workspace') ? <ActionButton icon={Mic} accessibilityLabel={rec.draft ? 'Continue recording' : 'Record it'} onPress={() => ctx.go('workspace', params)} /> : null;
      case 'new_version':
        return canGo(ctx, 'passage_record', 'workspace') ? <ActionButton icon={Mic} accessibilityLabel="New version" onPress={() => ctx.go('workspace', params)} /> : null;
      case 'review': {
        // A producing kind (back translation) is made, not judged.
        const to = action.kindId && state && reviewKind(state, action.kindId).produces ? 'back_translation' : 'review_capture';
        return canGo(ctx, 'passage_record', to) ? <ActionButton icon={to === 'back_translation' ? Languages : ListChecks} accessibilityLabel={to === 'back_translation' ? 'Back-translate it now' : 'Review it now'} onPress={() => ctx.go(to, { ...params, takeId: action.takeId, stepId: action.stepId, ...(action.kindId ? { kindId: action.kindId } : {}) })} /> : null;
      }
      case 'ask':
        return canGo(ctx, 'passage_record', 'ask_someone') ? <ActionButton icon={UserPlus} accessibilityLabel="Ask someone" onPress={() => ctx.go('ask_someone', { ...params, stepId: action.stepId })} /> : null;
      case 'none':
        return null;
    }
  })();

  const language = state.lanes[laneId]?.languoidId ?? laneId;
  const sheetStep = rec.steps.find((s) => s.stepId === sheet);
  return (
    <Screen footer={footer ?? undefined}>
      <Header title={state.units[unitId]!.label} onBack={ctx.back}
        action={<View style={styles.lang} accessibilityLabel={`Language ${language}`}><Globe size={14} color={colors.mutedForeground} /><Text style={text.small}>{language}</Text></View>} />

      {rec.obt ? <ObtHero ctx={ctx} unitId={unitId} laneId={laneId} /> : (
        <>
          <Hero rec={rec} headline={headline} me={me} onLatest={() => setOpen((o) => ({ ...o, history: true }))} />
          <StepPath rec={rec} onStep={setSheet} onRecorded={() => setSheet('recorded')} />
          {rec.openFeedback.map((f) => (
            <FeedbackCard key={`${f.stepId}:${f.reviewerId}:${f.eventId}`} ctx={ctx} rec={rec} feedback={f} nameOf={nameOf}
              onPress={() => ctx.go('review_detail', { ...params, takeId: f.takeId, round: `${f.stepId}:${f.reviewerId}` })}
              onKeep={rec.feedbackIsMine && ctx.session.can('translate') ? () => setKeeping(f) : undefined} />
          ))}
          <NextZone ctx={ctx} rec={rec} action={action} params={params} onDepart={depart} />
          <Details ctx={ctx} rec={rec} open={open} setOpen={setOpen} params={params} nameOf={nameOf}
            mayUndo={mayUndo} onUndo={(d) => void undoDeparture(d.departureId, d.kind)} />
        </>
      )}

      <Modal visible={sheet !== null} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <Pressable style={styles.scrim} onPress={() => setSheet(null)} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          {sheet === 'recorded' ? <RecordedSheet ctx={ctx} rec={rec} params={params} close={() => setSheet(null)} nameOf={nameOf} />
            : sheetStep ? <StepSheet ctx={ctx} rec={rec} step={sheetStep} params={params} close={() => setSheet(null)} nameOf={nameOf} onDepart={depart} /> : null}
        </View>
      </Modal>
      <ReasonSheet ctx={ctx} visible={departing !== null} onClose={() => setDeparting(null)}
        icon={departing?.kind === 'override' ? Octagon : SkipForward} name={departing?.name ?? ''}
        {...(departing?.kind === 'override' ? {
          title: 'Move past the checkpoint?',
          sub: 'Checkpoints are the flow\'s hard stops. Your reason is recorded with your name, and anyone can see it on the record.',
          quick: OVERRIDE_QUICK, confirmIcon: Octagon, confirmLabel: 'Move past checkpoint'
        } : {
          title: `Set aside ${departing?.name ?? ''}?`,
          sub: 'The flow suggests this step. Setting it aside is fine — say why so the next person understands.',
          quick: SET_ASIDE_QUICK, confirmIcon: SkipForward, confirmLabel: 'Set aside'
        })}
        onConfirm={(why) => departing ? confirmDeparture(departing, why) : Promise.resolve()} />
      <ReasonSheet ctx={ctx} visible={keeping !== null} onClose={() => setKeeping(null)} icon={BookmarkCheck}
        name={keeping ? rec.steps.flatMap((s) => s.kinds).find((k) => k.kindId === keeping.kindId)?.name ?? keeping.stepId : ''}
        {...KEEP_SHEET} onConfirm={async (why) => { if (keeping) { await keepFeedback(ctx, keeping, why); setKeeping(null); } }} />
    </Screen>
  );
}

/** Whose turn glyph, progress ring, and the latest entry (J-REC-1, J-REC-17). */
function Hero(props: { rec: Rec; headline: string; me: string; onLatest: () => void }) {
  const { rec } = props;
  const person = usePerson();
  const t = rec.turn;
  const avatars = (ids: string[]) => ids.slice(0, 3).map((id) => <PersonAvatar key={id} look={person(id)} size={28} />);
  const glyph = (() => {
    switch (t.kind) {
      case 'done': return <CheckCircle2 size={36} color={colors.done} />;
      case 'not_recorded': return rec.draft
        ? <>{avatars([rec.draft.authorId])}<Mic size={28} color={colors.translate} /></>
        : <View style={styles.dashedRing}><Mic size={24} color={colors.mutedForeground} /></View>;
      case 'answer_feedback': return <>{avatars([t.authorId])}{t.mine ? <Reply size={28} color={colors.translate} /> : <Clock size={28} color={colors.mutedForeground} />}</>;
      case 'asked': return <>{avatars(t.waitingOn)}{t.mine ? <ListChecks size={28} color={colors.review} /> : <Clock size={28} color={colors.mutedForeground} />}</>;
      case 'next': {
        const step = rec.steps.find((s) => s.stepId === t.stepIds[0]);
        const Icon = step ? stepIcon(step) : ListChecks;
        return <Icon size={32} color={colors.review} />;
      }
      case 'in_review': return <Clock size={32} color={colors.mutedForeground} />;
    }
  })();
  const latest = rec.history[0];
  return (
    <Card style={t.kind === 'done' ? { backgroundColor: tint.done, borderColor: tint.doneBorder } : undefined}>
      <View style={styles.heroRow}>
        <View style={styles.heroGlyph} accessible accessibilityRole="header" accessibilityLabel={props.headline}>{glyph}</View>
        {rec.steps.length > 0 ? (
          <ProgressRing completed={rec.cleared} total={rec.steps.length} size={52} color={colors.done}
            accessibilityLabel={`${rec.cleared} of ${rec.steps.length} done`} />
        ) : null}
      </View>
      {latest ? (
        <Pressable onPress={props.onLatest} style={styles.latest} accessibilityRole="button"
          accessibilityLabel={`Latest: ${entryTitle(latest, rec)} · ${person(latest.by).name} · ${shortDate(latest.at)}`}>
          <EntryIcon entry={latest} />
          <PersonAvatar look={person(latest.by)} size={18} />
          <Text style={text.small}>{shortDate(latest.at)}</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

function ObtHero(props: { ctx: Ctx; unitId: string; laneId: string }) {
  const { ctx } = props;
  const j = deriveObt(ctx.project.state!, props.unitId, props.laneId);
  const done = j.stage === 'complete';
  return (
    <Card style={done ? { backgroundColor: tint.done, borderColor: tint.doneBorder } : undefined}>
      <View style={styles.heroRow} accessible accessibilityLabel={OBT_LABELS[j.stage]}>
        {done ? <CheckCircle2 size={36} color={colors.done} /> : <Headphones size={32} color={colors.review} />}
        <Text style={text.body}>{OBT_LABELS[j.stage]}</Text>
      </View>
      {canGo(ctx, 'passage_record', 'obt_passage') ? (
        <ActionButton variant="outline" icon={ChevronRight} accessibilityLabel="Open the oral workflow"
          onPress={() => ctx.go('obt_passage', { unitId: props.unitId, laneId: props.laneId, taskId: `${ctx.session.role === 'reviewer' ? 'review' : 'translate'}:${props.unitId}:${props.laneId}` })} />
      ) : null}
    </Card>
  );
}

const TILE_STATE_LABEL: Record<RecordStep['state'], string> = {
  complete: 'looks good', attention: 'needs changes', waiting: 'asked', current: 'next', todo: 'not yet', locked: 'not recorded yet'
};

/** A kind's tile state inside its step: the kind's own state, with the step's next/locked framing. */
function kindTileState(k: RecordKind, step: RecordStep): RecordStep['state'] {
  switch (k.state) {
    case 'approved': case 'addressed': case 'skipped': case 'recorded': return 'complete';
    case 'suggestions': return 'attention';
    case 'asked': return 'waiting';
    case 'locked': return 'locked';
    case 'todo': return step.state === 'current' ? 'current' : step.state === 'locked' ? 'locked' : 'todo';
  }
}

/** The accessibility words for a tile, naming the checkpoint that holds a locked step. */
function tileLabel(rec: Rec, step: RecordStep, name: string, state: RecordStep['state'], kind?: RecordKind | null): string {
  const lockedBy = step.lockedBy ? rec.steps.find((x) => x.stepId === step.lockedBy)?.label ?? step.lockedBy : null;
  const words = state === 'locked' && lockedBy ? `waits for the ${lockedBy} checkpoint`
    : kind?.state === 'skipped' || (!kind && step.kinds.every((k) => k.state === 'skipped') && step.kinds.length > 0) ? 'set aside'
    : TILE_STATE_LABEL[state];
  return `${name}${step.checkpoint ? ', checkpoint' : ''}: ${words}${step.override ? ', moved past' : ''}`;
}

/** A pressable step tile. Colour never alone: every state has its corner icon. */
function StepTile(props: { icon: LucideIcon; state: RecordStep['state']; label: string; half?: boolean; asked?: string[]; onPress: () => void; a11y?: string }) {
  const person = usePerson();
  const Icon = props.icon;
  const s = props.state;
  const bg = s === 'complete' ? tint.done : s === 'attention' ? tint.review : s === 'locked' ? colors.muted : colors.card;
  const fg = s === 'complete' ? colors.done : s === 'attention' || s === 'current' || s === 'waiting' ? colors.review : colors.mutedForeground;
  const Corner = s === 'complete' ? CheckCircle2 : s === 'attention' ? MessageSquare : s === 'waiting' ? Clock : s === 'locked' ? Lock : null;
  return (
    <Pressable onPress={props.onPress} accessibilityRole="button" accessibilityLabel={props.a11y ?? `${props.label}: ${TILE_STATE_LABEL[s]}`}
      style={({ pressed }) => [styles.tile, props.half && styles.tileHalf, { backgroundColor: bg },
        s === 'current' && styles.tileCurrent, s === 'locked' && styles.tileLocked, pressed && { opacity: 0.8 }]}>
      <Icon size={props.half ? 20 : 26} color={fg} />
      {Corner ? <View style={styles.corner}><Corner size={14} color={fg} /></View> : null}
      {s === 'locked' ? <View style={styles.strike} /> : null}
      {props.asked && props.asked.length > 0 ? <View style={styles.askedDot}><PersonAvatar look={person(props.asked[0]!)} size={14} /></View> : null}
    </Pressable>
  );
}

/** Recorded node, then one column per step group; a group of two stacks with an either-order glyph (ADR-016). */
function StepPath(props: { rec: Rec; onStep: (id: string) => void; onRecorded: () => void }) {
  const { rec } = props;
  const groups = [...new Set(rec.steps.map((s) => s.group))].map((g) => rec.steps.filter((s) => s.group === g));
  const recordedState: RecordStep['state'] = rec.recorded ? 'complete' : 'current';
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.path}
      accessibilityLabel="Steps" accessibilityHint="Tap any step to ask someone, log it, or set it aside.">
      <StepTile icon={Mic} state={recordedState} label="Recorded" onPress={props.onRecorded} />
      {groups.map((g) => (
        <View key={g[0]!.group} style={styles.pathGroup}>
          <View style={styles.connector} />
          <View style={{ gap: 2, alignItems: 'center' }} accessibilityLabel={g.length > 1 || g.some((s) => s.kinds.length > 1) ? 'Either order' : undefined}>
            {g.flatMap((s): { s: RecordStep; k: RecordKind | null }[] => (s.legacy || s.kinds.length === 0 ? [{ s, k: null }] : s.kinds.map((k) => ({ s, k }))))
              .map(({ s, k }, i, all) => {
                const tileState = k ? kindTileState(k, s) : s.state;
                const name = k ? k.name : s.label;
                return (
                  <View key={`${s.stepId}:${k?.kindId ?? ''}`} style={{ alignItems: 'center' }}>
                    {i > 0 ? <ArrowUpDown size={12} color={colors.mutedForeground} /> : null}
                    <StepTile icon={stepIcon({ stepId: k?.kindId ?? s.stepId, role: s.role })} state={tileState} label={name}
                      a11y={tileLabel(props.rec, s, name, tileState, k)} half={all.length > 1} asked={s.askedOf} onPress={() => props.onStep(s.stepId)} />
                  </View>
                );
              })}
            {g.some((s) => s.checkpoint) ? <View accessible accessibilityLabel="Checkpoint: later steps wait for this one"><Octagon size={12} color={colors.review} /></View> : null}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

/** Feedback on the latest version (J-REC-3, J-REC-16). The author's footer is Record a fix. */
function FeedbackCard(props: { ctx: Ctx; rec: Rec; feedback: Rec['openFeedback'][number]; nameOf: (id: string) => string; onPress: () => void; onKeep?: () => void }) {
  const { rec, feedback: f } = props;
  const person = usePerson();
  const step = rec.steps.find((s) => s.stepId === f.stepId);
  const StepIcon = step ? stepIcon(step) : ListChecks;
  const author = rec.latest!.authorId;
  const label = rec.feedbackIsMine
    ? `${step?.label ?? f.stepId} asked for changes. Record a fix to answer it.`
    : `Waiting on ${props.nameOf(author)} to answer the ${step?.label ?? f.stepId}`;
  return (
    <View style={styles.feedback}>
    <Pressable onPress={props.onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [{ gap: space.sm }, pressed && { opacity: 0.85 }]}>
      <View style={styles.feedbackHead}>
        <PersonAvatar look={person(f.reviewerId)} size={28} />
        <StepIcon size={18} color={colors.review} />
        <MessageSquare size={18} color={colors.review} />
        <View style={{ flex: 1 }} />
        {rec.feedbackIsMine ? null : <><Clock size={16} color={colors.mutedForeground} /><PersonAvatar look={person(author)} size={20} /></>}
      </View>
      {f.voiceHash ? <AudioClip project={props.ctx.project} hashes={[f.voiceHash]} label="Voice feedback" hideActions /> : null}
      {f.comment ? <Text style={text.body} numberOfLines={3}>{f.comment}</Text> : null}
    </Pressable>
    {props.onKeep ? <View style={styles.sheetActions}>
      <ActionButton variant="outline" icon={BookmarkCheck} style={styles.iconBtn} accessibilityLabel="Keep it, say why" onPress={props.onKeep} />
    </View> : null}
    </View>
  );
}

/**
 * The next step's rows (J-REC-8). While feedback is open the row is the
 * dashed "Then: …" state with no buttons (ADR-014). The action the footer
 * already offers is not repeated here, so nothing but the footer is yellow.
 */
function NextZone(props: { ctx: Ctx; rec: Rec; action: ReturnType<typeof recordNextAction>; params: Record<string, string>; onDepart: (d: Departing) => void }) {
  const { ctx, rec } = props;
  const person = usePerson();
  if (!rec.next) return null;
  const then = rec.openFeedback.length > 0;
  const steps = rec.steps.filter((s) => rec.next!.stepIds.includes(s.stepId));
  return (
    <View style={{ gap: space.sm }}>
      {steps.map((s) => {
        const Icon = stepIcon(s);
        const canReview = !then && ctx.session.can('review') && !!s.status?.waitingOn.includes(ctx.session.actorId)
          && !(props.action.kind === 'review' && props.action.stepId === s.stepId) && canGo(ctx, 'passage_record', 'review_capture');
        const canAsk = !then && s.role !== 'translator' && canGo(ctx, 'passage_record', 'ask_someone')
          && !(props.action.kind === 'ask' && props.action.stepId === s.stepId);
        return (
          <View key={s.stepId} style={[styles.nextRow, then && styles.nextThen]}
            accessibilityLabel={then ? `Then: ${s.label}` : `Next step: ${s.label}`}>
            <Icon size={24} color={colors.review} />
            <Text style={[text.body, { flex: 1 }]} numberOfLines={1}>{s.label}</Text>
            {then ? <><Clock size={16} color={colors.mutedForeground} /><MessageSquare size={16} color={colors.review} /></> : null}
            {s.askedOf.map((id) => <PersonAvatar key={id} look={person(id)} size={20} />)}
            {canReview ? <ActionButton variant="outline" icon={ListChecks} accessibilityLabel="Review it now" style={styles.iconBtn}
              onPress={() => ctx.go('review_capture', { ...props.params, takeId: rec.latest!.takeId, stepId: s.stepId })} /> : null}
            {canAsk ? <ActionButton variant="outline" icon={UserPlus} accessibilityLabel={s.askedOf.length ? 'Ask again' : 'Ask someone'} style={styles.iconBtn}
              onPress={() => ctx.go('ask_someone', { ...props.params, stepId: s.stepId })} /> : null}
            {!then && s.checkpoint && ctx.session.can('manage_flows') ? <ActionButton variant="outline" icon={Octagon} style={styles.iconBtn}
              accessibilityLabel="Move past this checkpoint…" onPress={() => props.onDepart({ kind: 'override', stepId: s.stepId, name: s.label })} /> : null}
          </View>
        );
      })}
    </View>
  );
}

function StepSheet(props: { ctx: Ctx; rec: Rec; step: RecordStep; params: Record<string, string>; close: () => void; nameOf: (id: string) => string; onDepart: (d: Departing) => void }) {
  const { ctx, rec, step } = props;
  const person = usePerson();
  const Icon = stepIcon(step);
  const reviews = rec.latest?.reviews.filter((r) => r.stepId === step.stepId) ?? [];
  const parallel = rec.steps.filter((s) => s.group === step.group).length > 1 || step.kinds.length > 1;
  const go = (to: ScreenId, extra: Record<string, string>) => { props.close(); ctx.go(to, { ...props.params, ...extra }); };
  const canReview = rec.recorded && ctx.session.can('review') && !!step.status?.eligible.includes(ctx.session.actorId) && canGo(ctx, 'passage_record', 'review_capture');
  const canAsk = rec.recorded && step.role !== 'translator' && canGo(ctx, 'passage_record', 'ask_someone');
  // Set aside is for suggested steps, never a checkpoint (J-REC-5); moving
  // past a checkpoint needs manage_flows (J-REC-7).
  const canSetAside = rec.recorded && !step.checkpoint && step.state !== 'complete' && ctx.session.can('translate');
  const canOverride = rec.recorded && step.checkpoint && step.state !== 'complete' && !step.override && ctx.session.can('manage_flows');
  const canLog = rec.recorded && !step.legacy && ctx.session.can('send_to_reviewers') && canGo(ctx, 'passage_record', 'add_record');
  const kindDone = (k: RecordKind) => k.state === 'approved' || k.state === 'addressed' || k.state === 'skipped' || k.state === 'recorded';
  return (
    <View style={{ gap: space.md }}>
      <View style={styles.sheetHead}>
        <Icon size={28} color={colors.review} />
        <Text style={[text.h4, { flex: 1 }]}>{step.label}</Text>
        {parallel ? <View accessibilityLabel="Either order"><ArrowUpDown size={18} color={colors.mutedForeground} /></View> : null}
        <Pressable onPress={props.close} accessibilityLabel="Close" hitSlop={8}><X size={20} color={colors.foreground} /></Pressable>
      </View>
      <View style={styles.sheetPeople}>
        {reviews.map((r) => (
          <Pressable key={r.eventId} onPress={() => go('review_detail', { takeId: r.takeId, round: `${r.stepId}:${r.reviewerId}` })}
            accessibilityLabel={`${r.logged ? checkCredit(r.logged) ?? 'Logged' : props.nameOf(r.reviewerId)}: ${r.decision === 'approve' ? 'looks good' : 'needs changes'}`} style={styles.personMark}>
            {r.logged ? <Users size={28} color={colors.mutedForeground} /> : <PersonAvatar look={person(r.reviewerId)} size={28} />}
            {r.decision === 'approve' ? <CheckCircle2 size={16} color={colors.done} /> : <MessageSquare size={16} color={colors.review} />}
          </Pressable>
        ))}
        {(step.status?.waitingOn ?? []).map((id) => (
          <View key={id} style={styles.personMark} accessibilityLabel={`Waiting on ${props.nameOf(id)}`}>
            <PersonAvatar look={person(id)} size={28} />
            <Clock size={16} color={colors.mutedForeground} />
          </View>
        ))}
        {!rec.recorded ? <View accessibilityLabel="Not recorded yet"><Lock size={20} color={colors.mutedForeground} /></View> : null}
        {rec.recorded && step.lockedBy ? <View accessible style={styles.personMark}
          accessibilityLabel={`Waits for the ${rec.steps.find((x) => x.stepId === step.lockedBy)?.label ?? step.lockedBy} checkpoint`}>
          <Lock size={20} color={colors.mutedForeground} /><Octagon size={16} color={colors.review} />
        </View> : null}
      </View>
      {step.checkpoint ? <View accessible style={styles.personMark} accessibilityLabel="Checkpoint: later steps wait for this one">
        <Octagon size={18} color={colors.review} />
      </View> : null}
      {step.override ? <View accessible style={styles.personMark}
        accessibilityLabel={`Moved past by ${props.nameOf(step.override.by)}${step.override.reason ? `: ${step.override.reason}` : ''}`}>
        <Octagon size={18} color={colors.done} /><CheckCircle2 size={14} color={colors.done} /><PersonAvatar look={person(step.override.by)} size={20} />
        {step.override.reason ? <Text style={[text.small, { flex: 1 }]} numberOfLines={2}>{step.override.reason}</Text> : null}
      </View> : null}
      {!step.legacy && step.kinds.length > 0 ? <View style={{ gap: space.xs }} accessibilityLabel={step.kinds.length > 1 ? 'Together, either order' : undefined}>
        {step.kinds.map((k) => {
          const KIcon = stepIcon({ stepId: k.kindId, role: step.role });
          const done = kindDone(k);
          const said = k.state === 'skipped' ? `set aside${k.setAside?.reason ? `: ${k.setAside.reason}` : ''}`
            : k.state === 'suggestions' ? 'needs changes' : done ? 'looks good' : k.state === 'asked' ? 'asked' : k.state === 'locked' ? 'waits for the checkpoint' : 'not yet';
          return (
            <View key={k.kindId} style={styles.personMark}>
              <Pressable style={[styles.personMark, { flex: 1 }]} accessibilityRole={canReview ? 'button' : undefined} disabled={!canReview || done}
                accessibilityLabel={`${k.name}: ${said}${k.produces ? ', makes a recording' : ''}${k.outOfOrder ? ', done before the checkpoint cleared' : ''}`}
                onPress={() => go(k.produces ? 'back_translation' : 'review_capture', { takeId: rec.latest!.takeId, stepId: step.stepId, kindId: k.kindId })}>
                <KIcon size={20} color={done ? colors.done : colors.review} />
                <Text style={[text.body, { flex: 1 }]}>{k.name}</Text>
                {k.produces ? <Mic size={14} color={colors.mutedForeground} /> : null}
                {k.state === 'skipped' ? <SkipForward size={16} color={colors.done} />
                  : done ? <CheckCircle2 size={16} color={colors.done} /> : k.state === 'suggestions' ? <MessageSquare size={16} color={colors.review} /> : k.state === 'locked' ? <Lock size={16} color={colors.mutedForeground} /> : null}
              </Pressable>
              {canAsk && !done && k.state !== 'locked' ? <ActionButton variant="outline" icon={UserPlus} style={styles.iconBtn} accessibilityLabel={`Ask someone for ${k.name}`}
                onPress={() => go('ask_someone', { stepId: step.stepId, kindId: k.kindId })} /> : null}
              {canSetAside && !done ? <ActionButton variant="outline" icon={SkipForward} style={styles.iconBtn} accessibilityLabel={`Set aside ${k.name}`}
                onPress={() => props.onDepart({ kind: 'set_aside', stepId: step.stepId, kindId: k.kindId, name: k.name })} /> : null}
            </View>
          );
        })}
      </View> : null}
      <View style={styles.sheetActions}>
        {canReview ? <ActionButton variant="outline" icon={ListChecks} accessibilityLabel="Review it now" style={styles.iconBtn}
          onPress={() => go('review_capture', { takeId: rec.latest!.takeId, stepId: step.stepId })} /> : null}
        {canAsk && (step.legacy || step.kinds.length === 0) ? <ActionButton variant="outline" icon={UserPlus} accessibilityLabel="Ask someone" style={styles.iconBtn}
          onPress={() => go('ask_someone', { stepId: step.stepId })} /> : null}
        {canSetAside && (step.legacy || step.kinds.length === 0) ? <ActionButton variant="outline" icon={SkipForward} style={styles.iconBtn}
          accessibilityLabel="Set aside" onPress={() => props.onDepart({ kind: 'set_aside', stepId: step.stepId, name: step.label })} /> : null}
        {canLog ? <ActionButton variant="outline" icon={ClipboardCheck} style={styles.iconBtn} accessibilityLabel="Log what happened"
          onPress={() => go('add_record', step.kinds[0] ? { kindId: (step.kinds.find((k) => !kindDone(k)) ?? step.kinds[0]).kindId } : {})} /> : null}
        {canOverride ? <ActionButton variant="outline" icon={Octagon} style={styles.iconBtn} accessibilityLabel="Move past this checkpoint…"
          onPress={() => props.onDepart({ kind: 'override', stepId: step.stepId, name: step.label })} /> : null}
      </View>
    </View>
  );
}

function RecordedSheet(props: { ctx: Ctx; rec: Rec; params: Record<string, string>; close: () => void; nameOf: (id: string) => string }) {
  const { ctx, rec } = props;
  const person = usePerson();
  const go = (to: ScreenId, extra: Record<string, string>) => { props.close(); ctx.go(to, { ...props.params, ...extra }); };
  const recordAsks = rec.asks.filter((a) => a.kind === 'record' && !a.satisfied);
  return (
    <View style={{ gap: space.md }}>
      <View style={styles.sheetHead}>
        <Mic size={28} color={colors.translate} />
        <View style={{ flex: 1 }} />
        <Pressable onPress={props.close} accessibilityLabel="Close" hitSlop={8}><X size={20} color={colors.foreground} /></Pressable>
      </View>
      <View style={styles.sheetPeople}>
        {rec.versions.map((v) => (
          <Pressable key={v.takeId} onPress={() => go('version_detail', { takeId: v.takeId })} style={styles.personMark}
            accessibilityLabel={`Version ${v.n} by ${props.nameOf(v.authorId)}`}>
            <PersonAvatar look={person(v.authorId)} size={28} />
            <Text style={text.small}>v{v.n}</Text>
          </Pressable>
        ))}
        {recordAsks.map((a) => (
          <View key={a.profileId} style={styles.personMark} accessibilityLabel={`Waiting on ${props.nameOf(a.profileId)}`}>
            <PersonAvatar look={person(a.profileId)} size={28} />
            <Clock size={16} color={colors.mutedForeground} />
          </View>
        ))}
      </View>
      {!rec.recorded && canGo(ctx, 'passage_record', 'ask_someone') ? (
        <View style={styles.sheetActions}>
          <ActionButton variant="outline" icon={UserPlus} accessibilityLabel="Ask someone to record" style={styles.iconBtn} onPress={() => go('ask_someone', {})} />
        </View>
      ) : null}
    </View>
  );
}

function entryTitle(e: RecordEntry, rec: Rec): string {
  const label = (id: string) => rec.steps.find((s) => s.stepId === id)?.label ?? id;
  switch (e.kind) {
    case 'version': return `Version ${e.n} saved`;
    case 'review': return `${rec.steps.flatMap((s) => s.kinds).find((k) => k.kindId === e.kindId && e.kindId !== e.stepId)?.name ?? label(e.stepId)} · ${e.decision === 'approve' ? 'looks good' : 'needs changes'}`;
    case 'response': return `Version ${e.n} answers the feedback`;
    case 'ask': {
      const what = e.role === 'translator' ? 'Asked someone to record'
        : e.kindId ? `Asked for ${rec.steps.flatMap((s) => s.kinds).find((k) => k.kindId === e.kindId)?.name ?? label(e.kindId)}`
        : `Asked for ${rec.steps.filter((s) => s.role === e.role).map((s) => s.label).join(' and ') || e.role}`;
      return `${what}${e.state === 'withdrawn' ? ' · withdrawn' : e.state === 'done' ? ' · done' : ''}`;
    }
    case 'note': {
      const moment = e.note.anchors.map((a) => ('atMs' in a && a.atMs !== undefined ? clockOf(a.atMs) : undefined)).find((x) => x !== undefined);
      const verse = e.note.anchors.find((a) => a.type === 'verse');
      const where = verse?.type === 'verse' ? ` on ${verse.verse}` : e.note.aboutTakeId ? ` on Version ${rec.versions.find((v) => v.takeId === e.note.aboutTakeId)?.n ?? '?'}` : '';
      return `Note${where}${moment ? ` at ${moment}` : ''}${e.note.text ? `: ${e.note.text}` : ''}`;
    }
    case 'content': {
      const name = rec.steps.flatMap((s) => s.kinds).find((k) => k.kindId === e.content.kindId)?.name ?? e.content.kindId;
      return `${name} recorded · ${e.content.language}${e.content.stale ? ' · made from an older version' : ''}`;
    }
    case 'kept': return `Kept Version ${e.n} as is${e.kept.reason ? `: ${e.kept.reason}` : ''}`;
    case 'departure': {
      const d = e.departure;
      const name = d.kindId ? rec.steps.flatMap((s) => s.kinds).find((k) => k.kindId === d.kindId)?.name ?? d.kindId : label(d.stepId);
      const what = d.kind === 'override' ? `Moved past the ${name} checkpoint` : `${name} set aside`;
      return `${what}${d.reason ? `: ${d.reason}` : ''}${d.undone ? ` · brought back ${shortDate(d.undone.at)}` : ''}`;
    }
  }
}

function EntryIcon(props: { entry: RecordEntry }) {
  const e = props.entry;
  if (e.kind === 'version') return <Mic size={16} color={colors.translate} />;
  if (e.kind === 'response') return <Reply size={16} color={colors.translate} />;
  if (e.kind === 'ask') return <UserPlus size={16} color={colors.mutedForeground} />;
  if (e.kind === 'kept') return <BookmarkCheck size={16} color={colors.translate} />;
  if (e.kind === 'note') return <StickyNote size={16} color={colors.foreground} />;
  if (e.kind === 'content') return <Languages size={16} color={e.content.stale ? colors.mutedForeground : colors.done} />;
  if (e.kind === 'departure') return e.departure.kind === 'override' ? <Octagon size={16} color={colors.review} /> : <SkipForward size={16} color={colors.review} />;
  return e.decision === 'approve' ? <CheckCircle2 size={16} color={colors.done} /> : <MessageSquare size={16} color={colors.review} />;
}

/** Details on request (ADR-013): Reviews by version and History, collapsed. */
function Details(props: {
  ctx: Ctx; rec: Rec; params: Record<string, string>; nameOf: (id: string) => string;
  mayUndo: (d: RecordDeparture) => boolean; onUndo: (d: RecordDeparture) => void;
  open: { reviews: boolean; history: boolean }; setOpen: (f: (o: { reviews: boolean; history: boolean }) => { reviews: boolean; history: boolean }) => void;
}) {
  const { ctx, rec } = props;
  const person = usePerson();
  const reviewCount = rec.versions.reduce((n, v) => n + v.reviews.length, 0);
  return (
    <View style={{ gap: space.sm }}>
      <Disclosure icon={Grid3x3} count={reviewCount} open={props.open.reviews}
        label={reviewCount ? `${reviewCount} review${reviewCount === 1 ? '' : 's'} across ${rec.versions.length} version${rec.versions.length === 1 ? '' : 's'}` : `No reviews yet · ${rec.versions.length} versions`}
        onToggle={() => props.setOpen((o) => ({ ...o, reviews: !o.reviews }))}>
        {[...rec.versions].reverse().map((v) => (
          <View key={v.takeId} style={styles.gridRow}>
            <Pressable onPress={() => ctx.go('version_detail', { ...props.params, takeId: v.takeId })} style={styles.gridVersion}
              accessibilityRole="button" accessibilityLabel={`Version ${v.n}, ${shortDate(v.at)}`}>
              <Text style={text.body}>v{v.n}</Text>
              <Text style={text.small}>{shortDate(v.at)}</Text>
            </Pressable>
            {rec.steps.map((s) => {
              const rs = v.reviews.filter((r) => r.stepId === s.stepId);
              const last = rs[rs.length - 1];
              const Icon = stepIcon(s);
              return (
                <Pressable key={s.stepId} disabled={!last} style={styles.gridCell}
                  onPress={() => last && ctx.go('review_detail', { ...props.params, takeId: v.takeId, round: `${last.stepId}:${last.reviewerId}` })}
                  accessibilityRole={last ? 'button' : undefined}
                  accessibilityLabel={`${s.label}: ${last ? (last.decision === 'approve' ? 'looks good' : 'needs changes') : 'not yet'}${rs.length > 1 ? `, ${rs.length} reviews` : ''}`}>
                  {last ? (last.decision === 'approve' ? <CheckCircle2 size={18} color={colors.done} /> : <MessageSquare size={18} color={colors.review} />)
                    : <Icon size={16} color={colors.border} />}
                  {rs.length > 1 ? <Text style={text.small}>{rs.length}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </Disclosure>
      <Disclosure icon={History} count={rec.history.length} open={props.open.history}
        label={rec.history.length ? `${rec.history.length} entries since ${shortDate(rec.history[rec.history.length - 1]!.at)}` : 'No entries yet'}
        onToggle={() => props.setOpen((o) => ({ ...o, history: !o.history }))}>
        {rec.recorded && ctx.session.can('send_to_reviewers') && canGo(ctx, 'passage_record', 'add_record')
          ? <ActionButton variant="outline" icon={ClipboardCheck} style={styles.iconBtn} accessibilityLabel="Log what happened"
            onPress={() => ctx.go('add_record', props.params)} /> : null}
        {rec.history.map((e) => {
          if (e.kind === 'note') {
            return (
              <View key={e.id} style={styles.historyRow}>
                <View accessible accessibilityLabel={`${entryTitle(e, rec)} · ${props.nameOf(e.by)} · ${shortDate(e.at)}`}><EntryIcon entry={e} /></View>
                <PersonAvatar look={person(e.by)} size={20} />
                {e.note.blobHash ? <View style={{ flex: 1 }}><AudioClip project={ctx.project} hashes={[e.note.blobHash]} label="Hear the note" hideActions /></View>
                  : <Text style={[text.small, { flex: 1 }]} numberOfLines={2}>{e.note.text}</Text>}
                <Text style={text.small}>{shortDate(e.at)}</Text>
              </View>
            );
          }
          if (e.kind === 'content') {
            return (
              <View key={e.id} style={styles.historyRow} accessible={false}>
                <View accessible accessibilityLabel={`${entryTitle(e, rec)} · ${props.nameOf(e.by)} · ${shortDate(e.at)}`}><EntryIcon entry={e} /></View>
                <PersonAvatar look={person(e.by)} size={20} />
                <View style={{ flex: 1 }}><AudioClip project={ctx.project} hashes={e.content.cards.map((c) => c.hash)} label={`Hear the ${entryTitle(e, rec)}`} hideActions /></View>
                <Text style={text.small}>{shortDate(e.at)}</Text>
              </View>
            );
          }
          if (e.kind === 'departure') {
            const d = e.departure;
            return (
              <View key={e.id} style={styles.historyRow} accessible={!!d.undone || !props.mayUndo(d)}
                accessibilityLabel={`${entryTitle(e, rec)} · ${props.nameOf(e.by)} · ${shortDate(e.at)}`}>
                <EntryIcon entry={e} />
                <PersonAvatar look={person(e.by)} size={20} />
                {d.reasonBlobHash ? <View style={{ flex: 1 }}><AudioClip project={ctx.project} hashes={[d.reasonBlobHash]} label="Hear the reason" hideActions /></View>
                  : <View style={{ flex: 1 }} />}
                {d.undone ? <View accessibilityLabel={`Brought back ${shortDate(d.undone.at)}`}><RotateCcw size={16} color={colors.mutedForeground} /></View>
                  : props.mayUndo(d) ? <ActionButton variant="outline" icon={Undo2} style={styles.iconBtn}
                    accessibilityLabel={`Undo: ${entryTitle(e, rec)}`} onPress={() => props.onUndo(d)} /> : null}
                <Text style={text.small}>{shortDate(e.at)}</Text>
              </View>
            );
          }
          const onPress = e.kind === 'review' ? () => ctx.go('review_detail', { ...props.params, takeId: e.takeId, round: `${e.stepId}:${e.by}` })
            : e.kind === 'version' || e.kind === 'response' ? () => ctx.go('version_detail', { ...props.params, takeId: e.takeId })
            : undefined;
          // A logged check is credited to who gave it; the typist is "Logged by".
          const logged = e.kind === 'review' ? e.logged : undefined;
          const who = logged ? `${checkCredit(logged) ?? 'Outside the app'} · logged by ${e.by === ctx.session.actorId ? 'you' : props.nameOf(e.by)}` : props.nameOf(e.by);
          return (
            <Pressable key={e.id} onPress={onPress} disabled={!onPress} style={styles.historyRow}
              accessibilityRole={onPress ? 'button' : undefined}
              accessibilityLabel={`${entryTitle(e, rec)} · ${who} · ${shortDate(e.at)}`}>
              <EntryIcon entry={e} />
              {logged ? <Users size={20} color={colors.mutedForeground} /> : <PersonAvatar look={person(e.by)} size={20} />}
              {e.kind === 'ask' ? <><ChevronRight size={14} color={colors.mutedForeground} /><PersonAvatar look={person(e.profileId)} size={20} /></> : null}
              {'n' in e ? <Text style={text.small}>v{e.n}</Text> : null}
              <View style={{ flex: 1 }} />
              <Text style={text.small}>{shortDate(e.at)}</Text>
            </Pressable>
          );
        })}
      </Disclosure>
    </View>
  );
}

function Disclosure(props: { icon: LucideIcon; label: string; count: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  const Icon = props.icon;
  return (
    <View style={styles.disclosure}>
      <Pressable onPress={props.onToggle} style={styles.disclosureHead} accessibilityRole="button"
        accessibilityLabel={props.label} accessibilityState={{ expanded: props.open }}>
        <View style={styles.disclosureIcon}><Icon size={18} color={colors.foreground} /></View>
        <Text style={[text.small, { flex: 1 }]}>{props.count}</Text>
        {props.open ? <ChevronDown size={18} color={colors.mutedForeground} /> : <ChevronRight size={18} color={colors.mutedForeground} />}
      </Pressable>
      {props.open ? <View style={{ gap: space.xs }}>{props.children}</View> : null}
    </View>
  );
}

// ─── ask_someone (Avatar P) ─────────────────────────────────────────────────
// J-REC-10 on v1.RequestMade. Fixed to the step and kind whose button opened
// it (ADR-020): a check request names one kind; without a step it asks
// someone to record. Asking for a check needs send_to_reviewers (a
// translator may ask for their own review); asking to record needs
// assign_work. The toast's Undo is a compensating v1.RequestWithdrawn.
// People outside the app (share links) are Phase 3.

function isoIn(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function AskSomeone(ctx: Ctx) {
  const person = usePerson();
  const [who, setWho] = useState('');
  const [due, setDue] = useState<string | null>(null);
  const [directions, setDirections] = useState('');
  const [sending, setSending] = useState(false);
  const loaded = useRecord(ctx);
  const { state, append } = ctx.project;
  if (!state || !loaded) return <Note>Passage not found.</Note>;
  const { rec, unitId, laneId } = loaded;
  const stepId = ctx.params['stepId'];
  const step = stepId ? rec.steps.find((s) => s.stepId === stepId) : undefined;
  if (stepId && !step) return <Note>Step not found.</Note>;
  // The kind this ask is fixed to: the one whose button opened it, else the
  // step's first kind still open. A v1 step is one kind: its own id.
  const kind = step
    ? step.kinds.find((k) => k.kindId === ctx.params['kindId'])
      ?? step.kinds.find((k) => k.state !== 'approved' && k.state !== 'recorded' && k.state !== 'skipped' && k.state !== 'addressed')
      ?? step.kinds[0]
    : undefined;
  const what = step ? 'check' as const : 'record' as const;
  const kindName = kind?.name ?? step?.label ?? '';
  const role = step ? step.role : 'translator';
  const mayAsk = ctx.session.can(what === 'check' ? 'send_to_reviewers' : 'assign_work');
  const members = Object.entries(state.members).filter(([, m]) => !m.removed.value && m.role.value !== 'viewer').map(([id, m]) => ({ id, role: m.role.value }));
  const usual = step?.status?.eligible ?? members.filter((m) => m.role === role).map((m) => m.id);
  const others = members.map((m) => m.id).filter((id) => !usual.includes(id));
  const language = state.lanes[laneId]?.languoidId ?? laneId;
  const first = who ? person(who).name.split(' ')[0] : '';

  async function send() {
    if (!who || sending || !mayAsk) return;
    setSending(true);
    try {
      const requestId = Crypto.randomUUID();
      await append('v1.RequestMade', {
        requestId, unitId, laneId, what, assigneeId: who,
        ...(what === 'check' && kind ? { kindId: kind.kindId } : {}),
        ...(due ? { dueDate: due } : {}),
        ...(directions.trim() ? { note: directions.trim() } : {})
      });
      ctx.project.triggerUpload();
      ctx.toast(`${person(who).name} will see it on their My Work`, () => void (async () => {
        await append('v1.RequestWithdrawn', { requestId });
        ctx.project.triggerUpload();
        ctx.toast('Undone — nothing was sent');
      })());
      ctx.go('passage_record', { unitId, laneId });
    } finally {
      setSending(false);
    }
  }

  const pick = (id: string, i: number, list: string[]) => (
    <Row key={id} personId={id} sub={state.members[id]?.role.value} onPress={() => setWho(id)} last={i === list.length - 1}
      right={who === id ? <CheckCircle2 size={18} color={colors.translate} /> : <View />} />
  );
  return (
    <Screen footer={<Footer label={who ? `Ask ${first}` : 'Choose someone'} onPress={() => void send()} disabled={!who || !mayAsk || sending} />}>
      <Header title={step ? `Ask for ${kindName}` : 'Ask someone to record'} sub={`${state.units[unitId]!.label} · ${language}`} onBack={ctx.back} />
      {!mayAsk ? <Note>{what === 'check' ? 'Only people who can ask for reviews can send this ask.' : 'Only people who can assign work can ask someone to record.'}</Note> : null}
      <Section label={step ? `Usually does ${kindName}` : 'Translators'}>
        {usual.length === 0 ? <Row label="Nobody on the team does this yet" last /> : usual.map(pick)}
      </Section>
      {others.length > 0 ? <Section label="Others who can">{others.map(pick)}</Section> : null}
      <Section label="Directions · optional">
        <TextInput value={directions} onChangeText={setDirections} placeholder="What to listen for" multiline
          placeholderTextColor={colors.mutedForeground} style={styles.input} accessibilityLabel="Directions" />
      </Section>
      <Section label="By when · optional">
        {([['No date', null], ['In 3 days', isoIn(3)], ['In a week', isoIn(7)], ['In two weeks', isoIn(14)]] as const).map(([label, value], i, all) => (
          <Row key={label} label={label} sub={value ? `Due ${value}` : undefined} onPress={() => setDue(value)} last={i === all.length - 1}
            right={due === value ? <CheckCircle2 size={18} color={colors.translate} /> : <View />} />
        ))}
      </Section>
    </Screen>
  );
}

// ─── version_detail / review_detail (Avatar P) ──────────────────────────────
// Moved from status.tsx (were PieceVersion / PieceReview) and extended for
// J-REC-14 and J-REC-15. Unit and lane come from the take, so any entry
// (record, key term) can open them with just `takeId`.

export function VersionDetail(ctx: Ctx) {
  const { state } = ctx.project;
  const takeId = ctx.params['takeId'] ?? '';
  const take = state?.takes[takeId];
  if (!state || !take) return <Note>Version not found.</Note>;
  const rec = derivePassageRecord(state, take.unitId, take.laneId, ctx.session.actorId, indexesFor(state));
  const version = rec.versions.find((v) => v.takeId === takeId);
  const st = deriveTakeStatus(state, takeId, indexesFor(state));
  const terms = keyTermLinksFor(state, takeId);
  const prior = version?.respondsToTakeId ? rec.versions.find((v) => v.takeId === version.respondsToTakeId) : undefined;
  const answered = prior ? prior.reviews.filter((r) => r.decision === 'suggest_changes') : [];
  const label = (id: string) => rec.steps.find((s) => s.stepId === id)?.label ?? id;
  const params = { unitId: take.unitId, laneId: take.laneId };
  return (
    <Screen>
      <Header title={version ? `Version ${version.n}` : 'Draft'} sub={<Byline before={`${state.units[take.unitId]?.label} · by`} id={take.actorId} after={version ? `· ${shortDate(version.at)}` : undefined} />} onBack={ctx.back} />
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <StatusIcon outcome={st.outcome} />
          <Text style={text.body}>{take.cardHashes.length} cards</Text>
        </View>
        <AudioClip project={ctx.project} hashes={take.cardHashes} label="Play this version" />
      </Card>
      {prior ? (
        <Section label="What changed">
          {answered.length > 0 ? answered.map((r, i) => (
            <Row key={`${r.stepId}:${r.reviewerId}`} icon={MessageSquare} label={`In response to the ${label(r.stepId)}`} sub={<Byline before="from" id={r.reviewerId} />}
              onPress={() => ctx.go('review_detail', { ...params, takeId: prior.takeId, round: `${r.stepId}:${r.reviewerId}` })} last={i === answered.length - 1 && !version?.responseNote} />
          )) : <Row label={`Re-recorded from Version ${prior.n}`} onPress={() => ctx.go('version_detail', { ...params, takeId: prior.takeId })} last={!version?.responseNote} />}
          {version?.responseNote ? <Row icon={Reply} label={version.responseNote} last /> : null}
        </Section>
      ) : null}
      {terms.length ? (
        <Section label="Key terms">
          {terms.map((t, i) => (
            <Row key={t.term.termId} label={t.term.term} sub={t.note} onPress={() => ctx.go('key_term_detail', { termId: t.term.termId, takeId, unitId: take.unitId })} last={i === terms.length - 1} />
          ))}
        </Section>
      ) : null}
      <Section label="Reviews of this version">
        {(version?.reviews ?? []).length === 0 ? <Row label="No reviews of this version yet." last /> : null}
        {(version?.reviews ?? []).map((r, i, all) => (
          <Row key={`${r.stepId}:${r.reviewerId}`} label={label(r.stepId)} sub={<Byline id={r.reviewerId} />}
            badge={r.decision === 'approve' ? 'Looks good' : 'Needs changes'}
            onPress={() => ctx.go('review_detail', { ...params, takeId, round: `${r.stepId}:${r.reviewerId}` })} last={i === all.length - 1} />
        ))}
      </Section>
    </Screen>
  );
}

export function ReviewDetail(ctx: Ctx) {
  const [keeping, setKeeping] = useState(false);
  const { state } = ctx.project;
  const takeId = ctx.params['takeId'] ?? '';
  const [stepId = '', actor = ''] = (ctx.params['round'] ?? '').split(':');
  const take = state?.takes[takeId];
  const rec = state && take ? derivePassageRecord(state, take.unitId, take.laneId, ctx.session.actorId, indexesFor(state)) : null;
  const version = rec?.versions.find((v) => v.takeId === takeId);
  // The newest review by this person at this step: a CheckRecorded or a legacy ReviewSubmitted.
  const review = version?.reviews.filter((r) => r.stepId === stepId && r.reviewerId === actor).pop();
  if (!state || !take || !rec || !review) return <Note>Review not found.</Note>;
  const approved = review.decision === 'approve';
  const voice = review.voiceHash;
  const questions = new Map(questionsOf(questionSetsFor(state, takeId, stepId)).map((q) => [q.id, q.text]));
  const answeredBy = rec.versions.find((v) => v.respondsToTakeId === takeId);
  const fb = rec.feedback.find((f) => f.eventId === review.eventId);
  const open = rec.openFeedback.some((f) => f.eventId === review.eventId);
  const params = { unitId: take.unitId, laneId: take.laneId };
  const label = rec.steps.flatMap((s) => s.kinds).find((k) => k.kindId === review.kindId && review.kindId !== review.stepId)?.name
    ?? rec.steps.find((s) => s.stepId === stepId)?.label ?? stepId;
  const canFix = open && rec.feedbackIsMine && ctx.session.can('translate') && canGo(ctx, 'review_detail', 'workspace');
  const canKeep = open && rec.feedbackIsMine && ctx.session.can('translate');
  return (
    <Screen footer={canFix ? <Footer label="Record a fix" onPress={() => ctx.go('workspace', { ...params, respondsTo: takeId })} /> : undefined}>
      <Header title={label} sub={review.logged
        ? `${checkCredit(review.logged) ?? 'Outside the app'} · ${shortDate(review.at)}`
        : <Byline before="by" id={actor} after={`· ${shortDate(review.at)}`} />} onBack={ctx.back} />
      {review.logged ? <Byline before="Logged by" id={actor} /> : null}
      {review.logged?.evidence?.length ? <AudioClip project={ctx.project} hashes={review.logged.evidence.map((e) => e.hash)} label="Hear the evidence" hideActions /> : null}
      <Card style={{ backgroundColor: approved ? tint.done : tint.review }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          {approved ? <CheckCircle2 size={20} color={colors.done} /> : <MessageSquare size={20} color={colors.review} />}
          <Text style={text.h4}>{approved ? 'Looks good' : 'Needs changes'}</Text>
        </View>
        {voice ? <AudioClip project={ctx.project} hashes={[voice]} label="Voice feedback" hideActions /> : null}
        {review.comment ? <Text style={text.body}>{review.comment}</Text> : null}
      </Card>
      {review.answers && Object.keys(review.answers).length > 0 ? (
        <Section label="Answers to the questions">
          {Object.entries(review.answers).map(([q, a], i, arr) => (
            <Row key={q} label={questions.get(q) ?? q} sub={a} last={i === arr.length - 1} />
          ))}
        </Section>
      ) : null}
      <Section label="Version">
        <Row label={version ? `Reviewed Version ${version.n}` : 'Reviewed version'} onPress={() => ctx.go('version_detail', { ...params, takeId })} last={!answeredBy && !fb?.kept} />
        {answeredBy ? <Row icon={Reply} label={`Revised in Version ${answeredBy.n}`} sub={<Byline before="by" id={answeredBy.authorId} after={`· ${shortDate(answeredBy.at)}`} />}
          onPress={() => ctx.go('version_detail', { ...params, takeId: answeredBy.takeId })} last={!fb?.kept} /> : null}
        {fb?.kept ? <Row icon={BookmarkCheck} label={`Kept as is${fb.kept.reason ? `: ${fb.kept.reason}` : ''}`}
          sub={<Byline before="by" id={fb.kept.by} after={`· ${shortDate(fb.kept.at)}`} />} last /> : null}
      </Section>
      {fb?.kept?.reasonBlobHash ? <AudioClip project={ctx.project} hashes={[fb.kept.reasonBlobHash]} label="Hear why it was kept" hideActions /> : null}
      {canKeep ? <ActionButton variant="outline" icon={BookmarkCheck} label="Keep it, say why" accessibilityLabel="Keep it, say why" onPress={() => setKeeping(true)} /> : null}
      {open && !rec.feedbackIsMine && rec.latest ? <Byline before="Waiting on" id={rec.latest.authorId} after={`to answer the ${label}`} /> : null}
      <ReasonSheet ctx={ctx} visible={keeping} onClose={() => setKeeping(false)} icon={BookmarkCheck} name={label}
        {...KEEP_SHEET} onConfirm={async (why) => { await keepFeedback(ctx, review, why); setKeeping(false); }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  lang: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.full, backgroundColor: colors.muted },
  heroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  heroGlyph: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 52 },
  dashedRing: { width: 48, height: 48, borderRadius: radius.full, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  latest: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 32 },
  path: { alignItems: 'center', gap: 0, paddingVertical: space.xs },
  pathGroup: { flexDirection: 'row', alignItems: 'center' },
  connector: { width: 12, height: 2, backgroundColor: colors.border },
  tile: { width: 56, height: 56, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  tileHalf: { width: 48, height: 40 },
  tileCurrent: { borderWidth: 2, borderColor: colors.foreground },
  tileLocked: { borderStyle: 'dashed' },
  corner: { position: 'absolute', top: 2, right: 2 },
  askedDot: { position: 'absolute', bottom: 2, right: 2 },
  strike: { position: 'absolute', left: 8, right: 8, top: '50%', height: 1.5, backgroundColor: colors.mutedForeground, transform: [{ rotate: '-20deg' }] },
  feedback: { gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: tint.review, borderWidth: 1, borderColor: colors.review },
  feedbackHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  nextThen: { borderStyle: 'dashed', backgroundColor: colors.muted },
  counter: { flexDirection: 'row', alignItems: 'center', gap: space.lg, justifyContent: 'center' },
  iconBtn: { minWidth: 48, minHeight: 48, paddingHorizontal: space.sm, paddingVertical: space.sm },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: { padding: space.lg, paddingBottom: space.xl, gap: space.md, backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  sheetPeople: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  sheetActions: { flexDirection: 'row', gap: space.md },
  personMark: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
  disclosure: { gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  disclosureHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
  disclosureIcon: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  gridRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
  gridVersion: { width: 64, gap: 2 },
  gridCell: { flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 44, minHeight: 44, justifyContent: 'center' },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
  input: { minHeight: 72, padding: space.md, color: colors.foreground, textAlignVertical: 'top' }
});

// ─── add_record: Log what happened (Avatar P, J-REC-11) ─────────────────────

/** Kinds heard by a group: the log counts listeners instead of naming one person. */
const GROUP_KINDS = new Set(['kind@1/community', 'kind@1/retell']);

/**
 * A check that happened outside the app, logged afterwards: one
 * `v1.CheckLogged` per passage covered. Credited to who gave it (or "N
 * listeners at place"), never the typist. No Undo: the only retraction is
 * `v1.Redacted`, which needs manage_structure, so a translator could not
 * undo their own log.
 */
export function AddRecord(ctx: Ctx) {
  const loaded = useRecord(ctx);
  const { state } = ctx.project;
  const [kindId, setKindId] = useState<string | null>(ctx.params['kindId'] ?? null);
  const [takeId, setTakeId] = useState<string | null>(null);
  const [also, setAlso] = useState<string[]>([]);
  const [people, setPeople] = useState(10);
  const [givenBy, setGivenBy] = useState('');
  const [place, setPlace] = useState('');
  const [comment, setComment] = useState('');
  const [summary, setSummary] = useState<string | undefined>();
  const [evidence, setEvidence] = useState<{ hash: string; durationMs: number; format: 'wav' | 'm4a' }[]>([]);
  const [outcome, setOutcome] = useState<'looks_good' | 'needs_changes' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (!state || !loaded) return <Note>Passage not found.</Note>;
  const { rec, unitId, laneId } = loaded;
  const idx = indexesFor(state);
  const actorId = ctx.session.actorId;
  const mayLog = ctx.session.can('send_to_reviewers');
  const mayMake = ctx.session.can('review');
  const flowKinds = rec.steps.flatMap((s) => s.kinds.map((k) => ({ id: k.kindId, name: k.name, stepId: s.stepId })));
  const others = reviewKinds(state).filter((k) => !flowKinds.some((f) => f.id === k.id)).map((k) => ({ id: k.id, name: k.name, stepId: undefined }));
  // A producing kind is logged as its content (the reference's "the {what}"),
  // which needs review; a judged kind needs send_to_reviewers.
  const kinds = [...flowKinds, ...others].filter((k) => (reviewKind(state, k.id).produces ? mayMake : mayLog));
  const kind = kinds.find((k) => k.id === kindId) ?? null;
  const produces = kind ? reviewKind(state, kind.id).produces : undefined;
  const group = kind ? GROUP_KINDS.has(kind.id) : false;
  const played = takeId ?? rec.latest?.takeId ?? null;

  // Also covered: the nearest recorded passages under the same parent.
  const parent = state.units[unitId]?.parentUnitId ?? null;
  const siblings = Object.entries(state.units)
    .filter(([id, u]) => id !== unitId && (u.parentUnitId ?? null) === parent)
    .sort(([, a], [, b]) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  const mine = Object.keys(state.units).filter((id) => (state.units[id]!.parentUnitId ?? null) === parent)
    .sort((a, b) => (state.units[a]!.order < state.units[b]!.order ? -1 : 1));
  const at = mine.indexOf(unitId);
  const nearby = siblings
    .map(([id]) => ({ id, rec: derivePassageRecord(state, id, laneId, actorId, idx) }))
    .filter((p) => p.rec.latest !== null)
    .sort((a, b) => Math.abs(mine.indexOf(a.id) - at) - Math.abs(mine.indexOf(b.id) - at))
    .slice(0, 4);
  const count = produces ? 1 : 1 + also.length;
  const needsWhat = outcome === 'needs_changes' && !comment.trim() && !summary;
  const ready = !!kind && !!played && (produces ? evidence.length > 0 : outcome !== null && !needsWhat);
  const hint = !kind ? 'Choose the kind of review.' : produces ? (evidence.length ? '' : `Record or attach the ${produces.what}.`)
    : outcome === null ? 'Choose how it went.'
    : needsWhat ? 'Say what needs to change — record a summary or type it.' : '';

  async function save() {
    if (!ready || saving || !kind || !played || !state) return;
    setSaving(true); setError('');
    try {
      if (produces) {
        const requestId = rec.asks.find((a) => a.kind === 'review' && !a.satisfied && a.profileId === actorId && a.kindId === kind.id)?.requestId;
        await ctx.project.append('v1.ContentProduced', {
          contentId: Crypto.randomUUID(), unitId, laneId, fromTakeId: played, kindId: kind.id, language: produces.language, cards: evidence,
          ...(comment.trim() ? { note: comment.trim() } : {}),
          ...(summary ? { noteBlobHash: summary } : {}),
          ...(requestId ? { requestId } : {})
        });
        ctx.project.triggerUpload();
        ctx.toast(`${kind.name} added to the record`);
        ctx.go('passage_record', { unitId, laneId });
        return;
      }
      const openAsk = (r: Rec) => r.asks.find((a) => a.kind === 'review' && !a.satisfied && a.profileId === actorId && a.kindId === kind.id)?.requestId;
      const targets = [
        { takeId: played, stepId: kind.stepId, requestId: openAsk(rec) },
        ...also.map((id) => {
          const r = nearby.find((p) => p.id === id)!.rec;
          return { takeId: r.latest!.takeId, stepId: r.steps.find((st) => st.kinds.some((k) => k.kindId === kind.id))?.stepId, requestId: openAsk(r) };
        })
      ];
      await ctx.project.run(commands(state, idx).logCheck({
        commandId: Crypto.randomUUID(), kindId: kind.id, outcome: outcome!,
        passages: targets.map((t) => ({ checkId: Crypto.randomUUID(), takeId: t.takeId,
          ...(t.stepId ? { stepId: t.stepId } : {}), ...(t.requestId ? { requestId: t.requestId } : {}) })),
        ...(comment.trim() ? { comment } : {}),
        ...(summary ? { commentBlobHash: summary } : {}),
        ...(group ? { people } : givenBy.trim() ? { givenBy } : {}),
        ...(place.trim() ? { place } : {}),
        ...(evidence.length ? { evidence } : {})
      }));
      ctx.project.triggerUpload();
      ctx.toast(count > 1 ? `${kind.name} added to ${count} passages` : `${kind.name} added to the record`);
      ctx.go('passage_record', { unitId, laneId });
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  const tick = (on: boolean) => (on ? <CheckCircle2 size={18} color={colors.translate} /> : <View />);
  return (
    <Screen footer={<Footer label={count > 1 ? `Save to ${count} passages` : 'Save to the record'} onPress={() => void save()} disabled={!ready || saving} />}>
      <Header title="Log what happened" sub={state.units[unitId]!.label} onBack={saving ? undefined : ctx.back} />
      {!mayLog && !mayMake ? <Note>Only people who can ask for reviews can log one.</Note> : null}
      <Section label="Kind of review">
        {kinds.map((k, i) => <Row key={k.id} label={k.name} onPress={() => setKindId(k.id)} last={i === kinds.length - 1} right={tick(kindId === k.id)} />)}
      </Section>
      {rec.versions.length > 1 ? <Section label="Which version was played">
        {[...rec.versions].reverse().map((v, i, all) => (
          <Row key={v.takeId} label={`Version ${v.n}`} sub={v.takeId === rec.latest?.takeId ? 'Latest' : undefined}
            onPress={() => setTakeId(v.takeId)} last={i === all.length - 1} right={tick(played === v.takeId)} />
        ))}
      </Section> : null}
      {nearby.length > 0 && !produces ? <Section label="Also covered in this session">
        <Text style={text.muted}>The same review is added to each passage you pick.</Text>
        {nearby.map((p, i) => (
          <Row key={p.id} label={state.units[p.id]!.label} sub={`Version ${p.rec.latest!.n}`} last={i === nearby.length - 1}
            onPress={() => setAlso((a) => (a.includes(p.id) ? a.filter((x) => x !== p.id) : [...a, p.id]))} right={tick(also.includes(p.id))} />
        ))}
      </Section> : null}
      {produces ? null : <>{group ? <Section label="How many listened?">
        <View style={styles.counter}>
          <ActionButton variant="outline" icon={Minus} style={styles.iconBtn} accessibilityLabel="Fewer listeners" disabled={people <= 1} onPress={() => setPeople((n) => Math.max(1, n - 1))} />
          <Text style={text.h4} accessibilityLabel={`${people} listened`}>{people}</Text>
          <ActionButton variant="outline" icon={Plus} style={styles.iconBtn} accessibilityLabel="More listeners" onPress={() => setPeople((n) => n + 1)} />
        </View>
      </Section> : <Section label="Who reviewed it">
        <TextInput value={givenBy} onChangeText={setGivenBy} placeholder="Who reviewed it — e.g. Peter Lual" placeholderTextColor={colors.mutedForeground}
          style={styles.input} accessibilityLabel="Who reviewed it" />
      </Section>}
      <Section label="Where">
        <TextInput value={place} onChangeText={setPlace} placeholder="Where — e.g. Bor church, after service" placeholderTextColor={colors.mutedForeground}
          style={styles.input} accessibilityLabel="Where" />
      </Section></>}
      <Section label={produces ? 'Note · optional' : 'What happened'}>
        <HoldToRecord accessibilityLabel="Record a summary" disabled={saving} onCard={(card) => setSummary(card.ref.hash)} />
        {summary ? <AudioClip project={ctx.project} hashes={[summary]} label="Hear the summary" hideActions /> : null}
        <TextInput value={comment} onChangeText={setComment} placeholder="Or type what people understood and asked about" multiline
          placeholderTextColor={colors.mutedForeground} style={styles.input} accessibilityLabel="Or type what people understood and asked about" />
      </Section>
      <Section label={produces ? `The ${produces.what}` : 'Evidence · optional'}>
        <Text style={text.muted}>{produces ? "It's what gets checked next, so it's the one thing this entry needs."
          : 'A retelling or a recorded conversation makes the review easy to trust.'}</Text>
        <HoldToRecord accessibilityLabel={produces ? `Record the ${produces.what}` : 'Record a retelling'} disabled={saving}
          onCard={(card) => setEvidence((e) => [...e, { hash: card.ref.hash, durationMs: card.durationMs, format: card.ref.format }])} />
        {evidence.length ? <AudioClip project={ctx.project} hashes={evidence.map((e) => e.hash)} label={produces ? `Hear the ${produces.what}` : 'Hear the evidence'} hideActions /> : null}
      </Section>
      {produces ? null : <Section label="How did it go?">
        <Row icon={CheckCircle2} label="Looks good" onPress={() => setOutcome('looks_good')} right={tick(outcome === 'looks_good')} />
        <Row icon={MessageSquare} label="Needs changes" onPress={() => setOutcome('needs_changes')} last right={tick(outcome === 'needs_changes')} />
      </Section>}
      {hint ? <Text style={text.muted}>{hint}</Text> : null}
      {error ? <Note>{error}</Note> : null}
    </Screen>
  );
}

import { contractsFor } from '../screenContracts';
export const contracts = contractsFor('passage_record', 'ask_someone', 'add_record', 'version_detail', 'review_detail');
