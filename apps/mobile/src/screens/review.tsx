// Reviewing: the UX demo's ReviewCaptureScreen ("Review it", and in logged
// mode "Already happened") and GuestReviewScreen ("Review by link"), from
// ng-langquest-ux src/screens/review.tsx and the AlsoCoveredPicker in
// screens/shared.tsx, laid out as the simple review (demo SIMPLE-10;
// Ryder's ReviewListen, ReviewQuestion, ReviewDecide, ReviewSayWhy and the
// agreed "Background, open"). Requirements REV-1..8; ADR-005 (reviews
// attach to the version they heard), ADR-015 (a kind that makes content
// records it rather than judging), ADR-028 (Already happened is per step and
// looks like reviewing it now), ADR-029.
//
// Three steps under the header: Listen (the version in the big player, Note
// at a moment, Background one tap away as a sheet, "Who is listening?"
// optional), Questions (one per screen, answered aloud, by choice or typed;
// a required one is answered or set aside with a reason), Decide (Looks good
// sends it; Needs changes opens "What should change?", voice first, with an
// optional listener retelling). Already happened is the same screens, with
// who gave it, where, which version, other passages and a retelling behind
// "Add details".
//
// Everything is read from the record (core derivePassage, questionsForKind,
// keyTermLinksFor) and written with core recordReview / produceContent. A
// review is grow-only, so sending it offers no Undo.
import {
  commands, derivePassage, keyTermLinksFor, languageName, questionsForKind,
  type Card as AudioCard, type EventSpec, type KindDef, type PassageNote
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AudioClip } from '../audioClip';
import { ClipPlayer } from '../clipPlayer';
import type { Ctx } from '../ctx';
import { screenTitle } from '../flow';
import { t } from '../i18n';
import { formatClock } from '../i18n/format';
import { indexesFor } from '../indexes';
import {
  Badge, Banner, Card, Chip, EmptyState, Field, GhostBtn, Group, Header, Ico, LinkBtn, PrimaryBtn, ReasonSheet, Row, Screen, Sheet, txt, useLayout
} from '../kit';
import { passageCrumbs, passageView as passageViewOf, usePassage, versionTitle, type PassageView } from '../passageView';
import { failureMessage } from '../report';
import {
  canLeave, cantAnswerReasons, cleanAnswers, cleanSkips, earlierReviews, firstOpenAt, isGroupKind, kindInSentence, kindLabel, listenLine, loggedTargets, nextLabel,
  noteAnchorText, readiness, recordedPassages, requestFor, reviewCapture, reviewStages, stageAt, summaryLine, toCompareFor, verdictQuestion, versionFor,
  type Answers, type Skips, type StageId, type VoiceAnswer
} from '../reviewing/capture';
import {
  AlsoCoveredPicker, AnswerInput, Block, CompareCard, PeopleCounter, RequestBanner, WithheldNotice
} from '../reviewing/parts';
import { contractsFor } from '../screenContracts';
import { AgainBtn, BigMic, DashedRow, PlayChip, SpeakBtn } from '../simple/reviewVoice';
import { BackgroundSheet, backgroundLine, BigChoices, Centre, DecideCard, MomentList, OutcomePill, QuestionCard, QuestionDots, SkipBtn, StepStrip } from '../simple/review';
import { useOfferedSources } from '../sources/SourceReader';
import { useUsage } from '../sources/used';
import { useStudyGuide } from '../study/libraryGuides';
import type { StudyGuide } from '../study/guides';
import { studyProgress } from '../study/progress';
import { C, space, TINT, type as T } from '../theme';
import { VoiceNote } from '../voiceNote';

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
  return <Capture ctx={ctx} logged={false} />;
}

// ---- Already happened (add_record) ---------------------------------------------------------

/**
 * A review that happened outside the app goes on the record through the
 * same screen, plus who gave it, where, which version was played and other
 * passages the session covered; a kind that makes content asks for its
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
  const [also, setAlso] = useState<string[]>([]);
  const [people, setPeople] = useState(0);
  const [givenBy, setGivenBy] = useState('');
  const [place, setPlace] = useState('');
  const [evidence, setEvidence] = useState<VoiceAnswer | null>(null);
  const [made, setMade] = useState<AudioCard[]>([]);
  const [busy, setBusy] = useState(false);
  // Where you are in the review, kept for this visit: Back from a key term or the study returns here.
  const [stageId, setStageId] = useState<StageId>('listen');
  const [qi, setQi] = useState(0);
  const [why, setWhy] = useState(false);
  const [sheet, setSheet] = useState<'background' | 'who' | 'details' | 'say' | 'retell' | null>(null);
  const [momentAt, setMomentAt] = useState<number | null>(null);
  // A wide window names the passage in the crumbs above the title, so the title is the kind.
  const wide = useLayout().kind !== 'phone';

  const version = v ? versionFor(v.p, takeId) : undefined;
  const request = useMemo(() => v ? requestFor(v.p, kindId, actorId, { ...(ctx.params['requestId'] ? { requestId: ctx.params['requestId'] } : {}), mineOnly: logged }) : undefined,
    [v?.p, kindId, actorId, ctx.params, logged]);
  const questions = useMemo(() => v ? questionsForKind(v.state, kindId, request) : [], [v?.state, kindId, request]);
  const guide = useStudyGuide(ctx, v?.unitId);
  const context = useMemo(() => v && version && kind && !kind.withholdsContext ? backgroundFor(ctx, v, kindId, version.takeId, guide) : null,
    [v?.state, v?.p, kindId, version?.takeId, kind, guide]);
  const all = useMemo(() => v && logged ? recordedPassages(v.state) : [], [v?.state, logged]);
  // What the Background offered and what was opened go on the record with the review (docs/reference-material.md).
  const usage = useUsage();
  const shown = !!context;
  useOfferedSources(ctx, shown ? v?.unitId : undefined, shown ? v?.languageId : undefined, shown ? usage : undefined);
  const guideItem = guide ? guide.id.split('~')[0] ?? guide.id : null;
  useEffect(() => {
    if (shown && guide && guideItem) usage.offer([{ itemId: guideItem, name: `${guide.pattern} · ${guide.passage}`, kind: 'guide', opened: false, ref: guide.passage }]);
  }, [shown, guide, guideItem, usage]);

  if (!v || !kind) {
    return (
      <Screen header={<Header title={logged ? screenTitle('add_record') : screenTitle('review_capture')} onBack={ctx.back} close />}>
        <EmptyState icon="book" title={ctx.language.state ? t('review.screen.notInLanguage') : t('common.loading')} />
      </Screen>
    );
  }
  const crumbs = passageCrumbs(ctx, v, logged ? t('review.screen.alreadyHappened') : t('review.screen.reviewIt'));
  const sub = wide ? (logged ? t('review.screen.alreadyHappened') : v.language) : logged ? t('review.screen.kindAlreadyHappened', { kind: kindLabel(kind.name) }) : kindLabel(kind.name);
  const title = wide ? kind.name : v.title;
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
        <EmptyState icon="swap" title={t('review.screen.makesRecording', { kind: kind.name })} sub={t('review.screen.makesRecordingSub', { action: kind.produces.action })} />
      </Screen>
    );
  }

  const captured = reviewCapture({ questions, answers, voice: makes ? {} : voice, moments: makes ? [] : moments, evidence: makes ? null : evidence });
  const r = readiness(questions, captured.answers, skipped, comment, feedback?.hash ?? null);
  const group = isGroupKind(kind.id);
  const here = all.find((p) => p.unitId === v.unitId);
  const asker = request?.by ? ctx.name(request.by) : undefined;
  const stages = reviewStages({ questions: questions.length, logged, makes: !!makes });
  const at = stageAt(stages, stageId);
  const stage = stages[at]!.id;
  const next = stages[at + 1];
  const latest = v.p.latest;
  const otherPassages = !!here && all.some((p) => p.unitId !== here.unitId);
  const mine = version.by === actorId;
  // The translator's first name, for sentences about them; when it is you, the sentences say so themselves.
  const translator = ctx.name(version.by).split(' ')[0] ?? ctx.name(version.by);
  const q = questions[Math.min(qi, Math.max(0, questions.length - 1))];
  const openAt = firstOpenAt(questions, captured.answers, skipped, makes ? {} : voice);
  const afterSheet = (fn: () => void) => { setSheet(null); setTimeout(fn, SHEET_GAP_MS); };
  const whoLine = summaryLine([
    (group || !logged) && people > 0 && t('review.parts.people', { count: people }),
    logged && !group && givenBy.trim(),
    !logged && place.trim()
  ]);
  const whoTitle = logged && !group ? t('review.screen.whoReviewed') : logged ? t('review.parts.howManyListened') : t('review.screen.whoIsListening');

  async function save(outcome: 'looks_good' | 'needs_changes' | 'recorded') {
    const state = ctx.language.state;
    if (!state || !v || !version || !kind || busy) return;
    const cmd = Crypto.randomUUID();
    const c = commands(state, indexesFor(state));
    const text = comment.trim();
    const commentHash = feedback?.hash ?? null;
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
        message = outcome === 'looks_good'
          ? (mine ? t('review.screen.looksGoodOnRecord') : t('review.screen.looksGoodSentTo', { name }))
          : (mine ? t('review.screen.feedbackOnRecord') : t('review.screen.feedbackSentTo', { name }));
      } else {
        const targets = loggedTargets(state, { unitId: v.unitId, takeId: version.takeId }, also);
        const who = !group && givenBy.trim() ? { givenBy: givenBy.trim() } : {};
        const shared = {
          ...(cleanA ? { answers: cleanA } : {}), ...(cleanS ? { skipped: cleanS } : {}),
          ...who, ...(group && people > 0 ? { people } : {}), ...(place.trim() ? { place: place.trim() } : {})
        };
        targets.forEach((t, i) => {
          const tp = t.unitId === v.unitId ? v.p : derivePassage(state, t.unitId, indexesFor(state));
          const req = requestFor(tp, kind.id, actorId, { mineOnly: true });
          const commandId = `${cmd}:${i}`;
          // Notes at moments are about this passage's version; the rest of the session goes with every passage it covered.
          const theseArtifacts = t.unitId === v.unitId ? artifacts : artifacts.filter((a) => a.atMs === undefined);
          specs.push(...(makes
            ? c.produceContent({
              commandId, fromTakeId: t.takeId, kindId: kind.id, cards: made, via: 'logged',
              ...(text ? { note: text } : {}), ...(commentHash ? { noteBlobHash: commentHash } : {}), ...shared, ...(req ? { requestId: req.id } : {})
            })
            : c.recordReview({
              commandId, takeIds: [t.takeId], kindId: kind.id, outcome: outcome === 'needs_changes' ? 'needs_changes' : 'looks_good', via: 'logged',
              ...(text ? { comment: text } : {}), ...(commentHash ? { commentBlobHash: commentHash } : {}), ...shared,
              ...(theseArtifacts.length ? { artifacts: theseArtifacts } : {}), ...(req ? { requestId: req.id } : {})
            })));
        });
        message = targets.length > 1 ? t('review.screen.addedToPassages', { kind: kind.name, count: targets.length }) : t('review.screen.addedToRecord', { kind: kind.name });
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
      ctx.toast(t('review.screen.notSaved', { reason: logged ? failureMessage('add record: save', e) : failureMessage('review: send', e) }));
      return;
    }
    setBusy(true);
    try {
      await ctx.act(specs, message);
    } catch {
      setBusy(false);
      return;
    }
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
    if (id === 'questions') setQi(openAt >= 0 ? openAt : 0);
  };

  // ---- the footer, per stage ----
  let footer: ReactNode = null;
  if (why) {
    footer = <PrimaryBtn label={t('review.screen.sendFeedback')} icon="send" disabled={!r.saysWhat || !r.ready} busy={busy} onPress={() => void save('needs_changes')} />;
  } else if (stage === 'listen') {
    footer = next ? <PrimaryBtn label={nextLabel(next)} icon="right" onPress={goNext} /> : null;
  } else if (stage === 'questions' && q) {
    const last = qi >= questions.length - 1;
    const answeredHere = !!captured.answers[q.q.id]?.trim() || skipped[q.q.id] !== undefined;
    footer = (
      <View style={styles.qFoot}>
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
        {logged && also.length > 0 ? <Text style={[txt.xsStrong, styles.center, { color: C.primary }]}>{t('review.screen.savesTo', { count: also.length + 1 })}</Text> : null}
        <PrimaryBtn label={t('review.screen.saveToRecord')} icon="check" disabled={!r.ready || made.length === 0} busy={busy} onPress={() => void save('recorded')} />
      </>
    );
  }

  // ---- Listen ----
  const directions = request && (request.note || request.noteBlobHash);
  const changed = version.n > 1 && (version.changeNote || version.changeBlobHash);
  const listen = (
    <>
      {logged ? (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>
          {t('review.screen.loggedIntro', { kind: kindInSentence(kind.name) })}
        </Text>
      ) : null}
      {directions ? <RequestBanner ctx={ctx} request={request} /> : null}
      <ClipPlayer language={ctx.language} hashes={version.cardHashes} big
        title={mine ? t('review.screen.versionByYou', { n: version.n }) : t('review.screen.versionBy', { n: version.n, name: translator })} sub={listenLine(kind.id, logged)}
        {...(makes ? {} : { onNote: (s: number) => setMomentAt(Math.round(s * 1000)) })} />
      <MomentList ctx={ctx} moments={moments} onRemove={(h) => setMoments((m) => m.filter((x) => x.hash !== h))} />
      {changed ? (
        <Card>
          <Text style={txt.sm}><Text style={{ fontWeight: '700' }}>{t('review.screen.whatChangedIn', { n: version.n })}</Text> {version.changeNote ?? t('review.screen.saidInVoiceNote')}</Text>
          {version.changeBlobHash ? <AudioClip language={ctx.language} hashes={[version.changeBlobHash]} label={t('review.parts.playWhatChanged')} /> : null}
        </Card>
      ) : null}
      {context?.compare ? <CompareCard ctx={ctx} review={context.compare} kind={v.kind(context.compare.kindId)} version={version} /> : null}
      {context === null ? <WithheldNotice kind={kind} /> : (
        <Group>
          <Row leading={<Ico name="layers" size={28} color={C.primary} />} label={t('review.parts.background')} sub={backgroundLine(context, { id: version.by, name: translator, you: mine })}
            onPress={() => setSheet('background')} last />
        </Group>
      )}
      <DashedRow icon="people" label={whoTitle}
        {...(whoLine ? { sub: whoLine, done: true } : {})} right={whoLine ? t('review.shared.change') : t('review.shared.optional')} onPress={() => setSheet('who')} />
      {logged ? (
        <DashedRow icon="edit" label={t('review.screen.addDetails')}
          sub={summaryLine([
            place.trim() || t('review.screen.where'),
            latest && version.takeId === latest.takeId ? t('review.screen.versionLatest', { n: version.n }) : versionTitle(version.n),
            otherPassages && (also.length ? t('review.screen.morePassages', { count: also.length }) : t('review.screen.otherPassages')),
            !makes && (evidence ? t('review.screen.retellingRecorded') : t('review.screen.retelling'))
          ])} onPress={() => setSheet('details')} />
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
            <LinkBtn label={t('review.screen.answerIt')} onPress={() => setSkipped((s) => { const { [q.q.id]: _gone, ...rest } = s; return rest; })} />
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
              <BigMic label={t('review.screen.tapRecordAnswer')} size={96} onClip={(clip) => setVoice((x) => ({ ...x, [q.q.id]: clip }))} />
            )}
            {makes || typing[q.q.id] || answers[q.q.id] ? (
              <View style={{ alignSelf: 'stretch' }}>
                <Field value={answers[q.q.id] ?? ''} onChangeText={(val) => setAnswers((a) => ({ ...a, [q.q.id]: val }))} placeholder={t('review.screen.typeAnswer')} multiline />
              </View>
            ) : (
              <LinkBtn label={t('common.orTypeIt')} style={{ alignSelf: 'center' }} onPress={() => setTyping((x) => ({ ...x, [q.q.id]: true }))} />
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
        <BigMic label={made.length ? t('review.screen.recordAnotherPart') : t('review.screen.tapAndSpeak')} onClip={(clip) => setMade((m) => (m.some((x) => x.hash === clip.hash) ? m : [...m, voiceCard(clip.hash, clip)]))} />
      </View>
      {made.map((c, i) => (
        <View key={c.hash} style={styles.partRow}>
          <PlayChip ctx={ctx} clip={{ hash: c.hash, durationMs: c.durationMs, format: c.format ?? 'm4a' }} label={t('review.screen.part', { n: i + 1 })} tone="brand" />
          <LinkBtn label={t('common.remove')} color={C.muted} accessibilityLabel={t('review.screen.removePart', { n: i + 1 })} onPress={() => setMade((m) => m.filter((x) => x.hash !== c.hash))} />
        </View>
      ))}
      <DashedRow icon="chatDots" label={t('review.screen.whatHappened')} sub={comment.trim() || (feedback ? t('review.screen.saidInVoiceNoteCap') : t('review.screen.whatWasHard'))}
        right={comment.trim() || feedback ? t('review.shared.change') : t('review.shared.optional')}
        done={!!comment.trim() || !!feedback} onPress={() => setSheet('say')} />
    </>
  ) : (
    <Centre>
      <View style={styles.verdictRow}>
        <Text style={[styles.h1, { flexShrink: 1 }]} accessibilityRole="header">{verdictQuestion(kind.id)}</Text>
        <SpeakBtn text={verdictQuestion(kind.id)} size={52} />
      </View>
      {openAt >= 0 ? (
        <LinkBtn label={t('review.capture.requiredLeft', { count: r.open })} style={{ alignSelf: 'center' }} onPress={() => goStage('questions')} />
      ) : null}
      <DecideCard tone="green" label={t('review.screen.looksGood')} icon="check" busy={busy} disabled={openAt >= 0} onPress={() => void save('looks_good')} />
      <DecideCard tone="amber" label={t('review.screen.needsChanges')} icon="chat" disabled={openAt >= 0 || busy} onPress={() => setWhy(true)} />
      <DashedRow icon="chatDots" label={logged ? t('review.screen.whatHappened') : t('review.screen.saySomething')}
        sub={comment.trim() || (feedback ? t('review.screen.saidInVoiceNoteCap') : logged ? t('review.screen.whatPeopleUnderstood')
          : mine ? t('review.screen.onRecordWithAnswer') : t('review.screen.nameHearsWithAnswer', { name: translator }))}
        right={comment.trim() || feedback ? t('review.shared.change') : t('review.shared.optional')} done={!!comment.trim() || !!feedback} onPress={() => setSheet('say')} />
      {logged && also.length > 0 ? <Text style={[txt.xsStrong, styles.center, { color: C.primary }]}>{t('review.screen.savesTo', { count: also.length + 1 })}</Text> : null}
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
        ) : <BigMic label={t('review.screen.tapAndSpeak')} onClip={setFeedback} />}
        {typeFeedback || comment ? (
          <Field value={comment} onChangeText={setComment} placeholder={logged ? t('review.screen.typeWhatPeopleUnderstood') : t('review.screen.typeWhatWorked')} multiline />
        ) : <LinkBtn label={t('common.orTypeIt')} style={{ alignSelf: 'center' }} onPress={() => setTypeFeedback(true)} />}
      </Centre>
      {evidence ? (
        <View style={styles.partRow}>
          <PlayChip ctx={ctx} clip={evidence} label={t('review.screen.listenerRetelling')} />
          <LinkBtn label={t('common.remove')} color={C.muted} accessibilityLabel={t('review.screen.removeRetelling')} onPress={() => setEvidence(null)} />
        </View>
      ) : (
        <DashedRow tile icon="user" label={t('review.screen.recordListenerRetelling')} right={t('review.shared.optional')} onPress={() => setSheet('retell')} />
      )}
    </>
  );

  const header = why ? (
    <Header title={title} sub={sub} crumbs={crumbs} onBack={() => setWhy(false)} />
  ) : (
    <>
      <Header title={title} sub={sub} crumbs={crumbs} onBack={ctx.back} close />
      <StepStrip stages={stages} at={at} onGo={goStage} />
    </>
  );

  // Keyed by stage and question so each opens at its top.
  return (
    <Screen key={`${stage}:${qi}:${why}`} footer={footer} header={header} bodyStyle={{ flexGrow: 1 }}>
      {why ? whyBody : stage === 'listen' ? listen : stage === 'questions' ? question : decide}

      {sheet === 'background' && context ? (
        <BackgroundSheet ctx={ctx} v={v} takeId={version.takeId} translator={translator} translatorIsYou={mine} data={context} usage={usage} kind={v.kind}
          onClose={() => setSheet(null)}
          onOpenTerm={(termId) => afterSheet(() => ctx.go('key_term_detail', { termId, unitId: v.unitId, languageId: v.languageId }))}
          onOpenStep={(stepId) => afterSheet(() => { if (guideItem) usage.open(guideItem); ctx.go('study_step', { unitId: v.unitId, languageId: v.languageId, stepId }); })}
          onOpenStudy={() => afterSheet(() => { if (guideItem) usage.open(guideItem); ctx.go('study_guide', { unitId: v.unitId, languageId: v.languageId }); })}
          onMoreBibles={() => afterSheet(() => ctx.go('bible_explore', { unitId: v.unitId, languageId: v.languageId }))} />
      ) : null}

      {sheet === 'who' ? (
        <Sheet visible title={whoTitle}
          sub={t('review.screen.whoSheetSub')} onClose={() => setSheet(null)}
          footer={<PrimaryBtn label={t('common.done')} onPress={() => setSheet(null)} />}>
          {logged && !group ? (
            <Field value={givenBy} onChangeText={setGivenBy} autoCapitalize="words" placeholder={makes ? t('review.screen.whoMadeIt') : t('review.screen.whoReviewedIt')} />
          ) : <PeopleCounter value={people} onChange={setPeople} />}
          {/* Already happened keeps where under Add details, with which version and other passages. */}
          {logged ? null : <Field value={place} onChangeText={setPlace} placeholder={t('review.screen.wherePlaceholder')} />}
        </Sheet>
      ) : null}

      {sheet === 'details' ? (
        <Sheet visible title={t('review.screen.addDetails')} sub={t('review.screen.detailsSub')} onClose={() => setSheet(null)}
          footer={<PrimaryBtn label={t('common.done')} onPress={() => setSheet(null)} />}>
          <Field value={place} onChangeText={setPlace} placeholder={t('review.screen.wherePlaceholder')} />
          {v.p.versions.length > 1 ? (
            <Block label={t('review.screen.whichVersion')}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {[...v.p.versions].reverse().map((x) => (
                  <Chip key={x.takeId} label={versionTitle(x.n)} on={x.takeId === version.takeId} onPress={() => setTakeId(x.takeId)} />
                ))}
              </View>
            </Block>
          ) : null}
          {here ? <AlsoCoveredPicker here={here} all={all} picked={also} onChange={setAlso} /> : null}
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
          onClose={() => setSheet(null)} footer={<PrimaryBtn label={t('common.done')} onPress={() => setSheet(null)} />}>
          <VoiceNote ctx={ctx} label={logged ? t('review.screen.recordSummary') : t('common.sayIt')} hash={feedback?.hash ?? null}
            onChange={(h, card) => setFeedback(h ? { hash: h, durationMs: card?.durationMs ?? 0, format: card?.format ?? 'm4a' } : null)} />
          <Field value={comment} onChangeText={setComment} placeholder={t('common.orTypeIt')} multiline />
        </Sheet>
      ) : null}

      {sheet === 'retell' ? (
        <Sheet visible title={t('review.screen.recordListenerRetelling')} sub={t('review.screen.retellSub')} onClose={() => setSheet(null)}>
          <View style={{ paddingVertical: space.lg }}>
            <BigMic label={t('review.screen.tapRecordRetelling')} size={96} onClip={(clip) => { setEvidence(clip); setSheet(null); }} />
          </View>
        </Sheet>
      ) : null}

      {momentAt !== null ? (
        <Sheet visible title={t('review.screen.noteAt', { time: formatClock(momentAt) })}
          sub={mine ? t('review.screen.noteAtSubMine') : t('review.screen.noteAtSub', { name: translator })}
          onClose={() => setMomentAt(null)}>
          <View style={{ paddingVertical: space.lg }}>
            <BigMic label={t('review.screen.tapAndSpeak')} size={96} onClip={(clip) => { const atMs = momentAt; setMoments((m) => [...m.filter((x) => x.hash !== clip.hash), { ...clip, atMs }]); setMomentAt(null); }} />
          </View>
        </Sheet>
      ) : null}

      <ReasonSheet visible={skipFor !== null} title={t('review.screen.skipTitle')}
        sub={t('review.screen.skipSub')}
        quickReasons={cantAnswerReasons()} confirmLabel={t('review.screen.skipConfirm')}
        footnote={t('review.screen.skipFootnote')}
        onClose={() => setSkipFor(null)}
        onConfirm={({ reason }) => { if (skipFor) setSkipped((s) => ({ ...s, [skipFor]: reason })); setSkipFor(null); }} />
    </Screen>
  );
}

/** The background a reviewer may open, or null when the kind withholds it (REV-1, REV-4). */
function backgroundFor(ctx: Ctx, v: PassageView, kindId: string, takeId: string, guide: StudyGuide | null) {
  const { state, p } = v;
  const terms = keyTermLinksFor(state, takeId).map((l) => l.term);
  const notes = p.notes.filter((n) => n.anchor.kind !== 'study');
  const versionN = (id: string) => p.versions.find((x) => x.takeId === id)?.n;
  const anchor = (n: PassageNote) => noteAnchorText(n.anchor, { term: (id) => state.keyTerms[id]?.term, versionN });
  const olderVersion = (n: PassageNote) => {
    const on = n.onTakeId ? versionN(n.onTakeId) : undefined;
    return n.onTakeId && n.onTakeId !== takeId && on ? versionTitle(on) : undefined;
  };
  const study = guide ? studyProgress(state, p, guide) : null;
  const compare = toCompareFor(p, v.kinds, kindId);
  const earlier = earlierReviews(p, v.kinds, kindId);
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
        <View style={{ flex: 1 }}><GhostBtn label={t('review.guest.someUnclear')} disabled onPress={() => undefined} /></View>
        <View style={{ flex: 1 }}><PrimaryBtn label={t('review.guest.understoodWell')} tone="green" disabled onPress={() => undefined} /></View>
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
          <Badge label={t('review.guest.noAccount')} />
        </View>
        <Text style={txt.title}>{headline}</Text>
        <Text style={txt.xs}>{v.language} · {kind.name}</Text>
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
        <Card key={q.q.id}>
          <Text style={[txt.body, { fontWeight: '600' }]}>{q.q.text}</Text>
          <AnswerInput type={q.q.type} value={answers[q.q.id]} onChange={(val) => setAnswers((a) => ({ ...a, [q.q.id]: val }))} />
        </Card>
      ))}
      <Block label={t('review.guest.tellUs')}>
        {/* A voice reply would be saved to the language's record; a preview must not write, so it is shown, not live. */}
        <View style={styles.voiceOff} accessibilityState={{ disabled: true }}>
          <View style={styles.micDot}><Ico name="mic" size={18} color={C.white} /></View>
          <Text style={[txt.sm, { flex: 1, fontWeight: '600', color: C.muted }]}>{t('review.guest.replyByVoice')}</Text>
        </View>
        <Field value={comment} onChangeText={setComment} placeholder={t('common.orTypeIt')} multiline />
      </Block>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  h1: { fontSize: T.xxl, fontWeight: '800', color: C.dark },
  lead: { fontSize: T.base, color: C.muted, lineHeight: 23 },
  verdictRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md },
  answer: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: space.lg, paddingVertical: space.xl },
  qFoot: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  partRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md },
  brand: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  voiceOff: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.md, paddingVertical: space.sm,
    borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: TINT.gray, opacity: 0.7 },
  micDot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: C.faint }
});

export const contracts = contractsFor('review_capture', 'add_record', 'guest_review');
