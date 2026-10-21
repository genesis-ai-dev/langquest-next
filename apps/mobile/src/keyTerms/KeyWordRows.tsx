// Rows for key-word lists' words (decision 149; the agreed design's screen
// 2): on a passage, a list's word with its short meaning, the verses it is
// in and ▶ for the list's recording of its meaning; and the team's word to
// play. The Key words screen's rows are in KeyWordFinder.tsx.
import type { KeyWordDoc } from '@langquest-next/core';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { Ico } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { C, radius, space, target, TINT, type as T } from '../ui/theme';
import { styles as ps } from '../recording/blockStyles';
import { useClip } from '../audio/useClip';
import { shortName, type KeyWordList } from './listsModel';
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

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: target.row, paddingHorizontal: space.sm, paddingVertical: space.sm },
  key: { width: target.min, height: target.min, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, minHeight: target.min, justifyContent: 'center', gap: 2 },
  term: { fontSize: T.base, fontWeight: '800', color: C.dark },
  refs: { fontSize: T.sm, fontWeight: '700', color: C.primary },
  play: { width: target.min, height: target.min, borderRadius: target.min / 2, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  ourWord: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: target.min, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: TINT.green }
});
