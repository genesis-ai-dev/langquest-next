// The help mode provider (demo ADR-038): holds whether help is on and shows
// the explanation card. On the web it also reads the explanation aloud with
// the browser's own voice; on a device it shows the words until recorded
// help lines exist for each screen.
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { HelpContext, helpLine, type HelpMode } from './helpContext';
import { C, radius, space } from './theme';

function speak(text: string) {
  if (Platform.OS !== 'web') return;
  const synth = (globalThis as { speechSynthesis?: { cancel: () => void; speak: (u: unknown) => void } }).speechSynthesis;
  const Utterance = (globalThis as { SpeechSynthesisUtterance?: new (t: string) => unknown }).SpeechSynthesisUtterance;
  if (!synth || !Utterance) return;
  try { synth.cancel(); synth.speak(new Utterance(text)); } catch { /* speaking is a nicety */ }
}

export function HelpModeProvider(props: { children: ReactNode }) {
  const [on, setOnState] = useState(false);
  const [shown, setShown] = useState<{ label: string; detail?: string } | null>(null);
  const setOn = useCallback((v: boolean) => { setOnState(v); if (!v) setShown(null); }, []);
  const explain = useCallback((label: string, detail?: string) => {
    setShown({ label, ...(detail ? { detail } : {}) });
    speak(helpLine(label, detail));
  }, []);
  const value = useMemo<HelpMode>(() => ({ on, setOn, explain }), [on, setOn, explain]);
  return (
    <HelpContext.Provider value={value}>
      <View style={{ flex: 1 }}>
        {props.children}
        {on && shown ? (
          <View style={styles.card} accessibilityLiveRegion="polite">
            <Text style={styles.label}>{shown.label}</Text>
            {shown.detail ? <Text style={styles.detail}>{shown.detail}</Text> : null}
            <View style={styles.row}>
              <Pressable onPress={() => setShown(null)} accessibilityRole="button" style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}>
                <Text style={styles.btnText}>Got it</Text>
              </Pressable>
              <Pressable onPress={() => setOn(false)} accessibilityRole="button" style={({ pressed }) => [styles.btn, styles.done, pressed && { opacity: 0.7 }]}>
                <Text style={[styles.btnText, { color: C.white }]}>Turn help off</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </HelpContext.Provider>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', left: space.md, right: space.md, bottom: space.xl, backgroundColor: C.card, borderRadius: radius.lg, padding: space.lg, gap: space.sm,
    borderWidth: 2, borderColor: C.amber, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  label: { fontSize: 18, fontWeight: '800', color: C.dark },
  detail: { fontSize: 16, color: C.dark },
  row: { flexDirection: 'row', gap: space.sm },
  btn: { flex: 1, minHeight: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: C.light },
  done: { backgroundColor: C.primary },
  btnText: { fontSize: 16, fontWeight: '700', color: C.primary }
});
