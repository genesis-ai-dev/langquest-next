// Setting up the microphone by ear (decision 71; demo ADR-037; demo
// simple/translator.tsx MicSetup, MicPick): a few seconds of the room's
// quiet set the sensitivity; then one sentence, said, a pause, said again,
// three times, each try with a slightly different pause; the person hears
// the three and picks the best. Nobody has to learn what a sensitivity or a
// pause length is. "Adjust by hand" keeps the old controls (the cutoff line
// over the level meter and the three pause lengths). The choice is kept on
// the device (micSettings.ts) and every recorder starts from it.
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { AudioModule } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import MicrophoneEnergy from '../../modules/microphone-energy';
import { registerPlayback, setSessionAudioMode, stopAudioPlayback } from '../audioSession';
import type { Ctx } from '../ctx';
import { useHelpPress } from '../helpContext';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { Header, Ico, PrimaryBtn, Screen, txt } from '../kit';
import { noteExpected } from '../report';
import { C, radius, space, target, TINT, type as T, withAlpha } from '../theme';
import { claimVad, MicrophoneRefused, useEnergyHistory, VAD_BASE } from '../useRecorder';
import { cachedMicSettings, loadMicSettings, saveMicSettings } from './micSettings';
import { DEFAULT_MIC, MIC_TRIES, mmss, QUIET_MS, thresholdFromNoise, type MicSettings } from './model';
import { QuietLink, RecordBtn, styles as ps } from './parts';

/** The sentence said in each try, in the language showing. */
const sentence = () => t('recording.micSetup.sentence');

/** Why the microphone did not start: a refusal says so; anything else, that it could not start. */
function micProblem(e: unknown): string {
  return e instanceof MicrophoneRefused ? t('recording.recorder.permissionNeeded') : t('recording.micSetup.couldNotStart');
}

interface Segment { uri: string; durationMs: number }
type Phase = 'start' | 'quiet' | 'try' | 'pick' | 'hand';

/** Speaks the sentence where the device can (the web's speech); null where it cannot. */
function speaker(): ((text: string) => void) | null {
  const g = globalThis as { speechSynthesis?: { cancel: () => void; speak: (u: unknown) => void }; SpeechSynthesisUtterance?: new (t: string) => unknown };
  if (Platform.OS !== 'web' || !g.speechSynthesis || !g.SpeechSynthesisUtterance) return null;
  const synth = g.speechSynthesis;
  const Utterance = g.SpeechSynthesisUtterance;
  return (text) => { try { synth.cancel(); synth.speak(new Utterance(text)); } catch { /* a nicety */ } };
}

/** The microphone for this screen alone: the meter, and the voice detector with given settings. Nothing it hears is kept. */
function useProbe() {
  const live = useRef(true);
  const on = useRef(false);
  const segments = useRef<Segment[]>([]);
  const levels = useRef<number[]>([]);
  const self = useRef(Symbol('mic setup')).current;
  useEffect(() => {
    live.current = true;
    const subs = [
      MicrophoneEnergy.addListener('onEnergyResult', (e) => { levels.current.push(e.energy); }),
      MicrophoneEnergy.addListener('onSegmentComplete', (e) => { if (e.uri) segments.current.push({ uri: e.uri, durationMs: e.duration }); })
    ];
    return () => {
      live.current = false;
      void stop().finally(() => subs.forEach((s) => s.remove()));
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function open(vad: MicSettings | null) {
    stopAudioPlayback();
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) throw new MicrophoneRefused();
    if (vad) await MicrophoneEnergy.configureVAD({ ...VAD_BASE, threshold: vad.threshold, silenceDuration: vad.pauseMs });
    await setSessionAudioMode({ allowsRecording: true, playsInSilentMode: true });
    levels.current = [];
    segments.current = [];
    await MicrophoneEnergy.startEnergyDetection();
    // What these tries hear is this screen's alone, never a part of a recording left open underneath.
    claimVad(self);
    if (vad) await MicrophoneEnergy.enableVAD();
    on.current = true;
  }
  async function stop() {
    if (!on.current) return;
    on.current = false;
    try {
      await MicrophoneEnergy.disableVAD();
      await MicrophoneEnergy.stopEnergyDetection();
    } catch (e) { noteExpected('mic setup: stop', e); }
    await setSessionAudioMode({ allowsRecording: false, playsInSilentMode: true }).catch((e: unknown) => noteExpected('mic setup: session', e));
  }
  return { open, stop, segments, levels, live };
}

/** Plays a try's parts one after another. */
function useTryPlayer() {
  const [playing, setPlaying] = useState<number | null>(null);
  const player = useRef<AudioPlayer | null>(null);
  const run = useRef(0);
  const halt = () => { run.current++; player.current?.remove(); player.current = null; setPlaying(null); };
  useEffect(() => registerPlayback(halt), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => halt(), []); // eslint-disable-line react-hooks/exhaustive-deps
  async function play(i: number, parts: Segment[]) {
    if (playing === i) { halt(); return; }
    stopAudioPlayback();
    const me = ++run.current;
    setPlaying(i);
    await setSessionAudioMode({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    const next = (k: number) => {
      if (run.current !== me) return;
      player.current?.remove();
      player.current = null;
      if (k >= parts.length) { setPlaying(null); return; }
      try {
        const p = createAudioPlayer({ uri: parts[k]!.uri });
        player.current = p;
        p.addListener('playbackStatusUpdate', (st) => { if (player.current === p && (st.didJustFinish || st.error)) next(k + 1); });
        p.play();
      } catch (e) { noteExpected('mic setup: play', e); setPlaying(null); }
    };
    next(0);
  }
  return { playing, play: (i: number, parts: Segment[]) => void play(i, parts), halt };
}

export function MicSetupScreen(props: { ctx: Ctx }) {
  const { ctx } = props;
  const probe = useProbe();
  const tryPlayer = useTryPlayer();
  const [phase, setPhase] = useState<Phase>('start');
  const [threshold, setThreshold] = useState(DEFAULT_MIC.threshold);
  const [tries, setTries] = useState<Segment[][]>([]);
  const [listening, setListening] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [problem, setProblem] = useState('');
  const [picked, setPicked] = useState(1);
  const [saving, setSaving] = useState(false);
  const speak = speaker();
  const at = tries.length;

  useEffect(() => {
    if (!listening) return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [listening]);

  async function listenToRoom() {
    setProblem('');
    try {
      await probe.open(null);
      setPhase('quiet');
      setListening(true);
      await new Promise((r) => setTimeout(r, QUIET_MS));
      if (!probe.live.current) return;
      const level = thresholdFromNoise(probe.levels.current);
      await probe.stop();
      setListening(false);
      setThreshold(level);
      setTries([]);
      setPhase('try');
    } catch (e) {
      setListening(false);
      await probe.stop();
      setPhase('start');
      setProblem(micProblem(e));
    }
  }

  async function toggleTry() {
    setProblem('');
    if (!listening) {
      try {
        await probe.open({ threshold, pauseMs: MIC_TRIES[at]!.pauseMs });
        setListening(true);
      } catch (e) {
        await probe.stop();
        setProblem(micProblem(e));
      }
      return;
    }
    await probe.stop();
    setListening(false);
    // The last part arrives as the detector stops.
    await new Promise((r) => setTimeout(r, 300));
    const heard = [...probe.segments.current];
    if (heard.length === 0) { setProblem(t('recording.micSetup.nothingHeard')); return; }
    const next = [...tries, heard];
    setTries(next);
    if (next.length >= MIC_TRIES.length) setPhase('pick');
  }

  async function use() {
    const pick = MIC_TRIES[picked]!;
    setSaving(true);
    try {
      await saveMicSettings({ threshold, pauseMs: pick.pauseMs });
      ctx.toast(t('recording.micSetup.setUp', { id: pick.id }));
      ctx.back();
    } catch (e) {
      noteExpected('mic setup: save', e);
      ctx.toast(t('recording.micSetup.notSaved'));
    } finally { setSaving(false); }
  }

  function again() {
    tryPlayer.halt();
    setTries([]);
    setPicked(1);
    setPhase('start');
  }

  if (phase === 'hand') return <ByHand ctx={ctx} onDone={() => setPhase('start')} />;

  if (phase === 'pick') {
    return (
      <Screen header={<Header title={t('recording.micSetup.whichBest')} sub={t('recording.micSetup.title')} onBack={ctx.back} close />}
        footer={<PrimaryBtn label={t('recording.micSetup.useTry', { id: MIC_TRIES[picked]!.id })} icon="check" busy={saving} onPress={() => void use()} />}>
        <Text style={[styles.lead, { textAlign: 'center' }]}>{t('recording.micSetup.listenToEach')}</Text>
        {MIC_TRIES.map((tr, i) => (
          <TryRow key={tr.id} id={tr.id} parts={tries[i] ?? []} on={picked === i} playing={tryPlayer.playing === i}
            onPlay={() => tryPlayer.play(i, tries[i] ?? [])} onPick={() => setPicked(i)} />
        ))}
        <QuietLink label={t('recording.micSetup.allBad')} onPress={again} />
        <QuietLink label={t('recording.micSetup.byHand')} icon="sliders" hint={t('recording.micSetup.byHandHelp')} onPress={() => { tryPlayer.halt(); setPhase('hand'); }} />
      </Screen>
    );
  }

  const quiet = phase === 'start' || phase === 'quiet';
  const tryOf = t('recording.micSetup.tryOf', { n: formatNumber(at + 1), total: formatNumber(MIC_TRIES.length) });
  return (
    <Screen fixed header={<Header title={t('recording.micSetup.title')} sub={t('recording.micSetup.aboutAMinute')} onBack={ctx.back} close />}>
      <View style={styles.page}>
        <View style={styles.segments} accessibilityLabel={quiet ? t('recording.micSetup.beforeTries') : tryOf}>
          {MIC_TRIES.map((tr, i) => <View key={tr.id} style={[styles.segment, { backgroundColor: !quiet && i < at ? C.green : !quiet && i === at ? C.primary : C.border }]} />)}
        </View>
        <Text style={[txt.smMuted, { textAlign: 'center' }]}>{quiet ? t('recording.micSetup.firstTheRoom') : tryOf}</Text>
        <View style={styles.card}>
          {quiet ? (
            <>
              <Text style={[txt.label, { textAlign: 'center' }]}>{t('recording.micSetup.quietTitle')}</Text>
              <Text style={styles.sentence}>{t('recording.micSetup.quietBody')}</Text>
            </>
          ) : (
            <>
              <Text style={[txt.label, { textAlign: 'center' }]}>{t('recording.micSetup.sayThis')}</Text>
              <Text style={styles.sentence}>{t('recording.quoted', { text: sentence() })}</Text>
              {speak ? <HearIt onPress={() => speak(sentence())} /> : null}
            </>
          )}
        </View>
        <View style={{ flex: 1, minHeight: space.md }} />
        <View style={{ alignItems: 'center' }}>
          {phase === 'quiet' ? (
            <View style={styles.quietMark}><Ico name="listen" size={44} color={C.primary} /></View>
          ) : (
            <RecordBtn size={120} recording={listening} onPress={() => void (quiet ? listenToRoom() : toggleTry())} />
          )}
        </View>
        <Text style={styles.status} accessibilityLiveRegion="polite">
          {phase === 'quiet' ? t('recording.micSetup.listeningToRoom', { time: mmss(seconds * 1000) })
            : listening ? t('recording.listening', { time: mmss(seconds * 1000) }) : quiet ? t('recording.micSetup.tapToStart') : t('recording.micSetup.tapThenSay')}
        </Text>
        {problem ? <Text style={[txt.error, { textAlign: 'center' }]} accessibilityRole="alert">{problem}</Text> : null}
        <Text style={[txt.smMuted, { textAlign: 'center' }]}>
          {quiet ? t('recording.micSetup.thenThreeTimes') : t('recording.micSetup.eachTry')}
        </Text>
        {phase === 'start' ? <QuietLink label={t('recording.micSetup.byHand')} icon="sliders" hint={t('recording.micSetup.byHandHelp')} onPress={() => setPhase('hand')} /> : null}
      </View>
    </Screen>
  );
}

function HearIt(props: { onPress: () => void }) {
  const onPress = useHelpPress(t('recording.micSetup.hearIt'), t('recording.micSetup.hearItHelp'), props.onPress);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.hear, pressed && ps.pressed]}>
      <Ico name="listen" size={18} color={C.primary} />
      <Text style={[txt.sm, { color: C.primary, fontWeight: '700' }]}>{t('recording.micSetup.hearIt')}</Text>
    </Pressable>
  );
}

function TryRow(props: { id: string; parts: Segment[]; on: boolean; playing: boolean; onPlay: () => void; onPick: () => void }) {
  const ms = props.parts.reduce((a, p) => a + p.durationMs, 0);
  const name = t('recording.micSetup.tryName', { id: props.id });
  const playLabel = props.playing ? t('common.pause') : t('recording.micSetup.playTry', { id: props.id });
  const play = useHelpPress(playLabel, t('recording.micSetup.playTryHelp'), props.onPlay);
  const pick = useHelpPress(name, t('recording.micSetup.chooseThis'), props.onPick);
  return (
    <Pressable onPress={pick} accessibilityRole="radio" accessibilityState={{ selected: props.on }} accessibilityLabel={t('recording.micSetup.tryLabel', { id: props.id, length: mmss(ms) })}
      style={({ pressed }) => [styles.tryRow, props.on && { borderColor: C.primary }, pressed && ps.pressed]}>
      <Pressable onPress={play} accessibilityRole="button" accessibilityLabel={playLabel}
        style={({ pressed }) => [styles.tryPlay, pressed && ps.pressed]}>
        <Ico name={props.playing ? 'pause' : 'play'} size={24} color={C.white} strokeWidth={2.6} fill={C.white} />
      </Pressable>
      <Text style={[styles.tryName, { flex: 1 }]}>{name} <Text style={styles.tryLength}>· {mmss(ms)}</Text></Text>
      <View style={[styles.radio, props.on && { borderColor: C.primary }]}>{props.on ? <View style={styles.radioDot} /> : null}</View>
    </Pressable>
  );
}

/** The three pause lengths, named in the language showing. */
function pauseChoices(): { ms: number; label: string }[] {
  return [
    { ms: 500, label: t('recording.pauses.short') },
    { ms: 1000, label: t('recording.pauses.normal') },
    { ms: 2000, label: t('recording.pauses.long') }
  ];
}

/**
 * The old controls, for anyone who would rather set them (moved here from
 * the recording screen): the live level with the cutoff line to drag, and
 * the pause that ends a part.
 */
function ByHand(props: { ctx: Ctx; onDone: () => void }) {
  const probe = useProbe();
  const saved = cachedMicSettings() ?? DEFAULT_MIC;
  const [cutoff, setCutoff] = useState(saved.threshold);
  const [pause, setPause] = useState(saved.pauseMs);
  const [height, setHeight] = useState(1);
  const [problem, setProblem] = useState('');
  const latest = useRef({ height, cutoff });
  latest.current = { height, cutoff };
  const start = useRef(0);
  useEffect(() => {
    void loadMicSettings().then((m) => { if (m) { setCutoff(m.threshold); setPause(m.pauseMs); } });
    probe.open(null).catch((e: unknown) => setProblem(micProblem(e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { start.current = latest.current.cutoff; },
    onPanResponderMove: (_, g) => setCutoff(Math.max(0.04, Math.min(0.92, start.current - g.dy / latest.current.height)))
  })).current;
  async function save() {
    await saveMicSettings({ threshold: Math.round(cutoff * 1000) / 1000, pauseMs: pause });
    props.ctx.toast(t('recording.micSetup.settingsSaved'));
    props.ctx.back();
  }
  return (
    <Screen header={<Header title={t('recording.micSetup.byHand')} sub={t('recording.micSetup.title')} onBack={props.onDone} />}
      footer={<PrimaryBtn label={t('recording.micSetup.saveSettings')} icon="check" onPress={() => void save()} />}>
      <Text style={styles.lead}>{t('recording.micSetup.byHandLead')}</Text>
      <View style={styles.meter} onLayout={(e) => setHeight(e.nativeEvent.layout.height)} {...pan.panHandlers}
        accessible accessibilityRole="adjustable" accessibilityLabel={t('recording.micSetup.sensitivityLine')} accessibilityValue={{ min: 4, max: 92, now: Math.round(cutoff * 100) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => setCutoff((c) => Math.max(0.04, Math.min(0.92, c + (e.nativeEvent.actionName === 'increment' ? 0.02 : -0.02))))}>
        <Bars />
        <View style={[{ pointerEvents: 'none' }, styles.cutoff, { top: `${(1 - cutoff) * 100}%` }]} />
      </View>
      {problem ? <Text style={txt.error} accessibilityRole="alert">{problem}</Text> : null}
      <Text style={[txt.label, { paddingHorizontal: space.xs }]}>{t('recording.micSetup.pauseEndsPart')}</Text>
      <View style={styles.pauses} accessibilityRole="radiogroup">
        {pauseChoices().map((p, i) => <PauseChip key={p.ms} label={p.label} dots={i + 1} on={p.ms === pause} onPress={() => setPause(p.ms)} />)}
      </View>
    </Screen>
  );
}

function Bars() {
  const history = useEnergyHistory(false, 48);
  return <>{history.map((b, i) => <View key={i} style={[styles.bar, { height: `${Math.max(2, Math.pow(Math.min(1, Math.max(0, b.energy)), 0.6) * 100)}%` }]} />)}</>;
}

function PauseChip(props: { label: string; dots: number; on: boolean; onPress: () => void }) {
  const onPress = useHelpPress(props.label, t('recording.micSetup.pauseHelp'), props.onPress);
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: props.on }} accessibilityLabel={props.label}
      style={({ pressed }) => [styles.pause, props.on && { backgroundColor: C.primary, borderColor: C.primary }, pressed && ps.pressed]}>
      <View style={{ flexDirection: 'row', gap: 5 }}>
        {Array.from({ length: props.dots }, (_, i) => <View key={i} style={[styles.pauseDot, { backgroundColor: props.on ? C.white : C.primary }]} />)}
      </View>
      <Text style={[txt.xsStrong, { color: props.on ? C.white : C.dark }]}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'stretch', gap: space.lg, paddingTop: space.sm, paddingHorizontal: space.xl, paddingBottom: space.xl },
  segments: { flexDirection: 'row', justifyContent: 'center', gap: space.sm },
  segment: { width: 40, height: 6, borderRadius: 3 },
  card: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: 1, borderColor: C.border, padding: space.lg + 2, gap: space.sm, alignItems: 'center' },
  sentence: { fontSize: T.xl, fontWeight: '800', color: C.dark, textAlign: 'center', lineHeight: 31 },
  hear: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: target.min, paddingHorizontal: space.lg, borderRadius: radius.full, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg, marginTop: space.xs },
  quietMark: { width: 120, height: 120, borderRadius: 60, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  status: { fontSize: T.base, fontWeight: '800', color: C.dark, textAlign: 'center' },
  lead: { fontSize: T.base, lineHeight: 24, color: C.muted },
  tryRow: { flexDirection: 'row', alignItems: 'center', gap: space.md + 2, padding: space.md + 2, borderRadius: radius.xl, borderWidth: 2, borderColor: C.border, backgroundColor: C.card },
  tryPlay: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  tryName: { fontSize: T.xl - 2, fontWeight: '800', color: C.dark },
  tryLength: { fontSize: T.sm, fontWeight: '600', color: C.muted },
  radio: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: C.faint, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: C.primary },
  meter: { height: 180, flexDirection: 'row', alignItems: 'flex-end', gap: 2, padding: space.sm, borderRadius: radius.lg, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  bar: { flex: 1, borderRadius: 2, backgroundColor: withAlpha(C.primary, 0.7) },
  cutoff: { position: 'absolute', left: 0, right: 0, borderTopWidth: 2, borderStyle: 'dashed', borderColor: TINT.redText },
  pauses: { flexDirection: 'row', gap: space.sm },
  pause: { flex: 1, minHeight: 64, borderRadius: radius.lg, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', gap: 6 },
  pauseDot: { width: 7, height: 7, borderRadius: 4 }
});
