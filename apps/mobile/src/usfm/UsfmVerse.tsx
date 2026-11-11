// An uploaded Bible's verse as its file sets it out (LAN-230, decision 209): the
// headings above it, its lines of prose and poetry, and its notes below. Every
// reader draws these around its own row: the tap, the number and the marks on
// key words stay the reader's own.
import type { UsfmHeadingStyle, UsfmLine, UsfmPiece, UsfmSpan } from '@langquest-next/core';
import { Fragment, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';
import { t } from '../i18n';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { C, space, type as T } from '../ui/theme';
import type { VerseRow } from '../sources/model';
import { stackOf, type UsfmFit } from './readerModel';

const HEADING: Record<UsfmHeadingStyle, TextStyle> = {
  major: { fontSize: T.base, fontWeight: '800', textAlign: 'center', color: C.dark, marginTop: space.sm },
  section: { fontSize: T.base, fontWeight: '800', color: C.dark, marginTop: space.sm },
  reference: { fontSize: T.sm, fontStyle: 'italic', color: C.muted },
  speaker: { fontSize: T.sm, fontWeight: '700', fontStyle: 'italic', color: C.dark, marginTop: space.xs },
  title: { fontSize: T.sm, fontStyle: 'italic', color: C.muted, marginTop: space.xs }
};

const LOOK: Record<NonNullable<UsfmSpan['style']>, TextStyle> = {
  italic: { fontStyle: 'italic' }, bold: { fontWeight: '700' }, boldItalic: { fontWeight: '700', fontStyle: 'italic' }, smallCaps: { fontVariant: ['small-caps'] }
};

function HeadingLine(props: { style: UsfmHeadingStyle; text: string }) {
  return <Text accessibilityRole="header" style={HEADING[props.style]}>{props.text}</Text>;
}

/** Above a verse: the Bible's own name for the chapter, where one starts, and the headings that lead to this verse. */
export function UsfmAbove(props: { row: VerseRow }) {
  const u = props.row.usfm;
  if (!u) return null;
  const { above } = stackOf(u.verse);
  if (!u.chapterHead && above.length === 0) return null;
  return (
    <View style={styles.above}>
      {u.chapterHead ? <Text accessibilityRole="header" style={styles.chapterHead}>{u.chapterHead}</Text> : null}
      {above.map((h, i) => <HeadingLine key={i} style={h.style} text={h.text} />)}
    </View>
  );
}

function Spans(props: { spans: readonly UsfmSpan[]; words?: (text: string) => ReactNode }) {
  return (
    <>
      {props.spans.map((s, i) => {
        if (s.mark === 'note') return <Text key={i} style={styles.noteMark}>{s.text}</Text>;
        if (s.mark === 'verse') return <Text key={i} style={styles.verseMark}>{s.text}</Text>;
        return <Text key={i} style={s.style ? LOOK[s.style] : undefined}>{props.words ? props.words(s.text) : s.text}</Text>;
      })}
    </>
  );
}

const lineStyle = (l: UsfmLine, first: boolean): TextStyle => ({
  ...(l.gap && !first ? { marginTop: space.sm } : {}),
  ...(l.indent ? { marginStart: l.indent * space.lg } : {}),
  ...(l.style === 'center' ? { textAlign: 'center' } : l.style === 'right' ? { textAlign: 'right' } : {}),
  ...(l.style === 'title' ? { fontStyle: 'italic' } : {})
});

/**
 * A verse's words, line by line. `number` starts the first line, for a reader
 * that keeps a verse's number in its text; `words` draws a run of plain words,
 * for a reader that marks key words in them. `end` follows the last line.
 */
export function UsfmLines(props: { pieces: readonly UsfmPiece[]; number?: ReactNode; end?: ReactNode; style?: StyleProp<TextStyle>; words?: (text: string) => ReactNode }) {
  const lastLine = props.pieces.map((p) => p.kind).lastIndexOf('line');
  let started = false;
  return (
    <>
      {props.pieces.map((p, i) => {
        if (p.kind === 'heading') return <HeadingLine key={i} style={p.style} text={p.text} />;
        const first = !started;
        started = true;
        return (
          <Text key={i} style={[props.style, lineStyle(p, first)]}>
            {first ? props.number : null}
            <Spans spans={p.spans} {...(props.words ? { words: props.words } : {})} />
            {i === lastLine ? props.end : null}
          </Text>
        );
      })}
      {lastLine < 0 && (props.number || props.end) ? <Text style={props.style}>{props.number}{props.end}</Text> : null}
    </>
  );
}

/** Below a verse: its notes, each with the letter that marks it in the text. */
export function UsfmNotes(props: { row: VerseRow }) {
  const notes = props.row.usfm?.verse.notes ?? [];
  if (notes.length === 0) return null;
  return (
    <View style={styles.notes}>
      {notes.map((n, i) => (
        <Text key={i} style={txt.xs}>
          {n.call ? <Text style={styles.noteMark}>{n.call} </Text> : null}
          {n.kind === 'crossref' ? <Text style={{ fontWeight: '700' }}>{t('sources.reader.usfmCrossRef')} </Text> : null}
          {n.ref ? <Text style={{ fontWeight: '700' }}>{n.ref} </Text> : null}
          <Spans spans={n.spans} />
        </Text>
      ))}
    </View>
  );
}

/** Above the verses: where this Bible numbers the passage differently, and which verses it does not have. */
export function UsfmFitNote(props: { fit: UsfmFit | undefined }) {
  const f = props.fit;
  if (!f || (!f.renumbered && f.missing.length === 0)) return null;
  return (
    <View style={styles.fit} accessibilityRole="summary">
      {f.renumbered ? <Text style={txt.xs}>{t('sources.reader.usfmRenumbered', { verses: f.renumbered })}</Text> : null}
      {f.missing.length ? <Text style={txt.xs}>{t('sources.reader.usfmMissing', { verses: f.missing.join(t('sources.listSeparator')) })}</Text> : null}
    </View>
  );
}

/** One verse's stack in a reader that runs verses on (no tap, no row): number, words, notes. */
export function UsfmReading(props: { rows: readonly VerseRow[]; style: StyleProp<TextStyle>; numberStyle: StyleProp<TextStyle>; number: (row: VerseRow) => string; lead?: (row: VerseRow, i: number) => ReactNode; words?: (text: string) => ReactNode }) {
  return (
    <>
      {props.rows.map((row, i) => (
        <Fragment key={row.key}>
          <UsfmAbove row={row} />
          <UsfmLines pieces={row.usfm ? stackOf(row.usfm.verse).body : []} style={props.style}
            number={<Text><Text style={props.numberStyle}>{props.number(row)} </Text>{props.lead?.(row, i)}</Text>} {...(props.words ? { words: props.words } : {})} />
          <UsfmNotes row={row} />
        </Fragment>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  above: { gap: 2, paddingHorizontal: space.sm, paddingTop: space.xs },
  chapterHead: { fontSize: T.xs, fontWeight: '800', color: C.muted, textTransform: 'uppercase' },
  noteMark: { fontSize: T.xs, fontWeight: '800', color: C.primary },
  verseMark: { fontSize: T.xs, fontWeight: '800', color: C.muted },
  notes: { gap: 2, paddingHorizontal: space.sm, paddingBottom: space.xs },
  fit: { gap: 2, paddingHorizontal: space.sm, paddingVertical: space.xs }
});
