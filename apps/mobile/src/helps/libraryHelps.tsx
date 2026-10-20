// A passage's translation helps from the library, as the recorder, the
// study reader and a review show them (useLibraryHelps.ts): notes for
// translators on the verses they are about, the passage's key words with
// their articles, and an article opened from either, whose own links open
// the next article in its place. Ported from nothing in the demo: an
// app-only part of decision 62's "notes for translators" (decision on
// Door43's helps), drawn in the demo's look (kit.tsx, theme.ts).
import type { ContentsDoc, HelpRow as HelpsRow } from '@langquest-next/core';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { t } from '../i18n';
import { Ico, LinkBtn, PrimaryBtn, Sheet } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { C, radius, space, target, TINT, type as T } from '../ui/theme';
import { SectionBody } from '../study/ui';
import { studySections } from '../study/text';
import { styles as ps } from '../recording/blockStyles';
import { keyLabel } from './helpsModel';
import { articleEntry, helpLink, type NoteGroup, type OfferedSet, type PassageKeyWord } from './libraryHelpsModel';
import { useArticle } from './useLibraryHelps';
import { useArticleSheet, type ArticleOpen } from './useArticleSheet';
import type { LibraryHelps } from './useLibraryHelps';

/** Markdown of a help: its sections, its links opening what they name. */
function HelpText(props: { text: string; onOpenRef: (ref: string) => void }) {
  const sections = useMemo(() => studySections(props.text), [props.text]);
  return <View style={{ gap: space.xs }}>{sections.map((sec) => <SectionBody key={sec.id} section={sec} onOpenRef={props.onOpenRef} />)}</View>;
}

/** "Verse 12", "12–14", a psalm's title (verse 0), or the introduction. */
function placeLabel(at: string): string {
  if (!at) return t('helps.library.intro');
  const verse = at.slice(at.indexOf(':') + 1);
  return verse === '0' ? t('helps.library.title') : t('helps.library.verse', { verse: keyLabel(verse) });
}

/** One note: the words it is about, then what it says, and the article it cites. */
function LibraryNote(props: { row: HelpsRow; onOpenRef: (ref: string) => void }) {
  const r = props.row;
  return (
    <View style={styles.note}>
      {r.quote ? <Text style={styles.quote}>{r.quote}</Text> : null}
      <HelpText text={r.text} onOpenRef={props.onOpenRef} />
      {r.support ? (
        <LinkBtn label={t('helps.library.supportLink')} style={{ alignSelf: 'flex-start' }} help={t('helps.library.supportHelp')}
          onPress={() => props.onOpenRef(`ta:${r.support!}`)} />
      ) : null}
    </View>
  );
}

/** Each set's notes on the passage, under the verse each is on, with the set's credit. */
export function LibraryNotes(props: { groups: readonly NoteGroup[]; onOpenRef: (ref: string) => void }) {
  if (!props.groups.length) return null;
  return (
    <View style={{ gap: space.lg }}>
      {props.groups.map((g) => (
        <View key={g.itemId} style={{ gap: space.sm }}>
          <Text style={[txt.label, { letterSpacing: 0.6 }]}>{g.title}</Text>
          {g.byVerse.map(([at, rows]) => (
            <View key={at || 'intro'} style={{ gap: space.xs }}>
              <Text style={txt.xsStrong}>{placeLabel(at)}</Text>
              {rows.map((r) => <HelpRow key={r.id} of="helps.libraryNote"><LibraryNote row={r} onOpenRef={props.onOpenRef} /></HelpRow>)}
            </View>
          ))}
          <Text style={txt.xs}>{g.credit}</Text>
        </View>
      ))}
    </View>
  );
}

/** The passage's key words from the library: each opens its article. */
export function LibraryKeyWords(props: { words: readonly PassageKeyWord[]; book: string; onOpen: (k: PassageKeyWord) => void }) {
  if (!props.words.length) return null;
  return (
    <View style={{ gap: space.sm }}>
      <Text style={[txt.label, { letterSpacing: 0.6 }]}>{t('helps.library.keyWordsTitle')}</Text>
      <View style={styles.card}>
        {props.words.map((k, i) => (
          <HelpRow key={k.article} of="helps.libraryKeyWord">
            <KeyWordRow word={k} book={props.book} last={i === props.words.length - 1} onPress={() => props.onOpen(k)} />
          </HelpRow>
        ))}
      </View>
    </View>
  );
}

function KeyWordRow(props: { word: PassageKeyWord; book: string; last: boolean; onPress: () => void }) {
  const k = props.word;
  const where = k.at.length ? `${props.book} ${k.at.map((a) => keyLabel(a)).join(', ')}` : '';
  const spot = useHelpSpot(k.title, t('helps.library.keyWordHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={t('helps.library.keyWordLabel', { word: k.title, where })}
      style={({ pressed }) => [styles.wordRow, !props.last && ps.rowBorder, pressed && ps.pressed]}>
      <Ico name="key" size={18} color={TINT.amberText} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.wordTitle}>{k.title}</Text>
        {where ? <Text style={txt.smMuted}>{where}</Text> : null}
      </View>
      <Ico name="right" size={18} color={C.muted} />
      <HelpBadge spot={spot} />
    </Pressable>
  );
}


/**
 * An article of the manual or a key word, read in a sheet. Its own links
 * open the next article in its place, and Back returns to the one before.
 * A key word's sheet can add it to the team's key words.
 */
export function ArticleSheet(props: {
  ctx: Ctx; open: ArticleOpen; sets: { academy: readonly OfferedSet<ContentsDoc>[]; words: readonly OfferedSet<ContentsDoc>[] };
  onClose: () => void; onAddKeyWord?: (title: string) => void;
}) {
  const [stack, setStack] = useState<ArticleOpen[]>([props.open]);
  const top = stack[stack.length - 1]!;
  const { doc, error } = useArticle(props.ctx, top.doc);
  const openRef = (ref: string) => {
    const link = helpLink(ref);
    if (!link || link.kind === 'bible') return;
    const e = articleEntry(link.kind === 'academy' ? props.sets.academy : props.sets.words, link.id);
    setStack((s) => [...s, { title: e?.title ?? link.id, kind: link.kind, id: link.id, ...(e ? { doc: e.doc } : {}) }]);
  };
  const back = stack.length > 1 ? () => setStack((s) => s.slice(0, -1)) : undefined;
  const credit = (top.kind === 'academy' ? props.sets.academy : props.sets.words).find((s) => s.doc.entries.some((e) => e.id === top.id))?.doc.credit;
  const canAdd = top.kind === 'words' && !!props.onAddKeyWord;
  return (
    <Sheet visible title={doc?.title ?? top.title} onClose={props.onClose} {...(back ? { onBack: back } : {})}
      footer={canAdd ? <PrimaryBtn label={t('helps.library.addKeyWord')} icon="plus" help={t('helps.library.addKeyWordHelp')} onPress={() => props.onAddKeyWord!(doc?.title ?? top.title)} /> : undefined}>
      {back ? <LinkBtn label={t('helps.library.backArticle', { title: stack[stack.length - 2]!.title })} style={{ alignSelf: 'flex-start' }} help={t('helps.library.backArticleHelp')} onPress={back} /> : null}
      {!top.doc ? <Text style={txt.smMuted}>{t('helps.library.articleMissing')}</Text>
        : doc?.body ? <HelpText text={doc.body} onOpenRef={openRef} />
          : <Text style={txt.smMuted}>{error ? t('helps.library.articleOffline') : t('common.loading')}</Text>}
      {credit && doc ? <Text style={txt.xs}>{credit}</Text> : null}
    </Sheet>
  );
}

/**
 * One of a check's library helps, on the passage under review (decision 91):
 * a set of notes shows its notes here, key words the passage's key words,
 * a manual the articles the passage's notes cite. An article opens in the
 * same sheet's place.
 */
export function PassageHelpsSheet(props: { ctx: Ctx; library: LibraryHelps; itemId: string; title: string; book: string; onClose: () => void }) {
  const { library, itemId } = props;
  const articles = useArticleSheet(library.sets);
  const notes = library.notes.filter((g) => g.itemId === itemId);
  const words = library.sets.wordLinks.some((s) => s.itemId === itemId) || library.sets.words.some((s) => s.itemId === itemId) ? library.keyWords : [];
  const cited = library.sets.academy.some((s) => s.itemId === itemId)
    ? [...new Set(library.notes.flatMap((g) => g.byVerse.flatMap(([, rows]) => rows.flatMap((r) => (r.support ? [r.support] : [])))))]
    : [];
  if (articles.open) return <ArticleSheet ctx={props.ctx} open={articles.open} sets={library.sets} onClose={articles.close} />;
  const empty = !notes.length && !words.length && !cited.length;
  return (
    <Sheet visible title={props.title} onClose={props.onClose}>
      {empty ? <Text style={txt.smMuted}>{library.loading ? t('common.loading') : t('helps.library.nothingHere')}</Text> : null}
      <LibraryNotes groups={notes} onOpenRef={articles.openRef} />
      <LibraryKeyWords words={words} book={props.book} onOpen={articles.openWord} />
      {cited.length ? (
        <View style={styles.card}>
          {cited.map((id, i) => (
            <HelpRow key={id} of="helps.citedArticle">
              <CitedRow title={articleEntry(library.sets.academy, id)?.title ?? id} last={i === cited.length - 1} onPress={() => articles.openRef(`ta:${id}`)} />
            </HelpRow>
          ))}
        </View>
      ) : null}
    </Sheet>
  );
}

function CitedRow(props: { title: string; last: boolean; onPress: () => void }) {
  const spot = useHelpSpot(props.title, t('helps.library.supportHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={props.title}
      style={({ pressed }) => [styles.wordRow, !props.last && ps.rowBorder, pressed && ps.pressed]}>
      <Ico name="book" size={18} color={C.primary} />
      <Text style={[styles.wordTitle, { flex: 1 }]}>{props.title}</Text>
      <Ico name="right" size={18} color={C.muted} />
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  note: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: 1, borderColor: C.border, padding: space.md, gap: space.sm },
  quote: { fontSize: T.base, fontWeight: '700', color: C.dark },
  wordRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: target.row, paddingHorizontal: space.md, paddingVertical: space.xs },
  wordTitle: { fontSize: T.base, fontWeight: '800', color: C.dark }
});
