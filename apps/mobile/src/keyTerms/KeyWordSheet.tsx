// A key-word list's word, opened (decision 172; the agreed design's screen
// 3): the word, whose list it is and in what language, its short meaning,
// the list's recording of what it means ("Hear FIA explain it", its length
// once the recording says it), the verses of the open passage it is in, its
// full meaning with the list's other words to tap, the list's credit line,
// and Add to our key words for someone who may edit them. FIA's study
// guides open the same sheet for a word the team's list holds, and a team's
// word made from a list shows the list's meaning on its page (`FromList`).
import { keyTermsFor, languageName, type KeyWordDoc } from '@langquest-next/core';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { useHelpOn, useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { HelpInfo, Ico, LinkBtn, PrimaryBtn, SectionLabel, Sheet } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { C, radius, space, target, type as T } from '../ui/theme';
import { styles as ps } from '../recording/blockStyles';
import { languageLabel } from '../admin/adminModel';
import { shownClock } from '../study/studyText';
import { ownWordOf, shortName, type KeyWordList } from './listsModel';
import { meaningParagraphs } from './searchModel';
import { useKeyWordAudio } from './useKeyWordAudio';

/** How long a recording is: "8 min", or the clock under a minute. */
function recordingLength(seconds: number): string {
  return seconds < 60 ? shownClock(seconds) : t('keyTerms.sheet.minutes', { count: Math.round(seconds / 60) });
}

/** "Hear FIA explain it", the list's language and the recording's length (once known): a tap plays it, another pauses it. */
export function KeyWordHear(props: { ctx: Ctx; list: KeyWordList; word: KeyWordDoc }) {
  const { list, word } = props;
  const audio = useKeyWordAudio(props.ctx, word.audio);
  const name = shortName(list);
  const title = t('keyTerms.sheet.hear', { name });
  const spot = useHelpSpot(title, t('keyTerms.sheet.hearHelp', { name }), audio.toggle);
  if (!audio.has) return null;
  const clock = audio.playing || audio.time > 0
    ? (audio.length ? `${shownClock(audio.time)} / ${shownClock(audio.length)}` : shownClock(audio.time))
    : audio.length ? recordingLength(audio.length) : null;
  const sub = audio.failed ? t('study.guide.couldNotLoad') : audio.waiting ? t('study.guide.gettingRecording')
    : [languageLabel(list.language), clock].filter(Boolean).join(' · ');
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityState={{ selected: audio.playing }}
      accessibilityLabel={audio.playing ? t('keyTerms.sheet.pauseHear', { name }) : title}
      style={({ pressed }) => [styles.hear, pressed && ps.pressed]}>
      <View style={styles.hearPlay}>
        <Ico name={audio.playing ? 'pause' : 'play'} size={24} color={C.white} fill={C.white} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[txt.body, { fontWeight: '800' }]}>{title}</Text>
        {sub ? <Text style={txt.smMuted}>{sub}</Text> : null}
      </View>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** "What it means": the full meaning, its links to the list's other words underlined; a tap opens that word. */
export function KeyWordMeaning(props: { list: KeyWordList; word: KeyWordDoc; onWord: (word: KeyWordDoc) => void }) {
  const { list } = props;
  const ids = useMemo(() => new Set(list.words.map((w) => w.id)), [list.words]);
  const paragraphs = useMemo(() => meaningParagraphs(props.word.body, ids), [props.word.body, ids]);
  // While help is on a word does not open: the text around it says what the words do.
  const helpOn = useHelpOn();
  if (!paragraphs.length) return null;
  const linked = paragraphs.some((p) => p.some((x) => x.type === 'word'));
  const body = paragraphs.map((para, i) => (
    <Text key={i} style={styles.meaning}>
      {para.map((part, j) => {
        if (part.type === 'text') return part.text;
        if (part.type === 'bold') return <Text key={j} style={{ fontWeight: '800' }}>{part.text}</Text>;
        const to = list.words.find((w) => w.id === part.id)!;
        return (
          <Text key={j} onPress={helpOn ? undefined : () => props.onWord(to)} accessibilityRole="link" suppressHighlighting={false}
            accessibilityHint={t('study.guide.tapForMeaning')} style={styles.link}>{part.text}</Text>
        );
      })}
    </Text>
  ));
  return (
    <View style={{ gap: space.sm }}>
      <SectionLabel label={t('keyTerms.sheet.means')} />
      {linked ? <HelpInfo label={t('keyTerms.sheet.means')} detail={t('keyTerms.sheet.meansHelp')} style={{ gap: space.md }}>{body}</HelpInfo> : body}
    </View>
  );
}

/** A verse of the open passage the word is in: a tap plays it. */
function VerseChip(props: { label: string; onPress: () => void }) {
  const spot = useHelpSpot(props.label, t('reference.keyWords.hearHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={t('keyTerms.sheet.playVerse', { verse: props.label })}
      style={({ pressed }) => [styles.verse, pressed && ps.pressed]}>
      <Ico name="play" size={14} color={C.primary} fill={C.primary} />
      <Text style={styles.verseText}>{props.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/**
 * The sheet. A word linked in the meaning opens in its place, and Back
 * returns to the one before. `verses` are the open passage's verses the
 * word is in, each played by `onPlay`; `onAdd` (given only to someone who
 * may edit key words) offers Add to our key words, unless the team already
 * has the word; `onPage`, where the screen can open it, links the word's own
 * page (decision 172).
 */
export function KeyWordSheet(props: {
  ctx: Ctx;
  list: KeyWordList;
  word: KeyWordDoc;
  verses?: { keys: readonly string[]; book: string; onPlay: (key: string) => void };
  onAdd?: (word: KeyWordDoc) => void;
  onPage?: (word: KeyWordDoc) => void;
  onClose: () => void;
}) {
  const { ctx, list } = props;
  const [trail, setTrail] = useState<KeyWordDoc[]>([props.word]);
  const word = trail[trail.length - 1]!;
  const state = ctx.language.state;
  const own = useMemo(() => (state ? keyTermsFor(state) : []), [state]);
  const mine = ownWordOf(list, word, own);
  const language = languageName(ctx.org.state, ctx.language.languageId ?? '');
  const name = shortName(list);
  const verses = word === props.word && props.verses?.keys.length ? props.verses : null;
  const back = trail.length > 1 ? () => setTrail(trail.slice(0, -1)) : undefined;
  const add = props.onAdd && !mine ? props.onAdd : null;
  return (
    <Sheet visible title={word.term} sub={t('keyTerms.sheet.sub', { name, language: languageLabel(list.language) })} onClose={props.onClose}
      {...(back ? { onBack: back } : {})}
      footer={add ? (
        <View style={{ gap: space.xs }}>
          <PrimaryBtn label={t('keyTerms.sheet.add')} icon="plus" help={t('keyTerms.sheet.addHelp', { language, name })} onPress={() => add(word)} />
          <Text style={[txt.smMuted, { textAlign: 'center' }]}>{t('keyTerms.sheet.addThen', { language })}</Text>
        </View>
      ) : undefined}>
      {back ? <LinkBtn label={t('keyTerms.sheet.backTo', { term: trail[trail.length - 2]!.term })} help={t('keyTerms.sheet.backToHelp')} style={{ alignSelf: 'flex-start' }} onPress={back} /> : null}
      {word.gloss ? <Text style={txt.bodyMuted}>{word.gloss}</Text> : null}
      <KeyWordHear key={word.id} ctx={ctx} list={list} word={word} />
      {verses ? (
        <View style={{ gap: space.sm }}>
          <SectionLabel label={t('keyTerms.lists.inPassage')} />
          <View style={styles.verses}>
            {verses.keys.map((key) => (
              <HelpRow key={key} of="keyTerms.verse">
                <VerseChip label={`${verses.book} ${key}`} onPress={() => verses.onPlay(key)} />
              </HelpRow>
            ))}
          </View>
        </View>
      ) : null}
      {props.onPage ? <LinkBtn label={t('keyTerms.sheet.everyPassage')} help={t('keyTerms.sheet.everyPassageHelp')} style={{ alignSelf: 'flex-start' }} onPress={() => props.onPage!(word)} /> : null}
      <KeyWordMeaning list={list} word={word} onWord={(w) => setTrail([...trail, w])} />
      {list.source ? <Text style={txt.xs}>{list.source}</Text> : null}
      {mine ? <Text style={[txt.xsStrong, { color: C.primary }]}>{t('keyTerms.sheet.ours', { language })}</Text> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  hear: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.xl, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  hearPlay: { width: target.primary, height: target.primary, borderRadius: target.primary / 2, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  verses: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  verse: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: target.min, paddingHorizontal: space.lg, borderRadius: radius.full, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  verseText: { fontSize: T.base, fontWeight: '800', color: C.primary },
  meaning: { fontSize: T.base, lineHeight: 26, color: C.dark },
  link: { fontWeight: '700', color: C.primary, textDecorationLine: 'underline' }
});
