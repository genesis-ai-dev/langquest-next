// Reviewing: the UX demo's ReviewCaptureScreen ("Review it", and in logged
// mode "Already happened") and GuestReviewScreen ("Review by link"), from
// ng-langquest-ux src/screens/review.tsx, laid out as the simple review (demo SIMPLE-10;
// Ryder's ReviewListen, ReviewQuestion, ReviewDecide, ReviewSayWhy and the
// agreed "Background, open"). Requirements REV-1..8; ADR-005 (reviews
// attach to the version they heard), ADR-015 (a kind that makes content
// records it rather than judging), ADR-028 (Already happened is per step and
// looks like reviewing it now), ADR-029.
//
// Three steps under the header: Listen (the version in the big player, its
// parts each with a note button and their notes, Note on the part playing,
// the check's helps with theirs (decisions.md 149), Background one tap away
// as a sheet, "Who is listening?" optional), Questions (one per screen, answered aloud, by choice or typed;
// a required one is answered or set aside with a reason), Decide (Looks good
// sends it; Needs changes opens "What should change?", voice first, with an
// optional listener retelling). Already happened is the same screens, with
// who gave it, where, which version and a retelling behind "Add details".
// A review goes on the one passage it is about (decision 128): the demo's
// "Also covered in this session" is left out.
//
// Everything is read from the record (core derivePassage, questionsForKind,
// keyTermLinksFor) and written with core recordReview / produceContent.
// Sending it offers Undo, which takes the review back (decisions.md 111):
// the check is open again, and its author can still take it back later from
// the check on the record or from the history.
//
// What is said, answered or chosen here is kept on this phone as it is made,
// a draft only its maker sees (decision 127, reviewing/reviewDraft.ts), with
// the saved mark in the header. Back and ✕ leave and keep it; opening the
// same review again brings it back where it was left; sending it drops it.
import {
  checkShows, commands, helpNotesFor, keyTermLinksFor, keyTermsFor, languageName, notePart as notePartOf, questionsForKind, RECORD_STEP, SHOWN,
  type Card as AudioCard, type EventSpec, type KindDef, type NoteAnchor, type PassageNote
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useHardwareBack } from '../ui/useHardwareBack';
import { Text } from '../ui/text';
import { AudioClip } from '../audio/audioClip';
import { ClipPlayer } from '../audio/clipPlayer';
import { clipsAvailable } from '../audio/clipsAvailable';
import { ReportFlag } from '../moderation/reportSheet';
import { recordTarget } from '../moderation/reportTargets';
import { VersionParts } from '../passage/versionParts';
import type { Ctx } from '../shell/ctx';
import { screenTitle } from '../shell/flow';
import { t } from '../i18n';
import { formatClock } from '../i18n/format';
import { HelpRow } from '../helpMode/helpBadge';
import { indexesFor } from '../sync/indexes';
import { Badge, Banner, Card, Chip, EmptyState, Field, GhostBtn, Group, Header, Ico, IconBtn, LinkBtn, PrimaryBtn, ReasonSheet, Row, Screen, Sheet, SectionLabel } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { useLayout } from '../ui/useLayout';
import { passageCrumbs, passageView as passageViewOf, versionTitle, type PassageView } from '../passage/passageView';
import { usePassage } from '../passage/usePassage';
import { failureMessage } from '../diagnostics/report';
import {
  canLeave, cantAnswerReasons, cleanAnswers, cleanSkips, clockMs, earlierReviews, firstOpenAt, footHint, isGroupKind, kindInSentence, kindLabel, listenLine, nextLabel,
  momentIn, noteAnchorText, partAt, readiness, replyAnchor, requestFor, reviewCapture, reviewStages, stageAt, stageBack, summaryLine, toCompareFor, verdictQuestion, versionFor,
  type AnchorLook, type Answers, type Skips, type StageId, type VoiceAnswer
} from '../reviewing/capture';
import { NotedRow, NotesUnder, NotingSheet, ReviewNotes, type Noting } from '../reviewing/notesOn';
import { cardDurations } from '../recording/workspaceModel';
import {
  AnswerInput, Block, CompareCard, PeopleCounter, RequestBanner
} from '../reviewing/parts';
import { contractsFor } from '../shell/screenContracts';
import { AgainBtn, BigMic, DashedRow, PlayChip, SpeakBtn } from '../reviewing/reviewVoice';
import { checkName } from '../admin/adminModel';
import { useCheckHelpRows, type HelpRow as CheckHelpRow } from '../checks/useCheckHelpRows';
import { BackgroundSheet, BigChoices, Centre, DecideCard, MomentList, OutcomePill, QuestionCard, QuestionDots, SkipBtn, StepStrip } from '../reviewing/review';
import { backgroundLine } from '../reviewing/reviewText';
import { useOfferedSources } from '../sources/useSourceChoice';
import { useUsage } from '../sources/useUsage';
import { useStudyGuide } from '../study/useStudyGuides';
import type { StudyGuide } from '../study/guides';
import { studyProgress } from '../study/progress';
import { C, radius, space, TINT, type as T } from '../ui/theme';
import { VoiceNote } from '../audio/voiceNote';
import { draftKey } from '../drafts/draftModel';
import { useDraft } from '../drafts/useDraft';
import { SavedMark } from '../ui/SavedMark';
import { isStoredReview, reviewDraftOf, reviewStateOf, type ReviewDraft, type ReviewNote, type ReviewState } from '../reviewing/reviewDraft';
import { NoteStepContext } from '../checks/noteStep';
import { anyFrom, fromFilter } from '../checks/showsModel';
import { ReviewKeyWordsSheet } from '../keyTerms/lazySheets';
import { reviewCounts, reviewWords } from '../keyTerms/reviewWordsModel';
import { useCheckKeyWords } from '../keyTerms/useCheckKeyWords';
import { a11yState } from '../ui/a11yModel';

/** Close a sheet, then leave: a screen opened under a closing sheet is hidden on some phones. */
const SHEET_GAP_MS = 400;

/**
 * A voice note as a card for a review's artifacts, with the length and
 * format the recorder reported. A card VoiceNote did not describe is m4a
 * (what it records) of unknown length.
 */
function voiceCard(hash: string, card?: { durationMs: number; format: 'wav' | 'm4a' }): AudioCard {
  return { hash, durationMs: card?.durationMs ?? 0, format: card?.format ?? 'm4a' };
}

// ---- Review it (review_capture) ----------------------------------------------------------

/** Listen (with the background, unless the kind withholds it), answer, give your verdict (REV-0..4). */
export function ReviewCapture(ctx: Ctx) {
  // Notes written while reviewing are this check's (decisions.md 130).
  return <NoteStepContext.Provider value={ctx.params['kindId']}><Capture ctx={ctx} logged={false} /></NoteStepContext.Provider>;
}

// ---- Already happened (add_record) ---------------------------------------------------------

/**
 * A review that happened outside the app goes on the record through the
 * same screen, plus who gave it, where and which version was played, on
 * this passage only (decision 128); a kind that makes content asks for its
 * recording instead of an outcome (REV-6, ADR-028).
 */
export function AddRecord(ctx: Ctx) {
  return <Capture ctx={ctx} logged />;
}

function Capture(props: { ctx: Ctx; logged: boolean }) {
  const { ctx, logged } = props;
  const v = usePassage(ctx);
  const actorId = ctx.session.actorId;
  const kindId = ctx.params['kindId'] ?? (v ? v.p.next?.step.kindIds[0] ?? v.p.flow.steps[0]?.kindIds[0] ?? 'peer' : 'peer');
  const kind = v?.kind(kindId);
  const makes = logged ? kind?.produces : undefined;

  const [takeId, setTakeId] = useState<string | undefined>(ctx.params['takeId']);
  const [answers, setAnswers] = useState<Answers>({});
  const [voice, setVoice] = useState<Record<string, VoiceAnswer>>({});
  const [typing, setTyping] = useState<Record<string, boolean>>({});
  const [skipped, setSkipped] = useState<Skips>({});
  const [skipFor, setSkipFor] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [feedback, setFeedback] = useState<VoiceAnswer | null>(null);
  const [typeFeedback, setTypeFeedback] = useState(false);
  const [moments, setMoments] = useState<(VoiceAnswer & { atMs: number })[]>([]);
  const [people, setPeople] = useState(0);
  const [givenBy, setGivenBy] = useState('');
  const [place, setPlace] = useState('');
  const [evidence, setEvidence] = useState<VoiceAnswer | null>(null);
  const [made, setMade] = useState<AudioCard[]>([]);
  /** The version has been played here: Decide says when it has not. */
  const [played, setPlayed] = useState(false);
  /** What was said is about what should change: Looks good asks before sending it with a yes. */
  const [saidForChange, setSaidForChange] = useState(false);
  /** Looks good was tapped with words about what should change: send them too, or leave them out. */
  const [askChange, setAskChange] = useState(false);
  const [busy, setBusy] = useState(false);
  // Where you are in the review, kept with the draft: Back from a key term or the study, or opening it again, returns here.
  const [stageId, setStageId] = useState<StageId>('listen');
  const [qi, setQi] = useState(0);
  const [why, setWhy] = useState(false);
  const [sheet, setSheet] = useState<'background' | 'who' | 'details' | 'say' | 'retell' | null>(null);
  // A note being written on a part, a help or another note (decisions.md 149).
  const [noting, setNoting] = useState<Noting | null>(null);
  // Everything noted while reviewing: part of the review, sent with the verdict (decisions.md 149).
  const [notes, setNotes] = useState<ReviewNote[]>([]);
  // The check's helps (decision 91), and a Bible one of them opens in Background.
  const helps = useCheckHelpRows(ctx, v?.state, kindId);
  const [bible, setBible] = useState<string | null>(null);
  // A key-word list on the check (decision 172): its words on the passage, and how many the team has a word for.
  const [wordsOf, setWordsOf] = useState<string | null>(null);
  const listsHere = useCheckKeyWords(ctx, helps.some((h) => 'words' in h.open) ? v?.unitId : null);
  const ownWords = useMemo(() => (v?.state ? keyTermsFor(v.state) : []), [v?.state]);
  const wordsLine = (itemId: string): string | undefined => {
    const rows = reviewWords(listsHere.words.filter((w) => w.list.itemId === itemId), ownWords, new Set());
    if (!rows.length) return undefined;
    const { here, have } = reviewCounts(rows);
    return t('keyTerms.review.rowSub', { count: here, have, language: v ? languageName(ctx.org.state, v.languageId) : '' });
  };
  const openHelp = (h: CheckHelpRow) => {
    if ('words' in h.open) { setWordsOf(h.open.words); return; }
    if ('bible' in h.open) { setBible(h.open.bible); setSheet('background'); return; }
    if (h.open.screen === 'study_guide') return ctx.go('study_guide', { unitId: v!.unitId, languageId: v!.languageId });
    ctx.go('material_editor', h.open.params);
  };
  // A wide window names the passage in the crumbs above the title, so the title is the kind.
  const wide = useLayout().kind !== 'phone';

  const version = v ? versionFor(v.p, takeId) : undefined;

  // Everything said, answered, chosen or recorded here is a draft only you see, kept as you go
  // (decision 127): Back and ✕ leave it, opening this review again brings it back, sending drops it.
  const opened = ctx.params['takeId'];
  const draft = useDraft<ReviewDraft | null>(v ? draftKey('review', actorId, v.languageId, v.unitId, kindId, logged ? 'logged' : 'live') : null, null, isStoredReview);
  const setDraft = draft.set;
  const onScreen: ReviewState = {
    takeId, stage: stageId, qi, answers, voice, typing, skipped, comment, feedback, typeFeedback, moments, notes, people, givenBy, place, evidence, made,
    played, saidForChange
  };
  const kept = JSON.stringify(reviewDraftOf(onScreen, version?.takeId, opened));
  // What the draft holds: written when the screen holds something else, so a draft not yet read is never written over.
  const stored = useRef('null');
  useEffect(() => {
    const d = draft.value;
    if (draft.restoredAt === null || !d || !v) return;
    const back = reviewStateOf(d, v.p.versions.map((x) => x.takeId), opened, versionFor(v.p, opened)?.takeId);
    // Its version is gone: the review starts fresh.
    if (!back) { stored.current = 'null'; setDraft(null); return; }
    stored.current = JSON.stringify(d);
    setTakeId(back.takeId); setStageId(back.stage); setQi(back.qi); setAnswers(back.answers); setVoice(back.voice); setTyping(back.typing);
    setSkipped(back.skipped); setComment(back.comment); setFeedback(back.feedback); setTypeFeedback(back.typeFeedback); setMoments(back.moments); setNotes(back.notes);
    setPeople(back.people); setGivenBy(back.givenBy); setPlace(back.place); setEvidence(back.evidence); setMade(back.made);
    setPlayed(!!back.played); setSaidForChange(!!back.saidForChange);
  }, [draft.restoredAt]); // eslint-disable-line react-hooks/exhaustive-deps -- once per draft read: what it brings back is that read's value, versions and params
  useEffect(() => {
    if (kept === stored.current) return;
    stored.current = kept;
    setDraft(JSON.parse(kept) as ReviewDraft | null);
  }, [kept, setDraft]);
  const vState = v?.state;
  const vp = v?.p;
  const requestParam = ctx.params['requestId'];
  const request = useMemo(() => vp ? requestFor(vp, kindId, actorId, { ...(requestParam ? { requestId: requestParam } : {}), mineOnly: logged }) : undefined,
    [vp, kindId, actorId, requestParam, logged]);
  const questions = useMemo(() => vState ? questionsForKind(vState, kindId, request) : [], [vState, kindId, request]);
  const guide = useStudyGuide(ctx, v?.unitId);
  // What the check shows (decisions.md 130): Background has only that, and is not there when it shows nothing.
  const shows = useMemo(() => (vState ? { ...checkShows(vState, kindId), notes: anyFrom(vState, kindId, 'notes'), earlier: anyFrom(vState, kindId, 'earlier') } : null), [vState, kindId]);
  const earlierFrom = useMemo(() => (vState ? fromFilter(vState, kindId, 'earlier') : undefined), [vState, kindId]);
  const anyShown = !!shows && SHOWN.some((w) => shows[w]);
  const context = useMemo(() => v && version && kind ? backgroundFor(v, kindId, version.takeId, guide) : null,
    [v?.state, v?.p, kindId, version?.takeId, kind, guide]); // eslint-disable-line react-hooks/exhaustive-deps -- v is new on every draw; what backgroundFor reads of it (state, p, kinds) follows v.state and v.p
  // What the Background offered and what was opened go on the record with the review (docs/reference-material.md).
  const usage = useUsage();
  const shown = !!context && anyShown;
  useOfferedSources(ctx, shown ? v?.unitId : undefined, shown ? v?.languageId : undefined, shown ? usage : undefined);
  const guideItem = guide ? guide.id.split('~')[0] ?? guide.id : null;
  useEffect(() => {
    if (shown && guide && guideItem) usage.offer([{ itemId: guideItem, name: `${guide.pattern} · ${guide.passage}`, kind: 'guide', opened: false, ref: guide.passage }]);
  }, [shown, guide, guideItem, usage]);

  // A phone's Back goes one step back (decision 137): from "What should change?" to Decide, as its arrow does;
  // else the question before, then the stage before. From Listen it leaves, and the draft stays.
  const stepBack = stageBack(reviewStages({ questions: questions.length, logged, makes: !!makes }), stageId, qi, questions.length);
  useHardwareBack(why || !!stepBack, () => {
    if (why) setWhy(false);
    else if (stepBack) { setStageId(stepBack.stage); setQi(stepBack.qi); }
  });

  if (!v || !kind) {
    return (
      <Screen header={<Header title={logged ? screenTitle('add_record') : screenTitle('review_capture')} onBack={ctx.back} close />}>
        <EmptyState icon="book" title={ctx.language.state ? t('review.screen.notInLanguage') : t('common.loading')} />
      </Screen>
    );
  }
  const crumbs = passageCrumbs(ctx, v, logged ? t('review.screen.alreadyHappened') : t('review.screen.reviewIt'));
  // One name for the check on every screen (decision 91).
  const check = checkName(kindId, v.kinds);
  // Logged at a checkpoint: it goes on the record, but only a check done in the app opens the steps after it (decision 72).
  const checkpoint = logged && !makes && v.p.steps.some((st) => st.step.checkpoint && st.step.kindIds.includes(kindId));
  const sub = wide ? (logged ? t('review.screen.alreadyHappened') : v.language) : logged ? t('review.screen.kindAlreadyHappened', { kind: check }) : check;
  const title = wide ? check : v.title;
  if (!version) {
    return (
      <Screen header={<Header title={title} sub={sub} crumbs={crumbs} onBack={ctx.back} close />}>
        <EmptyState icon="mic" title={t('review.screen.noRecording')} sub={t('review.screen.noRecordingSub')} />
      </Screen>
    );
  }
  if (!logged && kind.produces) {
    return (
      <Screen header={<Header title={title} sub={sub} crumbs={crumbs} onBack={ctx.back} close />}>
        <EmptyState icon="swap" title={t('review.screen.makesRecording', { kind: check })} sub={t('review.screen.makesRecordingSub', { action: kind.produces.action })} />
      </Screen>
    );
  }

  const captured = reviewCapture({ questions, answers, voice: makes ? {} : voice, moments: makes ? [] : moments, evidence: makes ? null : evidence });
  const r = readiness(questions, captured.answers, skipped, comment, feedback?.hash ?? null, notes.length + moments.length);
  const group = isGroupKind(kind.id);
  const asker = request?.by ? ctx.name(request.by) : undefined;
  const stages = reviewStages({ questions: questions.length, logged, makes: !!makes });
  const at = stageAt(stages, stageId);
  const stage = stages[at]!.id;
  const next = stages[at + 1];
  const latest = v.p.latest;
  const mine = version.by === actorId;
  // The translator's first name, for sentences about them; when it is you, the sentences say so themselves.
  const translator = ctx.name(version.by).split(' ')[0] ?? ctx.name(version.by);

  // ---- notes on what this check shows (decisions.md 149) ----
  const lengths = cardDurations(v.state, v.unitId);
  const look: AnchorLook = {
    term: (id) => v.state.keyTerms[id]?.term,
    versionN: (id) => v.p.versions.find((x) => x.takeId === id)?.n,
    partN: (id, hash) => { const at = v.p.versions.find((x) => x.takeId === id)?.cardHashes.indexOf(hash) ?? -1; return at >= 0 ? at + 1 : undefined; },
    help: (key) => helps.find((h) => h.help === key)?.name,
    author: (id) => { const n = v.p.notes.find((x) => x.id === id); return n ? ctx.name(n.by).split(' ')[0] : undefined; }
  };
  const noteLabel = (n: PassageNote) => noteAnchorText(n.anchor, look);
  /** A note in this review: a moment reads as the reviewer heard it, a time in the whole version; the rest say what they are on. */
  const reviewNoteLabel = (anchor: NoteAnchor) => {
    const on = notePartOf(anchor);
    const ms = on && on.takeId === version.takeId ? momentIn(version.cardHashes, lengths, on.part, on.at) : null;
    return ms !== null ? t('review.simple.yourNoteAt', { time: formatClock(ms) }) : noteAnchorText(anchor, look);
  };
  // The sheet says the note goes with the review, as the moment's sheet always has.
  const withReview = mine ? t('review.screen.noteAtSubMine') : t('review.screen.noteAtSub', { name: translator });
  const noteOn = (anchor: NoteAnchor, title: string, where: string) => setNoting({ anchor, title, where: summaryLine([v.title, where]), sub: withReview });
  const replyOn = (n: PassageNote) => {
    const name = ctx.name(n.by).split(' ')[0] ?? ctx.name(n.by);
    noteOn(replyAnchor(n), t('review.notesOn.replyTitle', { name }), noteLabel(n));
  };
  /** The player's Note, at a time in the whole version: kept as the part playing and how far into it, so the fix records over that part. */
  const noteMoment = (ms: number) => {
    const { index, atMs } = partAt(version.cardHashes.map((h) => lengths.get(h) ?? 0), ms);
    const hash = version.cardHashes[index];
    if (!hash) return;
    const time = formatClock(ms);
    noteOn({ kind: 'version', takeId: version.takeId, part: hash, at: clockMs(atMs) }, t('review.screen.noteAt', { time }), time);
  };
  const addNote = (anchor: NoteAnchor, c: { text: string; hash: string | null }) => {
    setNotes((ns) => [...ns, { id: Crypto.randomUUID(), anchor, ...(c.text ? { text: c.text } : {}), ...(c.hash ? { hash: c.hash } : {}) }]);
    ctx.toast(t('review.notesOn.added'));
  };
  // What goes with the verdict, said where it is sent.
  const goesWith = notes.length + moments.length > 0 ? (
    <View style={styles.goesWith}>
      <Ico name="send" size={16} color={TINT.amberText} />
      <Text style={[txt.sm, { fontWeight: '700', color: TINT.amberText, flexShrink: 1 }]}>{t('review.notesOn.goWith', { count: notes.length + moments.length })}</Text>
    </View>
  ) : null;
  const q = questions[Math.min(qi, Math.max(0, questions.length - 1))];
  const openAt = firstOpenAt(questions, captured.answers, skipped, makes ? {} : voice);
  const afterSheet = (fn: () => void) => { setSheet(null); setTimeout(fn, SHEET_GAP_MS); };
  const whoLine = summaryLine([
    (group || !logged) && people > 0 && t('review.parts.people', { count: people }),
    logged && !group && givenBy.trim(),
    !logged && place.trim()
  ]);
  const whoTitle = logged && !group ? t('review.screen.whoReviewed') : logged ? t('review.parts.howManyListened') : t('review.screen.whoIsListening');

  async function save(outcome: 'looks_good' | 'needs_changes' | 'recorded', opts: { withoutSaid?: boolean } = {}) {
    const live = ctx.language.state;
    if (!live || !v || !version || !kind || busy) return;
    const state = live;
    const cmd = Crypto.randomUUID();
    const c = commands(state, indexesFor(state));
    // What was said about what should change goes with Looks good only when the reviewer says so.
    const text = opts.withoutSaid ? '' : comment.trim();
    const commentHash = opts.withoutSaid ? null : feedback?.hash ?? null;
    const cleanA = cleanAnswers(questions, captured.answers);
    const cleanS = cleanSkips(questions, captured.answers, skipped);
    const artifacts = captured.artifacts;
    let specs: EventSpec[] = [];
    let message: string;
    try {
      if (!logged) {
        specs = c.recordReview({
          commandId: cmd, takeIds: [version.takeId], kindId: kind.id, outcome: outcome === 'needs_changes' ? 'needs_changes' : 'looks_good', via: 'app',
          ...(text ? { comment: text } : {}), ...(commentHash ? { commentBlobHash: commentHash } : {}),
          ...(cleanA ? { answers: cleanA } : {}), ...(cleanS ? { skipped: cleanS } : {}), ...(request ? { requestId: request.id } : {}),
          ...(people > 0 ? { people } : {}), ...(place.trim() ? { place: place.trim() } : {}), ...(artifacts.length ? { artifacts } : {})
        });
        const name = ctx.name(version.by);
        // Offline nothing has reached them yet: it says when it will (decisions.md 166).
        const offline = ctx.language.online === false;
        message = outcome === 'looks_good'
          ? (mine ? t('review.screen.looksGoodOnRecord') : offline ? t('review.screen.looksGoodOffline', { name }) : t('review.screen.looksGoodSentTo', { name }))
          : (mine ? t('review.screen.feedbackOnRecord') : offline ? t('review.screen.feedbackOffline', { name }) : t('review.screen.feedbackSentTo', { name }));
      } else {
        // One passage, the one it is about (decision 128): another passage the session covered gets its own review there.
        const who = !group && givenBy.trim() ? { givenBy: givenBy.trim() } : {};
        const shared = {
          ...(cleanA ? { answers: cleanA } : {}), ...(cleanS ? { skipped: cleanS } : {}),
          ...who, ...(group && people > 0 ? { people } : {}), ...(place.trim() ? { place: place.trim() } : {})
        };
        const req = requestFor(v.p, kind.id, actorId, { mineOnly: true });
        specs = makes
          ? c.produceContent({
            commandId: cmd, fromTakeId: version.takeId, kindId: kind.id, cards: made, via: 'logged',
            ...(text ? { note: text } : {}), ...(commentHash ? { noteBlobHash: commentHash } : {}), ...shared, ...(req ? { requestId: req.id } : {})
          })
          : c.recordReview({
            commandId: cmd, takeIds: [version.takeId], kindId: kind.id, outcome: outcome === 'needs_changes' ? 'needs_changes' : 'looks_good', via: 'logged',
            ...(text ? { comment: text } : {}), ...(commentHash ? { commentBlobHash: commentHash } : {}), ...shared,
            ...(artifacts.length ? { artifacts } : {}), ...(req ? { requestId: req.id } : {})
          });
        // A checkpoint clears only with approval given in the app (decision 72): the record says so where it was logged.
        message = checkpoint && outcome === 'looks_good' ? t('review.screen.addedAtCheckpoint', { kind: check }) : t('review.screen.addedToRecord', { kind: check });
      }
      // Everything noted in this review goes with it, in the same batch, and names it (decisions.md 149).
      const sent = specs.find((sp) => sp.type === 'v1.ReviewRecorded')?.payload as { reviewId: string } | undefined;
      if (sent) {
        specs = [...specs, ...notes.flatMap((n, i) => c.addNote({
          commandId: `${cmd}:note:${i}`, unitId: v.unitId, anchor: n.anchor, kindId: kind.id, reviewId: sent.reviewId,
          ...(n.text ? { text: n.text } : {}), ...(n.hash ? { blobHash: n.hash } : {})
        }))];
      }
      // Each review of this passage names what its Background offered and what was opened.
      const used = usage.items();
      if (context && used.length) {
        specs = [...specs, ...specs.flatMap((sp) => {
          if (sp.type !== 'v1.ReviewRecorded') return [];
          const p = sp.payload as { reviewId: string; takeId: string };
          if (state.takes[p.takeId]?.unitId !== v.unitId) return [];
          return c.referencesUsed({ commandId: cmd, unitId: v.unitId, reviewId: p.reviewId, items: used });
        })];
      }
    } catch (e) {
      ctx.toast(t('review.screen.notSaved', { reason: logged ? failureMessage('add record: save', e) : failureMessage('review: send', e) }), 'problem');
      return;
    }
    setBusy(true);
    try {
      await ctx.act(specs, message);
    } catch {
      setBusy(false);
      return;
    }
    // Sent: it is on the record now, so the draft goes.
    void draft.clear();
    ctx.go('passage_record', { unitId: v.unitId, languageId: v.languageId });
  }

  /** Next from Listen or a question: the next question, else the next stage. */
  const goNext = () => {
    if (stage === 'questions' && qi < questions.length - 1) { setQi(qi + 1); return; }
    if (next) { setStageId(next.id); setQi(0); }
  };
  const goStage = (id: StageId) => {
    setWhy(false);
    setStageId(id);
    // A required question still open, else the last one: the way back from Decide.
    if (id === 'questions') setQi(openAt >= 0 ? openAt : Math.max(0, questions.length - 1));
  };
  /** The question before, on screen as well as on Android's Back. */
  const previous = () => {
    const back = stageBack(stages, stage, qi, questions.length);
    if (back) { setStageId(back.stage); setQi(back.qi); }
  };
  // Where the version can be played: on this phone, or online from the server.
  const audioHere = clipsAvailable(ctx.language, version.cardHashes);
  /** Looks good, asking first when what was said is about what should change. */
  const looksGood = () => {
    if (saidForChange && (comment.trim() || feedback)) { setAskChange(true); return; }
    void save('looks_good');
  };
  /** ✕ leaves the review as a draft on this phone: said once, so nobody takes it for sent. */
  const leave = () => {
    if (reviewDraftOf(onScreen, version.takeId, opened)) ctx.toast(t('review.screen.keptNotSent'));
    ctx.back();
  };

  // ---- the footer, per stage ----
  let footer: ReactNode = null;
  if (why) {
    // Why Send feedback is off, said above it.
    const hint = !r.saysWhat || !r.ready ? footHint(r) : null;
    footer = (
      <>
        {hint ? <Text style={[txt.smMuted, styles.center]}>{hint}</Text> : null}
        <PrimaryBtn label={t('review.screen.sendFeedback')} icon="send" disabled={!r.saysWhat || !r.ready} busy={busy} onPress={() => void save('needs_changes')} />
      </>
    );
  } else if (stage === 'listen') {
    // A version that cannot be heard here is not checked from here: one logged afterwards was heard elsewhere.
    const unheard = !logged && !audioHere;
    footer = next ? (
      <>
        {unheard ? <Text style={[txt.smMuted, styles.center]}>{t('review.screen.notOnPhoneYet')}</Text> : null}
        <PrimaryBtn label={nextLabel(next)} icon="right" disabled={unheard} onPress={goNext} />
      </>
    ) : null;
  } else if (stage === 'questions' && q) {
    const last = qi >= questions.length - 1;
    const answeredHere = !!captured.answers[q.q.id]?.trim() || skipped[q.q.id] !== undefined;
    footer = (
      <View style={styles.qFoot}>
        {qi > 0 ? <IconBtn name="arrowL" label={t('review.screen.previousQuestion')} help={t('review.screen.previousQuestionHelp')} onPress={previous} /> : null}
        <SkipBtn onPress={() => (q.required && !answeredHere ? setSkipFor(q.q.id) : goNext())} />
        <View style={{ flex: 1 }}>
          <PrimaryBtn label={last ? nextLabel(next ?? stages[at]!) : t('review.screen.nextQuestion')} icon="right"
            disabled={!canLeave(q, captured.answers, skipped, makes ? {} : voice)} onPress={goNext} />
        </View>
      </View>
    );
  } else if (stage === 'decide' && makes) {
    footer = (
      <>
        <PrimaryBtn label={t('common.done')} icon="check" help={t('review.screen.doneRecordedHelp', { what: makes.what })} disabled={!r.ready || made.length === 0} busy={busy} onPress={() => void save('recorded')} />
      </>
    );
  }

  // ---- Listen ----
  const directions = request && (request.note || request.noteBlobHash);
  const changed = version.n > 1 && (version.changeNote || version.changeBlobHash);
  const whoRow = (
    <DashedRow icon="people" label={whoTitle} help={!logged ? t('review.screen.whoHelp') : group ? t('review.screen.howManyHelp') : t('review.screen.whoReviewedHelp')}
      {...(whoLine ? { sub: whoLine, done: true } : {})} right={whoLine ? t('review.shared.change') : t('review.shared.optional')} onPress={() => setSheet('who')} />
  );
  const listen = (
    <>
      {logged ? (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>
          {t('review.screen.loggedIntro', { kind: kindInSentence(check) })}
          {checkpoint ? ` ${t('review.screen.loggedCheckpoint')}` : ''}
        </Text>
      ) : null}
      {/* Logged afterwards: who gave it and which version was played come first, as they make the record (screen-path.md). */}
      {logged ? whoRow : null}
      {logged && v.p.versions.length > 1 ? (
        <Block label={t('review.screen.whichVersion')}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {[...v.p.versions].reverse().map((x) => (
              <HelpRow key={x.takeId} of="review.version">
                <Chip label={versionTitle(x.n)} on={x.takeId === version.takeId} help={t('review.screen.whichVersionHelp')} onPress={() => setTakeId(x.takeId)} />
              </HelpRow>
            ))}
          </View>
        </Block>
      ) : null}
      {directions ? <RequestBanner ctx={ctx} request={request} /> : null}
      <ClipPlayer language={ctx.language} hashes={version.cardHashes} big
        title={mine ? t('review.screen.versionByYou', { n: version.n }) : t('review.screen.versionBy', { n: version.n, name: translator })} sub={listenLine(kind.id, logged)}
        onPlay={() => setPlayed(true)}
        {...(makes ? {} : { onNote: (s: number) => noteMoment(Math.round(s * 1000)) })} />
      {/* Its parts with their verses, when they have verses, so a reviewer can say where (decisions.md 82). */}
      <VersionParts ctx={ctx} state={v.state} unitId={v.unitId} hashes={version.cardHashes} onlyNumbered />
      {/* Everything noted in this review, together: it is sent with the verdict (decisions.md 149). */}
      <ReviewNotes ctx={ctx} notes={notes} label={reviewNoteLabel} onRemove={(id) => setNotes((ns) => ns.filter((n) => n.id !== id))}>
        {moments.length ? <MomentList ctx={ctx} moments={moments} onRemove={(h) => setMoments((m) => m.filter((x) => x.hash !== h))} /> : null}
      </ReviewNotes>
      {changed ? (
        <Card>
          <Text style={txt.sm}><Text style={{ fontWeight: '700' }}>{t('review.screen.whatChangedIn', { n: version.n })}</Text> {version.changeNote ?? t('review.screen.saidInVoiceNote')}</Text>
          {version.changeBlobHash ? <AudioClip language={ctx.language} hashes={[version.changeBlobHash]} label={t('review.parts.playWhatChanged')} /> : null}
        </Card>
      ) : null}
      {context?.compare ? <CompareCard ctx={ctx} review={context.compare} kind={v.kind(context.compare.kindId)} version={version} /> : null}
      {helps.length ? (
        <>
          <SectionLabel label={t('checks.forCheck', { check })} />
          <Group>
            {helps.map((h, i) => (
              <HelpRow key={h.key} of="review.checkHelp">
                <NotedRow last={i === helps.length - 1}
                  row={<Row icon={h.icon} label={h.name} {...(h.sub ? { sub: h.sub } : 'words' in h.open && wordsLine(h.open.words) ? { sub: wordsLine(h.open.words)! } : {})}
                    {...('words' in h.open ? { iconColor: TINT.amberText, iconBg: TINT.amber } : {})}
                    help={helpRowHelp(h)} onPress={() => openHelp(h)} last />}
                  note={{ label: t('review.notesOn.addOn', { what: h.name }), help: t('review.notesOn.addOnHelp'), onPress: () => noteOn({ kind: 'passage', help: h.help }, t('review.notesOn.noteOn', { what: h.name }), h.name) }}
                  notes={<NotesUnder ctx={ctx} p={v.p} notes={helpNotesFor(v.p, h.help)} onReply={replyOn} />} />
              </HelpRow>
            ))}
          </Group>
        </>
      ) : null}
      {context && anyShown ? (
        <Group>
          <Row leading={<Ico name="layers" size={28} color={C.primary} />} label={t('review.parts.background')} sub={backgroundLine(context, { id: version.by, name: translator, you: mine })}
            help={t('review.screen.backgroundHelp')} onPress={() => setSheet('background')} last />
        </Group>
      ) : null}
      {logged ? null : whoRow}
      {logged ? (
        <DashedRow icon="edit" label={t('review.screen.addDetails')}
          sub={summaryLine([
            place.trim() || t('review.screen.where'),
            !makes && (evidence ? t('review.screen.retellingRecorded') : t('review.screen.retelling'))
          ])} help={t('review.screen.addDetailsHelp')} onPress={() => setSheet('details')} />
      ) : null}
    </>
  );

  // ---- one question ----
  const question = q ? (
    <>
      <QuestionDots count={questions.length} at={qi} />
      <QuestionCard question={q} {...(asker ? { asker } : {})} />
      <View style={styles.answer}>
        {skipped[q.q.id] !== undefined ? (
          <View style={{ alignItems: 'center', gap: space.sm }}>
            <Text style={[txt.body, styles.center]}><Text style={{ fontWeight: '700' }}>{t('review.parts.leftUnanswered')}</Text> {skipped[q.q.id]}</Text>
            <LinkBtn label={t('review.screen.answerIt')} help={t('review.screen.answerItHelp')} onPress={() => setSkipped((s) => { const { [q.q.id]: _gone, ...rest } = s; return rest; })} />
          </View>
        ) : q.q.type !== 'text' ? (
          <BigChoices type={q.q.type} value={answers[q.q.id]} onChange={(val) => setAnswers((a) => ({ ...a, [q.q.id]: val }))} />
        ) : (
          <>
            {makes ? null : voice[q.q.id] ? (
              <>
                <PlayChip ctx={ctx} clip={voice[q.q.id]!} label={t('review.screen.theirAnswer')} />
                <AgainBtn label={t('review.screen.recordAgain')} onPress={() => setVoice((x) => { const { [q.q.id]: _gone, ...rest } = x; return rest; })} />
              </>
            ) : (
              <BigMic language={ctx.language} label={t('review.screen.tapRecordAnswer')} size={96} onClip={(clip) => setVoice((x) => ({ ...x, [q.q.id]: clip }))} />
            )}
            {makes || typing[q.q.id] || answers[q.q.id] ? (
              <View style={{ alignSelf: 'stretch' }}>
                <Field value={answers[q.q.id] ?? ''} onChangeText={(val) => setAnswers((a) => ({ ...a, [q.q.id]: val }))} placeholder={t('review.screen.typeAnswer')} multiline />
              </View>
            ) : (
              <LinkBtn label={t('common.orTypeIt')} help={t('review.screen.orTypeHelp')} style={{ alignSelf: 'center' }} onPress={() => setTyping((x) => ({ ...x, [q.q.id]: true }))} />
            )}
          </>
        )}
      </View>
    </>
  ) : null;

  // ---- Decide ----
  const decide = makes ? (
    <>
      <View style={{ gap: space.xs }}>
        <Text style={[styles.h1, styles.center]}>{t('review.screen.recordTheHeading', { what: makes.what })}</Text>
        <Text style={[txt.smMuted, styles.center]}>{t('review.screen.recordTheWhy')}</Text>
      </View>
      <View style={styles.answer}>
        <BigMic language={ctx.language} label={made.length ? t('review.screen.recordAnotherPart') : t('review.screen.tapAndSpeak')} onClip={(clip) => setMade((m) => (m.some((x) => x.hash === clip.hash) ? m : [...m, voiceCard(clip.hash, clip)]))} />
      </View>
      {made.map((c, i) => (
        <HelpRow key={c.hash} of="review.madePart">
          <View style={styles.partRow}>
            <PlayChip ctx={ctx} clip={{ hash: c.hash, durationMs: c.durationMs, format: c.format ?? 'm4a' }} label={t('review.screen.part', { n: i + 1 })} tone="brand" />
            <LinkBtn label={t('common.remove')} color={C.muted} help={t('review.screen.removePartHelp')} accessibilityLabel={t('review.screen.removePart', { n: i + 1 })} onPress={() => setMade((m) => m.filter((x) => x.hash !== c.hash))} />
          </View>
        </HelpRow>
      ))}
      <DashedRow icon="chatDots" label={t('review.screen.whatHappened')} sub={comment.trim() || (feedback ? t('review.screen.saidInVoiceNoteCap') : t('review.screen.whatWasHard'))}
        right={comment.trim() || feedback ? t('review.shared.change') : t('review.shared.optional')} help={t('review.screen.whatHappenedHelp')}
        done={!!comment.trim() || !!feedback} onPress={() => setSheet('say')} />
    </>
  ) : (
    <Centre>
      <View style={styles.verdictRow}>
        <Text style={[styles.h1, { flexShrink: 1 }]} accessibilityRole="header">{verdictQuestion(kind.id)}</Text>
        <SpeakBtn text={verdictQuestion(kind.id)} size={52} />
      </View>
      {openAt >= 0 ? (
        <LinkBtn label={t('review.capture.requiredLeft', { count: r.open })} help={t('review.screen.requiredLeftHelp')} style={{ alignSelf: 'center' }} onPress={() => goStage('questions')} />
      ) : null}
      {!logged && !played ? <Text style={[txt.smMuted, styles.center]}>{t('review.screen.notPlayedYet')}</Text> : null}
      {goesWith}
      <DecideCard tone="green" label={t('review.screen.looksGood')} icon="check" busy={busy} disabled={openAt >= 0} onPress={looksGood} />
      <DecideCard tone="amber" label={t('review.screen.needsChanges')} icon="chat" disabled={openAt >= 0 || busy} onPress={() => setWhy(true)} />
      <DashedRow icon="chatDots" label={logged ? t('review.screen.whatHappened') : t('review.screen.saySomething')}
        sub={comment.trim() || (feedback ? t('review.screen.saidInVoiceNoteCap') : logged ? t('review.screen.whatPeopleUnderstood')
          : mine ? t('review.screen.onRecordWithAnswer') : t('review.screen.nameHearsWithAnswer', { name: translator }))}
        right={comment.trim() || feedback ? t('review.shared.change') : t('review.shared.optional')} done={!!comment.trim() || !!feedback}
        help={logged ? t('review.screen.whatHappenedHelp') : t('review.screen.saySomethingHelp')} onPress={() => setSheet('say')} />
    </Centre>
  );

  // ---- What should change? ----
  const whyBody = (
    <>
      <View style={{ gap: space.sm, paddingTop: space.md }}>
        <OutcomePill label={t('review.screen.needsChanges')} />
        <Text style={[styles.h1, styles.center]} accessibilityRole="header">{t('review.screen.whatShouldChange')}</Text>
        <Text style={[styles.lead, styles.center]}>
          {logged
            ? (mine ? t('review.screen.sayWhatTheySaidMine') : t('review.screen.sayWhatTheySaid', { name: translator }))
            : (mine ? t('review.screen.sayInYourWordsMine') : t('review.screen.sayInYourWords', { name: translator }))}
        </Text>
      </View>
      <Centre>
        {feedback ? (
          <View style={{ gap: space.md }}>
            <PlayChip ctx={ctx} clip={feedback} label={t('review.screen.yourFeedback')} tone="amber" />
            <AgainBtn label={t('review.screen.recordAgain')} onPress={() => setFeedback(null)} />
          </View>
        ) : <BigMic language={ctx.language} label={t('review.screen.tapAndSpeak')} onClip={(clip) => { setSaidForChange(true); setFeedback(clip); }} />}
        {typeFeedback || comment ? (
          <Field value={comment} onChangeText={(text) => { setSaidForChange(true); setComment(text); }} placeholder={logged ? t('review.screen.typeWhatPeopleUnderstood') : t('review.screen.typeWhatWorked')} multiline testID="feedback-text" />
        ) : <LinkBtn label={t('common.orTypeIt')} help={t('review.screen.orTypeHelp')} style={{ alignSelf: 'center' }} onPress={() => setTypeFeedback(true)} />}
      </Centre>
      {evidence ? (
        <View style={styles.partRow}>
          <PlayChip ctx={ctx} clip={evidence} label={t('review.screen.listenerRetelling')} />
          <LinkBtn label={t('common.remove')} color={C.muted} help={t('review.screen.removeRetellingHelp')} accessibilityLabel={t('review.screen.removeRetelling')} onPress={() => setEvidence(null)} />
        </View>
      ) : (
        <DashedRow tile icon="user" label={t('review.screen.recordListenerRetelling')} right={t('review.shared.optional')} help={t('review.screen.retellingHelp')} onPress={() => setSheet('retell')} />
      )}
      {goesWith}
    </>
  );

  // The version under review can be reported here as on its own page (decision 48); the flag hides on your own.
  const mark = (
    <View style={styles.headActions}>
      {/* A full 48 in the header: the web has no hitSlop to make up a smaller flag (A11Y-009). */}
      <ReportFlag ctx={ctx} target={recordTarget(ctx, 'version', version.takeId, version.by, v.unitId)} size={48} />
      <SavedMark status={draft.status} help={t('saved.draftHelp')} />
    </View>
  );
  const header = why ? (
    <Header title={title} sub={sub} crumbs={crumbs} onBack={() => setWhy(false)} action={mark} />
  ) : (
    <>
      <Header title={title} sub={sub} crumbs={crumbs} onBack={leave} close action={mark} />
      <StepStrip stages={stages} at={at} onGo={goStage} />
    </>
  );

  // Keyed by stage and question so each opens at its top.
  return (
    <Screen key={`${stage}:${qi}:${why}`} footer={footer} header={header} bodyStyle={{ flexGrow: 1 }}>
      {why ? whyBody : stage === 'listen' ? listen : stage === 'questions' ? question : decide}

      {sheet === 'background' && context && shows ? (
        <BackgroundSheet ctx={ctx} v={v} takeId={version.takeId} translator={translator} translatorIsYou={mine} data={{ ...context, anchor: noteLabel }} usage={usage} kind={v.kind} shows={shows}
          {...(earlierFrom ? { earlierFrom } : {})}
          {...(bible ? { bible } : {})}
          onClose={() => { setSheet(null); setBible(null); }}
          onOpenTerm={(termId) => afterSheet(() => ctx.go('key_term_detail', { termId, unitId: v.unitId, languageId: v.languageId }))}
          onOpenStep={(stepId) => afterSheet(() => { if (guideItem) usage.open(guideItem); ctx.go('study_step', { unitId: v.unitId, languageId: v.languageId, stepId }); })}
          onOpenStudy={() => afterSheet(() => { if (guideItem) usage.open(guideItem); ctx.go('study_guide', { unitId: v.unitId, languageId: v.languageId }); })}
          onMoreBibles={() => afterSheet(() => ctx.go('bible_explore', { unitId: v.unitId, languageId: v.languageId }))}
          onNote={noteOn} onReply={replyOn} onAddNote={addNote} />
      ) : null}

      {sheet === 'who' ? (
        <Sheet visible title={whoTitle}
          sub={t('review.screen.whoSheetSub')} onClose={() => setSheet(null)}
          footer={<PrimaryBtn label={t('common.done')} help={t('review.screen.sheetDoneHelp')} onPress={() => setSheet(null)} />}>
          {logged && !group ? (
            <Field value={givenBy} onChangeText={setGivenBy} autoCapitalize="words" placeholder={makes ? t('review.screen.whoMadeIt') : t('review.screen.whoReviewedIt')} />
          ) : <PeopleCounter value={people} onChange={setPeople} />}
          {/* Already happened keeps where under Add details, with which version. */}
          {logged ? null : <Field value={place} onChangeText={setPlace} placeholder={t('review.screen.wherePlaceholder')} help={t('review.screen.whereHelp')} />}
        </Sheet>
      ) : null}

      {sheet === 'details' ? (
        <Sheet visible title={t('review.screen.addDetails')} sub={t('review.screen.detailsSub')} onClose={() => setSheet(null)}
          footer={<PrimaryBtn label={t('common.done')} help={t('review.screen.sheetDoneHelp')} onPress={() => setSheet(null)} />}>
          <Field value={place} onChangeText={setPlace} placeholder={t('review.screen.wherePlaceholder')} help={t('review.screen.whereHelp')} />
          {!makes ? (
            <Block label={t('review.screen.evidence')} hint={t('review.screen.evidenceHint')}>
              <VoiceNote ctx={ctx} label={t('review.screen.recordARetelling')} hash={evidence?.hash ?? null}
                onChange={(h, card) => setEvidence(h ? { hash: h, durationMs: card?.durationMs ?? 0, format: card?.format ?? 'm4a' } : null)} />
            </Block>
          ) : null}
        </Sheet>
      ) : null}

      {sheet === 'say' ? (
        <Sheet visible title={logged ? t('review.screen.whatHappened') : t('review.screen.saySomething')}
          sub={makes ? t('review.screen.saySubMakes') : logged ? t('review.screen.saySubLogged') : mine ? t('review.screen.saySubMine') : t('review.screen.saySub', { name: translator })}
          onClose={() => setSheet(null)} footer={<PrimaryBtn label={t('common.done')} help={t('review.screen.sheetDoneHelp')} onPress={() => setSheet(null)} />}>
          <VoiceNote ctx={ctx} label={logged ? t('review.screen.recordSummary') : t('common.sayIt')} hash={feedback?.hash ?? null}
            onChange={(h, card) => { setSaidForChange(false); setFeedback(h ? { hash: h, durationMs: card?.durationMs ?? 0, format: card?.format ?? 'm4a' } : null); }} />
          <Field value={comment} onChangeText={(text) => { setSaidForChange(false); setComment(text); }} placeholder={t('common.orTypeIt')} multiline />
        </Sheet>
      ) : null}

      {askChange ? (
        <Sheet visible title={t('review.screen.sendChangeTitle')} sub={t('review.screen.sendChangeSub')} onClose={() => setAskChange(false)}>
          <PrimaryBtn label={t('review.screen.leaveItOut')} help={t('review.screen.leaveItOutHelp')} icon="check" busy={busy} onPress={() => { setAskChange(false); void save('looks_good', { withoutSaid: true }); }} />
          <GhostBtn label={t('review.screen.sendItToo')} help={t('review.screen.sendItTooHelp')} icon="send" onPress={() => { setAskChange(false); void save('looks_good'); }} />
        </Sheet>
      ) : null}

      {sheet === 'retell' ? (
        <Sheet visible title={t('review.screen.recordListenerRetelling')} sub={t('review.screen.retellSub')} onClose={() => setSheet(null)}>
          <View style={{ paddingVertical: space.lg }}>
            <BigMic language={ctx.language} label={t('review.screen.tapRecordRetelling')} size={96} onClip={(clip) => { setEvidence(clip); setSheet(null); }} />
          </View>
        </Sheet>
      ) : null}

      <NotingSheet ctx={ctx} v={v} noting={noting} onClose={() => setNoting(null)} onAdd={addNote} />

      <ReasonSheet visible={skipFor !== null} title={t('review.screen.skipTitle')}
        sub={t('review.screen.skipSub')}
        quickReasons={cantAnswerReasons()} confirmLabel={t('review.screen.skipConfirm')}
        footnote={t('review.screen.skipFootnote')}
        onClose={() => setSkipFor(null)}
        onConfirm={({ reason }) => { if (skipFor) setSkipped((s) => ({ ...s, [skipFor]: reason })); setSkipFor(null); }} />
      {wordsOf ? (
        <ReviewKeyWordsSheet ctx={ctx} unitId={v.unitId} title={v.title} itemId={wordsOf} takeId={version.takeId} version={version.n} translator={translator}
          onClose={() => setWordsOf(null)} />
      ) : null}
    </Screen>
  );
}

/** What opening one of the check's helps does (decision 91), as help mode says it. */
function helpRowHelp(h: CheckHelpRow): string {
  if ('words' in h.open) return t('review.screen.helpWordsHelp');
  if ('bible' in h.open) return t('review.screen.helpBibleHelp');
  return h.open.screen === 'study_guide' ? t('review.screen.helpGuideHelp') : t('review.screen.helpNoteHelp');
}

/** The background a reviewer may open, or null when the kind withholds it (REV-1, REV-4). */
function backgroundFor(v: PassageView, kindId: string, takeId: string, guide: StudyGuide | null) {
  const { state, p } = v;
  const terms = keyTermLinksFor(state, takeId).map((l) => l.term);
  // Notes and earlier reviews from the steps this check shows (decisions.md 130).
  const notesFrom = fromFilter(state, kindId, 'notes');
  const earlierFrom = fromFilter(state, kindId, 'earlier');
  const notes = p.notes.filter((n) => n.anchor.kind !== 'study' && notesFrom(n.kindId ?? RECORD_STEP));
  const versionN = (id: string) => p.versions.find((x) => x.takeId === id)?.n;
  const anchor = (n: PassageNote) => noteAnchorText(n.anchor, { term: (id) => state.keyTerms[id]?.term, versionN });
  const olderVersion = (n: PassageNote) => {
    const on = n.onTakeId ? versionN(n.onTakeId) : undefined;
    return n.onTakeId && n.onTakeId !== takeId && on ? versionTitle(on) : undefined;
  };
  const study = guide ? studyProgress(state, p, guide) : null;
  const compare = toCompareFor(p, v.kinds, kindId);
  const earlier = earlierReviews(p, v.kinds, kindId).filter((r) => earlierFrom(r.kindId));
  return { terms, notes, anchor, olderVersion, study, compare, earlier };
}

// ---- Review by link (guest_review), as a preview ------------------------------------------------------

/**
 * What someone without the app sees after tapping the WhatsApp or SMS link
 * (REV-7): who asked and their note, the recording, up to three questions,
 * a voice or text reply, then Understood it well / Some parts unclear.
 * Replies by link need a server endpoint that does not exist yet, so this is
 * a labelled preview: answers can be tried, nothing is sent or recorded.
 */
export function GuestReview(ctx: Ctx) {
  const state = ctx.language.state;
  const requestId = ctx.params['requestId'];
  const named = requestId && state ? state.requests[requestId] : undefined;
  const unitId = named?.unitId ?? ctx.params['unitId'];
  const languageId = ctx.params['languageId'] ?? ctx.languageId ?? undefined;
  const open = languageId === ctx.language.languageId;
  const v = useMemo(() => state && unitId && languageId && open && state.units[unitId]
    ? passageViewOf(state, unitId, languageId, languageName(ctx.org.state, languageId)) : null, [state, unitId, languageId, open, ctx.org.state]);
  const [answers, setAnswers] = useState<Answers>({});
  const [comment, setComment] = useState('');
  const request = v ? (requestId ? v.p.requests.find((r) => r.id === requestId) : undefined)
    ?? [...v.p.openRequests].reverse().find((r) => r.what === 'review' && !!r.guest) : undefined;
  const kindId = request?.kindId ?? 'community';
  const questions = useMemo(() => v ? questionsForKind(v.state, kindId, request).slice(0, 3) : [], [v, kindId, request]);

  const header = <Header title={screenTitle('guest_review')} sub={t('review.guest.previewSub')} onBack={ctx.back} close />;
  if (!v) {
    return (
      <Screen header={header}>
        <EmptyState icon="link" title={state ? t('review.guest.noLink') : t('common.loading')} sub={t('review.guest.noLinkSub')} />
      </Screen>
    );
  }

  const kind: KindDef = v.kind(kindId);
  const version = v.p.latest;
  const mine = request?.by === ctx.session.actorId;
  const guest = request?.guest?.name ?? t('review.guest.friend');
  const headline = mine ? t('review.guest.youAsked', { guest, title: v.title })
    : request?.by ? t('review.guest.askedYou', { asker: ctx.name(request.by), title: v.title }) : t('review.guest.teamAskedYou', { title: v.title });

  const footer = (
    <>
      <Text style={[txt.xs, styles.center]}>{t('review.guest.previewOnly')}</Text>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}><GhostBtn label={t('review.guest.someUnclear')} help={t('review.guest.someUnclearHelp')} disabled onPress={() => undefined} /></View>
        <View style={{ flex: 1 }}><PrimaryBtn label={t('review.guest.understoodWell')} tone="green" help={t('review.guest.understoodWellHelp')} disabled onPress={() => undefined} /></View>
      </View>
    </>
  );

  return (
    <Screen header={header} footer={footer}>
      <Banner icon="link" title={t('review.guest.preview')} body={mine ? t('review.guest.previewBodyGuest', { guest }) : t('review.guest.previewBody')} />
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={styles.brand}><Ico name="globe" size={18} color={C.white} /></View>
          {/* i18n-ignore: the product's name, the same in every language */}
          <Text style={[txt.sm, { fontWeight: '800', flex: 1 }]}>LangQuest</Text>
          <View style={{ flexShrink: 1, maxWidth: '55%' }}><Badge label={t('review.guest.noAccount')} /></View>
        </View>
        <Text style={txt.title}>{headline}</Text>
        <Text style={txt.xs}>{v.language} · {checkName(kind.id, v.kinds)}</Text>
      </Card>
      {request?.note ? <Card style={{ backgroundColor: C.light }}><Text style={txt.body}>{t('review.guest.quoted', { note: request.note })}</Text></Card> : null}
      {request?.noteBlobHash ? <AudioClip language={ctx.language} hashes={[request.noteBlobHash]} label={t('review.parts.playDirections')} /> : null}
      {version ? (
        <Card>
          <Text style={txt.h3}>{t('review.parts.listen')}</Text>
          <AudioClip language={ctx.language} hashes={version.cardHashes} label={t('review.guest.playTitle', { title: v.title })} />
        </Card>
      ) : <EmptyState icon="mic" title={t('review.guest.noRecording')} />}
      {questions.map((q) => (
        <HelpRow key={q.q.id} of={`guest.${q.q.type}Question`}>
          <Card>
            <Text style={[txt.body, { fontWeight: '600' }]}>{q.q.text}</Text>
            <AnswerInput type={q.q.type} value={answers[q.q.id]} onChange={(val) => setAnswers((a) => ({ ...a, [q.q.id]: val }))} />
          </Card>
        </HelpRow>
      ))}
      <Block label={t('review.guest.tellUs')}>
        {/* A voice reply would be saved to the language's record; a preview must not write, so it is shown, not live. */}
        <View style={styles.voiceOff} {...a11yState({ disabled: true })}>
          <View style={styles.micDot}><Ico name="mic" size={18} color={C.white} /></View>
          <Text style={[txt.sm, { flex: 1, fontWeight: '600', color: C.muted }]}>{t('review.guest.replyByVoice')}</Text>
        </View>
        <Field value={comment} onChangeText={setComment} placeholder={t('common.orTypeIt')} multiline />
      </Block>
    </Screen>
  );
}

const styles = StyleSheet.create({
  goesWith: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: space.xs, paddingHorizontal: space.md, paddingVertical: space.sm,
    borderRadius: radius.full, backgroundColor: TINT.amber },
  center: { textAlign: 'center' },
  h1: { fontSize: T.xxl, fontWeight: '800', color: C.dark },
  lead: { fontSize: T.base, color: C.muted, lineHeight: 23 },
  verdictRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md },
  answer: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: space.lg, paddingVertical: space.xl },
  qFoot: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  headActions: { flexDirection: 'row', alignItems: 'center' },
  partRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: space.md },
  brand: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  voiceOff: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.md, paddingVertical: space.sm,
    borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: TINT.gray, opacity: 0.7 },
  micDot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: C.faint }
});

export const contracts = contractsFor('review_capture', 'add_record', 'guest_review');
