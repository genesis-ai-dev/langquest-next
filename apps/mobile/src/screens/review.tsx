// Reviewing: the UX demo's ReviewCaptureScreen ("Review it", and in logged
// mode "Already happened") and GuestReviewScreen ("Review by link"), from
// ng-langquest-ux src/screens/review.tsx and the AlsoCoveredPicker in
// screens/shared.tsx. Requirements REV-1..8; ADR-005 (reviews attach to the
// version they heard), ADR-015 (a kind that makes content records it rather
// than judging), ADR-028 (Already happened is per step and looks like
// reviewing it now), ADR-029 (three short stages: ① Listen ② Questions
// ③ Your verdict; one collapsed Background; Already happened's where, which
// version, other passages and retelling behind one Add details).
//
// Everything is read from the record (core derivePassage, questionsForKind,
// keyTermLinksFor) and written with core recordReview / produceContent. A
// review is grow-only, so sending it offers no Undo.
import {
  commands, derivePassage, keyTermLinksFor, questionsForKind,
  type Card as AudioCard, type EventSpec, type KindDef, type PassageNote
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AudioClip } from '../audioClip';
import type { Ctx } from '../ctx';
import { TITLES } from '../flow';
import { indexesFor } from '../indexes';
import {
  Badge, Banner, Card, Chip, Disclosure, EmptyState, Field, GhostBtn, Header, Ico, LinkBtn, PrimaryBtn, ReasonSheet, Screen, txt
} from '../kit';
import { passageCrumbs, passageView as passageViewOf, plural, usePassage, versionTitle, type PassageView } from '../passageView';
import { problemText } from '../recording/parts';
import { cleanAnswers, cleanSkips, CANT_ANSWER, earlierReviews, footHint, isGroupKind, loggedTargets, nextLabel, noteAnchorText, readiness,
  recordedPassages, requestFor, reviewStages, stageAt, summaryLine, toCompareFor, versionFor, type Answers, type Skips, type StageId } from '../reviewing/capture';
import {
  AlsoCoveredPicker, AnswerInput, Background, Block, CompareCard, ListenCard, PeopleCounter, QuestionList,
  RequestBanner, StageStrip, WithheldNotice
} from '../reviewing/parts';
import { contractsFor } from '../screenContracts';
import { SourceReader, useOfferedSources } from '../sources/SourceReader';
import { useUsage } from '../sources/used';
import { useStudyGuide } from '../study/libraryGuides';
import type { StudyGuide } from '../study/guides';
import { studyProgress } from '../study/progress';
import { C, space, TINT } from '../theme';
import { VoiceNote } from '../voiceNote';

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
  const [skipped, setSkipped] = useState<Skips>({});
  const [skipFor, setSkipFor] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [commentHash, setCommentHash] = useState<string | null>(null);
  const [also, setAlso] = useState<string[]>([]);
  const [people, setPeople] = useState(0);
  const [givenBy, setGivenBy] = useState('');
  const [place, setPlace] = useState('');
  const [evidence, setEvidence] = useState<AudioCard | null>(null);
  const [made, setMade] = useState<AudioCard[]>([]);
  const [busy, setBusy] = useState(false);
  // Where you are in the review, kept for this visit: Back from a key term or the study returns here.
  const [stageId, setStageId] = useState<StageId>('listen');

  const version = v ? versionFor(v.p, takeId) : undefined;
  const request = useMemo(() => v ? requestFor(v.p, kindId, actorId, { ...(ctx.params['requestId'] ? { requestId: ctx.params['requestId'] } : {}), mineOnly: logged }) : undefined,
    [v?.p, kindId, actorId, ctx.params, logged]);
  const questions = useMemo(() => v ? questionsForKind(v.state, kindId, v.laneId, request) : [], [v?.state, v?.laneId, kindId, request]);
  const guide = useStudyGuide(ctx, v?.unitId, v?.laneId);
  const context = useMemo(() => v && version && kind && !kind.withholdsContext ? backgroundFor(ctx, v, kindId, version.takeId, guide) : null,
    [v?.state, v?.p, kindId, version?.takeId, kind, guide]);
  const all = useMemo(() => v && logged ? recordedPassages(v.state, v.laneId) : [], [v?.state, v?.laneId, logged]);
  // What the Background offered and what was opened go on the record with the review (docs/reference-material.md).
  const usage = useUsage();
  const shown = !!context;
  useOfferedSources(ctx, shown ? v?.unitId : undefined, shown ? v?.laneId : undefined, shown ? usage : undefined);
  const guideItem = guide ? guide.id.split('~')[0] ?? guide.id : null;
  useEffect(() => {
    if (shown && guide && guideItem) usage.offer([{ itemId: guideItem, name: `${guide.pattern} · ${guide.passage}`, kind: 'guide', opened: false, ref: guide.passage }]);
  }, [shown, guide, guideItem, usage]);

  const crumbLabel = logged ? 'Already happened' : 'Review it';
  if (!v || !kind) {
    return (
      <Screen header={<Header title={logged ? TITLES.add_record : TITLES.review_capture} onBack={ctx.back} close />}>
        <EmptyState icon="book" title={ctx.project.state ? "This passage isn't in the project" : 'Loading…'} />
      </Screen>
    );
  }
  const header = (sub: string) => <Header title={kind.name} sub={sub} crumbs={passageCrumbs(ctx, v, crumbLabel)} onBack={ctx.back} close />;
  if (!version) {
    return <Screen header={header(v.lane)}><EmptyState icon="mic" title="There's no recording to review yet." sub="Once a version is published, it can be reviewed here." /></Screen>;
  }
  if (!logged && kind.produces) {
    return (
      <Screen header={header(`${v.lane} · ${versionTitle(version.n)}`)}>
        <EmptyState icon="swap" title={`${kind.name} makes a recording`} sub={`It isn't a verdict, so it isn't reviewed here. Use ${kind.produces.action} on the passage's record.`} />
      </Screen>
    );
  }

  const r = readiness(questions, answers, skipped, comment, commentHash);
  const hint = footHint(r, makes ? { what: makes.what, has: made.length > 0 } : undefined);
  const group = isGroupKind(kind.id);
  const here = all.find((p) => p.unitId === v.unitId);
  const detailKey = (part: string) => `${logged ? 'logged' : 'capture'}:${v.unitId}:${v.laneId}:${kind.id}:${part}`;
  const asker = request?.by ? ctx.name(request.by) : undefined;
  const stages = reviewStages({ questions: questions.length, logged, makes: !!makes });
  const at = stageAt(stages, stageId);
  const stage = stages[at]!.id;
  const next = stages[at + 1];
  const details = ctx.details(detailKey('details'));
  const latest = v.p.latest;
  const otherPassages = !!here && all.some((p) => p.unitId !== here.unitId);

  async function save(outcome: 'looks_good' | 'needs_changes' | 'recorded') {
    const state = ctx.project.state;
    if (!state || !v || !version || !kind || busy) return;
    const cmd = Crypto.randomUUID();
    const c = commands(state, indexesFor(state));
    const text = comment.trim();
    const cleanA = cleanAnswers(questions, answers);
    const cleanS = cleanSkips(questions, answers, skipped);
    let specs: EventSpec[] = [];
    let message: string;
    try {
      if (!logged) {
        specs = c.recordReview({
          commandId: cmd, takeIds: [version.takeId], kindId: kind.id, outcome: outcome === 'needs_changes' ? 'needs_changes' : 'looks_good', via: 'app',
          ...(text ? { comment: text } : {}), ...(commentHash ? { commentBlobHash: commentHash } : {}),
          ...(cleanA ? { answers: cleanA } : {}), ...(cleanS ? { skipped: cleanS } : {}), ...(request ? { requestId: request.id } : {})
        });
        const sentTo = version.by === actorId ? 'on the record' : `sent to ${ctx.name(version.by)}`;
        message = outcome === 'looks_good' ? `Looks good · ${sentTo}` : `Feedback ${sentTo}`;
      } else {
        const targets = loggedTargets(state, v.laneId, { unitId: v.unitId, takeId: version.takeId }, also);
        const who = !group && givenBy.trim() ? { givenBy: givenBy.trim() } : {};
        const shared = {
          ...(cleanA ? { answers: cleanA } : {}), ...(cleanS ? { skipped: cleanS } : {}),
          ...who, ...(group && people > 0 ? { people } : {}), ...(place.trim() ? { place: place.trim() } : {})
        };
        targets.forEach((t, i) => {
          const tp = t.unitId === v.unitId ? v.p : derivePassage(state, t.unitId, v.laneId, indexesFor(state));
          const req = requestFor(tp, kind.id, actorId, { mineOnly: true });
          const commandId = `${cmd}:${i}`;
          specs.push(...(makes
            ? c.produceContent({
              commandId, fromTakeId: t.takeId, kindId: kind.id, cards: made, via: 'logged',
              ...(text ? { note: text } : {}), ...(commentHash ? { noteBlobHash: commentHash } : {}), ...shared, ...(req ? { requestId: req.id } : {})
            })
            : c.recordReview({
              commandId, takeIds: [t.takeId], kindId: kind.id, outcome: outcome === 'needs_changes' ? 'needs_changes' : 'looks_good', via: 'logged',
              ...(text ? { comment: text } : {}), ...(commentHash ? { commentBlobHash: commentHash } : {}), ...shared,
              ...(evidence ? { artifacts: [evidence] } : {}), ...(req ? { requestId: req.id } : {})
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
          return c.referencesUsed({ commandId: cmd, laneId: v.laneId, unitId: v.unitId, reviewId: p.reviewId, items: used });
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
    ctx.go('passage_record', { unitId: v.unitId, laneId: v.laneId });
  }

  const verdictFooter = (
    <>
      {!r.ready ? (
        <LinkBtn label={hint ?? ''} color={C.muted} style={{ alignSelf: 'center' }} onPress={() => setStageId('questions')} />
      ) : hint ? <Text style={[txt.xs, styles.center]}>{hint}</Text> : null}
      {logged && also.length > 0 ? <Text style={[txt.xsStrong, styles.center, { color: C.primary }]}>Saves to {also.length + 1} passages</Text> : null}
      {makes ? (
        <PrimaryBtn label="Save to the record" icon="check" disabled={!r.ready || made.length === 0} busy={busy} onPress={() => void save('recorded')} />
      ) : (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}><GhostBtn label="Needs changes" icon="chat" tone="amber" disabled={!r.ready || !r.saysWhat || busy} onPress={() => void save('needs_changes')} /></View>
          <View style={{ flex: 1 }}><PrimaryBtn label="Looks good" tone="green" icon="check" disabled={!r.ready} busy={busy} onPress={() => void save('looks_good')} /></View>
        </View>
      )}
    </>
  );
  const footer = next ? (
    <>
      {stage === 'questions' && !r.ready ? <Text style={[txt.xs, styles.center]}>{hint}</Text> : null}
      <PrimaryBtn label={nextLabel(next)} icon="arrowR" onPress={() => setStageId(next.id)} />
    </>
  ) : verdictFooter;

  const listen = (
    <>
      {logged ? (
        <>
          <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>
            For a {kind.name.toLowerCase()} that happened outside the app — in person, on a call, at church. It goes on the record credited to whoever gave it.
          </Text>
          {group ? <PeopleCounter value={people} onChange={setPeople} /> : (
            <Field value={givenBy} onChangeText={setGivenBy} autoCapitalize="words" placeholder={makes ? 'Who made it — e.g. Okello Joseph' : 'Who reviewed it — e.g. Peter Lual'} />
          )}
          <Disclosure icon="edit" title="Add details" open={details.open} onToggle={details.onToggle}
            summary={summaryLine([
              place.trim() || 'Where',
              `${versionTitle(version.n)}${latest && version.takeId === latest.takeId ? ' (latest)' : ''}`,
              otherPassages && (also.length ? `+${plural(also.length, 'passage')}` : 'Other passages'),
              !makes && (evidence ? 'Retelling recorded' : 'Retelling')
            ])}>
            <View style={{ padding: space.lg, gap: space.lg }}>
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
                  <VoiceNote ctx={ctx} unitId={v.unitId} laneId={v.laneId} label="Record a retelling" hash={evidence?.hash ?? null}
                    onChange={(h, card) => setEvidence(h ? voiceCard(h, card) : null)} />
                </Block>
              ) : null}
            </View>
          </Disclosure>
        </>
      ) : null}

      {request ? <RequestBanner ctx={ctx} request={request} /> : null}

      <ListenCard ctx={ctx} version={version} />

      {context === null ? <WithheldNotice kind={kind} /> : (
        <>
          {context.compare ? <CompareCard ctx={ctx} review={context.compare} kind={v.kind(context.compare.kindId)} version={version} /> : null}
          <Background ctx={ctx} detailsKey={detailKey('background')}
            terms={context.terms} notes={context.notes} anchor={context.anchor} olderVersion={context.olderVersion}
            onOpenTerm={(termId) => ctx.go('key_term_detail', { termId, unitId: v.unitId, laneId: v.laneId })}
            study={context.study}
            onOpenStep={(stepId) => { if (guideItem) usage.open(guideItem); ctx.go('study_step', { unitId: v.unitId, laneId: v.laneId, stepId }); }}
            onOpenStudy={() => { if (guideItem) usage.open(guideItem); ctx.go('study_guide', { unitId: v.unitId, laneId: v.laneId }); }}
            reviews={context.earlier} kind={v.kind}
            source={<SourceReader ctx={ctx} unitId={v.unitId} laneId={v.laneId} usage={usage}
              onMoreBibles={() => ctx.go('bible_explore', { unitId: v.unitId, laneId: v.laneId })} />} />
        </>
      )}
    </>
  );

  const verdict = makes ? (
    <>
      <Block label={`The ${makes.what}`} hint="It's what gets checked next, so it's the one thing this entry needs.">
        {made.map((c, i) => (
          <VoiceNote key={c.hash} ctx={ctx} unitId={v.unitId} laneId={v.laneId} label={`Part ${i + 1}`} hash={c.hash}
            onChange={(nextHash, card) => setMade((m) => nextHash ? m.map((x) => (x.hash === c.hash ? voiceCard(nextHash, card) : x)) : m.filter((x) => x.hash !== c.hash))} />
        ))}
        <VoiceNote key={`new-${made.length}`} ctx={ctx} unitId={v.unitId} laneId={v.laneId}
          label={made.length ? 'Record another part' : `Record the ${makes.what}`} hash={null}
          onChange={(h, card) => { if (h) setMade((m) => (m.some((x) => x.hash === h) ? m : [...m, voiceCard(h, card)])); }} />
      </Block>
      <Block label="What happened" hint="Optional — what was hard to say back.">
        <VoiceNote ctx={ctx} unitId={v.unitId} laneId={v.laneId} label="Record a summary" hash={commentHash} onChange={setCommentHash} />
        <Field value={comment} onChangeText={setComment} placeholder="Or type what was hard to say back" multiline />
      </Block>
    </>
  ) : (
    <Block label={logged ? 'What happened' : 'Your feedback'}>
      <VoiceNote ctx={ctx} unitId={v.unitId} laneId={v.laneId} label={logged ? 'Record a summary' : 'Record voice feedback'} hash={commentHash} onChange={setCommentHash} />
      <Field value={comment} onChangeText={setComment} multiline
        placeholder={logged ? 'Or type what people understood and asked about' : "Or type it — what worked, what didn't"} />
    </Block>
  );

  // Keyed by stage so each stage opens at its top.
  return (
    <Screen key={stage} footer={footer}
      header={<>{header(`${logged ? 'Already happened · ' : ''}${v.lane} · ${versionTitle(version.n)}`)}<StageStrip stages={stages} at={at} onGo={setStageId} /></>}>
      {stage === 'listen' ? listen : null}

      {stage === 'questions' ? (
        <QuestionList questions={questions} answers={answers} skipped={skipped} {...(asker ? { asker } : {})}
          onAnswer={(id, val) => setAnswers((a) => ({ ...a, [id]: val }))}
          onSkip={setSkipFor}
          onUnskip={(id) => setSkipped((s) => { const { [id]: _gone, ...rest } = s; return rest; })} />
      ) : null}

      {stage === 'verdict' ? verdict : null}

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
  const state = ctx.project.state;
  const requestId = ctx.params['requestId'];
  const named = requestId && state ? state.requests[requestId] : undefined;
  const unitId = named?.unitId ?? ctx.params['unitId'];
  const laneId = named?.laneId ?? ctx.params['laneId'] ?? ctx.laneId ?? undefined;
  const v = useMemo(() => state && unitId && laneId && state.units[unitId] ? passageViewOf(state, unitId, laneId) : null, [state, unitId, laneId]);
  const [answers, setAnswers] = useState<Answers>({});
  const [comment, setComment] = useState('');
  const request = v ? (requestId ? v.p.requests.find((r) => r.id === requestId) : undefined)
    ?? [...v.p.openRequests].reverse().find((r) => r.what === 'review' && !!r.guest) : undefined;
  const kindId = request?.kindId ?? 'community';
  const questions = useMemo(() => v ? questionsForKind(v.state, kindId, v.laneId, request).slice(0, 3) : [], [v, kindId, request]);

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
        <Text style={txt.xs}>{v.lane} · {kind.name}</Text>
      </Card>
      {request?.note ? <Card style={{ backgroundColor: C.light }}><Text style={txt.body}>“{request.note}”</Text></Card> : null}
      {request?.noteBlobHash ? <AudioClip project={ctx.project} hashes={[request.noteBlobHash]} label="Play their directions" /> : null}
      {version ? (
        <Card>
          <Text style={txt.h3}>Listen</Text>
          <AudioClip project={ctx.project} hashes={version.cardHashes} label={`Play ${v.title}`} />
        </Card>
      ) : <EmptyState icon="mic" title="There's no recording to listen to yet." />}
      {questions.map((q) => (
        <Card key={q.q.id}>
          <Text style={[txt.body, { fontWeight: '600' }]}>{q.q.text}</Text>
          <AnswerInput type={q.q.type} value={answers[q.q.id]} onChange={(val) => setAnswers((a) => ({ ...a, [q.q.id]: val }))} />
        </Card>
      ))}
      <Block label="Tell us what you understood">
        {/* A voice reply would be saved to the project's record; a preview must not write, so it is shown, not live. */}
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
  brand: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  voiceOff: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.md, paddingVertical: space.sm,
    borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: TINT.gray, opacity: 0.7 },
  micDot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: C.faint }
});

export const contracts = contractsFor('review_capture', 'add_record', 'guest_review');
