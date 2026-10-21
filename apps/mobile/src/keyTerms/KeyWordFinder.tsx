// The Key words screen's search across the team's words and every key-word
// list the team uses (decision 149; the agreed design's screen 8): chips
// for All, Ours and each list by its short name; what is typed found by the
// word (or another form of it), then by the short meaning, and a last row
// that opens the words whose full meaning mentions it. With nothing typed,
// a list's chip shows that list's words, and All shows each list's words
// under the team's (which the screen groups as it always has).
import type { KeyTermView, KeyWordDoc } from '@langquest-next/core';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { Badge, Card, Chip, ChipWrap, Group, Ico, Row, SectionLabel, ShowMore } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { C, space, target, TINT } from '../ui/theme';
import { styles as ps } from '../recording/blockStyles';
import { languageLabel } from '../admin/adminModel';
import { bookNameOf } from '../templates/contentTemplates';
import { shortName, type KeyWordList } from './listsModel';
import { keyWordResults, linkedPassages, listChips, type KeyWordFilter, type KeyWordResult } from './searchModel';
import { OurWord } from './KeyWordRows';

/** Long lists grow 25 at a time (ADR-009). */
const STEP = 25;

/** All, Ours, and one chip per list. */
export function KeyWordChips(props: { lists: readonly KeyWordList[]; filter: KeyWordFilter; onFilter: (f: KeyWordFilter) => void }) {
  const chips = listChips(props.lists);
  return (
    <ChipWrap>
      <Chip label={t('keyTerms.search.all')} on={props.filter === 'all'} help={t('keyTerms.search.allHelp')} onPress={() => props.onFilter('all')} />
      <Chip label={t('keyTerms.search.ours')} on={props.filter === 'ours'} help={t('keyTerms.search.oursHelp')} onPress={() => props.onFilter('ours')} />
      {/* help-each: each chip narrows the words to a different list */}
      {chips.map((c) => (
        <Chip key={c.id} label={c.label} on={props.filter === c.id} help={t('keyTerms.search.listHelp', { name: c.label })} onPress={() => props.onFilter(c.id)} />
      ))}
    </ChipWrap>
  );
}

/** Rows on one card, 25 at a time, with something after the last (`footer`). */
function Capped<T>(props: { items: readonly T[]; render: (item: T, last: boolean) => ReactNode; footer?: ReactNode }) {
  const [n, setN] = useState(STEP);
  const shown = props.items.slice(0, n);
  return (
    <>
      <Group>
        {shown.map((item, i) => props.render(item, i === shown.length - 1 && !props.footer))}
        {props.footer}
      </Group>
      <ShowMore remaining={props.items.length - n} step={STEP} onMore={() => setN(n + STEP)} />
    </>
  );
}

/** "22 more mention it in their full meaning": a tap shows them. */
function MoreRow(props: { count: number; onPress: () => void }) {
  const label = t('keyTerms.search.more', { count: props.count });
  const spot = useHelpSpot(label, t('keyTerms.search.moreHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" style={({ pressed }) => [styles.more, pressed && ps.pressed]}>
      <Text style={[txt.body, { flex: 1, fontWeight: '700', color: C.primary }]}>{label}</Text>
      <Ico name="right" size={22} color={C.primary} />
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

export function KeyWordFinder(props: {
  ctx: Ctx; terms: readonly KeyTermView[]; lists: readonly KeyWordList[]; query: string; filter: KeyWordFilter;
  /** The team's language ("Sidamo"), for its words' recordings. */
  language: string;
  onOpenOwn: (term: KeyTermView) => void;
  onOpenWord: (list: KeyWordList, word: KeyWordDoc) => void;
  /** The team's word open beside the list on a wide window. */
  currentTermId?: string | undefined;
}) {
  const { terms, lists, filter } = props;
  const q = props.query.trim();
  const results = useMemo(() => keyWordResults({ own: terms, lists, query: q, filter }), [terms, lists, q, filter]);
  // The words whose full meaning mentions it show once asked for, for what is typed now.
  const [fullFor, setFullFor] = useState<string | null>(null);
  const row = (r: KeyWordResult<KeyTermView>, last: boolean) => (
    <HelpRow key={r.key} of="keyTerms.result">
      <KeyWordResultRow ctx={props.ctx} result={r} query={q} language={props.language} last={last} current={!!r.own && r.own.termId === props.currentTermId}
        onPress={() => (r.own ? props.onOpenOwn(r.own) : props.onOpenWord(r.from!.list, r.from!.word))} />
    </HelpRow>
  );
  const listHead = (list: KeyWordList, count: number) => (
    <SectionLabel label={t('keyTerms.lists.from', { name: shortName(list), language: languageLabel(list.language) })}
      action={<Text style={[txt.xsStrong, { color: C.primary }]}>{t('keyTerms.lists.words', { count })}</Text>} />
  );

  if (q) {
    const { words, inGloss, inMeaning } = results;
    if (!words.length && !inGloss.length && !inMeaning.length) return <Card><Text style={txt.smMuted}>{t('common.nothingMatches', { query: q })}</Text></Card>;
    const full = fullFor === q;
    const more = inMeaning.length && !full ? <MoreRow count={inMeaning.length} onPress={() => setFullFor(q)} /> : null;
    return (
      <>
        {words.length ? <><SectionLabel label={t('keyTerms.search.words')} /><Capped items={words} render={row} {...(!inGloss.length && more ? { footer: more } : {})} /></> : null}
        {inGloss.length ? <><SectionLabel label={t('keyTerms.search.inGloss')} /><Capped items={inGloss} render={row} {...(more ? { footer: more } : {})} /></> : null}
        {!words.length && !inGloss.length && more ? <Group>{more}</Group> : null}
        {full && inMeaning.length ? <><SectionLabel label={t('keyTerms.search.inMeaning')} /><Capped items={inMeaning} render={row} /></> : null}
      </>
    );
  }
  if (filter === 'ours') return null;
  if (filter !== 'all') {
    const list = lists.find((l) => l.itemId === filter);
    if (!list) return null;
    return <>{listHead(list, results.words.length)}<Capped items={results.words} render={row} /></>;
  }
  // Each list's words the team has not made its own, under the team's.
  return (
    <>
      {/* help-each: a section per list, each row in it a HelpRow of its own */}
      {lists.map((list) => {
        const words = results.words.filter((r) => !r.own && r.from?.list === list);
        if (!words.length) return null;
        return <Fragment key={list.itemId}>{listHead(list, words.length)}<Capped items={words} render={row} /></Fragment>;
      })}
    </>
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
  marks: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  more: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.row, paddingHorizontal: space.lg, paddingVertical: space.sm }
});
