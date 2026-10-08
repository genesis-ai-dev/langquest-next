// The help mode provider (demo ADR-038; a-helpMode, a-helpFirst): holds
// whether help is on and which parts of the screen are numbered, and shows
// the explanation card, which steps through the parts with Back and Next
// part. The first time a screen opens it says what the screen is for, once
// per device. On the web the browser reads the words aloud; on a device
// the words show until recorded help lines exist.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { HelpContext, helpLine, SCREEN_INTROS, type HelpMode, type HelpPart } from './helpContext';
import { noteExpected } from './report';
import { C, radius, space, TINT } from './theme';

function speak(text: string) {
  if (Platform.OS !== 'web') return;
  const synth = (globalThis as { speechSynthesis?: { cancel: () => void; speak: (u: unknown) => void } }).speechSynthesis;
  const Utterance = (globalThis as { SpeechSynthesisUtterance?: new (t: string) => unknown }).SpeechSynthesisUtterance;
  if (!synth || !Utterance) return;
  try { synth.cancel(); synth.speak(new Utterance(text)); } catch { /* speaking is a nicety */ }
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
    if (!v) { setShown(null); setParts([]); }
  }, []);
  const explain = useCallback((label: string, detail?: string, key?: string) => {
    setShown({ label, ...(detail ? { detail } : {}), ...(key ? { key } : {}) });
    speak(helpLine(label, detail));
  }, []);
  const register = useCallback((part: HelpPart) => {
    setParts((ps) => [...ps.filter((p) => p.key !== part.key), part]);
    return () => setParts((ps) => ps.filter((p) => p.key !== part.key));
  }, []);
  const value = useMemo<HelpMode>(() => ({ on, setOn, explain, parts, current: shown?.key ?? null, register }),
    [on, setOn, explain, parts, shown?.key, register]);
  IntroContext.current = useMemo(() => ({
    intro: (screen: string) => {
      const text = SCREEN_INTROS[screen];
      if (!text) return;
      setIntro(text);
      speak(text);
    }
  }), []);

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
                {index >= 0 ? <Text style={styles.count}>{index + 1} of {parts.length} · playing</Text> : null}
                <Text style={styles.label}>{shown.label}</Text>
              </View>
            </View>
            {shown.detail ? <Text style={styles.detail}>“{shown.detail}”</Text> : null}
            <View style={styles.row}>
              {index > 0 ? (
                <Pressable onPress={() => step(-1)} accessibilityRole="button" style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.btnText}>Back</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => setShown(null)} accessibilityRole="button" style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.btnText}>Got it</Text>
                </Pressable>
              )}
              {index >= 0 && index < parts.length - 1 ? (
                <Pressable onPress={() => step(1)} accessibilityRole="button" style={({ pressed }) => [styles.btn, styles.done, pressed && { opacity: 0.7 }]}>
                  <Text style={[styles.btnText, { color: C.white }]}>Next part</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => setOn(false)} accessibilityRole="button" style={({ pressed }) => [styles.btn, styles.done, pressed && { opacity: 0.7 }]}>
                  <Text style={[styles.btnText, { color: C.white }]}>Turn help off</Text>
                </Pressable>
              )}
            </View>
          </View>
        ) : null}
        {intro && !on ? (
          <Pressable style={styles.scrim} onPress={() => setIntro(null)} accessibilityLabel="Close" accessibilityRole="button" />
        ) : null}
        {intro && !on ? (
          <View style={[styles.card, styles.introCard]} accessibilityLiveRegion="polite">
            <View style={styles.head}>
              <View style={[styles.playing, { backgroundColor: C.primary }]}><View style={[styles.bar, { backgroundColor: C.white }]} /><View style={[styles.bar, { backgroundColor: C.white }]} /></View>
              <Text style={[styles.label, { flex: 1 }]}>Playing: “{intro}”</Text>
            </View>
            <Text style={styles.detail}>The first time you open a screen, LangQuest says what it's for. Tap ? any time to hear it again and see what each part does.</Text>
            <View style={styles.row}>
              <Pressable onPress={() => setOn(true)} accessibilityRole="button" style={({ pressed }) => [styles.btn, styles.done, { flex: 2 }, pressed && { opacity: 0.7 }]}>
                <Text style={[styles.btnText, { color: C.white }]}>Show me the parts</Text>
              </Pressable>
              <Pressable onPress={() => setIntro(null)} accessibilityRole="button" style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}>
                <Text style={styles.btnText}>Got it</Text>
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
    if (!focused || done.current || !SCREEN_INTROS[screen] || help?.on) return;
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
