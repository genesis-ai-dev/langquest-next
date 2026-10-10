// Breaking up the Bible on screen (decisions.md 74; the prototype's round
// 4, "How the Bible is broken up"): a book drawn as its pieces, a way to
// choose with its count and a Preview, the walk-through, the sheet that asks
// which languages a change goes to, the warning before a book is broken up
// again, and the note when a language's Bibles number verses differently.
import { templateBooks, type NumberingClash, type TemplateDoc, type VersificationDoc } from '@langquest-next/core';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../text';
import { bookNameOf } from '../contentTemplates';
import { useHelpSpot } from '../helpContext';
import { HelpBadge } from '../helpBadge';
import { t } from '../i18n';
import { Chip, GhostBtn, Ico, PrimaryBtn, Sheet, txt } from '../kit';
import { AmberNote, CheckRow, ChoiceCard, Pills } from '../simple/admin';
import { C, radius, space, TINT } from '../theme';
import { countLine, lessonSlides, piecesOf, PREVIEW_BOOKS, SAMPLE_BOOK, usedLine, verseSays, type TemplateUser, type WayRow } from './model';

/** A book cut into its pieces, each as wide as its verses. Nothing drawn when the way leaves the book for later. */
export function PieceBar(props: { doc: TemplateDoc | null; book?: string; v11n: VersificationDoc | null; caption?: boolean }) {
  // Ruth, unless the way leaves Ruth out (FIA's older list): then the first book it does break up.
  const book = props.book ?? (props.doc ? PREVIEW_BOOKS.find((b) => piecesOf(props.doc!, b, props.v11n).length > 0) : undefined) ?? SAMPLE_BOOK;
  const pieces = props.doc ? piecesOf(props.doc, book, props.v11n) : [];
  const name = bookNameOf(book);
  if (pieces.length === 0) {
    const listed = !!props.doc && templateBooks(props.doc).some((b) => b.book === book);
    return (
      <View style={styles.waitBar} accessibilityLabel={listed ? t('breakup.pieceBar.waitsLabel', { book: name }) : t('breakup.pieceBar.notInIt', { book: name })}>
        <Text style={[txt.xs, { color: C.muted }]}>{listed ? t('breakup.pieceBar.waits', { book: name }) : t('breakup.pieceBar.notInIt', { book: name })}</Text>
      </View>
    );
  }
  return (
    <View accessibilityLabel={t('breakup.pieceBar.label', { book: name, count: pieces.length })}>
      <View style={[styles.bar, { gap: pieces.length > 100 ? 0 : pieces.length > 30 ? 1 : 3 }]}>
        {pieces.map((p, i) => (
          <View key={i} style={[styles.piece, { flexGrow: p.verses }, pieces.length > 100 && i % 2 === 1 && { backgroundColor: C.soft }]} />
        ))}
      </View>
      {props.caption === false ? null : <Text style={[txt.xs, { color: C.muted, marginTop: 4 }]}>{t('breakup.pieceBar.caption', { book: name, count: pieces.length })}</Text>}
    </View>
  );
}

/**
 * One way to break up the Bible, as an admin chooses it: where it is used,
 * what it gives the whole Bible, what comes with it, Ruth as its pieces,
 * and Preview.
 */
export function WayCard(props: {
  row: WayRow; doc: TemplateDoc | null; v11n: VersificationDoc | null; on: boolean; onPress: () => void; onPreview: () => void; oneBook?: string; children?: ReactNode;
}) {
  const { row, doc } = props;
  const lines = [
    row.inUse ? t('breakup.way.inUse') : usedLine(row.usedIn),
    doc ? (props.oneBook ? '' : countLine(doc, props.v11n)) : t('common.loading')
  ].filter(Boolean);
  const preview = useHelpSpot(t('common.preview'), t('breakup.way.previewHelp', { way: row.choice.name }), props.onPreview);
  const goes = doc?.format === 'template@2' ? doc.goesWith?.pattern : undefined;
  return (
    <ChoiceCard on={props.on} icon={row.later ? 'clock' : 'book'} title={row.choice.name} sub={lines.join(' · ')} onPress={props.onPress}>
      <View style={styles.indent}>
        {goes ? (
          <View style={styles.goes}>
            <Ico name="layers" size={14} color={C.muted} />
            <Text style={[txt.xs, { color: C.muted }]}>{t('breakup.way.comesWith', { pattern: goes })}</Text>
          </View>
        ) : null}
        {row.later && !props.oneBook ? null : <PieceBar doc={doc} v11n={props.v11n} book={props.oneBook ?? SAMPLE_BOOK} />}
        {row.later ? null : (
          <Pressable onPress={preview.onPress} accessibilityRole="button" accessibilityLabel={t('breakup.way.previewLabel', { way: row.choice.name })} style={({ pressed }) => [styles.peek, pressed && { opacity: 0.6 }]}>
            <Ico name="search" size={16} color={C.primary} />
            <Text style={[txt.sm, { color: C.primary, fontWeight: '700' }]}>{t('common.preview')}</Text>
            <HelpBadge spot={preview} />
          </Pressable>
        )}
        {props.children}
      </View>
    </ChoiceCard>
  );
}

/** Every piece a way cuts a book into, for a few books (Ruth, Luke, Genesis, Romans) or the one being broken up. */
export function PreviewSheet(props: {
  visible: boolean; name: string; doc: TemplateDoc | null; v11n: VersificationDoc | null; book?: string; onClose: () => void; onUse?: () => void;
}) {
  const [book, setBook] = useState<string>(props.book ?? SAMPLE_BOOK);
  const shown = props.book ?? book;
  const pieces = props.doc ? piecesOf(props.doc, shown, props.v11n) : [];
  return (
    <Sheet visible={props.visible} title={props.name} sub={t('common.preview')} onClose={props.onClose}
      footer={props.onUse ? <PrimaryBtn label={t('breakup.preview.useThis')} icon="check" onPress={props.onUse} /> : undefined}>
      {props.book ? null : (
        <Pills>
          {PREVIEW_BOOKS.map((b) => <Chip key={b} label={bookNameOf(b)} on={shown === b} onPress={() => setBook(b)} />)}
        </Pills>
      )}
      <PieceBar doc={props.doc} v11n={props.v11n} book={shown} />
      {pieces.length ? (
        <View style={styles.list}>
          {pieces.map((p, i) => (
            <View key={i} style={[styles.listRow, i === pieces.length - 1 && { borderBottomWidth: 0 }]}>
              <View style={styles.num}><Text style={styles.numText}>{i + 1}</Text></View>
              <Text style={[txt.body, { flex: 1 }]}>{p.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Sheet>
  );
}

/** "How is material broken up?": five slides, a bar that fills as you go, and Skip on every one. */
export function LessonSheet(props: { visible: boolean; onClose: () => void; wayDoc: (item: string) => TemplateDoc | null; v11n: VersificationDoc | null }) {
  const [n, setN] = useState(0);
  const lesson = lessonSlides();
  const slide = lesson[n]!;
  const last = n === lesson.length - 1;
  const close = () => { setN(0); props.onClose(); };
  return (
    <Sheet visible={props.visible} title={t('breakup.lesson.sheetTitle')} sub={t('breakup.lesson.progress', { step: n + 1, total: lesson.length })} onClose={close}
      footer={<>
        <PrimaryBtn label={last ? t('common.done') : t('common.next')} icon={last ? 'check' : 'right'} onPress={() => (last ? close() : setN(n + 1))} />
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.lg }}>
          {n > 0 ? <GhostBtn label={t('common.back')} icon="left" onPress={() => setN(n - 1)} /> : null}
          {last ? null : <GhostBtn label={t('breakup.lesson.skip')} icon="close" onPress={close} />}
        </View>
      </>}>
      <View style={styles.progress} accessibilityLabel={t('breakup.lesson.stepLabel', { step: n + 1, total: lesson.length })}>
        {lesson.map((_, i) => (
          <View key={i} style={[styles.step, i < n && { backgroundColor: C.green }, i === n && { backgroundColor: C.primary }]}>
            {i < n ? <Ico name="check" size={12} color={C.white} strokeWidth={3} /> : null}
          </View>
        ))}
      </View>
      <Text style={txt.h2} accessibilityRole="header">{slide.title}</Text>
      <Text style={txt.bodyMuted}>{slide.text}</Text>
      {slide.tree ? (
        <View style={styles.list}>
          {slide.tree.map((f) => (
            <View key={f.name} style={{ padding: space.md, gap: space.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Ico name="folder" size={18} color={C.primary} />
                <Text style={txt.h3}>{f.name}</Text>
              </View>
              {f.items.map((it) => (
                <View key={it} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.xl }}>
                  <Ico name="mic" size={16} color={TINT.greenText} />
                  <Text style={txt.body}>{it}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : null}
      {slide.ways ? slide.ways.map((w) => (
        <View key={w.item} style={{ gap: space.xs }}>
          <Text style={txt.h3}>{w.label}</Text>
          <PieceBar doc={props.wayDoc(w.item)} v11n={props.v11n} />
        </View>
      )) : null}
      {slide.rows ? (
        <View style={styles.list}>
          {slide.rows.map(([a, b], i) => (
            <View key={a} style={[styles.listRow, { alignItems: 'flex-start', flexDirection: 'column' }, i === slide.rows!.length - 1 && { borderBottomWidth: 0 }]}>
              <Text style={txt.h3}>{a}</Text>
              <Text style={txt.smMuted}>{b}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Sheet>
  );
}

/**
 * Which languages a change to a template goes to (decision 74). This
 * language always; others that use the same template may be added, if this
 * person may change them. Leaving any out splits a copy off for the chosen.
 */
export function ApplySheet(props: {
  visible: boolean; users: TemplateUser[]; here: string; busy: boolean; onClose: () => void; onApply: (chosen: Set<string>) => void; children?: ReactNode;
}) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set([props.here]));
  const others = props.users.filter((u) => u.languageId !== props.here);
  const count = chosen.size;
  return (
    <Sheet visible={props.visible} title={t('breakup.apply.title')} sub={t('breakup.apply.sub')} onClose={props.onClose}
      footer={<PrimaryBtn label={count === 1 ? t('breakup.apply.changeThis') : t('breakup.apply.changeFor', { count })} icon="check" busy={props.busy} onPress={() => props.onApply(chosen)} />}>
      {props.children}
      <View style={styles.list}>
        <CheckRow label={props.users.find((u) => u.languageId === props.here)?.name ?? t('breakup.apply.thisLanguage')} sub={t('breakup.apply.hereSub')} checked onToggle={() => undefined} disabled
          detail={t('breakup.apply.hereDetail')} />
        {others.map((u, i) => (
          <CheckRow key={u.languageId} label={u.name} sub={u.mayChange ? undefined : t('breakup.apply.cannotChange')} checked={chosen.has(u.languageId)} disabled={!u.mayChange}
            detail={t('breakup.apply.otherDetail', { language: u.name })}
            last={i === others.length - 1}
            onToggle={() => setChosen((cur) => { const next = new Set(cur); if (next.has(u.languageId)) next.delete(u.languageId); else next.add(u.languageId); return next; })} />
        ))}
      </View>
      <Text style={txt.smMuted}>
        {count - 1 === others.length ? t('breakup.apply.everyLanguage') : t('breakup.apply.someLanguages')}
      </Text>
    </Sheet>
  );
}

/**
 * The warning before a change to sections that may hold work (decisions 74
 * and 80): a book divided again, or a new numbering. What was recorded and
 * reviewed on the old sections moves to "Earlier sections" on the new ones
 * and needs doing again; that includes recordings on phones that have not
 * synced. Nothing is deleted.
 */
export function RedoSheet(props: { visible: boolean; book: string; busy: boolean; onClose: () => void; onConfirm: () => void; numbering?: boolean }) {
  return (
    <Sheet visible={props.visible} title={props.numbering ? t('breakup.redo.titleNumbering') : t('breakup.redo.titleBook', { book: props.book })} onClose={props.onClose}
      footer={<>
        <PrimaryBtn label={t('breakup.redo.changeAnyway')} tone="red" busy={props.busy} onPress={props.onConfirm} />
        <GhostBtn label={t('breakup.redo.keep')} icon="close" onPress={props.onClose} />
      </>}>
      <View style={styles.danger}>
        <Ico name="flag" size={28} color={TINT.redText} />
      </View>
      <Text style={txt.body}>{props.numbering ? t('breakup.redo.bodyNumbering') : t('breakup.redo.bodyBook', { book: props.book })}</Text>
      <Text style={txt.smMuted}>{t('breakup.redo.nothingDeleted')}</Text>
    </Sheet>
  );
}

/** A language's Bibles number some verses differently: one verse to show how, and it may be ignored (decision 74). */
export function NumberingNote(props: { clash: NumberingClash; onIgnore?: () => void }) {
  const ignore = useHelpSpot(t('breakup.numbering.ignore'), t('breakup.numbering.ignoreHelp'), props.onIgnore);
  const says = verseSays(props.clash.says);
  return (
    <View style={styles.warn}>
      <Text style={[txt.h3, { color: TINT.amberText }]}>{t('breakup.numbering.title')}</Text>
      {props.clash.places.map((p) => (
        <View key={p.name} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
          <Text style={[txt.sm, { flex: 1 }]}>{t('breakup.numbering.verseIn', { verse: says, bible: p.name })}</Text>
          <Text style={[txt.sm, { fontWeight: '700' }]}>{readable(p.ref)}</Text>
        </View>
      ))}
      <Text style={txt.smMuted}>{t('breakup.numbering.linedUp')}</Text>
      {props.onIgnore ? (
        <Pressable onPress={ignore.onPress} accessibilityRole="button" style={({ pressed }) => [styles.peek, pressed && { opacity: 0.6 }]}>
          <Ico name="check" size={16} color={C.muted} />
          <Text style={[txt.sm, { color: C.muted, fontWeight: '700' }]}>{t('breakup.numbering.ignore')}</Text>
          <HelpBadge spot={ignore} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** "PSA 22:1" -> "Psalm 22:1": one psalm is "Psalm", not the book's "Psalms". */
function readable(ref: string): string {
  const m = /^([1-3A-Z]{3}) (.*)$/.exec(ref);
  if (!m) return ref;
  return m[1] === 'PSA' ? t('breakup.numbering.psalm', { place: m[2] }) : `${bookNameOf(m[1]!)} ${m[2]}`;
}

/** A quiet line under the ways: FIA covers some books; what the rest get. */
export function OthersChoice(props: { empty: string; count: number; on: 'chapters' | 'later'; onPick: (v: 'chapters' | 'later') => void }) {
  return (
    <AmberNote icon="help">
      {t('breakup.others.intro', { count: props.count, books: props.empty })}{'\n'}
      <Text onPress={() => props.onPick('chapters')} style={{ fontWeight: props.on === 'chapters' ? '800' : '400', textDecorationLine: props.on === 'chapters' ? 'none' : 'underline' }}>
        {props.on === 'chapters' ? '● ' : ''}{t('breakup.others.byChapter')}
      </Text>
      {'   '}
      <Text onPress={() => props.onPick('later')} style={{ fontWeight: props.on === 'later' ? '800' : '400', textDecorationLine: props.on === 'later' ? 'none' : 'underline' }}>
        {props.on === 'later' ? '● ' : ''}{t('breakup.others.wait')}
      </Text>
    </AmberNote>
  );
}

const styles = StyleSheet.create({
  indent: { paddingLeft: 52, gap: space.sm },
  bar: { flexDirection: 'row', height: 14, overflow: 'hidden', borderRadius: 4 },
  piece: { backgroundColor: C.primary, opacity: 0.85, borderRadius: 3, minWidth: 1, flexBasis: 0, flexShrink: 1 },
  waitBar: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.faint, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: space.xs },
  goes: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  peek: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', minHeight: 32 },
  list: { backgroundColor: C.card, borderRadius: radius.lg, borderWidth: 1, borderColor: C.border },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: C.border, minHeight: 44 },
  num: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  numText: { fontSize: 13, fontWeight: '700', color: C.primary },
  progress: { flexDirection: 'row', gap: 6 },
  step: { flex: 1, height: 22, borderRadius: 11, backgroundColor: C.border, alignItems: 'center', justifyContent: 'center' },
  danger: { width: 52, height: 52, borderRadius: 26, backgroundColor: TINT.red, alignItems: 'center', justifyContent: 'center' },
  warn: { backgroundColor: TINT.amber, borderRadius: radius.lg, padding: space.md, gap: space.xs }
});
