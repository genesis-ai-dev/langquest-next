// A voice note anywhere text is optional (a reason, feedback, directions,
// what changed): tap to record, tap to stop. The audio is a real card in the
// content-addressed store, saved against the passage as source-language
// audio (not a draft of the translation), and uploaded like any other card.
import { commands } from '@langquest-next/core';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AudioClip } from './audioClip';
import type { Ctx } from './ctx';
import { indexesFor } from './indexes';
import { Ico, IconBtn, txt } from './kit';
import { C, radius, space, TINT } from './theme';
import { useRecorder, type RecordedCard } from './useRecorder';

export function VoiceNote(props: {
  ctx: Ctx;
  unitId: string;
  laneId: string;
  label: string;
  hash: string | null;
  onChange: (hash: string | null) => void;
}) {
  const latest = useRef(props);
  latest.current = props;
  const persist = async (card: RecordedCard) => {
    const { ctx, unitId, laneId, onChange } = latest.current;
    const state = ctx.project.state;
    if (!state) throw new Error('The project is still loading.');
    await ctx.project.run(commands(state, indexesFor(state)).addRecording({
      commandId: card.id, recordingId: card.id, unitId, laneId, kind: 'source',
      card: { hash: card.ref.hash, durationMs: card.durationMs, format: card.ref.format }
    }));
    ctx.project.triggerUpload();
    onChange(card.ref.hash);
  };
  const rec = useRecorder(persist, { orgId: props.ctx.project.orgId, projectId: props.ctx.project.projectId, unitId: props.unitId, laneId: props.laneId });
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!rec.manualOn) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [rec.manualOn]);

  if (props.hash && !rec.manualOn) {
    return (
      <View style={[styles.box, { backgroundColor: TINT.green, borderColor: `${C.green}55` }]}>
        <View style={{ flex: 1 }}>
          <AudioClip project={props.ctx.project} hashes={[props.hash]} label="Play voice note" />
        </View>
        <IconBtn name="trash" label="Delete voice note" onPress={() => props.onChange(null)} bg="transparent" color={TINT.greenText} />
      </View>
    );
  }
  const recording = rec.manualOn;
  return (
    <View style={{ gap: space.xs }}>
      <Pressable onPress={() => void (recording ? rec.manualUp() : rec.manualDown())} disabled={rec.busy && !recording}
        accessibilityRole="button" accessibilityLabel={recording ? 'Stop recording' : props.label}
        style={({ pressed }) => [styles.box, recording ? { backgroundColor: TINT.red, borderColor: `${C.red}55` } : null, pressed && { opacity: 0.8 }]}>
        <View style={[styles.dot, { backgroundColor: recording ? C.red : C.primary }]}>
          <Ico name={recording ? 'stop' : 'mic'} size={18} color={C.white} />
        </View>
        <Text style={[txt.sm, { flex: 1, fontWeight: '600', color: recording ? TINT.redText : C.dark }]}>
          {recording ? `Recording · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')} · tap to stop` : rec.busy ? 'Saving…' : props.label}
        </Text>
      </Pressable>
      {rec.error ? <Text style={[txt.xs, { color: TINT.redText }]}>{rec.error}</Text> : null}
    </View>
  );
}

/** The `voice` slot of ReasonSheet, bound to one passage. */
export function voiceFor(ctx: Ctx, unitId: string, laneId: string, label = 'Say why instead') {
  return ({ hash, onChange }: { hash: string | null; onChange: (h: string | null) => void }) => (
    <VoiceNote ctx={ctx} unitId={unitId} laneId={laneId} label={label} hash={hash} onChange={onChange} />
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.md, paddingVertical: space.sm,
    borderRadius: radius.lg, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  dot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }
});
