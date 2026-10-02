// Doing the work: recording (demo `screens/translate.tsx` WorkspaceScreen,
// flow nodes `workspace` and `back_translation`). REC-W1..6, REV-5, TERM-4;
// ADR-015 (a back translation makes content, it isn't a verdict), ADR-028
// (Publish confirms; the big red record button), ADR-029 (one Help button).
//
// One screen split in two (Caleb, LAN-23), instead of the demo's Listen →
// Record → Publish stages: the source on top (its audio, its text with key
// terms, on a cool ground), your recording below (on a warm ground), with a
// divider to drag between them. Recording happens inside the lower pane, so
// the source stays readable and playable; playing it pauses the microphone
// and recording resumes when it stops (listen, speak, listen).
//
// Workspace: your takes (each change kept as the draft on the record, so
// nothing is lost if you leave), the red record button, Help in the header,
// and Publish. Back translation: the same tools, but you listen to the
// latest version and what you save is content for the next check, not a
// version.
import {
  commands, keyTermsForUnit,
  type EventSpec, type KindDef, type PassageNote, type ReviewView, type Version
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AudioClip } from '../audioClip';
import type { Ctx } from '../ctx';
import { TITLES } from '../flow';
import { indexesFor } from '../indexes';
import {
  Banner, Card, EmptyState, Field, Header, PrimaryBtn, Screen, SectionLabel, Sheet, txt
} from '../kit';
import { PassageSourceAudio, SourcePlayer } from '../passageSourceAudio';
import { feedbackSource, passageCrumbs, usePassage, versionTitle, type PassageView } from '../passageView';
import { useBackTranslationDraft } from '../recording/backTranslationDraft';
import { CardList, problemText, RecordButton, SaveProblem, type ListedCard } from '../recording/parts';
import { SplitPane } from '../recording/SplitPane';
import { MIN_BOTTOM, MIN_BOTTOM_RECORDING } from '../recording/splitModel';
import { useListenLoop } from '../recording/useListenLoop';
import { VadControls, VadPanel } from '../recording/VadTakeover';
import {
  backTranslationDraftKey, canPublish, cardDurations, cardLabels, markTerms, removeCardSpecs, sameCards,
  termsInText, tiedTermIds, tieTermsSpecs, unsavedParts, workingCards
} from '../recording/workspaceModel';
import { HelpButton, HelpSheet, type TrayTab } from '../recording/WorkspaceTray';
import { pendingPassageCards } from '../recordingFlow';
import { reportError } from '../report';
import { RequestBanner } from '../reviewing/parts';
import { contractsFor } from '../screenContracts';
import { readingsFor, type Reading } from '../scripture';
import { useStudyGuide } from '../study/libraryGuides';
import { studyProgress } from '../study/progress';
import { C, radius, space, TINT, type as T, withAlpha } from '../theme';
import { useRecorder, type RecordedCard } from '../useRecorder';
import { VoiceNote } from '../voiceNote';

// ---- Workspace ---------------------------------------------------------------------

export function Workspace(ctx: Ctx) {
  const v = usePassage(ctx);
  if (!v) return <Missing ctx={ctx} title={TITLES.workspace} />;
  return <WorkspaceBody key={`${v.unitId}:${v.laneId}`} ctx={ctx} v={v} />;
}

function Missing(props: { ctx: Ctx; title: string; text?: string }) {
  return (
    <Screen header={<Header title={props.title} onBack={props.ctx.back} close />}>
      <EmptyState icon="mic" title={props.text ?? "This passage isn't on this phone yet."} sub={props.text ? undefined : 'It may still be loading.'} />
    </Screen>
  );
}

function WorkspaceBody({ ctx, v }: { ctx: Ctx; v: PassageView }) {
  const { state, unitId, laneId, p } = v;
  const me = ctx.session.actorId;
  const idx = indexesFor(state);
  const latest = p.latest;
  const nextN = p.versions.length + 1;
  const isFirst = !latest;

  // ---- the list of takes (REC-W2) ----
  const pendingCards = useMemo(() => pendingPassageCards(state, unitId, laneId, me), [state, unitId, laneId, me]);
  const pending = useMemo(() => pendingCards.map((c) => c.hash), [pendingCards]);
  const durations = useMemo(() => cardDurations(state, unitId, laneId), [state, unitId, laneId]);
  const draftCards = p.draftTakeId ? state.takes[p.draftTakeId]?.cardHashes : undefined;
  const [cleared, setCleared] = useState(false);
  const list = useMemo(() => workingCards({
    ...(draftCards ? { draftCards } : {}), ...(latest ? { latestCards: latest.cardHashes } : {}), pending, cleared
  }), [draftCards, latest, pending, cleared]);
  const labels = cardLabels(list, latest?.cardHashes);
  const changed = canPublish(list, latest?.cardHashes);

  // Cards arrive from the recorder already saved (addRecording, id chosen
  // before any save step, journaled against this passage). The latest
  // render's context is used so a card is never saved against stale state.
  const latestCtx = useRef(ctx);
  latestCtx.current = ctx;
  const persist = useCallback(async (card: RecordedCard) => {
    const current = latestCtx.current;
    const s = current.project.state;
    if (!s) throw new Error('Your organization is still loading.');
    await current.project.run(commands(s, indexesFor(s)).addRecording({
      commandId: card.id, recordingId: card.id, unitId, laneId, kind: 'target',
      card: { hash: card.ref.hash, durationMs: card.durationMs, format: card.ref.format }
    }));
    current.project.triggerUpload();
  }, [unitId, laneId]);
  const rec = useRecorder(persist, { orgId: ctx.project.orgId, projectId: ctx.project.projectId, unitId, laneId });
  const loop = useListenLoop(rec);
  const session = loop.phase !== 'off';
  const recording = session || rec.manualOn;

  // Every change persists (REC-W2): saved cards not yet in a take are
  // composed into the draft as soon as they land, so the list on the record
  // is always what is on screen.
  const [composing, setComposing] = useState(false);
  const [composeError, setComposeError] = useState('');
  const composeLock = useRef(false);
  useEffect(() => {
    if (pending.length === 0 || composeLock.current || composeError) return;
    composeLock.current = true;
    setComposing(true);
    let specs: EventSpec[];
    try {
      specs = commands(state, idx).keepTake({ commandId: Crypto.randomUUID(), unitId, laneId, cardHashes: list });
    } catch (e) {
      composeLock.current = false;
      setComposing(false);
      setComposeError(problemText('workspace: compose draft', e));
      return;
    }
    ctx.project.run(specs)
      .catch((e: unknown) => setComposeError(`Your takes are saved on this phone but not yet in your draft. ${problemText('workspace: save draft', e)}`))
      .finally(() => { composeLock.current = false; setComposing(false); });
    // `composing` is a dependency so a card that landed mid-compose is composed next.
  }, [state, pending, list, composing, composeError, ctx.project, idx, unitId, laneId]);

  // ---- deleting a take ----
  const [working, setWorking] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const saving = rec.busy || composing || working;
  const blocked = saving || recording;
  async function remove(hash: string) {
    if (blocked) return;
    const at = list.indexOf(hash);
    const label = labels[at] ?? 'Take';
    const before = list;
    const { specs, cleared: nowCleared } = removeCardSpecs(state, idx, {
      commandId: Crypto.randomUUID(), unitId, laneId, list, hash, pending: new Set(pending),
      ...(p.draftTakeId ? { draftTakeId: p.draftTakeId } : {}), ...(latest ? { latestCards: latest.cardHashes } : {})
    });
    const wasCleared = cleared;
    setWorking(true);
    // Set first so the list does not flash back to the latest version's takes.
    setCleared(nowCleared);
    try {
      await ctx.act(specs, `${label} deleted.`, () => {
        setCleared(false);
        if (latest && sameCards(before, latest.cardHashes)) return [];
        const s = stateRef.current;
        return commands(s, indexesFor(s)).keepTake({ commandId: Crypto.randomUUID(), unitId, laneId, cardHashes: before });
      });
    } catch {
      setCleared(wasCleared); // ctx.act said what went wrong
    } finally { setWorking(false); }
  }

  // ---- context: feedback being answered, or a request (REC-W6) ----
  const reviseId = ctx.params['reviewId'];
  const revising = reviseId ? p.reviews.find((r) => r.id === reviseId) : undefined;
  const requestId = ctx.params['requestId'];
  const request = (requestId ? p.requests.find((r) => r.id === requestId) : undefined)
    ?? p.openRequests.find((r) => r.what === 'record' && (!r.profileId || r.profileId === me));
  // Publishing answers every open feedback on the latest version (REC-W4).
  const answers = useMemo(() => {
    const out = [...p.awaitingResponse];
    if (revising && !out.some((r) => r.id === revising.id) && !revising.response) out.unshift(revising);
    return out;
  }, [p.awaitingResponse, revising]);

  // ---- source and key terms (REC-W1) ----
  const readings = useMemo(() => readingsFor(state, unitId), [state, unitId]);
  const reading = readings[0];
  const unitTerms = useMemo(() => keyTermsForUnit(state, laneId, unitId), [state, laneId, unitId]);
  const sourceWords = useMemo(() => reading?.verses.map((x) => x.text).join(' ') ?? '', [reading]);
  const tied = useMemo(() => tiedTermIds(state, p.draftTakeId ?? latest?.takeId), [state, p.draftTakeId, latest?.takeId]);
  // Tying a term is reference work (KeyTermLinked needs fill_reference), so
  // only someone who may tie carries ties onto the version they publish.
  const canTie = ctx.session.can('fill_reference');
  const trayTerms = useMemo(() => {
    const shown = reading ? termsInText(sourceWords, unitTerms) : unitTerms;
    const extra = unitTerms.filter((t) => tied.has(t.termId) && !shown.includes(t));
    return [...shown, ...extra];
  }, [reading, sourceWords, unitTerms, tied]);

  // ---- Help: the study tray as one sheet (REC-W5, ADR-029) ----
  const [help, setHelp] = useState(false);
  const closeHelp = useCallback(() => setHelp(false), []);
  const [tab, setTab] = useState<TrayTab>('terms');
  const guide = useStudyGuide(ctx, unitId, laneId);
  const study = useMemo(() => (guide ? studyProgress(state, p, guide) : null), [state, p, guide]);
  const notes = useMemo<PassageNote[]>(() => p.notes.filter((n) => n.anchor.kind !== 'study'), [p.notes]);

  // ---- publishing (REC-W3, REC-W4) ----
  const [confirming, setConfirming] = useState(false);
  const [publishing, setPublishing] = useState(false);
  async function publish(note: string, noteBlobHash: string | null) {
    const commandId = Crypto.randomUUID();
    let specs: EventSpec[];
    try {
      specs = commands(state, idx).publishVersion({
        commandId, unitId, laneId, cardHashes: list, actorId: me,
        ...(note.trim() ? { note: note.trim() } : {}), ...(noteBlobHash ? { noteBlobHash } : {})
      });
      if (canTie) specs = [...specs, ...tieTermsSpecs(state, specs, tied, commandId)];
    } catch (e) {
      ctx.toast(`Not published: ${problemText('workspace: publish', e)}`);
      return;
    }
    setPublishing(true);
    try {
      await ctx.act(specs, `${versionTitle(nextN)} published.`);
      setConfirming(false);
      ctx.go('passage_record', { unitId, laneId });
    } catch { /* ctx.act said what went wrong */ }
    finally { setPublishing(false); }
  }

  const cards: ListedCard[] = list.map((hash, i) => ({ hash, label: labels[i] ?? `Take ${i + 1}`, ...(durations.has(hash) ? { durationMs: durations.get(hash)! } : {}) }));
  const problem = rec.failureCount > 0
    ? <SaveProblem message={rec.error || 'A take did not save.'} retryLabel="Retry saving" busy={rec.busy} onRetry={() => void rec.retryFailed()} />
    : composeError ? <SaveProblem message={composeError} onRetry={() => setComposeError('')} />
    : rec.error ? <SaveProblem message={rec.error} /> : null;

  return (
    <Screen fixed
      header={<Header title={`Recording ${versionTitle(nextN)}`} sub={v.lane} crumbs={passageCrumbs(ctx, v, TITLES.workspace)} onBack={ctx.back} close
        action={<HelpButton onPress={() => setHelp(true)} disabled={recording} />} />}
      footer={session ? <VadControls rec={rec} onStop={() => void loop.toggle()} /> : (
        <View style={styles.actions}>
          <RecordButton recording={false} disabled={saving || rec.failureCount > 0} onPress={() => void loop.toggle()} />
          <View style={{ flex: 1 }}>
            <PrimaryBtn label="Publish" tone="dark" disabled={!changed || blocked || rec.failureCount > 0} onPress={() => setConfirming(true)} />
          </View>
        </View>
      )}>
      <SplitPane memoryKey="workspace" minBottom={session ? MIN_BOTTOM_RECORDING : MIN_BOTTOM}
        topStyle={styles.sourcePane} bottomStyle={styles.recordPane}
        top={
          <ScrollView contentContainerStyle={styles.paneBody} keyboardShouldPersistTaps="handled" accessibilityLabel="Source">
            {revising ? <FeedbackBanner ctx={ctx} review={revising} kind={v.kind(revising.kindId)} />
              : request ? <RequestBanner ctx={ctx} request={request} /> : null}
            <PassageSourceAudio ctx={ctx} unitId={unitId} laneId={laneId} disabled={false} listen={loop.hooks} />
            <Card>
              <View style={styles.labelRow}>
                <Text style={[txt.label, { flex: 1 }]}>Source{reading ? ` · ${reading.code}` : ''}</Text>
                {reading && trayTerms.length > 0 && !recording ? <Text style={[txt.xsStrong, { color: C.primary }]}>Tap an underlined word</Text> : null}
              </View>
              {reading && tied.size > 0 ? <Text style={[txt.xs, { color: TINT.greenText }]}>✓ marks a term tied to your draft</Text> : null}
              {reading ? <SourceText reading={reading} terms={unitTerms} tied={tied}
                {...(recording ? {} : { onTerm: (termId: string) => ctx.go('key_term_detail', { unitId, laneId, termId }) })} />
                : <Text style={txt.smMuted}>There's no source text for this passage in the app yet. Listen to the source, then record.</Text>}
            </Card>
          </ScrollView>
        }
        bottom={session ? <VadPanel rec={rec} phase={loop.phase} count={list.length} noun="take" onResume={loop.resumeNow} /> : (
          <ScrollView contentContainerStyle={styles.paneBody} accessibilityLabel="Your recording">
            {problem}
            <SectionLabel label="Your recording" action={<Text style={txt.xs}>{cards.length} take{cards.length === 1 ? '' : 's'} · saved on this phone</Text>} />
            <CardList ctx={ctx} cards={cards} disabled={blocked} onDelete={(h) => void remove(h)}
              empty={isFirst ? 'No takes yet — tap the red button below to start.' : 'No takes yet — tap the red button below to record this version.'} />
            {!isFirst && !changed && list.length > 0 ? (
              <Text style={[txt.xs, { textAlign: 'center' }]}>These are {versionTitle(latest.n)}'s takes. Record a new take or delete one to publish a new version.</Text>
            ) : null}
          </ScrollView>
        )} />

      {help ? (
        <HelpSheet ctx={ctx} v={v} tab={tab} onTab={setTab} onClose={closeHelp} terms={trayTerms} tied={tied} draftTakeId={p.draftTakeId}
          canTie={canTie} study={study} notes={notes} disabled={blocked} />
      ) : null}
      {confirming ? (
        <PublishSheet ctx={ctx} v={v} n={nextN} first={isFirst} busy={publishing} answers={answers} tied={canTie ? tied.size : 0}
          {...(revising ? { revisingKind: v.kind(revising.kindId).name } : {})}
          onClose={() => setConfirming(false)} onPublish={(note, hash) => void publish(note, hash)} />
      ) : null}
    </Screen>
  );
}

/**
 * Verses with their numbers inline; key-term words underlined (REC-W1). A
 * term tied to the draft is green with a solid underline and a ✓, and says
 * "tied" to a screen reader, so the tie never rests on colour alone. While
 * recording, the words stay marked but do not open the term (that would leave
 * the recording running behind another screen).
 */
function SourceText(props: { reading: Reading; terms: { termId: string; term: string }[]; tied: ReadonlySet<string>; onTerm?: (termId: string) => void }) {
  const onTerm = props.onTerm;
  const verses = useMemo(() => props.reading.verses.map((x) => ({ verse: x, parts: markTerms(x.text, props.terms) })), [props.reading, props.terms]);
  return (
    <Text style={styles.source}>
      {verses.map(({ verse, parts }) => (
        <Text key={verse.ref}>
          <Text style={styles.verseNum}>{verse.verse} </Text>
          {parts.map((part, i) => {
            if (!part.termId) return <Text key={i}>{part.text}</Text>;
            const tied = props.tied.has(part.termId);
            return (
              <Text key={i} {...(onTerm ? { onPress: () => onTerm(part.termId!), accessibilityRole: 'link' as const } : {})}
                accessibilityLabel={`${part.text}, key term${tied ? ', tied to your draft' : ''}`}
                style={[styles.term, tied ? styles.termTied : null]}>{part.text}{tied ? ' ✓' : ''}</Text>
            );
          })}
          {' '}
        </Text>
      ))}
    </Text>
  );
}

function FeedbackBanner(props: { ctx: Ctx; review: ReviewView; kind: KindDef }) {
  const r = props.review;
  return (
    <View style={{ gap: space.sm }}>
      <Banner icon="chat" tone="amber" title={`Revising after ${props.kind.name} feedback`}
        body={`${r.comment ? `“${r.comment}”\n` : ''}${feedbackSource(r, props.ctx.name)}`} />
      {r.commentBlobHash ? <AudioClip project={props.ctx.project} hashes={[r.commentBlobHash]} label="Play the voice feedback" /> : null}
    </View>
  );
}

/**
 * Publishing is a real step, so it always confirms (REC-W3, ADR-028): the
 * team can hear it and review it. A later version says what changed.
 */
function PublishSheet(props: {
  ctx: Ctx; v: PassageView; n: number; first: boolean; busy: boolean; answers: ReviewView[]; tied: number; revisingKind?: string;
  onClose: () => void; onPublish: (note: string, hash: string | null) => void;
}) {
  const [text, setText] = useState(props.revisingKind ? `Revised after the ${props.revisingKind} feedback.` : '');
  const [hash, setHash] = useState<string | null>(null);
  const needsNote = !props.first;
  const title = versionTitle(props.n);
  return (
    <Sheet visible title={`Publish ${title}?`}
      sub="Your team will be able to hear it and review it. It goes on this passage's record, and you can always record a new version later."
      onClose={props.onClose}
      footer={<PrimaryBtn label={`Publish ${title}`} tone="dark" busy={props.busy} disabled={needsNote && !text.trim() && !hash}
        onPress={() => props.onPublish(text, hash)} />}>
      <Text style={[txt.sm, { fontWeight: '700' }]}>
        {needsNote ? 'What changed?' : 'Anything reviewers should know?'}{needsNote ? '' : <Text style={[txt.sm, { color: C.muted, fontWeight: '400' }]}> · optional</Text>}
      </Text>
      <VoiceNote ctx={props.ctx} unitId={props.v.unitId} laneId={props.v.laneId} label={needsNote ? 'Say what changed' : 'Say it'} hash={hash} onChange={setHash} />
      <Field value={text} onChangeText={setText} placeholder="Or type it" multiline />
      {props.answers.length > 0 || props.tied > 0 ? (
        <View style={styles.checks}>
          {props.answers.map((r) => (
            <Text key={r.id} style={txt.sm}>✓ Answers the {props.v.kind(r.kindId).name} feedback from {feedbackSource(r, props.ctx.name)}</Text>
          ))}
          {props.tied > 0 ? <Text style={txt.sm}>✓ {props.tied} key term{props.tied === 1 ? '' : 's'} tied to this version</Text> : null}
        </View>
      ) : null}
    </Sheet>
  );
}

// ---- Back translation --------------------------------------------------------------

export function BackTranslation(ctx: Ctx) {
  const v = usePassage(ctx);
  const kindId = ctx.params['kindId'] ?? '';
  if (!v) return <Missing ctx={ctx} title={TITLES.back_translation} />;
  const kind = v.kind(kindId);
  if (!v.p.latest || !kind.produces) return <Missing ctx={ctx} title={TITLES.back_translation} text="There's no recording to back-translate yet." />;
  return <BackTranslationBody key={`${v.unitId}:${v.laneId}:${kindId}`} ctx={ctx} v={v} kind={kind} of={v.p.latest} />;
}

/**
 * The parts are kept on this phone until Save (decision 30): recorded cards
 * go to a local draft, not the record, so a deleted part is gone for good
 * and the saved review names exactly the parts on screen.
 */
function BackTranslationBody({ ctx, v, kind, of }: { ctx: Ctx; v: PassageView; kind: KindDef; of: Version }) {
  const { state, unitId, laneId, p } = v;
  const produces = kind.produces!;
  const me = ctx.session.actorId;
  const checkedBy = produces.checkedBy ? v.kind(produces.checkedBy).name : undefined;
  const drafts = useBackTranslationDraft(
    backTranslationDraftKey({ projectId: ctx.project.projectId, actorId: me, unitId, laneId, kindId: kind.id }), of.takeId);
  const parts = useMemo(() => unsavedParts(state, drafts.draft), [state, drafts.draft]);
  const madeFrom = drafts.draft && parts.length > 0 && drafts.draft.fromTakeId !== of.takeId
    ? p.versions.find((x) => x.takeId === drafts.draft!.fromTakeId) : undefined;
  const requestId = ctx.params['requestId'];
  const request = (requestId ? p.requests.find((r) => r.id === requestId) : undefined)
    ?? p.openRequests.find((r) => r.what === 'review' && r.kindId === kind.id && r.profileId === me);

  // No journal target: the card is on disk before this runs, and it is
  // named only by the draft until Save. Resolving after the draft is written
  // keeps the recorder holding the file until then.
  const add = drafts.add;
  const persist = useCallback(async (card: RecordedCard) => {
    await add({ hash: card.ref.hash, durationMs: card.durationMs, format: card.ref.format });
  }, [add]);
  const rec = useRecorder(persist);
  const loop = useListenLoop(rec);
  const session = loop.phase !== 'off';
  const recording = session || rec.manualOn;
  const [working, setWorking] = useState(false);
  const blocked = recording || rec.busy || working || !drafts.loaded || !!drafts.problem;

  async function remove(hash: string, label: string) {
    if (blocked) return;
    const at = parts.findIndex((c) => c.hash === hash);
    const card = parts[at];
    if (!card) return;
    setWorking(true);
    try {
      await drafts.remove(hash);
      ctx.toast(`${label} deleted.`, async () => {
        try { await drafts.add(card, at); } catch (e) { ctx.toast(`Not restored: ${problemText('back translation: restore part', e)}`); }
      });
    } catch (e) {
      ctx.toast(`Not deleted: ${problemText('back translation: delete part', e)}`);
    } finally { setWorking(false); }
  }

  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  async function save(note: string) {
    let specs: EventSpec[];
    try {
      specs = commands(state, indexesFor(state)).produceContent({
        commandId: Crypto.randomUUID(), fromTakeId: of.takeId, kindId: kind.id, cards: parts,
        ...(note.trim() ? { note: note.trim() } : {}), ...(request && !request.legacy ? { requestId: request.id } : {})
      });
    } catch (e) {
      ctx.toast(`Not saved: ${problemText('back translation: save', e)}`);
      return;
    }
    setSaving(true);
    try {
      await ctx.act(specs, `${capitalize(produces.what)} saved.`);
    } catch {
      setSaving(false); // ctx.act said what went wrong
      return;
    }
    // On the record now; a draft left behind is harmless (saved parts are never offered again).
    await drafts.clear().catch((e: unknown) => { reportError('back translation: clear draft', e); });
    setSaving(false);
    setConfirming(false);
    ctx.go('passage_record', { unitId, laneId });
  }

  const cards: ListedCard[] = parts.map((c, i) => ({ hash: c.hash, label: `${produces.into} · part ${i + 1}`, durationMs: c.durationMs }));
  const problem = drafts.problem ? <SaveProblem message={drafts.problem} />
    : rec.failureCount > 0 ? <SaveProblem message={rec.error || 'A part did not save.'} retryLabel="Retry saving" busy={rec.busy} onRetry={() => void rec.retryFailed()} />
    : rec.error ? <SaveProblem message={rec.error} /> : null;
  return (
    <Screen fixed
      header={<Header title={capitalize(produces.what)} sub={`${v.lane} → ${produces.into}`} crumbs={passageCrumbs(ctx, v, TITLES.back_translation)} onBack={ctx.back} close />}
      footer={session ? <VadControls rec={rec} onStop={() => void loop.toggle()} /> : (
        <View style={styles.actions}>
          <RecordButton recording={false} disabled={blocked || rec.failureCount > 0} onPress={() => void loop.toggle()} />
          <View style={{ flex: 1 }}>
            <PrimaryBtn label={`Save ${produces.what}`} tone="dark" disabled={cards.length === 0 || blocked || rec.failureCount > 0} onPress={() => setConfirming(true)} />
          </View>
        </View>
      )}>
      <SplitPane memoryKey="back_translation" minBottom={session ? MIN_BOTTOM_RECORDING : MIN_BOTTOM}
        topStyle={styles.sourcePane} bottomStyle={styles.recordPane}
        top={
          <ScrollView contentContainerStyle={styles.paneBody} accessibilityLabel={`Listen to ${versionTitle(of.n)}`}>
            {request ? <RequestBanner ctx={ctx} request={request} /> : null}
            {madeFrom ? (
              <Banner icon="history" tone="amber" title={`Your parts were made from ${versionTitle(madeFrom.n)}`}
                body={`${versionTitle(of.n)} is out now, and saving puts your ${produces.what} with it. Listen again and redo any part that changed.`} />
            ) : null}
            <SectionLabel label={`Listen · ${v.lane} ${versionTitle(of.n)}`} action={<Text style={txt.xs}>{ctx.name(of.by)}</Text>} />
            <Card>
              <SourcePlayer project={ctx.project} hashes={of.cardHashes} label={`Play ${versionTitle(of.n)}`} listen={loop.hooks} />
              <Text style={txt.xs}>Notes, key terms and earlier reviews are hidden on purpose, so only the recording shapes what you say.</Text>
            </Card>
            <Banner icon="swap" title="You're making new content"
              body={`Listen to ${versionTitle(of.n)}, then say what it means in ${produces.into}, in your own words. You're not judging it — ${checkedBy ? `the ${checkedBy} compares your ${produces.what} with the source` : `the next check compares your ${produces.what} with the source`}.`} />
          </ScrollView>
        }
        bottom={session ? <VadPanel rec={rec} phase={loop.phase} count={cards.length} noun="part" onResume={loop.resumeNow} /> : (
          <ScrollView contentContainerStyle={styles.paneBody} accessibilityLabel={`Your ${produces.what}`}>
            {problem}
            <SectionLabel label={`Your ${produces.what} (${produces.into})`} action={<Text style={txt.xs}>{cards.length} part{cards.length === 1 ? '' : 's'} · saved on this phone</Text>} />
            <CardList ctx={ctx} cards={cards} disabled={blocked} onDelete={(h) => void remove(h, cards.find((c) => c.hash === h)?.label ?? 'Part')}
              empty={drafts.loaded ? 'No parts yet — listen to a part, then tap the red button and say it in your own words.' : 'Loading your parts…'} />
          </ScrollView>
        )} />

      {confirming ? (
        <BackTranslationSheet what={produces.what} into={produces.into} of={of} checkedBy={checkedBy} busy={saving}
          onClose={() => setConfirming(false)} onSave={(note) => void save(note)} />
      ) : null}
    </Screen>
  );
}

function BackTranslationSheet(props: { what: string; into: string; of: Version; checkedBy: string | undefined; busy: boolean; onClose: () => void; onSave: (note: string) => void }) {
  const [text, setText] = useState('');
  return (
    <Sheet visible title={`Save ${props.what}`}
      sub={`Of ${versionTitle(props.of.n)}. ${props.checkedBy ? `The ${props.checkedBy} will listen to it next.` : 'It goes on the passage record.'}`}
      onClose={props.onClose}
      footer={<PrimaryBtn label={`Save ${props.what}`} tone="dark" busy={props.busy} onPress={() => props.onSave(text)} />}>
      <Text style={[txt.sm, { fontWeight: '700' }]}>Anything that was hard to say back? <Text style={[txt.sm, { color: C.muted, fontWeight: '400' }]}>Optional</Text></Text>
      <Field value={text} onChangeText={setText} placeholder={`Type it — e.g. a word with no ${props.into} match`} multiline />
    </Sheet>
  );
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  source: { fontSize: T.base, lineHeight: 28, color: C.dark },
  verseNum: { fontSize: T.xs, fontWeight: '700', color: C.primary },
  term: { fontWeight: '600', color: C.primary, backgroundColor: C.light, textDecorationLine: 'underline', textDecorationStyle: 'dotted' },
  termTied: { color: TINT.greenText, backgroundColor: TINT.green, textDecorationStyle: 'solid' },
  checks: { backgroundColor: C.light, borderRadius: radius.lg, paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.xs },
  // LAN-23: each half its own ground, so the two read as different places. The
  // source is cool (the brand's pale tint; the theme has no blue), your
  // recording warm (the red tint). Cards on both stay white, so text keeps its contrast.
  sourcePane: { backgroundColor: C.light },
  recordPane: { backgroundColor: withAlpha(C.red, 0.08) },
  paneBody: { padding: space.lg, gap: space.md }
});

export const contracts = contractsFor('workspace', 'back_translation');
