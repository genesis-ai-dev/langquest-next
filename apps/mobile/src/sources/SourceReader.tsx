// One reader for a passage's sources (docs/reference-material.md): the
// recorder's top pane, the study's Passage view and the reviewer's
// Background all use it. It shows the passage's verses (a bridge is one
// row) in a chosen version, the versions as chips (recommended first, each
// saying whether it has audio and where it works), Play passage (only the
// passage, across chapter files), the verse playing highlighted and kept in
// view, a tap on a verse to play on from there, ±10 seconds, and each
// source's copyright. States are honest: no audio says so, nothing is
// simulated, and the built-in text says it is a last resort.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { HelpBadge } from '../helpMode/helpBadge';
import { useHelpOn, useHelpSpot } from '../helpMode/useHelpMode';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { IconBtn, Ico, LinkBtn } from '../ui/kit';
import { txt } from '../ui/textStyles';
import type { ListenHooks } from '../recording/useListenLoop';
import { markTerms } from '../recording/workspaceModel';
import { openContentLink } from '../ui/share';
import { lift } from '../ui/shadow';
import { C, radius, space, target, TINT, type as T, withAlpha } from '../ui/theme';
import { emptyBibleText, type SourceOption, type VerseRow } from './model';
import { PlayError } from './player';
import { usePassagePlayer } from './usePassagePlayer';
import type { Usage } from './useUsage';
import { useChipMarks, usePassageSource, useSources, type PassageSources } from './useSources';
import { choiceKey, chipLabel, copyrightLine, anchorClock } from './sourceText';
import { useChoice, useOffer } from './useSourceChoice';

/** Faith Comes By Hearing's terms for Bible Brain (DBP) content. */
const DBP_TERMS = 'https://www.faithcomesbyhearing.com/bible-brain/license';

interface VerseExtras {
  /** A count beside a verse (notes on it). */
  badge?: (row: VerseRow) => number;
  /** Under a verse: what to show when it is selected or has notes. `at` is where playback paused in it. */
  below?: (row: VerseRow, c: { selected: boolean; at?: string; code: string }) => ReactNode;
}

interface SourceReaderProps {
  ctx: Ctx;
  unitId: string;
  languageId: string;
  /** 'pane': part of a scrolling pane (recorder, review). 'screen': its own scroll view, the player kept on top (study). */
  layout?: 'pane' | 'screen';
  header?: ReactNode;
  /** Under the text in the 'screen' layout (the recorder's reference recordings). */
  footer?: ReactNode;
  /** Off screen: stop playing. */
  hidden?: boolean;
  listen?: ListenHooks;
  terms?: { termId: string; term: string }[];
  tied?: ReadonlySet<string>;
  onTerm?: (termId: string) => void;
  /** The passage's text in the chosen version, for key-term matching; null when there is none. */
  onText?: (text: string | null) => void;
  usage?: Usage;
  /** Open the explore screen; absent where there is no way there (or while recording). */
  onMoreBibles?: () => void;
  verse?: VerseExtras;
  /** The pane's scroll view, so the verse playing stays in view; the reader must sit directly in its content. */
  scrollRef?: RefObject<ScrollView | null>;
}

export function SourceReader(props: SourceReaderProps) {
  const { ctx, unitId, languageId } = props;
  const passage = useSources(ctx, unitId, languageId);
  const [chosen, choose] = useChoice(choiceKey(ctx.session.actorId, ctx.language.orgId, languageId));
  const option = passage.options.find((o) => o.itemId === chosen) ?? passage.options[0];

  // Everything offered goes on the record; choosing a version is using it.
  const usage = props.usage;
  useOffer(usage, passage);

  return <SourceView {...props} passage={passage} option={option}
    onChoose={(o) => { choose(o.itemId); usage?.open(o.itemId); }}
    onPlayed={(o) => usage?.open(o.itemId)} />;
}

/** The reader for given sources: also the explore screen's, for a Bible not yet chosen. */
export function SourceView(props: SourceReaderProps & {
  passage: PassageSources;
  option: SourceOption | undefined;
  onChoose?: (o: SourceOption) => void;
  onPlayed?: (o: SourceOption) => void;
  /** The explore screen hides the chips: it shows one Bible. */
  chips?: boolean;
}) {
  const { ctx, passage, option } = props;
  const src = usePassageSource(ctx, option, passage);
  const marks = useChipMarks(ctx, passage);
  const signature = `${option?.itemId ?? ''}:${passage.ref}:${src?.plan?.parts.length ?? 0}`;
  const player = usePassagePlayer({
    plan: src?.plan ?? null, rows: src?.rows ?? null, signature, disabled: props.hidden,
    resolve: (i) => {
      const part = src?.plan?.parts[i];
      const ch = src?.chapters.find((c) => c.chapter === part?.chapter);
      if (!ch) return Promise.reject(new PlayError(t('sources.reader.noAudioForChapter')));
      return ch.resolve();
    },
    ...(props.listen ? { listen: props.listen } : {}),
    onPlayed: () => { if (option) props.onPlayed?.(option); }
  });
  useEffect(() => { if (props.hidden) player.pause(); }, [props.hidden]); // eslint-disable-line react-hooks/exhaustive-deps

  const text = src?.rows ? src.rows.map((r) => r.text).join(' ') : null;
  const onText = props.onText;
  useEffect(() => { onText?.(text); }, [text, onText]);

  // Keep the verse playing in view.
  const ownScroll = useRef<ScrollView>(null);
  const scroll = props.layout === 'screen' ? ownScroll : props.scrollRef;
  const readerY = useRef(0);
  const listY = useRef(0);
  const rowsY = useRef<Record<string, number>>({});
  useEffect(() => {
    const key = player.current?.key;
    if (!player.playing || !key || !scroll?.current) return;
    const y = rowsY.current[key];
    if (y === undefined) return;
    scroll.current.scrollTo({ y: Math.max(0, (props.layout === 'screen' ? 0 : readerY.current) + listY.current + y - 160), animated: true });
  }, [player.playing, player.current?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const [selected, setSelected] = useState<string | null>(null);
  const canManage = ctx.session.can('manage_reference');
  const abbr = option?.abbreviation ?? '';
  const plan = src?.plan ?? null;
  const timed = !!plan && plan.parts.some((p) => p.timing);

  const tapRow = (row: VerseRow) => {
    if (props.verse) setSelected((cur) => (cur === row.key ? null : row.key));
    if (plan && timed) player.playFrom(row);
  };

  if (!passage.range) {
    return (
      <View style={styles.card}>
        <Text style={txt.smMuted}>{t('sources.reader.noVerses')}</Text>
      </View>
    );
  }

  const chipRow = props.chips === false ? null : (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {passage.options.map((o) => (
        <VersionChip key={o.itemId} option={o} label={chipLabel(o, passage.options)} on={o.itemId === option?.itemId} marks={marks[o.itemId] ?? []} onPress={() => props.onChoose?.(o)} />
      ))}
      {props.onMoreBibles ? <MoreBiblesChip onPress={props.onMoreBibles} /> : null}
    </ScrollView>
  );

  const playerBar = option ? (
    <View style={styles.card}>
      {plan ? (
        <View style={styles.playerRow}>
          <IconBtn name="restart" label={t('common.backTenSeconds')} help={t('recording.player.back10Help')} size={target.min} bg={C.light} color={C.primary} disabled={!player.started} onPress={() => player.skip(-10)} />
          <IconBtn name={player.playing ? 'pause' : 'play'} size={target.primary} bg={C.light} color={C.primary}
            label={player.playing ? t('common.pause') : t('sources.reader.playIn', { abbr })} help={t('recording.player.playHelp')} onPress={player.toggle} />
          <IconBtn name="skip" label={t('sources.reader.forwardTen')} help={t('sources.reader.forwardHelp')} size={target.min} bg={C.light} color={C.primary} disabled={!player.started} onPress={() => player.skip(10)} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[txt.sm, { fontWeight: '700' }]} numberOfLines={1}>
              {player.loading ? t('common.loading') : player.playing ? (player.current ? t('sources.reader.playingVerse', { verse: player.current.key }) : t('sources.reader.playing'))
                : player.started ? t('sources.reader.paused') : t('sources.reader.playPassage')}
            </Text>
            <Text style={txt.xs} numberOfLines={1}>{src?.chapters.some((c) => c.local) ? t('sources.reader.onDevice', { abbr }) : abbr}</Text>
          </View>
        </View>
      ) : (
        <View style={{ gap: space.xs }}>
          <Text style={[txt.sm, { fontWeight: '700' }]}>{src?.loading ? t('common.loading') : t('sources.reader.noAudioIn', { abbr })}</Text>
          {!src?.loading && canManage ? <Text style={txt.xs}>{t('sources.reader.giveAudio')}</Text> : null}
        </View>
      )}
      {plan && plan.wholeChapters ? <Text style={txt.xs}>{t('sources.reader.wholeChapter')}</Text>
        : plan && !timed ? <Text style={txt.xs}>{t('sources.reader.noTimings')}</Text> : null}
      {plan && plan.missing.length > 0 ? (
        <Text style={txt.xs}>{t('sources.reader.missingChapters', { count: plan.missing.length, chapters: plan.missing.map((c) => formatNumber(c)).join(t('sources.listSeparator')), abbr })}</Text>
      ) : null}
      {player.error ? <Text accessibilityRole="alert" style={txt.error}>{player.error}</Text> : null}
    </View>
  ) : null;

  const terms = props.terms ?? [];
  const verses = !option ? (
    <View style={styles.card}>
      <Text style={txt.smMuted}>{emptyBibleText({ loading: passage.loading, notOnDevice: passage.notOnDevice }, t('sources.reader.noBible'))}</Text>
      {!passage.loading && !passage.notOnDevice && props.onMoreBibles ? <Text style={txt.xs}>{t('sources.reader.findMore')}</Text> : null}
    </View>
  ) : (
    <View style={styles.textCard} onLayout={(e) => { listY.current = e.nativeEvent.layout.y; }}>
      {src?.rows ? src.rows.map((row) => {
        const here = player.current?.key === row.key && player.started;
        const isSel = selected === row.key;
        const badge = props.verse?.badge?.(row) ?? 0;
        const below = props.verse?.below?.(row, {
          selected: isSel, code: abbr,
          ...(isSel && !player.playing && player.started && player.current?.key === row.key ? { at: anchorClock(player.ms) } : {})
        });
        return (
          <View key={row.key} onLayout={(e) => { rowsY.current[row.key] = e.nativeEvent.layout.y; }}>
            <VerseRowView row={row} here={here} selected={isSel} badge={badge} timed={!!plan && timed} choosable={!!props.verse} terms={terms}
              tied={props.tied} onTerm={props.onTerm} onPress={() => tapRow(row)} />
            {below}
          </View>
        );
      }) : (
        <Text style={[txt.smMuted, { padding: space.md }]}>{src?.loading || !src ? t('common.loading') : src.textProblem}</Text>
      )}
    </View>
  );

  const copyright = option && src ? (
    <View style={{ gap: 2, paddingHorizontal: space.xs }}>
      {option.kind === 'builtin' ? (
        <Text style={txt.xs}>{t('sources.reader.builtIn')}</Text>
      ) : option.sharedBy ? <Text style={txt.xs}>{t('sources.reader.sharedBy', { org: option.sharedBy })}</Text> : null}
      {copyrightLine(src.copyright) ? <Text style={txt.xs}>{t('sources.reader.copyright', { abbr: option.abbreviation, line: copyrightLine(src.copyright) })}</Text> : null}
      {src.bibleBrain ? <LinkBtn label={t('sources.reader.terms')} style={{ alignSelf: 'flex-start' }} accessibilityLabel={t('sources.reader.termsLabel')} help={t('sources.reader.termsHelp')} onPress={() => openContentLink(DBP_TERMS)} /> : null}
    </View>
  ) : null;

  if (props.layout === 'screen') {
    return (
      <ScrollView ref={ownScroll} stickyHeaderIndices={[1]} contentContainerStyle={styles.screenBody} keyboardShouldPersistTaps="handled">
        <View style={{ gap: space.md }}>{props.header}{chipRow}</View>
        <View style={styles.sticky}>{playerBar}</View>
        {verses}
        {copyright}
        {props.footer}
      </ScrollView>
    );
  }
  return (
    <View style={{ gap: space.sm }} onLayout={(e) => { readerY.current = e.nativeEvent.layout.y; }}>
      {chipRow}
      {playerBar}
      {verses}
      {copyright}
    </View>
  );
}

/** A version: its abbreviation, and under it what it has here ("no audio", "offline ✓"). */
function VersionChip(props: { option: SourceOption; label: string; on: boolean; marks: string[]; onPress: () => void }) {
  const o = props.option;
  const from = o.from === 'language' || o.from === 'organization' ? t('sources.reader.fromRecommended') : o.from === 'mine' ? t('sources.reader.fromMine')
    : o.from === 'passage' ? t('sources.reader.fromPassage') : null;
  const spot = useHelpSpot(props.label, t('sources.reader.versionHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityState={{ selected: props.on }}
      accessibilityLabel={[o.name, from, ...props.marks].filter(Boolean).join(t('sources.listSeparator'))}
      style={({ pressed }) => [styles.chip, props.on && styles.chipOn, pressed && styles.pressed]}>
      <View>
        <Text style={[styles.chipLabel, { color: props.on ? C.white : C.dark }]} numberOfLines={1}>{props.label}</Text>
        {props.marks.length ? (
          <Text style={[styles.chipMarks, { color: props.on ? withAlpha(C.white, 0.85) : C.muted }]} numberOfLines={1}>{props.marks.join(' · ')}</Text>
        ) : null}
      </View>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** + More Bibles, at the end of the versions: find and add another. */
function MoreBiblesChip(props: { onPress: () => void }) {
  const spot = useHelpSpot(t('sources.reader.moreBibles'), t('reference.bible.moreBiblesSub'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={t('sources.reader.moreBiblesLabel')}
      style={({ pressed }) => [styles.chip, styles.moreChip, pressed && styles.pressed]}>
      <Ico name="plus" size={18} color={C.primary} />
      <Text style={[styles.chipLabel, { color: C.primary }]}>{t('sources.reader.moreBibles')}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/**
 * One verse: a tap plays on from it (when the audio is timed) and chooses
 * it (where a note can be added). Its key words open where `onTerm` is
 * given; while help is on they do not, and the verse says what its marks mean.
 */
function VerseRowView(props: {
  row: VerseRow; here: boolean; selected: boolean; badge: number; timed: boolean; choosable: boolean;
  terms: { termId: string; term: string }[]; tied?: ReadonlySet<string>; onTerm?: (termId: string) => void; onPress: () => void;
}) {
  const { row } = props;
  const helpOn = useHelpOn();
  const parts = markTerms(row.text, props.terms);
  const termIds = parts.flatMap((p) => (p.termId ? [p.termId] : []));
  const detail = [
    props.timed && props.choosable ? t('sources.reader.verseHelpPlaysNote') : props.timed ? t('sources.reader.verseHelpPlays') : props.choosable ? t('sources.reader.verseHelpNote') : null,
    termIds.length ? (props.onTerm ? t('reference.bible.verseTermsHelp') : t('reference.bible.verseTermsMarkedHelp')) : null,
    termIds.some((id) => props.tied?.has(id)) ? t('reference.bible.verseTiedHelp') : null,
    props.badge > 0 && !props.selected ? t('reference.bible.verseNotesHelp') : null
  ].filter(Boolean).join(' ');
  // Only a verse that does something, or has marks to explain, is a part.
  const acts = props.timed || props.choosable || termIds.length > 0 || props.badge > 0;
  const spot = useHelpSpot(t('reference.bible.verse', { verse: row.key }), detail || undefined, acts ? props.onPress : undefined);
  const onTerm = helpOn ? undefined : props.onTerm;
  return (
    <Pressable onPress={spot.id ? spot.onPress : props.onPress} accessibilityRole="button" accessibilityState={{ selected: props.here || props.selected }}
      accessibilityLabel={t('sources.reader.verseLabel', { verse: row.key, text: row.text })} accessibilityHint={props.timed ? t('sources.reader.playsFromVerse') : undefined}
      style={({ pressed }) => [styles.verse, props.here && styles.playing, props.selected && styles.selected, pressed && styles.pressed]}>
      <Text style={[styles.verseNum, props.here && { color: C.primary }]}>{row.key}</Text>
      <Text style={[styles.verseText, { flex: 1 }]}>
        {parts.map((part, i) => {
          if (!part.termId) return <Text key={i}>{part.text}</Text>;
          const tied = props.tied?.has(part.termId) ?? false;
          return (
            <Text key={i} {...(onTerm ? { onPress: () => onTerm(part.termId!), accessibilityRole: 'link' as const } : {})}
              accessibilityLabel={tied ? t('sources.reader.keyTermTied', { term: part.text }) : t('sources.reader.keyTerm', { term: part.text })}
              style={[styles.term, tied ? styles.termTied : null]}>{part.text}{tied ? ' ✓' : ''}</Text>
          );
        })}
      </Text>
      {props.badge > 0 && !props.selected ? <View style={styles.count}><Text style={styles.countText}>{formatNumber(props.badge)}</Text></View> : null}
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  chips: { gap: space.sm, paddingVertical: 2 },
  chip: { minHeight: target.min, borderRadius: radius.lg, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: 4 },
  chipOn: { backgroundColor: C.primary, borderColor: C.primary },
  moreChip: { borderStyle: 'dashed', borderColor: withAlpha(C.primary, 0.5) },
  chipLabel: { fontSize: T.sm, fontWeight: '700' },
  chipMarks: { fontSize: 12, fontWeight: '600' },
  card: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, padding: space.md, gap: space.sm },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  textCard: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, paddingVertical: space.xs },
  verse: { flexDirection: 'row', gap: space.sm, borderRadius: radius.md, marginHorizontal: space.xs, paddingHorizontal: space.sm, paddingVertical: 6, minHeight: target.min },
  playing: { backgroundColor: C.light },
  selected: { backgroundColor: withAlpha(C.primary, 0.07), borderWidth: 1.5, borderColor: withAlpha(C.primary, 0.38) },
  verseNum: { minWidth: 34, textAlign: 'right', paddingTop: 4, fontSize: T.xs, fontWeight: '700', color: C.muted, fontVariant: ['tabular-nums'] },
  verseText: { fontSize: T.base, lineHeight: 28, color: C.dark },
  term: { fontWeight: '600', color: C.primary, backgroundColor: C.light, textDecorationLine: 'underline', textDecorationStyle: 'dotted' },
  termTied: { color: TINT.greenText, backgroundColor: TINT.green, textDecorationStyle: 'solid' },
  count: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5, backgroundColor: TINT.amberText, alignItems: 'center', justifyContent: 'center', marginTop: 3 },
  countText: { fontSize: T.xs, fontWeight: '800', color: C.white },
  screenBody: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  sticky: { backgroundColor: C.bg, paddingBottom: space.xs, ...lift({ opacity: 0 }) }
});
