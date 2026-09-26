import { StyleSheet } from '../theme';
// Avatar U. The recording machinery shared by the workspace and the back
// translation screen: durable recording, the full-screen VAD takeover, the
// numbered parts list, and hold-to-record for short voice notes. The VAD
// takeover below is unchanged from the retired `quest_assets` screen.
import { commands, currentTake } from '@langquest-next/core';
import { indexesFor } from '../indexes';
import * as Crypto from 'expo-crypto';
import { Check, Mic, RotateCcw, Square, Trash2 } from 'lucide-react-native';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Modal, PanResponder, Pressable, Text, View } from 'react-native';
import type { Ctx } from '../ctx';
import { AudioClip } from '../audioClip';
import { pendingPassageCards } from '../recordingFlow';
import { colors, radius, space } from '../theme';
import { ActionButton, Card, text } from '../ui';
import { useEnergyHistory, useRecorder, type RecordedCard } from '../useRecorder';

/**
 * The parts of the take being made for a passage. A part is one card (one
 * VAD segment). Parts are the current take's cards (a draft, or the last
 * version when revising, so a new version starts from the old one; cards are
 * immutable, PLAN invariant 4) followed by recorded cards not yet kept.
 * Deleting a kept part only drops it from the next take; deleting a new part
 * records the discard, so recovery never brings it back.
 * `seedFromTake` false starts from new recordings only (legacy OBT lanes).
 */
export function useRecordingParts(ctx: Ctx, unitId: string, laneId: string, seedFromTake = true) {
  const state = ctx.project.state;
  const latest = useRef(ctx);
  latest.current = ctx;
  const where = useRef({ unitId, laneId });
  where.current = { unitId, laneId };
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [removed, setRemoved] = useState<string[]>([]);
  const lock = useRef(false);
  const persist = useCallback(async (card: RecordedCard) => {
    const current = latest.current;
    const passage = where.current;
    if (!passage.unitId || !passage.laneId) throw new Error('This passage is no longer available.');
    // card.id was chosen before the first save step, so a retry or a
    // journal resume after restart finds the event already in the fold.
    const s = current.project.state;
    if (s) {
      await current.project.run(commands(s, indexesFor(s)).addRecording({
        commandId: card.id, recordingId: card.id, unitId: passage.unitId, laneId: passage.laneId,
        kind: 'target', card: { hash: card.ref.hash, durationMs: card.durationMs, format: card.ref.format === 'wav' ? 'wav' : 'm4a' }
      }));
    }
    current.project.triggerUpload();
  }, []);
  const rec = useRecorder(persist, unitId && laneId ? {
    orgId: ctx.project.orgId, projectId: ctx.project.projectId, unitId, laneId
  } : undefined);
  // `state` identity is the fold revision (useProject republishes per change).
  const actorId = ctx.session.actorId;
  const pending = useMemo(
    () => (state && unitId && laneId ? pendingPassageCards(state, unitId, laneId, actorId) : []),
    [state, unitId, laneId, actorId]
  );
  const takeId = state && unitId && laneId ? currentTake(state, unitId, laneId, indexesFor(state)) : null;
  const take = takeId ? state?.takes[takeId] : undefined;
  const base = seedFromTake ? take?.cardHashes ?? [] : [];
  const parts = [...base, ...pending.map((c) => c.hash)].filter((h) => !removed.includes(h));
  /** The parts differ from the current take: there is something to keep. */
  const changed = pending.length > 0 || base.some((h) => removed.includes(h));
  const blocked = saving || rec.busy || rec.manualOn || rec.vadOn || rec.failureCount > 0;

  async function guarded(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setSaving(true); setError('');
    try { await work(); }
    catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setSaving(false); }
  }
  /** Compose the parts into the passage's new current take. */
  async function keep(): Promise<boolean> {
    if (blocked || !parts.length || !state) return false;
    let kept = false;
    await guarded(async () => {
      await ctx.project.run(commands(state, indexesFor(state)).keepTake({
        commandId: Crypto.randomUUID(), unitId, laneId, cardHashes: parts
      }));
      setRemoved([]);
      kept = true;
    });
    return kept;
  }
  /** Drop the new parts and record again (the review row's redo). */
  async function redo() {
    if (blocked || !state) return;
    await guarded(async () => {
      // An archived draft records the deliberate discard, so recovery never
      // resurrects it. Immutable audio remains available in event history.
      if (pending.length) {
        await ctx.project.run(commands(state, indexesFor(state)).discardCards({
          commandId: Crypto.randomUUID(), unitId, laneId, cardHashes: pending.map((c) => c.hash)
        }));
      }
      setRemoved([]);
      await rec.toggleVad();
    });
  }
  async function remove(hash: string) {
    if (blocked || !state) return;
    if (pending.some((c) => c.hash === hash)) {
      await guarded(async () => {
        await ctx.project.run(commands(state, indexesFor(state)).discardCards({
          commandId: Crypto.randomUUID(), unitId, laneId, cardHashes: [hash]
        }));
      });
    } else setRemoved((r) => [...r, hash]);
  }
  return { rec, pending, parts, changed, blocked, saving, error, takeId, take, keep, redo, remove };
}

export type RecordingParts = ReturnType<typeof useRecordingParts>;

/** Numbered parts, each with play and delete. Words optional: the number is an icon-sized badge. */
export function PartsList(props: { ctx: Ctx; parts: RecordingParts; labelFor?: (n: number) => string }) {
  const { ctx, parts } = props;
  if (!parts.parts.length || parts.rec.manualOn) return null;
  return <Card>
    {parts.parts.map((hash, i) => <View key={hash} style={styles.part}>
      <View style={styles.partNumber} accessible accessibilityLabel={props.labelFor?.(i + 1) ?? `Part ${i + 1}`}>
        <Text style={text.small}>{i + 1}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <AudioClip project={ctx.project} hashes={[hash]} hideActions disabled={parts.blocked}
          label={`Play ${props.labelFor?.(i + 1) ?? `part ${i + 1}`}`} />
      </View>
      <ActionButton icon={Trash2} variant="outline" style={styles.partDelete}
        accessibilityLabel={`Delete ${props.labelFor?.(i + 1) ?? `part ${i + 1}`}`}
        disabled={parts.blocked} onPress={() => void parts.remove(hash)} />
    </View>)}
  </Card>;
}

/**
 * The recording controls. Nothing changed: one centred mic (yellow unless
 * `quiet`, when the footer's yellow belongs to another action). After a
 * recording: redo (outline) · neutral mic · yellow keep.
 */
export function RecordControls(props: { parts: RecordingParts; quiet?: boolean; onKept?: () => void; keepLabel?: string }) {
  const { parts } = props;
  const reviewing = parts.changed && parts.parts.length > 0;
  return <View style={styles.controls}>
    {reviewing ? <ActionButton icon={RotateCcw} variant="outline"
      accessibilityLabel="Record a new take" disabled={parts.blocked}
      onPress={() => void parts.redo()} style={styles.reviewAction} /> : null}
    <Pressable onPress={() => void parts.rec.toggleVad()}
      disabled={parts.blocked} accessibilityRole="button"
      accessibilityLabel={parts.parts.length ? 'Record another part' : 'Start recording'}
      accessibilityHint="Tap to start. Tap stop when you finish."
      accessibilityState={{ disabled: parts.blocked, busy: parts.rec.busy }}
      style={({ pressed }) => [styles.record,
        (reviewing || props.quiet) && styles.recordSecondary,
        parts.blocked && styles.recordDisabled,
        pressed && { opacity: 0.85 }]}>
      <Mic color={parts.blocked ? colors.mutedForeground : colors.actionForeground} size={32} />
    </Pressable>
    {reviewing ? <ActionButton icon={Check} accessibilityLabel={props.keepLabel ?? 'Keep take'}
      disabled={parts.blocked} style={styles.reviewAction}
      onPress={() => void parts.keep().then((kept) => { if (kept) props.onKept?.(); })} /> : null}
  </View>;
}

/** The takeover, mounted over the screen while the VAD session runs. */
export function RecordingTakeover(props: { parts: RecordingParts }) {
  return <Modal visible={props.parts.rec.vadOn} animationType="none"
    onRequestClose={() => void props.parts.rec.stopVad()}>
    <VADTakeover rec={props.parts.rec} count={props.parts.pending.length} />
  </Modal>;
}

/**
 * Hold to record a short voice note (feedback, what changed). Red while
 * held; outline otherwise, since a screen's yellow belongs to its main
 * action. `onCard` receives the saved audio.
 */
export function HoldToRecord(props: {
  accessibilityLabel: string; onCard: (card: RecordedCard) => void | Promise<void>; disabled?: boolean;
}) {
  const [error, setError] = useState('');
  const rec = useRecorder(async (card) => { await props.onCard(card); });
  const off = props.disabled || rec.busy || rec.failureCount > 0;
  return <View style={{ gap: space.sm, alignItems: 'center' }}>
    <Pressable accessibilityRole="button" accessibilityLabel={props.accessibilityLabel}
      accessibilityHint="Hold to record, release to stop." disabled={off}
      onPressIn={() => { if (!off) void rec.manualDown().catch((e) => setError((e as Error).message)); }}
      onPressOut={() => void rec.manualUp()}
      style={[styles.hold, rec.manualOn && styles.holding, off && styles.recordDisabled]}>
      <Mic size={28} color={rec.manualOn ? 'white' : off ? colors.mutedForeground : colors.foreground} />
    </Pressable>
    {rec.failureCount ? <ActionButton icon={RotateCcw} variant="outline" accessibilityLabel="Retry saving audio"
      onPress={() => void rec.retryFailed()} disabled={rec.busy} /> : null}
    {error || rec.error ? <Text style={text.muted} accessibilityRole="alert">{error || rec.error}</Text> : null}
  </View>;
}

/** The only thing that re-renders with the microphone. */
function EnergyBars(props: { captured: boolean }) {
  const history = useEnergyHistory(props.captured);
  return <>{history.map((bar, index) => <View key={index}
    style={[styles.bar, { opacity: bar.captured ? 1 : 0.3,
      height: `${Math.max(1, Math.pow(Math.min(1, Math.max(0, bar.energy)), bar.captured ? 0.6 : 2.5) * 100)}%` }]} />)}</>;
}

export function VADTakeover(props: {
  rec: ReturnType<typeof useRecorder>;
  count: number;
}) {
  const { rec } = props;
  const [height, setHeight] = useState(1);
  const [cutoff, setCutoff] = useState(rec.cutoff);
  const latest = useRef({ height, cutoff, rec });
  latest.current = { height, cutoff, rec };
  const dragStart = useRef(0);
  const commit = (value: number) => void latest.current.rec.setCutoff(value);
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { dragStart.current = latest.current.cutoff; },
    onPanResponderMove: (_, gesture) => {
      setCutoff(Math.max(0.04, Math.min(0.92,
        dragStart.current - gesture.dy / latest.current.height)));
    },
    // One native configuration per drag avoids flooding the audio thread.
    onPanResponderRelease: () => commit(latest.current.cutoff),
    onPanResponderTerminate: () => setCutoff(latest.current.rec.cutoff)
  })).current;
  return (
    <View style={[styles.takeover, rec.vadCapturing && styles.capturing]}>
      <View style={styles.liveStatus} accessible accessibilityLabel={rec.vadCapturing ? 'Capturing speech' : 'Recording session: listening'}>
        <View style={[styles.dot, { opacity: rec.vadCapturing ? 1 : 0.4 }]} />
        <Mic size={26} color="white" />
        <Text style={styles.white}>{props.count}</Text>
      </View>
      <View style={styles.wave} onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
        {...pan.panHandlers} accessible accessibilityRole="adjustable"
        accessibilityLabel="Sound cutoff" accessibilityValue={{ min: 4, max: 92, now: Math.round(cutoff * 100) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          const next = Math.max(0.04, Math.min(0.92, cutoff + (event.nativeEvent.actionName === 'increment' ? 0.02 : -0.02)));
          setCutoff(next); commit(next);
        }}>
        <EnergyBars captured={rec.vadCapturing} />
        <View style={[styles.cutoff, { top: `${(1 - cutoff) * 100}%` }]} />
      </View>
      <View style={styles.controls}>
        {[500, 1000, 2000].map((duration, index) => <Pressable key={duration}
          onPress={() => void rec.setPause(duration)} accessibilityRole="button"
          accessibilityLabel={['Short pause', 'Normal pause', 'Long pause'][index]}
          accessibilityState={{ selected: duration === rec.pauseDuration }}
          style={[styles.pause, duration === rec.pauseDuration && { backgroundColor: 'white' }]}>
          {Array.from({ length: index + 1 }, (_, i) => <View key={i} style={[styles.dot,
            { width: 5, height: 5, backgroundColor: duration === rec.pauseDuration ? '#A8120A' : 'white' }]} />)}
        </Pressable>)}
      </View>
      {rec.error ? <Text style={styles.white} accessibilityRole="alert">{rec.error}</Text> : null}
      <Pressable style={styles.stop} accessibilityRole="button"
        accessibilityLabel="Stop recording and review take" onPress={() => void rec.stopVad()}>
        <Square size={36} fill="#A8120A" color="#A8120A" />
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  part: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  partNumber: { width: 28, height: 28, borderRadius: radius.full, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  partDelete: { height: 52, paddingHorizontal: space.md },
  hold: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  holding: { backgroundColor: '#A8120A', borderColor: '#A8120A' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.lg },
  record: { width: 82, height: 82, borderRadius: 41, backgroundColor: colors.action, alignItems: 'center', justifyContent: 'center' },
  reviewAction: { flex: 1 },
  recordSecondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  recordDisabled: { backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
  takeover: { flex: 1, backgroundColor: '#A8120A', padding: space.xl, paddingTop: 60, paddingBottom: 44, gap: space.xl },
  capturing: { backgroundColor: '#C2160C' },
  liveStatus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md },
  white: { color: 'white', fontSize: 18, textAlign: 'center' },
  dot: { width: 10, height: 10, borderRadius: radius.full, backgroundColor: 'white' },
  wave: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2 },
  bar: { flex: 1, backgroundColor: 'white', borderRadius: 2 },
  cutoff: { position: 'absolute', left: 0, right: 0, borderTopWidth: 2, borderStyle: 'dashed', borderColor: 'white' },
  pause: { minWidth: 48, minHeight: 44, padding: 12, borderRadius: radius.full, borderWidth: 1, borderColor: '#ffffff88', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  stop: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: 'white', alignSelf: 'center' }
});

// Shared machinery, not a screen of its own: it declares no screen contract.
import { contractsFor } from '../screenContracts';
export const contracts = contractsFor();
