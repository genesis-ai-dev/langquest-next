// Avatar U for the passage record and the work screens; Avatar P for Ask someone,
// Log what happened, and the version and review details.
// Screens still marked Placeholder show their passage and say they are not
// wired yet (docs/ux/mobbin-overhaul/CHECKLIST.md); later phases build them out.
import {
  decodeHlc, deriveObt, derivePassageRecord, deriveTakeStatus, keyTermLinksFor, OBT_LABELS, questionsOf, questionSetsFor,
  recordHeadline, recordNextAction, type PassageRecord as Rec, type RecordEntry, type RecordStep
} from '@langquest-next/core';
import type { LucideIcon } from 'lucide-react-native';
import {
  ArrowUpDown, CheckCircle2, ChevronDown, ChevronRight, Clock, Globe, Grid3x3, Headphones, History, ListChecks, Lock,
  MessageSquare, Mic, Reply, ShieldCheck, UserPlus, Users, X
} from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { AudioClip } from '../audioClip';
import type { Ctx } from '../ctx';
import { edgeFor, TITLES, type ScreenId } from '../flow';
import { indexesFor } from '../indexes';
import { Footer, Header, Note, NotWired, Row, Screen, Section } from '../pui';
import { edgeAllowed } from '../session';
import { colors, radius, space, StyleSheet, tint } from '../theme';
import { ActionButton, Card, ProgressRing, StatusIcon, text } from '../ui';
import { Byline, PersonAvatar, usePerson } from '../UserChip';

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
// Phase 2 facts are absent, not faked: checkpoints and locks behind them,
// Set aside, Move past a checkpoint, Keep it and say why, Log what happened.

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
  if (/community|retell|playback/.test(step.stepId)) return Users;
  if (/back_?translation/.test(step.stepId)) return Headphones;
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
  const loaded = useRecord(ctx);
  const { state } = ctx.project;
  if (!state || !loaded) return <Note>Passage not found.</Note>;
  const { rec, unitId, laneId } = loaded;
  const me = ctx.session.actorId;
  const nameOf = (id: string) => (id === me ? 'you' : person(id).name);
  const headline = recordHeadline(rec, nameOf);
  const action = recordNextAction(rec, me, { record: ctx.session.can('translate'), review: ctx.session.can('review'), ask: ctx.session.can('assign_work') });
  const params = { unitId, laneId };

  const footer = (() => {
    switch (action.kind) {
      case 'record_fix':
        return canGo(ctx, 'passage_record', 'workspace') ? <ActionButton icon={Reply} accessibilityLabel="Record a fix" onPress={() => ctx.go('workspace', { ...params, respondsTo: action.respondsTo })} /> : null;
      case 'record':
        return canGo(ctx, 'passage_record', 'workspace') ? <ActionButton icon={Mic} accessibilityLabel={rec.draft ? 'Continue recording' : 'Record it'} onPress={() => ctx.go('workspace', params)} /> : null;
      case 'new_version':
        return canGo(ctx, 'passage_record', 'workspace') ? <ActionButton icon={Mic} accessibilityLabel="New version" onPress={() => ctx.go('workspace', params)} /> : null;
      case 'review':
        return canGo(ctx, 'passage_record', 'review_capture') ? <ActionButton icon={ListChecks} accessibilityLabel="Review it now" onPress={() => ctx.go('review_capture', { ...params, takeId: action.takeId, stepId: action.stepId })} /> : null;
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
            <FeedbackCard key={`${f.stepId}:${f.reviewerId}`} ctx={ctx} rec={rec} feedback={f} nameOf={nameOf}
              onPress={() => ctx.go('review_detail', { ...params, takeId: f.takeId, round: `${f.stepId}:${f.reviewerId}` })} />
          ))}
          <NextZone ctx={ctx} rec={rec} action={action} params={params} />
          <Details ctx={ctx} rec={rec} open={open} setOpen={setOpen} params={params} nameOf={nameOf} />
        </>
      )}

      <Modal visible={sheet !== null} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <Pressable style={styles.scrim} onPress={() => setSheet(null)} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          {sheet === 'recorded' ? <RecordedSheet ctx={ctx} rec={rec} params={params} close={() => setSheet(null)} nameOf={nameOf} />
            : sheetStep ? <StepSheet ctx={ctx} rec={rec} step={sheetStep} params={params} close={() => setSheet(null)} nameOf={nameOf} /> : null}
        </View>
      </Modal>
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

/** A pressable step tile. Colour never alone: every state has its corner icon. */
function StepTile(props: { icon: LucideIcon; state: RecordStep['state']; label: string; half?: boolean; asked?: string[]; onPress: () => void }) {
  const person = usePerson();
  const Icon = props.icon;
  const s = props.state;
  const bg = s === 'complete' ? tint.done : s === 'attention' ? tint.review : s === 'locked' ? colors.muted : colors.card;
  const fg = s === 'complete' ? colors.done : s === 'attention' || s === 'current' || s === 'waiting' ? colors.review : colors.mutedForeground;
  const Corner = s === 'complete' ? CheckCircle2 : s === 'attention' ? MessageSquare : s === 'waiting' ? Clock : s === 'locked' ? Lock : null;
  return (
    <Pressable onPress={props.onPress} accessibilityRole="button" accessibilityLabel={`${props.label}: ${TILE_STATE_LABEL[s]}`}
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
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.path}>
      <StepTile icon={Mic} state={recordedState} label="Recorded" onPress={props.onRecorded} />
      {groups.map((g) => (
        <View key={g[0]!.group} style={styles.pathGroup}>
          <View style={styles.connector} />
          <View style={{ gap: 2, alignItems: 'center' }} accessibilityLabel={g.length > 1 ? 'Either order' : undefined}>
            {g.map((s, i) => (
              <View key={s.stepId} style={{ alignItems: 'center' }}>
                {i > 0 ? <ArrowUpDown size={12} color={colors.mutedForeground} /> : null}
                <StepTile icon={stepIcon(s)} state={s.state} label={s.label} half={g.length > 1} asked={s.askedOf} onPress={() => props.onStep(s.stepId)} />
              </View>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

/** Feedback on the latest version (J-REC-3, J-REC-16). The author's footer is Record a fix. */
function FeedbackCard(props: { ctx: Ctx; rec: Rec; feedback: Rec['openFeedback'][number]; nameOf: (id: string) => string; onPress: () => void }) {
  const { rec, feedback: f } = props;
  const person = usePerson();
  const step = rec.steps.find((s) => s.stepId === f.stepId);
  const StepIcon = step ? stepIcon(step) : ListChecks;
  const author = rec.latest!.authorId;
  const label = rec.feedbackIsMine
    ? `${step?.label ?? f.stepId} asked for changes. Record a fix to answer it.`
    : `Waiting on ${props.nameOf(author)} to answer the ${step?.label ?? f.stepId}`;
  return (
    <Pressable onPress={props.onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [styles.feedback, pressed && { opacity: 0.85 }]}>
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
  );
}

/**
 * The next step's rows (J-REC-8). While feedback is open the row is the
 * dashed "Then: …" state with no buttons (ADR-014). The action the footer
 * already offers is not repeated here, so nothing but the footer is yellow.
 */
function NextZone(props: { ctx: Ctx; rec: Rec; action: ReturnType<typeof recordNextAction>; params: Record<string, string> }) {
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
          </View>
        );
      })}
    </View>
  );
}

function StepSheet(props: { ctx: Ctx; rec: Rec; step: RecordStep; params: Record<string, string>; close: () => void; nameOf: (id: string) => string }) {
  const { ctx, rec, step } = props;
  const person = usePerson();
  const Icon = stepIcon(step);
  const reviews = rec.latest?.reviews.filter((r) => r.stepId === step.stepId) ?? [];
  const parallel = rec.steps.filter((s) => s.group === step.group).length > 1;
  const go = (to: ScreenId, extra: Record<string, string>) => { props.close(); ctx.go(to, { ...props.params, ...extra }); };
  const canReview = rec.recorded && ctx.session.can('review') && !!step.status?.eligible.includes(ctx.session.actorId) && canGo(ctx, 'passage_record', 'review_capture');
  const canAsk = rec.recorded && step.role !== 'translator' && canGo(ctx, 'passage_record', 'ask_someone');
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
          <Pressable key={r.reviewerId} onPress={() => go('review_detail', { takeId: r.takeId, round: `${r.stepId}:${r.reviewerId}` })}
            accessibilityLabel={`${props.nameOf(r.reviewerId)}: ${r.decision === 'approve' ? 'looks good' : 'needs changes'}`} style={styles.personMark}>
            <PersonAvatar look={person(r.reviewerId)} size={28} />
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
      </View>
      <View style={styles.sheetActions}>
        {canReview ? <ActionButton variant="outline" icon={ListChecks} accessibilityLabel="Review it now" style={styles.iconBtn}
          onPress={() => go('review_capture', { takeId: rec.latest!.takeId, stepId: step.stepId })} /> : null}
        {canAsk ? <ActionButton variant="outline" icon={UserPlus} accessibilityLabel="Ask someone" style={styles.iconBtn}
          onPress={() => go('ask_someone', { stepId: step.stepId })} /> : null}
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
    case 'review': return `${label(e.stepId)} · ${e.decision === 'approve' ? 'looks good' : 'needs changes'}`;
    case 'response': return `Version ${e.n} answers the feedback`;
    case 'ask': return e.role === 'translator' ? 'Asked someone to record' : `Asked for ${rec.steps.filter((s) => s.role === e.role).map((s) => s.label).join(' and ') || e.role}`;
  }
}

function EntryIcon(props: { entry: RecordEntry }) {
  const e = props.entry;
  if (e.kind === 'version') return <Mic size={16} color={colors.translate} />;
  if (e.kind === 'response') return <Reply size={16} color={colors.translate} />;
  if (e.kind === 'ask') return <UserPlus size={16} color={colors.mutedForeground} />;
  return e.decision === 'approve' ? <CheckCircle2 size={16} color={colors.done} /> : <MessageSquare size={16} color={colors.review} />;
}

/** Details on request (ADR-013): Reviews by version and History, collapsed. */
function Details(props: {
  ctx: Ctx; rec: Rec; params: Record<string, string>; nameOf: (id: string) => string;
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
        {rec.history.map((e) => {
          const onPress = e.kind === 'review' ? () => ctx.go('review_detail', { ...props.params, takeId: e.takeId, round: `${e.stepId}:${e.by}` })
            : e.kind === 'version' || e.kind === 'response' ? () => ctx.go('version_detail', { ...props.params, takeId: e.takeId })
            : undefined;
          return (
            <Pressable key={e.id} onPress={onPress} disabled={!onPress} style={styles.historyRow}
              accessibilityRole={onPress ? 'button' : undefined}
              accessibilityLabel={`${entryTitle(e, rec)} · ${props.nameOf(e.by)} · ${shortDate(e.at)}`}>
              <EntryIcon entry={e} />
              <PersonAvatar look={person(e.by)} size={20} />
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
// Built on v1.AssignmentMade (J-REC-10, partial). Fixed to the step whose
// button opened it (ADR-020); without a step it asks someone to record.
// The event names a role, not a step, so an ask covers every step that role
// does (F6 is Phase 2). Sending needs `assign_work`, the privilege the server
// requires for AssignmentMade. No Undo: there is no fact to withdraw an ask yet.

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
  const role = step ? step.role : 'translator';
  const also = step ? rec.steps.filter((s) => s.role === step.role && s.stepId !== step.stepId) : [];
  const askable = !step || step.role !== 'translator';
  const mayAsk = ctx.session.can('assign_work');
  const members = Object.entries(state.members).filter(([, m]) => !m.removed.value && m.role.value !== 'viewer').map(([id, m]) => ({ id, role: m.role.value }));
  const usual = step?.status?.eligible ?? members.filter((m) => m.role === role).map((m) => m.id);
  const others = members.map((m) => m.id).filter((id) => !usual.includes(id));
  const language = state.lanes[laneId]?.languoidId ?? laneId;
  const first = who ? person(who).name.split(' ')[0] : '';

  async function send() {
    if (!who || sending) return;
    setSending(true);
    try {
      await append('v1.AssignmentMade', { unitId, laneId, profileId: who, role, ...(due ? { dueDate: due } : {}), ...(directions.trim() ? { instructions: directions.trim() } : {}) });
      ctx.toast(`${person(who).name} will see it on their My Work`);
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
    <Screen footer={askable ? <Footer label={who ? `Ask ${first}` : 'Choose someone'} onPress={() => void send()} disabled={!who || !mayAsk || sending} /> : undefined}>
      <Header title={step ? `Ask for ${step.label}` : 'Ask someone to record'} sub={`${state.units[unitId]!.label} · ${language}`} onBack={ctx.back} />
      {!askable ? <Note>This step is done by translators, so an ask would read as an ask to record. Asking for one step needs a request that names the step, which is not built yet.</Note> : null}
      {askable && !mayAsk ? <Note>Only people who can assign work can send an ask today.</Note> : null}
      {also.length > 0 ? <Note>{`This also asks for ${also.map((s) => s.label).join(' and ')}: an ask names a role, and the same role does those steps.`}</Note> : null}
      {askable ? (
        <>
          <Section label={step ? `Usually does ${step.label}` : 'Translators'}>
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
        </>
      ) : null}
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
  const { state } = ctx.project;
  const takeId = ctx.params['takeId'] ?? '';
  const [stepId = '', actor = ''] = (ctx.params['round'] ?? '').split(':');
  const take = state?.takes[takeId];
  const review = state?.reviews[takeId]?.[stepId]?.[actor]?.value;
  if (!state || !take || !review) return <Note>Review not found.</Note>;
  const rec = derivePassageRecord(state, take.unitId, take.laneId, ctx.session.actorId, indexesFor(state));
  const version = rec.versions.find((v) => v.takeId === takeId);
  const approved = review.decision === 'approve';
  const voice = state.reviewComments[takeId]?.[stepId]?.[actor]?.blobHash;
  const questions = new Map(questionsOf(questionSetsFor(state, takeId, stepId)).map((q) => [q.id, q.text]));
  const answeredBy = rec.versions.find((v) => v.respondsToTakeId === takeId);
  const open = rec.openFeedback.some((f) => f.takeId === takeId && f.stepId === stepId && f.reviewerId === actor);
  const params = { unitId: take.unitId, laneId: take.laneId };
  const label = rec.steps.find((s) => s.stepId === stepId)?.label ?? stepId;
  const canFix = open && rec.feedbackIsMine && ctx.session.can('translate') && canGo(ctx, 'review_detail', 'workspace');
  return (
    <Screen footer={canFix ? <Footer label="Record a fix" onPress={() => ctx.go('workspace', { ...params, respondsTo: takeId })} /> : undefined}>
      <Header title={label} sub={<Byline before="by" id={actor} after={`· ${shortDate(state.reviews[takeId]![stepId]![actor]!.hlc)}`} />} onBack={ctx.back} />
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
        <Row label={version ? `Reviewed Version ${version.n}` : 'Reviewed version'} onPress={() => ctx.go('version_detail', { ...params, takeId })} last={!answeredBy} />
        {answeredBy ? <Row icon={Reply} label={`Revised in Version ${answeredBy.n}`} sub={<Byline before="by" id={answeredBy.authorId} after={`· ${shortDate(answeredBy.at)}`} />}
          onPress={() => ctx.go('version_detail', { ...params, takeId: answeredBy.takeId })} last /> : null}
      </Section>
      {open && !rec.feedbackIsMine && rec.latest ? <Byline before="Waiting on" id={rec.latest.authorId} after={`to answer the ${label}`} /> : null}
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

export function AddRecord(ctx: Ctx) {
  return <Placeholder ctx={ctx} id="add_record" />;
}

import { contractsFor } from '../screenContracts';
export const contracts = contractsFor('passage_record', 'ask_someone', 'add_record', 'version_detail', 'review_detail');
