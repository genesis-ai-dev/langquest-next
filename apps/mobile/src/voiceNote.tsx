// A voice note anywhere text is optional (a reason, feedback, directions,
// what changed): tap to record, tap to stop. The audio lands in the
// content-addressed store and is named only by the note, review or reason
// that uses it (docs/decisions.md 30); that event is what uploads it. A
// voice note someone records and then abandons never reaches the log.
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AudioClip } from './audioClip';
import type { Ctx } from './ctx';
import { t } from './i18n';
import { formatClock } from './i18n/format';
import { Ico, IconBtn, txt } from './kit';
import { C, radius, space, TINT } from './theme';
import { useRecorder, type RecordedCard } from './useRecorder';

export function VoiceNote(props: {
  ctx: Ctx;
  label: string;
  hash: string | null;
  /** The hash, and the card's length and format for events that keep them (review artifacts). */
  onChange: (hash: string | null, card?: { durationMs: number; format: 'wav' | 'm4a' }) => void;
}) {
  const latest = useRef(props);
  latest.current = props;
  // The recorder has already put the file in the blob store; the hash is
  // all the note needs. No journal target: nothing is appended until the
  // note itself is saved.
  const persist = (card: RecordedCard) => { latest.current.onChange(card.ref.hash, { durationMs: card.durationMs, format: card.ref.format }); };
  const rec = useRecorder(persist);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!rec.manualOn) return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, [rec.manualOn]);

  if (props.hash && !rec.manualOn) {
    return (
      <View style={[styles.box, { backgroundColor: TINT.green, borderColor: `${C.green}55` }]}>
        <View style={{ flex: 1 }}>
          <AudioClip language={props.ctx.language} hashes={[props.hash]} label={t('recording.voiceNote.play')} />
        </View>
        <IconBtn name="trash" label={t('recording.voiceNote.delete')} onPress={() => props.onChange(null)} bg="transparent" color={TINT.greenText} />
      </View>
    );
  }
  const recording = rec.manualOn;
  return (
    <View style={{ gap: space.xs }}>
      <Pressable onPress={() => void (recording ? rec.manualUp() : rec.manualDown())} disabled={rec.busy && !recording}
        accessibilityRole="button" accessibilityLabel={recording ? t('common.stopRecording') : props.label}
        style={({ pressed }) => [styles.box, recording ? { backgroundColor: TINT.red, borderColor: `${C.red}55` } : null, pressed && { opacity: 0.8 }]}>
        <View style={[styles.dot, { backgroundColor: recording ? C.red : C.primary }]}>
          <Ico name={recording ? 'stop' : 'mic'} size={18} color={C.white} />
        </View>
        <Text style={[txt.sm, { flex: 1, fontWeight: '600', color: recording ? TINT.redText : C.dark }]}>
          {recording ? t('recording.voiceNote.recording', { time: formatClock(elapsed * 1000) }) : rec.busy ? t('common.saving') : props.label}
        </Text>
      </Pressable>
      {rec.error ? <Text style={[txt.xs, { color: TINT.redText }]}>{rec.error}</Text> : null}
    </View>
  );
}

/** The `voice` slot of ReasonSheet. */
export function voiceFor(ctx: Ctx, label?: string) {
  return ({ hash, onChange }: { hash: string | null; onChange: (h: string | null) => void }) => (
    <VoiceNote ctx={ctx} label={label ?? t('recording.voiceNote.sayWhyInstead')} hash={hash} onChange={onChange} />
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.md, paddingVertical: space.sm,
    borderRadius: radius.lg, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  dot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }
});
