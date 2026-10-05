// The passage record and what hangs off it. Ports the UX demo's
// `screens/passage.tsx`: PassageRecordScreen (passage_record),
// VersionDetailScreen (version_detail), ReviewDetailScreen (review_detail)
// and AskSomeoneScreen (ask_someone).
// Requirements CORE-1..11, REC-1..10, ASK-1..5; ADR-005, 007, 012, 013, 014,
// 015, 016, 020, 021, 029, 030 (the path top to bottom: passage/journey.tsx).
// Everything shown is derived from the event log
// (core derivePassage and friends); every change is a core command through
// ctx.act, with Undo where the demo offers it.
import {
  CommandError, commands, feedbackIsMine, isCompleteState, keyTermLinksFor, KIND_STATE_LABEL, questionsForKind, recordTimeline,
  reviewGrid, stepName,
  type Commands, type EventSpec, type FlowStepStatus, type KindState, type KindStatus, type PassageNote, type QuestionSpec, type ReviewView
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AudioClip } from '../audioClip';
import type { Ctx } from '../ctx';
import { edgeFor, TITLES, type ScreenId } from '../flow';
import { indexesFor } from '../indexes';
import {
  Badge, Card, Chip, ChipRow, Disclosure, EmptyState, Field, GhostBtn, Group, Header, Ico, IconBtn, KindIcon, kindIcon, LinkBtn,
  NoteCard, PrimaryBtn, ReasonSheet, Row, Screen, SectionLabel, Sheet, ShowMore, SmallBtn, StateMark, txt
} from '../kit';
import {
  addDays, anchorLabel, answeredQuestions, askCandidates, channelLabel, currentStepId, describeEntry, DUE_CHOICES, dueError, feedbackNames,
  gridKindIds, guestMessage, heroHeadline, historySummary, isoDay, kindRowActions, kindRowSub, nextQuestionType, QUESTION_TYPE_LABEL,
  reviewMark, reviewsSummary, sendTargetLabel, stepSheetSub, versionReviewsSummary, type EntryText, type KindRowCan, type MineFn,
  type RowAction
} from '../passage/record';
import { Journey } from '../passage/journey';
import { requestIsMine, sendToInput, teamNameIn, usualTargetFor, type UsualTarget } from '../passage/sendTarget';
import { dueText, feedbackSource, outcomeText, passageCrumbs, plural, usePassage, versionTitle, viaText, when, type PassageView } from '../passageView';
import { noteExpected, reportError } from '../report';
import { Authored, authoredText, recordTarget, ReportFlag } from '../reportSheet';
import { UsedLine } from '../sources/used';
import { contractsFor } from '../screenContracts';
import { edgeAllowed } from '../session';
import { useStudyGuide } from '../study/libraryGuides';
import { studyProgress, studySummary, type StudyProgress } from '../study/progress';
import { StepMark, stepLine } from '../study/ui';
import { C, radius, space, TINT, withAlpha } from '../theme';
import { PersonAvatar, usePerson } from '../UserChip';
import { VoiceNote, voiceFor } from '../voiceNote';

// ---- shared plumbing -----------------------------------------------------------------

const SKIP_REASONS = ['No one available for this right now', 'Another review already covered this', 'Not needed for this passage'];
const OVERRIDE_REASONS = ['Consultant visit is months away; church needs it now', 'Checked informally — will record it later'];
const KEEP_REASONS = ['Listeners preferred the current wording', 'Matches our key terms decision', 'The suggestion changes the meaning'];
const HISTORY_STEP = 20;
const GRID_STEP = 10;
const PEOPLE_STEP = 25;
/** iOS will not present a sheet while another is still sliding away. */
const SHEET_GAP_MS = 400;

const newId = () => Crypto.randomUUID();

/** May this session take the edge from one of these screens to `to` (flow.ts gate)? */
function canGo(ctx: Ctx, from: ScreenId, to: ScreenId): boolean {
  const edge = edgeFor(from, to);
  return !!edge && edgeAllowed(edge, ctx.session);
}

/**
 * Build a command's events against the fold and apply them. A command the
 * fold refuses says why in a toast instead of throwing; anything else is a
 * fault, reported with an id the person can read out. A failed write was
 * already shown by ctx.act. `undo` builds the inverse from the specs that
 * were applied (their ids).
 */
async function perform(
  ctx: Ctx,
  build: (c: Commands) => EventSpec[],
  message: string,
  undo?: (applied: EventSpec[]) => (c: Commands) => EventSpec[]
): Promise<boolean> {
  const state = ctx.project.state;
  if (!state) return false;
  let specs: EventSpec[];
  try {
    specs = build(commands(state, indexesFor(state)));
  } catch (e) {
    if (e instanceof CommandError) ctx.toast(e.message);
    else ctx.toast(`Something went wrong (code ${reportError('passage: build command', e)}). Nothing was lost.`);
    return false;
  }
  try {
    await ctx.act(specs, message, undo ? () => {
      const now = ctx.project.state ?? state;
      return undo(specs)(commands(now, indexesFor(now)));
    } : undefined);
    return true;
  } catch (e) {
    // ctx.act already said "Not saved"; only the caller's busy state is left to reset.
    noteExpected('passage: write', e);
    return false;
  }
}

const payloadField = (specs: EventSpec[], field: 'departureId' | 'requestId'): string =>
  String((specs[0]?.payload as Record<string, unknown> | undefined)?.[field] ?? '');

/** Undo of a departure: the step, checkpoint or feedback is back as it was (CORE-2). */
const undoDepart = (applied: EventSpec[]) => (c: Commands) => c.undoDeparture({ commandId: newId(), departureId: payloadField(applied, 'departureId') });

function Missing(props: { ctx: Ctx; id: ScreenId; crumbsOf?: PassageView; text?: string }) {
  const { ctx } = props;
  return (
    <Screen header={<Header title={TITLES[props.id]} onBack={ctx.back} {...(props.crumbsOf ? { crumbs: passageCrumbs(ctx, props.crumbsOf, TITLES[props.id]) } : {})} />}>
      <EmptyState icon="book" title={props.text ?? (ctx.project.state ? "This passage isn't in the project." : 'Loading the project…')} />
    </Screen>
  );
}

function PlayRow(props: { ctx: Ctx; hashes: string[]; label: string; sub?: string }) {
  return (
    <View style={styles.playRow}>
      <AudioClip project={props.ctx.project} hashes={props.hashes} label={props.label} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[txt.sm, { fontWeight: '600' }]} numberOfLines={1}>{props.label}</Text>
        {props.sub ? <Text style={txt.xs} numberOfLines={1}>{props.sub}</Text> : null}
      </View>
    </View>
  );
}

function Label(props: { text: string; color?: string }) {
  return <Text style={[txt.label, props.color ? { color: props.color } : null]}>{props.text}</Text>;
}

// ---- passage_record ------------------------------------------------------------------

interface RecordCan extends KindRowCan {
  record: boolean;
  override: boolean;
  undo: boolean;
  withdraw: boolean;
  note: boolean;
  keep: boolean;
}

/** How far above the current step the record opens, so a little of the path above it shows. */
const CURRENT_STEP_INSET = 96;

/**
 * Everything that happened to a passage in one place: where it stands (the
 * hero), the path top to bottom with the next step open in place and
 * feedback at the step that gave it (ADR-030), and the details on request.
 */
export function PassageRecord(ctx: Ctx) {
  const v = usePassage(ctx);
  const [openStepId, setOpenStepId] = useState<string | null>(null);
  const [skipping, setSkipping] = useState<{ kindId: string; stepId: string } | null>(null);
  const [overriding, setOverriding] = useState<string | null>(null);
  const [keeping, setKeeping] = useState<string | null>(null);
  const [noting, setNoting] = useState(false);
  const [more, setMore] = useState(false);
  const [historyShown, setHistoryShown] = useState(HISTORY_STEP);
  // Which version the path shows: the latest unless someone flipped back (‹ ›, the dots, a swipe).
  const versionCount = v?.p.versions.length ?? 0;
  const [versionIdx, setVersionIdx] = useState(Math.max(0, versionCount - 1));
  useEffect(() => { setVersionIdx(Math.max(0, versionCount - 1)); }, [v?.unitId, v?.laneId, versionCount]);
  const scroll = useRef<ScrollView>(null);
  const content = useRef<View>(null);
  const scrolledFor = useRef<string | null>(null);
  const timeline = useMemo(() => (v ? recordTimeline(v.state, v.p) : []), [v?.state, v?.p]);
  const guide = useStudyGuide(ctx, v?.unitId, v?.laneId);
  const study = useMemo(() => (v && guide ? studyProgress(v.state, v.p, guide) : null), [v?.state, v?.p, guide]);
  const me = ctx.session.actorId;
  const isAuthor = !!v?.p.latest && v.p.latest.by === me;
  // Where each of the flow's kinds usually goes; only its author sends a version on (ADR-029).
  const targets = useMemo(() => {
    const out: Record<string, UsualTarget | undefined> = {};
    if (!v || !isAuthor) return out;
    for (const kindId of new Set(v.p.flow.steps.flatMap((st) => st.kindIds))) {
      out[kindId] = usualTargetFor(v.state, ctx.org.state, { projectId: ctx.project.projectId, laneId: v.laneId, kindId, me });
    }
    return out;
  }, [v?.state, v?.laneId, v?.p.flow, ctx.org.state, ctx.project.projectId, me, isAuthor]);
  if (!v) return <Missing ctx={ctx} id="passage_record" />;

  const { p, kinds, unitId, laneId } = v;
  const s = ctx.session;
  const can: RecordCan = {
    record: canGo(ctx, 'passage_record', 'workspace'),
    review: canGo(ctx, 'passage_record', 'review_capture'),
    ask: canGo(ctx, 'passage_record', 'ask_someone'),
    log: canGo(ctx, 'passage_record', 'add_record'),
    skip: s.can('translate') || s.can('review') || s.can('assign_work'),
    override: s.can('override_checkpoints'),
    undo: s.can('translate') || s.can('review') || s.can('assign_work') || s.can('override_checkpoints'),
    withdraw: s.can('send_to_reviewers') || s.can('assign_work'),
    note: s.can('translate') || s.can('review') || s.can('fill_reference'),
    keep: s.can('translate')
  };
  const params = { unitId, laneId };
  const mine = requestIsMine(v.state, me);
  const teamName = teamNameIn(v.state);
  const answersMine = can.record && can.keep && feedbackIsMine(p, me);
  const myDraft = p.drafting && p.draftBy === me;
  const fbKindIds = p.awaitingResponse.map((r) => r.kindId);
  const fbNames = feedbackNames(p, kinds);
  const openStep = openStepId ? p.steps.find((st) => st.step.id === openStepId) : undefined;
  const anchor = (n: PassageNote) => anchorLabel(n, { state: v.state, p, guide });
  const describe = (e: (typeof timeline)[number]) => describeEntry(e, { p, kinds, name: ctx.name, anchor, guide, hidden: (id) => id !== me && ctx.blocks.has(id) });
  const recordLabel = myDraft ? 'Continue recording' : 'Record a new version';

  /** Close the step sheet first; a second sheet waits until it has gone. */
  const afterSheet = (fn: () => void) => {
    if (!openStepId && !more) return fn();
    setOpenStepId(null);
    setMore(false);
    setTimeout(fn, SHEET_GAP_MS);
  };
  const go = (to: ScreenId, extra: Record<string, string> = {}) => {
    setOpenStepId(null);
    setMore(false);
    ctx.go(to, { ...params, ...extra });
  };
  /** One tap from the record: the kind goes to whoever usually does it, with Undo (ADR-029). */
  const sendTo = (kindId: string) => {
    const target = targets[kindId];
    if (!target) return go('ask_someone', { what: 'review', kindId });
    setOpenStepId(null);
    const label = sendTargetLabel(target, ctx.name);
    void perform(ctx, (c) => c.ask(sendToInput({ commandId: newId(), unitId, laneId, kindId, target })),
      `Sent to ${label} — ${'teamId' in target ? 'anyone on it' : 'they'} will see it on My Work`,
      (applied) => (c) => c.withdrawRequest({ commandId: newId(), requestId: payloadField(applied, 'requestId') }));
  };
  const onRowAction = (a: RowAction, k: KindStatus, step: FlowStepStatus, askedMe: boolean) => {
    const kind = v.kind(k.kindId);
    const request: Record<string, string> = askedMe && k.request ? { requestId: k.request.id } : {};
    if (a.id === 'do') go(kind.produces ? 'back_translation' : 'review_capture', { kindId: k.kindId, ...request });
    if (a.id === 'send') sendTo(k.kindId);
    if (a.id === 'ask') go('ask_someone', { what: 'review', kindId: k.kindId });
    if (a.id === 'log') go('add_record', { kindId: k.kindId });
    if (a.id === 'skip') afterSheet(() => setSkipping({ kindId: k.kindId, stepId: step.step.id }));
  };
  const target = (kindId: string) => targets[kindId];
  const kindRow = (k: KindStatus, step: FlowStepStatus, first: boolean, compact: boolean) => {
    const t = target(k.kindId);
    return (
      <KindActionRow key={k.kindId} ctx={ctx} v={v} status={k} step={step} can={can} isAuthor={isAuthor} first={first} compact={compact}
        mine={mine} teamName={teamName} {...(t ? { sendTo: sendTargetLabel(t, ctx.name) } : {})}
        {...(fbKindIds.length && !fbKindIds.includes(k.kindId) ? { waitFor: fbNames } : {})}
        onAction={onRowAction} onMore={() => setOpenStepId(step.step.id)} />
    );
  };
  /** Open where the work is: the current step, with the path above it to scroll back through (ADR-030, amended). */
  const scrollToCurrent = (row: View) => {
    const key = `${unitId}:${laneId}:${currentStepId(p) ?? ''}`;
    const into = content.current;
    if (scrolledFor.current === key || !into) return;
    scrolledFor.current = key;
    row.measureLayout(into, (_x, y) => scroll.current?.scrollTo({ y: Math.max(0, y - CURRENT_STEP_INSET), animated: false }));
  };

  const undoFromHistory = (departureId: string, type: string) => void perform(ctx, (c) => c.undoDeparture({ commandId: newId(), departureId }),
    type === 'override' ? 'The checkpoint is back — later steps wait for it again'
      : type === 'keep' ? 'Undone — the feedback is waiting again' : "Brought back — it's a suggested step again");
  const withdraw = (requestId: string) => void perform(ctx, (c) => c.withdrawRequest({ commandId: newId(), requestId }), 'Request withdrawn');

  // Once every step is complete a new version is the one thing left to do; before that it waits under More (ADR-029).
  const footer = can.record && p.recorded && p.done && !answersMine
    ? <PrimaryBtn label={myDraft ? 'Continue recording' : 'New version'} icon="mic" onPress={() => go('workspace')} />
    : undefined;
  const moreAction = can.record && p.recorded && !p.done && !answersMine ? (
    <Pressable onPress={() => setMore(true)} accessibilityRole="button" accessibilityLabel="More"
      style={({ pressed }) => [styles.headerMore, pressed && { opacity: 0.6 }]}>
      <Text style={[txt.sm, { fontWeight: '700' }]}>More</Text>
      <Ico name="down" size={16} color={C.dark} />
    </Pressable>
  ) : undefined;

  // Details always has Reference: what translators are offered here and why (screens/reference.tsx).
  const showDetails = true;
  const gridIds = gridKindIds(p);
  const flowLabel = p.flow.steps.length === 0 && !p.flow.flowId ? 'No review flow' : p.flow.name;
  const latest = timeline[0];

  return (
    <Screen fixed header={<Header title={v.title} sub={`${v.lane} · ${flowLabel}`} onBack={ctx.back} {...(moreAction ? { action: moreAction } : {})} />} footer={footer}>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View ref={content} collapsable={false} style={{ gap: space.md }}>
          <Card>
            <Hero ctx={ctx} v={v} mine={mine} {...(latest ? { latest: { text: describe(latest), hlc: latest.hlc } } : {})} />
            <Journey ctx={ctx} v={v} versionIdx={Math.min(versionIdx, Math.max(0, p.versions.length - 1))} onVersion={setVersionIdx}
              canAct={can.ask || can.log || can.review} teamName={teamName}
              onOpenStep={setOpenStepId} onCurrentLayout={scrollToCurrent}
              onOpenVersion={(takeId) => go('version_detail', { takeId })} onOpenReview={(reviewId) => go('review_detail', { reviewId })}
              feedbackSlot={(r) => answersMine ? (
                <FeedbackToAnswer ctx={ctx} v={v} review={r}
                  onOpen={() => go('review_detail', { reviewId: r.id })}
                  onRevise={() => go('workspace', { reviewId: r.id })}
                  onKeep={() => setKeeping(r.id)} />
              ) : <WaitingOnAnswer ctx={ctx} v={v} review={r} onOpen={() => go('review_detail', { reviewId: r.id })} />}
              nextSlot={(
                <NextCard ctx={ctx} v={v} can={can} study={study} feedbackNames={fbNames} kindRow={kindRow}
                  onRecord={() => go('workspace')} onStudy={() => go('study_guide')} onAskRecord={() => go('ask_someone', { what: 'record' })} />
              )} />
          </Card>

          {showDetails ? <SectionLabel label="Details" /> : null}
          {study ? (
            <Disclosure icon="sparkle" title={`${study.guide.pattern} study`}
              summary={study.doneCount || study.noteCount ? studySummary(study) : 'Not started'}
              {...ctx.details(`passage:${unitId}:${laneId}:study`)}>
              <StudyRows ctx={ctx} study={study} onOpen={(stepId) => go('study_step', { stepId })} />
              <Row icon="sparkle" label="Open the study" onPress={() => go('study_guide')} last />
            </Disclosure>
          ) : null}
          {p.versions.length > 0 && gridIds.length > 0 ? (
            <Disclosure icon="chat" title="Reviews by version" summary={reviewsSummary(p)} {...ctx.details(`passage:${unitId}:${laneId}:reviews`)}>
              <ReviewGrid ctx={ctx} v={v} kindIds={gridIds}
                onVersion={(takeId) => go('version_detail', { takeId })} onReview={(reviewId) => go('review_detail', { reviewId })} />
            </Disclosure>
          ) : null}
          {timeline.length > 0 ? (
            <Disclosure icon="history" title="History" summary={historySummary(timeline)} {...ctx.details(`passage:${unitId}:${laneId}:history`)}>
              {timeline.slice(0, historyShown).map((e, i) => {
                const t = describe(e);
                let onPress: (() => void) | undefined;
                let trailing: ReactNode = null;
                if (e.type === 'version') onPress = () => go('version_detail', { takeId: e.version.takeId });
                if (e.type === 'review' || e.type === 'response') onPress = () => go('review_detail', { reviewId: e.review.id });
                if (e.type === 'study') onPress = () => go('study_step', { stepId: e.stepId });
                if (e.type === 'departure' && !e.departure.undone && can.undo) {
                  trailing = <SmallBtn label="Undo" icon="undo" onPress={() => undoFromHistory(e.departure.id, e.departure.type)} />;
                }
                if (e.type === 'request' && e.request.status === 'open' && can.withdraw && (e.request.by === me || s.can('assign_work'))) {
                  trailing = <SmallBtn label="Withdraw" onPress={() => withdraw(e.request.id)} />;
                }
                // A note on the whole passage shows only here, so it is reported from here (decisions.md 48);
                // so is someone else's request with words of its own. Versions and reviews open their page, which has the flag.
                if (!trailing && e.type === 'note') {
                  trailing = <ReportFlag ctx={ctx} target={recordTarget(ctx, 'note', e.note.id, e.by, unitId, laneId)} size={36} />;
                }
                if (!trailing && e.type === 'request' && e.request.by && (e.request.note || e.request.noteBlobHash)) {
                  trailing = <ReportFlag ctx={ctx} target={recordTarget(ctx, 'request', e.request.id, e.request.by, unitId, laneId)} size={36} />;
                }
                return <HistoryRow key={`${e.type}-${e.hlc}-${i}`} text={t} when={when(e.hlc)} last={i === Math.min(historyShown, timeline.length) - 1} trailing={trailing} {...(onPress ? { onPress } : {})} />;
              })}
              <View style={{ paddingHorizontal: space.md, paddingBottom: historyShown < timeline.length ? space.md : 0 }}>
                <ShowMore remaining={timeline.length - historyShown} step={HISTORY_STEP} onMore={() => setHistoryShown((n) => n + HISTORY_STEP)} />
              </View>
            </Disclosure>
          ) : null}
          {can.note ? (
            <Group>
              <Row icon="note" iconColor={TINT.amberText} iconBg={TINT.note} label="Add a note" sub="By voice or text. It follows this passage into reviews and later versions."
                onPress={() => setNoting(true)} last />
            </Group>
          ) : null}
          <Group>
            <Row icon="book" label="Reference" sub="Bibles, guides and notes offered here, and why" onPress={() => go('passage_reference')} last />
          </Group>
        </View>
      </ScrollView>

      {openStep ? (
        <Sheet visible title={stepName(kinds, openStep.step)} sub={stepSheetSub(openStep, can.ask || can.log || can.review)} onClose={() => setOpenStepId(null)}>
          <Group>{openStep.kinds.map((k, i) => kindRow(k, openStep, i === 0, false))}</Group>
          {can.override && openStep.step.checkpoint && !openStep.complete && !openStep.override ? (
            <GhostBtn label="Move past this checkpoint…" tone="red" onPress={() => afterSheet(() => setOverriding(openStep.step.id))} />
          ) : null}
        </Sheet>
      ) : null}
      {more ? (
        <Sheet visible title="More" sub="Less common things to do with this passage." onClose={() => setMore(false)}>
          <Group>
            <Row icon="mic" label={recordLabel} sub="Reviews so far stay with the version they heard." onPress={() => go('workspace')} last />
          </Group>
          <Text style={txt.xs}>To ask someone else, say a step already happened, or set one aside, open that step on the path.</Text>
        </Sheet>
      ) : null}
      {skipping ? (
        <ReasonSheet visible title={`Set aside ${v.kind(skipping.kindId).name}?`}
          sub="The flow suggests this step. Setting it aside is fine — say why so the next person understands."
          quickReasons={SKIP_REASONS} confirmLabel="Set aside" voice={voiceFor(ctx, unitId, laneId)} onClose={() => setSkipping(null)}
          onConfirm={(r) => {
            const { kindId, stepId } = skipping;
            setSkipping(null);
            void perform(ctx, (c) => c.depart({ commandId: newId(), unitId, laneId, type: 'skip', kindId, stepId, reason: r.reason, ...(r.blobHash ? { reasonBlobHash: r.blobHash } : {}) }),
              `${v.kind(kindId).name} set aside · reason saved`, undoDepart);
          }} />
      ) : null}
      {overriding ? (
        <ReasonSheet visible title="Move past the checkpoint?" tone="red"
          sub="Checkpoints are the flow's hard stops. Your reason is recorded with your name, and anyone can see it on the record."
          quickReasons={OVERRIDE_REASONS} confirmLabel="Move past checkpoint" voice={voiceFor(ctx, unitId, laneId)} onClose={() => setOverriding(null)}
          onConfirm={(r) => {
            const stepId = overriding;
            setOverriding(null);
            void perform(ctx, (c) => c.depart({ commandId: newId(), unitId, laneId, type: 'override', stepId, reason: r.reason, ...(r.blobHash ? { reasonBlobHash: r.blobHash } : {}) }),
              'Moved past the checkpoint · reason saved', undoDepart);
          }} />
      ) : null}
      {keeping ? (
        <KeepSheet ctx={ctx} v={v} reviewId={keeping} onClose={() => setKeeping(null)} />
      ) : null}
      {noting ? <AddNoteSheet ctx={ctx} v={v} onClose={() => setNoting(false)} /> : null}
    </Screen>
  );
}

/** Keep a version despite feedback, with a reason (REC-5, CORE-2). Undo puts the feedback back. */
function KeepSheet(props: { ctx: Ctx; v: PassageView; reviewId: string; onClose: () => void }) {
  const { ctx, v } = props;
  return (
    <ReasonSheet visible title="Keep it as it is?" tone="amber"
      sub="No new version is made. Your reason goes back to the reviewer and into the record."
      quickReasons={KEEP_REASONS} confirmLabel="Keep and send reason" voice={voiceFor(ctx, v.unitId, v.laneId)} onClose={props.onClose}
      onConfirm={(r) => {
        props.onClose();
        void perform(ctx, (c) => c.depart({
          commandId: newId(), unitId: v.unitId, laneId: v.laneId, type: 'keep', reviewId: props.reviewId, reason: r.reason,
          ...(r.blobHash ? { reasonBlobHash: r.blobHash } : {})
        }), 'Kept · your reason is on the record', undoDepart);
      }} />
  );
}

function AddNoteSheet(props: { ctx: Ctx; v: PassageView; onClose: () => void }) {
  const { ctx, v } = props;
  const [text, setText] = useState('');
  const [hash, setHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const ok = await perform(ctx, (c) => c.addNote({
      commandId: newId(), unitId: v.unitId, laneId: v.laneId, anchor: { kind: 'passage' },
      ...(text.trim() ? { text: text.trim() } : {}), ...(hash ? { blobHash: hash } : {})
    }), 'Note added — it follows this passage');
    setBusy(false);
    if (ok) props.onClose();
  };
  return (
    <Sheet visible title="Add a note" sub="On the whole passage. It follows the passage into reviews and later versions." onClose={props.onClose}
      footer={<PrimaryBtn label="Add note" disabled={!text.trim() && !hash} busy={busy} onPress={() => void save()} />}>
      <VoiceNote ctx={ctx} unitId={v.unitId} laneId={v.laneId} label="Say it" hash={hash} onChange={setHash} />
      <Field value={text} onChangeText={setText} placeholder="Or type it" multiline />
    </Sheet>
  );
}

// ---- the hero (REC-1); the path itself is passage/journey.tsx (REC-2) --------------------

function Hero(props: { ctx: Ctx; v: PassageView; mine: MineFn; latest?: { text: EntryText; hlc: string } }) {
  const { ctx, v } = props;
  const { p, kinds } = v;
  const tone = p.done ? C.green : p.awaitingResponse.length ? C.amber : C.primary;
  const cleared = p.steps.filter((st) => st.complete).length;
  return (
    <View style={{ gap: space.xs, marginBottom: space.sm }}>
      <View style={styles.rowCenter}>
        <View style={[styles.toneDot, { backgroundColor: tone }]} />
        <Text style={[txt.body, { fontWeight: '700', flex: 1 }]} accessibilityRole="header">
          {heroHeadline(p, kinds, ctx.session.actorId, ctx.name, props.mine)}
        </Text>
        {p.recorded && p.steps.length > 0 ? <Text style={txt.xsStrong}>{cleared} of {p.steps.length} done</Text> : null}
      </View>
      {props.latest ? (
        <Text style={txt.xs} numberOfLines={2}>
          Latest: {props.latest.text.title} · {props.latest.text.who} · {when(props.latest.hlc)}
        </Text>
      ) : null}
      {p.done && p.steps.length === 0 ? (
        <Text style={txt.xs}>This language collects recordings without reviews — recorded is done.</Text>
      ) : null}
    </View>
  );
}

// ---- the next step, in place on the path (REC-4, REC-6, REC-7; ADR-029) ------------------

function NextCard(props: {
  ctx: Ctx;
  v: PassageView;
  can: RecordCan;
  study: StudyProgress | null;
  feedbackNames: string;
  kindRow: (k: KindStatus, step: FlowStepStatus, first: boolean, compact: boolean) => ReactNode;
  onRecord: () => void;
  onStudy: () => void;
  onAskRecord: () => void;
}) {
  const { ctx, v, can, study } = props;
  const { p, kinds } = v;
  const me = ctx.session.actorId;

  if (!p.recorded) {
    const recordAsk = p.openRequests.find((r) => r.what === 'record');
    // Studying first is advice (ADR-018): recording stays one tap away, and nothing waits on the study.
    const studyFirst = !!study?.next && (can.record || can.log) && !p.drafting;
    const draftTakes = p.draftTakeId ? v.state.takes[p.draftTakeId]?.cardHashes.length ?? 0 : 0;
    return (
      <Card style={{ backgroundColor: C.light, borderColor: C.light }}>
        <View style={{ gap: 4 }}>
          <Text style={[txt.sm, { fontWeight: '700' }]}>
            {recordAsk
              ? `${recordAsk.by ? ctx.name(recordAsk.by) : 'Someone'} asked ${recordAsk.profileId ? ctx.name(recordAsk.profileId, true) : 'someone'} to record this`
              : 'Nobody has recorded this yet'}
          </Text>
          <Text style={txt.xs}>
            {p.drafting
              ? `${plural(draftTakes, 'take')} recorded, not saved as a version yet.`
              : 'Anyone who can record can start — no assignment needed.'}
            {recordAsk?.dueDate ? ` ${dueText(recordAsk.dueDate).replace(/^./, (c) => c.toUpperCase())}.` : ''}
          </Text>
        </View>
        {studyFirst && study ? (
          <View style={styles.innerCard}>
            <Ico name="sparkle" size={20} color={C.primary} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[txt.sm, { fontWeight: '700' }]}>
                {study.doneCount
                  ? `Study it first · ${study.doneCount} of ${study.steps.length} ${study.guide.pattern} steps done`
                  : `Study it first · ${study.steps.length} ${study.guide.pattern} steps`}
              </Text>
              <Text style={[txt.xs, { marginTop: 2 }]}>Next: {study.next?.step.title}. Your team's answers stay with the passage for reviewers.</Text>
            </View>
          </View>
        ) : null}
        {study && !study.next ? (
          <Pressable onPress={props.onStudy} accessibilityRole="button" style={({ pressed }) => [styles.innerCard, pressed && { opacity: 0.7 }]}>
            <Ico name="check" size={18} color={TINT.greenText} />
            <Text style={[txt.sm, { fontWeight: '700', color: TINT.greenText, flex: 1 }]}>{study.guide.pattern} study done · all {study.steps.length} steps</Text>
          </Pressable>
        ) : null}
        <View style={styles.btnRow}>
          {studyFirst && study ? (
            <View style={{ flex: 1 }}>
              <SmallBtn tone="primary" label={study.doneCount || study.noteCount ? 'Continue the study' : 'Start the study'} onPress={props.onStudy} />
            </View>
          ) : null}
          {can.record ? (
            <View style={{ flex: 1 }}>
              <SmallBtn tone={studyFirst ? 'plain' : 'primary'} icon="mic" label={p.drafting ? 'Continue' : 'Record it'} onPress={props.onRecord} />
            </View>
          ) : null}
          {can.ask && !recordAsk && !studyFirst ? (
            <View style={{ flex: 1 }}><SmallBtn tone="plain" label="Ask someone" onPress={props.onAskRecord} /></View>
          ) : null}
        </View>
        {can.ask && !recordAsk && studyFirst ? <LinkBtn label="Ask someone to record it" onPress={props.onAskRecord} style={{ alignSelf: 'center' }} /> : null}
      </Card>
    );
  }

  // Done: the path's Done stop and the footer say it.
  if (p.done) return null;

  const next = p.next;
  // Feedback waiting on an answer shows above, in the same step; it isn't also a "next step".
  const rows = next?.kinds.filter((k) => k.state !== 'suggestions') ?? [];
  if (!next || rows.length === 0) return null;

  // Open feedback may change the recording, so the rest is best after its
  // answer; the step's options still offer everything (ADR-014).
  if (props.feedbackNames) {
    const later = rows.filter((k) => !isCompleteState(k.state));
    if (later.length === 0) return null;
    const author = p.latest?.by;
    const asked = later.filter((k) => k.state === 'asked' && k.request);
    const askedNames = asked.map((k) => (k.request?.profileId ? ctx.name(k.request.profileId) : k.request?.guest?.name ?? 'Someone'));
    return (
      <Card style={styles.dashedCard}>
        <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
          <Ico name="clock" size={18} color={C.muted} />
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text style={[txt.sm, { fontWeight: '700' }]}>Then: {later.map((k) => v.kind(k.kindId).name).join(' and ')}</Text>
            <Text style={txt.xs}>
              After {author === me ? 'you answer' : `${author ? ctx.name(author, true) : 'the translator'} answers`} the {props.feedbackNames} feedback, so it's done on the version you keep.
              {asked.length > 0 ? ` ${askedNames.join(' and ')} ${asked.length === 1 && asked[0]?.request?.profileId !== me ? 'was' : 'were'} already asked.` : ''}
              {' '}To start anyway, use Options for this step.
            </Text>
          </View>
        </View>
      </Card>
    );
  }

  const waitingOn = p.steps.filter((st) => st.lockedBy).map((st) => stepName(kinds, st.step));
  return (
    <View style={styles.inlineNext}>
      {next.step.checkpoint && waitingOn.length > 0 ? (
        <Text style={[txt.xs, { paddingHorizontal: space.lg, paddingBottom: space.sm }]}>
          {waitingOn.join(', ')} {waitingOn.length === 1 ? 'starts' : 'start'} once this says Looks good.
        </Text>
      ) : null}
      {rows.map((k) => props.kindRow(k, next, false, true))}
    </View>
  );
}

/**
 * One kind of review on a step: its state, who, and its actions (REC-3). In
 * the step sheet every action shows; on the path (`compact`) only the main
 * button, and More opens the step sheet with the rest (ADR-029).
 */
function KindActionRow(props: {
  ctx: Ctx;
  v: PassageView;
  status: KindStatus;
  step: FlowStepStatus;
  can: RecordCan;
  isAuthor: boolean;
  waitFor?: string;
  first: boolean;
  compact: boolean;
  mine: MineFn;
  teamName: (teamId: string) => string | undefined;
  /** Who this kind usually goes to, as its button says it ("the Community team"). */
  sendTo?: string;
  onAction: (a: RowAction, k: KindStatus, step: FlowStepStatus, askedMe: boolean) => void;
  onMore: () => void;
}) {
  const { ctx, v, status, step } = props;
  const kind = v.kind(status.kindId);
  const me = ctx.session.actorId;
  const checkedBy = kind.produces ? v.kind(kind.produces.checkedBy).name : undefined;
  const acts = kindRowActions({ status, kind, step, can: props.can, isAuthor: props.isAuthor, me, mine: props.mine, ...(props.sendTo ? { sendTo: props.sendTo } : {}) });
  const sub = kindRowSub({
    status, kind, step, me, name: ctx.name, mine: props.mine, teamName: props.teamName,
    ...(checkedBy ? { checkedBy } : {}), ...(props.waitFor ? { waitFor: props.waitFor } : {})
  });
  const btn = (a: RowAction, tone: 'primary' | 'plain') => (
    <SmallBtn label={a.label} tone={tone} onPress={() => props.onAction(a, status, step, acts.askedMe)} />
  );
  const others = (acts.second ? 1 : 0) + acts.rest.length;
  return (
    <View style={[styles.kindRow, !props.first && styles.topBorder]}>
      <View style={styles.rowCenter}>
        <KindIcon kindId={status.kindId} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[txt.sm, { fontWeight: '700' }]}>{kind.name}</Text>
          {sub ? <Text style={[txt.xs, { marginTop: 2 }]}>{sub}</Text> : null}
        </View>
        <View accessibilityLabel={KIND_STATE_LABEL[status.state]}><StateMark state={status.state} size={22} /></View>
      </View>
      {acts.actionable && props.compact && (acts.primary || others > 0) ? (
        <View style={styles.btnRow}>
          {acts.primary ? <View style={{ flex: 1 }}>{btn(acts.primary, props.waitFor ? 'plain' : 'primary')}</View> : null}
          {others > 0 ? (
            <View style={acts.primary ? undefined : { flex: 1 }}>
              <SmallBtn label={acts.primary ? 'More' : 'Options'} onPress={props.onMore} />
            </View>
          ) : null}
        </View>
      ) : null}
      {acts.actionable && !props.compact && (acts.primary || acts.second || acts.rest.length) ? (
        <View style={{ gap: space.sm }}>
          {acts.primary || acts.second ? (
            <View style={styles.btnRow}>
              {acts.primary ? <View style={{ flex: 1 }}>{btn(acts.primary, props.waitFor ? 'plain' : 'primary')}</View> : null}
              {acts.second ? <View style={{ flex: 1 }}>{btn(acts.second, 'plain')}</View> : null}
            </View>
          ) : null}
          {acts.rest.length ? (
            <View style={[styles.btnRow, { flexWrap: 'wrap' }]}>
              {acts.rest.map((a) => <View key={a.id} style={{ flexGrow: 1, flexBasis: '45%' }}>{btn(a, 'plain')}</View>)}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Feedback on the latest version, shown only to its author: record a fix, or keep it and say why (REC-5). */
function FeedbackToAnswer(props: { ctx: Ctx; v: PassageView; review: ReviewView; onOpen: () => void; onRevise: () => void; onKeep: () => void }) {
  const { ctx, v, review } = props;
  const look = usePerson();
  const source = feedbackSource(review, ctx.name);
  const group = review.via === 'logged' && !review.givenBy && (review.people ?? 0) > 1;
  const fromPerson = review.via !== 'logged';
  return (
    <Card style={{ borderColor: C.amber, borderWidth: 1.5 }}>
      <Label text={`${v.kind(review.kindId).name} asked for changes`} color={TINT.amberText} />
      <Pressable onPress={props.onOpen} accessibilityRole="button" accessibilityLabel={`Feedback from ${source}. Open it`}
        style={({ pressed }) => [{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }, pressed && { opacity: 0.7 }]}>
        {fromPerson ? <PersonAvatar look={look(review.by)} size={34} /> : (
          <View style={[styles.roundTile, { backgroundColor: TINT.amber }]}><Ico name={group ? 'people' : 'user'} size={18} color={TINT.amberText} /></View>
        )}
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text style={[txt.sm, { fontWeight: '700' }]}>{source}</Text>
          {review.comment ? <Text style={txt.sm} numberOfLines={3}>{authoredText(ctx, review.by, review.comment)}</Text> : null}
          {review.via === 'logged' ? <Text style={txt.xs}>Logged by {ctx.name(review.by, true)} · {when(review.hlc)}</Text> : null}
        </View>
        <Ico name="right" size={18} color={C.muted} />
      </Pressable>
      {review.commentBlobHash ? <PlayRow ctx={ctx} hashes={[review.commentBlobHash]} label="Voice feedback" /> : null}
      <Text style={txt.xs}>Record a fix to answer it, or keep this version and say why.</Text>
      <View style={styles.btnRow}>
        <View style={{ flex: 1 }}><SmallBtn label="Keep it, say why" onPress={props.onKeep} /></View>
        <View style={{ flex: 1 }}><SmallBtn label="Record a fix" icon="mic" tone="primary" onPress={props.onRevise} /></View>
      </View>
    </Card>
  );
}

/** The same feedback as everyone else sees it: whose answer it waits on. */
function WaitingOnAnswer(props: { ctx: Ctx; v: PassageView; review: ReviewView; onOpen: () => void }) {
  const { ctx, v, review: r } = props;
  const author = v.p.latest ? ctx.name(v.p.latest.by, true) : 'the translator';
  return (
    <Card onPress={props.onOpen} style={styles.amberCard} accessibilityLabel={`Waiting on ${author}. Open the feedback`}>
      <View style={styles.rowCenter}>
        <Ico name="clock" size={20} color={TINT.amberText} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[txt.sm, { fontWeight: '700', color: TINT.amberText }]}>
            Waiting on {author} to answer the {v.kind(r.kindId).name}
          </Text>
          <Text style={[txt.xs, { color: TINT.amberText, marginTop: 2 }]} numberOfLines={2}>
            {feedbackSource(r, ctx.name)} asked for changes{r.comment ? `: ${authoredText(ctx, r.by, r.comment)}` : '.'}
          </Text>
        </View>
        <Ico name="right" size={18} color={TINT.amberText} />
      </View>
    </Card>
  );
}

// ---- details (REC-8) ---------------------------------------------------------------

function StudyRows(props: { ctx: Ctx; study: StudyProgress; onOpen: (stepId: string) => void }) {
  return (
    <>
      {props.study.steps.map((st) => (
        <Row key={st.step.id} leading={<StepMark status={st} />} label={st.step.title} sub={stepLine(props.ctx, st)} onPress={() => props.onOpen(st.step.id)} />
      ))}
    </>
  );
}

/** Versions (rows, newest first) against kinds (columns): which versions have had which reviews. */
function ReviewGrid(props: { ctx: Ctx; v: PassageView; kindIds: string[]; onVersion: (takeId: string) => void; onReview: (reviewId: string) => void }) {
  const { v, kindIds } = props;
  const [shown, setShown] = useState(GRID_STEP);
  const rows = reviewGrid(v.p, kindIds);
  const kinds = v.p.steps.flatMap((st) => st.kinds);
  const skipped = new Set(kinds.filter((k) => k.state === 'skipped').map((k) => k.kindId));
  const asked = new Set(kinds.filter((k) => k.state === 'asked').map((k) => k.kindId));
  const producing = kindIds.map((id) => v.kind(id)).filter((k) => k.produces);
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ flexGrow: 1 }}>
          <View style={[styles.gridRow, { paddingTop: space.md, paddingBottom: space.sm }]}>
            <View style={{ width: 76 }} />
            {kindIds.map((id) => (
              <View key={id} style={styles.gridCol}>
                <Ico name={kindIcon(id)} size={16} color={C.muted} />
                <Text style={[txt.xs, { fontWeight: '600', textAlign: 'center' }]} numberOfLines={1}>{v.kind(id).name.split(' ')[0]}</Text>
              </View>
            ))}
          </View>
          {rows.slice(0, shown).map((row, ri) => (
            <View key={row.version.takeId} style={[styles.gridRow, styles.topBorder]}>
              <Pressable onPress={() => props.onVersion(row.version.takeId)} accessibilityRole="button" accessibilityLabel={`Open ${versionTitle(row.version.n)}`}
                style={({ pressed }) => [styles.gridVersion, pressed && { opacity: 0.6 }]}>
                <Text style={[txt.sm, { fontWeight: '700', color: C.primary }]}>v{row.version.n}</Text>
                <Text style={txt.xs} numberOfLines={1}>{when(row.version.hlc)}</Text>
              </Pressable>
              {row.cells.map((cell) => {
                const r = cell.reviews.at(-1);
                const kind = v.kind(cell.kindId);
                return (
                  <View key={cell.kindId} style={styles.gridCol}>
                    {r ? (
                      <Pressable onPress={() => props.onReview(r.id)} accessibilityRole="button"
                        accessibilityLabel={`${kind.name} from ${feedbackSource(r, props.ctx.name)}${cell.reviews.length > 1 ? ` (latest of ${cell.reviews.length})` : ''}`}
                        style={({ pressed }) => [styles.gridCell, pressed && { opacity: 0.6 }]}>
                        {kind.produces
                          // Made content, not a verdict: its own mark, never a "looks good" tick.
                          ? <View style={[styles.producedMark]}><Ico name={kindIcon(cell.kindId)} size={14} color={C.primary} /></View>
                          : <StateMark state={reviewMark(r)} size={24} />}
                        {cell.reviews.length > 1 ? <View style={styles.countBadge}><Text style={[txt.xsStrong, { color: C.white }]}>{cell.reviews.length}</Text></View> : null}
                      </Pressable>
                    ) : ri === 0 && skipped.has(cell.kindId) ? <StateMark state="skipped" size={24} />
                      : ri === 0 && asked.has(cell.kindId) ? <StateMark state="asked" size={24} />
                      : <View style={styles.gridEmpty} />}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
      {rows.length > shown ? (
        <View style={{ padding: space.md }}>
          <ShowMore remaining={rows.length - shown} step={GRID_STEP} onMore={() => setShown((n) => n + GRID_STEP)} />
        </View>
      ) : null}
      <View style={styles.legend}>
        {(['approved', 'suggestions', 'addressed', 'asked', 'skipped'] as KindState[]).map((st) => (
          <View key={st} style={[styles.rowCenter, { gap: 4 }]}>
            <StateMark state={st} size={14} />
            <Text style={txt.xs}>{KIND_STATE_LABEL[st]}</Text>
          </View>
        ))}
        {producing.map((k) => (
          <View key={k.id} style={[styles.rowCenter, { gap: 4 }]}>
            <Ico name={kindIcon(k.id)} size={14} color={C.primary} />
            <Text style={txt.xs}>{k.name} recorded</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** One entry of the passage's history: who and when first, so a long reason never hides them. */
function HistoryRow(props: { text: EntryText; when: string; last: boolean; trailing: ReactNode; onPress?: () => void }) {
  const { text } = props;
  return (
    <Row label={text.title} sub={`${text.who} · ${props.when}${text.sub ? ` — ${text.sub}` : ''}`} last={props.last}
      leading={(
        <View style={[styles.historyIcon, { backgroundColor: withAlpha(text.color, 0.1) }]}>
          <Ico name={text.icon} size={16} color={text.color} />
        </View>
      )}
      {...(props.trailing ? { right: props.trailing } : {})} {...(props.onPress ? { onPress: props.onPress } : {})} />
  );
}

// ---- version_detail (REC-9) --------------------------------------------------------------

/** One version: what changed and why, its takes, the key terms tied to it, its reviews and notes. */
export function VersionDetail(ctx: Ctx) {
  const v = usePassage(ctx);
  const guide = useStudyGuide(ctx, v?.unitId, v?.laneId);
  if (!v) return <Missing ctx={ctx} id="version_detail" />;
  const { p, unitId, laneId } = v;
  const version = p.versions.find((x) => x.takeId === ctx.params['takeId']) ?? p.latest;
  if (!version) return <Missing ctx={ctx} id="version_detail" crumbsOf={v} text="Nothing recorded for this passage yet." />;
  const title = versionTitle(version.n);
  const reviews = p.reviews.filter((r) => r.versionN === version.n);
  const prompted = p.reviews.filter((r) => r.response?.revisedTakeId === version.takeId);
  const terms = keyTermLinksFor(v.state, version.takeId);
  const notes = p.notes.filter((n) => n.anchor.kind !== 'study' && (n.onTakeId === version.takeId || (n.anchor.kind === 'version' && n.anchor.takeId === version.takeId)));
  const key = (part: string) => `version:${unitId}:${laneId}:${version.takeId}:${part}`;
  const params = { unitId, laneId };
  return (
    <Screen header={<Header title={title} crumbs={passageCrumbs(ctx, v, title)} sub={`${ctx.name(version.by)} · ${when(version.hlc)}`} onBack={ctx.back}
      action={<ReportFlag ctx={ctx} target={recordTarget(ctx, 'version', version.takeId, version.by, unitId, laneId)} />} />}>
      <Card>
        <Label text={version.n === 1 ? 'Note' : 'What changed'} />
        <Authored ctx={ctx} by={version.by}>
          <Text style={txt.body}>{version.changeNote ?? (version.n === 1 ? 'First recording.' : 'No note on what changed.')}</Text>
          {version.changeBlobHash ? <PlayRow ctx={ctx} hashes={[version.changeBlobHash]} label="What changed, said aloud" /> : null}
        </Authored>
        {prompted.map((r) => (
          <Pressable key={r.id} onPress={() => ctx.go('review_detail', { ...params, reviewId: r.id })} accessibilityRole="link"
            style={({ pressed }) => [styles.inlineLink, pressed && { opacity: 0.6 }]}>
            <Ico name="chat" size={16} color={C.primary} />
            <Text style={[txt.link, { flex: 1 }]}>In response to the {v.kind(r.kindId).name} from {feedbackSource(r, ctx.name)}</Text>
          </Pressable>
        ))}
      </Card>

      <SectionLabel label="Recording" />
      <Authored ctx={ctx} by={version.by}>
        <Card>
          <PlayRow ctx={ctx} hashes={version.cardHashes} label={`Play ${title}`} sub={plural(version.cardHashes.length, 'take')} />
          {version.cardHashes.length > 1 ? version.cardHashes.map((h, i) => (
            <PlayRow key={`${h}-${i}`} ctx={ctx} hashes={[h]} label={`Take ${i + 1}`} />
          )) : null}
        </Card>
      </Authored>
      <UsedLine ctx={ctx} state={v.state} subject={{ takeId: version.takeId }} detailsKey={key('used')} />

      {terms.length > 0 || reviews.length > 0 || notes.length > 0 ? <SectionLabel label="Details" /> : null}
      {terms.length > 0 ? (
        <Disclosure icon="book" title="Key terms"
          summary={`${plural(terms.length, 'term')} tied · ${terms.slice(0, 2).map((t) => t.term.term).join(', ')}${terms.length > 2 ? '…' : ''}`}
          {...ctx.details(key('terms'))}>
          {terms.map(({ term, note }, i) => {
            const rendering = term.renderings[0]?.rendering;
            return (
              <Row key={term.termId} icon="book" label={`${term.term}${rendering ? ` · ${rendering}` : ''}`} {...(note ? { sub: note } : {})}
                onPress={() => ctx.go('key_term_detail', { ...params, termId: term.termId })} last={i === terms.length - 1} />
            );
          })}
        </Disclosure>
      ) : null}
      {reviews.length > 0 ? (
        <Disclosure icon="chat" title="Reviews of this version" summary={versionReviewsSummary(reviews, v.kinds)} {...ctx.details(key('reviews'))}>
          {reviews.map((r, i) => {
            const kind = v.kind(r.kindId);
            return (
              <Row key={r.id} leading={kind.produces ? <KindIcon kindId={r.kindId} size={36} /> : <StateMark state={reviewMark(r)} size={24} />}
                label={`${kind.name} · ${outcomeText(kind, r.outcome)}`} sub={`${feedbackSource(r, ctx.name)} · ${when(r.hlc)} · ${viaText(r, ctx.name)}`}
                onPress={() => ctx.go('review_detail', { ...params, reviewId: r.id })} last={i === reviews.length - 1} />
            );
          })}
        </Disclosure>
      ) : (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>No reviews of this version yet.</Text>
      )}
      {notes.length > 0 ? (
        <Disclosure icon="note" title="Notes" summary={`${plural(notes.length, 'note')} · ${authoredText(ctx, notes[0]?.by, notes[0]?.text ?? 'Voice note')}`} {...ctx.details(key('notes'))}>
          <View style={{ padding: space.md, gap: space.sm }}>
            {notes.map((n) => (
              <Authored key={n.id} ctx={ctx} by={n.by}>
                <NoteCard anchor={anchorLabel(n, { state: v.state, p, guide })} by={ctx.name(n.by)} when={when(n.hlc)}
                  {...(n.text ? { text: n.text } : {})}
                  {...(n.blobHash ? { audio: <PlayRow ctx={ctx} hashes={[n.blobHash]} label="Voice note" /> } : {})}
                  action={<ReportFlag ctx={ctx} target={recordTarget(ctx, 'note', n.id, n.by, unitId, laneId)} size={36} />} />
              </Authored>
            ))}
          </View>
        </Disclosure>
      ) : null}
    </Screen>
  );
}

// ---- review_detail (REC-10) --------------------------------------------------------------

/** One review: outcome and source, feedback, answers, what it captured, and the response. The author can answer it here. */
export function ReviewDetail(ctx: Ctx) {
  const v = usePassage(ctx);
  const [keeping, setKeeping] = useState(false);
  if (!v) return <Missing ctx={ctx} id="review_detail" />;
  const { p, unitId, laneId } = v;
  const review = p.reviews.find((r) => r.id === ctx.params['reviewId']) ?? p.reviews.at(-1);
  if (!review) return <Missing ctx={ctx} id="review_detail" crumbsOf={v} text="No reviews on this passage yet." />;
  const me = ctx.session.actorId;
  const params = { unitId, laneId };
  const kind = v.kind(review.kindId);
  const makes = kind.produces;
  const checkedBy = makes ? v.kind(makes.checkedBy).name : undefined;
  const good = review.outcome !== 'needs_changes';
  const request = review.requestId ? p.requests.find((r) => r.id === review.requestId) : undefined;
  const questions = questionsForKind(v.state, review.kindId, laneId, request);
  const answers = answeredQuestions(questions, review.answers);
  const skipped = Object.entries(review.skipped ?? {});
  const source = feedbackSource(review, ctx.name);
  const version = p.versions[review.versionN - 1];
  const tint = makes ? { bg: C.light, fg: C.primary } : good ? { bg: TINT.green, fg: TINT.greenText } : { bg: TINT.amber, fg: TINT.amberText };
  const answerable = ctx.session.can('translate') && canGo(ctx, 'review_detail', 'workspace') && review.outcome === 'needs_changes'
    && !review.response && review.versionN === p.latest?.n && p.latest?.by === me;
  const artifacts = review.artifacts && review.artifacts.length > 0 ? (
    <Card>
      <Text style={[txt.sm, { fontWeight: '700' }]}>{makes ? `The ${makes.what} (${makes.into})` : 'What was captured'}</Text>
      <PlayRow ctx={ctx} hashes={review.artifacts.map((c) => c.hash)} label={makes ? `Play the ${makes.what}` : 'Play the recording'} sub={plural(review.artifacts.length, 'part')} />
    </Card>
  ) : null;
  const outcome = makes ? `${makes.what.charAt(0).toUpperCase()}${makes.what.slice(1)} recorded` : good ? 'Looks good' : 'Needs changes';

  return (
    <Screen header={<Header title={kind.name} crumbs={passageCrumbs(ctx, v, kind.name)} sub={when(review.hlc)} onBack={ctx.back}
      action={<ReportFlag ctx={ctx} target={recordTarget(ctx, 'review', review.id, review.by, unitId, laneId)} />} />}
      footer={answerable ? (
        <View style={styles.btnRow}>
          <View style={{ width: '44%' }}><GhostBtn label="Keep it" onPress={() => setKeeping(true)} /></View>
          <View style={{ flex: 1 }}><PrimaryBtn label="Record a fix" icon="mic" onPress={() => ctx.go('workspace', { ...params, reviewId: review.id })} /></View>
        </View>
      ) : undefined}>
      <View style={[styles.outcome, { backgroundColor: tint.bg }]}>
        <View style={[styles.roundTile, { backgroundColor: C.card, width: 44, height: 44, borderRadius: 22 }]}>
          <Ico name={makes ? kindIcon(review.kindId) : good ? 'check' : 'chat'} size={22} color={tint.fg} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[txt.body, { fontWeight: '700', color: tint.fg }]}>{outcome}</Text>
          <Text style={[txt.xs, { color: tint.fg, marginTop: 2 }]}>{source} · {viaText(review, ctx.name)}</Text>
        </View>
      </View>
      {makes ? (
        <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>
          New content made from the version, not a verdict on it.{checkedBy ? ` The ${checkedBy} compares it with the source.` : ''}
        </Text>
      ) : null}
      {makes && artifacts ? <Authored ctx={ctx} by={review.by}>{artifacts}</Authored> : null}
      {review.people || review.place || request ? (
        <View style={styles.badges}>
          {review.people ? <Badge label={`${review.people} people`} /> : null}
          {review.place ? <Badge label={review.place} /> : null}
          {request ? <Badge tone="brand" label={`Asked by ${request.by ? ctx.name(request.by, true) : 'someone'}`} /> : null}
        </View>
      ) : null}
      {version ? (
        <Group>
          <Row icon="mic" label={`${makes ? 'Made from' : 'Reviewed'} ${versionTitle(version.n)}`} sub={`${ctx.name(version.by)} · ${when(version.hlc)}`}
            onPress={() => ctx.go('version_detail', { ...params, takeId: version.takeId })} last />
        </Group>
      ) : null}
      <UsedLine ctx={ctx} state={v.state} subject={{ reviewId: review.id }} detailsKey={`review:${unitId}:${laneId}:${review.id}:used`} />
      {review.comment || review.commentBlobHash ? (
        <Card>
          <Label text={makes ? 'Note from the back translator' : 'Feedback'} />
          <Authored ctx={ctx} by={review.by}>
            {review.commentBlobHash ? <PlayRow ctx={ctx} hashes={[review.commentBlobHash]} label="Voice feedback" /> : null}
            {review.comment ? <Text style={txt.body}>{review.comment}</Text> : null}
          </Authored>
        </Card>
      ) : null}
      {!makes && artifacts ? <Authored ctx={ctx} by={review.by}>{artifacts}</Authored> : null}
      {answers.length > 0 || skipped.length > 0 ? (
        <Disclosure icon="help" title="Answers to the questions"
          summary={`${plural(answers.length, 'answer')}${skipped.length ? ` · ${skipped.length} left unanswered` : ''}`}
          {...ctx.details(`review:${unitId}:${laneId}:${review.id}:questions`)}>
          <Authored ctx={ctx} by={review.by}>
            {answers.map((a, i) => (
              <View key={a.id} style={[styles.answer, i > 0 && styles.topBorder]}>
                {a.source ? <Label text={a.source} /> : null}
                <Text style={txt.xs}>{a.label}</Text>
                <Text style={[txt.body, { fontWeight: '700' }]}>{a.answer}</Text>
              </View>
            ))}
            {skipped.map(([qid, reason], i) => (
              <View key={qid} style={[styles.answer, (answers.length > 0 || i > 0) && styles.topBorder]}>
                <Text style={txt.xs}>{questions.find((q) => q.q.id === qid)?.q.text ?? 'Question'}</Text>
                <Text style={txt.sm}><Text style={{ fontWeight: '700', color: C.muted }}>Left unanswered: </Text>{reason}</Text>
              </View>
            ))}
          </Authored>
        </Disclosure>
      ) : null}
      {review.response ? (
        <Card style={{ backgroundColor: C.light, borderColor: C.light }}>
          <Label color={C.primary} text={`${ctx.name(review.response.by)} ${review.response.decision === 'revised' ? 'revised it' : 'kept it'} · ${when(review.response.hlc)}`} />
          <Authored ctx={ctx} by={review.response.by}>
            {review.response.note ? <Text style={txt.body}>{review.response.note}</Text> : null}
            {review.response.blobHash ? <PlayRow ctx={ctx} hashes={[review.response.blobHash]} label="Their answer, said aloud" /> : null}
          </Authored>
          {review.response.revisedTakeId ? (() => {
            const revised = p.versions.find((x) => x.takeId === review.response?.revisedTakeId);
            return revised ? (
              <LinkBtn label={`Open ${versionTitle(revised.n)}`} onPress={() => ctx.go('version_detail', { ...params, takeId: revised.takeId })} />
            ) : null;
          })() : null}
        </Card>
      ) : null}
      {keeping ? <KeepSheet ctx={ctx} v={v} reviewId={review.id} onClose={() => setKeeping(false)} /> : null}
    </Screen>
  );
}

// ---- ask_someone (ASK-1..5) --------------------------------------------------------------

/**
 * A request is a record of asking (ADR-007, ADR-020): who, for what, by
 * when. It asks for exactly what its button belonged to (params `what` and
 * `kindId`); another kind is asked for from its own step.
 */
export function AskSomeone(ctx: Ctx) {
  const v = usePassage(ctx);
  const what: 'record' | 'review' = ctx.params['what'] === 'record' ? 'record' : 'review';
  const kindId = what === 'review' ? ctx.params['kindId'] : undefined;
  const me = ctx.session.actorId;
  const look = usePerson();
  const [mode, setMode] = useState<'team' | 'outside'>('team');
  const [who, setWho] = useState<string | null>(null);
  const [guestName, setGuestName] = useState('');
  const [contact, setContact] = useState('');
  const [channel, setChannel] = useState<'whatsapp' | 'sms'>('whatsapp');
  const [note, setNote] = useState('');
  const [noteHash, setNoteHash] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuestionSpec[]>([]);
  const [qDraft, setQDraft] = useState('');
  const [qType, setQType] = useState<QuestionSpec['type']>('yesno');
  const [today] = useState(() => isoDay(new Date()));
  const [dueDays, setDueDays] = useState<number | null>(null);
  const [dueTyped, setDueTyped] = useState('');
  const [othersShown, setOthersShown] = useState(PEOPLE_STEP);
  const [busy, setBusy] = useState(false);
  const candidates = useMemo(() => (v ? askCandidates(v.state, ctx.org.state, { projectId: ctx.project.projectId, laneId: v.laneId, what, ...(kindId ? { kindId } : {}), me }) : []),
    [v?.state, v?.laneId, ctx.org.state, ctx.project.projectId, what, kindId, me]);
  if (!v) return <Missing ctx={ctx} id="ask_someone" />;
  if (what === 'review' && !kindId) {
    return <Missing ctx={ctx} id="ask_someone" crumbsOf={v} text="Ask for a review from its step on the passage record." />;
  }

  const kind = kindId ? v.kind(kindId) : undefined;
  const isRecord = what === 'record';
  const title = isRecord ? (v.p.recorded ? 'Ask for a new version' : 'Ask someone to record') : `Ask for ${kind?.name ?? 'a review'}`;
  const byName = (a: { profileId: string }, b: { profileId: string }) => ctx.name(a.profileId).localeCompare(ctx.name(b.profileId));
  const usual = candidates.filter((c) => c.usual).sort(byName);
  const others = candidates.filter((c) => !c.usual).sort(byName);
  const existingQuestions = kindId ? questionsForKind(v.state, kindId, v.laneId).length : 0;
  const dueErr = dueError(dueTyped, today);
  const due = dueTyped.trim() ? (dueErr ? null : dueTyped.trim()) : dueDays === null ? null : addDays(today, dueDays);
  const outside = mode === 'outside' && !isRecord;
  const target = outside ? guestName.trim() : who ? ctx.name(who) : '';
  const ready = !!target && (!outside || contact.trim().length > 3) && !dueErr;

  const send = async () => {
    if (!ready) return;
    setBusy(true);
    const ok = await perform(ctx, (c) => c.ask({
      commandId: newId(), unitId: v.unitId, laneId: v.laneId, what,
      ...(kindId ? { kindId } : {}),
      ...(outside ? { guest: { name: guestName.trim(), channel, contact: contact.trim() } } : who ? { profileId: who } : {}),
      ...(due ? { dueDate: due } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(noteHash ? { noteBlobHash: noteHash } : {}),
      ...(!isRecord && questions.length ? { questions } : {})
    }), outside ? `Asked ${target} · the request is on the record` : `${target} will see it on their My Work`,
    (applied) => (c) => c.withdrawRequest({ commandId: newId(), requestId: payloadField(applied, 'requestId') }));
    setBusy(false);
    if (ok) ctx.go('passage_record', { unitId: v.unitId, laneId: v.laneId });
  };
  const addQuestion = () => {
    const text = qDraft.trim();
    if (!text) return;
    setQuestions((qs) => [...qs, { id: `ask:${newId()}`, text, type: qType }]);
    setQDraft('');
  };
  const personRow = (c: { profileId: string; sub: string }, last: boolean) => {
    const on = who === c.profileId;
    return (
      <Row key={c.profileId} leading={<PersonAvatar look={look(c.profileId)} size={36} />} label={ctx.name(c.profileId)} sub={c.sub}
        onPress={() => setWho(c.profileId)} last={last} role="radio" selected={on}
        right={<View style={[styles.radio, on && { backgroundColor: C.primary, borderColor: C.primary }]}>{on ? <Ico name="check" size={14} color={C.white} strokeWidth={3} /> : null}</View>} />
    );
  };

  return (
    <Screen header={<Header title={title} sub={`${v.title} · ${v.lane}`} onBack={ctx.back} close />}
      footer={<PrimaryBtn label={target ? `Ask ${target.split(' ')[0]}` : 'Choose someone'} disabled={!ready} busy={busy} onPress={() => void send()} />}>
      <Card style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        {kindId ? <KindIcon kindId={kindId} size={44} /> : <View style={[styles.roundTile, { width: 44, height: 44, borderRadius: 14, backgroundColor: C.light }]}><Ico name="mic" size={22} color={C.primary} /></View>}
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text style={txt.h3}>{isRecord ? (v.p.recorded ? 'Record a new version' : 'Record it') : kind?.name}</Text>
          <Text style={txt.xs}>{isRecord ? "They'll find it on their My Work, with the source and the study ready." : kind?.description}</Text>
        </View>
      </Card>

      <SectionLabel label="Who" />
      {!isRecord ? (
        <ChipRow>
          <Chip label="Someone on the team" on={mode === 'team'} onPress={() => setMode('team')} />
          <Chip label="Someone without the app" on={mode === 'outside'} onPress={() => setMode('outside')} />
        </ChipRow>
      ) : null}
      {!outside ? (
        <Group>
          {usual.length > 0 ? <View style={styles.groupHead}><Label text={`Usually does ${kind?.name ?? 'this'}`} color={C.primary} /></View> : null}
          {usual.map((c, i) => personRow(c, i === usual.length - 1 && others.length === 0))}
          {others.length > 0 && usual.length > 0 ? <View style={[styles.groupHead, styles.topBorder]}><Label text="Others who can" /></View> : null}
          {others.slice(0, othersShown).map((c, i) => personRow(c, i === Math.min(others.length, othersShown) - 1))}
          {others.length > othersShown ? (
            <View style={{ padding: space.md }}>
              <ShowMore remaining={others.length - othersShown} step={PEOPLE_STEP} onMore={() => setOthersShown((n) => n + PEOPLE_STEP)} />
            </View>
          ) : null}
          {candidates.length === 0 ? (
            <Text style={[txt.smMuted, { padding: space.lg }]}>
              Nobody on the team can do this.{isRecord ? '' : ' Try someone without the app.'}
            </Text>
          ) : null}
        </Group>
      ) : (
        <View style={{ gap: space.sm }}>
          <Field value={guestName} onChangeText={setGuestName} placeholder="Their name — e.g. Pastor Garang" autoCapitalize="words" />
          <View style={styles.btnRow}>
            <Chip label="WhatsApp" on={channel === 'whatsapp'} onPress={() => setChannel('whatsapp')} />
            <Chip label="SMS" on={channel === 'sms'} onPress={() => setChannel('sms')} />
          </View>
          <Field value={contact} onChangeText={setContact} placeholder="Phone number" keyboardType="phone-pad" />
          <View style={styles.preview}>
            <Label text={`${channelLabel(channel)} preview`} color={TINT.greenText} />
            <Text style={txt.sm}>{guestMessage({ name: guestName, passage: v.title, language: v.lane })}</Text>
            <Text style={[txt.xs, { color: TINT.greenText }]}>
              The request is saved on the record with their name and number. Sending the no-account link from the app is not ready yet.
            </Text>
          </View>
        </View>
      )}

      <SectionLabel label="Directions · optional" />
      <VoiceNote ctx={ctx} unitId={v.unitId} laneId={v.laneId} label={isRecord ? 'Say what to keep in mind' : 'Say what to listen for'} hash={noteHash} onChange={setNoteHash} />
      <Field value={note} onChangeText={setNote} placeholder="Or type them" multiline />

      {!isRecord ? (
        <>
          <SectionLabel label="Your own questions · optional" />
          <Text style={[txt.xs, { paddingHorizontal: space.xs, marginTop: -space.sm }]}>
            Added to the {existingQuestions ? `${plural(existingQuestions, 'question')} ` : ''}{kind?.name} questions your organization and team already ask.
          </Text>
          {questions.length > 0 ? (
            <Group>
              {questions.map((q, i) => (
                <Row key={q.id} label={q.text} sub={QUESTION_TYPE_LABEL[q.type]} last={i === questions.length - 1}
                  right={<IconBtn name="close" label="Remove question" onPress={() => setQuestions((qs) => qs.filter((x) => x.id !== q.id))} bg="transparent" color={C.muted} />} />
              ))}
            </Group>
          ) : null}
          <Field value={qDraft} onChangeText={setQDraft} placeholder="Ask something specific" />
          <View style={styles.btnRow}>
            <View style={{ flex: 1 }}>
              <SmallBtn label={`Answer: ${QUESTION_TYPE_LABEL[qType]}`} onPress={() => setQType(nextQuestionType)} />
            </View>
            <View style={{ flex: 1 }}>
              <SmallBtn label="Add question" icon="plus" tone="primary" disabled={!qDraft.trim()} onPress={addQuestion} />
            </View>
          </View>
        </>
      ) : null}

      <SectionLabel label="By when · optional" />
      <ChipRow>
        {DUE_CHOICES.map((d) => (
          <Chip key={d.label} label={d.label} on={!dueTyped.trim() && dueDays === d.days} onPress={() => { setDueTyped(''); setDueDays(d.days); }} />
        ))}
      </ChipRow>
      <Field value={dueTyped} onChangeText={setDueTyped} placeholder={`Or a date, like ${addDays(today, 10)}`} autoCapitalize="none" />
      {dueErr ? <Text style={[txt.xs, { color: TINT.redText }]}>{dueErr}</Text>
        : due ? <Text style={txt.xs}>{dueText(due).replace(/^./, (c) => c.toUpperCase())}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  btnRow: { flexDirection: 'row', gap: space.sm },
  toneDot: { width: 10, height: 10, borderRadius: 5 },
  body: { padding: space.lg, paddingBottom: space.xxl },
  headerMore: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 48, paddingHorizontal: space.md, borderRadius: radius.full, backgroundColor: C.bg },
  inlineNext: { marginHorizontal: -space.lg, marginBottom: -space.lg, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border, overflow: 'hidden' },
  amberCard: { backgroundColor: TINT.amber, borderColor: TINT.amber },
  dashedCard: { borderStyle: 'dashed', borderWidth: 1.5, shadowOpacity: 0, elevation: 0 },
  innerCard: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: C.card, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.md, minHeight: 48 },
  kindRow: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md, backgroundColor: C.card },
  topBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  roundTile: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  gridRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm },
  gridCol: { flex: 1, minWidth: 56, alignItems: 'center', justifyContent: 'center', gap: 2 },
  gridVersion: { width: 76, minHeight: 48, justifyContent: 'center', paddingHorizontal: 4 },
  gridCell: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  gridEmpty: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.border },
  producedMark: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  countBadge: { position: 'absolute', top: 2, right: 0, minWidth: 20, height: 20, paddingHorizontal: 4, borderRadius: 10, backgroundColor: C.dark, alignItems: 'center', justifyContent: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md, rowGap: 6, padding: space.md, backgroundColor: C.bg, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  historyIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  playRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  inlineLink: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48 },
  outcome: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.xl },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  answer: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: 2 },
  groupHead: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xs },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  preview: { backgroundColor: TINT.green, borderRadius: radius.lg, padding: space.md, gap: 6, borderWidth: 1, borderColor: withAlpha(C.green, 0.2) }
});

export const contracts = contractsFor('passage_record', 'version_detail', 'review_detail', 'ask_someone');
