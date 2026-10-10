// The help mode provider (demo ADR-038; a-helpMode, a-helpFirst): holds
// whether help is on and which parts of the screen are numbered, and shows
// the explanation card, which steps through the parts with Back and Next
// part. The first time a screen opens it says what the screen is for, once
// per device. It speaks in the recorded voice for the app's language where
// the line has been recorded (helpAudio.ts, decision 80); otherwise the
// browser reads the words aloud on the web, and a device shows them.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { HelpContext, helpLine, screenIntro, type HelpMode, type HelpPart } from './helpContext';
import { currentLocale, t } from './i18n';
import { sayRecorded, stopHelpAudio } from './helpAudio';
import { noteExpected } from './report';
import { C, radius, space, TINT } from './theme';

function speakInBrowser(text: string) {
  if (Platform.OS !== 'web') return;
  const synth = (globalThis as { speechSynthesis?: { cancel: () => void; speak: (u: unknown) => void } }).speechSynthesis;
  const Utterance = (globalThis as { SpeechSynthesisUtterance?: new (t: string) => { lang: string } }).SpeechSynthesisUtterance;
  if (!synth || !Utterance) return;
  try {
    const u = new Utterance(text);
    u.lang = currentLocale();
    synth.cancel();
    synth.speak(u);
  } catch { /* speaking is a nicety */ }
}

function stopSpeaking() {
  stopHelpAudio();
  try { (globalThis as { speechSynthesis?: { cancel: () => void } }).speechSynthesis?.cancel(); } catch { /* nothing was speaking */ }
}

/** The recorded voice if every line has a recording in the app's language, else the browser's voice on the web. */
function speak(...lines: (string | undefined)[]) {
  const words = lines.filter((l): l is string => !!l?.trim());
  stopSpeaking();
  void sayRecorded(...words).then((said) => { if (!said) speakInBrowser(helpLine(words[0] ?? '', words[1])); });
}

/** Set to "off" (or `globalThis.__lqNoIntros`, for tests and screenshots) to skip the first-time intros. */
export const INTROS_KEY = 'help:intros';
const introKey = (screen: string) => `help:intro:v1:${screen}`;

interface IntroApi { intro: (screen: string) => void }
const IntroContext = { current: null as IntroApi | null };

export function HelpModeProvider(props: { children: ReactNode }) {
  const [on, setOnState] = useState(false);
  const [parts, setParts] = useState<HelpPart[]>([]);
  const [shown, setShown] = useState<{ label: string; detail?: string; key?: string } | null>(null);
  const [intro, setIntro] = useState<string | null>(null);
  const setOn = useCallback((v: boolean) => {
    setOnState(v);
    setIntro(null);
    if (!v) { setShown(null); setParts([]); stopSpeaking(); }
  }, []);
  const explain = useCallback((label: string, detail?: string, key?: string) => {
    setShown({ label, ...(detail ? { detail } : {}), ...(key ? { key } : {}) });
    speak(label, detail);
  }, []);
  const register = useCallback((part: HelpPart) => {
    setParts((ps) => [...ps.filter((p) => p.key !== part.key), part]);
    return () => setParts((ps) => ps.filter((p) => p.key !== part.key));
  }, []);
  const value = useMemo<HelpMode>(() => ({ on, setOn, explain, parts, current: shown?.key ?? null, register }),
    [on, setOn, explain, parts, shown?.key, register]);
  IntroContext.current = useMemo(() => ({
    intro: (screen: string) => {
      const text = screenIntro(screen);
      if (!text) return;
      setIntro(text);
      speak(text);
    }
  }), []);

  const closeIntro = () => { setIntro(null); stopSpeaking(); };
  const index = shown?.key ? parts.findIndex((p) => p.key === shown.key) : -1;
  const step = (by: number) => {
    const next = parts[index + by];
    if (next) explain(next.label, next.detail, next.key);
  };
  return (
    <HelpContext.Provider value={value}>
      <View style={{ flex: 1 }}>
        {props.children}
        {on && shown ? (
          <View style={styles.card} accessibilityLiveRegion="polite">
            <View style={styles.head}>
              <View style={styles.playing}><View style={styles.bar} /><View style={styles.bar} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                {index >= 0 ? <Text style={styles.count}>{t('help.card.partPlaying', { part: index + 1, total: parts.length })}</Text> : null}
                <Text style={styles.label}>{shown.label}</Text>
              </View>
            </View>
            {shown.detail ? <Text style={styles.detail}>{t('help.card.quoted', { text: shown.detail })}</Text> : null}
            <View style={styles.row}>
              {index > 0 ? (
                <Pressable onPress={() => step(-1)} accessibilityRole="button" style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.btnText}>{t('common.back')}</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => setShown(null)} accessibilityRole="button" style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.btnText}>{t('help.gotIt')}</Text>
                </Pressable>
              )}
              {index >= 0 && index < parts.length - 1 ? (
                <Pressable onPress={() => step(1)} accessibilityRole="button" style={({ pressed }) => [styles.btn, styles.done, pressed && { opacity: 0.7 }]}>
                  <Text style={[styles.btnText, { color: C.white }]}>{t('help.nextPart')}</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => setOn(false)} accessibilityRole="button" style={({ pressed }) => [styles.btn, styles.done, pressed && { opacity: 0.7 }]}>
                  <Text style={[styles.btnText, { color: C.white }]}>{t('help.turnOff')}</Text>
                </Pressable>
              )}
            </View>
          </View>
        ) : null}
        {intro && !on ? (
          <Pressable style={styles.scrim} onPress={closeIntro} accessibilityLabel={t('common.close')} accessibilityRole="button" />
        ) : null}
        {intro && !on ? (
          <View style={[styles.card, styles.introCard]} accessibilityLiveRegion="polite">
            <View style={styles.head}>
              <View style={[styles.playing, { backgroundColor: C.primary }]}><View style={[styles.bar, { backgroundColor: C.white }]} /><View style={[styles.bar, { backgroundColor: C.white }]} /></View>
              <Text style={[styles.label, { flex: 1 }]}>{t('help.intro.playing', { text: intro })}</Text>
            </View>
            <Text style={styles.detail}>{t('help.intro.explain')}</Text>
            <View style={styles.row}>
              <Pressable onPress={() => setOn(true)} accessibilityRole="button" style={({ pressed }) => [styles.btn, styles.done, { flex: 2 }, pressed && { opacity: 0.7 }]}>
                <Text style={[styles.btnText, { color: C.white }]}>{t('help.intro.showParts')}</Text>
              </Pressable>
              <Pressable onPress={closeIntro} accessibilityRole="button" style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}>
                <Text style={styles.btnText}>{t('help.gotIt')}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </HelpContext.Provider>
  );
}

/** Say what the screen is for the first time it opens on this device (demo a-helpFirst). */
export function useScreenIntro(screen: string, focused: boolean) {
  const help = useContext(HelpContext);
  const done = useRef(false);
  useEffect(() => {
    if (!focused || done.current || !screenIntro(screen) || help?.on) return;
    done.current = true;
    let cancelled = false;
    void (async () => {
      try {
        if ((globalThis as { __lqNoIntros?: boolean }).__lqNoIntros) return;
        if ((await AsyncStorage.getItem(INTROS_KEY)) === 'off') return;
        if (await AsyncStorage.getItem(introKey(screen))) return;
        await AsyncStorage.setItem(introKey(screen), '1');
        if (!cancelled) IntroContext.current?.intro(screen);
      } catch (e) { noteExpected('help intro', e); }
    })();
    return () => { cancelled = true; };
  }, [screen, focused, help?.on]);
}

const styles = StyleSheet.create({
  card: { position: 'absolute', left: space.md, right: space.md, bottom: space.xl, backgroundColor: C.card, borderRadius: radius.xl, padding: space.lg, gap: space.md,
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  introCard: { top: 96, bottom: 'auto' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(28,20,64,0.45)' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  playing: { width: 48, height: 48, borderRadius: 24, backgroundColor: TINT.amberText, flexDirection: 'row', gap: 5, alignItems: 'center', justifyContent: 'center' },
  bar: { width: 5, height: 18, borderRadius: 2, backgroundColor: C.white },
  count: { fontSize: 13, fontWeight: '700', color: TINT.amberText },
  label: { fontSize: 19, fontWeight: '800', color: C.dark },
  detail: { fontSize: 17, lineHeight: 24, color: C.dark },
  row: { flexDirection: 'row', gap: space.sm },
  btn: { flex: 1, minHeight: 52, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  done: { backgroundColor: C.primary, borderColor: C.primary },
  btnText: { fontSize: 17, fontWeight: '700', color: C.dark }
});
