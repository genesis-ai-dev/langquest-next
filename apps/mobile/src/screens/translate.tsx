// Doing the work: recording (demo `screens/translate.tsx` WorkspaceScreen,
// flow nodes `workspace` and `back_translation`). REC-W1..6, REV-5, TERM-4;
// ADR-015 (a back translation makes content, it isn't a verdict), ADR-028
// (Publish confirms; the big red record button), ADR-029 (one Help button).
//
// The workspace is the simple redesign's (decision 71; demo ADR-034, ADR-036;
// demo simple/translator.tsx Workspace and Publish): reference on top, the
// recorder below, one divider with five stops (the reference as one line,
// a third, half, two thirds, the recorder as one line), opening at half and
// staying where it was left. The reference takes whatever is attached, one
// chip each: the Bible (play, Back 10 s, a Bible picker, notes on verses and
// moments), the guide, key words (hear each, say yours, add one), notes, and
// everything recorded so far. Playing the Bible while recording pauses the
// microphone and recording resumes when it stops (listen, speak, listen;
// LAN-23). The recorder shows the parts recorded under one card and the
// next part lit; the big red button and Publish are in the footer, or in
// the recorder's one line. Publish is its own screen inside this one, so
// nothing recorded or offered is lost on the way. The sensitivity and the
// pause between parts are set in microphone setup (`mic_setup`).
//
// Every change persists: each part is kept as the draft on the record, so
// nothing is lost if you leave. Back translation: the same tools, but you
// listen to the latest version and what you save is content for the next
// check, not a version.
import {
  commands, keyTermsForUnit,
  type EventSpec, type KindDef, type PassageNote, type Version
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Ctx } from '../ctx';
import { screenTitle } from '../flow';
import { t } from '../i18n';
import { indexesFor } from '../indexes';
import {
  Banner, Card, Chip, ChipRow, EmptyState, Field, Header, Ico, LinkBtn, PrimaryBtn, Screen, SectionLabel, Sheet, SmallBtn, txt
} from '../kit';
import { ReferenceRecordings, SourcePlayer } from '../passageSourceAudio';
import { feedbackSource, passageCrumbs, usePassage, type PassageView } from '../passageView';
import { useBackTranslationDraft } from '../recording/backTranslationDraft';
import { CardList, RecordButton, SaveProblem, type ListedCard } from '../recording/parts';
import { SplitPane } from '../recording/SplitPane';
import { MIN_BOTTOM, MIN_BOTTOM_RECORDING, rememberedSplit } from '../recording/splitModel';
import { useListenLoop } from '../recording/useListenLoop';
import { VadControls, VadPanel } from '../recording/VadTakeover';
import {
  backTranslationDraftKey, canPublish, cardDurations, cardLabels, removeCardSpecs, sameCards,
  termsInText, tiedTermIds, tieTermsSpecs, unsavedParts, workingCards
} from '../recording/workspaceModel';
import { getReferenceSlides } from '../passageResources';
import { pendingPassageCards } from '../recordingFlow';
import { failureMessage } from '../report';
import { RequestBanner } from '../reviewing/parts';
import { contractsFor } from '../screenContracts';
import { BackTranslationBody } from '../simple/btWorkspace';
import { SourceReader } from '../sources/SourceReader';
import { GuideNav, GuideStep } from '../simple/guide';
import { partLabel, partsLookClipped, refChips, totalMs, type RefChip } from '../simple/model';
import { QuietLink, RefChips, type ChipItem } from '../simple/parts';
import { PublishScreen } from '../simple/publish';
import { RecorderBar, RecorderFooter, RecorderPane, type Part } from '../simple/recorder';
import { BibleBar, BiblePane, EarlierPane, KeyWordsPane, NotesPane, RequestNote, useBible } from '../simple/reference';
import { useUsage } from '../sources/used';
import { useStudyGuide } from '../study/libraryGuides';
import { studyProgress } from '../study/progress';
import { C, radius, space, TINT, withAlpha } from '../theme';
import { useRecorder, type RecordedCard } from '../useRecorder';

// ---- Workspace ---------------------------------------------------------------------

export function Workspace(ctx: Ctx) {
  const v = usePassage(ctx);
  if (!v) return <Missing ctx={ctx} title={screenTitle('workspace')} />;
  return <WorkspaceBody key={`${v.unitId}:${v.languageId}`} ctx={ctx} v={v} />;
}

function Missing(props: { ctx: Ctx; title: string; text?: string }) {
  return (
    <Screen header={<Header title={props.title} onBack={props.ctx.back} close />}>
      <EmptyState icon="mic" title={props.text ?? t('translate.missing')} sub={props.text ? undefined : t('translate.missingSub')} />
    </Screen>
  );
}

function WorkspaceBody({ ctx, v }: { ctx: Ctx; v: PassageView }) {
  const { state, unitId, languageId, p } = v;
  const me = ctx.session.actorId;
  const idx = indexesFor(state);
  const latest = p.latest;
  const nextN = p.versions.length + 1;
  const isFirst = !latest;

  // ---- the list of takes (REC-W2) ----
  const pendingCards = useMemo(() => pendingPassageCards(state, unitId, me), [state, unitId, me]);
  const pending = useMemo(() => pendingCards.map((c) => c.hash), [pendingCards]);
  const durations = useMemo(() => cardDurations(state, unitId), [state, unitId]);
  const draftCards = p.draftTakeId ? state.takes[p.draftTakeId]?.cardHashes : undefined;
  const [cleared, setCleared] = useState(false);
  const list = useMemo(() => workingCards({
    ...(draftCards ? { draftCards } : {}), ...(latest ? { latestCards: latest.cardHashes } : {}), pending, cleared
  }), [draftCards, latest, pending, cleared]);
  const changed = canPublish(list, latest?.cardHashes);
  const [split, setSplit] = useState(() => rememberedSplit('workspace'));
  const [confirming, setConfirming] = useState(false);
  // This session's part lengths: three very short ones in a row look like clipping (demo ADR-037).
  const sessionLengths = useRef<number[]>([]);
  const [clipped, setClipped] = useState(false);

  // Cards arrive from the recorder already saved (addRecording, id chosen
  // before any save step, journaled against this passage). The latest
  // render's context is used so a card is never saved against stale state.
  const latestCtx = useRef(ctx);
  latestCtx.current = ctx;
  const persist = useCallback(async (card: RecordedCard) => {
    const current = latestCtx.current;
    const s = current.language.state;
    if (!s) throw new Error(t('translate.orgLoading'));
    await current.language.run(commands(s, indexesFor(s)).addRecording({
      commandId: card.id, recordingId: card.id, unitId, kind: 'target',
      card: { hash: card.ref.hash, durationMs: card.durationMs, format: card.ref.format }
    }));
    current.language.triggerUpload();
    sessionLengths.current.push(card.durationMs);
    if (partsLookClipped(sessionLengths.current)) setClipped(true);
  }, [unitId]);
  const rec = useRecorder(persist, { orgId: ctx.language.orgId, languageId, unitId });
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
      specs = commands(state, idx).keepTake({ commandId: Crypto.randomUUID(), unitId, cardHashes: list, actorId: me });
    } catch (e) {
      composeLock.current = false;
      setComposing(false);
      setComposeError(failureMessage('workspace: compose draft', e));
      return;
    }
    ctx.language.run(specs)
      .catch((e: unknown) => setComposeError(t('translate.takesNotInDraft', { reason: failureMessage('workspace: save draft', e) })))
      .finally(() => { composeLock.current = false; setComposing(false); });
    // `composing` is a dependency so a card that landed mid-compose is composed next.
  }, [state, pending, list, composing, composeError, ctx.language, idx, unitId, me]);

  // ---- deleting a take ----
  const [working, setWorking] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const saving = rec.busy || composing || working;
  const blocked = saving || recording;
  async function remove(hash: string, label = partLabel(Math.max(0, list.indexOf(hash)))) {
    if (blocked) return;
    const before = list;
    const { specs, cleared: nowCleared } = removeCardSpecs(state, idx, {
      commandId: Crypto.randomUUID(), unitId, actorId: me, list, hash, pending: new Set(pending),
      ...(p.draftTakeId ? { draftTakeId: p.draftTakeId } : {}), ...(latest ? { latestCards: latest.cardHashes } : {})
    });
    const wasCleared = cleared;
    setWorking(true);
    // Set first so the list does not flash back to the latest version's takes.
    setCleared(nowCleared);
    try {
      await ctx.act(specs, t('translate.partDeleted', { part: label }), () => {
        setCleared(false);
        if (latest && sameCards(before, latest.cardHashes)) return [];
        const s = stateRef.current;
        return commands(s, indexesFor(s)).keepTake({ commandId: Crypto.randomUUID(), unitId, cardHashes: before, actorId: me });
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

  // ---- reference (REC-W1, REC-W5; demo ADR-036): what is attached, one chip each ----
  // What was offered and used here goes on the record with the version (docs/reference-material.md).
  const usage = useUsage();
  const bible = useBible(ctx, unitId, languageId, { listen: loop.hooks, usage, hidden: confirming });
  const sourceWords = useMemo(() => (bible.rows ? bible.rows.map((r) => r.text).join(' ') : null), [bible.rows]);
  const unitTerms = useMemo(() => keyTermsForUnit(state, unitId), [state, unitId]);
  const tied = useMemo(() => tiedTermIds(state, p.draftTakeId ?? latest?.takeId), [state, p.draftTakeId, latest?.takeId]);
  // Tying a term is reference work (KeyTermLinked needs fill_reference), so
  // only someone who may tie carries ties onto the version they publish.
  const canTie = ctx.session.can('fill_reference');
  const trayTerms = useMemo(() => {
    const shown = sourceWords ? termsInText(sourceWords, unitTerms) : unitTerms;
    const extra = unitTerms.filter((t) => tied.has(t.termId) && !shown.includes(t));
    return [...shown, ...extra];
  }, [sourceWords, unitTerms, tied]);
  const guide = useStudyGuide(ctx, unitId);
  const study = useMemo(() => (guide ? studyProgress(state, p, guide) : null), [state, p, guide]);
  const notes = useMemo<PassageNote[]>(() => p.notes.filter((n) => n.anchor.kind !== 'study'), [p.notes]);
  const guideItem = guide ? guide.id.split('~')[0] ?? guide.id : null;
  useEffect(() => {
    if (guide && guideItem) usage.offer([{ itemId: guideItem, name: `${guide.pattern} · ${guide.passage}`, kind: 'guide', opened: false, ref: guide.passage }]);
  }, [guide, guideItem, usage]);
  const references = useMemo(() => getReferenceSlides(state, unitId), [state, unitId]);
  useEffect(() => {
    usage.offer(references.map((r) => ({ itemId: r.id, name: r.label, kind: r.id.startsWith('source:') ? 'source' as const : 'note' as const, opened: false })));
  }, [references, usage]);
  const hasEarlier = p.versions.length > 0 || p.reviews.length > 0;
  const chipIds = refChips('workspace', { bible: bible.hasVerses, guide: !!study, terms: true, notes: true, earlier: hasEarlier });
  // Opens on the Bible; answering feedback, on Earlier, where the feedback is (demo ADR-036).
  const [chipState, setChip] = useState<RefChip>(revising && hasEarlier ? 'earlier' : 'bible');
  const chip = chipIds.includes(chipState) ? chipState : chipIds[0] ?? 'terms';
  const [verse, setVerse] = useState<string | null>(null);
  const [stepState, setStep] = useState<number | null>(null);
  const step = study ? Math.min(study.steps.length - 1, stepState ?? study.next?.index ?? 0) : 0;
  const openChip = (c: RefChip) => {
    setChip(c);
    if (c === 'guide' && guideItem) usage.open(guideItem);
  };
  const chips: ChipItem<RefChip>[] = chipIds.map((c) => ({
    bible: { id: 'bible' as const, label: t('translate.chips.bible'), icon: 'listen' as const, hint: t('translate.chips.bibleHint') },
    guide: { id: 'guide' as const, label: t('translate.chips.guide'), icon: 'star' as const, hint: t('translate.chips.guideHint') },
    terms: { id: 'terms' as const, label: t('translate.chips.terms'), icon: 'key' as const, hint: t('translate.chips.termsHint') },
    notes: { id: 'notes' as const, label: t('translate.chips.notes'), icon: 'chat' as const, count: notes.length, hint: t('translate.chips.notesHint') },
    earlier: { id: 'earlier' as const, label: t('translate.chips.earlier'), icon: 'clock' as const, hint: t('translate.chips.earlierHint') }
  })[c]);

  // ---- microphone: offered when parts keep coming out clipped (demo ADR-037) ----
  useEffect(() => { if (session) sessionLengths.current = []; }, [session]);

  // ---- publishing (REC-W3, REC-W4) ----
  const [publishing, setPublishing] = useState(false);
  async function publish(note: string, noteBlobHash: string | null) {
    const commandId = Crypto.randomUUID();
    let specs: EventSpec[];
    try {
      specs = commands(state, idx).publishVersion({
        commandId, unitId, cardHashes: list, actorId: me,
        ...(note.trim() ? { note: note.trim() } : {}), ...(noteBlobHash ? { noteBlobHash } : {})
      });
      if (canTie) specs = [...specs, ...tieTermsSpecs(state, specs, tied, commandId)];
      const takeId = specs.find((x) => x.type === 'v1.TakeSubmitted')?.payload as { takeId: string } | undefined;
      if (takeId) specs = [...specs, ...commands(state, idx).referencesUsed({ commandId, unitId, takeId: takeId.takeId, items: usage.items() })];
    } catch (e) {
      ctx.toast(t('translate.notPublished', { reason: failureMessage('workspace: publish', e) }));
      return;
    }
    setPublishing(true);
    try {
      await ctx.act(specs, t('translate.versionPublished', { n: nextN }));
      setConfirming(false);
      // Publish, then ask (demo ADR-034): the record opens with the likely check ready to send.
      ctx.go('passage_record', { unitId, languageId, published: `${nextN}:${Date.now()}` });
    } catch { /* ctx.act said what went wrong */ }
    finally { setPublishing(false); }
  }

  const parts: Part[] = list.map((hash) => ({ hash, ...(durations.has(hash) ? { durationMs: durations.get(hash)! } : {}) }));
  const problem = rec.failureCount > 0
    ? <SaveProblem message={rec.error || t('translate.partNotSaved')} retryLabel={t('translate.retrySaving')} busy={rec.busy} onRetry={() => void rec.retryFailed()} />
    : composeError ? <SaveProblem message={composeError} onRetry={() => setComposeError('')} />
    : rec.error ? <SaveProblem message={rec.error} /> : null;
  const record = () => void loop.toggle();
  const scope = { unitId, languageId };

  if (confirming) {
    return (
      <PublishScreen ctx={ctx} v={v} n={nextN} first={isFirst} cards={list} totalMs={totalMs(parts.map((x) => x.durationMs))}
        bible={bible.option?.abbreviation} busy={publishing} answers={answers} tied={canTie ? tied.size : 0}
        {...(revising ? { revisingKind: v.kind(revising.kindId).name } : {})}
        onClose={() => setConfirming(false)} onPublish={(note, hash) => void publish(note, hash)} />
    );
  }

  const recorderLine = split >= 1;
  return (
    <Screen fixed
      header={<Header title={v.title} sub={t('translate.recordingVersion', { n: nextN })} crumbs={passageCrumbs(ctx, v, screenTitle('workspace'))} onBack={ctx.back} close />}
      footer={recorderLine ? undefined : (
        <RecorderFooter count={list.length} phase={loop.phase} recordDisabled={saving || rec.failureCount > 0}
          publishDisabled={!changed || blocked || rec.failureCount > 0} onRecord={record} onPublish={() => setConfirming(true)} />
      )}>
      <SplitPane memoryKey="workspace" minBottom={MIN_BOTTOM} onFraction={setSplit}
        topStyle={styles.refPane} bottomStyle={styles.wsRecordPane}
        top={({ compact, open }) => compact ? (
          bible.hasVerses ? <BibleBar bible={bible} onOpen={open} /> : (
            <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={t('translate.openReference')} style={({ pressed }) => [styles.bar, pressed && { opacity: 0.7 }]}>
              <Ico name="book" size={18} color={C.primary} />
              <Text style={[txt.sm, { flex: 1, fontWeight: '700' }]} numberOfLines={1}>{t('translate.dragDown')}</Text>
            </Pressable>
          )
        ) : (
          <View style={{ flex: 1 }}>
            <RefChips items={chips} value={chip} onChange={openChip} />
            {chip === 'guide' && study ? <GuideNav ctx={ctx} sp={study} index={step} onIndex={setStep} /> : null}
            <ScrollView contentContainerStyle={styles.paneBody} keyboardShouldPersistTaps="handled">
              {chip === 'bible' ? (
                <BiblePane ctx={ctx} v={v} bible={bible} terms={unitTerms} tied={tied} canNote={!recording} selected={verse} onSelect={setVerse}
                  footer={<ReferenceRecordings ctx={ctx} unitId={unitId} disabled={false} listen={loop.hooks} onPlay={usage.open} />}
                  {...(recording ? {} : {
                    onTerm: (termId: string) => ctx.go('key_term_detail', { ...scope, termId }),
                    onMoreBibles: () => ctx.go('bible_explore', scope)
                  })} />
              ) : chip === 'guide' && study && guide ? (
                <>
                  <GuideStep key={study.steps[step]!.step.id} ctx={ctx} v={v} guide={guide} status={study.steps[step]!} spoken={false}
                    canContribute={!recording} onTerm={(termId) => ctx.go('key_term_detail', { ...scope, termId })} />
                  <LinkBtn label={t('translate.openStudy')} style={{ alignSelf: 'center' }} onPress={() => ctx.go('study_step', { ...scope, stepId: study.steps[step]!.step.id })} />
                </>
              ) : chip === 'terms' ? (
                <KeyWordsPane ctx={ctx} v={v} terms={trayTerms} rows={bible.rows} draftTakeId={p.draftTakeId} canTie={canTie} disabled={blocked}
                  onHear={(key) => { setChip('bible'); if (key) { setVerse(key); bible.playVerse(key); } }}
                  allTerms={() => ctx.go('key_terms', scope)} />
              ) : chip === 'notes' ? (
                <NotesPane ctx={ctx} v={v} notes={notes} disabled={blocked} top={request ? <RequestNote ctx={ctx} request={request} /> : undefined} />
              ) : (
                <EarlierPane ctx={ctx} v={v} {...(revising ? { focusReviewId: revising.id } : {})} />
              )}
            </ScrollView>
          </View>
        )}
        bottom={({ compact, open, height }) => compact ? (
          <RecorderBar count={list.length} phase={loop.phase} disabled={saving || rec.failureCount > 0} onRecord={record} onOpen={open} />
        ) : (
          <ScrollView contentContainerStyle={styles.recordBody} accessibilityLabel={t('translate.yourRecording')}>
            {problem}
            <RecorderPane ctx={ctx} parts={parts} phase={loop.phase} capturing={rec.vadCapturing} small={height < 360} disabled={blocked}
              onDelete={(h, label) => void remove(h, label)} onResume={loop.resumeNow} />
            {list.length === 0 && !session ? (
              <Text style={[txt.smMuted, { textAlign: 'center' }]}>{t('translate.tapRed')}</Text>
            ) : null}
            {!isFirst && !changed && list.length > 0 ? (
              <Text style={[txt.xs, { textAlign: 'center' }]}>{t('translate.latestParts', { n: latest.n })}</Text>
            ) : null}
            {clipped ? (
              <View style={styles.clipped}>
                <Text style={[txt.sm, { color: TINT.amberText, fontWeight: '700' }]}>{t('translate.clipped')}</Text>
                <SmallBtn label={t('translate.micSetup')} icon="sliders" onPress={() => ctx.go('mic_setup')} />
              </View>
            ) : !session ? (
              <QuietLink label={t('translate.micSetup')} icon="sliders" hint={t('translate.micSetupHint')} onPress={() => ctx.go('mic_setup')} />
            ) : null}
          </ScrollView>
        )} />
    </Screen>
  );
}

// ---- Back translation --------------------------------------------------------------

export function BackTranslation(ctx: Ctx) {
  const v = usePassage(ctx);
  const kindId = ctx.params['kindId'] ?? '';
  if (!v) return <Missing ctx={ctx} title={screenTitle('back_translation')} />;
  const kind = v.kind(kindId);
  if (!v.p.latest || !kind.produces) return <Missing ctx={ctx} title={screenTitle('back_translation')} text={t('backTranslation.noRecording')} />;
  // The same split workspace, with only the version being back-translated on top (simple/btWorkspace.tsx).
  return <BackTranslationBody key={`${v.unitId}:${v.languageId}:${kindId}`} ctx={ctx} v={v} kind={kind} of={v.p.latest} />;
}

const styles = StyleSheet.create({
  bar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, minHeight: 48, backgroundColor: C.card },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  // The workspace (demo ADR-036): the reference on the screen's ground, the recorder on white.
  refPane: { backgroundColor: C.bg },
  wsRecordPane: { backgroundColor: C.card },
  recordBody: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.lg, gap: space.md },
  clipped: { backgroundColor: TINT.amber, borderRadius: radius.lg, padding: space.md, gap: space.sm },
  // Back translation (LAN-23): each half its own ground, so the two read as
  // different places: the version cool (the brand's pale tint), your parts
  // warm (the red tint). Cards on both stay white, so text keeps its contrast.
  sourcePane: { backgroundColor: C.light },
  recordPane: { backgroundColor: withAlpha(C.red, 0.08) },
  paneBody: { paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.lg, gap: space.md }
});

export const contracts = contractsFor('workspace', 'back_translation');
