// What a disguised phone shows in front of LangQuest (decisions.md 167): a
// calculator that works, or a notepad that keeps what is written on it. The
// code opens the app: on the calculator as its last digit is typed, on the
// notepad as a line of its own. A wrong code does what the calculator or
// notepad would do anyway. Nothing here says LangQuest, and help mode never
// shows over it, so its keys carry no help.
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../i18n';
import { Text } from '../ui/text';
import { keepNotes, savedNotes } from './disguise';
import { CALC_START, isDigit, keypadCandidate, noteCandidates, press, withoutCode, type DisguiseKind, type Key } from './disguiseModel';

export interface FaceProps {
  kind: DisguiseKind;
  /** The code's length, once read; until then nothing typed is checked. */
  length: number | null;
  /** Tries what was typed as the code: true when it opened the app. */
  onCandidate: (candidate: string) => boolean | Promise<boolean>;
  /** Above the face, for trying a new code before it is kept: a way back and what to do. */
  top?: (tone: string) => ReactNode;
  /** Whether the notepad keeps its note: the disguise does, a try does not. */
  keep?: boolean;
}

export function DisguiseFace(props: FaceProps) {
  return props.kind === 'calculator' ? <CalculatorFace {...props} /> : <NotesFace {...props} />;
}

// ---- calculator -------------------------------------------------------------------------

const PAD = 16;
const GAP = 12;
const KEY_MAX = 88;

type Tone = 'num' | 'fn' | 'op';
const TONES: Record<Tone, { bg: string; pressed: string; text: string }> = {
  num: { bg: '#2E2F33', pressed: '#5C5E64', text: '#FFFFFF' },
  fn: { bg: '#A9ABB0', pressed: '#D6D7DA', text: '#111111' },
  op: { bg: '#EE9A2C', pressed: '#F6C987', text: '#FFFFFF' }
};

interface KeyDef { key: Key; tone: Tone; wide?: boolean; label: string }

function keyName(key: Key): string {
  switch (key) {
    case 'AC': return t('disguise.keys.clear');
    case '⌫': return t('disguise.keys.delete');
    case '%': return t('disguise.keys.percent');
    case '÷': return t('disguise.keys.divide');
    case '×': return t('disguise.keys.times');
    case '−': return t('disguise.keys.minus');
    case '+': return t('disguise.keys.plus');
    case '=': return t('disguise.keys.equals');
    case '.': return t('disguise.keys.point');
    default: return key;
  }
}

const ROWS: readonly (readonly KeyDef[])[] = [
  [{ key: 'AC', tone: 'fn', label: 'AC' }, { key: '⌫', tone: 'fn', label: '⌫' }, { key: '%', tone: 'fn', label: '%' }, { key: '÷', tone: 'op', label: '÷' }],
  [{ key: '7', tone: 'num', label: '7' }, { key: '8', tone: 'num', label: '8' }, { key: '9', tone: 'num', label: '9' }, { key: '×', tone: 'op', label: '×' }],
  [{ key: '4', tone: 'num', label: '4' }, { key: '5', tone: 'num', label: '5' }, { key: '6', tone: 'num', label: '6' }, { key: '−', tone: 'op', label: '−' }],
  [{ key: '1', tone: 'num', label: '1' }, { key: '2', tone: 'num', label: '2' }, { key: '3', tone: 'num', label: '3' }, { key: '+', tone: 'op', label: '+' }],
  [{ key: '0', tone: 'num', label: '0', wide: true }, { key: '.', tone: 'num', label: '.' }, { key: '=', tone: 'op', label: '=' }]
];

function CalculatorFace(props: FaceProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const size = Math.min((Math.min(width, 520) - PAD * 2 - GAP * 3) / 4, KEY_MAX);
  const [calc, setCalc] = useState(CALC_START);
  const now = useRef(CALC_START);
  const { length, onCandidate } = props;
  const tap = useCallback((key: Key) => {
    const next = press(now.current, key);
    now.current = next;
    setCalc(next);
    // Checked on every digit, so the code alone opens it: no = to remember.
    const candidate = isDigit(key) && length !== null ? keypadCandidate(next.typed, length) : null;
    if (candidate) void onCandidate(candidate);
  }, [length, onCandidate]);
  return (
    <View style={[styles.calc, { paddingTop: insets.top, paddingBottom: insets.bottom + GAP }]}>
      <StatusBar style="light" />
      {props.top?.('#FFFFFF')}
      <View style={styles.display}>
        <Text style={styles.displayText} numberOfLines={1} adjustsFontSizeToFit accessibilityLiveRegion="polite">{calc.display}</Text>
      </View>
      <View style={styles.pad}>
        {/* help-each: a calculator's keys, each its own */}
        {ROWS.map((row, i) => (
          <View key={i} style={styles.row}>
            {/* help-each: a row of a calculator's keys, each its own */}
            {row.map((k) => <CalcKey key={k.key} def={k} size={size} active={calc.fresh && calc.op === k.key} onPress={tap} />)}
          </View>
        ))}
      </View>
    </View>
  );
}

function CalcKey(props: { def: KeyDef; size: number; active: boolean; onPress: (key: Key) => void }) {
  const { def, size } = props;
  const tone = TONES[def.tone];
  return (
    // help-ignore: a calculator key in front of the app; help mode never shows over the disguise
    <Pressable onPress={() => props.onPress(def.key)} accessibilityRole="button" accessibilityLabel={keyName(def.key)}
      style={({ pressed }) => [styles.key, {
        width: def.wide ? size * 2 + GAP : size, height: size, borderRadius: size / 2,
        backgroundColor: pressed ? tone.pressed : props.active ? '#FFFFFF' : tone.bg,
        alignItems: def.wide ? 'flex-start' : 'center', paddingLeft: def.wide ? size * 0.38 : 0
      }]}>
      <Text style={{ fontSize: size * 0.4, fontWeight: '500', color: props.active ? tone.bg : tone.text }}>{def.label}</Text>
    </Pressable>
  );
}

// ---- notepad ----------------------------------------------------------------------------

function NotesFace(props: FaceProps) {
  const insets = useSafeAreaInsets();
  const keep = props.keep ?? false;
  const [text, setText] = useState(() => (keep ? savedNotes() : ''));
  const latest = useRef(text);
  const { length, onCandidate } = props;
  const change = useCallback((value: string) => {
    latest.current = value;
    setText(value);
    if (keep) keepNotes(value);
    if (length === null) return;
    for (const candidate of noteCandidates(value, length)) {
      void Promise.resolve(onCandidate(candidate)).then((opened) => {
        if (!opened || !keep) return;
        // The line that held the code goes, so the note never shows it.
        const kept = withoutCode(latest.current, candidate);
        keepNotes(kept);
        setText(kept);
      });
    }
  }, [keep, length, onCandidate]);
  const input = useRef<TextInput>(null);
  useEffect(() => {
    const id = setTimeout(() => input.current?.focus(), 300);
    return () => clearTimeout(id);
  }, []);
  const title = t('disguise.notesTitle');
  return (
    <View style={[styles.notes, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      {props.top?.('#1C1C1E')}
      <Text style={styles.notesTitle} accessibilityRole="header">{title}</Text>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* help-ignore: the notepad in front of the app; help mode never shows over the disguise */}
        <TextInput ref={input} value={text} onChangeText={change} multiline textAlignVertical="top" accessibilityLabel={title}
          style={[styles.notesInput, { paddingBottom: insets.bottom + 16 }]} />
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  calc: { flex: 1, backgroundColor: '#000000' },
  display: { flex: 1, justifyContent: 'flex-end', alignItems: 'flex-end', paddingHorizontal: 28, paddingBottom: 12 },
  displayText: { color: '#FFFFFF', fontSize: 80, fontWeight: '300' },
  pad: { alignItems: 'center', gap: GAP, paddingHorizontal: PAD },
  row: { flexDirection: 'row', gap: GAP },
  key: { justifyContent: 'center' },
  notes: { flex: 1, backgroundColor: '#FFFDF6' },
  notesTitle: { fontSize: 32, fontWeight: '700', color: '#1C1C1E', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  notesInput: { flex: 1, fontSize: 18, lineHeight: 26, color: '#1C1C1E', paddingHorizontal: 20, paddingTop: 8 }
});
