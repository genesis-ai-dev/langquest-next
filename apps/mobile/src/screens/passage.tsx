// The passage record and what hangs off it. Ports the UX demo's
// `screens/passage.tsx`: PassageRecordScreen (passage_record),
// VersionDetailScreen (version_detail), ReviewDetailScreen (review_detail)
// and AskSomeoneScreen (ask_someone).
// Requirements CORE-1..11, REC-1..10, ASK-1..5; ADR-005, 007, 012, 013, 014,
// 015, 016, 020, 021, 029, 030 (the path top to bottom: passage/journey.tsx).
// Everything shown is derived from the event log
// (core derivePassage and friends); every change is a core command through
// ctx.act, with Undo where the demo offers it.
import { EarlierNote, EarlierSections, isEarlierSection } from '../breakup/earlier';
import {
  CommandError, commands, draftsBy, feedbackIsMine, isCompleteState, keyTermLinksFor, questionsForKind, recordTimeline, reviewGrid,
  type Commands, type EventSpec, type FlowStepStatus, type KindState, type KindStatus, type PassageNote, type QuestionSpec, type ReviewView
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../text';
import { AudioClip } from '../audioClip';
import { commandErrorText, stateLabel, stepName } from '../coreText';
import type { Ctx } from '../ctx';
import { edgeFor, screenTitle, type ScreenId } from '../flow';
import { currentLocale, t, Trans } from '../i18n';
import { indexesFor } from '../indexes';
import {
  Badge, Card, Chip, ChipRow, Disclosure, EmptyState, Field, GhostBtn, Group, Header, Ico, IconBtn, KindIcon, kindIcon, LinkBtn,
  NoteCard, PrimaryBtn, QuietLinks, ReasonSheet, Row, Screen, SectionLabel, Sheet, ShowMore, SmallBtn, StateMark, txt,
  type IconName
} from '../kit';
import {
  addDays, anchorLabel, answeredQuestions, askCandidates, channelLabel, currentStepId, describeEntry, dueChoices, dueError, feedbackNames,
  gridKindIds, guestMessage, heroHeadline, historySummary, isoDay, kindRowActions, kindRowSub, nextQuestionType, questionTypeLabel,
  reviewMark, reviewsSummary, SAID_BY_VOICE, sendTargetLabel, stepSheetSub, versionReviewsSummary, type EntryText, type KindRowCan, type MineFn,
  type RowAction
} from '../passage/record';
import { PassagePath } from '../passage/path';
import { VersionsPage } from '../passage/versions';
import { pathSteps, teamSteps, type PathInput, type PathStep, type TeamStep } from '../passage/pathModel';
import { clipSeconds, clock as clockOf } from '../clipPlayer';
import { useHelpPress } from '../helpContext';
import { requestIsMine, sendToInput, teamNameIn, usualTargetFor, type UsualTarget } from '../passage/sendTarget';
import {
  commaList, dueText, dueTitle, feedbackSource, kindInSentence, outcomeText, passageCrumbs, usePassage, versionTitle, viaText, when, type PassageView
} from '../passageView';
import { PassageOffline, PassageOfflineLine } from '../offline';
import { noteExpected, reportError } from '../report';
import { Authored, authoredText, recordTarget, ReportFlag } from '../reportSheet';
import { UsedLine } from '../sources/used';
import { contractsFor } from '../screenContracts';
import { edgeAllowed } from '../session';
import { useStudyGuide } from '../study/libraryGuides';
import { studyProgress, studySummary, type StudyProgress } from '../study/progress';
import { StepMark, stepLine } from '../study/ui';
import { flat } from '../shadow';
import { C, radius, space, TINT, withAlpha } from '../theme';
import { PersonAvatar, usePerson } from '../UserChip';
import { BigVoice } from '../bigVoice';
import { ClipPlayer } from '../clipPlayer';
import { VoiceNote, voiceFor } from '../voiceNote';

// ---- shared plumbing -----------------------------------------------------------------

/** Quick reasons for setting a step aside; the one picked is the person's reason, in their language. */
function skipReasons(): string[] {
  return [t('passage.page.skipReasons.nobody'), t('passage.page.skipReasons.covered'), t('passage.page.skipReasons.notNeeded')];
}

function overrideReasons(): string[] {
  return [t('passage.page.overrideReasons.visitFar'), t('passage.page.overrideReasons.informal')];
}
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
  const state = ctx.language.state;
  if (!state) return false;
  let specs: EventSpec[];
  try {
    specs = build(commands(state, indexesFor(state)));
  } catch (e) {
    if (e instanceof CommandError) ctx.toast(commandErrorText(e));
    else ctx.toast(t('common.somethingWentWrong', { code: reportError('passage: build command', e) }));
    return false;
  }
  try {
    await ctx.act(specs, message, undo ? () => {
      const now = ctx.language.state ?? state;
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
    <Screen header={<Header title={screenTitle(props.id)} onBack={ctx.back} {...(props.crumbsOf ? { crumbs: passageCrumbs(ctx, props.crumbsOf, screenTitle(props.id)) } : {})} />}>
      <EmptyState icon="book" title={props.text ?? (ctx.language.state ? t('passage.page.notInLanguage') : t('passage.page.loadingLanguage'))} />
    </Screen>
  );
}

function PlayRow(props: { ctx: Ctx; hashes: string[]; label: string; sub?: string }) {
  return (
    <View style={styles.playRow}>
      <AudioClip language={props.ctx.language} hashes={props.hashes} label={props.label} />
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

/**
 * A passage as Ryder drew it (decision 71, demo ADR-033): the recording's own
 * steps numbered top to bottom, the lit one in a card, the team's checks
 * under "Then the team", and one main button for this person's next step.
 * Everything else is one labelled tap away: "Something else?" (a page of the
 * other ways forward) and "Versions and history" (a page of the person's
 * drafts and every published version to work on freely, then the full
 * record, decisions.md 83). With several drafts, Record opens that page to
 * pick one. Publishing comes back here to "Version N published" with the
 * likely next check picked (demo ADR-034).
 */
export function PassageRecord(ctx: Ctx) {
  const v = usePassage(ctx);
  const [openStepId, setOpenStepId] = useState<string | null>(null);
  const [skipping, setSkipping] = useState<{ kindId: string; stepId: string } | null>(null);
  const [overriding, setOverriding] = useState<string | null>(null);
  const [noting, setNoting] = useState<null | 'note' | 'say'>(null);
  // The record's pages: the path, "Something else?", asking for the next check, and every version (decisions.md 83).
  const publishedParam = ctx.params['published'];
  const [page, setPage] = useState<'path' | 'else' | 'ask' | 'versions'>(() => (publishedParam ? 'ask' : 'path'));
  const [askAfterPublish, setAskAfterPublish] = useState(!!publishedParam);
  // Publishing returns to a record that may already be open (the stack pops back to it): open the ask then too.
  useEffect(() => { if (publishedParam) { setPage('ask'); setAskAfterPublish(true); } }, [publishedParam]);
  useEffect(() => {
    if (page === 'path') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setPage('path'); return true; });
    return () => sub.remove();
  }, [page]);
  const [historyShown, setHistoryShown] = useState(HISTORY_STEP);
  const timeline = useMemo(() => (v ? recordTimeline(v.state, v.p) : []), [v?.state, v?.p]);
  const guide = useStudyGuide(ctx, v?.unitId);
  const study = useMemo(() => (v && guide ? studyProgress(v.state, v.p, guide) : null), [v?.state, v?.p, guide]);
  const me = ctx.session.actorId;
  const isAuthor = !!v?.p.latest && v.p.latest.by === me;
  // Whoever just published (a version, or a back translation) asks for the next check (demo ADR-034).
  const asker = isAuthor || !!publishedParam?.startsWith('bt');
  // Where each of the flow's kinds usually goes; only its author sends a version on (ADR-029).
  const targets = useMemo(() => {
    const out: Record<string, UsualTarget | undefined> = {};
    if (!v || !asker) return out;
    for (const kindId of new Set(v.p.flow.steps.flatMap((st) => st.kindIds))) {
      out[kindId] = usualTargetFor(v.state, ctx.org.state, { languageId: v.languageId, kindId, me });
    }
    return out;
  }, [v?.state, v?.languageId, v?.p.flow, ctx.org.state, me, asker]);
  if (!v) return <Missing ctx={ctx} id="passage_record" />;

  const { p, kinds, unitId, languageId } = v;
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
  const params = { unitId, languageId };
  const mine = requestIsMine(v.state, me);
  const teamName = teamNameIn(v.state);
  const answersMine = can.record && can.keep && feedbackIsMine(p, me);
  // A person may keep several drafts (decisions.md 83): with more than one, Record opens Versions to pick.
  const myDrafts = draftsBy(p, me);
  const myDraft = myDrafts.length > 0;
  const recordOrPick = () => (myDrafts.length > 1 ? setPage('versions') : go('workspace'));
  const fbKindIds = p.awaitingResponse.map((r) => r.kindId);
  const fbNames = feedbackNames(p, kinds);
  const openStep = openStepId ? p.steps.find((st) => st.step.id === openStepId) : undefined;
  const anchor = (n: PassageNote) => anchorLabel(n, { state: v.state, p, guide });
  const describe = (e: (typeof timeline)[number]) => describeEntry(e, { p, kinds, name: ctx.name, anchor, guide, hidden: (id) => id !== me && ctx.blocks.has(id) });

  const go = (to: ScreenId, extra: Record<string, string> = {}) => {
    setOpenStepId(null);
    ctx.go(to, { ...params, ...extra });
  };
  /** Close the step sheet first; a second sheet waits until it has gone. */
  const afterSheet = (fn: () => void) => {
    if (!openStepId) return fn();
    setOpenStepId(null);
    setTimeout(fn, SHEET_GAP_MS);
  };
  /** One tap: the kind goes to whoever usually does it, with Undo (ADR-029). */
  const sendTo = (kindId: string) => {
    const target = targets[kindId];
    if (!target) return go('ask_someone', { what: 'review', kindId });
    setOpenStepId(null);
    const label = sendTargetLabel(target, ctx.name);
    void perform(ctx, (c) => c.ask(sendToInput({ commandId: newId(), unitId, kindId, target })),
      'teamId' in target ? t('passage.page.sentToTeam', { target: label }) : t('passage.page.sentToPerson', { target: label }),
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
  const kindRow = (k: KindStatus, step: FlowStepStatus, first: boolean) => {
    const target = targets[k.kindId];
    return (
      <KindActionRow key={k.kindId} ctx={ctx} v={v} status={k} step={step} can={can} isAuthor={isAuthor} first={first} compact={false}
        mine={mine} teamName={teamName} {...(target ? { sendTo: sendTargetLabel(target, ctx.name) } : {})}
        {...(fbKindIds.length && !fbKindIds.includes(k.kindId) ? { waitFor: fbNames } : {})}
        onAction={onRowAction} onMore={() => setOpenStepId(step.step.id)} />
    );
  };
  const undoFromHistory = (departureId: string, type: string) => void perform(ctx, (c) => c.undoDeparture({ commandId: newId(), departureId }),
    type === 'override' ? t('passage.page.undone.override')
      : type === 'keep' ? t('passage.page.undone.keep') : t('passage.page.undone.skip'));
  const withdraw = (requestId: string) => void perform(ctx, (c) => c.withdrawRequest({ commandId: newId(), requestId }), t('passage.page.withdrawn'));

  // ---- the path ----
  const latestSeconds = p.latest ? clipSeconds(v.state, p.latest.cardHashes) : 0;
  const pathInput: PathInput = {
    p, kinds, me, name: ctx.name, when, due: dueText,
    study: study && study.steps.length > 0 ? { name: t('passage.page.studyGuideName', { pattern: study.guide.pattern }), total: study.steps.length, done: study.doneCount } : null,
    latestSeconds,
    askedName: (kindId) => {
      const r = p.openRequests.find((x) => x.what === 'review' && x.kindId === kindId);
      if (!r) return undefined;
      if (r.teamId) return teamName(r.teamId) ?? r.team?.name;
      return r.profileId ? ctx.name(r.profileId) : r.guest?.name;
    }
  };
  const steps = pathSteps(pathInput);
  const team = teamSteps(pathInput);
  const lit = steps.find((st) => st.state === 'current');
  const feedbackReview = steps.find((st) => st.kind === 'feedback')?.review;

  // The next check, for asking (after publishing, or later from the button).
  const nextKind = asker && p.next ? p.next.kinds.find((k) => !isCompleteState(k.state) && !k.request) : undefined;
  const nextTarget = nextKind ? targets[nextKind.kindId] : undefined;
  // A check someone asked of this person.
  const myCheck = p.steps.flatMap((st) => st.kinds.map((k) => ({ k, st })))
    .find(({ k }) => k.request && k.request.status === 'open' && !isCompleteState(k.state) && mine(k.request));
  // A check this person may do without being asked (the next one, on someone else's version).
  const openCheck = !isAuthor && p.recorded && can.review && p.next
    ? p.next.kinds.find((k) => !isCompleteState(k.state) && k.state !== 'locked') : undefined;

  type Main = { label: string; icon: IconName; onPress: () => void };
  let main: Main | null = null;
  if (answersMine && feedbackReview) {
    main = { label: t('passage.page.main.hearFeedback'), icon: 'listen', onPress: () => go('review_detail', { reviewId: feedbackReview.id }) };
  } else if (myCheck) {
    const kind = v.kind(myCheck.k.kindId);
    main = { label: kind.produces ? t('passage.page.main.backTranslate') : t('passage.page.main.doCheck', { check: kindInSentence(kind.name) }), icon: kind.produces ? 'globe' : 'check',
      onPress: () => go(kind.produces ? 'back_translation' : 'review_capture', { kindId: myCheck.k.kindId, ...(myCheck.k.request ? { requestId: myCheck.k.request.id } : {}) }) };
  } else if (lit?.kind === 'study') {
    main = { label: t('passage.page.main.study'), icon: 'star', onPress: () => go('study_guide') };
  } else if (lit?.kind === 'record' && can.record) {
    main = { label: myDraft ? t('passage.page.continueRecording') : t('passage.page.main.record'), icon: 'mic', onPress: recordOrPick };
  } else if (nextKind && can.ask) {
    main = { label: t('passage.page.askFor', { check: kindInSentence(v.kind(nextKind.kindId).name) }), icon: 'send', onPress: () => { setAskAfterPublish(false); setPage('ask'); } };
  } else if (openCheck) {
    const kind = v.kind(openCheck.kindId);
    main = { label: kind.produces ? t('passage.page.main.backTranslate') : t('passage.page.main.doCheck', { check: kindInSentence(kind.name) }), icon: kind.produces ? 'globe' : 'check',
      onPress: () => go(kind.produces ? 'back_translation' : 'review_capture', { kindId: openCheck.kindId }) };
  }

  // An earlier section (decision 80) is kept to be heard, not worked on.
  const earlierHere = isEarlierSection(ctx.language.state, unitId);
  if (earlierHere) main = null;

  const onStep = (st: PathStep): (() => void) | undefined => {
    if (earlierHere) {
      const take = (st.kind === 'record' || st.kind === 'publish') && st.state === 'done' ? p.latest?.takeId : undefined;
      return take ? () => go('version_detail', { takeId: take }) : undefined;
    }
    if (st.kind === 'study') return () => go('study_guide');
    if (st.kind === 'record') {
      if (st.state === 'done' && p.latest) { const takeId = p.latest.takeId; return () => go('version_detail', { takeId }); }
      return can.record ? () => go('workspace') : undefined;
    }
    if (st.kind === 'publish') {
      if (st.state === 'done' && p.latest) { const takeId = p.latest.takeId; return () => go('version_detail', { takeId }); }
      return can.record && p.drafting ? () => go('workspace') : undefined;
    }
    if ((st.kind === 'feedback' || st.kind === 'fix') && feedbackReview) return () => go('review_detail', { reviewId: feedbackReview.id });
    return undefined;
  };
  const canAct = can.ask || can.log || can.review;
  const onTeamStep = (step: TeamStep): (() => void) | undefined => (canAct && !earlierHere ? () => setOpenStepId(step.stepId) : undefined);
  const passageNote = p.notes.filter((n) => n.anchor.kind === 'passage' && n.by !== me).at(-1);
  const extraFor = (st: PathStep): ReactNode => {
    if (st.state !== 'current') return null;
    if (st.kind === 'record' && passageNote) return <NotePill ctx={ctx} note={passageNote} />;
    if (st.kind === 'feedback' && st.review) return <FeedbackPill ctx={ctx} review={st.review} />;
    return null;
  };
  const curStep = p.steps.find((st) => st.step.id === currentStepId(p));
  const curKind = curStep ? (curStep.kinds.find((k) => !isCompleteState(k.state)) ?? curStep.kinds[0]) : undefined;
  const gridIds = gridKindIds(p);

  const sheets = (
    <>
      {openStep ? (
        <Sheet visible title={stepName(kinds, openStep.step)} sub={stepSheetSub(openStep, canAct)} onClose={() => setOpenStepId(null)}>
          <Group>{openStep.kinds.map((k, i) => kindRow(k, openStep, i === 0))}</Group>
          {can.override && openStep.step.checkpoint && !openStep.complete && !openStep.override ? (
            <GhostBtn label={t('passage.page.movePastThis')} tone="red" onPress={() => afterSheet(() => setOverriding(openStep.step.id))} />
          ) : null}
        </Sheet>
      ) : null}
      {skipping ? (
        <ReasonSheet visible title={t('passage.page.skip.title', { kind: v.kind(skipping.kindId).name })}
          sub={t('passage.page.skip.sub')}
          quickReasons={skipReasons()} confirmLabel={t('passage.page.skip.confirm')} voice={voiceFor(ctx)} onClose={() => setSkipping(null)}
          onConfirm={(r) => {
            const { kindId, stepId } = skipping;
            setSkipping(null);
            void perform(ctx, (c) => c.depart({ commandId: newId(), unitId, type: 'skip', kindId, stepId, reason: r.reason, ...(r.blobHash ? { reasonBlobHash: r.blobHash } : {}) }),
              t('passage.page.skip.done', { kind: v.kind(kindId).name }), undoDepart);
          }} />
      ) : null}
      {overriding ? (
        <ReasonSheet visible title={t('passage.page.override.title')} tone="red"
          sub={t('passage.page.override.sub')}
          quickReasons={overrideReasons()} confirmLabel={t('passage.page.override.confirm')} voice={voiceFor(ctx)} onClose={() => setOverriding(null)}
          onConfirm={(r) => {
            const stepId = overriding;
            setOverriding(null);
            void perform(ctx, (c) => c.depart({ commandId: newId(), unitId, type: 'override', stepId, reason: r.reason, ...(r.blobHash ? { reasonBlobHash: r.blobHash } : {}) }),
              t('passage.page.override.done'), undoDepart);
          }} />
      ) : null}
      {noting ? <AddNoteSheet ctx={ctx} v={v} say={noting === 'say'} onClose={() => setNoting(null)} /> : null}
    </>
  );

  // ---- Something else? (demo a-else) ----
  if (page === 'else') {
    const lockedCheckpoint = can.override ? p.steps.find((st) => st.step.checkpoint && !st.complete && !st.override) : undefined;
    return (
      <Screen header={<Header title={t('passage.else.title')} sub={[v.title, lit?.title ?? ''].filter(Boolean).join(' · ')} onBack={() => setPage('path')} close />}
        footer={can.note ? (
          <View style={{ gap: 2 }}>
            <PrimaryBtn label={t('passage.else.sayInstead')} icon="mic" onPress={() => setNoting('say')} />
            <Text style={[txt.xs, { textAlign: 'center' }]}>{t('passage.else.sayInsteadSub')}</Text>
          </View>
        ) : undefined}>
        <View style={{ gap: space.md }}>
          {!p.recorded && can.ask ? (
            <BigOption icon="people" label={t('passage.else.someoneElse')} sub={t('passage.else.someoneElseRecord')}
              onPress={() => go('ask_someone', { what: 'record' })} />
          ) : null}
          {p.recorded && curKind && can.ask ? (
            <BigOption icon="people" label={t('passage.else.someoneElse')} sub={t('passage.else.someoneElseCheck', { kind: v.kind(curKind.kindId).name })}
              onPress={() => go('ask_someone', { what: 'review', kindId: curKind.kindId })} />
          ) : null}
          {p.recorded && curKind && can.log ? (
            <BigOption icon="check" label={t('passage.else.alreadyDid')} sub={t('passage.else.alreadyDidSub', { check: kindInSentence(v.kind(curKind.kindId).name) })}
              onPress={() => go('add_record', { kindId: curKind.kindId })} />
          ) : null}
          {p.recorded && curKind && curStep && can.skip ? (
            <BigOption icon="clock" label={t('common.notNow')} sub={t('passage.else.notNowSub', { check: kindInSentence(v.kind(curKind.kindId).name) })}
              onPress={() => setSkipping({ kindId: curKind.kindId, stepId: curStep.step.id })} />
          ) : null}
          {can.record && p.recorded && !answersMine ? (
            <BigOption icon="mic" label={myDraft ? t('passage.page.continueRecording') : t('passage.else.newVersion')} sub={t('passage.else.newVersionSub')}
              onPress={recordOrPick} />
          ) : null}
          {lockedCheckpoint ? (
            <BigOption icon="lock" label={t('passage.else.movePast')} sub={t('passage.else.movePastSub', { step: stepName(kinds, lockedCheckpoint.step) })}
              onPress={() => setOverriding(lockedCheckpoint.step.id)} />
          ) : null}
          <View style={styles.tiles}>
            {can.note ? <SmallOption icon="chat" label={t('common.addNote')} onPress={() => setNoting('note')} /> : null}
            <SmallOption icon="book" label={t('passage.else.whatHelps')} onPress={() => go('passage_reference')} />
          </View>
          {/* What comes along without a connection (decisions.md 61). */}
          <PassageOffline ctx={ctx} unitId={unitId} hasStudy={!!guide} />
          <Text style={txt.xs}>{t('passage.else.teamOptions', { section: t('passage.path.thenTheTeam') })}</Text>
        </View>
        {sheets}
      </Screen>
    );
  }

  // ---- Published, then ask for a check (demo a-ask, a-btAsk) ----
  if (page === 'ask') {
    const bt = publishedParam?.startsWith('bt');
    const latest = p.latest;
    const members = nextTarget && 'teamId' in nextTarget
      ? commaList(Object.entries(v.state.teams[nextTarget.teamId]?.members ?? {}).filter(([, m]) => m.value).map(([id]) => ctx.name(id)).slice(0, 4))
      : nextTarget ? ctx.name(nextTarget.profileId) : '';
    const close = () => { setPage('path'); setAskAfterPublish(false); };
    return (
      <Screen header={askAfterPublish ? undefined : <Header title={t('passage.published.askTitle')} sub={v.title} onBack={close} close />}
        footer={nextKind && can.ask ? (
          <View style={{ gap: space.xs }}>
            <PrimaryBtn label={nextTarget ? t('passage.published.askTarget', { target: sendTargetLabel(nextTarget, ctx.name) })
              : t('passage.page.askFor', { check: kindInSentence(v.kind(nextKind.kindId).name) })} icon="send"
              onPress={() => { close(); sendTo(nextKind.kindId); }} />
            <QuietLinks items={[
              { label: t('passage.published.someoneElse'), icon: 'people', onPress: () => { close(); go('ask_someone', { what: 'review', kindId: nextKind.kindId }); } },
              { label: t('common.notNow'), icon: 'clock', onPress: close }
            ]} />
          </View>
        ) : <PrimaryBtn label={t('common.done')} icon="check" onPress={close} />}>
        {askAfterPublish ? (
          <View style={{ alignItems: 'center', gap: space.sm, paddingTop: space.xl }}>
            <View style={styles.bigCheck}><Ico name="check" size={44} color={TINT.greenText} strokeWidth={3} /></View>
            <Text style={[txt.h2, { textAlign: 'center', fontSize: 26, fontWeight: '800' }]} accessibilityRole="header">
              {bt ? t('passage.published.backTranslation') : latest ? t('passage.published.version', { n: latest.n }) : t('passage.published.versionNoNumber')}
            </Text>
            <Text style={[txt.smMuted, { textAlign: 'center' }]}>{t('passage.published.savedHere', { title: v.title })}</Text>
          </View>
        ) : null}
        {nextKind ? (
          <View style={{ gap: space.sm, marginTop: askAfterPublish ? space.lg : 0 }}>
            <Text style={txt.label}>{t('passage.published.nextAsk')}</Text>
            <View style={styles.askCard}>
              <View style={styles.askIcon}><Ico name={kindIcon(nextKind.kindId)} size={24} color={C.primary} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[txt.body, { fontWeight: '800', fontSize: 19 }]}>{v.kind(nextKind.kindId).name}</Text>
                <Text style={txt.smMuted} numberOfLines={2}>{members || t('passage.published.chooseWho')}</Text>
              </View>
            </View>
            <Text style={txt.smMuted}>
              {nextTarget ? t('passage.published.setForStep') : t('passage.published.nobodySet')}
            </Text>
          </View>
        ) : (
          <Text style={[txt.smMuted, { textAlign: 'center', marginTop: space.lg }]}>
            {p.done ? t('passage.published.allDone') : t('passage.published.alreadyAsked')}
          </Text>
        )}
        {sheets}
      </Screen>
    );
  }

  // ---- every version (decisions.md 83): drafts, published versions, then the history ----
  const history = (
    <>
      {study ? (
        <Disclosure icon="sparkle" title={t('passage.page.study', { pattern: study.guide.pattern })}
          summary={study.doneCount || study.noteCount ? studySummary(study) : t('passage.page.studyNotStarted')}
          {...ctx.details(`passage:${unitId}:${languageId}:study`)}>
          <StudyRows ctx={ctx} study={study} onOpen={(stepId) => go('study_step', { stepId })} />
          <Row icon="sparkle" label={t('passage.page.openStudy')} onPress={() => go('study_guide')} last />
        </Disclosure>
      ) : null}
      {p.versions.length > 0 && gridIds.length > 0 ? (
        <Disclosure icon="chat" title={t('passage.page.reviewsByVersion')} summary={reviewsSummary(p)} {...ctx.details(`passage:${unitId}:${languageId}:reviews`)}>
          <ReviewGrid ctx={ctx} v={v} kindIds={gridIds}
            onVersion={(takeId) => go('version_detail', { takeId })} onReview={(reviewId) => go('review_detail', { reviewId })} />
        </Disclosure>
      ) : null}
      {timeline.length > 0 ? (
        <Disclosure icon="history" title={t('passage.page.historyTitle')} summary={historySummary(timeline)} {...ctx.details(`passage:${unitId}:${languageId}:history`)}>
          {timeline.slice(0, historyShown).map((e, i) => {
            const entry = describe(e);
            let onPress: (() => void) | undefined;
            let trailing: ReactNode = null;
            if (e.type === 'version') onPress = () => go('version_detail', { takeId: e.version.takeId });
            if (e.type === 'review' || e.type === 'response') onPress = () => go('review_detail', { reviewId: e.review.id });
            if (e.type === 'study') onPress = () => go('study_step', { stepId: e.stepId });
            if (e.type === 'departure' && !e.departure.undone && can.undo) {
              trailing = <SmallBtn label={t('passage.page.undo')} icon="undo" onPress={() => undoFromHistory(e.departure.id, e.departure.type)} />;
            }
            if (e.type === 'request' && e.request.status === 'open' && can.withdraw && (e.request.by === me || s.can('assign_work'))) {
              trailing = <SmallBtn label={t('passage.page.withdraw')} onPress={() => withdraw(e.request.id)} />;
            }
            // A note on the whole passage shows only here, so it is reported from here (decisions.md 48);
            // so is someone else's request with words of its own. Versions and reviews open their page, which has the flag.
            if (!trailing && e.type === 'note') {
              trailing = <ReportFlag ctx={ctx} target={recordTarget(ctx, 'note', e.note.id, e.by, unitId)} size={36} />;
            }
            if (!trailing && e.type === 'request' && e.request.by && (e.request.note || e.request.noteBlobHash)) {
              trailing = <ReportFlag ctx={ctx} target={recordTarget(ctx, 'request', e.request.id, e.request.by, unitId)} size={36} />;
            }
            return <HistoryRow key={`${e.type}-${e.hlc}-${i}`} text={entry} when={when(e.hlc)} last={i === Math.min(historyShown, timeline.length) - 1} trailing={trailing} {...(onPress ? { onPress } : {})} />;
          })}
          <View style={{ paddingHorizontal: space.md, paddingBottom: historyShown < timeline.length ? space.md : 0 }}>
            <ShowMore remaining={timeline.length - historyShown} step={HISTORY_STEP} onMore={() => setHistoryShown((n) => n + HISTORY_STEP)} />
          </View>
        </Disclosure>
      ) : null}
    </>
  );
  if (page === 'versions') {
    return (
      <>
        <VersionsPage ctx={ctx} v={v} canRecord={can.record} go={go} onBack={() => setPage('path')} history={history}
          {...(nextKind && can.ask ? { ask: { label: t('passage.page.askFor', { check: kindInSentence(v.kind(nextKind.kindId).name) }), onPress: () => { setAskAfterPublish(false); setPage('ask'); } } } : {})} />
        {sheets}
      </>
    );
  }

  // ---- the path ----
  const footer = (
    <View style={{ gap: space.xs }}>
      {main ? <PrimaryBtn label={main.label} icon={main.icon} onPress={main.onPress} /> : null}
      <QuietLinks items={[
        { label: t('passage.else.title'), icon: 'help', onPress: () => setPage('else') },
        { label: t('passage.page.history'), icon: 'list', onPress: () => setPage('versions') }
      ]} />
    </View>
  );
  return (
    <Screen header={<Header title={v.title} sub={v.language} onBack={ctx.back} />} footer={footer}>
      {p.awaitingResponse.length > 0 && !answersMine ? (
        <Text style={[txt.sm, { color: TINT.amberText }]}>
          {t('passage.page.waitingOnAnswer', { name: p.latest ? ctx.name(p.latest.by, true) : t('passage.record.theTranslator'), kinds: fbNames })}
        </Text>
      ) : null}
      <EarlierNote ctx={ctx} unitId={unitId} languageId={languageId} />
      <PassagePath steps={steps} team={team} onStep={onStep} onTeamStep={onTeamStep} extraFor={extraFor} />
      <EarlierSections ctx={ctx} unitId={unitId} languageId={languageId} />
      {sheets}
    </Screen>
  );
}

/** One of the ways forward on "Something else?": a big card row. */
function BigOption(props: { icon: IconName; label: string; sub: string; onPress: () => void }) {
  return (
    <Group>
      <Row icon={props.icon} label={props.label} sub={props.sub} onPress={props.onPress} last />
    </Group>
  );
}

function SmallOption(props: { icon: IconName; label: string; onPress: () => void }) {
  const press = useHelpPress(props.label, undefined, props.onPress);
  return (
    <Pressable onPress={press} accessibilityRole="button" style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}>
      <Ico name={props.icon} size={20} color={props.icon === 'chat' ? TINT.amberText : C.primary} />
      <Text style={[txt.sm, { fontWeight: '700', flex: 1 }]}>{props.label}</Text>
    </Pressable>
  );
}

/** A teammate's note on the passage, in the lit Record step: hear it (or read it) in place. */
function NotePill(props: { ctx: Ctx; note: PassageNote }) {
  const { ctx, note } = props;
  const who = ctx.name(note.by);
  const secs = note.blobHash ? clipSeconds(ctx.language.state, [note.blobHash]) : 0;
  return (
    <View style={styles.notePill}>
      {note.blobHash ? <AudioClip language={ctx.language} hashes={[note.blobHash]} label={t('passage.page.playNote', { name: who })} /> : <Ico name="chat" size={18} color={TINT.amberText} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[txt.sm, { fontWeight: '800', color: TINT.amberText }]}>{[t('passage.page.whoseNote', { name: who }), secs > 0 ? clockOf(secs) : ''].filter(Boolean).join(' · ')}</Text>
        {note.text ? <Text style={[txt.sm, { color: TINT.amberText }]} numberOfLines={3}>{authoredText(ctx, note.by, note.text)}</Text> : null}
      </View>
    </View>
  );
}

/** The feedback in the lit "Hear the feedback" step: who, how long, the words. */
function FeedbackPill(props: { ctx: Ctx; review: ReviewView }) {
  const { ctx, review } = props;
  const who = feedbackSource(review, ctx.name);
  const secs = review.commentBlobHash ? clipSeconds(ctx.language.state, [review.commentBlobHash]) : 0;
  return (
    <View style={styles.notePill}>
      {review.commentBlobHash ? <AudioClip language={ctx.language} hashes={[review.commentBlobHash]} label={t('passage.page.playFeedback', { name: who })} /> : <Ico name="chat" size={18} color={TINT.amberText} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[txt.sm, { fontWeight: '800', color: C.dark }]}>{who}{secs > 0 ? ` · ${clockOf(secs)}` : ''}</Text>
        {review.comment ? <Text style={[txt.sm, { color: C.dark }]} numberOfLines={3}>{t('passage.quote', { text: authoredText(ctx, review.by, review.comment) })}</Text> : null}
      </View>
    </View>
  );
}

/** Keep a version despite feedback, with a reason (REC-5, CORE-2). Undo puts the feedback back. */
function KeepSheet(props: { ctx: Ctx; v: PassageView; reviewId: string; onClose: () => void }) {
  const { ctx, v } = props;
  return (
    <ReasonSheet visible title={t('passage.keep.title')} tone="amber"
      sub={t('passage.keep.sheetSub')}
      // Voice first, in the person's own words; no preset reasons (demo SIMPLE-9).
      quickReasons={[]} confirmLabel={t('passage.keep.confirm')} voice={voiceFor(ctx)} onClose={props.onClose}
      onConfirm={(r) => {
        props.onClose();
        void perform(ctx, (c) => c.depart({
          commandId: newId(), unitId: v.unitId, type: 'keep', reviewId: props.reviewId, reason: r.reason,
          ...(r.blobHash ? { reasonBlobHash: r.blobHash } : {})
        }), t('passage.keep.done'), undoDepart);
      }} />
  );
}

function AddNoteSheet(props: { ctx: Ctx; v: PassageView; onClose: () => void; say?: boolean }) {
  const { ctx, v } = props;
  const [text, setText] = useState('');
  const [hash, setHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const ok = await perform(ctx, (c) => c.addNote({
      commandId: newId(), unitId: v.unitId, anchor: { kind: 'passage' },
      ...(text.trim() ? { text: text.trim() } : {}), ...(hash ? { blobHash: hash } : {})
    }), t('passage.addNote.done'));
    setBusy(false);
    if (ok) props.onClose();
  };
  return (
    <Sheet visible title={props.say ? t('passage.else.sayInstead') : t('common.addNote')}
      sub={props.say ? t('passage.addNote.saySub') : t('passage.addNote.sub')} onClose={props.onClose}
      footer={<PrimaryBtn label={t('passage.addNote.save')} disabled={!text.trim() && !hash} busy={busy} onPress={() => void save()} />}>
      <VoiceNote ctx={ctx} label={t('common.sayIt')} hash={hash} onChange={setHash} />
      <Field value={text} onChangeText={setText} placeholder={t('common.orTypeIt')} multiline />
    </Sheet>
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
        <View accessibilityLabel={stateLabel(status.state)}><StateMark state={status.state} size={22} /></View>
      </View>
      {acts.actionable && props.compact && (acts.primary || others > 0) ? (
        <View style={styles.btnRow}>
          {acts.primary ? <View style={{ flex: 1 }}>{btn(acts.primary, props.waitFor ? 'plain' : 'primary')}</View> : null}
          {others > 0 ? (
            <View style={acts.primary ? undefined : { flex: 1 }}>
              <SmallBtn label={acts.primary ? t('passage.page.more') : t('passage.page.options')} onPress={props.onMore} />
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
              <Pressable onPress={() => props.onVersion(row.version.takeId)} accessibilityRole="button" accessibilityLabel={t('passage.page.openVersion', { version: versionTitle(row.version.n) })}
                style={({ pressed }) => [styles.gridVersion, pressed && { opacity: 0.6 }]}>
                <Text style={[txt.sm, { fontWeight: '700', color: C.primary }]}>{t('passage.grid.versionShort', { n: row.version.n })}</Text>
                <Text style={txt.xs} numberOfLines={1}>{when(row.version.hlc)}</Text>
              </Pressable>
              {row.cells.map((cell) => {
                const r = cell.reviews.at(-1);
                const kind = v.kind(cell.kindId);
                return (
                  <View key={cell.kindId} style={styles.gridCol}>
                    {r ? (
                      <Pressable onPress={() => props.onReview(r.id)} accessibilityRole="button"
                        accessibilityLabel={cell.reviews.length > 1
                          ? t('passage.grid.cellLatestOf', { kind: kind.name, who: feedbackSource(r, props.ctx.name), count: cell.reviews.length })
                          : t('passage.grid.cell', { kind: kind.name, who: feedbackSource(r, props.ctx.name) })}
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
            <Text style={txt.xs}>{stateLabel(st)}</Text>
          </View>
        ))}
        {producing.map((k) => (
          <View key={k.id} style={[styles.rowCenter, { gap: 4 }]}>
            <Ico name={kindIcon(k.id)} size={14} color={C.primary} />
            <Text style={txt.xs}>{t('passage.grid.kindRecorded', { kind: k.name })}</Text>
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
  const guide = useStudyGuide(ctx, v?.unitId);
  if (!v) return <Missing ctx={ctx} id="version_detail" />;
  const { p, unitId, languageId } = v;
  const version = p.versions.find((x) => x.takeId === ctx.params['takeId']) ?? p.latest;
  if (!version) return <Missing ctx={ctx} id="version_detail" crumbsOf={v} text={t('passage.version.nothingRecorded')} />;
  const title = versionTitle(version.n);
  const reviews = p.reviews.filter((r) => r.versionN === version.n);
  const prompted = p.reviews.filter((r) => r.response?.revisedTakeId === version.takeId);
  const terms = keyTermLinksFor(v.state, version.takeId);
  const notes = p.notes.filter((n) => n.anchor.kind !== 'study' && (n.onTakeId === version.takeId || (n.anchor.kind === 'version' && n.anchor.takeId === version.takeId)));
  const key = (part: string) => `version:${unitId}:${languageId}:${version.takeId}:${part}`;
  const params = { unitId, languageId };
  return (
    <Screen header={<Header title={title} crumbs={passageCrumbs(ctx, v, title)} sub={`${ctx.name(version.by)} · ${when(version.hlc)}`} onBack={ctx.back}
      action={<ReportFlag ctx={ctx} target={recordTarget(ctx, 'version', version.takeId, version.by, unitId)} />} />}>
      <Card>
        <Label text={version.n === 1 ? t('passage.version.note') : t('passage.version.whatChanged')} />
        <Authored ctx={ctx} by={version.by}>
          <Text style={txt.body}>{version.changeNote ?? (version.n === 1 ? t('passage.record.entry.firstRecording') : t('passage.version.noChangeNote'))}</Text>
          {version.changeBlobHash ? <PlayRow ctx={ctx} hashes={[version.changeBlobHash]} label={t('passage.version.changeAloud')} /> : null}
        </Authored>
        {prompted.map((r) => (
          <Pressable key={r.id} onPress={() => ctx.go('review_detail', { ...params, reviewId: r.id })} accessibilityRole="link"
            style={({ pressed }) => [styles.inlineLink, pressed && { opacity: 0.6 }]}>
            <Ico name="chat" size={16} color={C.primary} />
            <Text style={[txt.link, { flex: 1 }]}>{t('passage.version.inResponseTo', { kind: v.kind(r.kindId).name, who: feedbackSource(r, ctx.name) })}</Text>
          </Pressable>
        ))}
      </Card>

      <SectionLabel label={t('passage.version.recording')} />
      <Authored ctx={ctx} by={version.by}>
        <Card>
          <PlayRow ctx={ctx} hashes={version.cardHashes} label={t('passage.journey.playVersion', { version: title })} sub={t('passage.journey.takes', { count: version.cardHashes.length })} />
          {version.cardHashes.length > 1 ? version.cardHashes.map((h, i) => (
            <PlayRow key={`${h}-${i}`} ctx={ctx} hashes={[h]} label={t('passage.version.take', { n: i + 1 })} />
          )) : null}
        </Card>
      </Authored>
      <UsedLine ctx={ctx} state={v.state} subject={{ takeId: version.takeId }} detailsKey={key('used')} />

      {terms.length > 0 || reviews.length > 0 || notes.length > 0 ? <SectionLabel label={t('passage.version.details')} /> : null}
      {terms.length > 0 ? (
        <Disclosure icon="book" title={t('passage.version.keyTerms')}
          summary={t('passage.version.termsTied', { count: terms.length, terms: `${commaList(terms.slice(0, 2).map((x) => x.term.term))}${terms.length > 2 ? '…' : ''}` })}
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
        <Disclosure icon="chat" title={t('passage.version.reviews')} summary={versionReviewsSummary(reviews, v.kinds)} {...ctx.details(key('reviews'))}>
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
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('passage.version.noReviews')}</Text>
      )}
      {notes.length > 0 ? (
        <Disclosure icon="note" title={t('passage.version.notes')}
          summary={`${t('passage.version.noteCount', { count: notes.length })} · ${authoredText(ctx, notes[0]?.by, notes[0]?.text ?? t('common.voiceNote'))}`} {...ctx.details(key('notes'))}>
          <View style={{ padding: space.md, gap: space.sm }}>
            {notes.map((n) => (
              <Authored key={n.id} ctx={ctx} by={n.by}>
                <NoteCard anchor={anchorLabel(n, { state: v.state, p, guide })} by={ctx.name(n.by)} when={when(n.hlc)}
                  {...(n.text ? { text: n.text } : {})}
                  {...(n.blobHash ? { audio: <PlayRow ctx={ctx} hashes={[n.blobHash]} label={t('common.voiceNote')} /> } : {})}
                  action={<ReportFlag ctx={ctx} target={recordTarget(ctx, 'note', n.id, n.by, unitId)} size={36} />} />
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
/** "Keep it as it is?" (demo a-keepWhy): the reason by voice first, typing under it. Undo puts the feedback back. */
function KeepPage(props: { ctx: Ctx; v: PassageView; review: ReviewView; source: string; onBack: () => void }) {
  const { ctx, v, review } = props;
  const [hash, setHash] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const keep = async () => {
    setBusy(true);
    const ok = await perform(ctx, (c) => c.depart({
      commandId: newId(), unitId: v.unitId, type: 'keep', reviewId: review.id, reason: text.trim() || SAID_BY_VOICE,
      ...(hash ? { reasonBlobHash: hash } : {})
    }), t('passage.keep.done'), undoDepart);
    setBusy(false);
    if (ok) ctx.back();
  };
  return (
    <Screen header={<Header title={v.title} sub={t('passage.keep.sayWhyTitle')} onBack={props.onBack} />}
      footer={<PrimaryBtn label={t('passage.keep.keepIt')} icon="check" busy={busy} disabled={!hash && !text.trim()} onPress={() => void keep()} />}>
      <View style={{ alignItems: 'center', gap: space.xs, paddingTop: space.lg }}>
        <Text style={[txt.h2, { fontWeight: '800', fontSize: 26 }]} accessibilityRole="header">{t('passage.keep.title')}</Text>
        <Text style={[txt.smMuted, { textAlign: 'center' }]}>{t('passage.keep.sayWhy', { who: props.source })}</Text>
      </View>
      <View style={{ paddingVertical: space.xxl }}>
        <BigVoice ctx={ctx} label={t('passage.keep.tapAndSay')} hash={hash} onChange={(h) => setHash(h)} />
      </View>
      <Field value={text} onChangeText={setText} placeholder={t('common.orTypeIt')} multiline />
    </Screen>
  );
}

export function ReviewDetail(ctx: Ctx) {
  const v = usePassage(ctx);
  const [keeping, setKeeping] = useState(false);
  // Feedback to answer opens as Ryder's "Feedback came back" (demo r-Feedback), with "Keep it, say why" as its own page.
  const [keepPage, setKeepPage] = useState(false);
  const look = usePerson();
  useEffect(() => {
    if (!keepPage) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setKeepPage(false); return true; });
    return () => sub.remove();
  }, [keepPage]);
  if (!v) return <Missing ctx={ctx} id="review_detail" />;
  const { p, unitId, languageId } = v;
  const review = p.reviews.find((r) => r.id === ctx.params['reviewId']) ?? p.reviews.at(-1);
  if (!review) return <Missing ctx={ctx} id="review_detail" crumbsOf={v} text={t('passage.review.noReviews')} />;
  const me = ctx.session.actorId;
  const params = { unitId, languageId };
  const kind = v.kind(review.kindId);
  const makes = kind.produces;
  const checkedBy = makes ? v.kind(makes.checkedBy).name : undefined;
  const good = review.outcome !== 'needs_changes';
  const request = review.requestId ? p.requests.find((r) => r.id === review.requestId) : undefined;
  const questions = questionsForKind(v.state, review.kindId, request);
  const answers = answeredQuestions(questions, review.answers);
  const skipped = Object.entries(review.skipped ?? {});
  const source = feedbackSource(review, ctx.name);
  const version = p.versions[review.versionN - 1];
  const tint = makes ? { bg: C.light, fg: C.primary } : good ? { bg: TINT.green, fg: TINT.greenText } : { bg: TINT.amber, fg: TINT.amberText };
  const answerable = ctx.session.can('translate') && canGo(ctx, 'review_detail', 'workspace') && review.outcome === 'needs_changes'
    && !review.response && review.versionN === p.latest?.n && p.latest?.by === me;
  const artifacts = review.artifacts && review.artifacts.length > 0 ? (
    <Card>
      <Text style={[txt.sm, { fontWeight: '700' }]}>{makes ? t('passage.review.madeInto', { what: makes.what, into: makes.into }) : t('passage.journey.captured')}</Text>
      <PlayRow ctx={ctx} hashes={review.artifacts.map((c) => c.hash)} label={makes ? t('passage.journey.playMade', { what: makes.what }) : t('passage.review.playRecording')}
        sub={t('passage.review.parts', { count: review.artifacts.length })} />
    </Card>
  ) : null;
  // "Back translation recorded": what the kind makes, at the start of the line.
  const made = makes ? `${makes.what.charAt(0).toLocaleUpperCase(currentLocale())}${makes.what.slice(1)}` : '';
  const outcome = makes ? t('passage.review.madeRecorded', { what: made }) : good ? t('passage.view.outcomeStart.looksGood') : t('passage.view.outcomeStart.needsChanges');

  if (answerable && keepPage) {
    return <KeepPage ctx={ctx} v={v} review={review} source={source} onBack={() => setKeepPage(false)} />;
  }
  if (answerable) {
    return (
      <Screen header={<Header title={v.title} onBack={ctx.back} close
        action={<ReportFlag ctx={ctx} target={recordTarget(ctx, 'review', review.id, review.by, unitId)} />} />}
        footer={(
          <View style={{ gap: space.sm }}>
            <PrimaryBtn label={t('passage.review.recordFix')} icon="mic" onPress={() => ctx.go('workspace', { ...params, reviewId: review.id })} />
            <GhostBtn label={t('passage.keep.sayWhyTitle')} onPress={() => setKeepPage(true)} />
          </View>
        )}>
        <View style={{ alignItems: 'center', gap: space.sm, paddingTop: space.xl }}>
          <View style={styles.amberPill}>
            <Ico name="chat" size={16} color={TINT.amberText} />
            <Text style={[txt.sm, { fontWeight: '800', color: TINT.amberText }]}>{t('passage.path.feedbackSub', { kind: kind.name })}</Text>
          </View>
          <View style={{ marginTop: space.md }}><PersonAvatar look={look(review.by)} size={72} /></View>
          <Text style={[txt.h2, { fontWeight: '800' }]}>{source}</Text>
          <Text style={txt.smMuted}>{[when(review.hlc), version ? versionTitle(version.n) : ''].filter(Boolean).join(' · ')}</Text>
        </View>
        <Authored ctx={ctx} by={review.by}>
          <View style={styles.feedbackCard}>
            {review.commentBlobHash ? (
              <ClipPlayer language={ctx.language} hashes={[review.commentBlobHash]} title={t('passage.review.whoseFeedback', { name: source })} tone="amber" bare />
            ) : null}
            {review.comment ? <Text style={[txt.body, { fontSize: 18, lineHeight: 26 }]}>{t('passage.quote', { text: review.comment })}</Text> : null}
            {!review.comment && !review.commentBlobHash ? <Text style={txt.smMuted}>{t('passage.review.noWords')}</Text> : null}
          </View>
        </Authored>
        {answers.length > 0 ? (
          <Disclosure icon="help" title={t('passage.review.theirAnswers')} summary={t('passage.review.answers', { count: answers.length })}
            {...ctx.details(`review:${unitId}:${languageId}:${review.id}:questions`)}>
            {answers.map((a, i) => (
              <View key={a.id} style={[styles.answer, i > 0 && styles.topBorder]}>
                <Text style={txt.xs}>{a.label}</Text>
                <Text style={[txt.body, { fontWeight: '700' }]}>{a.answer}</Text>
              </View>
            ))}
          </Disclosure>
        ) : null}
        {version ? (
          <LinkBtn label={t('passage.review.hearVersion', { version: versionTitle(version.n) })} onPress={() => ctx.go('version_detail', { ...params, takeId: version.takeId })}
            style={{ alignSelf: 'center' }} />
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen header={<Header title={kind.name} crumbs={passageCrumbs(ctx, v, kind.name)} sub={when(review.hlc)} onBack={ctx.back}
      action={<ReportFlag ctx={ctx} target={recordTarget(ctx, 'review', review.id, review.by, unitId)} />} />}
      footer={answerable ? (
        <View style={styles.btnRow}>
          <View style={{ width: '44%' }}><GhostBtn label={t('passage.keep.keepIt')} onPress={() => setKeeping(true)} /></View>
          <View style={{ flex: 1 }}><PrimaryBtn label={t('passage.review.recordFix')} icon="mic" onPress={() => ctx.go('workspace', { ...params, reviewId: review.id })} /></View>
        </View>
      ) : undefined}>
      <View style={[styles.outcome, { backgroundColor: tint.bg }]}>
        <View style={[styles.roundTile, { backgroundColor: C.card, width: 44, height: 44, borderRadius: 22 }]}>
          <Ico name={makes ? kindIcon(review.kindId) : good ? 'check' : 'chat'} size={22} color={tint.fg} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[txt.body, { fontWeight: '700', color: tint.fg }]}>{outcome}</Text>
          <Text style={[txt.xs, { color: tint.fg, marginTop: 2 }]}>{`${source} · ${viaText(review, ctx.name)}`}</Text>
        </View>
      </View>
      {makes ? (
        <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>
          {[t('passage.review.newContent'), checkedBy ? t('passage.review.comparedBy', { kind: checkedBy }) : ''].filter(Boolean).join(' ')}
        </Text>
      ) : null}
      {makes && artifacts ? <Authored ctx={ctx} by={review.by}>{artifacts}</Authored> : null}
      {review.people || review.place || request ? (
        <View style={styles.badges}>
          {review.people ? <Badge label={t('passage.review.people', { count: review.people })} /> : null}
          {review.place ? <Badge label={review.place} /> : null}
          {request ? <Badge tone="brand" label={t('passage.review.askedBy', { name: request.by ? ctx.name(request.by, true) : t('passage.path.someoneInSentence') })} /> : null}
        </View>
      ) : null}
      {version ? (
        <Group>
          <Row icon="mic" label={makes ? t('passage.review.madeFrom', { version: versionTitle(version.n) }) : t('passage.review.reviewed', { version: versionTitle(version.n) })}
            sub={`${ctx.name(version.by)} · ${when(version.hlc)}`}
            onPress={() => ctx.go('version_detail', { ...params, takeId: version.takeId })} last />
        </Group>
      ) : null}
      <UsedLine ctx={ctx} state={v.state} subject={{ reviewId: review.id }} detailsKey={`review:${unitId}:${languageId}:${review.id}:used`} />
      {review.comment || review.commentBlobHash ? (
        <Card>
          <Label text={makes ? t('passage.review.noteFromBt') : t('passage.review.feedback')} />
          <Authored ctx={ctx} by={review.by}>
            {review.commentBlobHash ? <PlayRow ctx={ctx} hashes={[review.commentBlobHash]} label={t('passage.journey.voiceFeedback')} /> : null}
            {review.comment ? <Text style={txt.body}>{review.comment}</Text> : null}
          </Authored>
        </Card>
      ) : null}
      {!makes && artifacts ? <Authored ctx={ctx} by={review.by}>{artifacts}</Authored> : null}
      {answers.length > 0 || skipped.length > 0 ? (
        <Disclosure icon="help" title={t('passage.review.answersTitle')}
          summary={[t('passage.review.answers', { count: answers.length }), skipped.length ? t('passage.review.leftUnanswered', { count: skipped.length }) : ''].filter(Boolean).join(' · ')}
          {...ctx.details(`review:${unitId}:${languageId}:${review.id}:questions`)}>
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
                <Text style={txt.xs}>{questions.find((q) => q.q.id === qid)?.q.text ?? t('passage.record.answer.question')}</Text>
                <Text style={txt.sm}>
                  <Trans i18nKey="passage.review.unansweredBecause" values={{ reason }} components={{ b: <Text style={{ fontWeight: '700', color: C.muted }} /> }} />
                </Text>
              </View>
            ))}
          </Authored>
        </Disclosure>
      ) : null}
      {review.response ? (
        <Card style={{ backgroundColor: C.light, borderColor: C.light }}>
          <Label color={C.primary} text={`${review.response.decision === 'revised' ? t('passage.review.revisedIt', { name: ctx.name(review.response.by) })
            : t('passage.review.keptIt', { name: ctx.name(review.response.by) })} · ${when(review.response.hlc)}`} />
          <Authored ctx={ctx} by={review.response.by}>
            {review.response.note ? <Text style={txt.body}>{review.response.note}</Text> : null}
            {review.response.blobHash ? <PlayRow ctx={ctx} hashes={[review.response.blobHash]} label={t('passage.review.answerAloud')} /> : null}
          </Authored>
          {review.response.revisedTakeId ? (() => {
            const revised = p.versions.find((x) => x.takeId === review.response?.revisedTakeId);
            return revised ? (
              <LinkBtn label={t('passage.page.openVersion', { version: versionTitle(revised.n) })} onPress={() => ctx.go('version_detail', { ...params, takeId: revised.takeId })} />
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
  const candidates = useMemo(() => (v ? askCandidates(v.state, ctx.org.state, { languageId: v.languageId, what, ...(kindId ? { kindId } : {}), me }) : []),
    [v?.state, v?.languageId, ctx.org.state, what, kindId, me]);
  if (!v) return <Missing ctx={ctx} id="ask_someone" />;
  if (what === 'review' && !kindId) {
    return <Missing ctx={ctx} id="ask_someone" crumbsOf={v} text={t('passage.ask.fromItsStep')} />;
  }

  const kind = kindId ? v.kind(kindId) : undefined;
  const isRecord = what === 'record';
  const title = isRecord ? (v.p.recorded ? t('passage.ask.titleNewVersion') : t('passage.ask.titleRecord'))
    : kind ? t('passage.ask.titleKind', { kind: kind.name }) : t('passage.ask.titleReview');
  const byName = (a: { profileId: string }, b: { profileId: string }) => ctx.name(a.profileId).localeCompare(ctx.name(b.profileId));
  const usual = candidates.filter((c) => c.usual).sort(byName);
  const others = candidates.filter((c) => !c.usual).sort(byName);
  const existingQuestions = kindId ? questionsForKind(v.state, kindId).length : 0;
  const dueErr = dueError(dueTyped, today);
  const due = dueTyped.trim() ? (dueErr ? null : dueTyped.trim()) : dueDays === null ? null : addDays(today, dueDays);
  const outside = mode === 'outside' && !isRecord;
  const target = outside ? guestName.trim() : who ? ctx.name(who) : '';
  const ready = !!target && (!outside || contact.trim().length > 3) && !dueErr;

  const send = async () => {
    if (!ready) return;
    setBusy(true);
    const ok = await perform(ctx, (c) => c.ask({
      commandId: newId(), unitId: v.unitId, what,
      ...(kindId ? { kindId } : {}),
      ...(outside ? { guest: { name: guestName.trim(), channel, contact: contact.trim() } } : who ? { profileId: who } : {}),
      ...(due ? { dueDate: due } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(noteHash ? { noteBlobHash: noteHash } : {}),
      ...(!isRecord && questions.length ? { questions } : {})
    }), outside ? t('passage.ask.doneOutside', { name: target }) : t('passage.ask.doneTeam', { name: target }),
    (applied) => (c) => c.withdrawRequest({ commandId: newId(), requestId: payloadField(applied, 'requestId') }));
    setBusy(false);
    if (ok) ctx.go('passage_record', { unitId: v.unitId, languageId: v.languageId });
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
    <Screen header={<Header title={title} sub={`${v.title} · ${v.language}`} onBack={ctx.back} close />}
      footer={<PrimaryBtn label={target ? t('passage.ask.askName', { name: target.split(' ')[0] }) : t('passage.ask.chooseSomeone')} disabled={!ready} busy={busy} onPress={() => void send()} />}>
      <Card style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        {kindId ? <KindIcon kindId={kindId} size={44} /> : <View style={[styles.roundTile, { width: 44, height: 44, borderRadius: 14, backgroundColor: C.light }]}><Ico name="mic" size={22} color={C.primary} /></View>}
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text style={txt.h3}>{isRecord ? (v.p.recorded ? t('passage.else.newVersion') : t('passage.ask.recordIt')) : kind?.name}</Text>
          <Text style={txt.xs}>{isRecord ? t('passage.ask.recordSub') : kind?.description}</Text>
        </View>
      </Card>

      <SectionLabel label={t('passage.ask.who')} />
      {!isRecord ? (
        <ChipRow>
          <Chip label={t('passage.ask.onTeam')} on={mode === 'team'} onPress={() => setMode('team')} />
          <Chip label={t('passage.ask.withoutApp')} on={mode === 'outside'} onPress={() => setMode('outside')} />
        </ChipRow>
      ) : null}
      {!outside ? (
        <Group>
          {usual.length > 0 ? <View style={styles.groupHead}><Label text={kind ? t('passage.ask.usuallyDoes', { kind: kind.name }) : t('passage.ask.usuallyDoesThis')} color={C.primary} /></View> : null}
          {usual.map((c, i) => personRow(c, i === usual.length - 1 && others.length === 0))}
          {others.length > 0 && usual.length > 0 ? <View style={[styles.groupHead, styles.topBorder]}><Label text={t('passage.ask.othersWhoCan')} /></View> : null}
          {others.slice(0, othersShown).map((c, i) => personRow(c, i === Math.min(others.length, othersShown) - 1))}
          {others.length > othersShown ? (
            <View style={{ padding: space.md }}>
              <ShowMore remaining={others.length - othersShown} step={PEOPLE_STEP} onMore={() => setOthersShown((n) => n + PEOPLE_STEP)} />
            </View>
          ) : null}
          {candidates.length === 0 ? (
            <Text style={[txt.smMuted, { padding: space.lg }]}>
              {isRecord ? t('passage.ask.nobody') : t('passage.ask.nobodyTryOutside')}
            </Text>
          ) : null}
        </Group>
      ) : (
        <View style={{ gap: space.sm }}>
          <Field value={guestName} onChangeText={setGuestName} placeholder={t('passage.ask.guestName')} autoCapitalize="words" />
          <View style={styles.btnRow}>
            <Chip label={channelLabel('whatsapp')} on={channel === 'whatsapp'} onPress={() => setChannel('whatsapp')} />
            <Chip label={channelLabel('sms')} on={channel === 'sms'} onPress={() => setChannel('sms')} />
          </View>
          <Field value={contact} onChangeText={setContact} placeholder={t('passage.ask.phone')} keyboardType="phone-pad" />
          <View style={styles.preview}>
            <Label text={t('passage.ask.preview', { channel: channelLabel(channel) })} color={TINT.greenText} />
            <Text style={txt.sm}>{guestMessage({ name: guestName, passage: v.title, language: v.language })}</Text>
            <Text style={[txt.xs, { color: TINT.greenText }]}>{t('passage.ask.previewNote')}</Text>
          </View>
        </View>
      )}

      <SectionLabel label={t('passage.ask.directions')} />
      <VoiceNote ctx={ctx} label={isRecord ? t('passage.ask.sayKeepInMind') : t('passage.ask.sayListenFor')} hash={noteHash} onChange={setNoteHash} />
      <Field value={note} onChangeText={setNote} placeholder={t('passage.ask.orTypeThem')} multiline />

      {!isRecord ? (
        <>
          <SectionLabel label={t('passage.ask.ownQuestions')} />
          <Text style={[txt.xs, { paddingHorizontal: space.xs, marginTop: -space.sm }]}>
            {existingQuestions ? t('passage.ask.addedToCount', { count: existingQuestions, kind: kind?.name ?? '' }) : t('passage.ask.addedTo', { kind: kind?.name ?? '' })}
          </Text>
          {questions.length > 0 ? (
            <Group>
              {questions.map((q, i) => (
                <Row key={q.id} label={q.text} sub={questionTypeLabel(q.type)} last={i === questions.length - 1}
                  right={<IconBtn name="close" label={t('passage.ask.removeQuestion')} onPress={() => setQuestions((qs) => qs.filter((x) => x.id !== q.id))} bg="transparent" color={C.muted} />} />
              ))}
            </Group>
          ) : null}
          <Field value={qDraft} onChangeText={setQDraft} placeholder={t('passage.ask.askSpecific')} />
          <View style={styles.btnRow}>
            <View style={{ flex: 1 }}>
              <SmallBtn label={t('passage.ask.answerType', { type: questionTypeLabel(qType) })} onPress={() => setQType(nextQuestionType)} />
            </View>
            <View style={{ flex: 1 }}>
              <SmallBtn label={t('passage.ask.addQuestion')} icon="plus" tone="primary" disabled={!qDraft.trim()} onPress={addQuestion} />
            </View>
          </View>
        </>
      ) : null}

      <SectionLabel label={t('passage.ask.byWhen')} />
      <ChipRow>
        {dueChoices().map((d) => (
          <Chip key={String(d.days)} label={d.label} on={!dueTyped.trim() && dueDays === d.days} onPress={() => { setDueTyped(''); setDueDays(d.days); }} />
        ))}
      </ChipRow>
      <Field value={dueTyped} onChangeText={setDueTyped} placeholder={t('passage.ask.orDate', { date: addDays(today, 10) })} autoCapitalize="none" />
      {dueErr ? <Text style={[txt.xs, { color: TINT.redText }]}>{dueErr}</Text>
        : due ? <Text style={txt.xs}>{dueTitle(due)}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  amberPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.full, backgroundColor: TINT.amber },
  feedbackCard: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: 1, borderColor: TINT.noteBorder, padding: space.lg, gap: space.md },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { flexGrow: 1, flexBasis: '45%', flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 56, paddingHorizontal: space.md,
    borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, backgroundColor: C.card },
  notePill: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.lg, backgroundColor: TINT.amber },
  bigCheck: { width: 88, height: 88, borderRadius: 44, backgroundColor: TINT.green, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  askCard: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.xl, borderWidth: 2, borderColor: C.primary, backgroundColor: C.card },
  askIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  btnRow: { flexDirection: 'row', gap: space.sm },
  toneDot: { width: 10, height: 10, borderRadius: 5 },
  body: { padding: space.lg, paddingBottom: space.xxl },
  headerMore: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 48, paddingHorizontal: space.md, borderRadius: radius.full, backgroundColor: C.bg },
  inlineNext: { marginHorizontal: -space.lg, marginBottom: -space.lg, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border, overflow: 'hidden' },
  amberCard: { backgroundColor: TINT.amber, borderColor: TINT.amber },
  dashedCard: { borderStyle: 'dashed', borderWidth: 1.5, ...flat },
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
