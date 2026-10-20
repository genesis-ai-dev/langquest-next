// Rows for key-word lists' words (decision 149; the agreed design's screens
// 2 and 8): on a passage, a list's word with its short meaning, the verses
// it is in and ▶ for the list's recording of its meaning; on the Key words
// screen, what a search finds, marked Ours and with its list's short name,
// the team's word to play beside it.
import type { KeyTermView, KeyWordDoc } from '@langquest-next/core';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { Badge, Ico, Row } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { C, radius, space, target, TINT, type as T } from '../ui/theme';
import { styles as ps } from '../recording/blockStyles';
import { useClip } from '../audio/useClip';
import { bookNameOf } from '../templates/contentTemplates';
import { linkedPassages, shortName, type KeyWordList, type KeyWordResult } from './listsModel';
import { useKeyWordAudio } from './useKeyWordAudio';

/** ▶ for the list's recording of what a word means; nothing when it has none. */
export function PlayMeaning(props: { ctx: Ctx; list: KeyWordList; word: KeyWordDoc }) {
  const audio = useKeyWordAudio(props.ctx, props.word.audio);
  const term = props.word.term;
  const label = audio.playing ? t('keyTerms.lists.pause', { term }) : t('keyTerms.lists.play', { term });
  const spot = useHelpSpot(label, t('keyTerms.lists.playHelp', { name: shortName(props.list) }), audio.toggle);
  if (!audio.has) return null;
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [styles.play, audio.failed && ps.off, pressed && ps.pressed]}>
      <Ico name={audio.playing ? 'pause' : 'play'} size={18} color={C.primary} fill={C.primary} />
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** A list's word on the open passage: the word, its short meaning and where it is (`refs`); a tap opens it. */
export function ListWordRow(props: { ctx: Ctx; list: KeyWordList; word: KeyWordDoc; refs: string; last: boolean; onOpen: () => void }) {
  const { word } = props;
  const open = useHelpSpot(word.term, t('keyTerms.lists.openHelp'), props.onOpen);
  return (
    <View style={[styles.row, !props.last && ps.rowBorder]}>
      <View style={styles.key}><Ico name="key" size={22} color={TINT.amberText} /></View>
      <Pressable onPress={open.onPress} accessibilityRole="button"
        accessibilityLabel={t('keyTerms.lists.rowLabel', { term: word.term, gloss: word.gloss, refs: props.refs })}
        style={({ pressed }) => [styles.body, pressed && ps.pressed]}>
        <Text style={styles.term}>{word.term}</Text>
        {word.gloss ? <Text style={txt.smMuted}>{word.gloss}</Text> : null}
        <Text style={styles.refs}>{props.refs}</Text>
        <HelpBadge spot={open} />
      </Pressable>
      <PlayMeaning ctx={props.ctx} list={props.list} word={word} />
    </View>
  );
}

/** The team's word as said: "▶ Sidamo word". */
export function OurWord(props: { ctx: Ctx; hash: string; term: string; language: string }) {
  const clip = useClip(props.ctx.language, [props.hash]);
  const spot = useHelpSpot(t('keyTerms.search.ourWord', { language: props.language }), t('reference.keyWords.yourWordHelp', { term: props.term }), clip.toggle);
  return (
    <Pressable onPress={spot.onPress} disabled={!clip.available} accessibilityRole="button"
      accessibilityLabel={clip.playing ? t('reference.keyWords.pauseYourWord', { term: props.term }) : t('reference.keyWords.playYourWord', { term: props.term })}
      style={({ pressed }) => [styles.ourWord, !clip.available && ps.off, pressed && ps.pressed]}>
      <Ico name={clip.playing ? 'pause' : 'play'} size={12} color={TINT.greenText} fill={TINT.greenText} />
      <Text style={[txt.xsStrong, { color: TINT.greenText, flexShrink: 1 }]}>{t('keyTerms.search.ourWord', { language: props.language })}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** "Linked to 20 passages in Luke": how many passages a list links its word to. */
function linkedLine(word: KeyWordDoc): string | null {
  const { count, books } = linkedPassages(word);
  if (!count) return null;
  return books.length === 1 ? t('keyTerms.search.linkedIn', { count, book: bookNameOf(books[0]!) }) : t('keyTerms.search.linked', { count });
}

/**
 * One word the Key words screen finds: the word and its short meaning (what
 * was typed in bold), how many passages its list links it to, Ours for the
 * team's own and its list's short name, and the team's word to play.
 */
export function KeyWordResultRow(props: { ctx: Ctx; result: KeyWordResult<KeyTermView>; query: string; language: string; last: boolean; current?: boolean; onPress: () => void }) {
  const { result: r } = props;
  const voice = r.own ? [...r.own.adjustments].reverse().find((a) => a.blobHash)?.blobHash : undefined;
  const linked = r.from ? linkedLine(r.from.word) : null;
  return (
    <Row icon="key" iconColor={TINT.amberText} iconBg={TINT.amber} label={r.term} {...(r.gloss ? { sub: r.gloss } : {})} highlight={props.query}
      help={r.own ? t('config.keyTerms.openTermHelp') : t('keyTerms.search.openListHelp', { name: shortName(r.from!.list) })}
      onPress={props.onPress} last={props.last} {...(props.current ? { current: true } : {})}
      below={(
        <View style={{ gap: space.sm }}>
          {linked ? <Text style={[txt.sm, { fontWeight: '700', color: C.primary }]}>{linked}</Text> : null}
          <View style={styles.marks}>
            {r.own ? <Badge label={t('keyTerms.search.ours')} tone="green" /> : null}
            {r.from ? <Badge label={shortName(r.from.list)} tone="brand" /> : null}
            {r.own && voice ? <OurWord ctx={props.ctx} hash={voice} term={r.own.term} language={props.language} /> : null}
          </View>
        </View>
      )} />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: target.row, paddingHorizontal: space.sm, paddingVertical: space.sm },
  key: { width: target.min, height: target.min, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, minHeight: target.min, justifyContent: 'center', gap: 2 },
  term: { fontSize: T.base, fontWeight: '800', color: C.dark },
  refs: { fontSize: T.sm, fontWeight: '700', color: C.primary },
  play: { width: target.min, height: target.min, borderRadius: target.min / 2, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  marks: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  ourWord: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: target.min, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: TINT.green }
});
