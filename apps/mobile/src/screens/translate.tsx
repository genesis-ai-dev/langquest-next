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
// verse, with a space beside each part to tap a verse in (decisions.md 82); the big red button and Done are in the footer, or in
// the recorder's one line. Each part has its own delete, and the card one
// for all; a deleted part's place takes the next part, and with it the
// deleted part's verses, so a part said wrong is said again where it was
// (LAN-83). While the parts are still a version's, the card is named for it. Done is its own screen inside this one, so
// nothing recorded or offered is lost on the way. Parts split by what the
// microphone hears, the room and the voice, with nothing to set (LAN-82).
// Parts are dragged up and down by a grip (the moved part loses its verses,
// to be labelled again), a mark on the line between two parts opens a place
// there to record into, the parts just recorded are shaded until the next
// recording, and Undo and Redo take back and bring back any change to the
// parts as new events: nothing here offers an Undo that runs out (Caleb,
// 2026-10-16).
//
// Every change persists: each part is kept as the draft on the record, so
// nothing is lost if you leave; the saved mark in the header turns from a
// spinner to a check as each part is kept (decision 127). Done (it was
// Publish) opens a last look that sends the version to the people who do its
// next check in the same tap. A person may keep several
// drafts of a passage (decisions.md 83): the workspace opens one of them, a
// new one from a version's parts, or a new empty one, and publishes that one. Back translation: the same tools, but you
// listen to the latest version and what you save is content for the next
// check, not a version.
import {
  checkShows, commands, derivePartVerses, derivePassage, draftsBy, keyTermsForUnit, partMarksFor, RECORD_STEP, skippedVerses, versesInChapter, type PartLabel,
  type EventSpec, type KeyWordDoc, type KindDef, type LanguageState, type PartMark, type PassageNote, type Version
} from '@langquest-next/core';
import type { KeyWordList } from '../keyTerms/listsModel';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { screenTitle } from '../shell/flow';
import { HelpBadge, HelpClip } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { t } from '../i18n';
import { indexesFor } from '../sync/indexes';
import { Banner, Card, Chip, ChipRow, EmptyState, Field, Header, Ico, LinkBtn, PrimaryBtn, Screen, SectionLabel, Sheet, SmallBtn } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { ReferenceRecordings, SourcePlayer } from '../passage/passageSourceAudio';
import { feedbackSource, passageCrumbs, versionTitle, type PassageView } from '../passage/passageView';
import { usePassage } from '../passage/usePassage';
import { useBackTranslationDraft } from '../recording/useBackTranslationDraft';
import { CardList, RecordButton, SaveProblem, type ListedCard } from '../recording/parts';
import { SplitPane } from '../recording/SplitPane';
import { MIN_BOTTOM, MIN_BOTTOM_RECORDING, rememberedSplit } from '../recording/splitModel';
import { useListenLoop } from '../recording/useListenLoop';
import { RecordingView } from '../recording/RecordingView';
import { ConfirmDelete } from '../ui/ConfirmDelete';
import { VerseTile } from '../recording/verseParts';
import {
  backTranslationDraftKey, canPublish, cardDurations, clearListSpecs, draftToOpen, labelAt, marksKeepingLabels, marksOf, movedList,
  removeCardSpecs, restoreSpecs, sameCards, slotRows, targetNumber,
  changedParts, historyFits, parsePartsHistory, partsHistoryKey,
  type PartsHistory, type PartsSnap, type RecordTarget, type SlotRow,
  termsInText, tiedTermIds, tieTermsSpecs, unsavedParts, workingCards
} from '../recording/workspaceModel';
import { DragScrollContext } from '../recording/useDragRows';
import { useDragScroll } from '../recording/useDragScroll';
import { useUndoHistory } from '../drafts/useUndoHistory';
import { forgetUndoHistory } from '../drafts/undoHistory';
import { didStep, emptyHistory, redoStep, undoStep } from '../ui/undoModel';
import { getReferenceSlides } from '../passage/passageResources';
import { pendingPassageCards } from '../recording/recordingFlow';
import { failureMessage } from '../diagnostics/report';
import { RequestBanner } from '../reviewing/parts';
import { contractsFor } from '../shell/screenContracts';
import { BackTranslationBody } from '../recording/btWorkspace';
import { SourceReader } from '../sources/SourceReader';
import { GuideNav, GuideStep } from '../study/guide';
import { mmss, partLabel, recorderLines, refChips, totalMs, type RefChip } from '../recording/model';
import { passageVerseKeys } from '../recording/verseModel';
import { draftName, draftOf, startedFrom } from '../passage/versionsModel';
import { catalogVerses } from '../sources/model';
import { QuietLink, RefChips, type ChipItem } from '../recording/blocks';
import { checkName } from '../admin/adminModel';
import { PublishScreen, type DoneAsk } from '../recording/publish';
import { goesWhenConnected, nextAfterDone, recordCan, sentText, usualTargets } from '../passage/recordModel';
import { nobodyElseReviews, sendTargetLabel } from '../passage/recordTextModel';
import { sendToInput } from '../passage/sendTarget';
import { draftKey } from '../drafts/draftModel';
import { SavedMark } from '../ui/SavedMark';
import { useSaveStatus } from '../ui/useSaveStatus';
import { RecorderBar, RecorderFooter, RecorderPane, type Part } from '../recording/recorder';
import type { UndoRedoProps } from '../ui/undoRedo';
import { BibleBar, BiblePane, EarlierPane, KeyWordsPane, NotesPane, RequestNote } from '../helps/reference';
import { useBible } from '../helps/useBible';
import { useUsage } from '../sources/useUsage';
import { useStudyGuide } from '../study/useStudyGuides';
import { studyProgress } from '../study/progress';
import { C, radius, space, TINT, withAlpha } from '../ui/theme';
import { useRecorder, type RecordedCard } from '../recording/useRecorder';
import { NoteStepContext } from '../checks/noteStep';
import { PartNotesProvider } from '../passage/PartNotes';
import { anyFrom, fromFilter } from '../checks/showsModel';

// ---- Workspace ---------------------------------------------------------------------

/**
 * Where what is said next goes, by card (LAN-83): the end, before a part (a
 * gap), or over a part. `insert`: a place opened on the line between two
 * parts, where what is said has no verses yet.
 */
type Aim = { kind: 'end' } | { kind: 'gap'; before: string; mark?: PartMark; insert?: true } | { kind: 'over'; hash: string; n: number; mark?: PartMark };

/** Said to a screen reader where a toast used to say it: the change shows on the card. */
const say = (message: string) => AccessibilityInfo.announceForAccessibility(message);

export function Workspace(ctx: Ctx) {
  const v = usePassage(ctx);
  if (!v) return <Missing ctx={ctx} title={screenTitle('workspace')} />;
  // Each draft opened is its own workspace (decisions.md 83).
  const which = ['draftId', 'from', 'fresh'].map((k) => ctx.params[k] ?? '').join(':');
  // Notes written while recording are the recording's (decisions.md 130).
  // A part the checks left notes on shows them where it is recorded (decisions.md 149).
  return (
    <NoteStepContext.Provider value={RECORD_STEP}>
      <PartNotesProvider ctx={ctx} v={v}><WorkspaceBody key={`${v.unitId}:${v.languageId}:${which}`} ctx={ctx} v={v} /></PartNotesProvider>
    </NoteStepContext.Provider>
  );
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
  const nextN = p.nextVersionN;
  const isFirst = !latest;

  // ---- which draft (decisions.md 83) ----
  // A person may keep several drafts. `draftId` opens one (by the take it
  // started with); `from` starts a new one from a version's parts and
  // `fresh` an empty one; with none of them, their latest draft, else a new
  // one from the latest version. `root` names the draft once it is saved;
  // `tip` is its newest take seen here, which the next change continues.
  const fromParam = ctx.params['from'];
  const fresh = ctx.params['fresh'] === '1';
  const mine = useMemo(() => draftsBy(p, me), [p, me]);
  const draftId = ctx.params['draftId'];
  const startsNew = !!fromParam || fresh;
  const [root, setRoot] = useState<string | null>(() => draftToOpen(mine, draftId, startsNew));
  const tipRef = useRef<string | null>(null);
  // The draft asked for may reach this device after the workspace opened (a
  // fresh device still catching up with the record): until this workspace
  // has kept a change of its own, it follows the draft it was opened for.
  const awaited = root || tipRef.current ? null : draftToOpen(mine, draftId, startsNew);
  useEffect(() => { if (awaited) setRoot(awaited); }, [awaited]);
  const rootRef = useRef(root);
  rootRef.current = root ?? awaited;
  const draft = draftOf(mine, rootRef.current);
  if (draft) tipRef.current = draft.takeId;
  // What the draft started from: a version's parts, or nothing.
  const startFrom = draft || tipRef.current ? (draft?.basedOnTakeId ?? (rootRef.current ? state.takes[rootRef.current]?.parentTakeId ?? undefined : undefined))
    : fromParam && state.submissions[fromParam] ? fromParam : fresh ? undefined : latest?.takeId;
  const startCards = startFrom ? state.takes[startFrom]?.cardHashes : undefined;
  /** What the next change continues: this draft's newest take, else what it starts from. */
  const parentNow = useCallback(() => (tipRef.current && stateRef.current.takes[tipRef.current] ? tipRef.current : startFrom ?? null), [startFrom]);
  /** This draft in a later state (an Undo runs after the record moved on). */
  const draftIn = (s: LanguageState) => draftOf(draftsBy(derivePassage(s, unitId), me), rootRef.current);
  const name = draftName(mine, rootRef.current);
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
  // Where what is said next goes (LAN-83): the end, a gap (before a part:
  // verses left for later, decisions.md 82, or a deleted part's place), or
  // over a part, which it replaces. Tapping the end, a gap or a part
  // chooses; deleting a part chooses its place. `mark` is the verses the
  // first part said there takes; the rest are more of them.
  const [aim, setAim] = useState<Aim>({ kind: 'end' });
  // A deleted part's place, kept open as a gap until something is recorded into it (one at a time).
  const [hole, setHole] = useState<{ before: string; mark?: PartMark } | null>(null);
  const insertBefore = aim.kind === 'gap' ? aim.before : aim.kind === 'over' ? aim.hash : null;
  // The card's rows as last drawn, for what a tap chose.
  const rowsRef = useRef<SlotRow[]>([]);
  const list = useMemo(() => {
    const base = workingCards({
      ...(draftCards ? { draftCards } : {}), ...(startCards ? { latestCards: startCards } : {}), pending, cleared
    });
    if (!insertBefore || !base.includes(insertBefore)) return base;
    const fresh = new Set(pending.filter((h) => !draftCards?.includes(h)));
    const rest = base.filter((h) => !fresh.has(h));
    const at = rest.indexOf(insertBefore);
    const said = base.filter((h) => fresh.has(h));
    // Over a part: what was said takes its place, once something was said.
    const over = aim.kind === 'over' && said.length > 0 ? 1 : 0;
    return [...rest.slice(0, at), ...said, ...rest.slice(at + over)];
  }, [draftCards, startCards, pending, cleared, insertBefore, aim.kind]);
  const changed = canPublish(list, latest?.cardHashes);
  // While the parts are still the version's they started from, the card is named for it (LAN-83).
  const fromVersion = startedFrom(p.versions, startFrom);
  const recorderGroupTitle = fromVersion && startCards && sameCards(list, startCards) ? versionTitle(fromVersion) : undefined;
  const [split, setSplit] = useState(() => rememberedSplit('workspace'));
  // Publish from the Versions page opens the publish screen at once.
  const publishParam = ctx.params['publish'] === '1';
  const [confirming, setConfirming] = useState(publishParam);

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
  }, [unitId]);
  const rec = useRecorder(persist, { orgId: ctx.language.orgId, languageId, unitId });
  const loop = useListenLoop(rec);
  const session = loop.phase !== 'off';
  const recording = session || rec.manualOn;
  // Uploads wait while the microphone is open (useLanguage `isDeferred`), so
  // the parts of a session go up when it ends, not at the next minute's tick (G10.3).
  const recorderIdle = !recording && !rec.busy;
  const triggerUpload = ctx.language.triggerUpload;
  const wasActive = useRef(false);
  useEffect(() => {
    if (!recorderIdle) { wasActive.current = true; return; }
    if (wasActive.current) { wasActive.current = false; triggerUpload(); }
  }, [recorderIdle, triggerUpload]);

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
      // A part recorded into a gap takes the next verse, so it fills the gap;
      // in a deleted or replaced part's place, the first takes that part's verses and the rest are more of them.
      const aimMark = aim.kind === 'end' ? undefined : aim.mark;
      const verses = verseKeysRef.current;
      if (insertBefore && verses.length > 0) {
        const fresh = new Set(pending);
        let marks: PartMark[];
        if (aim.kind === 'gap' && aim.insert) {
          // Said between two parts: it has no verses yet, and the parts around it keep theirs.
          const old = list.filter((h) => !fresh.has(h));
          marks = marksKeepingLabels({ list: old, marks: partMarksFor(state, unitId, old, verses) }, list, verses.length);
        } else {
          let first = true;
          marks = partMarksFor(state, unitId, list, verses).map((m, i) => {
            if (!fresh.has(list[i]!) || m) return m;
            const mark: PartMark = aimMark ? (first ? aimMark : { t: 'join' }) : { t: 'next' };
            first = false;
            return mark;
          });
        }
        specs = [...specs, ...commands(state, idx).setCardVerses({ commandId: Crypto.randomUUID(), unitId, cards: list, marks, verses })];
      }
    } catch (e) {
      composeLock.current = false;
      setComposing(false);
      setComposeError(failureMessage('workspace: compose draft', e));
      return;
    }
    adopt(specs);
    // Recorded over a part: the part is gone from the draft now, so what comes
    // next goes after what was just said. Undo brings the old part back.
    if (aim.kind === 'over') {
      const fresh = new Set(pending);
      const first = list.findIndex((h) => fresh.has(h));
      const after = list.slice(first).find((h) => !fresh.has(h)) ?? null;
      // The hole was before the part just replaced: it is before what replaced it now.
      if (hole?.before === aim.hash && list[first]) setHole({ ...hole, before: list[first]! });
      say(t('translate.partReplaced', { part: partLabel(aim.n - 1) }));
      setAim(after ? { kind: 'gap', before: after, ...(aim.mark ? { mark: { t: 'join' } } : {}) } : { kind: 'end' });
    } else if (aim.kind === 'gap') {
      // Parts said after the first in a place are more of its verses; the hole is filled.
      if (aim.mark) setAim({ ...aim, mark: { t: 'join' } });
      if (hole?.before === aim.before) setHole(null);
    }
    ctx.language.run(specs)
      .catch((e: unknown) => setComposeError(t('translate.partsNotInDraft', { reason: failureMessage('workspace: save draft', e) })))
      .finally(() => { composeLock.current = false; setComposing(false); });
    // `composing` is a dependency so a card that landed mid-compose is composed next.
  }, [state, pending, list, composing, composeError, ctx.language, idx, unitId, me, insertBefore, parentNow, aim, hole]);
  // The verses of the passage, set once the Bible's range is known (below); read by the compose effect.
  const verseKeysRef = useRef<string[]>([]);
  // A place is recorded into for one session; then the next part is at the end again.
  const filling = useRef(false);
  useEffect(() => {
    if (recording) { if (aim.kind !== 'end') filling.current = true; return; }
    if (!rec.busy && filling.current) { filling.current = false; setAim({ kind: 'end' }); }
  }, [recording, rec.busy, aim.kind]);

  // ---- deleting a take ----
  const [working, setWorking] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const saving = rec.busy || composing || working;
  const blocked = saving || recording;
  /**
   * Writes a change to the parts; says what went wrong, and puts the list back, when it is not kept.
   * `quiet`: a verse label, which shows at once and blocks nothing while it is written.
   */
  async function change(specs: EventSpec[], step: { before: PartsSnap; after: PartsSnap }, message: string, nowCleared = cleared, quiet = false) {
    const wasCleared = cleared;
    adopt(specs);
    if (!quiet) setWorking(true);
    // Set first so the list does not flash back to the latest version's takes.
    setCleared(nowCleared);
    try {
      await ctx.language.run(specs);
      setHistory((h) => didStep(h, { ...step, what: message }));
      say(message);
      return true;
    } catch (e) {
      setCleared(wasCleared);
      ctx.toast(t('common.notSaved', { reason: failureMessage('workspace: change parts', e) }));
      return false;
    } finally { if (!quiet) setWorking(false); }
  }
  async function remove(hash: string, label = partLabel(Math.max(0, list.indexOf(hash)))) {
    if (blocked) return;
    // Its place stays open, chosen: what is said next goes there, taking its verses (LAN-83).
    const at = list.indexOf(hash);
    const was = { aim, hole };
    const next = at >= 0 && at < list.length - 1 ? list[at + 1]! : null;
    const mark = at >= 0 ? marks[at] ?? undefined : undefined;
    setHole(next ? { before: next, ...(mark ? { mark } : {}) } : null);
    setAim(next ? { kind: 'gap', before: next, ...(mark ? { mark } : {}) } : { kind: 'end' });
    const { specs, cleared: nowCleared } = removeCardSpecs(state, idx, {
      commandId: Crypto.randomUUID(), unitId, actorId: me, list, hash, pending: new Set(pending), parentTakeId: parentNow(),
      ...(draft ? { draftTakeId: draft.takeId } : {}), ...(startCards ? { latestCards: startCards } : {})
    });
    const before = snapNow();
    const left = list.filter((h) => h !== hash);
    if (!await change(specs, { before, after: { list: left, marks: marksOf(left, before) } }, t('translate.partDeleted', { part: label }), nowCleared)) {
      setAim(was.aim);
      setHole(was.hole);
    }
  }

  /** Every part off the list, to start over (LAN-83), once the person said yes. Undo brings them all back. */
  const [askingAll, setAskingAll] = useState(false);
  async function removeAll() {
    if (blocked || list.length === 0) return;
    const label = recorderLines(list.length).group;
    const specs = clearListSpecs(state, idx, {
      commandId: Crypto.randomUUID(), unitId, list, pending: new Set(pending), parentTakeId: parentNow(), ...(draft ? { draftTakeId: draft.takeId } : {})
    });
    setAim({ kind: 'end' });
    setHole(null);
    await change(specs, { before: snapNow(), after: { list: [], marks: [] } }, t('translate.partDeleted', { part: label }), true);
  }

  /**
   * A part dragged by its grip (Caleb, 2026-10-16): the list in its new order
   * becomes the draft, and the moved part loses its verses, to be labelled
   * again where it is now; every other part keeps the verses it showed.
   */
  async function move(from: number, to: number) {
    if (blocked || from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return;
    const before = snapNow();
    const moved = movedList(list, from, to);
    const hash = list[from]!;
    const after: PartsSnap = { list: moved, marks: verseKeys.length > 0 ? marksKeepingLabels(before, moved, verseKeys.length, new Set([hash])) : marksOf(moved, before) };
    const { specs } = restoreSpecs(state, idx, {
      commandId: Crypto.randomUUID(), unitId, actorId: me, to: after, verses: verseKeys, parentTakeId: parentNow(),
      ...(draft ? { draftTakeId: draft.takeId } : {}), ...(startCards ? { latestCards: startCards } : {})
    });
    // A deleted part's place is not kept across a move; what was chosen by a part stays with it.
    setHole(null);
    if (aim.kind === 'gap' && !aim.insert && hole?.before === aim.before) setAim({ kind: 'end' });
    await change(specs, { before, after }, t('translate.partMoved', { part: partLabel(from), place: partLabel(to) }));
  }

  // ---- undo and redo (Caleb, 2026-10-16) ----
  // Every change to the parts on this screen can be taken back and brought
  // back again while it is open: each is written as new events that put the
  // parts as they were, never by removing what was written.
  // Kept with the draft on this phone until it is published (usePartsHistory.ts).
  const historyKey = rootRef.current ? partsHistoryKey({ languageId, actorId: me, unitId, draftId: rootRef.current }) : null;
  const { history: storedHistory, loaded: historyLoaded, set: setHistory } = useUndoHistory(historyKey, parsePartsHistory);
  // The recorder pane scrolls while a part is held near its top or bottom.
  const dragScroll = useDragScroll();
  const snapNow = (): PartsSnap => ({ list: [...list], marks: list.map((_, i) => marks[i] ?? null) });
  async function travel(which: 'undo' | 'redo') {
    if (blocked || !historyLoaded) return;
    const step = which === 'undo' ? undoStep(history) : redoStep(history);
    if (!step) return;
    const s = stateRef.current;
    const now = snapNow();
    const { specs, cleared: nowCleared } = restoreSpecs(s, indexesFor(s), {
      commandId: Crypto.randomUUID(), unitId, actorId: me, to: step.to, from: step.from, now, verses: verseKeys, parentTakeId: draftIn(s)?.takeId ?? parentNow(),
      ...(draft ? { draftTakeId: draft.takeId } : {}), ...(startCards ? { latestCards: startCards } : {})
    });
    const wasCleared = cleared;
    adopt(specs);
    setWorking(true);
    setCleared(nowCleared);
    setAim({ kind: 'end' });
    setHole(null);
    try {
      await ctx.language.run(specs);
      setHistory(step.history);
      // What changed is shaded, as a new recording is, and brought into view, so the tap visibly did something.
      const changedNow = changedParts(now, step.to);
      setJustSaid(new Set(changedNow));
      if (changedNow[0]) setShow({ hash: changedNow[0], at: Date.now() });
      say(step.what ? t(which === 'undo' ? 'common.undoneWhat' : 'common.redoneWhat', { what: step.what })
        : which === 'undo' ? t('common.undone') : t('translate.redone'));
    } catch (e) {
      setCleared(wasCleared);
      ctx.toast(t(which === 'undo' ? 'common.notUndone' : 'common.notSaved', { reason: failureMessage(`workspace: ${which}`, e) }));
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
  // What the recorder shows is the language's to say (decisions.md 130).
  const shows = useMemo(() => checkShows(state, RECORD_STEP), [state]);
  const bible = useBible(ctx, unitId, languageId, { listen: loop.hooks, usage, hidden: confirming, shows: { audio: shows.bibleAudio, text: shows.bibleText } });
  const sourceWords = useMemo(() => (bible.rows ? bible.rows.map((r) => r.text).join(' ') : null), [bible.rows]);
  // ---- verse labels on the parts (decisions.md 82) ----
  const v11n = bible.passage.versification;
  const verseKeys = useMemo(() => passageVerseKeys(bible.passage.range,
    (b, c) => (v11n ? versesInChapter(v11n, b, c) : undefined) ?? catalogVerses(b, c)), [bible.passage.range, v11n]);
  verseKeysRef.current = verseKeys;
  const storedMarks = useMemo(() => partMarksFor(state, unitId, list, verseKeys), [state, unitId, list, verseKeys]);
  // What was just tapped shows at once; the record catches up a moment later.
  const [shownMarks, setShownMarks] = useState<{ list: string[]; marks: PartMark[] } | null>(null);
  useEffect(() => { setShownMarks(null); }, [state]);
  const marks = shownMarks && sameCards(shownMarks.list, list) ? shownMarks.marks : storedMarks;

  // ---- what was just recorded (Caleb, 2026-10-16) ----
  // A recording session is one change: its parts are shaded on the card
  // until the next session starts, and Undo takes the whole session back.
  const session0 = useRef<PartsSnap | null>(null);
  const [justSaid, setJustSaid] = useState<ReadonlySet<string>>(() => new Set());
  const [show, setShow] = useState<{ hash: string; at: number } | null>(null);
  const settling = recording || rec.busy || composing || pending.length > 0;
  // A history the draft has moved on from (changed on another phone) would undo that work: it is not offered.
  const history: PartsHistory = historyFits(storedHistory, list) || settling || working ? storedHistory : emptyHistory;
  if (recording && !session0.current) session0.current = { list: [...list], marks: list.map((_, i) => marks[i] ?? null) };
  const sessionNew = session0.current ? list.filter((h) => !session0.current!.list.includes(h)) : null;
  useEffect(() => {
    const start = session0.current;
    if (!start || !sessionNew) return;
    setJustSaid((was) => (was.size === sessionNew.length && sessionNew.every((h) => was.has(h)) ? was : new Set(sessionNew)));
    if (settling) return;
    session0.current = null;
    // Back from the red view, the first part just said is brought into view on the open card.
    if (sessionNew[0]) setShow({ hash: sessionNew[0], at: Date.now() });
    setHistory((h) => didStep(h, { before: start, after: { list: [...list], marks: list.map((_, i) => marks[i] ?? null) }, what: t('translate.newRecording') }));
  }, [sessionNew?.join(), settling, list, marks]); // eslint-disable-line react-hooks/exhaustive-deps -- sessionNew is read by its joined value
  // A verse label is plain to see and easy to change again, so it says nothing (Caleb, 2026-10-16); Undo takes it back.
  const setMarks = (next: PartMark[], message: string) => {
    const before = snapNow();
    const cards = list;
    let specs: EventSpec[];
    try {
      specs = commands(state, idx).setCardVerses({ commandId: Crypto.randomUUID(), unitId, cards, marks: next, verses: verseKeys });
    } catch (e) {
      ctx.toast(t('common.notSaved', { reason: failureMessage('workspace: verse labels', e) }));
      return;
    }
    if (specs.length === 0) return;
    setShownMarks({ list: cards, marks: next });
    void change(specs, { before, after: { list: [...cards], marks: next } }, message, cleared, true).then((kept) => { if (!kept) setShownMarks(null); });
  };
  // Tapping the end, a gap or a part chooses where what is said next goes; tapping it again goes back to the end.
  const choose = (to: RecordTarget) => {
    if (blocked) return;
    const same = (to.kind === 'end' && aim.kind === 'end') || (to.kind === 'gap' && aim.kind === 'gap' && aim.before === list[to.before])
      || (to.kind === 'over' && aim.kind === 'over' && aim.hash === list[to.index]);
    if (same || to.kind === 'end') { setAim({ kind: 'end' }); return; }
    if (to.kind === 'gap') {
      const before = list[to.before];
      if (!before) return;
      // A deleted part's verses, or the verses the gap leaves out.
      const row = rowsRef.current.find((r) => r.kind === 'gap' && r.before === to.before);
      // No gap there: the mark on the line above a part opens one (Caleb, 2026-10-16).
      if (!row) { setAim({ kind: 'gap', before, insert: true }); return; }
      const label = row.kind === 'gap' ? row.label : null;
      const mark: PartMark | undefined = hole?.before === before ? hole.mark : label ? { t: 'set', s: label.s, e: label.e } : undefined;
      setAim({ kind: 'gap', before, ...(mark ? { mark } : {}) });
      return;
    }
    const hash = list[to.index];
    if (!hash) return;
    const mark = marks[to.index] ?? undefined;
    const n = rowsRef.current.find((r) => r.kind === 'part' && r.index === to.index)?.n ?? to.index + 1;
    setAim({ kind: 'over', hash, n, ...(mark ? { mark } : {}) });
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
  // Notes and earlier work from the steps the recording shows (decisions.md 130).
  const notesFrom = useMemo(() => fromFilter(state, RECORD_STEP, 'notes'), [state]);
  const earlierFrom = useMemo(() => fromFilter(state, RECORD_STEP, 'earlier'), [state]);
  const notes = useMemo<PassageNote[]>(() => p.notes.filter((n) => n.anchor.kind !== 'study' && notesFrom(n.kindId ?? RECORD_STEP)), [p.notes, notesFrom]);
  const guideItem = guide ? guide.id.split('~')[0] ?? guide.id : null;
  useEffect(() => {
    if (guide && guideItem) usage.offer([{ itemId: guideItem, name: `${guide.pattern} · ${guide.passage}`, kind: 'guide', opened: false, ref: guide.passage }]);
  }, [guide, guideItem, usage]);
  const references = useMemo(() => getReferenceSlides(state, unitId), [state, unitId]);
  useEffect(() => {
    usage.offer(references.map((r) => ({ itemId: r.id, name: r.label, kind: r.id.startsWith('source:') ? 'source' as const : 'note' as const, opened: false })));
  }, [references, usage]);
  const hasEarlier = p.versions.length > 0 || p.reviews.length > 0;
  const chipIds = refChips('workspace', {
    bible: bible.hasVerses && (shows.bibleAudio || shows.bibleText), guide: !!study && (shows.guideAudio || shows.guideText),
    // Answering feedback keeps Earlier, where the feedback is.
    terms: shows.terms, notes: anyFrom(state, RECORD_STEP, 'notes'), earlier: hasEarlier && (anyFrom(state, RECORD_STEP, 'earlier') || !!revising)
  });
  // Opens on the Bible; answering feedback, on Earlier, where the feedback is (demo ADR-036).
  const [chipState, setChip] = useState<RefChip>(revising && hasEarlier ? 'earlier' : 'bible');
  const chip = chipIds.includes(chipState) ? chipState : chipIds[0] ?? null;
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


  // ---- Done: publishing, and asking for the next check in the same tap (REC-W3, REC-W4; decision 127) ----
  const [publishing, setPublishing] = useState(false);
  // Who it goes to next: the step that will be open once this version is on the record, and each check's usual people.
  const can = recordCan(ctx.session);
  const orgState = ctx.org.state;
  const nextUp = useMemo(() => (can.ask ? nextAfterDone(p, { publishing: true }) : undefined), [p, can.ask]);
  const lines = ctx.language.lines;
  const targets = useMemo(() => (nextUp ? usualTargets(state, orgState, { p, languageId, me, asker: true, lines }) : {}), [nextUp, state, orgState, p, languageId, me, lines]);
  // Nobody else here could check it: Done does the next check now (decisions.md 177).
  const selfCheck = useMemo(() => !!nextUp && can.review && nobodyElseReviews(state, orgState, { languageId, me, lines }), [nextUp, can.review, state, orgState, languageId, me, lines]);
  async function publish(note: string, noteBlobHash: string | null, ask: DoneAsk): Promise<boolean> {
    const commandId = Crypto.randomUUID();
    let specs: EventSpec[];
    const sendTo = ask && 'kindId' in ask ? targets[ask.kindId] : undefined;
    const offline = ctx.language.online === false;
    let message = goesWhenConnected(t('translate.versionPublished', { n: nextN }), offline);
    try {
      const c = commands(state, idx);
      specs = c.publishVersion({
        commandId, unitId, cardHashes: list, actorId: me, parentTakeId: draft?.takeId ?? parentNow(),
        ...(note.trim() ? { note: note.trim() } : {}), ...(noteBlobHash ? { noteBlobHash } : {})
      });
      if (canTie) specs = [...specs, ...tieTermsSpecs(state, specs, tied, commandId)];
      const takeId = specs.find((x) => x.type === 'v1.TakeSubmitted')?.payload as { takeId: string } | undefined;
      if (takeId) specs = [...specs, ...c.referencesUsed({ commandId, unitId, takeId: takeId.takeId, items: usage.items() })];
      // Sent on in the same write, so it is never published and forgotten (History's Withdraw takes the asking back).
      if (ask && 'kindId' in ask && sendTo) {
        const asked = c.ask({ ...sendToInput({ commandId: Crypto.randomUUID(), unitId, kindId: ask.kindId, target: sendTo }), ...(ask.questions.length ? { questions: ask.questions } : {}) });
        specs = [...specs, ...asked];
        message = sentText(sendTo, sendTargetLabel(sendTo, ctx.name), offline);
      }
    } catch (e) {
      ctx.toast(t('translate.notPublished', { reason: failureMessage('workspace: publish', e) }));
      return false;
    }
    setPublishing(true);
    try {
      // Taken back from the record's History (Withdraw), not a toast (decision 134).
      await ctx.act(specs, message);
      // Done: the draft is over, and so is its undo history.
      if (historyKey) forgetUndoHistory(historyKey);
      // The voice note said on the Done screen was kept while uploads waited: send it now.
      ctx.language.triggerUpload();
      setConfirming(false);
      // Back to the record, where the version and who was asked show; Someone else, or the check done now, opens there with the check chosen.
      const someone = ask && 'someoneElse' in ask ? ask.someoneElse : ask && 'kindId' in ask && !sendTo ? ask.kindId : undefined;
      const checkNow = ask && 'checkNow' in ask ? ask.checkNow : undefined;
      ctx.go('passage_record', { unitId, languageId, ...(checkNow ? { checkNow } : someone ? { askSomeone: someone } : { asked: `${nextN}:${Date.now()}` }) });
      return true;
    } catch { return false; /* ctx.act said what went wrong */ }
    finally { setPublishing(false); }
  }

  const parts: Part[] = list.map((hash) => ({ hash, ...(durations.has(hash) ? { durationMs: durations.get(hash)! } : {}) }));
  // The parts card's rows (parts, and gaps a part can be recorded into) and where the next part goes (LAN-83).
  const verseLabels = verseKeys.length > 0 ? derivePartVerses(marks, verseKeys.length).labels : [];
  const dataGaps = skippedVerses(verseLabels).map((g) => ({ before: g.before, label: { s: g.s, e: g.e, kind: 'set' as const } }));
  const holeAt = hole ? list.indexOf(hole.before) : -1;
  const openAt = aim.kind === 'gap' && aim.insert ? list.indexOf(aim.before) : -1;
  const rows = slotRows(list.length, dataGaps, holeAt >= 0 ? { before: holeAt, label: labelAt(marks, holeAt, hole?.mark, verseKeys.length) } : null,
    openAt >= 0 ? openAt : null);
  const target: RecordTarget = aim.kind === 'gap' && list.includes(aim.before) ? { kind: 'gap', before: list.indexOf(aim.before) }
    : aim.kind === 'over' && list.includes(aim.hash) ? { kind: 'over', index: list.indexOf(aim.hash) } : { kind: 'end' };
  const targetN = targetNumber(rows, target);
  rowsRef.current = rows;
  const nextIndex = targetN - 1;
  // While a session is open its parts are not in the list yet (LAN-82): the next one's number is the session's.
  const sessionIndex = (rec.sessionNext ?? targetN) - 1;
  // The verses the next part takes, for the recording view's title.
  const targetLabel = target.kind === 'over' ? verseLabels[target.index] ?? null
    : target.kind === 'gap' ? (rows.find((r) => r.kind === 'gap' && r.before === target.before) as { label: PartLabel | null } | undefined)?.label
      ?? labelAt(marks, target.before, aim.kind === 'gap' ? aim.mark : undefined, verseKeys.length) : null;
  const slotTile = targetLabel ? <VerseTile verses={verseKeys} label={targetLabel} same={targetLabel.kind === 'join'} /> : null;
  const problem = rec.failureCount > 0
    ? <SaveProblem message={rec.error || t('translate.partNotSaved')} retryLabel={t('translate.retrySaving')} busy={rec.busy} onRetry={() => void rec.retryFailed()} />
    : composeError ? <SaveProblem message={composeError} onRetry={() => setComposeError('')} />
    : rec.error ? <SaveProblem message={rec.error} /> : null;
  const record = () => void loop.toggle();
  const scope = { unitId, languageId };
  const lastDone = history.done[history.done.length - 1];
  const lastUndone = history.undone[history.undone.length - 1];
  const undoRedo: UndoRedoProps = {
    canUndo: !!lastDone && !blocked && historyLoaded, canRedo: !!lastUndone && !blocked && historyLoaded,
    ...(lastDone?.what ? { undoWhat: lastDone.what } : {}), ...(lastUndone?.what ? { redoWhat: lastUndone.what } : {}),
    onUndo: () => void travel('undo'), onRedo: () => void travel('redo')
  };

  // Every change is kept as it happens: the mark turns from a spinner to a check as each part is kept.
  const savedStatus = useSaveStatus(saving, list.length > 0 && !(startCards && sameCards(list, startCards)) || !!draft, rec.failureCount > 0 || !!composeError);

  if (confirming) {
    return (
      <PublishScreen ctx={ctx} v={v} n={nextN} first={isFirst} cards={list} totalMs={totalMs(parts.map((x) => x.durationMs))}
        bible={bible.option?.abbreviation} busy={publishing} answers={answers} tied={canTie ? tied.size : 0}
        {...(revising ? { revisingKind: checkName(revising.kindId, v.kinds) } : {})}
        draftKey={draftKey('publish', me, languageId, unitId, rootRef.current ?? 'new')}
        next={nextUp ? { kinds: nextUp.kinds, targets, selfCheck } : null}
        onClose={() => (publishParam ? ctx.back() : setConfirming(false))} onDone={publish} />
    );
  }

  // Which draft this is, when the person keeps more than one, and the version it started from when not the latest.
  const fromN = startedFrom(p.versions, startFrom);
  const several = mine.length + (draft ? 0 : 1) > 1;
  const recordingName = several ? name : t('translate.recordingVersion', { n: nextN });
  const recordingSub = fromN && fromN !== latest?.n ? t('passage.versions.nameFrom', { name: recordingName, version: versionTitle(fromN) }) : recordingName;
  const recorderLine = split >= 1;
  return (
    <Screen fixed
      header={<Header title={v.title} sub={recordingSub} crumbs={passageCrumbs(ctx, v, screenTitle('workspace'))} onBack={ctx.back} close
        action={<SavedMark status={savedStatus} help={t('saved.draftHelp')} />} />}
      footer={recorderLine ? undefined : (
        <RecorderFooter count={list.length} nextIndex={sessionIndex} phase={loop.phase} recordDisabled={saving || rec.failureCount > 0}
          publishDisabled={!changed || blocked || rec.failureCount > 0} onRecord={record} onPublish={() => setConfirming(true)} undo={undoRedo} />
      )}>
      <SplitPane memoryKey="workspace" minBottom={session ? MIN_BOTTOM_RECORDING : MIN_BOTTOM} onFraction={setSplit}
        topStyle={styles.refPane} bottomStyle={styles.wsRecordPane}
        top={({ compact, open }) => compact ? (
          chipIds.includes('bible') && shows.bibleAudio ? <BibleBar bible={bible} onOpen={open} /> : <ReferenceBar onOpen={open} />
        ) : (
          <View style={{ flex: 1 }}>
            <RefChips items={chips} value={chip} onChange={openChip} />
            {chip === 'guide' && study ? <GuideNav ctx={ctx} sp={study} index={step} onIndex={setStep} /> : null}
            <HelpClip style={{ flex: 1 }}>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.paneBody} keyboardShouldPersistTaps="handled">
                {chip === 'bible' ? (
                  <BiblePane ctx={ctx} v={v} bible={bible} terms={unitTerms} tied={tied} canNote={!recording} selected={verse} onSelect={setVerse}
                    hear={shows.bibleAudio} read={shows.bibleText}
                    footer={<ReferenceRecordings ctx={ctx} unitId={unitId} disabled={false} listen={loop.hooks} onPlay={usage.open} />}
                    {...(recording ? {} : {
                      onTerm: (termId: string) => ctx.go('key_term_detail', { ...scope, termId, ...(draft ? { draftId: draft.takeId } : {}) }),
                      onMoreBibles: () => ctx.go('bible_explore', scope)
                    })} />
                ) : chip === 'guide' && study && guide ? (
                  <>
                    <GuideStep key={study.steps[step]!.step.id} ctx={ctx} v={v} guide={guide} status={study.steps[step]!} spoken={!shows.guideText && shows.guideAudio} read={shows.guideText}
                      canContribute={!recording} onTerm={(termId) => ctx.go('key_term_detail', { ...scope, termId, ...(draft ? { draftId: draft.takeId } : {}) })} />
                    <LinkBtn label={t('translate.openStudy')} help={t('translate.openStudyHelp')} style={{ alignSelf: 'center' }} onPress={() => ctx.go('study_step', { ...scope, stepId: study.steps[step]!.step.id })} />
                  </>
                ) : chip === 'terms' ? (
                  <KeyWordsPane ctx={ctx} v={v} terms={trayTerms} rows={bible.rows} bibleName={bible.option?.abbreviation ?? ''} bibleLanguage={bible.option?.language} draftTakeId={draft?.takeId} canTie={canTie} disabled={blocked}
                    onHear={(key) => { setChip('bible'); if (key) { setVerse(key); bible.playVerse(key); } }}
                    allTerms={() => ctx.go('key_terms', scope)}
                    {...(recording ? {} : { onWordPage: (list: KeyWordList, word: KeyWordDoc) => ctx.go('key_term_detail', { ...scope, listId: list.itemId, wordId: word.id, ...(draft ? { draftId: draft.takeId } : {}) }) })} />
                ) : chip === 'notes' ? (
                  <NotesPane ctx={ctx} v={v} notes={notes} disabled={blocked} top={request ? <RequestNote ctx={ctx} request={request} /> : undefined} />
                ) : chip === 'earlier' ? (
                  <EarlierPane ctx={ctx} v={v} from={revising ? (s) => s === revising.kindId || earlierFrom(s) : earlierFrom} {...(revising ? { focusReviewId: revising.id } : {})} />
                ) : null}
              </ScrollView>
            </HelpClip>
          </View>
        )}
        bottom={({ compact, open, height, room }) => session ? (
          // While recording, the pane is the recording view: what is being said, the waveform, and an X back to the parts.
          <RecordingView rec={rec} phase={loop.phase} title={partLabel(sessionIndex)} partNumber={targetN} count={list.length + rec.sessionKept} noun="part" onLeave={() => void loop.finish()} onResume={loop.resumeNow} onStop={loop.stop} onDiscard={() => void loop.discard()}
            {...(slotTile ? { tile: slotTile } : {})} />
        ) : compact ? (
          <RecorderBar count={list.length} nextIndex={nextIndex} phase={loop.phase} disabled={saving || rec.failureCount > 0} onRecord={record} onOpen={open} undo={undoRedo} />
        ) : (
          <HelpClip style={{ flex: 1 }}>
            <DragScrollContext.Provider value={dragScroll.scroll}>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.recordBody} accessibilityLabel={t('translate.yourRecording')} {...dragScroll.props}>
                {problem}
                <RecorderPane ctx={ctx} parts={parts} phase={loop.phase} capturing={rec.vadCapturing} small={height < 360} disabled={blocked}
                  onDelete={(h, label) => void remove(h, label)} onDeleteAll={() => setAskingAll(true)} onRoom={room} onResume={loop.resumeNow}
                  {...(recorderGroupTitle ? { title: recorderGroupTitle } : {})}
                  rows={rows} target={target} onChoose={choose} onMove={(from, to) => void move(from, to)} fresh={justSaid} show={show}
                  verses={{ keys: verseKeys, marks, onMarks: setMarks }} />
              </ScrollView>
            </DragScrollContext.Provider>
          </HelpClip>
        )} />
      <ConfirmDelete visible={askingAll} name={recorderLines(list.length).group} title={t('recording.recorder.deleteAllAsk')} confirmLabel={t('recording.recorder.deleteAll')}
        sub={t('recording.parts.groupSub', { count: list.length, length: mmss(totalMs(parts.map((x) => x.durationMs))) })}
        onClose={() => setAskingAll(false)} onConfirm={() => { setAskingAll(false); void removeAll(); }} />
    </Screen>
  );
}

/** The reference at one line, when there is no Bible to show there: a tap brings it back to half. */
function ReferenceBar(props: { onOpen: () => void }) {
  const spot = useHelpSpot(t('translate.openReference'), t('translate.openReferenceHelp'), props.onOpen);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={t('translate.openReference')} style={({ pressed }) => [styles.bar, pressed && { opacity: 0.7 }]}>
      <Ico name="book" size={18} color={C.primary} />
      <Text style={[txt.sm, { flex: 1, fontWeight: '700' }]} numberOfLines={3}>{t('translate.dragDown')}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
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
  return <NoteStepContext.Provider value={kind.id}><BackTranslationBody key={`${v.unitId}:${v.languageId}:${kindId}`} ctx={ctx} v={v} kind={kind} of={v.p.latest} /></NoteStepContext.Provider>;
}

const styles = StyleSheet.create({
  bar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, minHeight: 48, backgroundColor: C.card },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  // The workspace (demo ADR-036): the reference on the screen's ground, the recorder on white.
  refPane: { backgroundColor: C.bg },
  wsRecordPane: { backgroundColor: C.card },
  recordBody: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.lg, gap: space.md },
  // Back translation (LAN-23): each half its own ground, so the two read as
  // different places: the version cool (the brand's pale tint), your parts
  // warm (the red tint). Cards on both stay white, so text keeps its contrast.
  sourcePane: { backgroundColor: C.light },
  recordPane: { backgroundColor: withAlpha(C.red, 0.08) },
  paneBody: { paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.lg, gap: space.md }
});

export const contracts = contractsFor('workspace', 'back_translation');
