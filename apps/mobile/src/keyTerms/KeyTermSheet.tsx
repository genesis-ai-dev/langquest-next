// A key word, opened from its tile on the recorder's Key words chip (LAN-233,
// decision 207). It is a sheet over the recorder and never another screen, so
// a recording goes on under it: the word and what it means; where it is in
// this passage (a tap plays that verse); the team's words for it, each with
// its voice, the version it was said in and the versions that used it; every
// passage it is in; and how the organization's other languages say it. What
// would leave the screen (a passage, the word's own page) is given only when
// nothing is recording. A word played here pauses the microphone first
// (`listen`), as the Bible does. The team's words are `termWords`
// (keyTerms/model.ts); the key-word list's word is KeyWordSheet.tsx.
import { languageName, type KeyTermView } from '@langquest-next/core';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { Card, LinkBtn, PlayGlyph, PrimaryBtn, SectionLabel, Sheet } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { C, radius, space, target, TINT, type as T } from '../ui/theme';
import { styles as ps } from '../recording/blockStyles';
import { useClip } from '../audio/useClip';
import type { ListenHooks } from '../recording/useListenLoop';
import { OthersSay } from '../helps/helps';
import { othersSay } from '../helps/helpsModel';
import { useOtherLanguageTerms } from '../reference/useOtherLanguageTerms';
import { VerseChip } from './KeyWordSheet';
import { shortName, wordOfTermId } from './listsModel';
import { termUsedIn, termWords, versionOfTake, type TermUse, type TermWord } from './model';
import { useKeyWordLists } from './useKeyWordLists';
import { useTermPassages } from './useTermPassages';
import { useWordPage } from './useWordPage';
import { WordPassagesSection } from './WordPageSections';
import type { WordPassage } from './wordPageModel';

export function KeyTermSheet(props: {
  ctx: Ctx;
  term: KeyTermView;
  /** The open passage's verses the word is in, and the book's name. `onPlay` is left out when the Bible has no timed audio. */
  verses: { keys: readonly string[]; book: string; refs: string; onPlay?: (key: string) => void };
  /** Pauses the microphone before a voice plays here, and lets it carry on after. */
  listen?: ListenHooks;
  /** Recording: nothing here leaves the screen, and the passages and the word's page say they open after Done. */
  recording: boolean;
  /** Say yours, for a word with no word yet: only for someone who may edit, and not while recording. */
  onSay?: () => void;
  /** The word's own page, and a passage or version from the list: given only when nothing is recording. */
  onPage?: () => void;
  onOpenPassage?: (p: WordPassage) => void;
  onClose: () => void;
}) {
  const { ctx, term } = props;
  const state = ctx.language.state;
  const language = languageName(ctx.org.state, ctx.language.languageId ?? '');
  // The versions that used a word, and those it was said during, may be in passages not in memory (decision 143).
  const read = useTermPassages(ctx, term.termId, term);
  const usedIn = useMemo(() => (read ? termUsedIn(read, term.termId) : []), [read, term.termId]);
  const words = useMemo(() => termWords(term, usedIn, (takeId) => { const at = read ?? state; return at ? versionOfTake(at, takeId) : null; }),
    [term, usedIn, read, state]);
  const { lists } = useKeyWordLists(ctx);
  const fromList = useMemo(() => wordOfTermId(lists, term.termId), [lists, term.termId]);
  const page = useWordPage(ctx, { term, from: fromList, uses: usedIn });
  const others = useOtherLanguageTerms(ctx, true);
  const say = useMemo(() => othersSay(others.languages, term), [others.languages, term]);
  return (
    <Sheet visible title={term.term} sub={t('config.keyTerm.sub', { language })} onClose={props.onClose}>
      <Text style={txt.body}>{term.gloss || t('config.keyTerm.noMeaning')}</Text>
      {props.verses.keys.length ? (
        <View style={{ gap: space.sm }}>
          <SectionLabel label={t('keyTerms.lists.inPassage')} />
          {props.verses.onPlay ? (
            <View style={styles.verses}>
              {props.verses.keys.map((key) => (
                <HelpRow key={key} of="keyTerms.verse"><VerseChip label={`${props.verses.book} ${key}`} onPress={() => props.verses.onPlay!(key)} /></HelpRow>
              ))}
            </View>
          ) : <Text style={txt.body}>{`${props.verses.book} ${props.verses.refs}`}</Text>}
        </View>
      ) : null}
      <SectionLabel label={t('config.keyTerm.inLanguage', { language })} />
      {words.length === 0 ? (
        <Card style={styles.none}>
          <Text style={[txt.body, { fontWeight: '700', color: TINT.amberText }]}>{t('config.keyTerm.noRendering')}</Text>
          {props.onSay ? <PrimaryBtn label={t('reference.keyWords.sayYours')} icon="mic" help={t('reference.keyWords.sayYoursHelp', { term: term.term })} onPress={props.onSay} /> : null}
        </Card>
      ) : (
        <View style={{ gap: space.sm }}>
          {words.map((word) => (
            <HelpRow key={word.id} of="keyTerms.ourWord"><WordCard ctx={ctx} term={term} word={word} {...(props.listen ? { listen: props.listen } : {})} /></HelpRow>
          ))}
        </View>
      )}
      {props.recording ? <Text style={txt.smMuted}>{t('keyTerms.ours.afterDone')}</Text> : null}
      <WordPassagesSection ctx={ctx} passages={page.passages} own loading={page.loading} listName={fromList ? shortName(fromList.list) : null} {...(props.onOpenPassage ? { onOpen: props.onOpenPassage } : {})} />
      <OthersSay ctx={ctx} items={say} loading={others.loading} word={term.term} {...(props.listen ? { listen: props.listen } : {})} />
      {props.onPage ? <LinkBtn label={t('keyTerms.ours.openPage')} help={t('keyTerms.ours.openPageHelp', { term: term.term })} style={{ alignSelf: 'center' }} onPress={props.onPage} /> : null}
    </Sheet>
  );
}

/** One word of the team's: it, how it is used, ▶ for its voice, the version it was said in, and the versions that used it. */
function WordCard(props: { ctx: Ctx; term: KeyTermView; word: TermWord; listen?: ListenHooks }) {
  const { word } = props;
  return (
    <View testID="key-term-word" style={styles.card}>
      {word.voice ? <WordPlay ctx={props.ctx} hash={word.voice} term={props.term.term} {...(props.listen ? { listen: props.listen } : {})} /> : null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={word.rendering ? styles.word : styles.wordVoice}>{word.rendering || t('keyTerms.tiles.recorded')}</Text>
        {word.context ? <Text style={txt.sm}>{word.context}</Text> : null}
        {word.saidIn ? <Text style={txt.smMuted}>{t('keyTerms.ours.saidIn', { where: versionLine(word.saidIn) })}</Text> : null}
        {word.usedIn.length ? <Text style={txt.smMuted}>{t('keyTerms.ours.usedIn', { where: word.usedIn.map(usedLine).join(', ') })}</Text> : null}
      </View>
    </View>
  );
}

/** "Luke 15:11-32 · Version 2". */
function versionLine(v: { title: string; n: number | null }): string {
  return v.n === null ? v.title : `${v.title} · ${t('keyTerms.page.version', { n: v.n })}`;
}

const usedLine = (u: TermUse): string => versionLine(u);

/** ▶ for a word of the team's: pauses the microphone first. */
function WordPlay(props: { ctx: Ctx; hash: string; term: string; listen?: ListenHooks }) {
  const clip = useClip(props.ctx.language, [props.hash], props.listen ? { listen: props.listen } : undefined);
  const spot = useHelpSpot(t('reference.keyWords.yourWord'), t('reference.keyWords.yourWordHelp', { term: props.term }), clip.toggle);
  return (
    <Pressable testID="key-term-word-play" onPress={spot.onPress} disabled={!clip.available} accessibilityRole="button"
      accessibilityLabel={clip.playing ? t('reference.keyWords.pauseYourWord', { term: props.term }) : t('reference.keyWords.playYourWord', { term: props.term })}
      style={({ pressed }) => [styles.play, !clip.available && ps.off, pressed && ps.pressed]}>
      <PlayGlyph playing={clip.playing} loading={clip.loading} size={18} color={C.white} fill={C.white} />
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  verses: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  none: { backgroundColor: TINT.amber, borderStyle: 'dashed', borderWidth: 1.5, borderColor: C.amber, gap: space.sm },
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  word: { fontSize: T.lg, fontWeight: '800', color: TINT.greenText },
  wordVoice: { fontSize: T.base, fontWeight: '800', color: TINT.greenText },
  play: { width: target.min, height: target.min, borderRadius: target.min / 2, backgroundColor: TINT.greenText, alignItems: 'center', justifyContent: 'center' }
});
