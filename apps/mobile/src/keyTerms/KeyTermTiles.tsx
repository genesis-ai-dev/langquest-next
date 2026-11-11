// The team's words on the recorder's Key words chip (LAN-233, decision 207):
// one tile for each key word, the word small and muted on top, the team's
// word big under it, ▶ on the right when there is a voice. A word with no
// word yet is amber. Tiles wrap onto more lines and never scroll sideways
// (decision 139). A tap on the tile opens its sheet over the recorder
// (KeyTermSheet.tsx), never another screen, so a recording goes on; ▶ pauses
// the microphone first and lets it carry on after, as the Bible does.
import type { KeyTermView } from '@langquest-next/core';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { PlayGlyph } from '../ui/kit';
import { C, radius, space, target, TINT, type as T } from '../ui/theme';
import { styles as ps } from '../recording/blockStyles';
import { useClip } from '../audio/useClip';
import type { ListenHooks } from '../recording/useListenLoop';
import { ourWord, type OurWord } from './model';

/** What the tile says the team's word is: the word, that it was only said, or that there is none. */
export function wordLine(word: OurWord): string {
  return word.kind === 'text' ? word.text : word.kind === 'voice' ? t('keyTerms.tiles.recorded') : t('keyTerms.tiles.noWord');
}

/** The key words as tiles that wrap. `terms` are the team's words for the passage. */
export function KeyTermTiles(props: { ctx: Ctx; terms: readonly KeyTermView[]; listen?: ListenHooks; onOpen: (term: KeyTermView) => void }) {
  return (
    <View style={styles.wrap}>
      {props.terms.map((term) => (
        <HelpRow key={term.termId} of="reference.keyWord">
          <KeyTermTile ctx={props.ctx} term={term} onOpen={() => props.onOpen(term)} {...(props.listen ? { listen: props.listen } : {})} />
        </HelpRow>
      ))}
    </View>
  );
}

function KeyTermTile(props: { ctx: Ctx; term: KeyTermView; listen?: ListenHooks; onOpen: () => void }) {
  const { term } = props;
  const word = ourWord(term);
  const none = word.kind === 'none';
  const voice = word.kind === 'none' ? undefined : word.voice;
  const open = useHelpSpot(term.term, t('keyTerms.tiles.openHelp', { term: term.term }), props.onOpen);
  return (
    <View testID={`key-tile-${term.termId}`} style={[styles.tile, none && styles.tileNone]}>
      <Pressable onPress={open.onPress} accessibilityRole="button"
        accessibilityLabel={word.kind === 'text' ? t('keyTerms.tiles.label', { term: term.term, word: word.text })
          : word.kind === 'voice' ? t('keyTerms.tiles.labelRecorded', { term: term.term }) : t('keyTerms.tiles.labelNone', { term: term.term })}
        style={({ pressed }) => [styles.body, pressed && ps.pressed]}>
        <Text style={styles.term}>{term.term}</Text>
        <Text style={[styles.word, none && styles.wordNone, word.kind === 'voice' && styles.wordVoice]}>{wordLine(word)}</Text>
        <HelpBadge spot={open} />
      </Pressable>
      {voice ? <TilePlay ctx={props.ctx} hash={voice} term={term} {...(props.listen ? { listen: props.listen } : {})} /> : null}
    </View>
  );
}

/** ▶ on a tile: the team's word as it was said. */
function TilePlay(props: { ctx: Ctx; hash: string; term: KeyTermView; listen?: ListenHooks }) {
  const clip = useClip(props.ctx.language, [props.hash], props.listen ? { listen: props.listen } : undefined);
  const spot = useHelpSpot(t('reference.keyWords.yourWord'), t('reference.keyWords.yourWordHelp', { term: props.term.term }), clip.toggle);
  return (
    <Pressable testID={`key-tile-play-${props.term.termId}`} onPress={spot.onPress} disabled={!clip.available} accessibilityRole="button"
      accessibilityLabel={clip.playing ? t('reference.keyWords.pauseYourWord', { term: props.term.term }) : t('reference.keyWords.playYourWord', { term: props.term.term })}
      style={({ pressed }) => [styles.play, !clip.available && ps.off, pressed && ps.pressed]}>
      <PlayGlyph playing={clip.playing} loading={clip.loading} size={18} color={TINT.greenText} strokeWidth={3} fill={TINT.greenText} />
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    flexGrow: 1, flexBasis: '45%', minWidth: 140, flexDirection: 'row', alignItems: 'center', borderRadius: radius.lg,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.card, overflow: 'hidden'
  },
  tileNone: { backgroundColor: TINT.amber, borderColor: C.amber, borderStyle: 'dashed', borderWidth: 1.5 },
  body: { flex: 1, minWidth: 0, minHeight: target.row, justifyContent: 'center', gap: 2, paddingHorizontal: space.md, paddingVertical: space.sm },
  term: { fontSize: T.xs, fontWeight: '600', color: C.muted },
  word: { fontSize: T.lg, fontWeight: '800', color: TINT.greenText },
  wordVoice: { fontSize: T.base },
  wordNone: { fontSize: T.sm, fontWeight: '700', color: TINT.amberText },
  play: { width: target.min, height: target.min, marginRight: space.xs, alignItems: 'center', justifyContent: 'center', borderRadius: target.min / 2, backgroundColor: TINT.green }
});
