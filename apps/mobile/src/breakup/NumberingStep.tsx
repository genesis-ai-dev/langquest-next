// Which numbering does the team's Bible use? (decision 80,
// docs/breaking-up-the-bible.md). Chosen once, for the whole Bible, before
// anything is divided. One question a screen, answered with big buttons:
// find the Bible the team translates from, or answer a few questions with
// it open, or (one tap deeper) choose from the list. The result is shown
// as three facts that tell the numberings apart at a glance.
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useHelpPress } from '../helpContext';
import { GhostBtn, Ico, SearchField, type IconName } from '../kit';
import { ChoiceCard, Question, RadioRow } from '../simple/admin';
import { C, radius, space, TINT, type as T } from '../theme';
import {
  COMMON_BIBLES, KNOWN_BIBLES, QUIZ, resolveNumbering, shortName, type KnownBible, type NumberingCode, type NumberingFacts, type QuizOption
} from './numberingGuide';

export interface NumberingChoice {
  code: string;
  itemId: string;
  name: string;
  description: string;
  hash: string;
}

/** Three facts side by side: how many books, Malachi's chapters, and whether psalm headings are numbered. */
export function FactTiles(props: { facts: NumberingFacts | null }) {
  const f = props.facts;
  if (!f) return null;
  return (
    <View style={styles.tiles}>
      <View style={styles.tile} accessibilityLabel={`${f.books} books`}>
        <Text style={styles.big}>{f.books}</Text>
        <Text style={styles.tileLabel}>books</Text>
      </View>
      <View style={styles.tile} accessibilityLabel={`Malachi has ${f.malachi} chapters`}>
        <View style={styles.bars}>{Array.from({ length: f.malachi }, (_, i) => <View key={i} style={styles.bar} />)}</View>
        <Text style={styles.tileLabel}>Malachi</Text>
        <Text style={styles.tileValue}>{f.malachi} chapters</Text>
      </View>
      <View style={styles.tile} accessibilityLabel={f.headings ? 'Psalm headings are verse 1' : 'Psalm headings have no number'}>
        <PsalmLines numbered={f.headings} small />
        <Text style={styles.tileLabel}>Psalm headings</Text>
        <Text style={styles.tileValue}>{f.headings ? 'verse 1' : 'no number'}</Text>
      </View>
    </View>
  );
}

/** The top of Psalm 3, drawn: the heading with or without a verse number. */
function PsalmLines(props: { numbered: boolean; small?: boolean }) {
  const s = props.small;
  const line = (n: string | null, heading: boolean, words: string) => (
    <View style={styles.pline}>
      <Text style={[styles.vnum, s && { fontSize: 11, width: 12 }]}>{n ?? ''}</Text>
      {s ? <View style={[styles.stroke, heading && styles.strokeHeading]} />
        : <Text style={[txt2.line, heading && txt2.heading]} numberOfLines={1}>{words}</Text>}
    </View>
  );
  return (
    <View style={{ gap: s ? 4 : 6, alignSelf: 'stretch' }}>
      {line(props.numbered ? '1' : null, true, 'A psalm of David')}
      {line(props.numbered ? '2' : '1', false, 'Lord, how many are my foes!')}
    </View>
  );
}

/** A full-width outlined button for the other ways to answer. */
function OtherWay(props: { icon: IconName; label: string; onPress: () => void }) {
  const onPress = useHelpPress(props.label, undefined, props.onPress);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.other, pressed && { opacity: 0.7 }]}>
      <Ico name={props.icon} size={20} color={C.primary} />
      <Text style={styles.otherText}>{props.label}</Text>
    </Pressable>
  );
}

/** Which Bible do you translate from? Typing finds it; what other languages here use comes first. */
export function FindBiblePage(props: {
  numberings: NumberingChoice[];
  usedIn: Record<string, string[]>;
  onPick: (code: string, from?: string, note?: string) => void;
  onQuiz: () => void;
  onList: () => void;
}) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const [note, setNote] = useState('');
  const offered = props.numberings.map((n) => n.code);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t) return KNOWN_BIBLES.filter((b) => `${b.name} ${b.abbr} ${b.language}`.toLowerCase().includes(t)).slice(0, 20);
    return all ? KNOWN_BIBLES : COMMON_BIBLES.map((a) => KNOWN_BIBLES.find((b) => b.abbr === a)!).filter(Boolean);
  }, [q, all]);
  const choose = (b: KnownBible) => {
    const r = resolveNumbering(b.numbering, b.nearest, offered);
    if (r.code) { setNote(''); props.onPick(r.code, b.name, r.note); } else setNote(r.note ?? '');
  };
  const used = Object.entries(props.usedIn).map(([code, langs]) => ({ n: props.numberings.find((x) => x.code === code), langs })).filter((x) => x.n);
  return (
    <>
      <Question>Which Bible do you translate from?</Question>
      {used.map(({ n, langs }) => (
        <ChoiceCard key={n!.code} on={false} icon="people" title={shortName(n!.name)} sub={`Used in ${langs.join(', ')}`} onPress={() => props.onPick(n!.code)} />
      ))}
      <SearchField value={q} onChangeText={setQ} placeholder="NIV, Reina-Valera, Luther…" />
      {note ? <Text style={[txt2.note]}>{note}</Text> : null}
      <View style={{ gap: space.sm }}>
        {shown.map((b) => <RadioRow key={b.abbr} icon="book" label={b.name} sub={b.language} on={false} onPress={() => choose(b)} />)}
        {!q.trim() && !all ? <GhostBtn label={`Show all ${KNOWN_BIBLES.length}`} icon="down" onPress={() => setAll(true)} /> : null}
        {q.trim() && shown.length === 0 ? <Text style={txt2.muted}>Not found.</Text> : null}
      </View>
      <View style={{ gap: space.sm, marginTop: space.sm }}>
        <OtherWay icon="help" label="Not listed? Answer a few questions" onPress={props.onQuiz} />
        <OtherWay icon="list" label="Choose from the list" onPress={props.onList} />
      </View>
    </>
  );
}

/** The quiz, one question a screen, with the team's Bible open. */
export function QuizPage(props: {
  numberings: NumberingChoice[];
  /** The questions asked so far, the current one last; Back steps through them. */
  trail: string[];
  setTrail: (f: (t: string[]) => string[]) => void;
  onDone: (code: string, note?: string) => void;
  onList: () => void;
}) {
  const { trail, setTrail } = props;
  const [note, setNote] = useState('');
  const at = trail[trail.length - 1]!;
  const q = QUIZ.questions[at]!;
  const answer = (o: QuizOption) => {
    if (o.next) { setNote(''); setTrail((t) => [...t, o.next!]); return; }
    const r = resolveNumbering((o.to ?? 'eng') as NumberingCode, o.to === 'custom' ? 'eng' : undefined, props.numberings.map((n) => n.code));
    if (r.code) props.onDone(r.code, r.note); else setNote(r.note ?? '');
  };
  const tiles = q.options.every((o) => o.tile);
  return (
    <>
      <Text style={txt2.step}>Question {trail.length}</Text>
      <Question>{q.title}</Question>
      {q.small ? <Text style={[txt2.muted, { marginTop: -space.sm }]}>{q.small}</Text> : null}
      {q.quote ? <View style={styles.quote}><Text style={styles.quoteText}>“{q.quote}”</Text></View> : null}
      {q.picture === 'extraBooks' ? (
        <View style={styles.booksRow}>{['Tobit', 'Judith', 'Maccabees'].map((b) => (
          <View key={b} style={styles.bookChip}><Ico name="book" size={18} color={C.primary} /><Text style={styles.bookText}>{b}</Text></View>
        ))}</View>
      ) : null}
      {q.picture === 'psalm3' ? (
        <View style={{ gap: space.md }}>
          {q.options.map((o, i) => (
            <Pressable key={o.label} onPress={() => answer(o)} accessibilityRole="button" accessibilityLabel={o.label}
              style={({ pressed }) => [styles.page, pressed && styles.pressed]}>
              <Text style={styles.pageTitle}>Psalm 3</Text>
              <PsalmLines numbered={i === 1} />
            </Pressable>
          ))}
        </View>
      ) : tiles ? (
        <View style={styles.tileRow}>
          {q.options.map((o) => (
            <Pressable key={o.label} onPress={() => answer(o)} accessibilityRole="button" accessibilityLabel={o.label}
              style={({ pressed }) => [styles.answer, pressed && styles.pressed]}>
              <Text style={styles.answerText}>{o.tile}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          {q.options.map((o) => <RadioRow key={o.label} icon="building" label={o.label} on={false} onPress={() => answer(o)} />)}
        </View>
      )}
      {note ? <Text style={txt2.note}>{note}</Text> : null}
      {q.notSure ? <GhostBtn label={q.notSure.label} icon="help" onPress={() => answer(q.notSure!)} /> : null}
      {note ? <OtherWay icon="list" label="Choose from the list" onPress={props.onList} /> : null}
    </>
  );
}

/** Every numbering, each with its three facts. */
export function NumberingListPage(props: { numberings: NumberingChoice[]; factsFor: (n: NumberingChoice) => NumberingFacts | null; onPick: (code: string) => void }) {
  return (
    <>
      <Question>Choose the numbering</Question>
      {props.numberings.map((n) => {
        const f = props.factsFor(n);
        return (
          <ChoiceCard key={n.code} on={false} icon="book" title={shortName(n.name)} onPress={() => props.onPick(n.code)}>
            {f ? (
              <View style={styles.chips}>
                <Text style={styles.chip}>{f.books} books</Text>
                <Text style={styles.chip}>Malachi {f.malachi}</Text>
                <Text style={styles.chip}>{f.headings ? 'Headings verse 1' : 'Headings no number'}</Text>
              </View>
            ) : null}
          </ChoiceCard>
        );
      })}
      {props.numberings.length === 0 ? <Text style={txt2.muted}>Connect to load the numberings.</Text> : null}
    </>
  );
}

/** The numbering chosen: its name, where it came from, and its three facts. */
export function NumberingChosenPage(props: { choice: NumberingChoice; facts: NumberingFacts | null; from?: string; note?: string; onChange: () => void }) {
  return (
    <>
      <View style={styles.done}><Ico name="done" size={40} color={C.green} /></View>
      <Question>{shortName(props.choice.name)}</Question>
      {props.from ? <Text style={[txt2.muted, { marginTop: -space.sm }]}>Like {props.from}</Text> : null}
      <FactTiles facts={props.facts} />
      {props.note ? <Text style={txt2.note}>{props.note}</Text> : null}
      <Text style={txt2.muted}>Verse numbers in LangQuest will match your Bible.</Text>
      <GhostBtn label="Choose another" icon="swap" onPress={props.onChange} />
    </>
  );
}

/** Above the next questions: the numbering chosen, and a way back to change it. */
export function NumberingContext(props: { choice: NumberingChoice; onPress: () => void }) {
  const onPress = useHelpPress('Numbering', 'Tap to change the numbering.', props.onPress);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Numbering: ${shortName(props.choice.name)}. Change`}
      style={({ pressed }) => [styles.context, pressed && styles.pressed]}>
      <Ico name="book" size={18} color={C.primary} />
      <Text style={styles.contextText} numberOfLines={1}>{shortName(props.choice.name)}</Text>
      <Text style={styles.contextChange}>Change</Text>
    </Pressable>
  );
}

const txt2 = StyleSheet.create({
  muted: { fontSize: T.sm, color: C.muted },
  note: { fontSize: T.sm, color: TINT.amberText, fontWeight: '600' },
  step: { fontSize: T.xs, color: C.muted, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  line: { flex: 1, fontSize: T.base, color: C.dark },
  heading: { fontStyle: 'italic', color: C.muted, fontSize: T.sm }
});

const styles = StyleSheet.create({
  pressed: { opacity: 0.75 },
  tiles: { flexDirection: 'row', gap: space.sm },
  tile: { flex: 1, minHeight: 112, backgroundColor: C.card, borderRadius: radius.lg, borderWidth: 1, borderColor: C.border, padding: space.sm, alignItems: 'center', justifyContent: 'center', gap: 4 },
  big: { fontSize: 34, fontWeight: '800', color: C.primary, lineHeight: 40 },
  tileLabel: { fontSize: T.xs, color: C.muted, fontWeight: '700', textAlign: 'center' },
  tileValue: { fontSize: T.xs, color: C.dark, fontWeight: '800', textAlign: 'center' },
  bars: { flexDirection: 'row', gap: 3, height: 34, alignItems: 'flex-end' },
  bar: { width: 9, height: 26, borderRadius: 2, backgroundColor: C.primary },
  pline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  vnum: { width: 16, fontSize: T.xs, fontWeight: '800', color: C.primary, textAlign: 'right' },
  stroke: { flex: 1, height: 5, borderRadius: 3, backgroundColor: C.dark, opacity: 0.55 },
  strokeHeading: { backgroundColor: C.faint, opacity: 1 },
  other: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, minHeight: 56, borderRadius: radius.lg, borderWidth: 2, borderColor: C.primary, backgroundColor: C.card, paddingHorizontal: space.md },
  otherText: { color: C.primary, fontWeight: '800', fontSize: T.base },
  quote: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: 1, borderColor: C.border, paddingVertical: space.xl, paddingHorizontal: space.lg, alignItems: 'center' },
  quoteText: { fontSize: T.xl, fontWeight: '700', color: C.dark, textAlign: 'center', fontStyle: 'italic' },
  tileRow: { flexDirection: 'row', gap: space.md },
  answer: { flex: 1, height: 112, borderRadius: radius.xl, backgroundColor: C.card, borderWidth: 2, borderColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  answerText: { fontSize: 44, fontWeight: '800', color: C.primary },
  page: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: 2, borderColor: C.primary, padding: space.lg, gap: space.sm },
  pageTitle: { fontSize: T.lg, fontWeight: '800', color: C.dark },
  booksRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'center' },
  bookChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.card, borderRadius: radius.full, borderWidth: 1, borderColor: C.border, paddingHorizontal: space.md, paddingVertical: space.sm },
  bookText: { fontSize: T.base, fontWeight: '700', color: C.dark },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { fontSize: T.xs, fontWeight: '700', color: C.dark, backgroundColor: C.light, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4, overflow: 'hidden' },
  done: { alignItems: 'center', marginTop: space.md },
  context: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, borderRadius: radius.full, backgroundColor: C.light, paddingHorizontal: space.md, alignSelf: 'flex-start' },
  contextText: { flexShrink: 1, fontSize: T.sm, fontWeight: '700', color: C.dark },
  contextChange: { fontSize: T.sm, fontWeight: '800', color: C.primary }
});
