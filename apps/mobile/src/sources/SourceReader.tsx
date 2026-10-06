// One reader for a passage's sources (docs/reference-material.md): the
// recorder's top pane, the study's Passage view and the reviewer's
// Background all use it. It shows the passage's verses (a bridge is one
// row) in a chosen version, the versions as chips (recommended first, each
// saying whether it has audio and where it works), Play passage (only the
// passage, across chapter files), the verse playing highlighted and kept in
// view, a tap on a verse to play on from there, ±10 seconds, and each
// source's copyright. States are honest: no audio says so, nothing is
// simulated, and the built-in text says it is a last resort.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Ctx } from '../ctx';
import { IconBtn, Ico, LinkBtn, txt } from '../kit';
import type { ListenHooks } from '../recording/useListenLoop';
import { markTerms } from '../recording/workspaceModel';
import { openContentLink } from '../share';
import { C, radius, shadow, space, target, TINT, type as T, withAlpha } from '../theme';
import { filesetsFor, sourceUsed, type SourceOption, type VerseRow } from './model';
import { usePassagePlayer } from './player';
import type { Usage } from './used';
import { useChipMarks, usePassageSource, useSources, type PassageSources } from './useSources';

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

const choiceKey = (actorId: string, orgId: string, languageId: string) => `source-choice:${actorId}:${orgId}:${languageId}`;
const choices = new Map<string, string>();

/** The version chosen last for this language on this phone, shared by the recorder, the study and the review. */
function useChoice(key: string): [string | null, (itemId: string) => void] {
  const [chosen, setChosen] = useState<string | null>(choices.get(key) ?? null);
  useEffect(() => {
    if (choices.has(key)) return;
    void AsyncStorage.getItem(key).then((v) => { if (v) { choices.set(key, v); setChosen(v); } }).catch(() => undefined);
  }, [key]);
  return [chosen, (itemId: string) => {
    choices.set(key, itemId);
    setChosen(itemId);
    void AsyncStorage.setItem(key, itemId).catch(() => undefined);
  }];
}

/** Put every source offered for this passage in the screen's record of what was used. */
function useOffer(usage: Usage | undefined, passage: PassageSources): void {
  useEffect(() => {
    if (!usage || !passage.range) return;
    usage.offer(passage.options.map((o) => {
      const f = filesetsFor(o, passage.range!.book);
      return sourceUsed(o, { ref: passage.ref, opened: false, filesets: [f.text, f.audio].filter((x): x is string => !!x) });
    }));
  }, [usage, passage.options, passage.range, passage.ref]);
}

/**
 * Offer the passage's sources to the record without showing them: for a
 * screen where the reader sits behind a disclosure (the reviewer's
 * Background), so what was offered is recorded whether or not it was opened.
 */
export function useOfferedSources(ctx: Ctx, unitId: string | undefined, languageId: string | undefined, usage: Usage | undefined): void {
  const passage = useSources(ctx, unitId, languageId);
  useOffer(usage, passage);
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
      if (!ch) return Promise.reject(new Error('No audio for this chapter.'));
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
        <Text style={txt.smMuted}>This passage doesn't name its verses, so no Bible text can be lined up with it.</Text>
      </View>
    );
  }

  const chipRow = props.chips === false ? null : (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {passage.options.map((o) => (
        <VersionChip key={o.itemId} option={o} label={chipLabel(o, passage.options)} on={o.itemId === option?.itemId} marks={marks[o.itemId] ?? []} onPress={() => props.onChoose?.(o)} />
      ))}
      {props.onMoreBibles ? (
        <Pressable onPress={props.onMoreBibles} accessibilityRole="button" accessibilityLabel="More Bibles: find and add another Bible"
          style={({ pressed }) => [styles.chip, styles.moreChip, pressed && styles.pressed]}>
          <Ico name="plus" size={18} color={C.primary} />
          <Text style={[styles.chipLabel, { color: C.primary }]}>More Bibles</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );

  const playerBar = option ? (
    <View style={styles.card}>
      {plan ? (
        <View style={styles.playerRow}>
          <IconBtn name="restart" label="Back 10 seconds" size={target.min} bg={C.light} color={C.primary} disabled={!player.started} onPress={() => player.skip(-10)} />
          <IconBtn name={player.playing ? 'pause' : 'play'} size={target.primary} bg={C.light} color={C.primary}
            label={player.playing ? 'Pause' : `Play the passage in ${abbr}`} onPress={player.toggle} />
          <IconBtn name="skip" label="Forward 10 seconds" size={target.min} bg={C.light} color={C.primary} disabled={!player.started} onPress={() => player.skip(10)} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[txt.sm, { fontWeight: '700' }]} numberOfLines={1}>
              {player.loading ? 'Loading…' : player.playing ? (player.current ? `Playing ${player.current.key}` : 'Playing') : player.started ? 'Paused' : 'Play passage'}
            </Text>
            <Text style={txt.xs} numberOfLines={1}>{abbr}{src?.chapters.some((c) => c.local) ? ' · on this phone' : ''}</Text>
          </View>
        </View>
      ) : (
        <View style={{ gap: space.xs }}>
          <Text style={[txt.sm, { fontWeight: '700' }]}>{src?.loading ? 'Loading…' : `No audio for this passage in ${abbr}`}</Text>
          {!src?.loading && canManage ? <Text style={txt.xs}>To give your team audio, recommend a Bible that has it in Reference library.</Text> : null}
        </View>
      )}
      {plan && plan.wholeChapters ? <Text style={txt.xs}>Plays the whole chapter: this recording has no verse timings yet.</Text>
        : plan && !timed ? <Text style={txt.xs}>No verse timings for this recording yet, so verses aren't highlighted.</Text> : null}
      {plan && plan.missing.length > 0 ? <Text style={txt.xs}>No audio for chapter {plan.missing.join(', ')} in {abbr}.</Text> : null}
      {player.error ? <Text accessibilityRole="alert" style={txt.error}>{player.error}</Text> : null}
    </View>
  ) : null;

  const terms = props.terms ?? [];
  const verses = !option ? (
    <View style={styles.card}>
      <Text style={txt.smMuted}>{passage.loading ? 'Loading…' : 'No Bible for this passage yet.'}</Text>
      {!passage.loading && props.onMoreBibles ? <Text style={txt.xs}>Find one under More Bibles.</Text> : null}
    </View>
  ) : (
    <View style={styles.textCard} onLayout={(e) => { listY.current = e.nativeEvent.layout.y; }}>
      {src?.rows ? src.rows.map((row) => {
        const here = player.current?.key === row.key && player.started;
        const isSel = selected === row.key;
        const badge = props.verse?.badge?.(row) ?? 0;
        const below = props.verse?.below?.(row, {
          selected: isSel, code: abbr,
          ...(isSel && !player.playing && player.started && player.current?.key === row.key ? { at: clock(player.ms) } : {})
        });
        return (
          <View key={row.key} onLayout={(e) => { rowsY.current[row.key] = e.nativeEvent.layout.y; }}>
            <Pressable onPress={() => tapRow(row)} accessibilityRole="button" accessibilityState={{ selected: here || isSel }}
              accessibilityLabel={`Verse ${row.key}. ${row.text}`} accessibilityHint={plan && timed ? 'Plays from this verse' : undefined}
              style={({ pressed }) => [styles.verse, here && styles.playing, isSel && styles.selected, pressed && styles.pressed]}>
              <Text style={[styles.verseNum, here && { color: C.primary }]}>{row.key}</Text>
              <Text style={[styles.verseText, { flex: 1 }]}>
                {markTerms(row.text, terms).map((part, i) => {
                  if (!part.termId) return <Text key={i}>{part.text}</Text>;
                  const tied = props.tied?.has(part.termId) ?? false;
                  const onTerm = props.onTerm;
                  return (
                    <Text key={i} {...(onTerm ? { onPress: () => onTerm(part.termId!), accessibilityRole: 'link' as const } : {})}
                      accessibilityLabel={`${part.text}, key term${tied ? ', tied to your draft' : ''}`}
                      style={[styles.term, tied ? styles.termTied : null]}>{part.text}{tied ? ' ✓' : ''}</Text>
                  );
                })}
              </Text>
              {badge > 0 && !isSel ? <View style={styles.count}><Text style={styles.countText}>{badge}</Text></View> : null}
            </Pressable>
            {below}
          </View>
        );
      }) : (
        <Text style={[txt.smMuted, { padding: space.md }]}>{src?.loading || !src ? 'Loading…' : src.textProblem}</Text>
      )}
    </View>
  );

  const copyright = option && src ? (
    <View style={{ gap: 2, paddingHorizontal: space.xs }}>
      {option.kind === 'builtin' ? (
        <Text style={txt.xs}>Built-in text, a last resort until your organization recommends Bibles.</Text>
      ) : option.sharedBy ? <Text style={txt.xs}>Shared by {option.sharedBy}.</Text> : null}
      {copyrightLine(src.copyright) ? <Text style={txt.xs}>{option.abbreviation}: {copyrightLine(src.copyright)}</Text> : null}
      {src.bibleBrain ? <LinkBtn label="Bible Brain terms" style={{ alignSelf: 'flex-start' }} accessibilityLabel="Open the Bible Brain terms of use" onPress={() => openContentLink(DBP_TERMS)} /> : null}
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

/** The abbreviation, and when two versions share it, what tells them apart ("BSB · read by Frederick Surrey"). */
function chipLabel(o: SourceOption, all: SourceOption[]): string {
  const twin = all.find((x) => x !== o && x.abbreviation === o.abbreviation);
  if (!twin) return o.abbreviation;
  let i = 0;
  while (i < o.name.length && o.name[i] === twin.name[i]) i++;
  const rest = o.name.slice(i).replace(/^[\s,;:–-]+/, '').trim();
  return `${o.abbreviation} · ${rest || (o.doc?.provider.kind === 'library' || o.kind === 'library' && !o.doc ? 'library' : 'Bible Brain')}`;
}

function copyrightLine(c: { text?: string; audio?: string }): string {
  if (c.text && c.audio && c.text !== c.audio) return `Text ${c.text} · Audio ${c.audio}`;
  return c.text ?? c.audio ?? '';
}

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A version: its abbreviation, and under it what it has here ("no audio", "offline ✓"). */
function VersionChip(props: { option: SourceOption; label: string; on: boolean; marks: string[]; onPress: () => void }) {
  const o = props.option;
  const from = o.from === 'language' || o.from === 'organization' ? 'recommended' : o.from === 'mine' ? 'my Bible' : o.from === 'passage' ? 'for this passage' : null;
  return (
    <Pressable onPress={props.onPress} accessibilityRole="button" accessibilityState={{ selected: props.on }}
      accessibilityLabel={[o.name, from, ...props.marks].filter(Boolean).join(', ')}
      style={({ pressed }) => [styles.chip, props.on && styles.chipOn, pressed && styles.pressed]}>
      <View>
        <Text style={[styles.chipLabel, { color: props.on ? C.white : C.dark }]} numberOfLines={1}>{props.label}</Text>
        {props.marks.length ? (
          <Text style={[styles.chipMarks, { color: props.on ? withAlpha(C.white, 0.85) : C.muted }]} numberOfLines={1}>{props.marks.join(' · ')}</Text>
        ) : null}
      </View>
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
  sticky: { backgroundColor: C.bg, paddingBottom: space.xs, ...shadow, shadowOpacity: 0 }
});
