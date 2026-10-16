// The recorder pane while recording (Caleb, 2026-10-16): the pane below the
// divider turns into the recording view, red from start to stop, as the
// back translation's was (the VadTakeover panel it replaces). Its top row says what is being
// recorded (the part, and its verses when it is said again in a deleted
// part's place) and has a check, Done, that leaves the session, keeping
// every part as its box stands, and goes back to the parts; the
// rest is the live waveform, each kept part boxed and numbered as it is
// said (LiveParts.tsx, the "Recordings getting cut off" thread's). Stop stays in the footer,
// and stopping keeps the session open (LAN-82): the boxes can be heard,
// moved and dropped until Done, and the big button carries on recording. The reference above
// stays readable and playable. While the Bible plays the microphone is
// paused: the pane turns pale and says so, with Resume now.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { HelpBadge } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { t } from '../i18n';
import { HelpInfo, Ico, IconBtn } from '../ui/kit';
import { C, radius, space, target, TINT, type as T, withAlpha } from '../ui/theme';
import type { useRecorder } from './useRecorder';
import { loopStatus, type LoopNoun, type LoopPhase } from './splitModel';
import { mmss } from './workspaceModel';
import { LiveParts } from './LiveParts';
import { liveKept } from './livePartsModel';
import { ConfirmDelete } from '../ui/ConfirmDelete';
import { useHardwareBack } from '../ui/useHardwareBack';

type Recorder = ReturnType<typeof useRecorder>;

/** The reduce-motion setting, kept current (A11Y-8). */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => { if (live) setReduce(on); }, () => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => { live = false; sub.remove(); };
  }, []);
  return reduce;
}

/** Pulses while capturing; with reduce motion on, it is simply bright. */
function PulsingDot(props: { on: boolean }) {
  const pulse = useRef(new Animated.Value(1)).current;
  const still = useReduceMotion();
  useEffect(() => {
    if (!props.on) { pulse.setValue(0.4); return; }
    if (still) { pulse.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.35, duration: 500, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true })
    ]));
    loop.start();
    return () => loop.stop();
  }, [props.on, pulse, still]);
  return <Animated.View style={[styles.dot, { opacity: pulse }]} />;
}

/** Time spent recording this session, not counting time paused for the source. Ticks on its own. */
function Elapsed(props: { running: boolean; color: string }) {
  const total = useRef(0);
  const since = useRef<number | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!props.running) return;
    since.current = Date.now();
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      clearInterval(id);
      if (since.current !== null) total.current += Date.now() - since.current;
      since.current = null;
    };
  }, [props.running]);
  const ms = total.current + (since.current !== null ? Date.now() - since.current : 0);
  return <Text style={[styles.time, { color: props.color }]} accessibilityLabel={t('recording.vad.recordedFor', { time: mmss(ms) })}>{mmss(ms)}</Text>;
}

export function RecordingView(props: {
  rec: Recorder; phase: LoopPhase;
  /** What is being recorded: "Part 3". */
  title: string;
  /** Its number: the waveform numbers the parts kept from the one recording when the view opened. */
  partNumber: number;
  /** How many are kept so far, and what they are called, for the status a screen reader hears. */
  count: number; noun: LoopNoun;
  /** Its verses, when it takes a deleted part's. */
  tile?: ReactNode;
  onLeave: () => void; onResume: () => void;
  /** The ✕: stop recording for the question, then throw the session away (Caleb, 2026-10-16). */
  onStop: () => Promise<void>; onDiscard: () => void;
}) {
  const { rec } = props;
  const listening = props.phase === 'listening';
  const stopped = props.phase === 'stopped';
  const capturing = rec.vadCapturing && props.phase === 'recording';
  const fg = listening ? TINT.redText : C.white;
  const status = listening ? t('recording.recorder.pausedForBible') : stopped ? t('recording.recorder.stopped')
    : capturing ? t('recording.recorder.recordingNow') : t('recording.recorder.listeningPause');
  // The waveform numbers the parts from where they go; a part recorded into a gap changes that, until the first is said.
  const session = rec.session;
  useEffect(() => { session?.setFirst(props.partNumber); }, [session, props.partNumber]);
  // Throwing a session away asks first, with what it holds; one with nothing kept just goes.
  const [asking, setAsking] = useState<{ count: number; ms: number } | null>(null);
  const discard = () => {
    const kept = session ? liveKept(session.snapshot()) : [];
    if (kept.length === 0) { props.onDiscard(); return; }
    setAsking({ count: kept.length, ms: kept.reduce((n, k) => n + (k.toMs - k.fromMs), 0) });
    void props.onStop();
  };
  const resume = useHelpSpot(t('recording.resumeNow'), t('recording.vad.resumeHelp'), listening ? props.onResume : undefined);
  // A phone's Back is the ✓ (decision 136): it keeps every part said and goes back to the parts, never out of the screen.
  useHardwareBack(true, props.onLeave);
  return (
    <View style={[styles.panel, { backgroundColor: listening ? TINT.red : capturing ? C.red : TINT.redText }]}>
      <View style={styles.head}>
        <IconBtn name="close" label={t('recording.recorder.discard')} help={t('recording.recorder.discardHelp')} bg="transparent" color={fg} size={target.min} onPress={discard} />
        {props.tile ? <View style={styles.tile}>{props.tile}</View> : null}
        <HelpInfo style={{ flex: 1, minWidth: 0 }} label={`${props.title}. ${status}`} detail={listening ? t('recording.vad.statusPausedHelp') : stopped ? t('recording.recorder.stoppedHelp') : t('recording.recorder.nextRecordingHelp')}>
          <View accessible accessibilityLabel={t('recording.recorder.nextLabel', { part: props.title, status })}>
            <Text style={[styles.title, { color: fg }]} numberOfLines={1}>{props.title}</Text>
          </View>
          {/* Read politely as it changes, with how many are kept so far (the waveform's boxes show it; screen readers hear it). */}
          <View style={styles.statusRow} accessible accessibilityLiveRegion="polite" accessibilityLabel={loopStatus(props.phase, rec.vadCapturing, props.count, props.noun)}>
            {listening ? <Ico name="pause" size={14} color={fg} /> : stopped ? <View style={styles.stop} /> : <PulsingDot on={capturing} />}
            <Text style={[styles.status, { color: fg }]} numberOfLines={1}>{status}</Text>
          </View>
        </HelpInfo>
        <Elapsed running={props.phase === 'recording'} color={fg} />
        {/* Done, not close (Caleb, 2026-10-16): an X reads as throwing away what was said; a check keeps it all. */}
        <IconBtn name="check" label={t('recording.recorder.leave')} help={t('recording.recorder.leaveHelp')} bg={listening ? C.card : C.white} color={listening ? TINT.redText : C.red} size={target.min} onPress={props.onLeave} />
      </View>
      {listening ? (
        <View style={styles.paused}>
          <Pressable onPress={resume.onPress} accessibilityRole="button" accessibilityLabel={t('recording.resumeRecordingNow')}
            style={({ pressed }) => [styles.resume, pressed && { opacity: 0.8 }]}>
            <Ico name="mic" size={18} color={C.white} />
            <Text style={styles.resumeLabel}>{t('recording.resumeNow')}</Text>
            <HelpBadge spot={resume} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.wave}>
          {/* Stopped, the status row's help says what the boxes do. */}
          <LiveParts session={session} tone="onRed" paused={rec.vadPaused} editing={stopped} onDrop={rec.dropPart} onMoved={rec.notePart} />
        </View>
      )}
      {rec.error ? <Text style={styles.error} accessibilityRole="alert">{rec.error}</Text> : null}
      <ConfirmDelete visible={asking !== null} name={props.title} title={t('recording.recorder.discardAsk')} confirmLabel={t('recording.recorder.discardConfirm')}
        sub={asking ? t('recording.parts.groupSub', { count: asking.count, length: mmss(asking.ms) }) : ''}
        onClose={() => setAsking(null)} onConfirm={() => { setAsking(null); props.onDiscard(); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm + 2, minHeight: 56 },
  tile: { borderRadius: radius.md + 2, backgroundColor: withAlpha(C.white, 0.9) },
  title: { fontSize: T.lg, fontWeight: '800' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  status: { fontSize: T.sm, fontWeight: '600' },
  wave: { flex: 1, minHeight: 56, paddingBottom: space.xs },
  paused: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  resume: { minHeight: target.min, paddingHorizontal: space.lg, borderRadius: radius.full, backgroundColor: TINT.redText, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  resumeLabel: { color: C.white, fontSize: T.sm, fontWeight: '700' },
  error: { color: C.white, fontSize: T.sm, textAlign: 'center' },
  dot: { width: 10, height: 10, borderRadius: radius.full, backgroundColor: C.white },
  stop: { width: 10, height: 10, borderRadius: 2, backgroundColor: C.white },
  time: { fontSize: T.lg, fontWeight: '700', fontVariant: ['tabular-nums'] }
});
