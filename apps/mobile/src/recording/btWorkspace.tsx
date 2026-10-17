// Back translation in the recording workspace (demo SIMPLE-11, ADR-036;
// the agreed "bt" screen): the same split as recording, with only the
// version being back-translated on top, cut into the parts it was recorded
// in. The top is the big player of the part being worked on (Back 10 s, a
// timeline to drag back and forth, Note at a moment); the bottom a card per
// part, said ones green, the next one lit. The footer is Undo and Redo,
// the big red record button and Done. Playing pauses the microphone and
// recording picks up again when it stops (listen, speak, listen, LAN-23).
// Undo and Redo work as on the recording screen: a session of recording, or
// clearing a part, is one step, and the parts that changed are shaded; no
// toast offers an Undo that runs out (Caleb, 2026-10-16).
//
// The parts are kept on this device until Done (decision 30): each
// recorded piece goes to a local draft with the moment in the version its
// part starts (`atMs`), and so do the notes at moments (decision 127). Done
// (it was Publish) puts them in one core produceContent, in part order, and
// in the same tap asks whoever usually does the check that comes next.
import {
  checkPeople, checkShows, commands, DEFAULT_KINDS, keyTermsForUnit, RECORD_STEP, type EventSpec, type KindDef, type KindStatus, type PassageNote, type Version
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { AudioClip } from '../audio/audioClip';
import { ClipPlayer } from '../audio/clipPlayer';
import { usePartVerses } from '../passage/useVerses';
import { localKind } from '../i18n/coreText';
import type { Ctx } from '../shell/ctx';
import { screenTitle } from '../shell/flow';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge, HelpClip, HelpRow } from '../helpMode/helpBadge';
import { currentLocale, t } from '../i18n';
import { formatClock, formatNumber } from '../i18n/format';
import { indexesFor } from '../sync/indexes';
import { Banner, Field, Header, Ico, IconBtn, PrimaryBtn, QuietLinks, Screen, SectionLabel, Sheet, type IconName } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { useLayout } from '../ui/useLayout';
import { passageCrumbs, type PassageView } from '../passage/passageView';
import { useBackTranslationDraft } from './useBackTranslationDraft';
import { checkName } from '../admin/adminModel';
import { backParts, EMPTY_BACK_NOTES, isBackNotesDraft, nextPart, noteText, partAfter, pieceFor, piecesInOrder, saidLine, sourceParts, type BackPart, type MomentNote } from './backTranslationParts';
import { useDraft } from '../drafts/useDraft';
import { draftKey } from '../drafts/draftModel';
import { SavedMark } from '../ui/SavedMark';
import { useSaveStatus } from '../ui/useSaveStatus';
import { nextAfterDone, recordCan, sentText, usualTargets, askButtonLabel } from '../passage/recordModel';
import { sendTargetLabel } from '../passage/record';
import { sendToInput, type UsualTarget } from '../passage/sendTarget';
import { AskCheckCard } from '../passage/askParts';
import type { DoneAsk } from './publish';
import { RecordButton, SaveProblem } from './parts';
import { SplitPane } from './SplitPane';
import { loopRecording, MIN_BOTTOM, MIN_BOTTOM_RECORDING } from './splitModel';
import { useListenLoop } from './useListenLoop';
import { RecordingView } from './RecordingView';
import {
  backTranslationDraftKey, cardDurations, parsePiecesHistory, piecesHistoryKey, unsavedParts, type PiecesSnap
} from './workspaceModel';
import { useUndoHistory } from '../drafts/useUndoHistory';
import { forgetUndoHistory } from '../drafts/undoHistory';
import { didStep, redoStep, undoStep } from '../ui/undoModel';
import { UndoRedo } from '../ui/undoRedo';
import { failureMessage, reportError } from '../diagnostics/report';
import { RequestBanner } from '../reviewing/parts';
import { lift } from '../ui/shadow';
import { C, radius, space, target, TINT, type as T, withAlpha } from '../ui/theme';
import { useRecorder, type RecordedCard } from './useRecorder';
import { spanName } from './verseModel';
import { VoiceNote } from '../audio/voiceNote';
import type { SaveStatus } from '../ui/savedModel';
import { RefChips, type ChipItem } from './blocks';
import { anyFrom, fromFilter } from '../checks/showsModel';
import { BiblePane, EarlierPane, KeyWordsPane, NotesPane } from '../helps/reference';
import { useBible } from '../helps/useBible';
import { useStudyGuide } from '../study/useStudyGuides';
import { studyProgress } from '../study/progress';
import { GuideNav, GuideStep } from '../study/guide';

export function BackTranslationBody({ ctx, v, kind, of, make }: {
  ctx: Ctx; v: PassageView; kind: KindDef; of: Version;
  /** A step that makes recording (decisions.md 139): what it says it into, and the language it is in when not the team's own. */
  make?: { into: string; language?: string; added?: boolean };
}) {
  const { state, unitId, languageId, p } = v;
  const produces = kind.produces ?? { what: kind.name, into: make?.into ?? v.language, action: kind.name, checkedBy: '' };
  const shipped = shippedBackTranslation(kind);
  const me = ctx.session.actorId;
  // One name for a check on every screen (decision 91): "The Consultant check listens to it next."
  const checkedBy = produces.checkedBy ? checkName(produces.checkedBy, v.kinds) : undefined;
  // A wide window names the passage in the crumbs above the title.
  const wide = useLayout().kind !== 'phone';
  const drafts = useBackTranslationDraft(backTranslationDraftKey({ languageId, actorId: me, unitId, kindId: kind.id }), of.takeId);
  const unsaved = useMemo(() => unsavedParts(state, drafts.draft), [state, drafts.draft]);
  const durations = useMemo(() => cardDurations(state, unitId), [state, unitId]);
  const source = useMemo(() => sourceParts(of.cardHashes, (h) => durations.get(h)), [of.cardHashes, durations]);
  // Each part's verses, when the version has them (decisions.md 82); a part without one just has its number.
  const partVerses = usePartVerses(ctx, state, unitId, of.cardHashes);
  const verseOf = (i: number) => { const l = partVerses.rows[i]?.label; return l ? spanName(partVerses.verses, l.s, l.e) : null; };
  const parts = useMemo(() => backParts(source, unsaved), [source, unsaved]);
  const madeFrom = drafts.draft && unsaved.length > 0 && drafts.draft.fromTakeId !== of.takeId
    ? p.versions.find((x) => x.takeId === drafts.draft!.fromTakeId) : undefined;
  const requestId = ctx.params['requestId'];
  const request = (requestId ? p.requests.find((r) => r.id === requestId) : undefined)
    ?? p.openRequests.find((r) => r.what === 'review' && r.kindId === kind.id && r.profileId === me);

  // What this check shows beside the version (decisions.md 130); out of the box a back translation shows nothing else.
  const shows = useMemo(() => checkShows(state, kind.id), [state, kind.id]);
  const bible = useBible(ctx, unitId, languageId, { shows: { audio: shows.bibleAudio, text: shows.bibleText } });
  const guide = useStudyGuide(ctx, unitId);
  const study = useMemo(() => (guide ? studyProgress(state, p, guide) : null), [state, p, guide]);
  const unitTerms = useMemo(() => keyTermsForUnit(state, unitId), [state, unitId]);
  const notesFrom = useMemo(() => fromFilter(state, kind.id, 'notes'), [state, kind.id]);
  const earlierFrom = useMemo(() => fromFilter(state, kind.id, 'earlier'), [state, kind.id]);
  const passageNotes = useMemo<PassageNote[]>(() => p.notes.filter((n) => n.anchor.kind !== 'study' && notesFrom(n.kindId ?? RECORD_STEP)), [p.notes, notesFrom]);
  type TopChip = 'version' | 'bible' | 'guide' | 'terms' | 'notes' | 'earlier';
  const topChips: ChipItem<TopChip>[] = [
    { id: 'version', label: t('backTranslation.chips.version', { n: of.n }), icon: 'mic' },
    ...(bible.hasVerses && (shows.bibleAudio || shows.bibleText) ? [{ id: 'bible' as const, label: t('translate.chips.bible'), icon: 'listen' as const, hint: t('translate.chips.bibleHint') }] : []),
    ...(study && (shows.guideAudio || shows.guideText) ? [{ id: 'guide' as const, label: t('translate.chips.guide'), icon: 'star' as const, hint: t('translate.chips.guideHint') }] : []),
    ...(shows.terms ? [{ id: 'terms' as const, label: t('translate.chips.terms'), icon: 'key' as const, hint: t('translate.chips.termsHint') }] : []),
    ...(anyFrom(state, kind.id, 'notes') ? [{ id: 'notes' as const, label: t('translate.chips.notes'), icon: 'chat' as const, count: passageNotes.length, hint: t('translate.chips.notesHint') }] : []),
    ...(anyFrom(state, kind.id, 'earlier') ? [{ id: 'earlier' as const, label: t('translate.chips.earlier'), icon: 'clock' as const, hint: t('translate.chips.earlierHint') }] : [])
  ];
  const [topState, setTop] = useState<TopChip>('version');
  const top = topChips.some((c) => c.id === topState) ? topState : 'version';
  const [verse, setVerse] = useState<string | null>(null);
  const [guideStep, setGuideStep] = useState<number | null>(null);
  const gStep = study ? Math.min(study.steps.length - 1, guideStep ?? study.next?.index ?? 0) : 0;

  // The part being worked on: the next one to say, until the person picks another.
  const [picked, setPicked] = useState<number | null>(null);
  const focus = Math.min(picked ?? nextPart(parts), Math.max(0, parts.length - 1));
  const part = parts[focus];
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const sourceRef = useRef(source);
  sourceRef.current = source;

  // Each piece lands in the draft already saying which part it is about.
  const add = drafts.add;
  const persist = useCallback(async (card: RecordedCard) => {
    const at = sourceRef.current[focusRef.current];
    const piece = { hash: card.ref.hash, durationMs: card.durationMs, format: card.ref.format };
    await add(at ? pieceFor(at, piece) : piece);
  }, [add]);
  const rec = useRecorder(persist, undefined, ctx.language);
  // A piece too short to keep is said (decisions.md 106).
  const loop = useListenLoop(rec);
  const session = loop.phase !== 'off';
  const recording = session || rec.manualOn;
  const [working, setWorking] = useState(false);
  const blocked = recording || rec.busy || working || !drafts.loaded || !!drafts.problem;

  // When a part has been said and recording stops, the next part to say lights up.
  const saidFor = useRef<number | null>(null);
  useEffect(() => {
    // A session keeps to the part it started on: "the next part to say" moves as soon as a piece
    // lands, and every later piece of the same session would otherwise go to the part after it.
    if (session) { saidFor.current = focusRef.current; setPicked((p) => p ?? focusRef.current); return; }
    if (saidFor.current === null || rec.busy) return;
    const was = saidFor.current;
    if (parts[was]?.cards.length) { saidFor.current = null; setPicked(partAfter(parts, was)); }
  }, [session, rec.busy, parts]);

  // ---- undo and redo (Caleb, 2026-10-16) ----
  // Kept beside the draft on this phone until Done, as the draft is.
  const historyKey = piecesHistoryKey({ languageId, actorId: me, unitId, kindId: kind.id });
  const { history, loaded: historyLoaded, set: setHistory } = useUndoHistory(historyKey, parsePiecesHistory);
  const piecesNow = (): PiecesSnap => [...(drafts.draft?.cards ?? [])];
  // The parts a recording or an undo changed are shaded until the next recording.
  const [justSaid, setJustSaid] = useState<ReadonlySet<number>>(() => new Set());
  const partsOf = (cards: readonly { hash: string }[]) => {
    const hashes = new Set(cards.map((c) => c.hash));
    return new Set(parts.filter((x) => x.cards.some((c) => hashes.has(c.hash))).map((x) => x.index));
  };
  const session0 = useRef<PiecesSnap | null>(null);
  if (recording && !session0.current) session0.current = piecesNow();
  const settled = !recording && !rec.busy;
  const nowCards = drafts.draft?.cards;
  useEffect(() => {
    const start = session0.current;
    if (!start) return;
    const was = new Set(start.map((c) => c.hash));
    const added = (nowCards ?? []).filter((c) => !was.has(c.hash));
    setJustSaid((prev) => { const next = partsOf(added); return prev.size === next.size && [...next].every((i) => prev.has(i)) ? prev : next; });
    if (!settled) return;
    session0.current = null;
    setHistory((h) => didStep(h, { before: start, after: [...(nowCards ?? [])], what: t('translate.newRecording') }));
  }, [settled, nowCards]); // eslint-disable-line react-hooks/exhaustive-deps -- partsOf and setHistory read only what this render shows

  async function clearPart(target: BackPart) {
    if (blocked || target.cards.length === 0) return;
    setWorking(true);
    const before = piecesNow();
    const gone = new Set(target.cards.map((c) => c.hash));
    try {
      for (const c of target.cards) await drafts.remove(c.hash);
      setPicked(target.index);
      const what = t('backTranslation.partDeleted', { n: target.index + 1 });
      setHistory((h) => didStep(h, { before, after: before.filter((c) => !gone.has(c.hash)), what }));
      AccessibilityInfo.announceForAccessibility(what);
    } catch (e) {
      ctx.toast(t('backTranslation.notDeleted', { reason: failureMessage('back translation: delete part', e) }));
    } finally { setWorking(false); }
  }

  async function travel(which: 'undo' | 'redo') {
    if (blocked || !historyLoaded) return;
    const step = which === 'undo' ? undoStep(history) : redoStep(history);
    if (!step) return;
    setWorking(true);
    try {
      await drafts.replace(step.to);
      setHistory(step.history);
      const was = new Set(step.from.map((c) => c.hash));
      setJustSaid(partsOf(step.to.filter((c) => !was.has(c.hash))));
      AccessibilityInfo.announceForAccessibility(step.what ? t(which === 'undo' ? 'common.undoneWhat' : 'common.redoneWhat', { what: step.what })
        : which === 'undo' ? t('common.undone') : t('translate.redone'));
    } catch (e) {
      ctx.toast(t(which === 'undo' ? 'common.notUndone' : 'common.notSaved', { reason: failureMessage(`back translation: ${which}`, e) }));
    } finally { setWorking(false); }
  }
  const lastDone = history.done[history.done.length - 1];
  const lastUndone = history.undone[history.undone.length - 1];

  // ---- notes at moments, and Done ----
  // Kept as they are said or typed, only for whoever is making it, until it is done (decision 127).
  const said = useDraft(draftKey('bt', me, languageId, unitId, kind.id), EMPTY_BACK_NOTES, isBackNotesDraft);
  const { notes, noteHash, voiceInMoment } = said.value;
  const setNoteHash = (h: string | null) => said.set((d) => ({ ...d, noteHash: h }));
  const [noteAt, setNoteAt] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const pieces = piecesInOrder(parts);
  // The check that comes next once this one is recorded, and who usually does it (decision 127).
  const askCan = recordCan(ctx.session).ask;
  const orgState = ctx.org.state;
  const nextUp = useMemo(() => (askCan ? nextAfterDone(p, { recordedKindId: kind.id }) : undefined), [p, askCan, kind.id]);
  const targets = useMemo(() => (nextUp ? usualTargets(state, orgState, { p, languageId, me, asker: true }) : {}), [nextUp, state, orgState, p, languageId, me]);
  async function publish(extra: string, ask: DoneAsk) {
    const note = noteText(notes, extra);
    const sendTo = ask && 'kindId' in ask ? targets[ask.kindId] : undefined;
    let message = shipped ? t('backTranslation.published') : t('backTranslation.whatPublished', { what: capitalize(produces.what) });
    let specs: EventSpec[];
    try {
      const c = commands(state, indexesFor(state));
      specs = make
        // What a making step said stays with the version it came from (v1.Made); its notes go on the passage.
        ? [
          ...c.make({
            commandId: Crypto.randomUUID(), unitId, kindId: kind.id, fromTakeId: of.takeId, parts: pieces,
            ...(make.language ? { language: make.language } : {}), ...(make.added ? { added: true } : {}), ...(request ? { requestId: request.id } : {})
          }),
          ...(note || noteHash ? c.addNote({ commandId: Crypto.randomUUID(), unitId, anchor: { kind: 'version', takeId: of.takeId },
            ...(note ? { text: note } : {}), ...(noteHash ? { blobHash: noteHash } : {}) }) : [])
        ]
        : c.produceContent({
          commandId: Crypto.randomUUID(), fromTakeId: of.takeId, kindId: kind.id, cards: pieces,
          ...(note ? { note } : {}), ...(noteHash ? { noteBlobHash: noteHash } : {}), ...(request ? { requestId: request.id } : {})
        });
      if (ask && 'kindId' in ask && sendTo) {
        const asked = c.ask(sendToInput({ commandId: Crypto.randomUUID(), unitId, kindId: ask.kindId, target: sendTo }));
        specs = [...specs, ...asked];
        message = sentText(sendTo, sendTargetLabel(sendTo, ctx.name));
      }
    } catch (e) {
      ctx.toast(t('backTranslation.notPublished', { reason: failureMessage('back translation: save', e) }));
      return;
    }
    setSaving(true);
    try {
      // Taken back from the record's History (Undo on it, Withdraw on the asking), not a toast (decisions 111, 134).
      await ctx.act(specs, message);
    } catch {
      setSaving(false); // ctx.act said what went wrong
      return;
    }
    // On the record now; a draft left behind is harmless (saved parts are never offered again).
    await drafts.clear().catch((e: unknown) => { reportError('back translation: clear draft', e); });
    // Its undo history ends with the draft.
    forgetUndoHistory(historyKey);
    await said.clear();
    setSaving(false);
    setConfirming(false);
    // Back to the record, where who was asked shows; Someone else opens there with the check chosen.
    const someone = ask && 'someoneElse' in ask ? ask.someoneElse : ask && 'kindId' in ask && !sendTo ? ask.kindId : undefined;
    ctx.go('passage_record', { unitId, languageId, ...(someone ? { askSomeone: someone } : { asked: `bt:${Date.now()}` }) });
  }
  const savedStatus = useSaveStatus(rec.busy || said.status === 'saving', pieces.length > 0 || notes.length > 0, rec.failureCount > 0 || !!drafts.problem || said.status === 'failed');

  const problem = drafts.problem ? <SaveProblem message={drafts.problem} />
    : rec.failureCount > 0 ? <SaveProblem message={rec.error || t('backTranslation.partNotSaved')} retryLabel={t('backTranslation.retrySaving')} busy={rec.busy} onRetry={() => void rec.retryFailed()} />
    : rec.error ? <SaveProblem message={rec.error} /> : null;
  const mine = of.by === me;
  const who = ctx.name(of.by).split(' ')[0] ?? ctx.name(of.by);
  const partN = part ? part.index + 1 : null;
  const partVerse = part ? verseOf(part.index) : null;
  const partLabel = partN ? [t('backTranslation.part', { n: partN }), partVerse].filter(Boolean).join(' · ') : '';
  const playerTitle = partN ? [t('backTranslation.barTitle', { language: v.language, n: of.n, part: partN }), partVerse].filter(Boolean).join(' · ') : t('backTranslation.barTitleNoPart', { language: v.language, n: of.n });

  return (
    <Screen fixed
      header={wide
        ? <Header title={shipped ? t('backTranslation.title') : capitalize(produces.what)} sub={t('backTranslation.fromInto', { from: v.language, into: produces.into })}
          crumbs={passageCrumbs(ctx, v, screenTitle('back_translation'))} onBack={ctx.back} close action={<SavedMark status={savedStatus} help={t('saved.draftHelp')} />} />
        : <Header title={v.title} sub={shipped ? t('backTranslation.subInto', { into: produces.into }) : t('backTranslation.whatInto', { what: capitalize(produces.what), into: produces.into })}
          onBack={ctx.back} close action={<SavedMark status={savedStatus} help={t('saved.draftHelp')} />} />}
      footer={loopRecording(loop.phase) ? (
        <View style={styles.footer}>
          <Text style={[txt.sm, styles.footLabel, { color: TINT.redText }]} numberOfLines={2}>{partLabel}…</Text>
          <RecordButton recording onPress={() => void loop.toggle()} />
          <View style={styles.footSide} />
        </View>
      ) : (
        <View style={styles.footer}>
          <View style={[styles.footSide, { alignItems: 'flex-end' }]}>
            <UndoRedo hidden={session} canUndo={!!lastDone && !blocked && historyLoaded} canRedo={!!lastUndone && !blocked && historyLoaded}
              {...(lastDone?.what ? { undoWhat: lastDone.what } : {})} {...(lastUndone?.what ? { redoWhat: lastUndone.what } : {})}
              onUndo={() => void travel('undo')} onRedo={() => void travel('redo')}
              help={{ undo: t('recording.recorder.undoHelp'), redo: t('common.redoHelp') }} />
          </View>
          <BigRecord disabled={blocked || rec.failureCount > 0 || !part} part={partN} onPress={() => void loop.toggle()} />
          <View style={styles.footSide}>
            {/* A session open but stopped (decision 129) has the recording view's Done. */}
            {session ? null : <PublishBtn disabled={pieces.length === 0 || blocked || rec.failureCount > 0} onPress={() => setConfirming(true)} />}
          </View>
        </View>
      )}>
      <SplitPane memoryKey="back_translation" minBottom={session ? MIN_BOTTOM_RECORDING : MIN_BOTTOM}
        topStyle={styles.topPane} bottomStyle={styles.bottomPane}
        top={({ compact, open }) => compact ? (
          <PaneBar icon="listen" oneLine onPress={open} text={playerTitle} help={t('backTranslation.openVersionHelp')}
            label={partN ? t('backTranslation.openPart', { language: v.language, n: of.n, part: partN }) : t('backTranslation.openVersion', { language: v.language, n: of.n })} />
        ) : (
          <View style={{ flex: 1 }}>
            <RefChips items={topChips} value={top} onChange={setTop} />
            {top === 'guide' && study ? <GuideNav ctx={ctx} sp={study} index={gStep} onIndex={setGuideStep} /> : null}
            <HelpClip style={{ flex: 1 }}>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.paneBody}
                accessibilityLabel={partN ? t('backTranslation.listenToPart', { n: of.n, part: partN }) : t('backTranslation.listenTo', { n: of.n })}>
                {top === 'bible' ? (
                  <BiblePane ctx={ctx} v={v} bible={bible} terms={unitTerms} canNote={!recording} selected={verse} onSelect={setVerse} hear={shows.bibleAudio} read={shows.bibleText} />
                ) : top === 'guide' && study && guide ? (
                  <GuideStep key={study.steps[gStep]!.step.id} ctx={ctx} v={v} guide={guide} status={study.steps[gStep]!} spoken={shows.guideAudio} read={shows.guideText} canContribute={!recording} />
                ) : top === 'terms' ? (
                  <KeyWordsPane ctx={ctx} v={v} terms={unitTerms} rows={bible.rows} bibleName={bible.option?.abbreviation ?? ''} draftTakeId={undefined} canTie={false} disabled={blocked}
                    onHear={(key) => { setTop('bible'); if (key) { setVerse(key); bible.playVerse(key); } }} />
                ) : top === 'notes' ? (
                  <NotesPane ctx={ctx} v={v} notes={passageNotes} disabled={blocked} />
                ) : top === 'earlier' ? (
                  <EarlierPane ctx={ctx} v={v} from={earlierFrom} />
                ) : (
                  <>
                    {request && (request.note || request.noteBlobHash) ? <RequestBanner ctx={ctx} request={request} /> : null}
                    {madeFrom ? (
                      <Banner icon="history" tone="amber" title={t('backTranslation.madeFrom', { n: madeFrom.n })}
                        body={t('backTranslation.madeFromBody', { n: of.n, what: produces.what })} />
                    ) : null}
                    {part ? (
                      <ClipPlayer language={ctx.language} hashes={[part.hash]} listen={loop.hooks}
                        title={playerTitle}
                        sub={mine ? t('backTranslation.youDrag') : t('backTranslation.nameDrag', { name: who })}
                        onNote={(s) => setNoteAt(Math.round(s * 1000))} />
                    ) : null}
                  </>
                )}
              </ScrollView>
            </HelpClip>
          </View>
        )}
        bottom={({ compact, open }) => session ? (
          <RecordingView rec={rec} phase={loop.phase} title={partLabel} partNumber={partN ?? 1} count={(part?.cards.length ?? 0) + rec.sessionKept} noun="piece" onLeave={() => void loop.finish()} onResume={loop.resumeNow} onStop={loop.stop} onDiscard={() => void loop.discard()} />
        ) : compact ? (
          <PaneBar icon="mic" onPress={open} text={<>{partLabel} · {saidLine(parts)}</>} label={t('backTranslation.openYour', { what: produces.what })}
            help={t('backTranslation.openPartsHelp')} />
        ) : (
          <HelpClip style={{ flex: 1 }}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.paneBody} accessibilityLabel={t('backTranslation.yourWhat', { what: produces.what, said: saidLine(parts) })}>
              {problem}
              {!drafts.loaded ? <Text style={[txt.smMuted, { textAlign: 'center' }]}>{t('backTranslation.loadingParts')}</Text> : parts.map((x) => (
                <HelpRow key={x.index} of="bt.part">
                  <PartCard ctx={ctx} part={x} verse={verseOf(x.index)} into={produces.into} focused={x.index === focus} disabled={blocked} fresh={justSaid.has(x.index)}
                    onPick={() => setPicked(x.index)} onDelete={() => void clearPart(x)} />
                </HelpRow>
              ))}
              {notes.length ? (
                <Text style={[txt.xs, { textAlign: 'center' }]}>
                  {checkedBy ? t('backTranslation.notesForCheck', { count: notes.length, check: checkedBy }) : t('backTranslation.notesAtMoments', { count: notes.length })}
                </Text>
              ) : null}
            </ScrollView>
          </HelpClip>
        )} />

      {noteAt !== null && part ? (
        <MomentSheet ctx={ctx} part={part.index} atMs={noteAt} hash={voiceInMoment ? null : noteHash} spokenTaken={voiceInMoment}
          onHash={setNoteHash} checkedBy={checkedBy}
          onClose={() => { if (!voiceInMoment) setNoteHash(null); setNoteAt(null); }}
          onSave={(text, spoken) => {
            // i18n-ignore: stored in the event log with the back translation's note (noteText)
            const added: MomentNote = { part: part.index, atMs: noteAt, text: text || 'said in the voice note' };
            said.set((d) => ({ ...d, notes: [...d.notes, added], voiceInMoment: d.voiceInMoment || spoken }));
            setNoteAt(null);
          }} />
      ) : null}
      {confirming ? (
        <PublishSheet ctx={ctx} v={v} what={produces.what} of={of} parts={parts} notes={notes} busy={saving}
          hash={noteHash} spokenTaken={voiceInMoment} onHash={setNoteHash} extra={said.value.extra} onExtra={(x) => said.set((d) => ({ ...d, extra: x }))}
          next={nextUp ? { kinds: nextUp.kinds, targets } : null} saved={said.status}
          onClose={() => setConfirming(false)} onPublish={(extra, ask) => void publish(extra, ask)} />
      ) : null}
    </Screen>
  );
}

/** A part's card: said (green check, how long in English), the one being said (lit), or still to come. */
function PartCard(props: { ctx: Ctx; part: BackPart; verse: string | null; into: string; focused: boolean; disabled: boolean; onPick: () => void; onDelete: () => void;
  /** Just said, or changed by Undo or Redo: shaded until the next recording. */ fresh: boolean }) {
  const { part, focused } = props;
  const said = part.cards.length > 0;
  const n = part.index + 1;
  const label = t('backTranslation.part', { n });
  const length = formatClock(part.saidMs);
  const sub = focused ? (said ? t('backTranslation.saidInMore', { length, into: props.into }) : t('backTranslation.sayingNext'))
    : said ? t('backTranslation.saidIn', { length, into: props.into }) : '';
  const spot = useHelpSpot(label, said ? t('backTranslation.partSaidHelp') : t('backTranslation.partTapHelp'), props.onPick);
  return (
    <View style={[styles.part, props.fresh && styles.partFresh, focused && styles.partNow]}>
      <Pressable onPress={spot.onPress} disabled={props.disabled} accessibilityRole="button" accessibilityState={{ selected: focused }}
        accessibilityLabel={sub ? t('backTranslation.partA11y', { part: props.verse ? `${label}, ${props.verse}` : label, sub }) : props.verse ? `${label}, ${props.verse}` : label}
        style={({ pressed }) => [styles.partHead, pressed && { opacity: 0.7 }]}>
        <View style={[styles.partMark, said ? { backgroundColor: C.green } : focused ? { backgroundColor: C.primary } : { backgroundColor: C.light }]}>
          <Ico name={said ? 'check' : 'mic'} size={said ? 20 : 18} color={said || focused ? C.white : withAlpha(C.primary, 0.35)} strokeWidth={said ? 3 : 2.2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.partTitleRow}>
            <Text style={styles.partTitle}>{label}</Text>
            {/* Its verses as the recorder shows them: quiet grey, and only when it has some. */}
            {props.verse ? <View style={styles.verseChip}><Text style={styles.verseChipText}>{props.verse}</Text></View> : null}
          </View>
          {sub ? <Text style={[txt.sm, { color: C.muted }]}>{sub}</Text> : null}
        </View>
        <HelpBadge spot={spot} />
      </Pressable>
      {focused && said ? (
        <View style={styles.partActions}>
          <AudioClip language={props.ctx.language} hashes={part.cards.map((c) => c.hash)} label={t('backTranslation.playYourPart', { n })} disabled={props.disabled} />
          <Text style={[txt.sm, { flex: 1 }]}>{t('backTranslation.hearWhatYouSaid')}</Text>
          <IconBtn name="trash" label={t('backTranslation.deletePart', { n })} help={t('backTranslation.deletePartHelp')} bg="transparent" color={C.muted} disabled={props.disabled} onPress={props.onDelete} />
        </View>
      ) : null}
    </View>
  );
}

/** A pane at one line (an end of the divider): what it holds, and Open, which brings the split back to half. */
function PaneBar(props: { icon: IconName; text: ReactNode; label: string; help: string; onPress: () => void; oneLine?: boolean }) {
  const spot = useHelpSpot(props.label, props.help, props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={props.label} style={({ pressed }) => [styles.bar, pressed && { opacity: 0.7 }]}>
      <Ico name={props.icon} size={18} color={C.primary} />
      <Text style={[txt.sm, { flex: 1, fontWeight: '700' }]} {...(props.oneLine ? { numberOfLines: 1 } : {})}>{props.text}</Text>
      <Text style={[txt.xsStrong, { color: C.primary }]}>{t('backTranslation.open')}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** The big red record button with its halo, sized for the footer. */
/** `part` is the part's number (from 1), or null when there is no part to say. */
function BigRecord(props: { disabled: boolean; part: number | null; onPress: () => void }) {
  const n = props.part;
  const spot = useHelpSpot(t('common.record'), n ? t('backTranslation.recordHelp', { n }) : undefined, props.onPress);
  return (
    <View style={[styles.halo, props.disabled && { opacity: 0.45 }]}>
      <Pressable onPress={spot.onPress} disabled={props.disabled} accessibilityRole="button" accessibilityLabel={n ? t('backTranslation.recordPart', { n }) : t('common.record')}
        accessibilityHint={t('backTranslation.recordHint')} accessibilityState={{ disabled: props.disabled }}
        style={({ pressed }) => [styles.record, pressed && { transform: [{ scale: 0.95 }] }]}>
        <Ico name="mic" size={34} color={C.white} />
        <HelpBadge spot={spot} />
      </Pressable>
    </View>
  );
}

function PublishBtn(props: { disabled: boolean; onPress: () => void }) {
  const spot = useHelpSpot(t('common.done'), t('backTranslation.doneHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} disabled={props.disabled} accessibilityRole="button" accessibilityLabel={t('common.done')} accessibilityState={{ disabled: props.disabled }}
      style={({ pressed }) => [styles.publish, props.disabled && { opacity: 0.45 }, pressed && { opacity: 0.7 }]}>
      <Text style={styles.publishLabel}>{t('common.done')}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** A note at a moment of a part, for whoever checks the back translation. */
function MomentSheet(props: {
  ctx: Ctx; part: number; atMs: number; hash: string | null; checkedBy: string | undefined;
  /** An earlier note already holds the one voice note: this one is typed. */
  spokenTaken: boolean;
  onHash: (h: string | null) => void; onClose: () => void; onSave: (text: string, spoken: boolean) => void;
}) {
  const [text, setText] = useState('');
  const spoken = !props.spokenTaken && !!props.hash;
  return (
    <Sheet visible title={t('backTranslation.noteAtPart', { time: formatClock(props.atMs), part: props.part + 1 })}
      sub={props.checkedBy ? t('backTranslation.noteSub', { check: props.checkedBy }) : t('backTranslation.noteSubNext')} onClose={props.onClose}
      footer={<PrimaryBtn label={t('backTranslation.addNote')} disabled={!text.trim() && !spoken} onPress={() => props.onSave(text.trim(), spoken)} />}>
      {props.spokenTaken
        ? <Text style={txt.smMuted}>{t('backTranslation.oneSpokenNote')}</Text>
        : <VoiceNote ctx={props.ctx} label={t('common.sayIt')} hash={props.hash} onChange={(h) => props.onHash(h)} />}
      <Field value={text} onChangeText={setText} placeholder={t('backTranslation.typeNoMatch')} multiline />
    </Sheet>
  );
}

/**
 * Done is a real step, so it shows what goes (ADR-028): what is said, what is
 * missing, and a last word; then who listens to it next, asked in the same
 * tap (decision 127). The last word is kept as it is typed.
 */
function PublishSheet(props: {
  ctx: Ctx; v: PassageView; what: string; of: Version; parts: BackPart[]; notes: MomentNote[]; busy: boolean;
  hash: string | null; spokenTaken: boolean; onHash: (h: string | null) => void; extra: string; onExtra: (x: string) => void;
  next: { kinds: KindStatus[]; targets: Record<string, UsualTarget | undefined> } | null; saved: SaveStatus;
  onClose: () => void; onPublish: (extra: string, ask: DoneAsk) => void;
}) {
  const { ctx, v } = props;
  const missing = props.parts.filter((x) => x.cards.length === 0).map((x) => x.index + 1);
  const [kindId, setKindId] = useState<string | null>(null);
  const kinds = props.next?.kinds ?? [];
  const next = kinds.find((k) => k.kindId === kindId) ?? kinds[0];
  const nextTarget = next ? props.next?.targets[next.kindId] : undefined;
  const finish = (ask: DoneAsk) => { if (!props.busy) props.onPublish(props.extra, ask); };
  const footer = next ? (
    <View style={{ gap: space.xs }}>
      <PrimaryBtn label={askButtonLabel({ target: nextTarget, kindId: next.kindId, kinds: v.kinds, name: ctx.name })} icon="send" busy={props.busy}
        help={nextTarget ? t('backTranslation.sendHelp', { what: props.what }) : t('backTranslation.askHelp', { what: props.what })}
        onPress={() => finish(nextTarget ? { kindId: next.kindId, questions: [] } : { someoneElse: next.kindId })} />
      <QuietLinks items={[
        ...(nextTarget ? [{ label: t('passage.published.someoneElse'), icon: 'people' as const, help: t('passage.published.someoneElseHelp'), onPress: () => finish({ someoneElse: next.kindId }) }] : []),
        { label: t('recording.publish.sendLater'), icon: 'clock' as const, help: t('backTranslation.sendLaterHelp', { what: props.what }), onPress: () => finish(null) }
      ]} />
    </View>
  ) : <PrimaryBtn label={t('backTranslation.finishWhat', { what: props.what })} icon="check" busy={props.busy} onPress={() => finish(null)} />;
  return (
    <Sheet visible title={capitalize(props.what)} sub={t('backTranslation.ofVersion', { n: props.of.n })}
      onClose={props.onClose} action={<SavedMark status={props.saved} help={t('saved.draftHelp')} />} footer={footer}>
      <View style={styles.checks}>
        <Text style={txt.sm}>✓ {saidLine(props.parts)}</Text>
        {missing.length ? (
          <Text style={[txt.sm, { color: TINT.amberText }]}>{t('backTranslation.nothingYet', { count: missing.length, parts: missing.map((n) => formatNumber(n)).join(', ') })}</Text>
        ) : null}
        {props.notes.length ? <Text style={txt.sm}>✓ {t('backTranslation.notesAtMoments', { count: props.notes.length })}</Text> : null}
      </View>
      <Text style={[txt.sm, { fontWeight: '700' }]}>{t('backTranslation.hardToSayBack')} <Text style={[txt.sm, { color: C.muted, fontWeight: '400' }]}>{t('backTranslation.optional')}</Text></Text>
      {props.spokenTaken
        ? <Text style={txt.smMuted}>{t('backTranslation.oneSpokenNote')}</Text>
        : <VoiceNote ctx={ctx} label={t('common.sayIt')} hash={props.hash} onChange={(h) => props.onHash(h)} />}
      <Field value={props.extra} onChangeText={props.onExtra} placeholder={t('backTranslation.typeNoMatch')} multiline />
      {next ? (
        <View style={{ gap: space.sm }}>
          <SectionLabel label={t('recording.publish.nextCheck')} />
          {kinds.map((k) => (
            <HelpRow key={k.kindId} of="ask.check">
              <AskCheckCard ctx={ctx} kindId={k.kindId} name={checkName(k.kindId, v.kinds)} on={k.kindId === next.kindId} radio={kinds.length > 1}
                people={checkPeople(v.state, k.kindId).filter((id) => id !== ctx.session.actorId)} onPress={() => setKindId(k.kindId)} />
            </HelpRow>
          ))}
        </View>
      ) : null}
    </Sheet>
  );
}

/**
 * Whether this is the shipped back translation in its shipped words (in the
 * language showing): its heading and toast are then whole catalog strings.
 */
function shippedBackTranslation(kind: KindDef): boolean {
  if (kind.id !== 'bt') return false;
  const shipped = DEFAULT_KINDS.find((k) => k.id === 'bt');
  return !!shipped && localKind(shipped).produces?.what === kind.produces?.what;
}

/** An organization's own word for what its kind makes (library content), as a heading: its first letter capitalised. */
function capitalize(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase(currentLocale()) + s.slice(1) : s;
}

const styles = StyleSheet.create({
  topPane: { backgroundColor: C.bg },
  bottomPane: { backgroundColor: C.card },
  paneBody: { padding: space.lg, gap: space.sm + 2 },
  bar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, minHeight: 48 },
  part: { borderRadius: radius.lg, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, overflow: 'hidden' },
  partNow: { borderWidth: 2, borderColor: C.primary },
  // Just said (Caleb, 2026-10-16): the red view's colour, faintly, until the next recording.
  partFresh: { backgroundColor: withAlpha(C.red, 0.06) },
  partHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.primary, paddingHorizontal: space.md, paddingVertical: space.sm },
  partMark: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  partTitle: { fontSize: T.base + 1, fontWeight: '800', color: C.dark },
  partTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  verseChip: { backgroundColor: TINT.gray, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 2 },
  verseChipText: { fontSize: T.sm, fontWeight: '700', color: C.dark },
  partActions: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingBottom: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border, paddingTop: space.sm },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.lg },
  footLabel: { flex: 1, textAlign: 'right', color: C.muted },
  footSide: { flex: 1, alignItems: 'flex-start' },
  halo: { width: 96, height: 96, borderRadius: 48, backgroundColor: withAlpha(C.red, 0.12), alignItems: 'center', justifyContent: 'center' },
  record: { width: 76, height: 76, borderRadius: 38, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center', ...lift({ color: C.red, opacity: 0.35, radius: 12, y: 6, elevation: 4 }) },
  publish: { minWidth: 96, minHeight: target.primary, paddingHorizontal: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  publishLabel: { fontSize: T.base, fontWeight: '800', color: C.primary },
  checks: { backgroundColor: C.light, borderRadius: radius.lg, paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.xs }
});
