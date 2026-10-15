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
import { Faces, PeopleLine } from '../checks/parts';
import { checkName } from '../simple/adminModel';
import {
  CommandError, checkPeople, commands, draftsBy, keyTermLinksFor, questionsForKind, recordTimeline, reviewGrid,
  type Commands, type EventSpec, type FlowStepStatus, type KindState, type KindStatus, type PassageNote, type QuestionSpec, type ReviewView
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useHardwareBack } from '../hardwareBack';
import { Text } from '../text';
import { AudioClip } from '../audioClip';
import { commandErrorText, stateLabel, stepName } from '../coreText';
import type { Ctx } from '../ctx';
import { edgeFor, screenTitle, type ScreenId } from '../flow';
import { currentLocale, t, Trans } from '../i18n';
import { indexesFor } from '../indexes';
import {
  Badge, Card, Chip, ChipRow, Disclosure, EmptyState, Field, GhostBtn, Group, Header, HelpInfo, Ico, IconBtn, KindIcon, kindIcon, LinkBtn,
  NoteCard, PrimaryBtn, QuietLinks, ReasonSheet, Row, Screen, SectionLabel, Sheet, ShowMore, SmallBtn, StateMark, txt,
  type IconName, HelpTop
} from '../kit';
import {
  addDays, anchorLabel, answeredQuestions, askCandidates, channelLabel, currentStepId, describeEntry, dueChoices, dueError,
  gridKindIds, guestMessage, heroHeadline, historySummary, isoDay, listenersOf, nextQuestionType, questionTypeLabel,
  reviewMark, reviewsSummary, SAID_BY_VOICE, sendTargetLabel, versionReviewsSummary, type EntryText,
  type RowAction
} from '../passage/record';
import { PassagePath } from '../passage/path';
import { VersionsPage } from '../passage/versions';
import { useVersesHeld, VersionRecording } from '../passage/versionParts';
import { pathSteps, teamSteps, type PathStep, type TeamStep } from '../passage/pathModel';
import {
  currentCheck, elseOptions, recordCan, recordModel, recordPathInput, rowButtons, stepSheet, teamStepsOpen, usualTargets, waitingOnAnswer,
  type ElseOption, type RecordMain, type SheetRow
} from '../passage/recordModel';
import { clipSeconds, clock as clockOf } from '../clipPlayer';
import { useHelpSpot } from '../helpContext';
import { HelpBadge } from '../helpBadge';
import { requestIsMine, sendToInput, teamNameIn, usualTargetFor } from '../passage/sendTarget';
import {
  commaList, dueTitle, feedbackSource, kindInSentence, outcomeText, passageCrumbs, usePassage, versionTitle, viaText, when, type PassageView
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
  // Asking someone comes back to the path, where the request shows, even when it started from "Something else?".
  const askedParam = ctx.params['asked'];
  useEffect(() => { if (askedParam) setPage('path'); }, [askedParam]);
  useHardwareBack(page !== 'path', () => setPage('path'));
  const [historyShown, setHistoryShown] = useState(HISTORY_STEP);
  // Which of the checks that happen next the ask page sends (decision 91): the first, unless another is picked.
  const [askKindId, setAskKindId] = useState<string | null>(null);
  // Questions added on the ask page, sent with the request (as Someone else can).
  const [askQuestions, setAskQuestions] = useState<QuestionSpec[]>([]);
  const timeline = useMemo(() => (v ? recordTimeline(v.state, v.p) : []), [v?.state, v?.p]);
  const guide = useStudyGuide(ctx, v?.unitId);
  const study = useMemo(() => (v && guide ? studyProgress(v.state, v.p, guide) : null), [v?.state, v?.p, guide]);
  const versesHeld = useVersesHeld(ctx, v?.state, v?.unitId);
  const me = ctx.session.actorId;
  const isAuthor = !!v?.p.latest && v.p.latest.by === me;
  // Whoever just published (a version, or a back translation) asks for the next check (demo ADR-034).
  const asker = isAuthor || !!publishedParam?.startsWith('bt');
  // Where each of the flow's kinds usually goes; only its author sends a version on (ADR-029).
  const targets = useMemo(
    () => (v ? usualTargets(v.state, ctx.org.state, { p: v.p, languageId: v.languageId, me, asker }) : {}),
    [v?.state, v?.languageId, v?.p.flow, ctx.org.state, me, asker]
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
  const sheetOf = (step: FlowStepStatus) => stepSheet({ p, kinds, kind: v.kind, step, can, isAuthor, me, mine, name: ctx.name, teamName, targets });
  const undoFromHistory = (departureId: string, type: string) => void perform(ctx, (c) => c.undoDeparture({ commandId: newId(), departureId }),
    type === 'override' ? t('passage.page.undone.override')
      : type === 'keep' ? t('passage.page.undone.keep') : t('passage.page.undone.skip'));
  const withdraw = (requestId: string) => void perform(ctx, (c) => c.withdrawRequest({ commandId: newId(), requestId }), t('passage.page.withdrawn'));

  // ---- the path ----
  const latestSeconds = p.latest ? clipSeconds(v.state, p.latest.cardHashes) : 0;
  const pathInput = recordPathInput({
    p, kinds, me, name: ctx.name, teamName,
    study: study && study.steps.length > 0 ? { name: t('passage.page.studyGuideName', { pattern: study.guide.pattern }), total: study.steps.length, done: study.doneCount } : null,
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
    label: m.label, icon: m.icon, help: mainHelp(m),
    onPress: m.id === 'hearFeedback' ? () => go('review_detail', { reviewId: m.reviewId })
      : m.id === 'check' ? () => go(m.produces ? 'back_translation' : 'review_capture', { kindId: m.kindId, ...(m.requestId ? { requestId: m.requestId } : {}) })
      : m.id === 'study' ? () => go('study_guide')
      : m.id === 'record' ? recordOrPick
      : () => { setAskAfterPublish(false); setPage('ask'); }
  };

  const onStep = (st: PathStep): (() => void) | undefined => {
    if (earlierHere) {
      const take = (st.kind === 'record' || st.kind === 'publish') && st.state === 'done' ? p.latest?.takeId : undefined;
      return take ? () => go('version_detail', { takeId: take }) : undefined;
    }
    if (st.kind === 'study') return () => go('study_guide');
    if (st.kind === 'record') {
      if (st.state === 'done' && p.latest) { const takeId = p.latest.takeId; return () => go('version_detail', { takeId }); }
      return can.record ? recordOrPick : undefined;
    }
    if (st.kind === 'publish') {
      if (st.state === 'done' && p.latest) { const takeId = p.latest.takeId; return () => go('version_detail', { takeId }); }
      return can.record && p.drafting ? recordOrPick : undefined;
    }
    if ((st.kind === 'feedback' || st.kind === 'fix') && feedbackReview) return () => go('review_detail', { reviewId: feedbackReview.id });
    return undefined;
  };
  const canAct = teamStepsOpen(can);
  const onTeamStep = (step: TeamStep): (() => void) | undefined => (canAct && !earlierHere ? () => setOpenStepId(step.stepId) : undefined);
  const passageNote = p.notes.filter((n) => n.anchor.kind === 'passage' && n.by !== me).at(-1);
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
            void perform(ctx, (c) => c.depart({ commandId: newId(), unitId, type: 'skip', kindId, stepId, reason: r.reason, ...(r.blobHash ? { reasonBlobHash: r.blobHash } : {}) }),
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
            void perform(ctx, (c) => c.depart({ commandId: newId(), unitId, type: 'override', stepId, reason: r.reason, ...(r.blobHash ? { reasonBlobHash: r.blobHash } : {}) }),
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
      if (o.id === 'recordSomeone') return go('ask_someone', { what: 'record' });
      if (o.id === 'checkSomeone') return go('ask_someone', { what: 'review', kindId: o.kindId! });
      if (o.id === 'already') return go('add_record', { kindId: o.kindId! });
      if (o.id === 'notNow') return setSkipping({ kindId: o.kindId!, stepId: o.stepId! });
      if (o.id === 'newVersion') return recordOrPick();
      return setOverriding(o.stepId!);
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

  // ---- Published, then ask for a check (demo a-ask, a-btAsk; decision 91: each check with its people) ----
  if (page === 'ask') {
    const bt = publishedParam?.startsWith('bt');
    const latest = p.latest;
    const close = () => { setPage('path'); setAskAfterPublish(false); };
    // Where the new version is: sent, sending, or kept here until there is a connection.
    const waiting = ctx.language.pending > 0 || ctx.language.blobs.pendingUp > 0;
    const sendLine = !waiting ? t('passage.published.sent', { title: v.title })
      : ctx.language.online === false ? t('passage.published.savedHere', { title: v.title }) : t('passage.published.sending', { title: v.title });
    return (
      <Screen header={askAfterPublish ? <HelpTop /> : <Header title={t('passage.published.askTitle')} sub={v.title} onBack={close} close />}
        footer={nextKind && can.ask ? (
          <View style={{ gap: space.xs }}>
            <PrimaryBtn label={nextTarget ? t('passage.published.askTarget', { target: sendTargetLabel(nextTarget, ctx.name) })
              : t('passage.page.askFor', { check: kindInSentence(checkName(nextKind.kindId, kinds)) })} icon="send"
              help={nextTarget ? t('passage.ask.sendHelp') : t('passage.page.mainHelp.ask')}
              onPress={() => { close(); sendTo(nextKind.kindId, askQuestions); setAskQuestions([]); }} />
            <QuietLinks items={[
              { label: t('passage.published.someoneElse'), icon: 'people', help: t('passage.published.someoneElseHelp'), onPress: () => { close(); go('ask_someone', { what: 'review', kindId: nextKind.kindId }); } },
              { label: t('common.notNow'), icon: 'clock', help: t('passage.published.notNowHelp'), onPress: close }
            ]} />
          </View>
        ) : <PrimaryBtn label={t('common.done')} icon="check" help={t('passage.published.doneHelp')} onPress={close} />}>
        {askAfterPublish ? (
          <View style={{ alignItems: 'center', gap: space.sm, paddingTop: space.xl }}>
            <View style={styles.bigCheck}><Ico name="check" size={44} color={TINT.greenText} strokeWidth={3} /></View>
            <Text style={[txt.h2, { textAlign: 'center', fontSize: 26, fontWeight: '800' }]} accessibilityRole="header">
              {bt ? t('passage.published.backTranslation') : latest ? t('passage.published.version', { n: latest.n }) : t('passage.published.versionNoNumber')}
            </Text>
            <Text style={[txt.smMuted, { textAlign: 'center' }]}>{sendLine}</Text>
          </View>
        ) : null}
        {nextKind && can.ask ? (
          <View style={{ gap: space.sm, marginTop: askAfterPublish ? space.lg : 0 }}>
            <Text style={txt.label}>{t('passage.published.nextAsk')}</Text>
            {nextKinds.map((k) => (
              <AskCheckCard key={k.kindId} ctx={ctx} kindId={k.kindId} name={checkName(k.kindId, kinds)} on={k.kindId === nextKind.kindId} radio={nextKinds.length > 1}
                people={checkPeople(v.state, k.kindId).filter((id) => id !== me)} onPress={() => setAskKindId(k.kindId)} />
            ))}
            {/* With someone to send it to, the questions they'll answer, and more to add. With nobody yet, the button opens Someone else, which has them. */}
            {can.ask && targets[nextKind.kindId] ? <TheyAnswer asked={questionsForKind(v.state, nextKind.kindId)} questions={askQuestions} setQuestions={setAskQuestions} /> : null}
          </View>
        ) : can.ask ? (
          <Text style={[txt.smMuted, { textAlign: 'center', marginTop: space.lg }]}>
            {p.done ? t('passage.published.allDone') : t('passage.published.alreadyAsked')}
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
          summary={study.doneCount || study.noteCount ? studySummary(study) : t('passage.page.studyNotStarted')}
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
          summary={live.length ? t('passage.page.liveIn', { channel: live[0]!.channel, version: versionTitle(live[0]!.versionN) }) : t('passage.page.listenerCount', { count: listened.length })}
          {...ctx.details(`passage:${unitId}:${languageId}:listeners`)}>
          {live.map((r) => (
            <Row key={r.channel} icon="check" iconColor={TINT.greenText} label={t('passage.page.liveIn', { channel: r.channel, version: versionTitle(r.versionN) })}
              sub={when(r.hlc)} onPress={() => go('version_detail', { takeId: r.takeId })} last={listened.length === 0 && r === live[live.length - 1]} />
          ))}
          {listened.map((r, i) => (
            <Row key={r.id} icon={r.outcome === 'needs_changes' ? 'chat' : 'check'}
              label={r.comment ? t('passage.quote', { text: r.comment }) : r.outcome === 'needs_changes' ? t('passage.view.outcomeStart.needsChanges') : t('passage.view.outcomeStart.looksGood')}
              sub={[feedbackSource(r, ctx.name), versionTitle(r.versionN), when(r.hlc)].join(' · ')}
              onPress={() => go('review_detail', { reviewId: r.id })} last={i === listened.length - 1} />
          ))}
        </Disclosure>
      ) : null}
      {timeline.length > 0 ? (
        <Disclosure icon="history" title={t('passage.page.historyTitle')} summary={historySummary(timeline)} {...ctx.details(`passage:${unitId}:${languageId}:history`)}>
          {timeline.slice(0, historyShown).map((e, i) => {
            const entry = describe(e);
            let onPress: (() => void) | undefined;
            let help: string | undefined;
            let trailing: ReactNode = null;
            if (e.type === 'version') { onPress = () => go('version_detail', { takeId: e.version.takeId }); help = t('passage.page.openVersionHelp'); }
            if (e.type === 'review' || e.type === 'response') { onPress = () => go('review_detail', { reviewId: e.review.id }); help = t('passage.page.openReviewHelp'); }
            if (e.type === 'study') { onPress = () => go('study_step', { stepId: e.stepId }); help = t('passage.page.openStudyStepHelp'); }
            // Taking back an override is the override's own permission (decided 2026-10-13, PASS-056; may_emit holds it).
            if (e.type === 'departure' && !e.departure.undone && (e.departure.type === 'override' ? can.override : can.undo)) {
              trailing = <SmallBtn label={t('passage.page.undo')} icon="undo" help={t('help.details.undo')} onPress={() => undoFromHistory(e.departure.id, e.departure.type)} />;
            }
            if (e.type === 'request' && e.request.status === 'open' && can.withdraw && (e.request.by === me || s.can('assign_work'))) {
              trailing = <SmallBtn label={t('passage.page.withdraw')} help={t('passage.page.withdrawHelp')} onPress={() => withdraw(e.request.id)} />;
            }
            // A note on the whole passage shows only here, so it is reported from here (decisions.md 48);
            // so is someone else's request with words of its own. Versions and reviews open their page, which has the flag.
            if (!trailing && e.type === 'note') {
              trailing = <ReportFlag ctx={ctx} target={recordTarget(ctx, 'note', e.note.id, e.by, unitId)} size={36} />;
            }
            if (!trailing && e.type === 'request' && e.request.by && (e.request.note || e.request.noteBlobHash)) {
              trailing = <ReportFlag ctx={ctx} target={recordTarget(ctx, 'request', e.request.id, e.request.by, unitId)} size={36} />;
            }
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
          {...(nextKind && can.ask ? { ask: { label: t('passage.page.askFor', { check: kindInSentence(nameOf(nextKind.kindId)) }), onPress: () => { setAskAfterPublish(false); setPage('ask'); } } } : {})} />
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

/** One of the checks that happen next, on the ask page: pick it to ask for it (decision 91). */
function AskCheckCard(props: { ctx: Ctx; kindId: string; name: string; on: boolean; radio: boolean; people: string[]; onPress: () => void }) {
  const { on } = props;
  const spot = useHelpSpot(props.name, t('passage.published.pickCheckHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="radio" accessibilityState={{ selected: on, checked: on }} aria-checked={on}
      style={[styles.askCard, !on && { borderWidth: 1, borderColor: C.border }]}>
      <View style={styles.askIcon}><Ico name={kindIcon(props.kindId)} size={24} color={C.primary} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={[txt.body, { fontWeight: '800', fontSize: 19 }]}>{props.name}</Text>
        <PeopleLine ctx={props.ctx} people={props.people} />
      </View>
      {props.radio ? <View style={[styles.radio, on && { borderColor: C.primary }]}>{on ? <View style={styles.radioDot} /> : null}</View> : null}
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
        void perform(ctx, (c) => c.depart({
          commandId: newId(), unitId: v.unitId, type: 'keep', reviewId: props.reviewId, reason: r.reason,
          ...(r.blobHash ? { reasonBlobHash: r.blobHash } : {})
        }), t('passage.keep.done'), undoDepart, t('passage.page.undone.keep'));
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
  const others = (acts.second ? 1 : 0) + acts.rest.length;
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
      {acts.actionable && props.compact && (acts.primary || others > 0) ? (
        <View style={styles.btnRow}>
          {acts.primary ? <View style={{ flex: 1 }}>{btn(acts.primary, row.waits ? 'plain' : 'primary')}</View> : null}
          {others > 0 ? (
            <View style={acts.primary ? undefined : { flex: 1 }}>
              <SmallBtn label={acts.primary ? t('passage.page.more') : t('passage.page.options')} help={t('passage.page.moreHelp')} onPress={props.onMore} />
            </View>
          ) : null}
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
  const rows = reviewGrid(v.p, kindIds);
  const kinds = v.p.steps.flatMap((st) => st.kinds);
  const skipped = new Set(kinds.filter((k) => k.state === 'skipped').map((k) => k.kindId));
  const asked = new Set(kinds.filter((k) => k.state === 'asked').map((k) => k.kindId));
  const producing = kindIds.map((id) => v.kind(id)).filter((k) => k.produces);
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
                  <Text style={[txt.xs, { fontWeight: '600', textAlign: 'center' }]} numberOfLines={1}>{v.kind(id).name.split(' ')[0]}</Text>
                </View>
              ))}
            </View>
          </HelpInfo>
          {rows.slice(0, shown).map((row, ri) => (
            <View key={row.version.takeId} style={[styles.gridRow, styles.topBorder]}>
              <GridVersion n={row.version.n} hlc={row.version.hlc} onPress={() => props.onVersion(row.version.takeId)} />
              {row.cells.map((cell) => {
                const r = cell.reviews.at(-1);
                const kind = { ...v.kind(cell.kindId), name: checkName(cell.kindId, v.kinds) };
                return (
                  <View key={cell.kindId} style={styles.gridCol}>
                    {r ? (
                      <GridCell label={cell.reviews.length > 1
                          ? t('passage.grid.cellLatestOf', { kind: kind.name, who: feedbackSource(r, props.ctx.name), count: cell.reviews.length })
                          : t('passage.grid.cell', { kind: kind.name, who: feedbackSource(r, props.ctx.name) })}
                        help={kind.produces ? t('passage.grid.madeHelp', { kind: kindInSentence(kind.name) }) : t('passage.grid.cellHelp', { mark: markHelp(reviewMark(r)) })}
                        onPress={() => props.onReview(r.id)}>
                        {kind.produces
                          // Made content, not a verdict: its own mark, never a "looks good" tick.
                          ? <View style={[styles.producedMark]}><Ico name={kindIcon(cell.kindId)} size={14} color={C.primary} /></View>
                          : <StateMark state={reviewMark(r)} size={24} />}
                        {cell.reviews.length > 1 ? <View style={styles.countBadge}><Text style={[txt.xsStrong, { color: C.white }]}>{cell.reviews.length}</Text></View> : null}
                      </GridCell>
                    ) : ri === 0 && skipped.has(cell.kindId) ? <HelpInfo label={stateLabel('skipped')} detail={markHelp('skipped')}><StateMark state="skipped" size={24} /></HelpInfo>
                      : ri === 0 && asked.has(cell.kindId) ? <HelpInfo label={stateLabel('asked')} detail={markHelp('asked')}><StateMark state="asked" size={24} /></HelpInfo>
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
    <Row label={text.title} sub={`${text.who} · ${props.when}${text.sub ? ` — ${text.sub}` : ''}`} last={props.last}
      leading={(
        <View style={[styles.historyIcon, { backgroundColor: withAlpha(text.color, 0.1) }]}>
          <Ico name={text.icon} size={16} color={text.color} />
        </View>
      )}
      {...(props.trailing ? { right: props.trailing } : {})} {...(props.onPress ? { onPress: props.onPress } : {})} {...(props.help ? { help: props.help } : {})} />
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
          summary={t('passage.version.termsTied', { count: terms.length, terms: `${commaList(terms.slice(0, 2).map((x) => x.term.term))}${terms.length > 2 ? '…' : ''}` })}
          {...ctx.details(key('terms'))}>
          {terms.map(({ term, note }, i) => {
            const rendering = term.renderings[0]?.rendering;
            return (
              <Row key={term.termId} icon="book" label={`${term.term}${rendering ? ` · ${rendering}` : ''}`} {...(note ? { sub: note } : {})}
                help={t('passage.version.termHelp')}
                onPress={() => ctx.go('key_term_detail', { ...params, termId: term.termId })} last={i === terms.length - 1} />
            );
          })}
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
    const ok = await perform(ctx, (c) => c.depart({
      commandId: newId(), unitId: v.unitId, type: 'keep', reviewId: review.id, reason: text.trim() || SAID_BY_VOICE,
      ...(hash ? { reasonBlobHash: hash } : {})
    }), t('passage.keep.done'), undoDepart, t('passage.page.undone.keep'));
    setBusy(false);
    if (ok) ctx.back();
  };
  return (
    <Screen header={<Header title={v.title} sub={t('passage.keep.sayWhyTitle')} onBack={props.onBack} />}
      footer={<PrimaryBtn label={t('passage.keep.keepIt')} icon="check" help={t('passage.keep.keepItHelp')} busy={busy} disabled={!hash && !text.trim()} onPress={() => void keep()} />}>
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
  const review = p.reviews.find((r) => r.id === ctx.params['reviewId']) ?? p.reviews.at(-1);
  if (!review) return <Missing ctx={ctx} id="review_detail" crumbsOf={v} text={t('passage.review.noReviews')} />;
  const me = ctx.session.actorId;
  const params = { unitId, languageId };
  // A check's one name on every screen (decision 91), "Peer check".
  const kind = { ...v.kind(review.kindId), name: checkName(review.kindId, v.kinds) };
  const makes = kind.produces;
  const checkedBy = makes ? checkName(makes.checkedBy, v.kinds) : undefined;
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
          <Text style={txt.smMuted}>{[when(review.hlc), version ? versionTitle(version.n) : ''].filter(Boolean).join(' · ')}</Text>
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
            {!review.comment && !review.commentBlobHash && !review.artifacts?.length ? <Text style={txt.smMuted}>{t('passage.review.noWords')}</Text> : null}
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

  return (
    <Screen header={<Header title={kind.name} crumbs={passageCrumbs(ctx, v, kind.name)} sub={when(review.hlc)} onBack={ctx.back}
      action={<ReportFlag ctx={ctx} target={recordTarget(ctx, 'review', review.id, review.by, unitId)} />} />}
      footer={answerable ? (
        <View style={styles.btnRow}>
          <View style={{ width: '44%' }}><GhostBtn label={t('passage.keep.keepIt')} help={t('passage.keep.sayWhyHelp')} onPress={() => setKeeping(true)} /></View>
          <View style={{ flex: 1 }}><PrimaryBtn label={t('passage.review.recordFix')} icon="mic" help={t('passage.review.recordFixHelp')} onPress={() => ctx.go('workspace', { ...params, reviewId: review.id })} /></View>
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
            sub={`${ctx.name(version.by)} · ${when(version.hlc)}`} help={t('passage.page.openVersionHelp')}
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
/** The ask screen's choice of a check's whole team (decision 91), beside one person's id. */
const TEAM = '\u0000team';

/**
 * What the people asked will answer: the check's own questions (decision 91),
 * then any added for this request, with a field to add one. On the ask page
 * after publishing and on Someone else alike.
 */
function TheyAnswer(props: { asked: ReturnType<typeof questionsForKind>; questions: QuestionSpec[]; setQuestions: (f: (qs: QuestionSpec[]) => QuestionSpec[]) => void }) {
  const [draft, setDraft] = useState('');
  const [type, setType] = useState<QuestionSpec['type']>('yesno');
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    props.setQuestions((qs) => [...qs, { id: `ask:${newId()}`, text, type }]);
    setDraft('');
  };
  return (
    <>
      <SectionLabel label={t('checks.theyAnswer')} />
      {props.asked.length > 0 || props.questions.length > 0 ? (
        <Group>
          {props.asked.map((sq) => (
            <Row key={sq.q.id} icon="chat" label={sq.q.text} sub={[questionTypeLabel(sq.q.type), sq.required ? t('common.required') : ''].filter(Boolean).join(' · ')} />
          ))}
          {props.questions.map((q, i) => (
            <Row key={q.id} label={q.text} sub={questionTypeLabel(q.type)} last={i === props.questions.length - 1}
              right={<IconBtn name="close" label={t('passage.ask.removeQuestion')} help={t('passage.ask.removeQuestionHelp')} onPress={() => props.setQuestions((qs) => qs.filter((x) => x.id !== q.id))} bg="transparent" color={C.muted} />} />
          ))}
        </Group>
      ) : null}
      <Field value={draft} onChangeText={setDraft} placeholder={t('passage.ask.askSpecific')} help={t('passage.ask.askSpecificHelp')} />
      <View style={styles.btnRow}>
        <View style={{ flex: 1 }}>
          <SmallBtn label={t('passage.ask.answerType', { type: questionTypeLabel(type) })} help={t('passage.ask.answerTypeHelp')} onPress={() => setType(nextQuestionType)} />
        </View>
        <View style={{ flex: 1 }}>
          <SmallBtn label={t('passage.ask.addQuestion')} icon="plus" tone="primary" help={t('passage.ask.addQuestionHelp')} disabled={!draft.trim()} onPress={add} />
        </View>
      </View>
    </>
  );
}

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
  const check = kindId ? checkName(kindId, v.kinds) : '';
  const title = isRecord ? (v.p.recorded ? t('passage.ask.titleNewVersion') : t('passage.ask.titleRecord'))
    : kind ? t('passage.ask.titleKind', { kind: check }) : t('passage.ask.titleReview');
  const byName = (a: { profileId: string }, b: { profileId: string }) => ctx.name(a.profileId).localeCompare(ctx.name(b.profileId));
  const usual = candidates.filter((c) => c.usual).sort((a, b) => Number(b.onCheck) - Number(a.onCheck) || byName(a, b));
  const others = candidates.filter((c) => !c.usual).sort(byName);
  // The check's team (decision 91): everyone on it gets the request, and it is the first choice.
  const usualTo = !isRecord && kindId ? usualTargetFor(v.state, ctx.org.state, { languageId: v.languageId, kindId, me }) : undefined;
  const team = usualTo && 'teamId' in usualTo ? usualTo : undefined;
  const teamPeople = team ? checkPeople(v.state, kindId!).filter((id) => id !== me) : [];
  const chosen = who ?? (team ? TEAM : null);
  const asked = kindId ? questionsForKind(v.state, kindId) : [];
  const dueErr = dueError(dueTyped, today);
  const due = dueTyped.trim() ? (dueErr ? null : dueTyped.trim()) : dueDays === null ? null : addDays(today, dueDays);
  const outside = mode === 'outside' && !isRecord;
  const target = outside ? guestName.trim() : chosen === TEAM && team ? sendTargetLabel(team, ctx.name) : chosen ? ctx.name(chosen) : '';
  const ready = !!target && (!outside || contact.trim().length > 3) && !dueErr;

  const send = async () => {
    if (!ready) return;
    setBusy(true);
    const ok = await perform(ctx, (c) => c.ask({
      commandId: newId(), unitId: v.unitId, what,
      ...(kindId ? { kindId } : {}),
      ...(outside ? { guest: { name: guestName.trim(), channel, contact: contact.trim() } } : chosen === TEAM && team ? { teamId: team.teamId } : chosen ? { profileId: chosen } : {}),
      ...(due ? { dueDate: due } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(noteHash ? { noteBlobHash: noteHash } : {}),
      ...(!isRecord && questions.length ? { questions } : {})
    }), outside ? t('passage.ask.doneOutside', { name: target }) : t('passage.ask.doneTeam', { name: target }),
    (applied) => (c) => c.withdrawRequest({ commandId: newId(), requestId: payloadField(applied, 'requestId') }));
    setBusy(false);
    if (ok) ctx.go('passage_record', { unitId: v.unitId, languageId: v.languageId, asked: String(Date.now()) });
  };
  const personRow = (c: { profileId: string; sub: string }, last: boolean) => {
    const on = who === c.profileId;
    return (
      <Row key={c.profileId} leading={<PersonAvatar look={look(c.profileId)} size={36} />} label={ctx.name(c.profileId)} sub={c.sub}
        help={t('passage.ask.personHelp')} onPress={() => setWho(c.profileId)} last={last} role="radio" selected={on}
        right={<View style={[styles.radio, on && { backgroundColor: C.primary, borderColor: C.primary }]}>{on ? <Ico name="check" size={14} color={C.white} strokeWidth={3} /> : null}</View>} />
    );
  };

  return (
    <Screen header={<Header title={title} sub={`${v.title} · ${v.language}`} onBack={ctx.back} close />}
      footer={<PrimaryBtn label={chosen === TEAM && team && !outside ? t('passage.published.askTarget', { target }) : target ? t('passage.ask.askName', { name: target.split(' ')[0] }) : t('passage.ask.chooseSomeone')}
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
            <Row leading={<Faces people={teamPeople} size={30} />} sub={teamPeople.map((id) => ctx.name(id)).join(t('admin.list.separator'))}
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

      {!isRecord ? <TheyAnswer asked={asked} questions={questions} setQuestions={setQuestions} /> : null}

      <SectionLabel label={t('passage.ask.byWhen')} />
      <ChipRow>
        {dueChoices().map((d) => (
          <Chip key={String(d.days)} label={d.label} on={!dueTyped.trim() && dueDays === d.days} help={d.days === null ? t('passage.ask.noDateHelp') : t('passage.ask.dueHelp')}
            onPress={() => { setDueTyped(''); setDueDays(d.days); }} />
        ))}
      </ChipRow>
      <Field value={dueTyped} onChangeText={setDueTyped} placeholder={t('passage.ask.orDate', { date: addDays(today, 10) })} autoCapitalize="none" help={t('passage.ask.dateHelp')} />
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
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.primary },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  preview: { backgroundColor: TINT.green, borderRadius: radius.lg, padding: space.md, gap: 6, borderWidth: 1, borderColor: withAlpha(C.green, 0.2) }
});

export const contracts = contractsFor('passage_record', 'version_detail', 'review_detail', 'ask_someone');
