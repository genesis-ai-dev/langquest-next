// Writing a passage (decisions.md 137; demo branch caleb-written-translations,
// simple/writing.tsx wWrite, wType, wPublish, wFirstWrite, wBtWrite): the
// recording workspace's split, with the reference on top and one box per
// verse below. On top: what is being written from (a version heard verse by
// verse, or its words), the Bible, key words and notes. Below: a grey verse
// tile and a box for each verse; while typing, the letters this team writes
// that a plain keyboard lacks sit above the keyboard. Done looks the words
// over, says what changed, and puts them on the record, asking whoever does
// the next check in the same tap (decisions.md 127):
//   version  a written version of the passage (a team that writes, or "Write it instead")
//   make     what a making step makes from a version: written down, a written back translation, a translation,
//            or words added to the version (it then holds the recording and its words; changing them starts from the words it has)
//   final    a step whose result is the passage's next version, in writing
// What is typed is kept on this phone as it is typed, only for its writer,
// until Done (a draft, decision 127), so nothing half written reaches the
// grow-only record.
import {
  addedTo, checkShows, commands, madeVersionOf, RECORD_STEP, versesInChapter, writtenCards,
  type EventSpec, type KindDef, type MakesSpec, type Version
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View, type NativeSyntheticEvent, type TextInputProps, type TextInputSelectionChangeEventData } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { HelpBadge, HelpClip, HelpRow } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { t } from '../i18n';
import { indexesFor } from '../sync/indexes';
import { Header, HelpCover, Ico, PrimaryBtn, Screen, SmallBtn } from '../ui/kit';
import { SavedMark } from '../ui/SavedMark';
import { useDraft } from '../drafts/useDraft';
import { draftKey as draftKeyFor } from '../drafts/draftModel';
import { PublishScreen, type DoneAsk } from '../recording/publish';
import { nextAfterDone, recordCan, sentText, usualTargets } from '../passage/recordModel';
import { sendTargetLabel } from '../passage/record';
import { sendToInput } from '../passage/sendTarget';
import { NoteStepContext } from '../checks/noteStep';
import { anyFrom, fromFilter } from '../checks/showsModel';
import { txt } from '../ui/textStyles';
import { versionTitle, type PassageView } from '../passage/passageView';
import { SplitPane } from '../recording/SplitPane';
import { MIN_BOTTOM } from '../recording/splitModel';
import { failureMessage } from '../diagnostics/report';
import { RefChips, type ChipItem } from '../recording/blocks';
import { BiblePane, NotesPane } from '../helps/reference';
import { useBible } from '../helps/useBible';
import { passageVerseKeys, verseName } from '../recording/verseModel';
import { catalogVerses } from '../sources/model';
import { useUsage } from '../sources/useUsage';
import { languageLabel } from '../admin/adminModel';
import { C, radius, space, target, TINT } from '../ui/theme';
import {
  boxesChanged, boxesFor, EMPTY_WRITING, heardByVerse, isPartKey, isWritingDraft, teamLetters, writingDraftFor, writingSpecs, writtenByVerse,
  type MakingSource, type VerseText
} from './model';
import { VersePlayRow } from './WrittenText';

export type WritingMode =
  | { kind: 'version' }
  | { kind: 'make'; step: KindDef; makes: MakesSpec; source: MakingSource; language?: string; requestId?: string; added?: boolean }
  | { kind: 'final'; step: KindDef; source: Version; requestId?: string };

type Chip = 'source' | 'bible' | 'notes';

export function WritingWorkspace({ ctx, v, mode }: { ctx: Ctx; v: PassageView; mode: WritingMode }) {
  const { state, unitId, languageId, p } = v;
  const me = ctx.session.actorId;
  const idx = indexesFor(state);
  const usage = useUsage();
  // What this step shows its writer (decisions.md 130): a version is written at the recording's step, what a step makes at that step.
  const step = mode.kind === 'version' ? RECORD_STEP : mode.step.id;
  const shows = useMemo(() => checkShows(state, step), [state, step]);
  const bible = useBible(ctx, unitId, languageId, { usage, shows: { audio: shows.bibleAudio, text: shows.bibleText } });
  const v11n = bible.passage.versification;
  const verseKeys = useMemo(() => passageVerseKeys(bible.passage.range,
    (b, c) => (v11n ? versesInChapter(v11n, b, c) : undefined) ?? catalogVerses(b, c)), [bible.passage.range, v11n]);

  // ---- what it starts from ----
  const latest = p.latest;
  const start = useMemo<VerseText[]>(() => {
    if (mode.kind === 'version') return latest?.medium === 'writing' ? writtenByVerse(state, unitId, latest.cardHashes, verseKeys) : [];
    if (mode.kind === 'final') return mode.source.medium === 'writing' ? writtenByVerse(state, unitId, mode.source.cardHashes, verseKeys) : [];
    // Words already added to the version: changing them starts from them.
    if (mode.added && mode.source.kind === 'version') {
      const words = addedTo(p, mode.source.version).find((a) => a.medium === 'writing');
      if (words) return writtenByVerse(state, unitId, words.made.parts.map((c) => c.hash), verseKeys);
    }
    return [];
  }, [mode, latest, state, unitId, verseKeys, p]);
  // One draft per writer, per passage and what it makes (and per version, for words added to one).
  const draft = useDraft(draftKeyFor('writing', me, languageId, unitId, mode.kind === 'version' ? 'version' : mode.step.id,
    mode.kind === 'make' && mode.added && mode.source.kind === 'version' ? mode.source.version.takeId : null), EMPTY_WRITING, isWritingDraft);
  const boxes = draft.value.boxes;
  const loaded = draft.loaded;
  const shown = useMemo(() => {
    const base = boxesFor(verseKeys, start);
    if (!boxes.length) return base;
    // Keep what was typed for each verse; verses the passage has now that the draft lacks start from `start`.
    return verseKeys.length > 0 ? base.map((b) => boxes.find((x) => x.key === b.key) ?? b) : boxes;
  }, [boxes, verseKeys, start]);
  const write = (next: VerseText[]) => draft.set(writingDraftFor(next, start));
  const changed = boxesChanged(shown, start);
  const filled = shown.filter((b) => b.text.trim()).length;

  // ---- typing ----
  const [focus, setFocus] = useState<number | null>(null);
  // Each box grows with what is in it (a multiline field keeps one height on the web otherwise).
  const [heights, setHeights] = useState<Record<string, number>>({});
  const selections = useRef<Map<number, { start: number; end: number }>>(new Map());
  // The team's own letters; writing in another language (a back translation into English) has none to offer.
  const letters = useMemo(() => (mode.kind === 'make' && mode.language ? [] : teamLetters(state)), [state, mode]);
  const setText = (i: number, text: string) => write(shown.map((b, j) => (j === i ? { ...b, text } : b)));
  const insert = (letter: string) => {
    if (focus === null) return;
    const box = shown[focus]!;
    const sel = selections.current.get(focus) ?? { start: box.text.length, end: box.text.length };
    setText(focus, box.text.slice(0, sel.start) + letter + box.text.slice(sel.end));
    selections.current.set(focus, { start: sel.start + letter.length, end: sel.start + letter.length });
  };
  const addPart = () => write([...shown, { key: `part:${shown.length}`, text: '' }]);

  // ---- the reference on top ----
  const source = mode.kind === 'make' ? mode.source : mode.kind === 'final' ? { kind: 'version' as const, version: mode.source } : null;
  const notesFrom = useMemo(() => fromFilter(state, step, 'notes'), [state, step]);
  const notes = p.notes.filter((n) => n.anchor.kind !== 'study' && notesFrom(n.kindId ?? RECORD_STEP));
  const chipIds: Chip[] = [...(source ? ['source' as const] : []), ...(bible.hasVerses && (shows.bibleAudio || shows.bibleText) ? ['bible' as const] : []),
    ...(anyFrom(state, step, 'notes') ? ['notes' as const] : [])];
  const [chipState, setChip] = useState<Chip>(source ? 'source' : 'bible');
  const chip: Chip | undefined = chipIds.includes(chipState) ? chipState : chipIds[0];
  const sourceTitle = !source ? '' : source.kind === 'version' ? versionTitle(source.version.n)
    : source.made.kindId ? v.kind(source.made.kindId).name : t('writing.madeThing');
  const chips: ChipItem<Chip>[] = chipIds.map((c) => ({
    source: { id: 'source' as const, label: sourceTitle, icon: (source && (source.kind === 'version' ? source.version.medium : source.made.medium) === 'writing' ? 'edit' : 'mic') as 'edit' | 'mic', hint: t('writing.sourceHint') },
    bible: { id: 'bible' as const, label: t('translate.chips.bible'), icon: 'listen' as const, hint: t('translate.chips.bibleHint') },
    notes: { id: 'notes' as const, label: t('translate.chips.notes'), icon: 'chat' as const, count: notes.length, hint: t('translate.chips.notesHint') }
  })[c]);
  const [verse, setVerse] = useState<string | null>(null);
  const focusKey = focus !== null ? shown[focus]?.key ?? null : null;

  // ---- Done: putting it on the record, and asking for the next check in the same tap (decisions.md 127) ----
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const nextN = p.versions.length + 1;
  const ask = recordCan(ctx.session).ask;
  const orgState = ctx.org.state;
  // What comes next once this is on the record: after a version, its first check; after a step made something, the check after it.
  // A step that makes the next version leaves the asking to the record, as a final recording does.
  const nextUp = useMemo(() => (!ask || mode.kind === 'final' ? undefined
    : mode.kind === 'version' ? nextAfterDone(p, { publishing: true }) : nextAfterDone(p, { recordedKindId: mode.step.id })), [ask, mode, p]);
  const targets = useMemo(() => (nextUp ? usualTargets(state, orgState, { p, languageId, me, asker: true }) : {}), [nextUp, state, orgState, p, languageId, me]);
  async function publish(note: string, noteBlobHash: string | null, asked: DoneAsk): Promise<boolean> {
    const commandId = Crypto.randomUUID();
    const sendTo = asked && 'kindId' in asked ? targets[asked.kindId] : undefined;
    let message = mode.kind === 'make' ? t('writing.madePublished', { what: mode.step.name }) : t('writing.versionPublished', { version: versionTitle(nextN) });
    let specs: EventSpec[];
    try {
      const w = writingSpecs(state, idx, { commandId, unitId, boxes: shown, verseKeys });
      const cmd = commands(state, idx);
      const said = { ...(note.trim() ? { text: note.trim() } : {}), ...(noteBlobHash ? { blobHash: noteBlobHash } : {}) };
      if (mode.kind === 'version') {
        specs = [...w.specs, ...cmd.publishVersion({ commandId, unitId, cardHashes: w.ids, actorId: me, parentTakeId: latest?.takeId ?? null,
          ...(note.trim() ? { note: note.trim() } : {}), ...(noteBlobHash ? { noteBlobHash } : {}) })];
      } else if (mode.kind === 'final') {
        specs = [...w.specs, ...cmd.makeVersion({ commandId, unitId, kindId: mode.step.id, fromTakeId: mode.source.takeId, cardHashes: w.ids, actorId: me, ...(mode.requestId ? { requestId: mode.requestId } : {}) })];
      } else {
        const from = mode.source.kind === 'version' ? { fromTakeId: mode.source.version.takeId } : { fromMadeId: mode.source.made.id };
        specs = [...w.specs, ...cmd.make({ commandId, unitId, kindId: mode.step.id, ...from, parts: writtenCards(w.ids),
          ...(mode.language ? { language: mode.language } : {}), ...(mode.added ? { added: true } : {}), ...(mode.requestId ? { requestId: mode.requestId } : {}) })];
        // What was said about it goes on the passage, with the version it was made from, as a back translation's notes do.
        const of = mode.source.kind === 'version' ? mode.source.version.takeId : madeVersionOf(p, mode.source.made);
        if ((said.text || said.blobHash) && of) specs = [...specs, ...cmd.addNote({ commandId: Crypto.randomUUID(), unitId, anchor: { kind: 'version', takeId: of }, ...said })];
      }
      // Sent on in the same write, so it is never finished and forgotten (History's Withdraw takes the asking back).
      if (asked && 'kindId' in asked && sendTo) {
        const req = cmd.ask({ ...sendToInput({ commandId: Crypto.randomUUID(), unitId, kindId: asked.kindId, target: sendTo }), ...(asked.questions.length ? { questions: asked.questions } : {}) });
        specs = [...specs, ...req];
        message = sentText(sendTo, sendTargetLabel(sendTo, ctx.name));
      }
    } catch (e) {
      ctx.toast(t('writing.notPublished', { reason: failureMessage('writing: publish', e) }));
      return false;
    }
    setBusy(true);
    try {
      await ctx.act(specs, message);
    } catch { setBusy(false); return false; /* ctx.act said what went wrong */ }
    await draft.clear();
    ctx.language.triggerUpload();
    setBusy(false);
    setConfirming(false);
    // Back to the record, where who was asked shows; Someone else opens there with the check chosen.
    const someone = asked && 'someoneElse' in asked ? asked.someoneElse : asked && 'kindId' in asked && !sendTo ? asked.kindId : undefined;
    ctx.go('passage_record', { unitId, languageId, ...(someone ? { askSomeone: someone } : { asked: `w:${Date.now()}` }) });
    return true;
  }

  const sub = mode.kind === 'version' ? t('writing.writingVersion', { version: versionTitle(nextN) })
    : mode.kind === 'make' && mode.language ? t('writing.stepInto', { step: mode.step.name, language: languageLabel(mode.language) })
    : mode.step.name;
  const typing = focus !== null;

  if (confirming) {
    const words = shown.filter((b) => b.text.trim());
    return (
      <PublishScreen ctx={ctx} v={v} n={nextN} first={mode.kind !== 'version' || !latest} cards={[]} totalMs={undefined} bible={undefined}
        busy={busy} answers={mode.kind === 'version' ? p.awaitingResponse : []} tied={0} {...(mode.kind === 'final' ? { making: true } : {})}
        {...(mode.kind === 'make' ? { title: mode.step.name } : {})}
        preview={<WordsPreview boxes={words} verseKeys={verseKeys} sub={t('writing.publishSub', { count: words.length })} />}
        draftKey={draftKeyFor('publish', me, languageId, unitId, `writing:${mode.kind === 'version' ? 'version' : mode.step.id}`)}
        next={nextUp ? { kinds: nextUp.kinds, targets } : null}
        onClose={() => setConfirming(false)} onDone={publish} />
    );
  }

  return (
    // Notes written here are this step's (decisions.md 130).
    <NoteStepContext.Provider value={step}>
    <Screen fixed
      header={<Header title={v.title} sub={sub} onBack={ctx.back} close action={<SavedMark status={draft.status} help={t('saved.draftHelp')} />} />}
      footer={typing ? (
        letters.length > 0 ? <LetterStrip letters={letters} onLetter={insert} /> : null
      ) : (
        <PrimaryBtn label={t('common.done')} icon="check" help={t('writing.help.done')} disabled={!loaded || !changed || filled === 0} onPress={() => setConfirming(true)} />
      )}>
      <SplitPane memoryKey="writing" minBottom={MIN_BOTTOM} topStyle={styles.refPane} bottomStyle={styles.writePane}
        top={({ compact, open }) => compact ? (
          <SourceBar title={source ? sourceTitle : t('translate.dragDown')} icon={source ? 'listen' : 'book'} onOpen={open} />
        ) : (
          <View style={{ flex: 1 }}>
            {chip ? <RefChips items={chips} value={chip} onChange={setChip} /> : null}
            <HelpClip style={{ flex: 1 }}>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.paneBody} keyboardShouldPersistTaps="handled">
                {chip === 'source' && source ? (
                  <SourcePane ctx={ctx} v={v} source={source} verseKeys={verseKeys} lit={focusKey} />
                ) : chip === 'bible' ? (
                  <BiblePane ctx={ctx} v={v} bible={bible} canNote selected={verse ?? focusKey} onSelect={setVerse} hear={shows.bibleAudio} read={shows.bibleText} />
                ) : chip === 'notes' ? (
                  <NotesPane ctx={ctx} v={v} notes={notes} />
                ) : null}
              </ScrollView>
            </HelpClip>
          </View>
        )}
        bottom={(
          <HelpClip style={{ flex: 1 }}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.writeBody} keyboardShouldPersistTaps="handled" accessibilityLabel={t('writing.yourWriting')}>
              {shown.map((b, i) => (
                <HelpRow key={b.key} of="writing.verse">
                  <View style={styles.verseRow}>
                    <VerseTile label={isPartKey(b.key) ? String(i + 1) : verseName(verseKeys, verseKeys.indexOf(b.key))} empty={!b.text.trim()} />
                    {/* No spell check or autocorrect: a phone's dictionary would "fix" the language into another one. */}
                    <VerseBox label={isPartKey(b.key) ? t('writing.partBox', { n: i + 1 }) : t('writing.verseBox', { verse: verseName(verseKeys, verseKeys.indexOf(b.key)) })} value={b.text} multiline spellCheck={false} autoCorrect={false} onChangeText={(x) => setText(i, x)}
                      onFocus={() => setFocus(i)} onBlur={() => setFocus((f) => (f === i ? null : f))}
                      onSelectionChange={(e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => selections.current.set(i, e.nativeEvent.selection)}
                      onContentSizeChange={(e) => { const h = Math.ceil(e.nativeEvent.contentSize.height); setHeights((cur) => (cur[b.key] === h ? cur : { ...cur, [b.key]: h })); }}
                      placeholder={t('writing.tapToWrite')} placeholderTextColor={C.faint}
                      style={[styles.box, heights[b.key] ? { height: Math.max(target.min, heights[b.key]! + 2) } : null, focus === i && styles.boxOn, !b.text.trim() && focus !== i && styles.boxEmpty]} />
                  </View>
                </HelpRow>
              ))}
              {verseKeys.length === 0 ? <SmallBtn label={t('writing.addPart')} icon="plus" help={t('writing.help.addPart')} onPress={addPart} /> : null}
            </ScrollView>
          </HelpClip>
        )} />
    </Screen>
    </NoteStepContext.Provider>
  );
}

/** The words about to go on the record, verse by verse, to look over on Done. */
function WordsPreview({ boxes, verseKeys, sub }: { boxes: VerseText[]; verseKeys: string[]; sub: string }) {
  return (
    <View style={styles.preview} accessibilityLabel={sub}>
      <Text style={txt.smMuted}>{sub}</Text>
      {boxes.map((b, i) => (
        <HelpRow key={b.key} of="writing.preview">
          <View style={styles.previewRow}>
            <VerseTile label={isPartKey(b.key) ? String(i + 1) : verseName(verseKeys, verseKeys.indexOf(b.key))} />
            <Text style={[txt.body, { flex: 1 }]}>{b.text.trim()}</Text>
          </View>
        </HelpRow>
      ))}
    </View>
  );
}

/** What is being written from: a recording verse by verse, or its words. */
function SourcePane({ ctx, v, source, verseKeys, lit }: { ctx: Ctx; v: PassageView; source: MakingSource; verseKeys: string[]; lit: string | null }) {
  const parts = source.kind === 'version' ? source.version.cardHashes : source.made.parts.map((c) => c.hash);
  const medium = source.kind === 'version' ? source.version.medium : source.made.medium;
  if (medium === 'writing') {
    const words = writtenByVerse(v.state, v.unitId, parts, verseKeys);
    return (
      <View style={{ gap: space.sm }}>
        {words.map((w, i) => (
          <HelpRow key={w.key} of="writing.source">
            <View style={[styles.readRow, lit === w.key && styles.readRowLit]}>
              <VerseTile label={isPartKey(w.key) ? String(i + 1) : verseName(verseKeys, verseKeys.indexOf(w.key))} />
              <Text style={[txt.body, { flex: 1 }]}>{w.text}</Text>
            </View>
          </HelpRow>
        ))}
      </View>
    );
  }
  const heard = heardByVerse(v.state, v.unitId, parts, verseKeys);
  return (
    <View style={{ gap: space.sm }}>
      {heard.map((h, i) => (
        <HelpRow key={h.key} of="writing.sourcePlay">
          <VersePlayRow ctx={ctx} hashes={h.hashes} lit={lit === h.key}
            label={isPartKey(h.key) ? String(i + 1) : verseName(verseKeys, verseKeys.indexOf(h.key))} />
        </HelpRow>
      ))}
      <Text style={[txt.xs, { textAlign: 'center' }]}>{t('writing.sourceHelp')}</Text>
    </View>
  );
}

/** A verse number as the recorder draws it: a soft grey tile with a dark number (decisions.md 82). */
export function VerseTile({ label, empty }: { label: string; empty?: boolean }) {
  return (
    <View style={[styles.tile, empty && styles.tileEmpty]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={[styles.tileText, empty && { color: C.faint }]}>{label}</Text>
    </View>
  );
}

/** The letters this team writes that a plain keyboard lacks, above the keyboard. */
/** The bar over the boxes when the reference is folded away: what you write from, and it opens it. */
function SourceBar({ title, icon, onOpen }: { title: string; icon: 'listen' | 'book'; onOpen: () => void }) {
  const spot = useHelpSpot(t('writing.openReference'), t('writing.help.openSource'), onOpen);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={t('writing.openReference')} style={({ pressed }) => [styles.bar, pressed && { opacity: 0.7 }]}>
      <Ico name={icon} size={18} color={C.primary} />
      <Text style={[txt.sm, { flex: 1, fontWeight: '700' }]} numberOfLines={1}>{title}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** A verse's box: while help is on, tapping it explains it instead of opening the keyboard. */
function VerseBox({ label, ...input }: { label: string } & TextInputProps) {
  const spot = useHelpSpot(label, t('writing.help.box'), NOTHING);
  return (
    <View style={{ flex: 1 }}>
      <TextInput {...input} accessibilityLabel={label} />
      <HelpCover spot={spot} label={label} />
    </View>
  );
}

/** One of the team's letters over the keyboard: it types the letter where you are writing. */
function LetterKey({ letter, onLetter }: { letter: string; onLetter: (l: string) => void }) {
  const label = t('writing.addLetter', { letter });
  const spot = useHelpSpot(label, t('writing.help.letter', { letter }), () => onLetter(letter));
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.letter, pressed && { opacity: 0.6 }]}>
      <Text style={styles.letterText}>{letter}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

const NOTHING = () => undefined;

function LetterStrip({ letters, onLetter }: { letters: string[]; onLetter: (l: string) => void }) {
  return (
    <View style={styles.strip} accessibilityLabel={t('writing.letters')}>
      {letters.map((l) => <HelpRow key={l} of="writing.letter"><LetterKey letter={l} onLetter={onLetter} /></HelpRow>)}
    </View>
  );
}

const styles = StyleSheet.create({
  refPane: { backgroundColor: C.bg },
  writePane: { backgroundColor: C.card },
  paneBody: { paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.lg, gap: space.md },
  writeBody: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xl, gap: space.sm },
  bar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, minHeight: 48, backgroundColor: C.card },
  verseRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  box: {
    flex: 1, minHeight: target.min, borderRadius: radius.md, borderWidth: 1, borderColor: C.border, backgroundColor: C.card,
    paddingHorizontal: space.md, paddingVertical: 10, fontSize: 17, lineHeight: 24, color: C.dark, textAlignVertical: 'top'
  },
  boxOn: { borderWidth: 2, borderColor: C.primary },
  boxEmpty: { borderStyle: 'dashed', borderColor: C.faint, backgroundColor: 'transparent' },
  tile: { minWidth: 34, height: 34, paddingHorizontal: 6, borderRadius: radius.sm + 1, backgroundColor: TINT.gray, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  tileEmpty: { backgroundColor: 'transparent', borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.faint },
  tileText: { fontSize: 15, fontWeight: '800', color: C.dark },
  readRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', padding: space.xs, borderRadius: radius.md },
  readRowLit: { backgroundColor: C.light },
  preview: { backgroundColor: C.card, borderRadius: radius.lg, borderWidth: 1, borderColor: C.border, padding: space.md, gap: space.sm },
  previewRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  strip: { flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' },
  letter: { minWidth: target.min, height: target.min, borderRadius: radius.md, borderWidth: 1.5, borderColor: C.primary, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm },
  letterText: { fontSize: 22, fontWeight: '700', color: C.primary }
});
