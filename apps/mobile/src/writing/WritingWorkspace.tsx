// Writing a passage (decisions.md 107; demo branch caleb-written-translations,
// simple/writing.tsx wWrite, wType, wPublish, wFirstWrite, wBtWrite): the
// recording workspace's split, with the reference on top and one box per
// verse below. On top: what is being written from (a version heard verse by
// verse, or its words), the Bible, key words and notes. Below: a grey verse
// tile and a box for each verse; while typing, the letters this team writes
// that a plain keyboard lacks sit above the keyboard. Publish puts the words
// on the record:
//   version  a written version of the passage (a team that writes, or "Write it instead")
//   make     what a making step makes from a version: written down, a written back translation, a translation,
//            or words added to the version (it then holds the recording and its words; changing them starts from the words it has)
//   final    a step whose result is the passage's next version, in writing
// What is typed is kept on this phone until Publish (like a back
// translation's parts, decision 30), so nothing half written reaches the
// grow-only record.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addedTo, commands, versesInChapter, writtenCards,
  type EventSpec, type KindDef, type MakesSpec, type Version
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View, type NativeSyntheticEvent, type TextInputSelectionChangeEventData } from 'react-native';
import { Text } from '../text';
import type { Ctx } from '../ctx';
import { HelpClip } from '../helpBadge';
import { t } from '../i18n';
import { indexesFor } from '../indexes';
import { Field, Header, Ico, PrimaryBtn, Screen, Sheet, SmallBtn, txt } from '../kit';
import { versionTitle, type PassageView } from '../passageView';
import { SplitPane } from '../recording/SplitPane';
import { MIN_BOTTOM } from '../recording/splitModel';
import { failureMessage, reportError } from '../report';
import { RefChips, type ChipItem } from '../simple/parts';
import { BiblePane, NotesPane, useBible } from '../simple/reference';
import { passageVerseKeys, verseName } from '../simple/verseModel';
import { catalogVerses } from '../sources/model';
import { useUsage } from '../sources/used';
import { languageLabel } from '../simple/adminModel';
import { C, radius, space, target, TINT } from '../theme';
import {
  boxesChanged, boxesFor, heardByVerse, isPartKey, teamLetters, writingSpecs, writtenByVerse, type MakingSource, type VerseText
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
  const bible = useBible(ctx, unitId, languageId, { usage });
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
  const draftKey = `writing:v1:${ctx.language.orgId}:${languageId}:${me}:${unitId}:${mode.kind === 'version' ? 'version' : mode.step.id}`
    + (mode.kind === 'make' && mode.added && mode.source.kind === 'version' ? `:${mode.source.version.takeId}` : '');
  const [boxes, setBoxes] = useState<VerseText[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(draftKey).then((raw) => {
      if (!live) return;
      const saved = raw ? (JSON.parse(raw) as { boxes?: VerseText[] }).boxes : undefined;
      if (saved?.length) setBoxes(saved);
      setLoaded(true);
    }, (e: unknown) => { reportError('writing: read draft', e); if (live) setLoaded(true); });
    return () => { live = false; };
  }, [draftKey]);
  const shown = useMemo(() => {
    const base = boxesFor(verseKeys, start);
    if (!boxes) return base;
    // Keep what was typed for each verse; verses the passage has now that the draft lacks start from `start`.
    return verseKeys.length > 0 ? base.map((b) => boxes.find((x) => x.key === b.key) ?? b) : boxes;
  }, [boxes, verseKeys, start]);
  const write = (next: VerseText[]) => {
    setBoxes(next);
    const keep = boxesChanged(next, start);
    (keep ? AsyncStorage.setItem(draftKey, JSON.stringify({ boxes: next, at: Date.now() })) : AsyncStorage.removeItem(draftKey))
      .catch((e: unknown) => reportError('writing: save draft', e));
  };
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
  const chipIds: Chip[] = [...(source ? ['source' as const] : []), ...(bible.hasVerses ? ['bible' as const] : []), 'notes'];
  const [chipState, setChip] = useState<Chip>(source ? 'source' : 'bible');
  const chip = chipIds.includes(chipState) ? chipState : chipIds[0]!;
  const sourceTitle = !source ? '' : source.kind === 'version' ? versionTitle(source.version.n)
    : source.made.kindId ? v.kind(source.made.kindId).name : t('writing.madeThing');
  const chips: ChipItem<Chip>[] = chipIds.map((c) => ({
    source: { id: 'source' as const, label: sourceTitle, icon: (source && (source.kind === 'version' ? source.version.medium : source.made.medium) === 'writing' ? 'edit' : 'mic') as 'edit' | 'mic', hint: t('writing.sourceHint') },
    bible: { id: 'bible' as const, label: t('translate.chips.bible'), icon: 'listen' as const, hint: t('translate.chips.bibleHint') },
    notes: { id: 'notes' as const, label: t('translate.chips.notes'), icon: 'chat' as const, count: p.notes.length, hint: t('translate.chips.notesHint') }
  })[c]);
  const [verse, setVerse] = useState<string | null>(null);
  const focusKey = focus !== null ? shown[focus]?.key ?? null : null;

  // ---- publishing ----
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const nextN = p.versions.length + 1;
  const needsNote = mode.kind === 'version' && !!latest;
  async function publish() {
    const commandId = Crypto.randomUUID();
    let specs: EventSpec[];
    try {
      const w = writingSpecs(state, idx, { commandId, unitId, boxes: shown, verseKeys });
      const cmd = commands(state, idx);
      if (mode.kind === 'version') {
        specs = [...w.specs, ...cmd.publishVersion({ commandId, unitId, cardHashes: w.ids, actorId: me, parentTakeId: latest?.takeId ?? null, ...(note.trim() ? { note: note.trim() } : {}) })];
      } else if (mode.kind === 'final') {
        specs = [...w.specs, ...cmd.makeVersion({ commandId, unitId, kindId: mode.step.id, fromTakeId: mode.source.takeId, cardHashes: w.ids, actorId: me, ...(mode.requestId ? { requestId: mode.requestId } : {}) })];
      } else {
        const from = mode.source.kind === 'version' ? { fromTakeId: mode.source.version.takeId } : { fromMadeId: mode.source.made.id };
        specs = [...w.specs, ...cmd.make({ commandId, unitId, kindId: mode.step.id, ...from, parts: writtenCards(w.ids),
          ...(mode.language ? { language: mode.language } : {}), ...(mode.added ? { added: true } : {}), ...(mode.requestId ? { requestId: mode.requestId } : {}) })];
      }
    } catch (e) {
      ctx.toast(t('writing.notPublished', { reason: failureMessage('writing: publish', e) }));
      return;
    }
    setBusy(true);
    try {
      await ctx.act(specs, mode.kind === 'version' ? t('writing.versionPublished', { version: versionTitle(nextN) }) : t('writing.madePublished', { what: mode.step.name }));
    } catch { setBusy(false); return; }
    await AsyncStorage.removeItem(draftKey).catch((e: unknown) => reportError('writing: clear draft', e));
    setBusy(false);
    setConfirming(false);
    // A new version is published, then asked about (demo ADR-034); what a step made goes back to the record.
    ctx.go('passage_record', mode.kind === 'make' ? { unitId, languageId } : { unitId, languageId, published: `w:${Date.now()}` });
  }

  const sub = mode.kind === 'version' ? t('writing.writingVersion', { version: versionTitle(nextN) })
    : mode.kind === 'make' && mode.language ? t('writing.stepInto', { step: mode.step.name, language: languageLabel(mode.language) })
    : mode.step.name;
  const save = () => {
    if (changed) ctx.toast(t('writing.savedOnPhone'));
    ctx.back();
  };
  const typing = focus !== null;

  return (
    <Screen fixed
      header={<Header title={v.title} sub={sub} onBack={ctx.back} close action={<SmallBtn label={t('common.save')} icon="check" onPress={save} />} />}
      footer={typing ? (
        letters.length > 0 ? <LetterStrip letters={letters} onLetter={insert} /> : null
      ) : (
        <View style={styles.saveBar}>
          <View style={styles.saved}>
            <Ico name="check" size={16} color={TINT.greenText} />
            <Text style={txt.smMuted}>{changed ? t('writing.savedOnPhone') : t('writing.nothingYet')}</Text>
          </View>
          <View style={{ flex: 1, maxWidth: 200 }}>
            <PrimaryBtn label={t('common.publish')} icon="send" disabled={!loaded || !changed || filled === 0} onPress={() => setConfirming(true)} />
          </View>
        </View>
      )}>
      <SplitPane memoryKey="writing" minBottom={MIN_BOTTOM} topStyle={styles.refPane} bottomStyle={styles.writePane}
        top={({ compact, open }) => compact ? (
          <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={t('writing.openReference')} style={({ pressed }) => [styles.bar, pressed && { opacity: 0.7 }]}>
            <Ico name={source ? 'listen' : 'book'} size={18} color={C.primary} />
            <Text style={[txt.sm, { flex: 1, fontWeight: '700' }]} numberOfLines={1}>{source ? sourceTitle : t('translate.dragDown')}</Text>
          </Pressable>
        ) : (
          <View style={{ flex: 1 }}>
            <RefChips items={chips} value={chip} onChange={setChip} />
            <HelpClip style={{ flex: 1 }}>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.paneBody} keyboardShouldPersistTaps="handled">
                {chip === 'source' && source ? (
                  <SourcePane ctx={ctx} v={v} source={source} verseKeys={verseKeys} lit={focusKey} />
                ) : chip === 'bible' ? (
                  <BiblePane ctx={ctx} v={v} bible={bible} canNote selected={verse ?? focusKey} onSelect={setVerse} />
                ) : (
                  <NotesPane ctx={ctx} v={v} notes={p.notes.filter((n) => n.anchor.kind !== 'study')} />
                )}
              </ScrollView>
            </HelpClip>
          </View>
        )}
        bottom={(
          <HelpClip style={{ flex: 1 }}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.writeBody} keyboardShouldPersistTaps="handled" accessibilityLabel={t('writing.yourWriting')}>
              {shown.map((b, i) => (
                <View key={b.key} style={styles.verseRow}>
                  <VerseTile label={isPartKey(b.key) ? String(i + 1) : verseName(verseKeys, verseKeys.indexOf(b.key))} empty={!b.text.trim()} />
                  {/* No spell check or autocorrect: a phone's dictionary would "fix" the language into another one. */}
                  <TextInput value={b.text} multiline spellCheck={false} autoCorrect={false} onChangeText={(x) => setText(i, x)}
                    onFocus={() => setFocus(i)} onBlur={() => setFocus((f) => (f === i ? null : f))}
                    onSelectionChange={(e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => selections.current.set(i, e.nativeEvent.selection)}
                    onContentSizeChange={(e) => { const h = Math.ceil(e.nativeEvent.contentSize.height); setHeights((cur) => (cur[b.key] === h ? cur : { ...cur, [b.key]: h })); }}
                    placeholder={t('writing.tapToWrite')} placeholderTextColor={C.faint}
                    accessibilityLabel={isPartKey(b.key) ? t('writing.partBox', { n: i + 1 }) : t('writing.verseBox', { verse: verseName(verseKeys, verseKeys.indexOf(b.key)) })}
                    style={[styles.box, heights[b.key] ? { height: Math.max(target.min, heights[b.key]! + 2) } : null, focus === i && styles.boxOn, !b.text.trim() && focus !== i && styles.boxEmpty]} />
                </View>
              ))}
              {verseKeys.length === 0 ? <SmallBtn label={t('writing.addPart')} icon="plus" onPress={addPart} /> : null}
            </ScrollView>
          </HelpClip>
        )} />
      {confirming ? (
        <Sheet visible title={mode.kind === 'version' ? t('writing.publishVersion', { version: versionTitle(nextN) }) : t('writing.publishMade', { what: mode.step.name })}
          sub={t('writing.publishSub', { count: filled })} onClose={() => setConfirming(false)}
          footer={<PrimaryBtn label={t('common.publish')} icon="send" busy={busy} disabled={needsNote && !note.trim()} onPress={() => void publish()} />}>
          {needsNote ? <Field label={t('writing.whatChanged')} value={note} onChangeText={setNote} placeholder={t('writing.whatChangedHint')} multiline /> : null}
          <Text style={txt.smMuted}>{mode.kind === 'version' ? t('writing.publishVersionBody') : t('writing.publishMadeBody')}</Text>
        </Sheet>
      ) : null}
    </Screen>
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
          <View key={w.key} style={[styles.readRow, lit === w.key && styles.readRowLit]}>
            <VerseTile label={isPartKey(w.key) ? String(i + 1) : verseName(verseKeys, verseKeys.indexOf(w.key))} />
            <Text style={[txt.body, { flex: 1 }]}>{w.text}</Text>
          </View>
        ))}
      </View>
    );
  }
  const heard = heardByVerse(v.state, v.unitId, parts, verseKeys);
  return (
    <View style={{ gap: space.sm }}>
      {heard.map((h, i) => (
        <VersePlayRow key={h.key} ctx={ctx} hashes={h.hashes} lit={lit === h.key}
          label={isPartKey(h.key) ? String(i + 1) : verseName(verseKeys, verseKeys.indexOf(h.key))} />
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
function LetterStrip({ letters, onLetter }: { letters: string[]; onLetter: (l: string) => void }) {
  return (
    <View style={styles.strip} accessibilityLabel={t('writing.letters')}>
      {letters.map((l) => (
        <Pressable key={l} onPress={() => onLetter(l)} accessibilityRole="button" accessibilityLabel={t('writing.addLetter', { letter: l })}
          style={({ pressed }) => [styles.letter, pressed && { opacity: 0.6 }]}>
          <Text style={styles.letterText}>{l}</Text>
        </Pressable>
      ))}
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
  saveBar: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  saved: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.xs },
  strip: { flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' },
  letter: { minWidth: target.min, height: target.min, borderRadius: radius.md, borderWidth: 1.5, borderColor: C.primary, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm },
  letterText: { fontSize: 22, fontWeight: '700', color: C.primary }
});
