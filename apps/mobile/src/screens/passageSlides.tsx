// Avatar U. Oral passage runs: one reference or term action per slide.
import {
  currentTake,
  keyTermsFor,
  keyTermsForUnit,
  type KeyTermView
} from '@langquest-next/core';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Check, ChevronLeft, ChevronRight, Headphones, KeyRound, Mic, Pause, Play, RotateCcw } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { Ctx } from '../ctx';
import { Note } from '../pui';
import { colors, radius, space, tint } from '../theme';
import { ActionButton, BackButton, Card, ProgressRing, text } from '../ui';
import { useRecorder, type RecordedCard } from '../useRecorder';
import { getReferenceSlides, referenceRunSignature } from '../passageResources';
import { taskFor } from './translate';

export { getReferenceSlides, referenceRunSignature } from '../passageResources';

/** Stable local completion key used by the passage hub's derived workflow. */
export function referenceRunKey(ctx: Ctx): string {
  const task = taskFor(ctx);
  return `reference-run:${ctx.project.orgId}:${ctx.project.projectId}:${ctx.session.actorId}:${task?.laneId ?? ctx.params['laneId'] ?? ''}:${task?.unitId ?? ctx.params['unitId'] ?? ''}`;
}

function AudioControl({ uri, color, label, onFinished }: {
  uri: string | null; color: string; label: string;
  onFinished?: () => void;
}) {
  const playerRef = useRef<AudioPlayer | null>(null);
  const generation = useRef(0);
  const finished = useRef(onFinished);
  finished.current = onFinished;
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    setPlaying(false); setProgress(0); setError(''); setStarting(false);
    return () => {
      generation.current++;
      playerRef.current?.remove(); playerRef.current = null;
    };
  }, [uri]);
  async function toggle() {
    if (!uri || starting) return;
    if (playing) { playerRef.current?.pause(); setPlaying(false); return; }
    const run = generation.current;
    setStarting(true); setError('');
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (run !== generation.current) return;
      let player = playerRef.current;
      if (!player) {
        player = createAudioPlayer({ uri });
        playerRef.current = player;
        player.addListener('playbackStatusUpdate', (status) => {
          if (run !== generation.current) return;
          setProgress(status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0);
          if (status.didJustFinish) { setPlaying(false); finished.current?.(); }
        });
      }
      if (progress >= 1) await player.seekTo(0);
      if (run !== generation.current) return;
      player.play(); setPlaying(true);
    } catch (e) {
      if (run === generation.current) { setPlaying(false); setError((e as Error).message); }
    } finally { if (run === generation.current) setStarting(false); }
  }
  return <View style={{ gap: space.sm }}>
    <Pressable onPress={() => void toggle()} disabled={!uri || starting}
      accessibilityRole="button" accessibilityLabel={playing ? `Pause ${label}` : `Play ${label}`}
      style={[styles.audio, { borderColor: color }, !uri && styles.disabled]}>
      {playing ? <Pause size={25} color={color} /> : <Play size={25} color={color} />}
      <View style={[styles.audioTrack, { backgroundColor: tint.mutedContainer }]}>
        <View style={[styles.audioFill, { backgroundColor: color, width: `${progress * 100}%` }]} />
      </View>
      <Headphones size={20} color={color} />
    </Pressable>
    {error ? <Text accessibilityRole="alert" style={text.muted}>{error}</Text> : null}
  </View>;
}

/** A run of one real reference audio item per slide. */
export function PassageReferences(ctx: Ctx) {
  const { state, blobs } = ctx.project;
  const task = taskFor(ctx);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [, refreshBlobs] = useState(0);
  useEffect(() => blobs.store?.onChange(() => refreshBlobs((n) => n + 1)), [blobs.store]);
  if (!state || !task) return <Note>Task not found.</Note>;
  const unit = state.units[task.unitId];
  const items = getReferenceSlides(state, task.laneId, task.unitId);
  if (!items.length) return <EmptyRun icon={Headphones} onBack={ctx.back} label="No reference audio" />;
  const item = items[Math.min(index, items.length - 1)]!;
  const uri = blobs.uriFor({ hash: item.hash, format: item.format });
  const last = index === items.length - 1;
  async function next() {
    if (!uri || !seen.has(item.id)) return;
    if (last) {
      try {
        await AsyncStorage.setItem(referenceRunKey(ctx), referenceRunSignature(items));
        ctx.back();
      } catch (e) { setError((e as Error).message); }
    } else setIndex(index + 1);
  }
  return (
    <View style={[styles.screen, { backgroundColor: 'rgba(243,117,27,0.06)' }]}> 
      <View style={styles.content}>
        <BackButton onPress={ctx.back} />
        <View style={styles.beads} accessibilityLabel={`Reference ${index + 1} of ${items.length}`}>
          {items.map((_, i) => <View key={i} style={[styles.bead, i < index && styles.beadPast, i === index && styles.beadCurrent]} />)}
        </View>
        <Text style={styles.reference}>{unit?.label ?? task.unitId}</Text>
        <View accessible accessibilityLabel={item.label}><Headphones size={28} color={colors.reference} /></View>
        <AudioControl uri={uri} color={colors.reference} label="reference audio" onFinished={() => setSeen((old) => new Set(old).add(item.id))} />
        {!uri ? <Note>Audio is not on this phone yet. Connect to download it.</Note> : null}
        {error ? <Note>{error}</Note> : null}
      </View>
      <View style={styles.footer}>
        <Pressable onPress={index ? () => setIndex(index - 1) : ctx.back} accessibilityLabel="Previous reference" style={styles.outline}><ChevronLeft size={26} color={colors.foreground} /></Pressable>
        <ActionButton icon={last ? Check : ChevronRight} accessibilityLabel={last ? 'Finish references' : 'Next reference'} onPress={() => void next()} disabled={!uri || !seen.has(item.id)} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

/** A term recording run. Existing audio anywhere in the lane is credited and skipped. */
export function PassageTerms(ctx: Ctx) {
  const { state, blobs } = ctx.project;
  const task = taskFor(ctx);
  const [pending, setPending] = useState<{ card: RecordedCard; termId: string } | null>(null);
  const activeTerm = useRef<string | null>(null);
  const saveLock = useRef(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Keyed on `state` identity, the per-change revision (see recordings.tsx).
  const terms = useMemo(() => (state && task ? keyTermsForUnit(state, task.laneId, task.unitId) : []), [state, task?.laneId, task?.unitId]);
  const allTerms = useMemo(() => (state && task ? keyTermsFor(state, task.laneId) : []), [state, task?.laneId]);
  const hasAudio = (term: KeyTermView) => term.adjustments.some((a) => !!a.blobHash);
  const run = terms.filter((term) => !hasAudio(term));
  const completed = allTerms.filter(hasAudio).length;
  const current = pending ? terms.find((term) => term.termId === pending.termId) : run[0];
  const onCard = useCallback((card: RecordedCard) => {
    if (!activeTerm.current) throw new Error('No term selected for this recording.');
    setPending({ card, termId: activeTerm.current });
  }, []);
  const recorder = useRecorder(onCard);
  if (!state || !task) return <Note>Task not found.</Note>;
  if (!terms.length) return <EmptyRun icon={KeyRound} onBack={ctx.back} label="No key terms" />;
  if (!run.length && !pending) return <TermFinished completed={completed} total={allTerms.length} onDone={ctx.back} />;
  if (!current) return <Note>Loading key terms.</Note>;

  const pendingUri = pending ? blobs.uriFor(pending.card.ref) : null;
  const keep = async () => {
    if (!pending || !current || saveLock.current) return;
    saveLock.current = true;
    setBusy(true);
    setError('');
    try {
      const takeId = currentTake(state, task.unitId, task.laneId);
      await ctx.project.appendMany([
        { type: 'v1.RecordingAdded', payload: { recordingId: Crypto.randomUUID(), unitId: task.unitId, laneId: task.laneId, kind: 'source', cards: [{ hash: pending.card.ref.hash, durationMs: pending.card.durationMs, format: pending.card.ref.format }] } },
        { type: 'v1.KeyTermAdjusted', payload: { termId: current.termId, adjustmentId: Crypto.randomUUID(), note: '', blobHash: pending.card.ref.hash, ...(takeId ? { duringTakeId: takeId } : {}) } }
      ]);
      ctx.project.triggerUpload();
      setPending(null);

    } catch (e) { setError((e as Error).message); }
    finally { saveLock.current = false; setBusy(false); }
  };
  const retry = () => { setPending(null); setError(''); };
  const recording = recorder.manualOn;
  return (
    <View style={[styles.screen, { backgroundColor: 'rgba(243,117,27,0.06)' }]}> 
      <View style={styles.content}>
        <BackButton onPress={() => { if (!busy && !recorder.busy && !recording) ctx.back(); }} />
        <View style={styles.progressRow} accessibilityLabel={`${completed} of ${allTerms.length} terms have audio`}>
          <ProgressRing completed={completed} total={allTerms.length} size={76} />
          <Text style={text.small}>{completed} / {allTerms.length}</Text>
        </View>
        <View style={styles.beads} accessibilityLabel={`${run.length} relevant terms remaining`}>
          {run.slice(0, 30).map((term, i) => <View key={term.termId} style={[styles.bead, i === 0 && styles.beadCurrent]} />)}
        </View>
        <View style={styles.termCard}><KeyRound size={34} color={colors.reference} /><Text style={styles.reference} accessibilityLabel="Current key term">{current.term}</Text></View>
        <View style={styles.chips} accessibilityLabel="All key terms in this language">
          {allTerms.map((term) => {
            const recorded = hasAudio(term);
            const active = term.termId === current.termId;
            return <View key={term.termId} style={[styles.chip, recorded && styles.chipDone, active && styles.chipActive]}>
              {recorded ? <Check size={12} color={colors.done} /> : null}
              <Text style={[text.small, recorded && { color: colors.done }, active && { color: colors.foreground, fontWeight: '700' }]} numberOfLines={1}>{term.term}</Text>
            </View>;
          })}
        </View>
        {pending ? <AudioControl uri={pendingUri} color={colors.translate} label="new recording" /> : null}
        {recorder.failureCount ? <ActionButton icon={RotateCcw}
          accessibilityLabel="Retry saving term audio" variant="outline"
          onPress={() => void recorder.retryFailed()} disabled={recorder.busy} /> : null}
        {error || recorder.error ? <Text style={styles.error}>{error || recorder.error}</Text> : null}
      </View>
      <View style={styles.footer}>
        {pending ? (
          <>
            <Pressable onPress={retry} disabled={busy} accessibilityLabel="Record term again" style={styles.outline}><RotateCcw size={25} color={colors.foreground} /></Pressable>
            <ActionButton icon={Check} accessibilityLabel="Keep recording" onPress={() => void keep()} disabled={busy || recorder.busy} style={{ flex: 1 }} />
          </>
        ) : (
          <Pressable onPressIn={() => { if (recorder.busy || recorder.failureCount) return; activeTerm.current = current.termId; void recorder.manualDown(); }} onPressOut={() => void recorder.manualUp()} accessibilityRole="button" accessibilityLabel={recording ? 'Release to stop recording' : 'Hold to record term'} style={[styles.record, recording && styles.recording]}>
            {recording ? <View style={styles.stop} /> : <Mic size={31} color={colors.actionForeground} />}
          </Pressable>
        )}
      </View>
    </View>
  );
}

function EmptyRun({ icon: Icon, label, onBack }: { icon: typeof Headphones; label: string; onBack: () => void }) {
  return <View style={styles.screen}><View style={styles.content}><BackButton onPress={onBack} /><Card style={styles.empty}><Icon size={40} color={colors.mutedForeground} /><Text style={text.h4}>{label}</Text></Card></View></View>;
}

function TermFinished({ completed, total, onDone }: { completed: number; total: number; onDone: () => void }) {
  return <View style={styles.screen}><View style={styles.content}><View style={styles.empty}><Check size={52} color={colors.done} /><Text style={styles.reference}>{completed}/{total}</Text></View><ActionButton icon={ChevronRight} accessibilityLabel="Finish key terms" onPress={onDone} /></View></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, gap: space.lg, padding: space.lg, alignItems: 'stretch' },
  footer: { flexDirection: 'row', gap: space.sm, alignItems: 'center', padding: space.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.card },
  outline: { width: 56, height: 56, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  beads: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'center', minHeight: 8 },
  bead: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border },
  beadPast: { backgroundColor: colors.done },
  beadCurrent: { width: 20, borderRadius: 3, backgroundColor: colors.foreground },
  reference: { textAlign: 'center', fontSize: 23, fontWeight: '700', color: colors.foreground },
  audio: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderWidth: 1.5, borderRadius: radius.lg, backgroundColor: colors.card },
  audioTrack: { flex: 1, height: 6, borderRadius: 4, overflow: 'hidden' },
  audioFill: { height: '100%', borderRadius: 4 },
  disabled: { opacity: 0.45 },
  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md },
  ring: { width: 76, height: 76, borderRadius: 38, borderWidth: 7, borderColor: colors.done, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  ringText: { fontSize: 17, fontWeight: '700', color: colors.done },
  termCard: { alignItems: 'center', gap: space.md, padding: space.xl, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 140, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipDone: { borderColor: tint.doneBorder, backgroundColor: tint.done },
  chipActive: { borderColor: colors.foreground, backgroundColor: 'rgba(253,195,23,0.22)' },
  record: { width: 82, height: 82, alignSelf: 'center', borderRadius: 41, backgroundColor: colors.action, alignItems: 'center', justifyContent: 'center', borderWidth: 6, borderColor: 'rgba(253,195,23,0.22)' },
  recording: { backgroundColor: '#A8120A', borderColor: '#A8120A22' },
  stop: { width: 29, height: 29, borderRadius: 6, backgroundColor: colors.white },
  error: { color: colors.reference, textAlign: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md }
});
