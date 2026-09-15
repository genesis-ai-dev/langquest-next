// Avatar U. Spec quest_assets: the recordings screen. Hold the mic to record a card,
// or turn on VAD and just speak; each card is an immutable blob. One yellow action.
import { currentTake, deriveTakeStatus, isStored, type BlobRef } from '@langquest-next/core';
import type { BlobFile } from '../blobs';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { AudioWaveform, CloudCheck, CloudUpload, ListMusic, Mic, Pause, Play, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Ctx } from '../ctx';
import { Note } from '../pui';
import { colors, radius, space, tint } from '../theme';
import { ActionButton, BackButton, Card, StatusIcon, text } from '../ui';
import { useRecorder, type RecordedCard } from '../useRecorder';
import { taskFor } from './translate';

const BARS = 32;

export function QuestAssets(ctx: Ctx) {
  const { state, append, blobs, triggerUpload } = ctx.project;
  const task = taskFor(ctx);
  const [history, setHistory] = useState<number[]>(() => Array(BARS).fill(0));
  const [playing, setPlaying] = useState<string | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);

  // A card is durable the moment it is recorded (RecordingAdded), and the
  // draft take is recomposed to include it. Re-composition archives the
  // previous draft so history stays honest and ids stay unique.
  const onCard = useCallback(
    async (card: RecordedCard) => {
      if (!state || !task) return;
      const stamp = Date.now();
      await append('v1.RecordingAdded', {
        recordingId: `rec-${stamp}`,
        unitId: task.unitId,
        laneId: task.laneId,
        kind: 'target',
        cards: [{ hash: card.ref.hash, durationMs: card.durationMs, format: card.ref.format }]
      });
      const cur = currentTake(state, task.unitId, task.laneId);
      const curTake = cur ? state.takes[cur] : undefined;
      const draft = cur && deriveTakeStatus(state, cur).outcome === 'draft' ? cur : null;
      const cards = [...(draft && curTake ? curTake.cardHashes : []), card.ref.hash];
      await append('v1.TakeComposed', {
        takeId: `${task.unitId}-${stamp}`,
        unitId: task.unitId,
        laneId: task.laneId,
        cardHashes: cards,
        parentTakeId: cur
      });
      if (draft) await append('v1.TakeArchived', { takeId: draft });
      triggerUpload();
    },
    [state, task, append, triggerUpload]
  );

  const rec = useRecorder(onCard);

  useEffect(() => {
    setHistory((h) => [...h.slice(1), rec.energy]);
  }, [rec.energy]);

  useEffect(() => () => playerRef.current?.remove(), []);

  if (!state || !task) return <Note>Task not found.</Note>;
  const takeId = currentTake(state, task.unitId, task.laneId);
  const take = takeId ? state.takes[takeId] : undefined;
  const status = takeId ? deriveTakeStatus(state, takeId) : null;
  const cardRefs: BlobFile[] = (take?.cardHashes ?? []).map((h) => ({ hash: h, format: formatOf(state, h) }));
  const localUris = cardRefs.map((r) => blobs.uriFor(r));

  async function playFrom(i: number) {
    playerRef.current?.remove();
    playerRef.current = null;
    if (playing !== null) {
      setPlaying(null);
      return;
    }
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    const next = (idx: number) => {
      const uri = localUris[idx];
      if (idx >= cardRefs.length || !uri) {
        setPlaying(null);
        return;
      }
      setPlaying(cardRefs[idx]!.hash);
      const p = createAudioPlayer({ uri });
      playerRef.current = p;
      p.addListener('playbackStatusUpdate', (s) => {
        if (s.didJustFinish) {
          p.remove();
          next(idx + 1);
        }
      });
      p.play();
    };
    next(i);
  }

  async function deleteCard(hash: string) {
    if (!takeId || !take) return;
    const stamp = Date.now();
    const remaining = take.cardHashes.filter((h) => h !== hash);
    await append('v1.TakeComposed', {
      takeId: `${task!.unitId}-${stamp}`,
      unitId: task!.unitId,
      laneId: task!.laneId,
      cardHashes: remaining,
      parentTakeId: takeId
    });
    await append('v1.TakeArchived', { takeId });
  }

  const capturing = rec.manualOn || rec.vadCapturing;

  return (
    <View style={[styles.screen, { backgroundColor: tint.translate }]}>
      <View style={styles.content}>
        <BackButton onPress={ctx.back} />
        <View style={styles.titleRow}>
          <ListMusic size={22} color={colors.translate} />
          <Text style={[text.h3, { flex: 1 }]}>{state.units[task.unitId]?.label}</Text>
          <View style={styles.titleRow} accessibilityLabel={`${blobs.pendingUp} uploads pending`}>
            {blobs.pendingUp > 0 ? (
              <>
                <CloudUpload size={16} color={colors.mutedForeground} />
                <Text style={text.small}>{blobs.pendingUp}</Text>
              </>
            ) : cardRefs.length > 0 ? (
              <CloudCheck size={16} color={colors.done} />
            ) : null}
          </View>
        </View>

        {/* Waveform: native energy in both modes. */}
        <View style={[styles.wave, capturing && { borderColor: colors.reference }]} accessibilityLabel={capturing ? 'Recording' : 'Listening'}>
          {history.map((v, i) => (
            <View key={i} style={[styles.bar, { height: 4 + Math.min(1, v * 4) * 44, backgroundColor: capturing ? colors.reference : colors.translate }]} />
          ))}
        </View>

        <View style={{ gap: space.sm }}>
          {cardRefs.map((ref, i) => {
            const stored = isStored(state, ref.hash);
            const here = localUris[i] !== null;
            return (
              <Card key={ref.hash} style={styles.cardRow}>
                <Pressable onPress={() => void playFrom(i)} disabled={!here} accessibilityLabel={playing === ref.hash ? 'Pause' : 'Play card'} style={[styles.play, !here && { opacity: 0.4 }]}>
                  {playing === ref.hash ? <Pause size={16} color={colors.white} /> : <Play size={16} color={colors.white} />}
                </Pressable>
                <Text style={[text.body, { flex: 1 }]}>{i + 1}</Text>
                {stored ? <CloudCheck size={16} color={colors.done} /> : <CloudUpload size={16} color={colors.mutedForeground} />}
                {status?.outcome === 'draft' ? (
                  <Pressable onPress={() => void deleteCard(ref.hash)} hitSlop={8} accessibilityLabel="Delete card">
                    <Trash2 size={18} color={colors.reference} />
                  </Pressable>
                ) : null}
              </Card>
            );
          })}
        </View>

        {status ? (
          <View style={[styles.titleRow, { justifyContent: 'center' }]}>
            <StatusIcon outcome={status.outcome} />
          </View>
        ) : null}

        {rec.error ? <Text style={{ color: colors.reference, textAlign: 'center' }}>{rec.error}</Text> : null}

        {/* VAD toggle (outline) and the one yellow action: hold to record. */}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <ActionButton icon={AudioWaveform} accessibilityLabel={rec.vadOn ? 'Stop voice detection' : 'Start voice detection'} variant={rec.vadOn ? 'action' : 'outline'} onPress={() => void rec.toggleVad()} style={{ flex: 1 }} />
          <Pressable
            onPressIn={() => void rec.manualDown()}
            onPressOut={() => void rec.manualUp()}
            disabled={rec.vadOn}
            accessibilityRole="button"
            accessibilityLabel="Hold to record"
            style={({ pressed }) => [styles.hold, rec.vadOn && { opacity: 0.4 }, (pressed || rec.manualOn) && { backgroundColor: colors.reference }]}
          >
            <Mic size={30} color={colors.actionForeground} strokeWidth={2.25} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function formatOf(state: NonNullable<Ctx['project']['state']>, hash: string): BlobRef['format'] {
  for (const r of Object.values(state.recordings)) {
    const c = r.cards.find((x) => x.hash === hash);
    if (c) return c.format ?? 'wav';
  }
  return 'wav';
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: space.lg, padding: space.lg, flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  wave: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card
  },
  bar: { flex: 1, borderRadius: 2 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  play: { width: 32, height: 32, borderRadius: radius.full, backgroundColor: colors.translate, alignItems: 'center', justifyContent: 'center' },
  hold: { flex: 2, height: 64, borderRadius: radius.md, backgroundColor: colors.action, alignItems: 'center', justifyContent: 'center' }
});
