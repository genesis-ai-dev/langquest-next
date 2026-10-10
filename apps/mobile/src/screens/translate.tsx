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
// next part lit; when the passage has verses they are grouped into cards by
// verse, with a space beside each part to tap a verse in (decisions.md 81); the big red button and Publish are in the footer, or in
// the recorder's one line. Publish is its own screen inside this one, so
// nothing recorded or offered is lost on the way. The sensitivity and the
// pause between parts are set in microphone setup (`mic_setup`).
//
// Every change persists: each part is kept as the draft on the record, so
// nothing is lost if you leave, and Save says so. A person may keep several
// drafts of a passage (decisions.md 82): the workspace opens one of them, a
// new one from a version's parts, or a new empty one, and publishes that one. Back translation: the same tools, but you
// listen to the latest version and what you save is content for the next
// check, not a version.
import {
  commands, derivePassage, draftsBy, keyTermsForUnit, latestDraftBy, partMarksFor, versesInChapter,
  type EventSpec, type KindDef, type LanguageState, type PartMark, type PassageNote, type Version
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Ctx } from '../ctx';
import { TITLES } from '../flow';
import { indexesFor } from '../indexes';
import {
  Banner, Card, Chip, ChipRow, EmptyState, Field, Header, Ico, LinkBtn, PrimaryBtn, Screen, SectionLabel, Sheet, SmallBtn, txt
} from '../kit';
import { ReferenceRecordings, SourcePlayer } from '../passageSourceAudio';
import { feedbackSource, passageCrumbs, usePassage, versionTitle, type PassageView } from '../passageView';
import { useBackTranslationDraft } from '../recording/backTranslationDraft';
import { CardList, problemText, RecordButton, SaveProblem, type ListedCard } from '../recording/parts';
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
import { RequestBanner } from '../reviewing/parts';
import { contractsFor } from '../screenContracts';
import { BackTranslationBody } from '../simple/btWorkspace';
import { SourceReader } from '../sources/SourceReader';
import { GuideNav, GuideStep } from '../simple/guide';
import { partLabel, partsLookClipped, refChips, totalMs, type RefChip } from '../simple/model';
import { passageVerseKeys } from '../simple/verseModel';
import { draftName, draftOf, startedFrom } from '../passage/versionsModel';
import { catalogVerses } from '../sources/model';
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
  if (!v) return <Missing ctx={ctx} title={TITLES.workspace} />;
  // Each draft opened is its own workspace (decisions.md 82).
  const which = ['draftId', 'from', 'fresh'].map((k) => ctx.params[k] ?? '').join(':');
  return <WorkspaceBody key={`${v.unitId}:${v.languageId}:${which}`} ctx={ctx} v={v} />;
}

function Missing(props: { ctx: Ctx; title: string; text?: string }) {
  return (
    <Screen header={<Header title={props.title} onBack={props.ctx.back} close />}>
      <EmptyState icon="mic" title={props.text ?? "This passage isn't on this device yet."} sub={props.text ? undefined : 'It may still be loading.'} />
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

  // ---- which draft (decisions.md 82) ----
  // A person may keep several drafts. `draftId` opens one (by the take it
  // started with); `from` starts a new one from a version's parts and
  // `fresh` an empty one; with none of them, their latest draft, else a new
  // one from the latest version. `root` names the draft once it is saved;
  // `tip` is its newest take seen here, which the next change continues.
  const fromParam = ctx.params['from'];
  const fresh = ctx.params['fresh'] === '1';
  const mine = useMemo(() => draftsBy(p, me), [p, me]);
  const [root, setRoot] = useState<string | null>(() => {
    const id = ctx.params['draftId'];
    if (id) return mine.find((d) => d.takeId === id || d.rootTakeId === id)?.rootTakeId ?? null;
    if (fromParam || fresh) return null;
    return latestDraftBy(p, me)?.rootTakeId ?? null;
  });
  const rootRef = useRef(root);
  rootRef.current = root;
  const draft = draftOf(mine, root);
  const tipRef = useRef<string | null>(null);
  if (draft) tipRef.current = draft.takeId;
  // What the draft started from: a version's parts, or nothing.
  const startFrom = draft || tipRef.current ? (draft?.basedOnTakeId ?? (root ? state.takes[root]?.parentTakeId ?? undefined : undefined))
    : fromParam && state.submissions[fromParam] ? fromParam : fresh ? undefined : latest?.takeId;
  const startCards = startFrom ? state.takes[startFrom]?.cardHashes : undefined;
  /** What the next change continues: this draft's newest take, else what it starts from. */
  const parentNow = () => (tipRef.current && stateRef.current.takes[tipRef.current] ? tipRef.current : startFrom ?? null);
  /** This draft in a later state (an Undo runs after the record moved on). */
  const draftIn = (s: LanguageState) => draftOf(draftsBy(derivePassage(s, unitId), me), rootRef.current);
  const name = draftName(mine, root);
  /** A draft saved for the first time is named by its first take from then on. */
  const adopt = (specs: readonly EventSpec[]) => {
    if (tipRef.current) return;
    const take = (x: EventSpec) => (x.payload as { takeId: string }).takeId;
    const archived = new Set(specs.filter((x) => x.type === 'v1.TakeArchived').map(take));
    const composed = specs.find((x) => x.type === 'v1.TakeComposed' && !archived.has(take(x)));
    if (!composed) return;
    rootRef.current = tipRef.current = take(composed);
    setRoot(rootRef.current);
  };

  // ---- the list of takes (REC-W2) ----
  const pendingCards = useMemo(() => pendingPassageCards(state, unitId, me), [state, unitId, me]);
  const pending = useMemo(() => pendingCards.map((c) => c.hash), [pendingCards]);
  const durations = useMemo(() => cardDurations(state, unitId), [state, unitId]);
  const draftCards = draft?.cardHashes;
  const [cleared, setCleared] = useState(false);
  // Recording into a gap left for later (decisions.md 81): new parts go before this part.
  const [insertBefore, setInsertBefore] = useState<string | null>(null);
  const list = useMemo(() => {
    const base = workingCards({
      ...(draftCards ? { draftCards } : {}), ...(startCards ? { latestCards: startCards } : {}), pending, cleared
    });
    if (!insertBefore || !base.includes(insertBefore)) return base;
    const fresh = new Set(pending.filter((h) => !draftCards?.includes(h)));
    const rest = base.filter((h) => !fresh.has(h));
    const at = rest.indexOf(insertBefore);
    return [...rest.slice(0, at), ...base.filter((h) => fresh.has(h)), ...rest.slice(at)];
  }, [draftCards, startCards, pending, cleared, insertBefore]);
  const changed = canPublish(list, latest?.cardHashes);
  const [split, setSplit] = useState(() => rememberedSplit('workspace'));
  // Publish from the Versions page opens the publish screen at once.
  const publishParam = ctx.params['publish'] === '1';
  const [confirming, setConfirming] = useState(publishParam);
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
    if (!s) throw new Error('Your organization is still loading.');
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
    const commandId = Crypto.randomUUID();
    try {
      specs = commands(state, idx).keepTake({ commandId, unitId, cardHashes: list, actorId: me, parentTakeId: parentNow() });
      // A part recorded into a gap takes the next verse, so it fills the gap.
      if (insertBefore && verseKeysRef.current.length > 0) {
        const fresh = new Set(pending);
        const marks = partMarksFor(state, unitId, list, verseKeysRef.current).map((m, i) => (fresh.has(list[i]!) && !m ? { t: 'next' as const } : m));
        specs = [...specs, ...commands(state, idx).setCardVerses({ commandId: Crypto.randomUUID(), unitId, cards: list, marks, verses: verseKeysRef.current })];
      }
    } catch (e) {
      composeLock.current = false;
      setComposing(false);
      setComposeError(problemText('workspace: compose draft', e));
      return;
    }
    adopt(specs);
    ctx.language.run(specs)
      .catch((e: unknown) => setComposeError(`Your takes are saved on this device but not yet in your draft. ${problemText('workspace: save draft', e)}`))
      .finally(() => { composeLock.current = false; setComposing(false); });
    // `composing` is a dependency so a card that landed mid-compose is composed next.
  }, [state, pending, list, composing, composeError, ctx.language, idx, unitId, me, insertBefore]);
  // The verses of the passage, set once the Bible's range is known (below); read by the compose effect.
  const verseKeysRef = useRef<string[]>([]);
  // A gap is filled for one recording session.
  useEffect(() => { if (!recording && !rec.busy) setInsertBefore(null); }, [recording, rec.busy]);

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
      commandId: Crypto.randomUUID(), unitId, actorId: me, list, hash, pending: new Set(pending), parentTakeId: parentNow(),
      ...(draft ? { draftTakeId: draft.takeId } : {}), ...(startCards ? { latestCards: startCards } : {})
    });
    const wasCleared = cleared;
    adopt(specs);
    setWorking(true);
    // Set first so the list does not flash back to the latest version's takes.
    setCleared(nowCleared);
    try {
      await ctx.act(specs, `${label} deleted.`, () => {
        setCleared(false);
        if (startCards && sameCards(before, startCards)) return [];
        const s = stateRef.current;
        return commands(s, indexesFor(s)).keepTake({ commandId: Crypto.randomUUID(), unitId, cardHashes: before, actorId: me,
          parentTakeId: draftIn(s)?.takeId ?? parentNow() });
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
  // ---- verse labels on the parts (decisions.md 81) ----
  const v11n = bible.passage.versification;
  const verseKeys = useMemo(() => passageVerseKeys(bible.passage.range,
    (b, c) => (v11n ? versesInChapter(v11n, b, c) : undefined) ?? catalogVerses(b, c)), [bible.passage.range, v11n]);
  verseKeysRef.current = verseKeys;
  const storedMarks = useMemo(() => partMarksFor(state, unitId, list, verseKeys), [state, unitId, list, verseKeys]);
  // What was just tapped shows at once; the record catches up a moment later.
  const [shownMarks, setShownMarks] = useState<{ list: string[]; marks: PartMark[] } | null>(null);
  useEffect(() => { setShownMarks(null); }, [state]);
  const marks = shownMarks && sameCards(shownMarks.list, list) ? shownMarks.marks : storedMarks;
  const setMarks = (next: PartMark[], message: string) => {
    const before = marks;
    const cards = list;
    let specs: EventSpec[];
    try {
      specs = commands(state, idx).setCardVerses({ commandId: Crypto.randomUUID(), unitId, cards, marks: next, verses: verseKeys });
    } catch (e) {
      ctx.toast(`Not saved: ${problemText('workspace: verse labels', e)}`);
      return;
    }
    if (specs.length === 0) return;
    setShownMarks({ list: cards, marks: next });
    ctx.act(specs, message, () => commands(stateRef.current, indexesFor(stateRef.current)).setCardVerses({ commandId: Crypto.randomUUID(), unitId, cards, marks: before, verses: verseKeys }))
      .catch(() => setShownMarks(null));
  };
  const recordHere = (beforeIndex: number) => {
    const hash = list[beforeIndex];
    if (!hash || blocked) return;
    setInsertBefore(hash);
    void loop.toggle();
  };
  const unitTerms = useMemo(() => keyTermsForUnit(state, unitId), [state, unitId]);
  const tied = useMemo(() => tiedTermIds(state, draft?.takeId ?? startFrom), [state, draft?.takeId, startFrom]);
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
    bible: { id: 'bible' as const, label: 'Bible', icon: 'listen' as const, hint: 'Hear and read the passage.' },
    guide: { id: 'guide' as const, label: 'Guide', icon: 'star' as const, hint: "The study guide's steps for this passage." },
    terms: { id: 'terms' as const, label: 'Key words', icon: 'key' as const, hint: 'Words to say the same way every time: hear each, and say yours.' },
    notes: { id: 'notes' as const, label: 'Notes', icon: 'chat' as const, count: notes.length, hint: "The team's notes on this passage." },
    earlier: { id: 'earlier' as const, label: 'Earlier', icon: 'clock' as const, hint: 'Everything recorded for this passage so far: versions, feedback and notes.' }
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
        commandId, unitId, cardHashes: list, actorId: me, parentTakeId: draft?.takeId ?? parentNow(),
        ...(note.trim() ? { note: note.trim() } : {}), ...(noteBlobHash ? { noteBlobHash } : {})
      });
      if (canTie) specs = [...specs, ...tieTermsSpecs(state, specs, tied, commandId)];
      const takeId = specs.find((x) => x.type === 'v1.TakeSubmitted')?.payload as { takeId: string } | undefined;
      if (takeId) specs = [...specs, ...commands(state, idx).referencesUsed({ commandId, unitId, takeId: takeId.takeId, items: usage.items() })];
    } catch (e) {
      ctx.toast(`Not published: ${problemText('workspace: publish', e)}`);
      return;
    }
    setPublishing(true);
    try {
      await ctx.act(specs, `${versionTitle(nextN)} published.`);
      setConfirming(false);
      // Publish, then ask (demo ADR-034): the record opens with the likely check ready to send.
      ctx.go('passage_record', { unitId, languageId, published: `${nextN}:${Date.now()}` });
    } catch { /* ctx.act said what went wrong */ }
    finally { setPublishing(false); }
  }

  const parts: Part[] = list.map((hash) => ({ hash, ...(durations.has(hash) ? { durationMs: durations.get(hash)! } : {}) }));
  const problem = rec.failureCount > 0
    ? <SaveProblem message={rec.error || 'A part did not save.'} retryLabel="Retry saving" busy={rec.busy} onRetry={() => void rec.retryFailed()} />
    : composeError ? <SaveProblem message={composeError} onRetry={() => setComposeError('')} />
    : rec.error ? <SaveProblem message={rec.error} /> : null;
  const record = () => void loop.toggle();
  const scope = { unitId, languageId };

  if (confirming) {
    return (
      <PublishScreen ctx={ctx} v={v} n={nextN} first={isFirst} cards={list} totalMs={totalMs(parts.map((x) => x.durationMs))}
        bible={bible.option?.abbreviation} busy={publishing} answers={answers} tied={canTie ? tied.size : 0}
        {...(revising ? { revisingKind: v.kind(revising.kindId).name } : {})}
        onClose={() => (publishParam ? ctx.back() : setConfirming(false))} onPublish={(note, hash) => void publish(note, hash)} />
    );
  }

  // Which draft this is, when the person keeps more than one, and the version it started from when not the latest.
  const fromN = startedFrom(p.versions, startFrom);
  const several = mine.length + (draft ? 0 : 1) > 1;
  const recordingSub = [several ? name : `Recording ${versionTitle(nextN)}`, fromN && fromN !== latest?.n ? `from ${versionTitle(fromN)}` : null]
    .filter(Boolean).join(' · ');
  // Every change is kept as it happens; Save says so and goes back.
  const save = () => {
    if (draft || list.length > 0 && !(startCards && sameCards(list, startCards))) ctx.toast(`${several ? name : 'Draft'} saved.`);
    ctx.back();
  };
  const recorderLine = split >= 1;
  return (
    <Screen fixed
      header={<Header title={v.title} sub={recordingSub} crumbs={passageCrumbs(ctx, v, TITLES.workspace)} onBack={ctx.back} close
        action={<SmallBtn label="Save" icon="check" disabled={blocked} onPress={save} />} />}
      footer={recorderLine ? undefined : (
        <RecorderFooter count={list.length} phase={loop.phase} recordDisabled={saving || rec.failureCount > 0}
          publishDisabled={!changed || blocked || rec.failureCount > 0} onRecord={record} onPublish={() => setConfirming(true)} />
      )}>
      <SplitPane memoryKey="workspace" minBottom={MIN_BOTTOM} onFraction={setSplit}
        topStyle={styles.refPane} bottomStyle={styles.wsRecordPane}
        top={({ compact, open }) => compact ? (
          bible.hasVerses ? <BibleBar bible={bible} onOpen={open} /> : (
            <Pressable onPress={open} accessibilityRole="button" accessibilityLabel="Open the reference" style={({ pressed }) => [styles.bar, pressed && { opacity: 0.7 }]}>
              <Ico name="book" size={18} color={C.primary} />
              <Text style={[txt.sm, { flex: 1, fontWeight: '700' }]} numberOfLines={1}>Drag down for the guide, key words, notes and earlier recordings</Text>
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
                  <LinkBtn label="Open the study" style={{ alignSelf: 'center' }} onPress={() => ctx.go('study_step', { ...scope, stepId: study.steps[step]!.step.id })} />
                </>
              ) : chip === 'terms' ? (
                <KeyWordsPane ctx={ctx} v={v} terms={trayTerms} rows={bible.rows} draftTakeId={draft?.takeId} canTie={canTie} disabled={blocked}
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
          <ScrollView contentContainerStyle={styles.recordBody} accessibilityLabel="Your recording">
            {problem}
            <RecorderPane ctx={ctx} parts={parts} phase={loop.phase} capturing={rec.vadCapturing} small={height < 360} disabled={blocked}
              onDelete={(h, label) => void remove(h, label)} onResume={loop.resumeNow}
              verses={{ keys: verseKeys, marks, onMarks: setMarks, onRecordHere: recordHere }} />
            {list.length === 0 && !session ? (
              <Text style={[txt.smMuted, { textAlign: 'center' }]}>Tap the red button and speak. Pause between parts: each part is kept by itself.</Text>
            ) : null}
            {!isFirst && !changed && list.length > 0 ? (
              <Text style={[txt.xs, { textAlign: 'center' }]}>These are {versionTitle(latest.n)}'s parts. Record a new part or delete one to publish a new version.</Text>
            ) : null}
            {clipped ? (
              <View style={styles.clipped}>
                <Text style={[txt.sm, { color: TINT.amberText, fontWeight: '700' }]}>Parts are coming out very short. Words may be cut off.</Text>
                <SmallBtn label="Set up the microphone" icon="sliders" onPress={() => ctx.go('mic_setup')} />
              </View>
            ) : !session ? (
              <QuietLink label="Set up the microphone" icon="sliders" hint="Tune how the device hears you: sensitivity and pauses." onPress={() => ctx.go('mic_setup')} />
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
  if (!v) return <Missing ctx={ctx} title={TITLES.back_translation} />;
  const kind = v.kind(kindId);
  if (!v.p.latest || !kind.produces) return <Missing ctx={ctx} title={TITLES.back_translation} text="There's no recording to back-translate yet." />;
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
