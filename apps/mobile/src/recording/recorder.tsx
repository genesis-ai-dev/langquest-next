// The recorder half of the recording workspace (decision 71; demo ADR-036;
// demo simple/translator.tsx SegCard, RecordButton, Workspace): the parts
// recorded so far under one card with a green check, open at every size
// unless closed, so leaving the red view shows the parts just said (Caleb,
// 2026-10-16; opened again when the pane is small, it takes the room it
// needs), the next part lit, the one-line bar when the
// reference has the screen, and the footer with the big red button and
// Done. Every part has its own delete, and the card one for them all.
// A deleted part leaves the lit next part in its place, so what is said
// next goes there (LAN-83). When the passage has verses, each part in the
// card has a space beside it to tap a verse in (verseParts.tsx, decisions.md 82).
// Each part has a grip to drag it up or down, a mark on the line above it
// opens a place there to record into, and the parts just recorded are
// shaded until the next recording (Caleb, 2026-10-16).
import { useState, type ReactNode } from 'react';
import type { PartMark as VerseMark } from '@langquest-next/core';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { HelpInfo, Ico, IconBtn } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { loopRecording, type LoopPhase } from './splitModel';
import { C, radius, space, target as target_, TINT, type as T, withAlpha } from '../ui/theme';
import { useEnergyHistory } from './useRecorder';
import { mmss, partLabel, recorderLines, totalMs } from './model';
import type { RecordTarget, SlotRow } from './workspaceModel';
import { ChosenMic, GapSlot, InsertMark, PartGrip, RAIL } from './slots';
import { UndoRedo, type UndoRedoProps } from '../ui/undoRedo';
import { opensAbove, rowKeys } from './workspaceModel';
import { partIndexAfter } from './dragModel';
import { useDragRows } from './useDragRows';
import { lift } from '../ui/shadow';
import { PartMark, RecordBtn } from './blocks';
import { styles as ps } from './blockStyles';
import { useClip } from '../audio/useClip';
import { VerseParts } from './verseParts';

export interface Part { hash: string; durationMs?: number }

/** The recorder pane: the parts and their gaps, where the next part goes, and the next part at the end. */
export function RecorderPane(props: {
  ctx: Ctx; parts: Part[]; phase: LoopPhase; capturing: boolean; small: boolean; disabled: boolean;
  onDelete: (hash: string, label: string) => void; onResume: () => void;
  /** The card's title when it is not "Parts 1–n": the version the parts are, while nothing changed. */
  title?: string;
  /** Delete every part, to start over (asks first). */
  onDeleteAll?: () => void;
  /** Give the recorder the room to show its parts (the card opened while the pane is small). */
  onRoom?: () => void;
  /** The card's rows (parts and gaps) and where the next part goes (LAN-83). */
  rows: SlotRow[]; target: RecordTarget; onChoose: (to: RecordTarget) => void;
  /** The passage's verses and each part's mark: given, each part has a space for its verse. */
  verses?: { keys: string[]; marks: VerseMark[]; onMarks: (marks: VerseMark[], message: string) => void };
  /** Move the part at `from` so it sits at `to` in the list. */
  onMove: (from: number, to: number) => void;
  /** The parts just recorded, shaded until the next recording. */
  fresh: ReadonlySet<string>;
  /** A part to bring into view (what an Undo or Redo changed), and when it was asked. */
  show?: { hash: string; at: number } | null;
}) {
  const { parts, rows } = props;
  const lines = recorderLines(parts.length);
  const [open, setOpen] = useState<boolean | null>(null);
  // Open unless the person closed it, whatever the pane's size: leaving the red view shows the parts just said.
  const expanded = open ?? true;
  const toggle = () => {
    if (!expanded && props.small) props.onRoom?.();
    setOpen(!expanded);
  };
  const endN = rows.length + 1;
  const atEnd = props.target.kind === 'end';
  return (
    <View style={{ gap: space.sm }}>
      {parts.length > 0 ? (
        <GroupCard
          body={props.verses && props.verses.keys.length > 0 ? (
            <VerseParts ctx={props.ctx} parts={parts} verses={props.verses.keys} marks={props.verses.marks} disabled={props.disabled}
              onMarks={props.verses.onMarks} onDelete={props.onDelete} rows={rows} target={props.target} onChoose={props.onChoose} onMove={props.onMove} fresh={props.fresh} show={props.show ?? null} />
          ) : undefined} ctx={props.ctx} parts={parts} title={props.title ?? recorderLines(rows.length).group} sub={lines.groupSub(totalMs(parts.map((p) => p.durationMs)))}
          open={expanded} onToggle={toggle} disabled={props.disabled} onDelete={props.onDelete} rows={rows} target={props.target} onChoose={props.onChoose}
          onMove={props.onMove} fresh={props.fresh} show={props.show ?? null}
          {...(props.onDeleteAll ? { onDeleteAll: props.onDeleteAll } : {})} />
      ) : null}
      <NextCard label={partLabel(endN - 1)} chosen={atEnd} disabled={props.disabled} onChoose={() => props.onChoose({ kind: 'end' })}
        phase={props.phase} capturing={props.capturing} onResume={props.onResume} />
    </View>
  );
}

function GroupCard(props: { ctx: Ctx; parts: Part[]; title: string; sub: string; open: boolean; onToggle: () => void; disabled: boolean; onDelete: (hash: string, label: string) => void;
  onDeleteAll?: () => void;
  rows: SlotRow[]; target: RecordTarget; onChoose: (to: RecordTarget) => void;
  onMove: (from: number, to: number) => void; fresh: ReadonlySet<string>; show: { hash: string; at: number } | null;
  /** The parts with their verse spaces, in place of the plain rows. */
  body?: ReactNode }) {
  const clip = useClip(props.ctx.language, props.parts.map((p) => p.hash), { disabled: props.disabled });
  const toggle = useHelpSpot(props.title, props.open ? t('recording.recorder.hidePartsHelp') : t('recording.recorder.showPartsHelp'), props.onToggle);
  const playLabel = clip.playing ? t('common.pause') : t('recording.player.playTitle', { title: props.title });
  const play = useHelpSpot(playLabel, t('recording.recorder.playAllHelp'), clip.toggle);
  const onDeleteAll = props.onDeleteAll;
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <PartMark state="done" />
        <Pressable onPress={toggle.onPress} accessibilityRole="button" accessibilityState={{ expanded: props.open }} accessibilityLabel={t('recording.recorder.groupLabel', { title: props.title, sub: props.sub })}
          style={({ pressed }) => [{ flex: 1, minHeight: target_.min, justifyContent: 'center' }, pressed && ps.pressed]}>
          <Text style={styles.title}>{props.title}</Text>
          <Text style={txt.smMuted}>{props.sub}</Text>
          <HelpBadge spot={toggle} />
        </Pressable>
        <Pressable onPress={play.onPress} disabled={!clip.available || props.disabled} accessibilityRole="button" accessibilityLabel={playLabel}
          style={({ pressed }) => [styles.iconTap, (!clip.available || props.disabled) && ps.off, pressed && ps.pressed]}>
          <Ico name={clip.playing ? 'pause' : 'play'} size={22} color={C.primary} strokeWidth={2.6} fill={C.primary} />
          <HelpBadge spot={play} />
        </Pressable>
        {onDeleteAll ? (
          <IconBtn name="trash" label={t('recording.recorder.deleteAll')} help={t('recording.recorder.deleteAllHelp')} bg="transparent" color={C.muted} size={target_.min} disabled={props.disabled} onPress={onDeleteAll} />
        ) : null}
        <Pressable onPress={toggle.onPress} accessibilityRole="button" accessibilityLabel={props.open ? t('recording.recorder.hideParts') : t('recording.recorder.showParts')} style={({ pressed }) => [styles.iconTap, pressed && ps.pressed]}>
          <Ico name={props.open ? 'down' : 'right'} size={22} color={C.muted} />
          <HelpBadge spot={toggle} />
        </Pressable>
      </View>
      {props.open && props.body ? <View style={styles.versePart}>{props.body}</View> : props.open ? (
        <PlainParts {...props} />
      ) : null}
      {clip.error ? <Text style={[txt.error, { paddingHorizontal: space.md, paddingBottom: space.sm }]}>{clip.error}</Text> : null}
    </View>
  );
}

/** The parts without verses: each with its grip, play, name and bin, and the marks between them. */
function PlainParts(props: { ctx: Ctx; parts: Part[]; disabled: boolean; onDelete: (hash: string, label: string) => void;
  rows: SlotRow[]; target: RecordTarget; onChoose: (to: RecordTarget) => void; onMove: (from: number, to: number) => void; fresh: ReadonlySet<string>;
  show: { hash: string; at: number } | null }) {
  const { rows, target, parts } = props;
  const keys = rowKeys(rows, parts.map((p) => p.hash));
  const drag = useDragRows(keys, !props.disabled, (from, to) => {
    const r = rows[from];
    if (r?.kind !== 'part') return;
    const at = partIndexAfter(rows.map((x) => x.kind === 'part'), from, to);
    if (at !== r.index) props.onMove(r.index, at);
  }, props.show ? { key: `part:${props.show.hash}`, at: props.show.at } : null);
  return (
    <View style={styles.parts}>
      {rows.map((r, k) => {
        const key = keys[k]!;
        const moved = drag.offset(key);
        const lifted = drag.dragging === key;
        const name = partLabel(r.n - 1);
        const mark = !props.disabled && !drag.dragging && opensAbove(rows, k)
          ? <HelpRow key={`mark-${key}`} of="recording.insert"><InsertMark n={r.n} before={name} onPress={() => props.onChoose({ kind: 'gap', before: r.kind === 'part' ? r.index : r.before })} /></HelpRow> : null;
        const row = r.kind === 'gap' ? (
          <GapSlot n={r.n} gutter={false} grip first={k === 0} disabled={props.disabled}
            chosen={target.kind === 'gap' && target.before === r.before} onPress={() => props.onChoose({ kind: 'gap', before: r.before })} />
        ) : (
          <PartRow ctx={props.ctx} part={parts[r.index]!} n={r.n} disabled={props.disabled} onDelete={props.onDelete}
            fresh={props.fresh.has(parts[r.index]!.hash)} lifted={lifted}
            grip={<PartGrip part={name} handlers={drag.grip(key)} disabled={props.disabled} canUp={r.index > 0} canDown={r.index < parts.length - 1} at={r.index + 1} of={parts.length}
              onStep={(by) => props.onMove(r.index, r.index + by)} />}
            chosen={target.kind === 'over' && target.index === r.index} onChoose={() => props.onChoose({ kind: 'over', index: r.index })} />
        );
        return [
          mark,
          <HelpRow key={key} of={r.kind === 'gap' ? 'recording.gap' : 'recording.part'}>
            <View ref={drag.ref(key)} onLayout={drag.onLayout(key)} style={[moved !== 0 && { transform: [{ translateY: moved }] }, lifted && { zIndex: 10 }]}>{row}</View>
          </HelpRow>
        ];
      })}
    </View>
  );
}

function PartRow(props: { ctx: Ctx; part: Part; n: number; disabled: boolean; chosen: boolean; onChoose: () => void; onDelete: (hash: string, label: string) => void;
  fresh: boolean; lifted: boolean; grip: ReactNode }) {
  const label = partLabel(props.n - 1);
  const clip = useClip(props.ctx.language, [props.part.hash], { disabled: props.disabled });
  const playLabel = clip.playing ? t('recording.recorder.pausePart', { part: label }) : t('recording.player.playTitle', { title: label });
  const play = useHelpSpot(clip.playing ? t('common.pause') : t('recording.player.playTitle', { title: label }), undefined, clip.toggle);
  const choose = useHelpSpot(t('recording.recorder.recordOver', { part: label }), t('recording.recorder.recordOverHelp'), props.onChoose);
  return (
    <View style={[styles.partRow, props.fresh && styles.fresh, props.chosen && styles.chosenRow, props.lifted && styles.liftedRow]}>
      <View style={{ width: RAIL }} />
      {props.grip}
      <Pressable onPress={play.onPress} disabled={!clip.available || props.disabled} accessibilityRole="button" accessibilityLabel={playLabel}
        style={({ pressed }) => [styles.iconTap, (!clip.available || props.disabled) && ps.off, pressed && ps.pressed]}>
        <Ico name={clip.playing ? 'pause' : 'play'} size={16} color={C.primary} strokeWidth={2.6} fill={C.primary} />
        <HelpBadge spot={play} />
      </Pressable>
      <Pressable onPress={choose.onPress} disabled={props.disabled} accessibilityRole="button" accessibilityState={{ selected: props.chosen }}
        accessibilityLabel={t('recording.recorder.recordOver', { part: label })}
        style={({ pressed }) => [styles.partPlay, pressed && ps.pressed]}>
        <Text style={[txt.body, { color: props.chosen ? C.dark : C.muted, flex: 1 }]}>{t('recording.recorder.partLength', { part: label, length: mmss(props.part.durationMs) })}</Text>
        {props.chosen ? <ChosenMic /> : null}
        <HelpBadge spot={choose} />
      </Pressable>
      <IconBtn name="trash" label={t('recording.deleteItem', { item: label })} help={t('recording.recorder.deletePartHelp')} bg="transparent" color={C.muted} size={40} disabled={props.disabled} onPress={() => props.onDelete(props.part.hash, label)} />
    </View>
  );
}

/**
 * The part to record at the end. Lit (a-wsHalf) when the next part goes
 * there; while recording it is the live part, red. When a gap or a part
 * is chosen instead, it is quiet and dashed, and a tap chooses it again.
 */
function NextCard(props: { label: string; chosen: boolean; disabled: boolean; onChoose: () => void; phase: LoopPhase; capturing: boolean; onResume: () => void }) {
  const recording = props.phase === 'recording';
  const listening = props.phase === 'listening';
  const resume = useHelpSpot(t('recording.resumeNow'), t('recording.recorder.resumeHelp'), props.onResume);
  const choose = useHelpSpot(t('recording.recorder.recordAtEnd', { part: props.label }), t('recording.recorder.endHelp'), props.onChoose);
  if (!props.chosen && !recording && !listening) {
    return (
      <Pressable onPress={choose.onPress} disabled={props.disabled} accessibilityRole="button" accessibilityLabel={t('recording.recorder.recordAtEnd', { part: props.label })}
        style={({ pressed }) => [styles.next, styles.nextQuiet, pressed && ps.pressed]}>
        <View style={styles.quietMic}><Ico name="mic" size={16} color={C.muted} /></View>
        <Text style={[styles.title, { color: C.muted, flex: 1 }]}>{props.label}</Text>
        <HelpBadge spot={choose} />
      </Pressable>
    );
  }
  // While help is on, the card says what its mark, border and level bars mean.
  return (
    <HelpInfo label={props.label} detail={recording ? t('recording.recorder.nextRecordingHelp') : listening ? t('recording.recorder.nextPausedHelp') : t('recording.recorder.nextCardHelp')}>
    <View style={[styles.next, recording && { borderColor: C.red }, listening && { borderColor: TINT.amberText }]}
      accessibilityLiveRegion="polite" accessible={!listening}
      accessibilityLabel={t('recording.recorder.nextLabel', { part: props.label, status: recording ? (props.capturing ? t('recording.loop.capturing') : t('recording.recorder.listeningForYou')) : listening ? t('recording.recorder.pausedForBible') : t('recording.recorder.recordingNext') })}>
      <PartMark state={recording ? 'recording' : 'next'} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.title}>{props.label}</Text>
        <Text style={[txt.smMuted, recording && { color: TINT.redText }]}>
          {recording ? (props.capturing ? t('recording.recorder.recordingNow') : t('recording.recorder.listeningPause')) : listening ? t('recording.recorder.pausedForBible') : t('recording.recorder.recordingNext')}
        </Text>
      </View>
      {recording ? <Meter captured={props.capturing} /> : null}
      {listening ? (
        <Pressable onPress={resume.onPress} accessibilityRole="button" accessibilityLabel={t('recording.resumeRecordingNow')} style={({ pressed }) => [styles.resume, pressed && ps.pressed]}>
          <Ico name="mic" size={16} color={C.white} />
          <Text style={[txt.sm, { color: C.white, fontWeight: '700' }]}>{t('recording.recorder.resume')}</Text>
          <HelpBadge spot={resume} />
        </Pressable>
      ) : null}
    </View>
    </HelpInfo>
  );
}

/** A small live level meter: the only part that re-renders with the microphone. */
function Meter(props: { captured: boolean }) {
  const history = useEnergyHistory(props.captured, 16);
  return (
    <View style={styles.meter} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {history.map((b, i) => (
        <View key={i} style={[styles.meterBar, { opacity: b.captured ? 1 : 0.35, height: `${Math.max(8, Math.pow(Math.min(1, Math.max(0, b.energy)), b.captured ? 0.6 : 2) * 100)}%` }]} />
      ))}
    </View>
  );
}

/** What help mode says the recording screen's Undo and Redo do. */
const recordingHelp = () => ({ undo: t('recording.recorder.undoHelp'), redo: t('common.redoHelp') });

/** The recorder at one line (a-wsGuide): what is next, how far along, Undo and Redo, and the record button. */
export function RecorderBar(props: { count: number; phase: LoopPhase; disabled: boolean; onRecord: () => void; onOpen: () => void; nextIndex?: number; undo?: UndoRedoProps }) {
  const lines = { ...recorderLines(props.count), ...(props.nextIndex !== undefined ? { next: partLabel(props.nextIndex) } : {}) };
  const open = useHelpSpot(t('recording.recorder.yourRecording'), t('recording.recorder.openHelp'), props.onOpen);
  const recording = loopRecording(props.phase);
  return (
    <View style={styles.bar}>
      <Pressable onPress={open.onPress} accessibilityRole="button" accessibilityLabel={t('recording.recorder.barLabel', { next: lines.next, progress: lines.bar })} style={({ pressed }) => [{ flex: 1 }, pressed && ps.pressed]}>
        <Text style={styles.title}>{lines.next}</Text>
        <Text style={[txt.smMuted, recording && { color: TINT.redText }]}>{props.phase === 'recording' ? t('recording.recorder.recordingNow') : props.phase === 'listening' ? t('recording.recorder.pausedForBible') : lines.bar}</Text>
        <HelpBadge spot={open} />
      </Pressable>
      {props.undo ? <UndoRedo {...props.undo} hidden={props.phase !== 'off'} help={recordingHelp()} /> : null}
      <RecordBtn size={56} recording={recording} disabled={props.disabled} onPress={props.onRecord} />
    </View>
  );
}

/**
 * The footer (a-wsHalf): Undo and Redo, the big red button, and Done beside it (decision 127; it was Publish).
 * While recording, Done is the recording view's check, so the footer has none, as in back translation.
 */
export function RecorderFooter(props: { count: number; phase: LoopPhase; recordDisabled: boolean; publishDisabled: boolean; onRecord: () => void; onPublish: () => void; nextIndex?: number;
  undo: UndoRedoProps }) {
  const recording = loopRecording(props.phase);
  // A session open but stopped (decision 129) still has the recording view's Done.
  const session = props.phase !== 'off';
  const publish = useHelpSpot(t('common.done'), t('recording.recorder.doneHelp'), props.onPublish);
  return (
    <View style={styles.footer}>
      <View style={[styles.sideBox, { alignItems: 'flex-end' }]}>
        <UndoRedo {...props.undo} hidden={session} help={recordingHelp()} />
      </View>
      <RecordBtn size={72} recording={recording} disabled={props.recordDisabled} onPress={props.onRecord} />
      <View style={styles.sideBox}>
        {session ? null : (
          <Pressable testID="publish-button" onPress={publish.onPress} disabled={props.publishDisabled} accessibilityRole="button" accessibilityLabel={t('common.done')} accessibilityState={{ disabled: props.publishDisabled }}
            style={({ pressed }) => [styles.publish, props.publishDisabled && { opacity: 0.45 }, pressed && ps.pressed]}>
            <Text style={styles.publishLabel}>{t('common.done')}</Text>
            <HelpBadge spot={publish} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: radius.lg, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm + 2, minHeight: 56, paddingLeft: space.md, paddingRight: space.xs },
  title: { fontSize: T.base, fontWeight: '800', color: C.dark },
  iconTap: { width: target_.min, height: target_.min, alignItems: 'center', justifyContent: 'center' },
  parts: { borderTopWidth: 1, borderColor: C.border, paddingLeft: space.xs, paddingRight: space.xs, paddingVertical: space.xs },
  versePart: { borderTopWidth: 1, borderColor: C.border },
  partRow: { flexDirection: 'row', alignItems: 'center' },
  partPlay: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: target_.min },
  next: { flexDirection: 'row', alignItems: 'center', gap: space.sm + 2, minHeight: 56, paddingHorizontal: space.md, borderRadius: radius.lg, borderWidth: 2, borderColor: C.primary, backgroundColor: C.card },
  // The end, when the next part goes somewhere else: quiet and dashed, a tap away.
  nextQuiet: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.border, backgroundColor: 'transparent' },
  quietMic: { width: 36, height: 36, borderRadius: radius.full, borderWidth: 2, borderStyle: 'dashed', borderColor: C.faint, alignItems: 'center', justifyContent: 'center' },
  chosenRow: { backgroundColor: C.light, borderRadius: radius.md },
  // Just recorded (Caleb, 2026-10-16): the red view's colour, faintly, until the next recording.
  fresh: { backgroundColor: withAlpha(C.red, 0.06), borderRadius: radius.md },
  liftedRow: { backgroundColor: C.card, borderRadius: radius.md, ...lift({ opacity: 0.18, radius: 12, y: 4, elevation: 6 }) },
  meter: { width: 64, height: 28, flexDirection: 'row', alignItems: 'center', gap: 2 },
  meterBar: { flex: 1, borderRadius: 2, backgroundColor: C.red },
  resume: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.full, backgroundColor: TINT.amberText },
  bar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, backgroundColor: C.card, borderTopWidth: 1, borderColor: C.border },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.lg },
  sideBox: { width: 96 },
  publish: { minHeight: target_.min, borderRadius: radius.md + 2, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm },
  publishLabel: { fontSize: T.base, fontWeight: '800', color: C.primary }
});
