// Which numbering does the team's Bible use? (decision 80,
// docs/breaking-up-the-bible.md). Chosen once, for the whole Bible, before
// anything is divided: it decides which books exist and how their chapters
// and verses run. Three ways to find it: by the Bible the team translates
// from, by its name, or with a short quiz. What other languages here use is
// offered first.
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useHelpPress } from '../helpContext';
import { GhostBtn, Ico, PrimaryBtn, SearchField, SectionLabel, Sheet, txt } from '../kit';
import { ChoiceCard, RadioRow } from '../simple/admin';
import { C, radius, space, TINT } from '../theme';
import { KNOWN_BIBLES, QUIZ, resolveNumbering, type KnownBible, type NumberingCode, type QuizOption } from './numberingGuide';

export interface NumberingChoice {
  code: string;
  itemId: string;
  name: string;
  description: string;
  hash: string;
}

/** Malachi 4:1 in one numbering is Malachi 3:19 in another: the example every explanation uses. */
export function NumberingExample() {
  return (
    <View style={styles.example} accessibilityLabel="Example: the verse that is Malachi 4:1 in most English Bibles is Malachi 3:19 in Bibles numbered like the Hebrew.">
      <Text style={[txt.sm, { color: C.dark }]}>“The day is coming, burning like an oven”</Text>
      <View style={styles.row}>
        <Text style={[txt.xs, styles.who]}>Most English Bibles</Text>
        <View style={styles.cards}>{['3', '4'].map((c) => <View key={c} style={[styles.card, c === '4' && styles.cardOn]}><Text style={[txt.xs, c === '4' && styles.onText]}>{c === '4' ? 'Malachi 4:1' : 'Malachi 3'}</Text></View>)}</View>
      </View>
      <View style={styles.row}>
        <Text style={[txt.xs, styles.who]}>Like the Hebrew</Text>
        <View style={styles.cards}><View style={[styles.card, styles.cardOn, { flex: 2 }]}><Text style={[txt.xs, styles.onText]}>Malachi 3:19 (no chapter 4)</Text></View></View>
      </View>
    </View>
  );
}

/** The numbering step: the choice made, or three ways to make it. */
export function NumberingStep(props: {
  numberings: NumberingChoice[];
  value: NumberingChoice | null;
  onChange: (n: NumberingChoice) => void;
  /** What other languages here use, by numbering code: "Dinka". */
  usedIn: Record<string, string[]>;
}) {
  const [open, setOpen] = useState<'bible' | 'name' | 'quiz' | null>(null);
  // Said under the choice when a found Bible or the quiz only came near (a Bible that mixes numberings).
  const [near, setNear] = useState('');
  const byCode = (code: string) => props.numberings.find((n) => n.code === code) ?? null;
  const suggested = Object.entries(props.usedIn).map(([code, langs]) => ({ n: byCode(code), langs })).filter((x) => x.n && x.n !== props.value);
  const pick = (n: NumberingChoice | null, note = '') => { if (n) props.onChange(n); setNear(n ? note : ''); setOpen(null); };
  const find = useHelpPress('Find our Bible', 'Search for the Bible your team translates from.', () => setOpen('bible'));
  return (
    <>
      <SectionLabel label="Which numbering does your Bible use?" />
      <Text style={[txt.sm, { color: C.muted, marginTop: -space.sm }]}>
        Bibles number some verses differently, and some have books others don't. Choose your team's, so translators see the numbers their Bible prints.
      </Text>
      <NumberingExample />
      {props.value ? (
        <ChoiceCard on icon="book" title={props.value.name} sub={props.value.description} onPress={() => setOpen('name')} />
      ) : null}
      {props.value && near ? <Text style={[txt.sm, { color: TINT.amberText }]}>{near}</Text> : null}
      {suggested.map(({ n, langs }) => (
        <ChoiceCard key={n!.code} on={false} icon="swap" title={n!.name} sub={`Used in ${langs.join(', ')}`} onPress={() => pick(n)} />
      ))}
      <View style={styles.ways}>
        <Pressable onPress={find} accessibilityRole="button" style={({ pressed }) => [styles.way, pressed && { opacity: 0.7 }]}>
          <Ico name="search" size={18} color={C.primary} /><Text style={styles.wayText}>Find our Bible</Text>
        </Pressable>
        <WayButton icon="list" label="Choose the numbering" onPress={() => setOpen('name')} />
        <WayButton icon="help" label="Take the quiz" onPress={() => setOpen('quiz')} />
      </View>
      <BibleSheet visible={open === 'bible'} onClose={() => setOpen(null)} onPick={(code, note) => pick(byCode(code), note)} offered={props.numberings} />
      <Sheet visible={open === 'name'} title="Choose the numbering" sub="One for the whole Bible." onClose={() => setOpen(null)}>
        {props.numberings.map((n) => (
          <RadioRow key={n.code} icon="book" label={n.name} sub={n.description} on={props.value?.code === n.code} onPress={() => pick(n)} />
        ))}
        {props.numberings.length === 0 ? <Text style={txt.smMuted}>Connect to load the numberings.</Text> : null}
      </Sheet>
      <QuizSheet visible={open === 'quiz'} onClose={() => setOpen(null)} onDone={(code, note) => pick(byCode(code), note)} offered={props.numberings} />
    </>
  );
}

function WayButton(props: { icon: 'list' | 'help'; label: string; onPress: () => void }) {
  const onPress = useHelpPress(props.label, undefined, props.onPress);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.way, pressed && { opacity: 0.7 }]}>
      <Ico name={props.icon} size={18} color={C.primary} /><Text style={styles.wayText}>{props.label}</Text>
    </Pressable>
  );
}

function BibleSheet(props: { visible: boolean; onClose: () => void; onPick: (code: string, note?: string) => void; offered: NumberingChoice[] }) {
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? KNOWN_BIBLES.filter((b) => `${b.name} ${b.abbr} ${b.language}`.toLowerCase().includes(t)) : KNOWN_BIBLES).slice(0, 40);
  }, [q]);
  const choose = (b: KnownBible) => {
    const r = resolveNumbering(b.numbering, b.nearest, props.offered.map((n) => n.code));
    if (r.code) { setNote(''); props.onPick(r.code, r.note); } else setNote(r.note ?? '');
  };
  return (
    <Sheet visible={props.visible} title="Find our Bible" sub="The Bible your team translates from." onClose={() => { setNote(''); props.onClose(); }}>
      <SearchField value={q} onChangeText={setQ} placeholder="NIV, Reina-Valera, Luther…" />
      {note ? <Text style={[txt.sm, { color: TINT.amberText }]}>{note}</Text> : null}
      {shown.map((b) => (
        <RadioRow key={b.abbr} icon="book" label={b.name} sub={`${b.language} · ${b.abbr}`} on={false} onPress={() => choose(b)} />
      ))}
      <Text style={txt.smMuted}>Not listed? Take the quiz instead.</Text>
    </Sheet>
  );
}

function QuizSheet(props: { visible: boolean; onClose: () => void; onDone: (code: string, note?: string) => void; offered: NumberingChoice[] }) {
  const [at, setAt] = useState(QUIZ.start);
  const [steps, setSteps] = useState(0);
  const [note, setNote] = useState('');
  const q = QUIZ.questions[at]!;
  const reset = () => { setAt(QUIZ.start); setSteps(0); setNote(''); };
  const answer = (o: QuizOption) => {
    if (o.next) { setAt(o.next); setSteps((n) => n + 1); return; }
    const r = resolveNumbering((o.to ?? 'eng') as NumberingCode, o.to === 'custom' ? 'eng' : undefined, props.offered.map((n) => n.code));
    if (r.code) { reset(); props.onDone(r.code, r.note); } else setNote(r.note ?? '');
  };
  return (
    <Sheet visible={props.visible} title="Take the quiz" sub={`Question ${steps + 1} · a few short ones, with your Bible open`} onClose={() => { reset(); props.onClose(); }}
      footer={steps > 0 ? <GhostBtn label="Start again" icon="restart" onPress={reset} /> : undefined}>
      <Text style={txt.h3}>{q.ask}</Text>
      {q.hint ? <Text style={txt.smMuted}>{q.hint}</Text> : null}
      {note ? <Text style={[txt.sm, { color: TINT.amberText }]}>{note}</Text> : null}
      {q.options.map((o) => <PrimaryBtn key={o.label} label={o.label} onPress={() => answer(o)} tone="dark" />)}
      {q.notSure ? <GhostBtn label={q.notSure.label} icon="help" onPress={() => answer(q.notSure!)} /> : null}
      {q.skip ? <GhostBtn label={q.skip.label} icon="skip" onPress={() => answer(q.skip!)} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  example: { backgroundColor: C.card, borderRadius: radius.lg, borderWidth: 1, borderColor: C.border, padding: space.md, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  who: { width: 112, color: C.muted },
  cards: { flex: 1, flexDirection: 'row', gap: 4 },
  card: { flex: 1, borderRadius: 6, borderWidth: 1, borderColor: C.border, paddingVertical: 6, alignItems: 'center', backgroundColor: C.bg },
  cardOn: { backgroundColor: C.light, borderColor: C.primary },
  onText: { color: C.primary, fontWeight: '700' },
  ways: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  way: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, minHeight: 44, borderRadius: radius.full, borderWidth: 1.5, borderColor: C.primary, backgroundColor: C.card },
  wayText: { color: C.primary, fontWeight: '700', fontSize: 15 }
});
