// The recorder half of the recording workspace (decision 71; demo ADR-036;
// demo simple/translator.tsx SegCard, RecordButton, Workspace): the parts
// recorded so far under one card with a green check (open it to hear or
// delete each), the next part lit, the line that says how many are done
// when the pane is small, the one-line bar when the reference has the
// screen, and the footer with the big red button and Publish. When the
// passage has verses, each part in the card has a space beside it to tap a
// verse in (verseParts.tsx, decisions.md 81).
import { useState, type ReactNode } from 'react';
import type { PartMark as VerseMark } from '@langquest-next/core';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Ctx } from '../ctx';
import { useHelpPress } from '../helpContext';
import { Ico, IconBtn, txt } from '../kit';
import type { LoopPhase } from '../recording/splitModel';
import { C, radius, space, target, TINT, type as T } from '../theme';
import { useEnergyHistory } from '../useRecorder';
import { mmss, recorderLines, totalMs } from './model';
import { PartMark, RecordBtn, styles as ps } from './parts';
import { useClip } from './useClip';
import { VerseParts } from './verseParts';

export interface Part { hash: string; durationMs?: number }

/** The recorder pane: the recorded parts, the next one, and the hint line. */
export function RecorderPane(props: {
  ctx: Ctx; parts: Part[]; phase: LoopPhase; capturing: boolean; small: boolean; disabled: boolean;
  onDelete: (hash: string, label: string) => void; onResume: () => void;
  /** The passage's verses and each part's mark: given, the parts are grouped by verse. */
  verses?: { keys: string[]; marks: VerseMark[]; onMarks: (marks: VerseMark[], message: string) => void; onRecordHere: (beforeIndex: number) => void };
}) {
  const { parts } = props;
  const lines = recorderLines(parts.length);
  const [open, setOpen] = useState<boolean | null>(null);
  // Opened by the person, or open by itself once the pane has room.
  const expanded = open ?? !props.small;
  const showGroup = parts.length > 0 && !props.small;
  return (
    <View style={{ gap: space.sm }}>
      {showGroup ? (
        <GroupCard
          body={props.verses && props.verses.keys.length > 0 ? (
            <VerseParts ctx={props.ctx} parts={parts} verses={props.verses.keys} marks={props.verses.marks} disabled={props.disabled}
              onMarks={props.verses.onMarks} onDelete={props.onDelete} onRecordHere={props.verses.onRecordHere} />
          ) : undefined} ctx={props.ctx} parts={parts} title={lines.group} sub={lines.groupSub(totalMs(parts.map((p) => p.durationMs)))}
          open={expanded} onToggle={() => setOpen(!expanded)} disabled={props.disabled} onDelete={props.onDelete} />
      ) : null}
      <NextCard label={lines.next} phase={props.phase} capturing={props.capturing} onResume={props.onResume} />
      {parts.length > 0 && props.small ? (
        <Text style={[txt.smMuted, { textAlign: 'center' }]}>{lines.recorded} · drag up to see them</Text>
      ) : null}
    </View>
  );
}

function GroupCard(props: { ctx: Ctx; parts: Part[]; title: string; sub: string; open: boolean; onToggle: () => void; disabled: boolean; onDelete: (hash: string, label: string) => void;
  /** The parts with their verse spaces, in place of the plain rows. */
  body?: ReactNode }) {
  const clip = useClip(props.ctx.language, props.parts.map((p) => p.hash), { disabled: props.disabled });
  const toggle = useHelpPress(props.title, props.open ? 'Hide the parts.' : 'Show each part, to hear or delete it.', props.onToggle);
  const play = useHelpPress(clip.playing ? 'Pause' : `Play ${props.title}`, 'Hear everything recorded so far, one part after another.', clip.toggle);
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <PartMark state="done" />
        <Pressable onPress={toggle} accessibilityRole="button" accessibilityState={{ expanded: props.open }} accessibilityLabel={`${props.title}, ${props.sub}`}
          style={({ pressed }) => [{ flex: 1, minHeight: target.min, justifyContent: 'center' }, pressed && ps.pressed]}>
          <Text style={styles.title}>{props.title}</Text>
          <Text style={txt.smMuted}>{props.sub}</Text>
        </Pressable>
        <Pressable onPress={play} disabled={!clip.available || props.disabled} accessibilityRole="button" accessibilityLabel={clip.playing ? 'Pause' : `Play ${props.title}`}
          style={({ pressed }) => [styles.iconTap, (!clip.available || props.disabled) && ps.off, pressed && ps.pressed]}>
          <Ico name={clip.playing ? 'pause' : 'play'} size={22} color={C.primary} strokeWidth={2.6} fill={C.primary} />
        </Pressable>
        <Pressable onPress={toggle} accessibilityRole="button" accessibilityLabel={props.open ? 'Hide the parts' : 'Show the parts'} style={({ pressed }) => [styles.iconTap, pressed && ps.pressed]}>
          <Ico name={props.open ? 'down' : 'right'} size={22} color={C.muted} />
        </Pressable>
      </View>
      {props.open && props.body ? <View style={styles.versePart}>{props.body}</View> : props.open ? (
        <View style={styles.parts}>
          {props.parts.map((p, i) => <PartRow key={`${p.hash}-${i}`} ctx={props.ctx} part={p} index={i} disabled={props.disabled} onDelete={props.onDelete} />)}
        </View>
      ) : null}
      {clip.error ? <Text style={[txt.error, { paddingHorizontal: space.md, paddingBottom: space.sm }]}>{clip.error}</Text> : null}
    </View>
  );
}

function PartRow(props: { ctx: Ctx; part: Part; index: number; disabled: boolean; onDelete: (hash: string, label: string) => void }) {
  const label = `Part ${props.index + 1}`;
  const clip = useClip(props.ctx.language, [props.part.hash], { disabled: props.disabled });
  const play = useHelpPress(clip.playing ? 'Pause' : `Play ${label}`, undefined, clip.toggle);
  return (
    <View style={styles.partRow}>
      <Pressable onPress={play} disabled={!clip.available || props.disabled} accessibilityRole="button" accessibilityLabel={`${clip.playing ? 'Pause' : 'Play'} ${label}`}
        style={({ pressed }) => [styles.partPlay, (!clip.available || props.disabled) && ps.off, pressed && ps.pressed]}>
        <Ico name={clip.playing ? 'pause' : 'play'} size={16} color={C.primary} strokeWidth={2.6} fill={C.primary} />
        <Text style={[txt.body, { color: C.muted }]}>{label} · {mmss(props.part.durationMs)}</Text>
      </Pressable>
      <IconBtn name="trash" label={`Delete ${label}`} bg="transparent" color={C.muted} size={40} disabled={props.disabled} onPress={() => props.onDelete(props.part.hash, label)} />
    </View>
  );
}

/** The part to record next, lit (a-wsHalf); while recording it is the live part, red. */
function NextCard(props: { label: string; phase: LoopPhase; capturing: boolean; onResume: () => void }) {
  const recording = props.phase === 'recording';
  const listening = props.phase === 'listening';
  const resume = useHelpPress('Resume now', 'Stop the Bible and go on recording.', props.onResume);
  return (
    <View style={[styles.next, recording && { borderColor: C.red }, listening && { borderColor: TINT.amberText }]}
      accessibilityLiveRegion="polite" accessible={!listening}
      accessibilityLabel={`${props.label}. ${recording ? (props.capturing ? 'Recording what you say' : 'Listening for you') : listening ? 'Paused while the Bible plays' : 'Recording next'}`}>
      <PartMark state={recording ? 'recording' : 'next'} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.title}>{props.label}</Text>
        <Text style={[txt.smMuted, recording && { color: TINT.redText }]}>
          {recording ? (props.capturing ? 'Recording…' : 'Listening for you · pause between parts') : listening ? 'Paused while the Bible plays' : 'Recording next'}
        </Text>
      </View>
      {recording ? <Meter captured={props.capturing} /> : null}
      {listening ? (
        <Pressable onPress={resume} accessibilityRole="button" accessibilityLabel="Resume recording now" style={({ pressed }) => [styles.resume, pressed && ps.pressed]}>
          <Ico name="mic" size={16} color={C.white} />
          <Text style={[txt.sm, { color: C.white, fontWeight: '700' }]}>Resume</Text>
        </Pressable>
      ) : null}
    </View>
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

/** The recorder at one line (a-wsGuide): what is next, how far along, and the record button. */
export function RecorderBar(props: { count: number; phase: LoopPhase; disabled: boolean; onRecord: () => void; onOpen: () => void }) {
  const lines = recorderLines(props.count);
  const open = useHelpPress('Your recording', 'Drag the divider up, or tap here, to see your parts.', props.onOpen);
  const recording = props.phase !== 'off';
  return (
    <View style={styles.bar}>
      <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`Your recording. ${lines.next}. ${lines.bar}. Open`} style={({ pressed }) => [{ flex: 1 }, pressed && ps.pressed]}>
        <Text style={styles.title}>{lines.next}</Text>
        <Text style={[txt.smMuted, recording && { color: TINT.redText }]}>{props.phase === 'recording' ? 'Recording…' : props.phase === 'listening' ? 'Paused while the Bible plays' : lines.bar}</Text>
      </Pressable>
      <RecordBtn size={56} recording={recording} disabled={props.disabled} onPress={props.onRecord} />
    </View>
  );
}

/** The footer (a-wsHalf): the part next, the big red button, and Publish beside it. */
export function RecorderFooter(props: { count: number; phase: LoopPhase; recordDisabled: boolean; publishDisabled: boolean; onRecord: () => void; onPublish: () => void }) {
  const lines = recorderLines(props.count);
  const recording = props.phase !== 'off';
  const publish = useHelpPress('Publish', 'When every part is recorded: save this version for the team.', props.onPublish);
  return (
    <View style={styles.footer}>
      <Text style={[styles.side, { textAlign: 'right', color: recording ? TINT.redText : C.muted }]} numberOfLines={2}>{recording ? `${lines.next}…` : lines.next}</Text>
      <RecordBtn size={72} recording={recording} disabled={props.recordDisabled} onPress={props.onRecord} />
      <View style={styles.sideBox}>
        <Pressable onPress={publish} disabled={props.publishDisabled} accessibilityRole="button" accessibilityLabel="Publish" accessibilityState={{ disabled: props.publishDisabled }}
          style={({ pressed }) => [styles.publish, props.publishDisabled && { opacity: 0.45 }, pressed && ps.pressed]}>
          <Text style={styles.publishLabel}>Publish</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: radius.lg, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm + 2, minHeight: 56, paddingLeft: space.md, paddingRight: space.xs },
  title: { fontSize: T.base, fontWeight: '800', color: C.dark },
  iconTap: { width: 44, height: target.min, alignItems: 'center', justifyContent: 'center' },
  parts: { borderTopWidth: 1, borderColor: C.border, paddingLeft: 50, paddingRight: space.xs, paddingVertical: space.xs },
  versePart: { borderTopWidth: 1, borderColor: C.border },
  partRow: { flexDirection: 'row', alignItems: 'center' },
  partPlay: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 40 },
  next: { flexDirection: 'row', alignItems: 'center', gap: space.sm + 2, minHeight: 56, paddingHorizontal: space.md, borderRadius: radius.lg, borderWidth: 2, borderColor: C.primary, backgroundColor: C.card },
  meter: { width: 64, height: 28, flexDirection: 'row', alignItems: 'center', gap: 2 },
  meterBar: { flex: 1, borderRadius: 2, backgroundColor: C.red },
  resume: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.full, backgroundColor: TINT.amberText },
  bar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, backgroundColor: C.card, borderTopWidth: 1, borderColor: C.border },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.lg },
  side: { width: 96, fontSize: T.sm, color: C.muted },
  sideBox: { width: 96 },
  publish: { minHeight: target.min, borderRadius: radius.md + 2, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm },
  publishLabel: { fontSize: T.base, fontWeight: '800', color: C.primary }
});
