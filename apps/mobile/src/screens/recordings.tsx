// Avatar U. Durable recording, full-screen VAD, then keep or redo.
import { commands, currentTake, isStored } from '@langquest-next/core';
import { indexesFor } from '../indexes';
import * as Crypto from 'expo-crypto';
import { AudioWaveform, Check, CloudCheck, CloudUpload, Mic, RotateCcw, Save, Square } from 'lucide-react-native';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Ctx } from '../ctx';
import { AudioClip } from '../audioClip';
import { Header, Note, Screen } from '../pui';
import { pendingPassageCards } from '../recordingFlow';
import { colors, radius, space } from '../theme';
import { ActionButton, Card, text } from '../ui';
import { useEnergyHistory, useRecorder, type RecordedCard } from '../useRecorder';
import { useTask } from './translate';

export function QuestAssets(ctx: Ctx) {
  const state = ctx.project.state;
  const { task, ready } = useTask(ctx);
  const latest = useRef(ctx);
  latest.current = ctx;
  const latestTask = useRef(task);
  latestTask.current = task;
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const persist = useCallback(async (card: RecordedCard) => {
    const current = latest.current;
    const passage = latestTask.current;
    if (!passage) throw new Error('This passage is no longer available.');
    // card.id was chosen before the first save step, so a retry or a
    // journal resume after restart finds the event already in the fold.
    const state = current.project.state;
    if (state) {
      await current.project.run(commands(state, indexesFor(state)).addRecording({
        commandId: card.id, recordingId: card.id, unitId: passage.unitId, laneId: passage.laneId,
        kind: 'target', card: { hash: card.ref.hash, durationMs: card.durationMs, format: card.ref.format }
      }));
    }
    current.project.triggerUpload();
  }, []);
  const rec = useRecorder(persist, task ? {
    orgId: ctx.project.orgId, projectId: ctx.project.projectId, unitId: task.unitId, laneId: task.laneId
  } : undefined);
  // The fold mutates in place and useProject republishes a fresh top-level
  // object after every change, so `state` identity is the revision: this
  // project-wide scan reruns per change, not per render.
  const actorId = ctx.session.actorId;
  const pending = useMemo(
    () => (state && task ? pendingPassageCards(state, task.unitId, task.laneId, actorId) : []),
    [state, task?.unitId, task?.laneId, actorId]
  );
  if (!state || !task) return ready ? <Note>Task not found.</Note> : <></>;
  const takeId = currentTake(state, task.unitId, task.laneId, indexesFor(state));
  const take = takeId ? state.takes[takeId] : undefined;
  const hashes = pending.length ? pending.map((c) => c.hash) : take?.cardHashes ?? [];
  const blocked = saving || rec.busy || rec.manualOn || rec.vadOn || rec.failureCount > 0;
  async function keep() {
    if (blocked || saveLock.current || !hashes.length) return;
    saveLock.current = true; setSaving(true); setError('');
    try {
      if (pending.length) {
        await ctx.project.run(commands(state!, indexesFor(state!)).keepTake({
          commandId: Crypto.randomUUID(), unitId: task!.unitId, laneId: task!.laneId,
          cardHashes: pending.map((c) => c.hash)
        }));
      }
      ctx.back();
    } catch (e) { setError((e as Error).message); }
    finally { saveLock.current = false; setSaving(false); }
  }
  async function redo() {
    if (blocked || saveLock.current) return;
    saveLock.current = true; setSaving(true); setError('');
    try {
      // An archived draft records the deliberate discard, so recovery never
      // resurrects it. Immutable audio remains available in event history.
      if (pending.length) {
        await ctx.project.run(commands(state!, indexesFor(state!)).discardCards({
          commandId: Crypto.randomUUID(), unitId: task!.unitId, laneId: task!.laneId,
          cardHashes: pending.map((c) => c.hash)
        }));
      }
      await rec.toggleVad();
    } catch (e) { setError((e as Error).message); }
    finally { saveLock.current = false; setSaving(false); }
  }
  const title = state.units[task.unitId]?.label ?? task.unitId;
  return (
    <Screen footer={hashes.length && !rec.manualOn ? (
      <View style={styles.row}>
        <ActionButton icon={RotateCcw} variant="outline"
          accessibilityLabel="Record a new take" disabled={blocked}
          onPress={() => void redo()} />
        <ActionButton icon={Check} accessibilityLabel="Keep take and return to passage"
          disabled={blocked} onPress={() => void keep()} style={{ flex: 1 }} />
      </View>
    ) : undefined}>
      <Header title={title} onBack={blocked ? undefined : ctx.back} />
      {hashes.length && !rec.manualOn ? <Card>
        <AudioClip project={ctx.project} hashes={hashes} label="Play recorded passage" />
        <View style={styles.row} accessible accessibilityLabel={rec.busy ? 'Saving' : hashes.every((h) => isStored(state, h)) ? 'Backed up' : 'Saved on this device'}>
          {rec.busy ? <Save color={colors.mutedForeground} /> : hashes.every((h) => isStored(state, h)) ? <CloudCheck color={colors.done} /> : <CloudUpload color={colors.mutedForeground} />}
          <Text style={text.small}>{hashes.length}</Text>
        </View>
      </Card> : null}
      {!hashes.length || rec.manualOn ? <View style={styles.controls}>
        <ActionButton icon={AudioWaveform} variant="outline"
          accessibilityLabel="Start voice-detected recording"
          disabled={blocked} onPress={() => void rec.toggleVad()} />
        <Pressable onPressIn={() => void rec.manualDown()}
          onPressOut={() => void rec.manualUp()}
          disabled={rec.vadOn || saving || rec.failureCount > 0}
          accessibilityRole="button" accessibilityLabel="Hold to record passage"
          style={[styles.record, rec.manualOn && styles.recordLive]}>
          {rec.manualOn ? <Square color="white" fill="white" size={28} /> : <Mic color={colors.actionForeground} size={32} />}
        </Pressable>
      </View> : null}
      {error || rec.error ? <Note>{error || rec.error}</Note> : null}
      {rec.failureCount ? <ActionButton icon={RotateCcw} accessibilityLabel="Retry saving recording" disabled={rec.busy} onPress={() => void rec.retryFailed()} /> : null}
      <Modal visible={rec.vadOn} animationType="none"
        onRequestClose={() => void rec.stopVad()}>
        <VADTakeover rec={rec} count={pending.length} />
      </Modal>
    </Screen>
  );
}

/** The only thing that re-renders with the microphone. */
function EnergyBars(props: { captured: boolean }) {
  const history = useEnergyHistory(props.captured);
  return <>{history.map((bar, index) => <View key={index}
    style={[styles.bar, { opacity: bar.captured ? 1 : 0.3,
      height: `${Math.max(1, Math.pow(Math.min(1, Math.max(0, bar.energy)), bar.captured ? 0.6 : 2.5) * 100)}%` }]} />)}</>;
}

function VADTakeover(props: {
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
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.lg },
  record: { width: 82, height: 82, borderRadius: 41, backgroundColor: colors.action, alignItems: 'center', justifyContent: 'center' },
  recordLive: { backgroundColor: '#A8120A' },
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
