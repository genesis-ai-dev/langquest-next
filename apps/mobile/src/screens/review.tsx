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
import { TITLES } from '../flow';
import { indexesFor } from '../indexes';
import {
  Badge, Banner, Card, Chip, EmptyState, Field, GhostBtn, Group, Header, Ico, LinkBtn, PrimaryBtn, ReasonSheet, Row, Screen, Sheet, txt, useLayout
} from '../kit';
import { passageCrumbs, passageView as passageViewOf, plural, usePassage, versionTitle, type PassageView } from '../passageView';
import { problemText } from '../recording/parts';
import {
  canLeave, cleanAnswers, cleanSkips, clockMs, CANT_ANSWER, earlierReviews, firstOpenAt, isGroupKind, kindLabel, listenLine, loggedTargets, nextLabel,
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
      <Screen header={<Header title={logged ? TITLES.add_record : TITLES.review_capture} onBack={ctx.back} close />}>
        <EmptyState icon="book" title={ctx.language.state ? "This passage isn't in this language" : 'Loading…'} />
      </Screen>
    );
  }
  const crumbs = passageCrumbs(ctx, v, logged ? 'Already happened' : 'Review it');
  const sub = wide ? (logged ? 'Already happened' : v.language) : logged ? `${kindLabel(kind.name)} · already happened` : kindLabel(kind.name);
  const title = wide ? kind.name : v.title;
  if (!version) {
    return <Screen header={<Header title={title} sub={sub} crumbs={crumbs} onBack={ctx.back} close />}><EmptyState icon="mic" title="There's no recording to review yet." sub="Once a version is published, it can be reviewed here." /></Screen>;
  }
  if (!logged && kind.produces) {
    return (
      <Screen header={<Header title={title} sub={sub} crumbs={crumbs} onBack={ctx.back} close />}>
        <EmptyState icon="swap" title={`${kind.name} makes a recording`} sub={`It isn't a verdict, so it isn't reviewed here. Use ${kind.produces.action} on the passage's record.`} />
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
  const translator = mine ? 'you' : ctx.name(version.by).split(' ')[0] ?? ctx.name(version.by);
  const q = questions[Math.min(qi, Math.max(0, questions.length - 1))];
  const openAt = firstOpenAt(questions, captured.answers, skipped, makes ? {} : voice);
  const afterSheet = (fn: () => void) => { setSheet(null); setTimeout(fn, SHEET_GAP_MS); };
  const whoLine = summaryLine([
    (group || !logged) && people > 0 && `${people} ${people === 1 ? 'person' : 'people'}`,
    logged && !group && givenBy.trim(),
    !logged && place.trim()
  ]);

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
        const sentTo = version.by === actorId ? 'on the record' : `sent to ${ctx.name(version.by)}`;
        message = outcome === 'looks_good' ? `Looks good · ${sentTo}` : `Feedback ${sentTo}`;
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
        message = targets.length > 1 ? `${kind.name} added to ${targets.length} passages` : `${kind.name} added to the record`;
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
      ctx.toast(`Not saved: ${problemText(logged ? 'add record: save' : 'review: send', e)}`);
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
    footer = <PrimaryBtn label="Send feedback" icon="send" disabled={!r.saysWhat || !r.ready} busy={busy} onPress={() => void save('needs_changes')} />;
  } else if (stage === 'listen') {
    footer = next ? <PrimaryBtn label={nextLabel(next)} icon="right" onPress={goNext} /> : null;
  } else if (stage === 'questions' && q) {
    const last = qi >= questions.length - 1;
    const answeredHere = !!captured.answers[q.q.id]?.trim() || skipped[q.q.id] !== undefined;
    footer = (
      <View style={styles.qFoot}>
        <SkipBtn onPress={() => (q.required && !answeredHere ? setSkipFor(q.q.id) : goNext())} />
        <View style={{ flex: 1 }}>
          <PrimaryBtn label={last ? nextLabel(next ?? stages[at]!) : 'Next question'} icon="right"
            disabled={!canLeave(q, captured.answers, skipped, makes ? {} : voice)} onPress={goNext} />
        </View>
      </View>
    );
  } else if (stage === 'decide' && makes) {
    footer = (
      <>
        {logged && also.length > 0 ? <Text style={[txt.xsStrong, styles.center, { color: C.primary }]}>Saves to {also.length + 1} passages</Text> : null}
        <PrimaryBtn label="Save to the record" icon="check" disabled={!r.ready || made.length === 0} busy={busy} onPress={() => void save('recorded')} />
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
          For a {kind.name.toLowerCase()} that happened outside the app — in person, on a call, at church. It goes on the record credited to whoever gave it.
        </Text>
      ) : null}
      {directions ? <RequestBanner ctx={ctx} request={request} /> : null}
      <ClipPlayer language={ctx.language} hashes={version.cardHashes} big
        title={`${versionTitle(version.n)} · recorded by ${translator}`} sub={listenLine(kind.id, logged)}
        {...(makes ? {} : { onNote: (s: number) => setMomentAt(Math.round(s * 1000)) })} />
      <MomentList ctx={ctx} moments={moments} onRemove={(h) => setMoments((m) => m.filter((x) => x.hash !== h))} />
      {changed ? (
        <Card>
          <Text style={txt.sm}><Text style={{ fontWeight: '700' }}>What changed in {versionTitle(version.n)}:</Text> {version.changeNote ?? 'said in a voice note'}</Text>
          {version.changeBlobHash ? <AudioClip language={ctx.language} hashes={[version.changeBlobHash]} label="Play what changed" /> : null}
        </Card>
      ) : null}
      {context?.compare ? <CompareCard ctx={ctx} review={context.compare} kind={v.kind(context.compare.kindId)} version={version} /> : null}
      {context === null ? <WithheldNotice kind={kind} /> : (
        <Group>
          <Row leading={<Ico name="layers" size={28} color={C.primary} />} label="Background" sub={backgroundLine(context, { id: version.by, name: translator })}
            onPress={() => setSheet('background')} last />
        </Group>
      )}
      <DashedRow icon="people" label={logged && !group ? 'Who reviewed it?' : logged ? 'How many listened?' : 'Who is listening?'}
        {...(whoLine ? { sub: whoLine, done: true } : {})} right={whoLine ? 'Change' : 'optional'} onPress={() => setSheet('who')} />
      {logged ? (
        <DashedRow icon="edit" label="Add details"
          sub={summaryLine([
            place.trim() || 'Where',
            `${versionTitle(version.n)}${latest && version.takeId === latest.takeId ? ' (latest)' : ''}`,
            otherPassages && (also.length ? `+${plural(also.length, 'passage')}` : 'Other passages'),
            !makes && (evidence ? 'Retelling recorded' : 'Retelling')
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
            <Text style={[txt.body, styles.center]}><Text style={{ fontWeight: '700' }}>Left unanswered:</Text> {skipped[q.q.id]}</Text>
            <LinkBtn label="Answer it" onPress={() => setSkipped((s) => { const { [q.q.id]: _gone, ...rest } = s; return rest; })} />
          </View>
        ) : q.q.type !== 'text' ? (
          <BigChoices type={q.q.type} value={answers[q.q.id]} onChange={(val) => setAnswers((a) => ({ ...a, [q.q.id]: val }))} />
        ) : (
          <>
            {makes ? null : voice[q.q.id] ? (
              <>
                <PlayChip ctx={ctx} clip={voice[q.q.id]!} label="Their answer" />
                <AgainBtn label="Record again" onPress={() => setVoice((x) => { const { [q.q.id]: _gone, ...rest } = x; return rest; })} />
              </>
            ) : (
              <BigMic label="Tap and record the answer" size={96} onClip={(clip) => setVoice((x) => ({ ...x, [q.q.id]: clip }))} />
            )}
            {makes || typing[q.q.id] || answers[q.q.id] ? (
              <View style={{ alignSelf: 'stretch' }}>
                <Field value={answers[q.q.id] ?? ''} onChangeText={(val) => setAnswers((a) => ({ ...a, [q.q.id]: val }))} placeholder="Type the answer" multiline />
              </View>
            ) : (
              <LinkBtn label="Or type it" style={{ alignSelf: 'center' }} onPress={() => setTyping((t) => ({ ...t, [q.q.id]: true }))} />
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
        <Text style={[styles.h1, styles.center]}>Record the {makes.what}</Text>
        <Text style={[txt.smMuted, styles.center]}>It's what gets checked next, so it's the one thing this entry needs.</Text>
      </View>
      <View style={styles.answer}>
        <BigMic label={made.length ? 'Record another part' : 'Tap and speak'} onClip={(clip) => setMade((m) => (m.some((x) => x.hash === clip.hash) ? m : [...m, voiceCard(clip.hash, clip)]))} />
      </View>
      {made.map((c, i) => (
        <View key={c.hash} style={styles.partRow}>
          <PlayChip ctx={ctx} clip={{ hash: c.hash, durationMs: c.durationMs, format: c.format ?? 'm4a' }} label={`Part ${i + 1}`} tone="brand" />
          <LinkBtn label="Remove" color={C.muted} accessibilityLabel={`Remove part ${i + 1}`} onPress={() => setMade((m) => m.filter((x) => x.hash !== c.hash))} />
        </View>
      ))}
      <DashedRow icon="chatDots" label="What happened" sub={comment.trim() || (feedback ? 'Said in a voice note' : 'What was hard to say back')} right={comment.trim() || feedback ? 'Change' : 'optional'}
        done={!!comment.trim() || !!feedback} onPress={() => setSheet('say')} />
    </>
  ) : (
    <Centre>
      <View style={styles.verdictRow}>
        <Text style={[styles.h1, { flexShrink: 1 }]} accessibilityRole="header">{verdictQuestion(kind.id)}</Text>
        <SpeakBtn text={verdictQuestion(kind.id)} size={52} />
      </View>
      {openAt >= 0 ? (
        <LinkBtn label={`${r.open} required question${r.open === 1 ? '' : 's'} left — answer, or say why not`} style={{ alignSelf: 'center' }} onPress={() => goStage('questions')} />
      ) : null}
      <DecideCard tone="green" label="Looks good" icon="check" busy={busy} disabled={openAt >= 0} onPress={() => void save('looks_good')} />
      <DecideCard tone="amber" label="Needs changes" icon="chat" disabled={openAt >= 0 || busy} onPress={() => setWhy(true)} />
      <DashedRow icon="chatDots" label={logged ? 'What happened' : 'Say something about it'}
        sub={comment.trim() || (feedback ? 'Said in a voice note' : logged ? 'What people understood and asked about' : `${translator === 'you' ? 'It goes on the record' : `${translator} hears it`} with your answer`)}
        right={comment.trim() || feedback ? 'Change' : 'optional'} done={!!comment.trim() || !!feedback} onPress={() => setSheet('say')} />
      {logged && also.length > 0 ? <Text style={[txt.xsStrong, styles.center, { color: C.primary }]}>Saves to {also.length + 1} passages</Text> : null}
    </Centre>
  );

  // ---- What should change? ----
  const whyBody = (
    <>
      <View style={{ gap: space.sm, paddingTop: space.md }}>
        <OutcomePill label="Needs changes" />
        <Text style={[styles.h1, styles.center]} accessibilityRole="header">What should change?</Text>
        <Text style={[styles.lead, styles.center]}>
          {logged ? `Say what they said. ${mine ? 'It goes on the record.' : `${translator} will hear it.`}` : `Say it in your words. ${mine ? 'It goes on the record.' : `${translator} will hear it.`}`}
        </Text>
      </View>
      <Centre>
        {feedback ? (
          <View style={{ gap: space.md }}>
            <PlayChip ctx={ctx} clip={feedback} label="Your feedback" tone="amber" />
            <AgainBtn label="Record again" onPress={() => setFeedback(null)} />
          </View>
        ) : <BigMic label="Tap and speak" onClip={setFeedback} />}
        {typeFeedback || comment ? (
          <Field value={comment} onChangeText={setComment} placeholder={logged ? 'Or type what people understood and asked about' : "Or type it — what worked, what didn't"} multiline />
        ) : <LinkBtn label="Or type it" style={{ alignSelf: 'center' }} onPress={() => setTypeFeedback(true)} />}
      </Centre>
      {evidence ? (
        <View style={styles.partRow}>
          <PlayChip ctx={ctx} clip={evidence} label="Listener retelling" />
          <LinkBtn label="Remove" color={C.muted} accessibilityLabel="Remove the retelling" onPress={() => setEvidence(null)} />
        </View>
      ) : (
        <DashedRow tile icon="user" label="Record a listener retelling" right="optional" onPress={() => setSheet('retell')} />
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
        <BackgroundSheet ctx={ctx} v={v} takeId={version.takeId} translator={translator === 'you' ? 'you' : translator} data={context} usage={usage} kind={v.kind}
          onClose={() => setSheet(null)}
          onOpenTerm={(termId) => afterSheet(() => ctx.go('key_term_detail', { termId, unitId: v.unitId, languageId: v.languageId }))}
          onOpenStep={(stepId) => afterSheet(() => { if (guideItem) usage.open(guideItem); ctx.go('study_step', { unitId: v.unitId, languageId: v.languageId, stepId }); })}
          onOpenStudy={() => afterSheet(() => { if (guideItem) usage.open(guideItem); ctx.go('study_guide', { unitId: v.unitId, languageId: v.languageId }); })}
          onMoreBibles={() => afterSheet(() => ctx.go('bible_explore', { unitId: v.unitId, languageId: v.languageId }))} />
      ) : null}

      {sheet === 'who' ? (
        <Sheet visible title={logged && !group ? 'Who reviewed it?' : logged ? 'How many listened?' : 'Who is listening?'}
          sub="Optional. It goes on the record with this review." onClose={() => setSheet(null)}
          footer={<PrimaryBtn label="Done" onPress={() => setSheet(null)} />}>
          {logged && !group ? (
            <Field value={givenBy} onChangeText={setGivenBy} autoCapitalize="words" placeholder={makes ? 'Who made it — e.g. Okello Joseph' : 'Who reviewed it — e.g. Peter Lual'} />
          ) : <PeopleCounter value={people} onChange={setPeople} />}
          {/* Already happened keeps where under Add details, with which version and other passages. */}
          {logged ? null : <Field value={place} onChangeText={setPlace} placeholder="Where — e.g. Bor church, after service" />}
        </Sheet>
      ) : null}

      {sheet === 'details' ? (
        <Sheet visible title="Add details" sub="Which version was played, other passages the session covered, and a retelling." onClose={() => setSheet(null)}
          footer={<PrimaryBtn label="Done" onPress={() => setSheet(null)} />}>
          <Field value={place} onChangeText={setPlace} placeholder="Where — e.g. Bor church, after service" />
          {v.p.versions.length > 1 ? (
            <Block label="Which version was played">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {[...v.p.versions].reverse().map((x) => (
                  <Chip key={x.takeId} label={versionTitle(x.n)} on={x.takeId === version.takeId} onPress={() => setTakeId(x.takeId)} />
                ))}
              </View>
            </Block>
          ) : null}
          {here ? <AlsoCoveredPicker here={here} all={all} picked={also} onChange={setAlso} /> : null}
          {!makes ? (
            <Block label="Evidence · optional" hint="A retelling or a recorded conversation makes the review easy to trust.">
              <VoiceNote ctx={ctx} label="Record a retelling" hash={evidence?.hash ?? null}
                onChange={(h, card) => setEvidence(h ? { hash: h, durationMs: card?.durationMs ?? 0, format: card?.format ?? 'm4a' } : null)} />
            </Block>
          ) : null}
        </Sheet>
      ) : null}

      {sheet === 'say' ? (
        <Sheet visible title={logged ? 'What happened' : 'Say something about it'}
          sub={makes ? 'Optional — what was hard to say back.' : logged ? 'Optional — what people understood and asked about.' : `Optional. ${mine ? 'It goes on the record' : `${translator} hears it`} with your answer.`}
          onClose={() => setSheet(null)} footer={<PrimaryBtn label="Done" onPress={() => setSheet(null)} />}>
          <VoiceNote ctx={ctx} label={logged ? 'Record a summary' : 'Say it'} hash={feedback?.hash ?? null}
            onChange={(h, card) => setFeedback(h ? { hash: h, durationMs: card?.durationMs ?? 0, format: card?.format ?? 'm4a' } : null)} />
          <Field value={comment} onChangeText={setComment} placeholder="Or type it" multiline />
        </Sheet>
      ) : null}

      {sheet === 'retell' ? (
        <Sheet visible title="Record a listener retelling" sub="Ask someone who listened to tell it back in their own words. It goes with your review." onClose={() => setSheet(null)}>
          <View style={{ paddingVertical: space.lg }}>
            <BigMic label="Tap and record the retelling" size={96} onClip={(clip) => { setEvidence(clip); setSheet(null); }} />
          </View>
        </Sheet>
      ) : null}

      {momentAt !== null ? (
        <Sheet visible title={`A note at ${clockMs(momentAt)}`} sub={`Say what you noticed here. ${mine ? 'It goes on the record' : `${translator} hears it`} with your review.`}
          onClose={() => setMomentAt(null)}>
          <View style={{ paddingVertical: space.lg }}>
            <BigMic label="Tap and speak" size={96} onClip={(clip) => { const atMs = momentAt; setMoments((m) => [...m.filter((x) => x.hash !== clip.hash), { ...clip, atMs }]); setMomentAt(null); }} />
          </View>
        </Sheet>
      ) : null}

      <ReasonSheet visible={skipFor !== null} title="Leave this question unanswered?"
        sub="Required questions can be skipped — the reason is saved with your review."
        quickReasons={CANT_ANSWER} confirmLabel="Skip question"
        footnote="The reason is saved with your review."
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

  const header = <Header title={TITLES.guest_review} sub="Preview · what someone without the app sees" onBack={ctx.back} close />;
  if (!v) return <Screen header={header}><EmptyState icon="link" title={state ? 'No link to preview' : 'Loading…'} sub="Ask someone without the app from a passage to see what they get." /></Screen>;

  const kind: KindDef = v.kind(kindId);
  const version = v.p.latest;
  const mine = request?.by === ctx.session.actorId;
  const guest = request?.guest?.name ?? 'friend';
  const asker = request?.by ? ctx.name(request.by) : 'The translation team';
  const headline = mine ? `You asked ${guest} to listen to ${v.title}` : `${asker} asked you to listen to ${v.title}`;

  const footer = (
    <>
      <Text style={[txt.xs, styles.center]}>Preview only: replies by link need a server endpoint that isn't built yet, so nothing is sent.</Text>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}><GhostBtn label="Some parts unclear" disabled onPress={() => undefined} /></View>
        <View style={{ flex: 1 }}><PrimaryBtn label="Understood it well" tone="green" disabled onPress={() => undefined} /></View>
      </View>
    </>
  );

  return (
    <Screen header={header} footer={footer}>
      <Banner icon="link" title="Preview" body={`The page ${mine ? guest : 'they'} open${mine ? 's' : ''} from the link. You can try it; nothing here is saved.`} />
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={styles.brand}><Ico name="globe" size={18} color={C.white} /></View>
          <Text style={[txt.sm, { fontWeight: '800', flex: 1 }]}>LangQuest</Text>
          <Badge label="No account needed" />
        </View>
        <Text style={txt.title}>{headline}</Text>
        <Text style={txt.xs}>{v.language} · {kind.name}</Text>
      </Card>
      {request?.note ? <Card style={{ backgroundColor: C.light }}><Text style={txt.body}>“{request.note}”</Text></Card> : null}
      {request?.noteBlobHash ? <AudioClip language={ctx.language} hashes={[request.noteBlobHash]} label="Play their directions" /> : null}
      {version ? (
        <Card>
          <Text style={txt.h3}>Listen</Text>
          <AudioClip language={ctx.language} hashes={version.cardHashes} label={`Play ${v.title}`} />
        </Card>
      ) : <EmptyState icon="mic" title="There's no recording to listen to yet." />}
      {questions.map((q) => (
        <Card key={q.q.id}>
          <Text style={[txt.body, { fontWeight: '600' }]}>{q.q.text}</Text>
          <AnswerInput type={q.q.type} value={answers[q.q.id]} onChange={(val) => setAnswers((a) => ({ ...a, [q.q.id]: val }))} />
        </Card>
      ))}
      <Block label="Tell us what you understood">
        {/* A voice reply would be saved to the language's record; a preview must not write, so it is shown, not live. */}
        <View style={styles.voiceOff} accessibilityState={{ disabled: true }}>
          <View style={styles.micDot}><Ico name="mic" size={18} color={C.white} /></View>
          <Text style={[txt.sm, { flex: 1, fontWeight: '600', color: C.muted }]}>Tap to reply by voice</Text>
        </View>
        <Field value={comment} onChangeText={setComment} placeholder="Or type it" multiline />
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
