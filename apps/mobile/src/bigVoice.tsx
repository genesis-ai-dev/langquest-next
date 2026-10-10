// The big round microphone on Ryder's "say it" screens (decision 71; demo
// a-keepWhy, r-ReviewSayWhy): tap to speak, tap to stop, then hear it back
// or say it again. Like VoiceNote, the audio lands in the content-addressed
// store and is named only by the event that uses it (decisions.md 30).
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './text';
import { AudioClip } from './audioClip';
import { clipSeconds, clock } from './clipPlayer';
import type { Ctx } from './ctx';
import { useHelpPress } from './helpContext';
import { t } from './i18n';
import { Ico, txt } from './kit';
import { C, radius, space, TINT, withAlpha } from './theme';
import { useRecorder, type RecordedCard } from './useRecorder';

export function BigVoice(props: {
  ctx: Ctx;
  /** "Tap and say why" */
  label: string;
  hash: string | null;
  onChange: (hash: string | null, card?: { durationMs: number; format: 'wav' | 'm4a' }) => void;
  /** The red recording colour (feedback) rather than the brand (a reason). */
  red?: boolean;
}) {
  const latest = useRef(props);
  latest.current = props;
  const [length, setLength] = useState(0);
  const persist = (card: RecordedCard) => {
    setLength(card.durationMs / 1000);
    latest.current.onChange(card.ref.hash, { durationMs: card.durationMs, format: card.ref.format });
  };
  const rec = useRecorder(persist);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!rec.manualOn) return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, [rec.manualOn]);
  const recording = rec.manualOn;
  const toggle = useHelpPress(props.label, t('recording.bigVoice.toggleHelp'), () => void (recording ? rec.manualUp() : rec.manualDown()));
  const again = useHelpPress(t('recording.bigVoice.sayAgain'), t('recording.bigVoice.sayAgainHelp'), () => props.onChange(null));

  if (props.hash && !recording) {
    const secs = length || clipSeconds(props.ctx.language.state, [props.hash]);
    return (
      <View style={styles.done}>
        <View style={styles.heard}>
          <AudioClip language={props.ctx.language} hashes={[props.hash]} label={t('recording.bigVoice.playWhatYouSaid')} />
          <Text style={[txt.body, { fontWeight: '800', color: TINT.greenText }]}>{secs > 0 ? t('recording.bigVoice.whatYouSaidLength', { length: clock(secs) }) : t('recording.bigVoice.whatYouSaid')}</Text>
        </View>
        <Pressable onPress={again} accessibilityRole="button" style={({ pressed }) => [styles.again, pressed && { opacity: 0.7 }]}>
          <Ico name="restart" size={18} color={C.dark} />
          <Text style={[txt.sm, { fontWeight: '700' }]}>{t('recording.bigVoice.sayAgain')}</Text>
        </Pressable>
      </View>
    );
  }
  const tone = recording || props.red ? C.red : C.primary;
  return (
    <View style={{ alignItems: 'center', gap: space.md }}>
      <Pressable onPress={toggle} disabled={rec.busy && !recording} accessibilityRole="button" accessibilityLabel={recording ? t('common.stopRecording') : props.label}
        style={({ pressed }) => [styles.halo, { backgroundColor: withAlpha(tone, 0.16) }, pressed && { opacity: 0.85 }]}>
        <View style={[styles.mic, { backgroundColor: tone }]}>
          <Ico name={recording ? 'stop' : 'mic'} size={recording ? 40 : 52} color={C.white} />
        </View>
      </Pressable>
      <Text style={[txt.body, { fontWeight: '800', fontSize: 19 }]}>
        {recording ? t('recording.listening', { time: clock(elapsed) }) : rec.busy ? t('common.saving') : props.label}
      </Text>
      {recording ? <Text style={txt.xs}>{t('recording.bigVoice.tapToStop')}</Text> : null}
      {rec.error ? <Text style={[txt.xs, { color: TINT.redText }]}>{rec.error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  halo: { width: 164, height: 164, borderRadius: 82, alignItems: 'center', justifyContent: 'center' },
  mic: { width: 132, height: 132, borderRadius: 66, alignItems: 'center', justifyContent: 'center' },
  done: { alignItems: 'center', gap: space.md },
  heard: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, paddingLeft: space.sm, paddingRight: space.xl,
    borderRadius: radius.full, backgroundColor: TINT.green },
  again: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, paddingHorizontal: space.lg, borderRadius: radius.lg,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.card }
});
