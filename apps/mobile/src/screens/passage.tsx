// The passage record and what hangs off it. Ports the UX demo's
// `screens/passage.tsx`: PassageRecordScreen (passage_record),
// VersionDetailScreen (version_detail), ReviewDetailScreen (review_detail)
// and AskSomeoneScreen (ask_someone).
// Requirements CORE-1..11, REC-1..10, ASK-1..5; ADR-005, 007, 012, 013, 014,
// 015, 016, 020, 021, 029, 030 (the path top to bottom: passage/journey.tsx).
// Everything shown is derived from the event log
// (core derivePassage and friends); every change is a core command through
// ctx.act, with Undo where the demo offers it.
import { EarlierNote, EarlierSections } from '../breakup/earlier';
import { isEarlierSection } from '../breakup/earlierSections';
import { Faces, PeopleLine } from '../checks/parts';
import { checkName } from '../admin/adminModel';
import {
  CommandError, canDeleteVersion, checkPeople, commands, draftsBy, questionsForKind, recordTimeline,
  type Commands, type EventSpec, type FlowStepStatus, type KindState, type KindStatus, type PassageNote, type QuestionSpec, type ReviewView
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useHardwareBack } from '../ui/useHardwareBack';
import { Text } from '../ui/text';
import { AudioClip } from '../audio/audioClip';
import { commandErrorText, stateLabel } from '../i18n/coreText';
import type { Ctx } from '../shell/ctx';
import { edgeFor, screenTitle, type ScreenId } from '../shell/flow';
import { t, Trans } from '../i18n';
import { indexesFor } from '../sync/indexes';
import { Badge, Card, Chip, ChipRow, Disclosure, EmptyState, Field, GhostBtn, Group, Header, HelpInfo, Ico, IconBtn, KindIcon, LinkBtn, NoteCard, PrimaryBtn, QuietLinks, ReasonSheet, Row, Screen, SectionLabel, Sheet, ShowMore, SmallBtn, StateMark, type IconName } from '../ui/kit';
import { kindIcon } from '../ui/kindIcon';
import { txt } from '../ui/textStyles';
import { anchorLabel, askCandidates, channelLabel, currentStepId, describeEntry, gridKindIds, guestMessage, historySummary, listenersOf, nextQuestionType, questionTypeLabel, reviewMark, reviewsSummary, sendTargetLabel, versionReviewsSummary, type EntryText, type RowAction } from '../passage/record';
import { PassagePath } from '../passage/path';
import { AskCheckCard, TheyAnswer } from '../passage/askParts';
import { askInput, askDoneText, askModel, TEAM, type AskPicks } from '../passage/askModel';
import {
  answersSummary, changeNoteText, feedbackIsEmpty, gridCell, gridCellLabel, gridColumnName, gridModel, hasFeedback, notesSummary, responseLine,
  revisedVersion, reviewDetailModel, reviewFor, skippedQuestionText, termLabel, termsTiedSummary, versionDetailModel, versionFor, versionName,
  type OutcomeTone
} from '../passage/reviewModel';
import {
  hasWords, keepInput, keepPageInput, noteInput, overrideInput, payloadField, skipInput, undoneText, undoNote
} from '../passage/recordInputsModel';
import { VersionsPage } from '../passage/versions';
import { deleteVersion } from '../passage/deleteVersion';
import { ConfirmDelete } from '../ui/ConfirmDelete';
import { cardDurations } from '../recording/workspaceModel';
import { mmss, totalMs } from '../recording/model';
import { VersionRecording } from '../passage/versionParts';
import { useVersesHeld } from '../passage/useVerses';
import { pathSteps, teamSteps, type PathStep, type TeamStep } from '../passage/pathModel';
import {
  askButtonLabel, askForLabel, currentCheck, elseMove, elseOptions, historyAction, historyHelp, historyMove, listenerLabel, listenersLine, mainMove,
  nothingToAsk, passageNoteFor, recordCan, recordModel, recordPathInput, rowBar, rowButtons, rowMove, sentText,
  stepMove, stepSheet, studyLine, studyPathInfo, teamStepsOpen, usualTargets, waitingOnAnswer,
  type ElseOption, type RecordMain, type RecordMove, type SheetRow
} from '../passage/recordModel';
import { clipSeconds, clock as clockOf } from '../audio/clipTime';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge } from '../helpMode/helpBadge';
import { requestIsMine, sendToInput, teamNameIn } from '../passage/sendTarget';
import { feedbackSource, isJustNow, kindInSentence, outcomeText, passageCrumbs, versionTitle, viaText, when, type PassageView } from '../passage/passageView';
import { usePassage } from '../passage/usePassage';
import { PassageOffline, PassageOfflineLine } from '../sync/offline';
import { noteExpected, reportError } from '../diagnostics/report';
import { Authored, ReportFlag } from '../moderation/reportSheet';
import { authoredText, recordTarget } from '../moderation/reportTargets';
import { UsedLine } from '../sources/used';
import { contractsFor } from '../shell/screenContracts';
import { edgeAllowed } from '../shell/session';
import { useStudyGuide } from '../study/useStudyGuides';
import { studyProgress, type StudyProgress } from '../study/progress';
import { StepMark } from '../study/ui';
import { stepLine } from '../study/studyText';
import { flat } from '../ui/shadow';
import { C, radius, space, TINT, withAlpha } from '../ui/theme';
import { PersonAvatar } from '../ui/UserChip';
import { usePerson } from '../ui/usePerson';
import { BigVoice } from '../recording/bigVoice';
import { ClipPlayer } from '../audio/clipPlayer';
import { VoiceNote } from '../audio/voiceNote';
import { useDraft } from '../drafts/useDraft';
import { draftKey, EMPTY_NOTE, isNoteDraft } from '../drafts/draftModel';
import { SavedMark } from '../ui/SavedMark';

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
  undo?: (applied: EventSpec[]) => (c: Commands) => EventSpec[],
  /** What Undo says once it has undone (ctx.act's default is "Undone."). */
  undone?: string
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
    } : undefined, undone);
    return true;
  } catch (e) {
    // ctx.act already said "Not saved"; only the caller's busy state is left to reset.
    noteExpected('passage: write', e);
    return false;
  }
}

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

/** What the record's main button does, as help mode says it. */
function mainHelp(m: RecordMain): string {
  switch (m.id) {
    case 'hearFeedback': return t('passage.page.mainHelp.hearFeedback');
    case 'check': return m.produces ? t('passage.page.mainHelp.backTranslate') : t('passage.page.mainHelp.check');
    case 'study': return t('passage.page.mainHelp.study');
    case 'record': return t('passage.page.mainHelp.record');
    case 'ask': return t('passage.page.mainHelp.ask');
  }
}

/** What a check's round mark means (its colour and icon), as help mode says it. */
function markHelp(state: KindState): string {
  switch (state) {
    case 'approved': return t('passage.page.marks.approved');
    case 'addressed': return t('passage.page.marks.addressed');
    case 'suggestions': return t('passage.page.marks.suggestions');
    case 'asked': return t('passage.page.marks.asked');
    case 'skipped': return t('passage.page.marks.skipped');
    case 'locked': return t('passage.page.marks.locked');
    case 'todo': return t('passage.page.marks.todo');
  }
}

/** What a step's action button does in the step sheet (recordModel's row actions), as help mode says it. */
function actionHelp(id: RowAction['id']): string {
  switch (id) {
    case 'do': return t('passage.page.actionHelp.do');
    case 'send': return t('passage.page.actionHelp.send');
    case 'ask': return t('passage.page.actionHelp.ask');
    case 'log': return t('passage.page.actionHelp.log');
    case 'skip': return t('passage.page.actionHelp.skip');
    case 'undo': return t('passage.page.actionHelp.undo');
  }
}

// ---- passage_record ------------------------------------------------------------------

/**
 * A passage as Ryder drew it (decision 71, demo ADR-033): the recording's own
 * steps numbered top to bottom, the lit one in a card, the team's checks
 * under "Then the team", and one main button for this person's next step.
 * Everything else is one labelled tap away: "Something else?" (a page of the
 * other ways forward) and "Versions and history" (a page of the person's
 * drafts and every published version to work on freely, then the full
 * record, decisions.md 83). With several drafts, Record opens that page to
 * pick one. Done asks for the next check before coming back here
 * (decision 127).
 */
export function PassageRecord(ctx: Ctx) {
  const v = usePassage(ctx);
  const [openStepId, setOpenStepId] = useState<string | null>(null);
  const [skipping, setSkipping] = useState<{ kindId: string; stepId: string } | null>(null);
  const [overriding, setOverriding] = useState<string | null>(null);
  const [noting, setNoting] = useState<null | 'note' | 'say'>(null);
  // The record's pages: the path, "Something else?", asking for the next check, and every version (decisions.md 83).
  // Done asks for the next check itself (decision 127), so the record opens on the path after it.
  const [page, setPage] = useState<'path' | 'else' | 'ask' | 'versions'>('path');
  // Asking someone comes back to the path, where the request shows, even when it started from "Something else?".
  const askedParam = ctx.params['asked'];
  useEffect(() => { if (askedParam) setPage('path'); }, [askedParam]);
  // Done's "Someone else" (decision 127): the version is on the record; choosing who to ask opens from here.
  const askSomeoneParam = ctx.params['askSomeone'];
  const goRef = useRef(ctx.go);
  goRef.current = ctx.go;
  useEffect(() => {
    if (askSomeoneParam && v) goRef.current('ask_someone', { unitId: v.unitId, languageId: v.languageId, what: 'review', kindId: askSomeoneParam });
  }, [askSomeoneParam]); // eslint-disable-line react-hooks/exhaustive-deps -- once per arrival with the param; v is new on every draw
  useHardwareBack(page !== 'path', () => setPage('path'));
  const [historyShown, setHistoryShown] = useState(HISTORY_STEP);
  // Which of the checks that happen next the ask page sends (decision 91): the first, unless another is picked.
  const [askKindId, setAskKindId] = useState<string | null>(null);
  // Questions added on the ask page, sent with the request (as Someone else can).
  const [askQuestions, setAskQuestions] = useState<QuestionSpec[]>([]);
  const vState = v?.state;
  const vp = v?.p;
  const vLanguageId = v?.languageId;
  const timeline = useMemo(() => (vState && vp ? recordTimeline(vState, vp) : []), [vState, vp]);
  const guide = useStudyGuide(ctx, v?.unitId);
  const study = useMemo(() => (vState && vp && guide ? studyProgress(vState, vp, guide) : null), [vState, vp, guide]);
  const versesHeld = useVersesHeld(ctx, v?.state, v?.unitId);
  const me = ctx.session.actorId;
  const isAuthor = !!v?.p.latest && v.p.latest.by === me;
  // The version's author asks for its next check (demo ADR-034).
  const asker = isAuthor;
  // Where each of the flow's kinds usually goes; only its author sends a version on (ADR-029).
  const orgState = ctx.org.state;
  const targets = useMemo(
    () => (vState && vp && vLanguageId !== undefined ? usualTargets(vState, orgState, { p: vp, languageId: vLanguageId, me, asker }) : {}),
    [vState, vLanguageId, vp, orgState, me, asker]
  );
  if (!v) return <Missing ctx={ctx} id="passage_record" />;

  const { p, kinds, unitId, languageId } = v;
  // A check's one name on every screen (decision 91): "Peer check", in a sentence "the peer check".
  const nameOf = (kindId: string) => checkName(kindId, kinds);
  const s = ctx.session;
  const can = recordCan(s);
  const params = { unitId, languageId };
  const mine = requestIsMine(v.state, me);
  const teamName = teamNameIn(v.state);
  // A person may keep several drafts (decisions.md 83): with more than one, Record opens Versions to pick.
  const myDrafts = draftsBy(p, me);
  const recordOrPick = () => (myDrafts.length > 1 ? setPage('versions') : go('workspace'));
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
  const sendTo = (kindId: string, questions: QuestionSpec[] = []) => {
    const target = targets[kindId];
    if (!target) return go('ask_someone', { what: 'review', kindId });
    setOpenStepId(null);
    const label = sendTargetLabel(target, ctx.name);
    void perform(ctx, (c) => c.ask({ ...sendToInput({ commandId: newId(), unitId, kindId, target }), ...(questions.length ? { questions } : {}) }),
      sentText(target, label),
      (applied) => (c) => c.withdrawRequest({ commandId: newId(), requestId: payloadField(applied, 'requestId') }));
  };
  /** Carry out a move the record's models decided (recordModel.ts `RecordMove`). */
  const doMove = (mv: RecordMove) => {
    if (mv.id === 'go') go(mv.to, mv.extra);
    else if (mv.id === 'recordOrPick') recordOrPick();
    else setPage('ask');
  };
  const onRowAction = (a: RowAction, k: KindStatus, step: FlowStepStatus, askedMe: boolean) => {
    const mv = rowMove(a, k, { produces: !!v.kind(k.kindId).produces, stepId: step.step.id, askedMe });
    if (!mv) return;
    if (mv.id === 'send') sendTo(mv.kindId);
    else if (mv.id === 'skip') afterSheet(() => setSkipping({ kindId: mv.kindId, stepId: mv.stepId }));
    else if (mv.id === 'undoReview') takeBackReview(mv.reviewId);
    else doMove(mv);
  };
  const sheetOf = (step: FlowStepStatus) => stepSheet({ p, kinds, kind: v.kind, step, can, isAuthor, me, mine, name: ctx.name, teamName, targets });
  const undoFromHistory = (departureId: string, type: string) => void perform(ctx, (c) => c.undoDeparture({ commandId: newId(), departureId }), undoneText(type));
  const withdraw = (requestId: string) => void perform(ctx, (c) => c.withdrawRequest({ commandId: newId(), requestId }), t('passage.page.withdrawn'));
  /** Your own review or note, taken back (decisions.md 111): the check is open again, the note gone. */
  const takeBackReview = (reviewId: string) => void perform(ctx, (c) => c.withdrawReviews({ commandId: newId(), reviewIds: [reviewId] }), t('common.undone'));
  const takeBackNote = (noteId: string) => void perform(ctx, (c) => c.withdrawNote({ commandId: newId(), noteId }), t('common.undone'));

  // ---- the path ----
  const latestSeconds = p.latest ? clipSeconds(v.state, p.latest.cardHashes) : 0;
  const pathInput = recordPathInput({
    p, kinds, me, name: ctx.name, teamName,
    study: studyPathInfo(study),
    latestSeconds,
    latestVerses: p.latest ? versesHeld(p.latest.cardHashes) : null
  });
  const steps = pathSteps(pathInput);
  const team = teamSteps(pathInput);
  const lit = steps.find((st) => st.state === 'current');

  // An earlier section (decision 80) is kept to be heard, not worked on.
  const earlierHere = isEarlierSection(ctx.language.state, unitId);
  // The main button, and the next check for asking (after publishing, or later from the button).
  const model = recordModel({ p, kinds, kind: v.kind, me, can, steps, mine, asker, askKindId, isAuthor, earlier: earlierHere });
  const { answersMine, feedbackReview, myDraft, nextKinds, nextKind } = model;
  const nextTarget = nextKind ? targets[nextKind.kindId] : undefined;
  const m = model.main;
  const main: { label: string; icon: IconName; help: string; onPress: () => void } | null = !m ? null : {
    label: m.label, icon: m.icon, help: mainHelp(m), onPress: () => doMove(mainMove(m))
  };

  const onStep = (st: PathStep): (() => void) | undefined => {
    const mv = stepMove(st, { p, can, earlier: earlierHere, feedbackReview });
    return mv ? () => doMove(mv) : undefined;
  };
  const canAct = teamStepsOpen(can);
  const onTeamStep = (step: TeamStep): (() => void) | undefined => (canAct && !earlierHere ? () => setOpenStepId(step.stepId) : undefined);
  const passageNote = passageNoteFor(p, me);
  const extraFor = (st: PathStep): ReactNode => {
    if (st.state !== 'current') return null;
    if (st.kind === 'record' && passageNote) return <NotePill ctx={ctx} note={passageNote} />;
    if (st.kind === 'feedback' && st.review) return <FeedbackPill ctx={ctx} review={st.review} />;
    return null;
  };
  const gridIds = gridKindIds(p);

  const openSheet = openStep ? sheetOf(openStep) : undefined;
  const sheets = (
    <>
      {openSheet && openStep ? (
        <Sheet visible title={openSheet.title} sub={openSheet.sub || undefined} onClose={() => setOpenStepId(null)}>
          <Group>{openSheet.rows.map((row, i) => (
            <KindActionRow key={row.status.kindId} row={row} step={openStep} first={i === 0} compact={false}
              onAction={onRowAction} onMore={() => setOpenStepId(openStep.step.id)} />
          ))}</Group>
          {openSheet.movePast ? (
            <GhostBtn label={t('passage.page.movePastThis')} tone="red" help={t('passage.page.movePastHelp')} onPress={() => afterSheet(() => setOverriding(openStep.step.id))} />
          ) : null}
        </Sheet>
      ) : null}
      {skipping ? (
        <ReasonSheet visible title={t('passage.page.skip.title', { kind: nameOf(skipping.kindId) })}
          sub={t('passage.page.skip.sub')}
          quickReasons={skipReasons()} confirmLabel={t('passage.page.skip.confirm')} voice={voiceFor(ctx)} onClose={() => setSkipping(null)}
          onConfirm={(r) => {
            const { kindId, stepId } = skipping;
            setSkipping(null);
            void perform(ctx, (c) => c.depart(skipInput({ commandId: newId(), unitId, kindId, stepId, reason: r })),
              t('passage.page.skip.done', { kind: nameOf(kindId) }), undoDepart);
          }} />
      ) : null}
      {overriding ? (
        <ReasonSheet visible title={t('passage.page.override.title')} tone="red"
          sub={t('passage.page.override.sub')}
          quickReasons={overrideReasons()} confirmLabel={t('passage.page.override.confirm')} voice={voiceFor(ctx)} onClose={() => setOverriding(null)}
          onConfirm={(r) => {
            const stepId = overriding;
            setOverriding(null);
            void perform(ctx, (c) => c.depart(overrideInput({ commandId: newId(), unitId, stepId, reason: r })),
              t('passage.page.override.done'), undoDepart);
          }} />
      ) : null}
      {noting ? <AddNoteSheet ctx={ctx} v={v} say={noting === 'say'} onClose={() => setNoting(null)} /> : null}
    </>
  );

  // ---- Something else? (demo a-else) ----
  if (page === 'else') {
    const options = elseOptions({ p, kinds, can, current: currentCheck(p, currentStepId(p)), answersMine, myDraft });
    const onOption = (o: ElseOption) => {
      const mv = elseMove(o);
      if (mv.id === 'skip') return setSkipping({ kindId: mv.kindId, stepId: mv.stepId });
      if (mv.id === 'override') return setOverriding(mv.stepId);
      return doMove(mv);
    };
    return (
      <Screen header={<Header title={t('passage.else.title')} sub={[v.title, lit?.title ?? ''].filter(Boolean).join(' · ')} onBack={() => setPage('path')} close />}
        footer={can.note ? (
          <View style={{ gap: 2 }}>
            <PrimaryBtn label={t('passage.else.sayInstead')} icon="mic" help={t('passage.else.sayInsteadHelp')} onPress={() => setNoting('say')} />
            <Text style={[txt.xs, { textAlign: 'center' }]}>{t('passage.else.sayInsteadSub')}</Text>
          </View>
        ) : undefined}>
        <View style={{ gap: space.md }}>
          {options.map((o) => <BigOption key={o.id} testID={`else-${o.id}${o.kindId ? `-${o.kindId}` : ''}`} icon={o.icon} label={o.label} sub={o.sub} onPress={() => onOption(o)} />)}
          <View style={styles.tiles}>
            {can.note ? <SmallOption testID="else-note" icon="chat" label={t('common.addNote')} help={t('passage.else.addNoteHelp')} onPress={() => setNoting('note')} /> : null}
            <SmallOption testID="else-reference" icon="book" label={t('passage.else.whatHelps')} help={t('passage.else.whatHelpsHelp')} onPress={() => go('passage_reference')} />
          </View>
          {/* What comes along without a connection (decisions.md 61). */}
          <PassageOffline ctx={ctx} unitId={unitId} hasStudy={!!guide} />
          <Text style={txt.xs}>{t('passage.else.teamOptions', { section: t('passage.path.thenTheTeam') })}</Text>
        </View>
        {sheets}
      </Screen>
    );
  }

  // ---- Ask for a check (demo a-ask; decision 91: each check with its people). Done asks in its own tap (decision 127). ----
  if (page === 'ask') {
    const close = () => setPage('path');
    return (
      <Screen header={<Header title={t('passage.published.askTitle')} sub={v.title} onBack={close} close />}
        footer={nextKind && can.ask ? (
          <View style={{ gap: space.xs }}>
            <PrimaryBtn label={askButtonLabel({ target: nextTarget, kindId: nextKind.kindId, kinds, name: ctx.name })} icon="send"
              help={nextTarget ? t('passage.ask.sendHelp') : t('passage.page.mainHelp.ask')}
              onPress={() => { close(); sendTo(nextKind.kindId, askQuestions); setAskQuestions([]); }} />
            <QuietLinks items={[
              { label: t('passage.published.someoneElse'), icon: 'people', help: t('passage.published.someoneElseHelp'), onPress: () => { close(); go('ask_someone', { what: 'review', kindId: nextKind.kindId }); } },
              { label: t('common.notNow'), icon: 'clock', help: t('passage.published.notNowHelp'), onPress: close }
            ]} />
          </View>
        ) : <PrimaryBtn label={t('common.done')} icon="check" help={t('passage.published.doneHelp')} onPress={close} />}>
        {nextKind && can.ask ? (
          <View style={{ gap: space.sm }}>
            <Text style={txt.label}>{t('passage.published.nextAsk')}</Text>
            {nextKinds.map((k) => (
              <AskCheckCard key={k.kindId} ctx={ctx} kindId={k.kindId} name={checkName(k.kindId, kinds)} on={k.kindId === nextKind.kindId} radio={nextKinds.length > 1}
                people={checkPeople(v.state, k.kindId).filter((id) => id !== me)} onPress={() => setAskKindId(k.kindId)} />
            ))}
            {/* With someone to send it to, the questions they'll answer, and more to add. With nobody yet, the button opens Someone else, which has them. */}
            {can.ask && targets[nextKind.kindId] ? <TheyAnswer asked={questionsForKind(v.state, nextKind.kindId)} questions={askQuestions} setQuestions={setAskQuestions}
              {...(ctx.session.can('manage_flows') ? { check: { name: checkName(nextKind.kindId, kinds), open: () => ctx.go('check_editor', { languageId: v.languageId, kindId: nextKind.kindId }) } } : {})} /> : null}
          </View>
        ) : can.ask ? (
          <Text style={[txt.smMuted, { textAlign: 'center', marginTop: space.lg }]}>
            {nothingToAsk(p)}
          </Text>
        ) : null}
        {sheets}
      </Screen>
    );
  }

  // ---- every version (decisions.md 83): drafts, published versions, then the history ----
  const { live, feedback: listened } = listenersOf(v.state, p);
  const history = (
    <>
      {study ? (
        <Disclosure icon="sparkle" title={t('passage.page.study', { pattern: study.guide.pattern })}
          summary={studyLine(study)}
          {...ctx.details(`passage:${unitId}:${languageId}:study`)}>
          <StudyRows ctx={ctx} study={study} onOpen={(stepId) => go('study_step', { stepId })} />
          <Row icon="sparkle" label={t('passage.page.openStudy')} help={t('passage.page.openStudyHelp')} onPress={() => go('study_guide')} last />
        </Disclosure>
      ) : null}
      {p.versions.length > 0 && gridIds.length > 0 ? (
        <Disclosure icon="chat" title={t('passage.page.reviewsByVersion')} summary={reviewsSummary(p)} {...ctx.details(`passage:${unitId}:${languageId}:reviews`)}>
          <ReviewGrid ctx={ctx} v={v} kindIds={gridIds}
            onVersion={(takeId) => go('version_detail', { takeId })} onReview={(reviewId) => go('review_detail', { reviewId })} />
        </Disclosure>
      ) : null}
      {listened.length > 0 || live.length > 0 ? (
        <Disclosure icon="listen" title={t('passage.page.listeners')}
          summary={listenersLine(live, listened)}
          {...ctx.details(`passage:${unitId}:${languageId}:listeners`)}>
          {live.map((r) => (
            <Row key={r.channel} icon="check" iconColor={TINT.greenText} label={t('passage.page.liveIn', { channel: r.channel, version: versionTitle(r.versionN) })}
              sub={when(r.hlc)} onPress={() => go('version_detail', { takeId: r.takeId })} last={listened.length === 0 && r === live[live.length - 1]} />
          ))}
          {listened.map((r, i) => (
            <Row key={r.id} icon={r.outcome === 'needs_changes' ? 'chat' : 'check'}
              label={listenerLabel(r)}
              sub={[feedbackSource(r, ctx.name), versionTitle(r.versionN), when(r.hlc)].join(' · ')}
              onPress={() => go('review_detail', { reviewId: r.id })} last={i === listened.length - 1} />
          ))}
        </Disclosure>
      ) : null}
      {timeline.length > 0 ? (
        <Disclosure icon="history" title={t('passage.page.historyTitle')} summary={historySummary(timeline)} {...ctx.details(`passage:${unitId}:${languageId}:history`)}>
          {timeline.slice(0, historyShown).map((e, i) => {
            const entry = describe(e);
            const mv = historyMove(e);
            const onPress = mv ? () => doMove(mv) : undefined;
            const help = historyHelp(e);
            // A note on the whole passage shows only here, so it is reported from here (decisions.md 48);
            // so is someone else's request with words of its own (recordModel.ts `historyAction`).
            const act = historyAction(e, { can, me, assigns: s.can('assign_work') });
            let trailing: ReactNode = null;
            if (act?.id === 'undo') trailing = <SmallBtn label={t('passage.page.undo')} icon="undo" help={t('help.details.undo')} onPress={() => undoFromHistory(act.departureId, act.type)} />;
            if (act?.id === 'withdraw') trailing = <SmallBtn label={t('passage.page.withdraw')} help={t('passage.page.withdrawHelp')} onPress={() => withdraw(act.requestId)} />;
            if (act?.id === 'undoReview') trailing = <SmallBtn label={t('passage.page.undo')} icon="undo" help={t('passage.page.actionHelp.undo')} onPress={() => takeBackReview(act.reviewId)} />;
            if (act?.id === 'undoNote') trailing = <SmallBtn label={t('passage.page.undo')} icon="undo" help={t('passage.page.undoNoteHelp')} onPress={() => takeBackNote(act.noteId)} />;
            if (act?.id === 'reportNote') trailing = <ReportFlag ctx={ctx} target={recordTarget(ctx, 'note', act.noteId, act.by, unitId)} size={36} />;
            if (act?.id === 'reportRequest') trailing = <ReportFlag ctx={ctx} target={recordTarget(ctx, 'request', act.requestId, act.by, unitId)} size={36} />;
            return <HistoryRow key={`${e.type}-${e.hlc}-${i}`} text={entry} when={when(e.hlc)} last={i === Math.min(historyShown, timeline.length) - 1} trailing={trailing} {...(onPress ? { onPress } : {})} {...(help ? { help } : {})} />;
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
          {...(nextKind && can.ask ? { ask: { label: askForLabel(nextKind.kindId, kinds), onPress: () => setPage('ask') } } : {})} />
        {sheets}
      </>
    );
  }

  // ---- the path ----
  const waiting = waitingOnAnswer({ p, kinds, answersMine, name: ctx.name });
  const footer = (
    <View style={{ gap: space.xs }}>
      {main ? <PrimaryBtn label={main.label} icon={main.icon} help={main.help} onPress={main.onPress} /> : null}
      <QuietLinks items={[
        { label: t('passage.else.title'), icon: 'help', help: t('passage.page.elseHelp'), onPress: () => setPage('else') },
        { label: t('passage.page.history'), icon: 'list', help: t('passage.page.historyHelp'), onPress: () => setPage('versions') }
      ]} />
    </View>
  );
  return (
    <Screen header={<Header title={v.title} sub={v.language} onBack={ctx.back} />} footer={footer}>
      {/* Whether this passage comes along without a connection, without scrolling (decisions.md 61). */}
      <PassageOfflineLine ctx={ctx} unitId={unitId} />
      {waiting ? <Text style={[txt.sm, { color: TINT.amberText }]}>{waiting}</Text> : null}
      <EarlierNote ctx={ctx} unitId={unitId} languageId={languageId} />
      <PassagePath ctx={ctx} steps={steps} team={team} peopleOf={(kindId) => checkPeople(v.state, kindId)} onStep={onStep} onTeamStep={onTeamStep} extraFor={extraFor} />
      <EarlierSections ctx={ctx} unitId={unitId} languageId={languageId} />
      {sheets}
    </Screen>
  );
}

/** One of the ways forward on "Something else?": a big card row. */
function BigOption(props: { icon: IconName; label: string; sub: string; onPress: () => void; testID?: string }) {
  return (
    <Group>
      <Row {...(props.testID ? { testID: props.testID } : {})} icon={props.icon} label={props.label} sub={props.sub} onPress={props.onPress} last />
    </Group>
  );
}

function SmallOption(props: { icon: IconName; label: string; onPress: () => void; testID?: string; help?: string }) {
  const spot = useHelpSpot(props.label, props.help, props.onPress);
  return (
    <Pressable {...(props.testID ? { testID: props.testID } : {})} onPress={spot.onPress} accessibilityRole="button" style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}>
      <Ico name={props.icon} size={20} color={props.icon === 'chat' ? TINT.amberText : C.primary} />
      <Text style={[txt.sm, { fontWeight: '700', flex: 1 }]}>{props.label}</Text>
      <HelpBadge spot={spot} />
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
      {review.commentBlobHash ? (
        <AudioClip language={ctx.language} hashes={[review.commentBlobHash]}
          label={who === ctx.name(ctx.session.actorId) ? t('passage.page.playYourFeedback') : t('passage.page.playFeedback', { name: who })} />
      ) : <Ico name="chat" size={18} color={TINT.amberText} />}
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
        void perform(ctx, (c) => c.depart(keepInput({ commandId: newId(), unitId: v.unitId, reviewId: props.reviewId, reason: r })),
          t('passage.keep.done'), undoDepart, t('passage.page.undone.keep'));
      }} />
  );
}

function AddNoteSheet(props: { ctx: Ctx; v: PassageView; onClose: () => void; say?: boolean }) {
  const { ctx, v } = props;
  // Kept as it is said or typed, only for whoever is writing it, until it is added (decision 127).
  const draft = useDraft(draftKey('note', ctx.session.actorId, v.languageId, v.unitId, 'passage'), EMPTY_NOTE, isNoteDraft);
  const { text, hash } = draft.value;
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const ok = await perform(ctx, (c) => c.addNote(noteInput({ commandId: newId(), unitId: v.unitId, text, hash })), t('passage.addNote.done'), undoNote);
    setBusy(false);
    if (ok) { await draft.clear(); props.onClose(); }
  };
  return (
    <Sheet visible title={props.say ? t('passage.else.sayInstead') : t('common.addNote')}
      sub={props.say ? t('passage.addNote.saySub') : t('passage.addNote.sub')} onClose={props.onClose}
      action={<SavedMark status={draft.status} help={t('saved.draftHelp')} />}
      footer={<PrimaryBtn label={t('passage.addNote.save')} disabled={!hasWords(text, hash)} busy={busy} onPress={() => void save()} />}>
      <VoiceNote ctx={ctx} label={t('common.sayIt')} hash={hash} onChange={(h) => draft.set((d) => ({ ...d, hash: h }))} />
      <Field value={text} onChangeText={(x) => draft.set((d) => ({ ...d, text: x }))} placeholder={t('common.orTypeIt')} multiline />
    </Sheet>
  );
}

/**
 * One kind of review on a step: its state, who, and its actions (REC-3), as
 * recordModel.ts `stepSheet` gives them. In the step sheet every action
 * shows; on the path (`compact`) only the main button, and More opens the
 * step sheet with the rest (ADR-029).
 */
function KindActionRow(props: {
  row: SheetRow;
  step: FlowStepStatus;
  first: boolean;
  compact: boolean;
  onAction: (a: RowAction, k: KindStatus, step: FlowStepStatus, askedMe: boolean) => void;
  onMore: () => void;
}) {
  const { row, step } = props;
  const { status, acts } = row;
  const btn = (a: RowAction, tone: 'primary' | 'plain') => (
    <SmallBtn label={a.label} tone={tone} help={actionHelp(a.id)} onPress={() => props.onAction(a, status, step, acts.askedMe)} />
  );
  const { others, compactButtons } = rowBar(acts, props.compact);
  return (
    <View style={[styles.kindRow, !props.first && styles.topBorder]}>
      <View style={styles.rowCenter}>
        <KindIcon kindId={status.kindId} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[txt.sm, { fontWeight: '700' }]}>{row.name}</Text>
          {row.sub ? <Text style={[txt.xs, { marginTop: 2 }]}>{row.sub}</Text> : null}
        </View>
        <HelpInfo label={stateLabel(status.state)} detail={markHelp(status.state)}>
          <View accessibilityLabel={stateLabel(status.state)}><StateMark state={status.state} size={22} /></View>
        </HelpInfo>
      </View>
      {compactButtons ? (
        <View style={styles.btnRow}>
          {acts.primary ? <View style={{ flex: 1 }}>{btn(acts.primary, row.waits ? 'plain' : 'primary')}</View> : null}
          {others > 0 ? (
            <View style={acts.primary ? undefined : { flex: 1 }}>
              <SmallBtn label={acts.primary ? t('passage.page.more') : t('passage.page.options')} help={t('passage.page.moreHelp')} onPress={props.onMore} />
            </View>
          ) : null}
        </View>
      ) : null}
      {!props.compact && acts.undo ? (
        <View style={styles.btnRow}>
          <SmallBtn label={acts.undo.label} icon="undo" help={actionHelp('undo')} onPress={() => props.onAction(acts.undo!, status, step, acts.askedMe)} />
        </View>
      ) : null}
      {!props.compact && rowButtons(acts).length ? (
        <View style={{ gap: space.sm }}>
          {acts.primary || acts.second ? (
            <View style={styles.btnRow}>
              {acts.primary ? <View style={{ flex: 1 }}>{btn(acts.primary, row.waits ? 'plain' : 'primary')}</View> : null}
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
        <Row key={st.step.id} leading={<StepMark status={st} />} label={st.step.title} sub={stepLine(props.ctx, st)} help={t('passage.page.openStudyStepHelp')} onPress={() => props.onOpen(st.step.id)} />
      ))}
    </>
  );
}

/** Versions (rows, newest first) against kinds (columns): which versions have had which reviews. */
function ReviewGrid(props: { ctx: Ctx; v: PassageView; kindIds: string[]; onVersion: (takeId: string) => void; onReview: (reviewId: string) => void }) {
  const { v, kindIds } = props;
  const [shown, setShown] = useState(GRID_STEP);
  const grid = gridModel(v.p, kindIds, v.kind);
  const { rows, producing } = grid;
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ flexGrow: 1 }}>
          {/* The column heads: which check each column is. In help mode they say how the grid reads. */}
          <HelpInfo label={t('passage.page.reviewsByVersion')} detail={t('passage.grid.gridHelp')}>
            <View style={[styles.gridRow, { paddingTop: space.md, paddingBottom: space.sm }]}>
              <View style={{ width: 76 }} />
              {kindIds.map((id) => (
                <View key={id} style={styles.gridCol}>
                  <Ico name={kindIcon(id)} size={16} color={C.muted} />
                  <Text style={[txt.xs, { fontWeight: '600', textAlign: 'center' }]} numberOfLines={1}>{gridColumnName(v.kind(id))}</Text>
                </View>
              ))}
            </View>
          </HelpInfo>
          {rows.slice(0, shown).map((row, ri) => (
            <View key={row.version.takeId} style={[styles.gridRow, styles.topBorder]}>
              <GridVersion n={row.version.n} hlc={row.version.hlc} onPress={() => props.onVersion(row.version.takeId)} />
              {row.cells.map((cell) => {
                const kind = { ...v.kind(cell.kindId), name: checkName(cell.kindId, v.kinds) };
                const shown = gridCell(cell, { newest: ri === 0, grid, produces: !!kind.produces });
                return (
                  <View key={cell.kindId} style={styles.gridCol}>
                    {shown.id === 'review' ? (
                      <GridCell label={gridCellLabel(kind.name, shown.review, shown.count, props.ctx.name)}
                        help={shown.produced ? t('passage.grid.madeHelp', { kind: kindInSentence(kind.name) }) : t('passage.grid.cellHelp', { mark: markHelp(reviewMark(shown.review)) })}
                        onPress={() => props.onReview(shown.review.id)}>
                        {shown.produced
                          // Made content, not a verdict: its own mark, never a "looks good" tick.
                          ? <View style={[styles.producedMark]}><Ico name={kindIcon(cell.kindId)} size={14} color={C.primary} /></View>
                          : <StateMark state={reviewMark(shown.review)} size={24} />}
                        {shown.count > 1 ? <View style={styles.countBadge}><Text style={[txt.xsStrong, { color: C.white }]}>{shown.count}</Text></View> : null}
                      </GridCell>
                    ) : shown.id === 'skipped' ? <HelpInfo label={stateLabel('skipped')} detail={markHelp('skipped')}><StateMark state="skipped" size={24} /></HelpInfo>
                      : shown.id === 'asked' ? <HelpInfo label={stateLabel('asked')} detail={markHelp('asked')}><StateMark state="asked" size={24} /></HelpInfo>
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
            <Text style={txt.xs}>{t('passage.grid.kindRecorded', { kind: checkName(k.id, v.kinds) })}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** A version's row head in the grid: opens the version. */
function GridVersion(props: { n: number; hlc: string; onPress: () => void }) {
  const label = t('passage.page.openVersion', { version: versionTitle(props.n) });
  const spot = useHelpSpot(label, t('passage.page.openVersionHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [styles.gridVersion, pressed && { opacity: 0.6 }]}>
      <Text style={[txt.sm, { fontWeight: '700', color: C.primary }]}>{t('passage.grid.versionShort', { n: props.n })}</Text>
      <Text style={txt.xs} numberOfLines={1}>{when(props.hlc)}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** A review's mark in the grid: opens the review; in help mode, says what its mark means. */
function GridCell(props: { label: string; help: string; onPress: () => void; children: ReactNode }) {
  const spot = useHelpSpot(props.label, props.help, props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={props.label}
      style={({ pressed }) => [styles.gridCell, pressed && { opacity: 0.6 }]}>
      {props.children}
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** One entry of the passage's history: who and when first, so a long reason never hides them. */
function HistoryRow(props: { text: EntryText; when: string; last: boolean; trailing: ReactNode; onPress?: () => void; help?: string }) {
  const { text } = props;
  return (
    <Row label={text.title} sub={`${text.who} · ${props.when}${text.sub ? ` — ${text.sub}` : ''}`} last={props.last} {...(text.struck ? { struck: true } : {})}
      leading={(
        <View style={[styles.historyIcon, { backgroundColor: withAlpha(text.color, 0.1) }]}>
          <Ico name={text.icon} size={16} color={text.color} />
        </View>
      )}
      {...(props.trailing ? { right: props.trailing } : {})} {...(props.onPress ? { onPress: props.onPress } : {})} {...(props.help ? { help: props.help } : {})} />
  );
}

// ---- version_detail (REC-9) --------------------------------------------------------------

/**
 * One version: what changed and why, its takes, the key terms tied to it,
 * its reviews and notes. Its footer edits it into a new draft, and deletes
 * it while it is the person's latest and nobody has checked it (LAN-83).
 */
export function VersionDetail(ctx: Ctx) {
  const v = usePassage(ctx);
  const guide = useStudyGuide(ctx, v?.unitId);
  // Deleting the version asks first (LAN-83).
  const [asking, setAsking] = useState(false);
  if (!v) return <Missing ctx={ctx} id="version_detail" />;
  const { p, unitId, languageId } = v;
  const version = versionFor(p, ctx.params['takeId']);
  if (!version) return <Missing ctx={ctx} id="version_detail" crumbsOf={v} text={t('passage.version.nothingRecorded')} />;
  const { title, reviews, prompted, terms, notes } = versionDetailModel(v, version);
  // A deleted version opens as what it was, with when and by whom it was deleted (LAN-83).
  const gone = p.deletedVersions.find((x) => x.takeId === version.takeId);
  const key = (part: string) => `version:${unitId}:${languageId}:${version.takeId}:${part}`;
  const params = { unitId, languageId };
  const canEdit = recordCan(ctx.session).record;
  const deletable = canEdit && canDeleteVersion(p, version.takeId, ctx.session.actorId);
  const durations = cardDurations(v.state, unitId);
  const footer = canEdit ? (
    <View style={styles.versionFooter}>
      <View style={{ flex: 1 }}>
        <PrimaryBtn label={t('common.edit')} icon="edit" help={t('passage.versions.editVersionHelp')} onPress={() => ctx.go('workspace', { ...params, from: version.takeId })} />
      </View>
      {deletable ? (
        <IconBtn name="trash" label={t('passage.versions.delete', { name: title })} help={t('passage.versions.deleteVersionHelp')} bg={TINT.red} color={TINT.redText}
          onPress={() => setAsking(true)} />
      ) : null}
    </View>
  ) : undefined;
  return (
    <Screen footer={footer} header={<Header title={title} crumbs={passageCrumbs(ctx, v, title)} onBack={ctx.back}
      sub={gone ? `${t('passage.record.entry.versionDeleted', { n: version.n })} · ${ctx.name(gone.deleted.by)} · ${when(gone.deleted.hlc)}` : `${ctx.name(version.by)} · ${when(version.hlc)}`}
      action={<ReportFlag ctx={ctx} target={recordTarget(ctx, 'version', version.takeId, version.by, unitId)} />} />}>
      <Card>
        <Label text={version.n === 1 ? t('passage.version.note') : t('passage.version.whatChanged')} />
        <Authored ctx={ctx} by={version.by}>
          <Text style={txt.body}>{changeNoteText(version)}</Text>
          {version.changeBlobHash ? <PlayRow ctx={ctx} hashes={[version.changeBlobHash]} label={t('passage.version.changeAloud')} /> : null}
        </Authored>
        {prompted.map((r) => (
          <InResponseLink key={r.id} label={t('passage.version.inResponseTo', { kind: checkName(r.kindId, v.kinds), who: feedbackSource(r, ctx.name) })}
            onPress={() => ctx.go('review_detail', { ...params, reviewId: r.id })} />
        ))}
      </Card>

      <SectionLabel label={t('passage.version.recording')} />
      <Authored ctx={ctx} by={version.by}>
        <VersionRecording ctx={ctx} state={v.state} unitId={unitId} title={title} hashes={version.cardHashes} />
      </Authored>
      <UsedLine ctx={ctx} state={v.state} subject={{ takeId: version.takeId }} detailsKey={key('used')} />

      {terms.length > 0 || reviews.length > 0 || notes.length > 0 ? <SectionLabel label={t('passage.version.details')} /> : null}
      {terms.length > 0 ? (
        <Disclosure icon="book" title={t('passage.version.keyTerms')}
          summary={termsTiedSummary(terms)}
          {...ctx.details(key('terms'))}>
          {terms.map(({ term, note }, i) => (
            <Row key={term.termId} icon="book" label={termLabel(term)} {...(note ? { sub: note } : {})}
              help={t('passage.version.termHelp')}
              onPress={() => ctx.go('key_term_detail', { ...params, termId: term.termId })} last={i === terms.length - 1} />
          ))}
        </Disclosure>
      ) : null}
      {reviews.length > 0 ? (
        <Disclosure icon="chat" title={t('passage.version.reviews')} summary={versionReviewsSummary(reviews, v.kinds)} {...ctx.details(key('reviews'))}>
          {reviews.map((r, i) => {
            const kind = { ...v.kind(r.kindId), name: checkName(r.kindId, v.kinds) };
            return (
              <Row key={r.id} leading={kind.produces ? <KindIcon kindId={r.kindId} size={36} /> : <StateMark state={reviewMark(r)} size={24} />}
                label={`${kind.name} · ${outcomeText(kind, r.outcome)}`} sub={`${feedbackSource(r, ctx.name)} · ${when(r.hlc)} · ${viaText(r, ctx.name)}`}
                help={t('passage.page.openReviewHelp')}
                onPress={() => ctx.go('review_detail', { ...params, reviewId: r.id })} last={i === reviews.length - 1} />
            );
          })}
        </Disclosure>
      ) : (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('passage.version.noReviews')}</Text>
      )}
      {notes.length > 0 ? (
        <Disclosure icon="note" title={t('passage.version.notes')}
          summary={notesSummary(notes, (by, text) => authoredText(ctx, by, text))} {...ctx.details(key('notes'))}>
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
      {deletable ? (
        <ConfirmDelete visible={asking} name={title} sub={t('recording.parts.groupSub', { count: version.cardHashes.length, length: mmss(totalMs(version.cardHashes.map((h) => durations.get(h)))) })}
          onClose={() => setAsking(false)} onConfirm={() => { setAsking(false); deleteVersion(ctx, v, version, ctx.back); }} />
      ) : null}
    </Screen>
  );
}

/** "In response to the peer check from Ana": opens the feedback this version answered. */
function InResponseLink(props: { label: string; onPress: () => void }) {
  const spot = useHelpSpot(props.label, t('passage.version.inResponseHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="link" style={({ pressed }) => [styles.inlineLink, pressed && { opacity: 0.6 }]}>
      <Ico name="chat" size={16} color={C.primary} />
      <Text style={[txt.link, { flex: 1 }]}>{props.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
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
    const ok = await perform(ctx, (c) => c.depart(keepPageInput({ commandId: newId(), unitId: v.unitId, reviewId: review.id, text, hash })),
      t('passage.keep.done'), undoDepart, t('passage.page.undone.keep'));
    setBusy(false);
    if (ok) ctx.back();
  };
  return (
    <Screen header={<Header title={v.title} sub={t('passage.keep.sayWhyTitle')} onBack={props.onBack} />}
      footer={<PrimaryBtn label={t('passage.keep.keepIt')} icon="check" help={t('passage.keep.keepItHelp')} busy={busy} disabled={!hasWords(text, hash)} onPress={() => void keep()} />}>
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
  useHardwareBack(keepPage, () => setKeepPage(false));
  if (!v) return <Missing ctx={ctx} id="review_detail" />;
  const { p, unitId, languageId } = v;
  const review = reviewFor(p, ctx.params['reviewId']);
  if (!review) return <Missing ctx={ctx} id="review_detail" crumbsOf={v} text={t('passage.review.noReviews')} />;
  const me = ctx.session.actorId;
  const params = { unitId, languageId };
  const { kind, makes, checkedBy, good, request, questions, answers, skipped, source, version, tone, answerable, outcome } = reviewDetailModel({
    v, review, me, name: ctx.name, mayAnswer: ctx.session.can('translate') && canGo(ctx, 'review_detail', 'workspace')
  });
  const tint = OUTCOME_TINT[tone];
  const artifacts = review.artifacts && review.artifacts.length > 0 ? (
    <Card>
      <Text style={[txt.sm, { fontWeight: '700' }]}>{makes ? t('passage.review.madeInto', { what: makes.what, into: makes.into }) : t('passage.journey.captured')}</Text>
      <PlayRow ctx={ctx} hashes={review.artifacts.map((c) => c.hash)} label={makes ? t('passage.journey.playMade', { what: makes.what }) : t('passage.review.playRecording')}
        sub={t('passage.review.parts', { count: review.artifacts.length })} />
    </Card>
  ) : null;

  if (answerable && keepPage) {
    return <KeepPage ctx={ctx} v={v} review={review} source={source} onBack={() => setKeepPage(false)} />;
  }
  if (answerable) {
    return (
      <Screen header={<Header title={v.title} onBack={ctx.back} close
        action={<ReportFlag ctx={ctx} target={recordTarget(ctx, 'review', review.id, review.by, unitId)} />} />}
        footer={(
          <View style={{ gap: space.sm }}>
            <PrimaryBtn label={t('passage.review.recordFix')} icon="mic" help={t('passage.review.recordFixHelp')} onPress={() => ctx.go('workspace', { ...params, reviewId: review.id })} />
            <GhostBtn label={t('passage.keep.sayWhyTitle')} help={t('passage.keep.sayWhyHelp')} onPress={() => setKeepPage(true)} />
          </View>
        )}>
        <View style={{ alignItems: 'center', gap: space.sm, paddingTop: space.xl }}>
          <View style={styles.amberPill}>
            <Ico name="chat" size={16} color={TINT.amberText} />
            <Text style={[txt.sm, { fontWeight: '800', color: TINT.amberText }]}>{t('passage.path.feedbackSub', { kind: checkName(review.kindId, v.kinds) })}</Text>
          </View>
          <View style={{ marginTop: space.md }}><PersonAvatar look={look(review.by)} size={72} /></View>
          <Text style={[txt.h2, { fontWeight: '800' }]}>{source}</Text>
          <Text style={txt.smMuted}>{[when(review.hlc), version ? versionName(p, version) : ''].filter(Boolean).join(' · ')}</Text>
        </View>
        <Authored ctx={ctx} by={review.by}>
          <View style={styles.feedbackCard}>
            {review.commentBlobHash ? (
              <ClipPlayer language={ctx.language} hashes={[review.commentBlobHash]} title={t('passage.review.whoseFeedback', { name: source })} tone="amber" bare />
            ) : null}
            {!makes && review.artifacts?.length ? (
              <ClipPlayer language={ctx.language} hashes={review.artifacts.map((c) => c.hash)} title={t('passage.review.whoseFeedback', { name: source })} tone="amber" bare />
            ) : null}
            {review.comment ? <Text style={[txt.body, { fontSize: 18, lineHeight: 26 }]}>{t('passage.quote', { text: review.comment })}</Text> : null}
            {feedbackIsEmpty(review) ? <Text style={txt.smMuted}>{t('passage.review.noWords')}</Text> : null}
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
          <LinkBtn label={t('passage.review.hearVersion', { version: versionTitle(version.n) })} help={t('passage.page.openVersionHelp')} onPress={() => ctx.go('version_detail', { ...params, takeId: version.takeId })}
            style={{ alignSelf: 'center' }} />
        ) : null}
      </Screen>
    );
  }

  // Your own review, taken back from here too (decisions.md 111); one taken back reads crossed out, grey.
  const mine = review.by === me && !review.withdrawn;
  const undone = review.withdrawn ? (isJustNow(review.withdrawn.hlc) ? t('passage.record.entry.undoneJustNow') : t('passage.record.entry.undone', { when: when(review.withdrawn.hlc) })) : '';
  const fg = review.withdrawn ? C.muted : tint.fg;
  return (
    <Screen header={<Header title={kind.name} crumbs={passageCrumbs(ctx, v, kind.name)} sub={when(review.hlc)} onBack={ctx.back}
      action={<ReportFlag ctx={ctx} target={recordTarget(ctx, 'review', review.id, review.by, unitId)} />} />}
      footer={answerable ? (
        <View style={styles.btnRow}>
          <View style={{ width: '44%' }}><GhostBtn label={t('passage.keep.keepIt')} help={t('passage.keep.sayWhyHelp')} onPress={() => setKeeping(true)} /></View>
          <View style={{ flex: 1 }}><PrimaryBtn label={t('passage.review.recordFix')} icon="mic" help={t('passage.review.recordFixHelp')} onPress={() => ctx.go('workspace', { ...params, reviewId: review.id })} /></View>
        </View>
      ) : mine ? (
        <GhostBtn label={t('passage.page.undo')} icon="undo" help={t('passage.page.actionHelp.undo')}
          onPress={() => void perform(ctx, (c) => c.withdrawReviews({ commandId: newId(), reviewIds: [review.id] }), t('common.undone'))} />
      ) : undefined}>
      <View style={[styles.outcome, { backgroundColor: review.withdrawn ? C.bg : tint.bg }]}>
        <View style={[styles.roundTile, { backgroundColor: C.card, width: 44, height: 44, borderRadius: 22 }]}>
          <Ico name={review.withdrawn ? 'undo' : makes ? kindIcon(review.kindId) : good ? 'check' : 'chat'} size={22} color={fg} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[txt.body, { fontWeight: '700', color: fg }, review.withdrawn && { textDecorationLine: 'line-through' }]}>{outcome}</Text>
          <Text style={[txt.xs, { color: fg, marginTop: 2 }]}>{[source, viaText(review, ctx.name), undone].filter(Boolean).join(' · ')}</Text>
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
            sub={`${ctx.name(version.by)} · ${when(version.hlc)}`} help={t('passage.page.openVersionHelp')}
            onPress={() => ctx.go('version_detail', { ...params, takeId: version.takeId })} last />
        </Group>
      ) : null}
      <UsedLine ctx={ctx} state={v.state} subject={{ reviewId: review.id }} detailsKey={`review:${unitId}:${languageId}:${review.id}:used`} />
      {hasFeedback(review) ? (
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
          summary={answersSummary(answers.length, skipped.length)}
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
                <Text style={txt.xs}>{skippedQuestionText(questions, qid)}</Text>
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
          <Label color={C.primary} text={responseLine(review.response, ctx.name, when(review.response.hlc))} />
          <Authored ctx={ctx} by={review.response.by}>
            {review.response.note ? <Text style={txt.body}>{review.response.note}</Text> : null}
            {review.response.blobHash ? <PlayRow ctx={ctx} hashes={[review.response.blobHash]} label={t('passage.review.answerAloud')} /> : null}
          </Authored>
          {review.response.revisedTakeId ? (() => {
            const revised = revisedVersion(p, review.response);
            return revised ? (
              <LinkBtn label={t('passage.page.openVersion', { version: versionTitle(revised.n) })} help={t('passage.page.openVersionHelp')} onPress={() => ctx.go('version_detail', { ...params, takeId: revised.takeId })} />
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
  const [othersShown, setOthersShown] = useState(PEOPLE_STEP);
  const [busy, setBusy] = useState(false);
  const vState = v?.state;
  const vLanguageId = v?.languageId;
  const orgState = ctx.org.state;
  const candidates = useMemo(() => (vState && vLanguageId !== undefined ? askCandidates(vState, orgState, { languageId: vLanguageId, what, ...(kindId ? { kindId } : {}), me }) : []),
    [vState, vLanguageId, orgState, what, kindId, me]);
  if (!v) return <Missing ctx={ctx} id="ask_someone" />;
  if (what === 'review' && !kindId) {
    return <Missing ctx={ctx} id="ask_someone" crumbsOf={v} text={t('passage.ask.fromItsStep')} />;
  }

  const kind = kindId ? v.kind(kindId) : undefined;
  const picks: AskPicks = { mode, who, guestName, contact };
  const model = askModel({ v, org: ctx.org.state, me, name: ctx.name, what, kindId, candidates, picks });
  // The check's team (decision 91): everyone on it gets the request, and it is the first choice.
  const { isRecord, check, title, usual, others, team, teamPeople, chosen, asked, outside, ready } = model;

  const send = async () => {
    if (!ready) return;
    setBusy(true);
    const ok = await perform(ctx, (c) => c.ask(askInput({ commandId: newId(), unitId: v.unitId, what, model, picks, channel, note, noteHash, questions })),
    askDoneText(model),
    (applied) => (c) => c.withdrawRequest({ commandId: newId(), requestId: payloadField(applied, 'requestId') }));
    setBusy(false);
    if (ok) ctx.go('passage_record', { unitId: v.unitId, languageId: v.languageId, asked: String(Date.now()) });
  };
  const personRow = (c: { profileId: string; sub: string }, last: boolean) => {
    const on = who === c.profileId;
    return (
      <Row key={c.profileId} testID={`ask-person-${c.profileId}`} leading={<PersonAvatar look={look(c.profileId)} size={36} />} label={ctx.name(c.profileId)} sub={c.sub}
        help={t('passage.ask.personHelp')} onPress={() => setWho(c.profileId)} last={last} role="radio" selected={on}
        right={<View style={[styles.radio, on && { backgroundColor: C.primary, borderColor: C.primary }]}>{on ? <Ico name="check" size={14} color={C.white} strokeWidth={3} /> : null}</View>} />
    );
  };

  return (
    <Screen header={<Header title={title} sub={`${v.title} · ${v.language}`} onBack={ctx.back} close />}
      footer={<PrimaryBtn label={model.buttonLabel}
        help={outside ? t('passage.ask.sendOutsideHelp') : t('passage.ask.sendHelp')} disabled={!ready} busy={busy} onPress={() => void send()} />}>
      <Card style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        {kindId ? <KindIcon kindId={kindId} size={44} /> : <View style={[styles.roundTile, { width: 44, height: 44, borderRadius: 14, backgroundColor: C.light }]}><Ico name="mic" size={22} color={C.primary} /></View>}
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text style={txt.h3}>{isRecord ? (v.p.recorded ? t('passage.else.newVersion') : t('passage.ask.recordIt')) : check}</Text>
          <Text style={txt.xs}>{isRecord ? t('passage.ask.recordSub') : kind?.description}</Text>
        </View>
      </Card>

      <SectionLabel label={t('passage.ask.who')} />
      {!isRecord ? (
        <ChipRow>
          <Chip label={t('passage.ask.onTeam')} on={mode === 'team'} help={t('passage.ask.onTeamHelp')} onPress={() => setMode('team')} />
          <Chip label={t('passage.ask.withoutApp')} on={mode === 'outside'} help={t('passage.ask.withoutAppHelp')} onPress={() => setMode('outside')} />
        </ChipRow>
      ) : null}
      {!outside ? (
        <Group>
          {team ? (
            <Row testID="ask-team" leading={<Faces people={teamPeople} size={30} />} sub={teamPeople.map((id) => ctx.name(id)).join(t('admin.list.separator'))}
              label={t('checks.theTeam', { check })} help={t('passage.ask.teamHelp')} onPress={() => setWho(TEAM)} role="radio" selected={chosen === TEAM}
              right={<View style={[styles.radio, chosen === TEAM && { backgroundColor: C.primary, borderColor: C.primary }]}>{chosen === TEAM ? <Ico name="check" size={14} color={C.white} strokeWidth={3} /> : null}</View>} />
          ) : null}
          {usual.length > 0 && !team ? <View style={styles.groupHead}><Label text={check || t('passage.ask.usuallyDoesThis')} color={C.primary} /></View> : null}
          {usual.map((c, i) => personRow(c, i === usual.length - 1 && others.length === 0))}
          {others.length > 0 && (usual.length > 0 || team) ? <View style={[styles.groupHead, styles.topBorder]}><Label text={t('checks.everyoneElse')} /></View> : null}
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
            <Chip label={channelLabel('whatsapp')} on={channel === 'whatsapp'} help={t('passage.ask.whatsappHelp')} onPress={() => setChannel('whatsapp')} />
            <Chip label={channelLabel('sms')} on={channel === 'sms'} help={t('passage.ask.smsHelp')} onPress={() => setChannel('sms')} />
          </View>
          <Field value={contact} onChangeText={setContact} placeholder={t('passage.ask.phone')} keyboardType="phone-pad" help={t('passage.ask.phoneHelp')} />
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

      {!isRecord ? <TheyAnswer asked={asked} questions={questions} setQuestions={setQuestions}
        {...(kindId && ctx.session.can('manage_flows') ? { check: { name: model.check, open: () => ctx.go('check_editor', { languageId: v.languageId, kindId }) } } : {})} /> : null}
    </Screen>
  );
}

/** How the review's outcome card is coloured (reviewModel.ts `OutcomeTone`). */
const OUTCOME_TINT: Record<OutcomeTone, { bg: string; fg: string }> = {
  made: { bg: C.light, fg: C.primary },
  good: { bg: TINT.green, fg: TINT.greenText },
  amber: { bg: TINT.amber, fg: TINT.amberText }
};

const styles = StyleSheet.create({
  versionFooter: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  amberPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.full, backgroundColor: TINT.amber },
  feedbackCard: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: 1, borderColor: TINT.noteBorder, padding: space.lg, gap: space.md },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { flexGrow: 1, flexBasis: '45%', flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 56, paddingHorizontal: space.md,
    borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, backgroundColor: C.card },
  notePill: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.lg, backgroundColor: TINT.amber },
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

/** The `voice` slot of ReasonSheet. */
function voiceFor(ctx: Ctx, label?: string) {
  return ({ hash, onChange }: { hash: string | null; onChange: (h: string | null) => void }) => (
    <VoiceNote ctx={ctx} label={label ?? t('recording.voiceNote.sayWhyInstead')} hash={hash} onChange={onChange} />
  );
}
