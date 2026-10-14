// Dividing a book your own way (decision 93). Ports the demo's own-way editor
// (ng-langquest-ux src/simple/divide.tsx: `?simple=divide`, divideCut,
// divideHelps, divideSection; ADR-041; design principles 12–14): the book as
// text in a Bible the team has, a dashed line wherever many of 20 English
// Bibles start a section, the book's outline, notes and guides in a pane under
// the text, and sections started or joined from the verse tapped. The book
// opens as the language divides it, else by chapter; a ready-made way can be
// the starting point instead. Saving divides the book like any other way
// (useBookChange: the warning, the languages it changes, Undo).
import {
  bibleBreaksIn, BIBLES_COUNTED, formatRef, recommendedFor, wayCovers,
  type LibraryItemView, type MaterialDoc, type TemplateDoc, type VersificationDoc
} from '@langquest-next/core';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../text';
import type { Ctx } from '../ctx';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { Field, Group, Header, Ico, PrimaryBtn, QuietLinks, Row, Screen, Sheet, txt, type IconName } from '../kit';
import { useLibraryDocs } from '../library/useLibrary';
import { itemRangesIn } from '../reference/coverage';
import type { RefKind } from '../reference/model';
import { useRefItems } from '../reference/useReference';
import { languageLabel } from '../simple/adminModel';
import { choiceKey, chipLabel, useChoice } from '../sources/SourceReader';
import { usePassageSource, useSources } from '../sources/useSources';
import { C, radius, space, target, TINT, type as T } from '../theme';
import { useBookChange } from './BreakUpBook';
import { atOf, namesOfWay, ownWayDoc, parseAt, sectionLabel, sectionsOf, startsOfWay, verseOrder, type At, type Section } from './ownWay';
import { isItself } from './model';
import { useWays } from './useBreakup';

/** A dashed line where at least this many of the 20 Bibles start a section. */
const SUGGEST = 10;

/** The book in a Bible the team has (the language's Bibles, the one chosen last on this phone first), else one LangQuest shares. */
export function useBookText(ctx: Ctx, book: string, maxVerses: readonly number[]) {
  const languageId = ctx.language.languageId;
  // A book opened in the template editor may have no team behind it: LangQuest's Bibles stand in (decision 103).
  const sources = useSources(ctx, null, languageId, { wholeBook: true });
  const [chosen, choose] = useChoice(choiceKey(ctx.session.actorId, ctx.language.orgId, languageId ?? ''));
  const option = sources.options.find((o) => o.itemId === chosen) ?? sources.options[0];
  const range = useMemo(() => (maxVerses.length
    ? { book, start: { chapter: 1, verse: 1 }, end: { chapter: maxVerses.length, verse: maxVerses[maxVerses.length - 1]! } } : null), [book, maxVerses]);
  const src = usePassageSource(ctx, option, { ...sources, range, ref: range ? formatRef(range) : '' });
  const byAt = useMemo(() => {
    const out = new Map<At, string>();
    for (const r of src?.rows ?? []) for (let v = r.verseStart; v <= r.verseEnd; v++) out.set(atOf(r.chapter, v), v === r.verseStart ? r.text : '');
    return out;
  }, [src?.rows]);
  return { options: sources.options, option, byAt, choose, loading: sources.loading || !!src?.loading, problem: src && !src.loading ? src.textProblem : null };
}

interface Part { start: At; end: At; title: string }
interface Help { itemId: string; name: string; kind: RefKind; language?: string; parts: Part[]; wholeBook: boolean; body?: string }

/** The guides and notes offered to this language, with where in this book each one is. */
function useBookHelps(ctx: Ctx, book: string, v11n: VersificationDoc | null): Help[] {
  const state = ctx.language.state;
  const { rows, docs } = useRefItems(ctx);
  return useMemo(() => {
    const offered = recommendedFor(ctx.org.state?.recommendations, state);
    const out: Help[] = [];
    for (const r of rows) {
      if (!offered.has(r.it.itemId) || r.kind === 'source' || r.kind === 'questions') continue;
      const p = itemRangesIn(r.doc, docs.get, book, v11n);
      if (!p) continue;
      const doc = r.doc as { language?: string } | null;
      out.push({
        itemId: r.it.itemId, name: r.it.name, kind: p.kind, ...(doc?.language ? { language: doc.language } : {}), wholeBook: p.wholeBook,
        parts: p.parts.map((x) => ({ start: atOf(x.range.start.chapter, x.range.start.verse), end: atOf(x.range.end.chapter, x.range.end.verse), title: x.title ?? r.it.name })),
        ...(r.doc?.format === 'material@1' && (r.doc as MaterialDoc).body ? { body: (r.doc as MaterialDoc).body } : {})
      });
    }
    return out;
  }, [rows, docs.get, book, v11n, state, ctx.org.state]);
}

type Panel = null | 'bible' | 'jump' | 'from' | 'helps' | 'leave' | { section: At };

export function DivideOwnWay(props: {
  ctx: Ctx; book: string; bookName: string; doc: TemplateDoc; v11n: VersificationDoc | null; fallbackVerses: readonly number[];
  item: LibraryItemView | null; redo: boolean; onClose: () => void; onDone: () => void;
  /** In the template editor (decision 103): take the book's new sections instead of changing the language's template. */
  apply?: (way: TemplateDoc, note: string, said: string) => void;
}) {
  const { ctx, book, bookName } = props;
  const maxVerses = useMemo(() => props.v11n?.maxVerses[book] ?? props.fallbackVerses, [props.v11n, book, props.fallbackVerses]);
  const order = useMemo(() => verseOrder(maxVerses), [maxVerses]);
  const chapters = useMemo(() => maxVerses.map((_, i) => i + 1), [maxVerses]);
  const ways = useWays(ctx, ctx.language.languageId, props.v11n?.code ?? null);
  // Where English Bibles start sections, moved into this language's numbering when it is another.
  const englishHash = ways.numberings.find((n) => n.code === 'eng')?.hash;
  const engDocs = useLibraryDocs(ctx.language.orgId, [englishHash], { deps: false });
  const english = engDocs.get<VersificationDoc>(englishHash);
  const breaks = useMemo(() => bibleBreaksIn(book, english, props.v11n), [book, english, props.v11n]);

  // The book as the language divides it now, else by chapter: decided once, when the editor opens.
  const [first] = useState(() => {
    const own = startsOfWay(props.doc, book, props.v11n);
    return own.size ? own : new Set(chapters.map((c) => atOf(c, 1)));
  });
  const [firstNames] = useState(() => namesOfWay(props.doc, book));
  const [starts, setStarts] = useState<Set<At>>(first);
  const [names, setNames] = useState<Record<At, string>>(firstNames);
  const [sel, setSel] = useState<At | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [undo, setUndo] = useState<Set<At> | null>(null);
  const [inView, setInView] = useState(1);
  const list = useRef<FlatList<number>>(null);
  const sections = useMemo(() => sectionsOf(order, starts), [order, starts]);
  const numberOf = (at: At, secs: Section[] = sections) => secs.findIndex((s) => s.start === at) + 1;
  const text = useBookText(ctx, book, maxVerses);
  const helps = useBookHelps(ctx, book, props.v11n);
  const change = useBookChange(ctx, { book, bookName, doc: props.doc, item: props.item, redo: props.redo, onDone: props.onDone });
  const dirty = starts.size !== first.size || [...starts].some((a) => !first.has(a))
    || Object.keys({ ...names, ...firstNames }).some((k) => (names[k] ?? '').trim() !== (firstNames[k] ?? '').trim());
  const onViewable = useRef(({ viewableItems }: { viewableItems: { item: number }[] }) => { if (viewableItems[0]) setInView(viewableItems[0].item); }).current;

  /** Change the starts and say what changed; Undo (in the toast and under Save) brings back what they were. */
  const replace = (next: Set<At>, said: string) => {
    const before = starts;
    setUndo(before);
    setStarts(next);
    setSel(null);
    ctx.toast(said, () => { setStarts(before); setUndo(null); });
  };
  const startAt = (at: At) => {
    const next = new Set(starts).add(at);
    replace(next, t('breakup.own.started', { n: formatNumber(numberOf(at, sectionsOf(order, next))), at }));
  };
  const joinAt = (at: At) => {
    const next = new Set(starts);
    next.delete(at);
    replace(next, t('breakup.own.joined', { n: formatNumber(numberOf(at) - 1) }));
  };
  const jump = (c: number) => list.current?.scrollToIndex({ index: Math.max(0, c - 1), animated: true });
  const save = () => {
    // i18n-ignore: the part's name is stored in the template, as the ready-made ways store theirs ("Passage", "Chapter")
    const way = ownWayDoc({ base: props.doc, book, bookName, part: 'Section', sections, names, v11n: props.v11n, english });
    const note = `${bookName} is divided its own way`; // i18n-ignore: the new version's note, stored in the event log
    if (props.apply) props.apply(way, note, t('breakup.own.saved', { book: bookName }));
    else change.start(way, note, t('breakup.own.saved', { book: bookName }));
  };
  const back = () => (dirty ? setPanel('leave') : props.onClose());

  const offered = ways.rows.filter((r) => !r.later && !isItself(r, props.item?.itemId) && (() => { const d = ways.docOf(r.choice); return !!d && wayCovers(d, book); })());
  const section = panel && typeof panel === 'object' ? sections.find((s) => s.start === panel.section) ?? null : null;
  const outline = helps.filter((h) => h.kind === 'guide').flatMap((h) => h.parts).filter((p) => order.includes(p.start));

  const footer = panel === 'helps' ? (
    <HelpsPane book={bookName} helps={helps} outline={outline} onClose={() => setPanel(null)}
      onGo={(at) => { setPanel(null); jump(parseAt(at).chapter); }}
      onUse={() => { setPanel(null); replace(new Set([...starts, ...outline.map((p) => p.start)]), t('breakup.own.usedOutline')); }} />
  ) : sel ? (
    <View style={{ gap: space.sm }}>
      <View style={styles.selRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[txt.body, { fontWeight: '800' }]}>{`${bookName} ${sel}`}</Text>
          {text.byAt.get(sel) ? <Text style={txt.smMuted} numberOfLines={2}>{text.byAt.get(sel)}</Text> : null}
        </View>
        <Round icon="close" label={t('common.close')} onPress={() => setSel(null)} />
      </View>
      {sel === order[0]
        ? <Text style={[txt.smMuted, { textAlign: 'center', paddingVertical: space.sm }]}>{t('breakup.own.bookStarts')}</Text>
        : starts.has(sel)
          ? <PrimaryBtn label={t('breakup.own.joinWith', { n: formatNumber(numberOf(sel) - 1) })} icon="join" onPress={() => joinAt(sel)} />
          : <PrimaryBtn label={t('breakup.own.startHere')} icon="cut" onPress={() => startAt(sel)} />}
    </View>
  ) : (
    <>
      <PrimaryBtn label={t('breakup.own.save', { count: sections.length })} icon="check" busy={change.busy} disabled={!props.item && !props.apply} onPress={save} />
      <QuietLinks items={[
        ...(undo ? [{ label: t('breakup.own.undo'), icon: 'undo' as const, onPress: () => { setStarts(undo); setUndo(null); } }] : []),
        { label: t('breakup.own.startFrom'), icon: 'book', onPress: () => setPanel('from') }
      ]} />
    </>
  );

  return (
    <Screen fixed footer={footer} header={<Header title={bookName} sub={t('breakup.own.headerSub', { count: sections.length })} onBack={back} />}>
      <View style={styles.tools}>
        <Pill icon="book" help down label={text.option ? chipLabel(text.option, text.options) : t('breakup.own.noBibleChip')} onPress={() => setPanel('bible')} />
        <Pill icon="layers" help label={t('breakup.own.helps')} on={panel === 'helps'} onPress={() => setPanel(panel === 'helps' ? null : 'helps')} />
        <Pill down label={t('breakup.own.chapterChip', { n: formatNumber(inView) })} onPress={() => setPanel('jump')} />
      </View>
      <FlatList
        ref={list}
        data={chapters}
        keyExtractor={(c) => String(c)}
        initialNumToRender={2}
        windowSize={5}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl }}
        onViewableItemsChanged={onViewable}
        onScrollToIndexFailed={(info) => {
          list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
          setTimeout(() => list.current?.scrollToIndex({ index: info.index, animated: false }), 120);
        }}
        ListHeaderComponent={
          <View style={{ gap: space.sm, paddingTop: space.md }}>
            <View style={styles.key}>
              <Ico name="cut" size={14} color={C.muted} />
              <Text style={[txt.xs, { flex: 1 }]}>{t('breakup.own.key', { total: formatNumber(BIBLES_COUNTED) })}</Text>
            </View>
            {text.loading ? <Text style={txt.smMuted}>{t('breakup.own.loadingText', { book: bookName })}</Text>
              : text.byAt.size === 0 ? <Text style={txt.smMuted}>{text.problem ?? t('breakup.own.noText', { book: bookName })}</Text> : null}
          </View>
        }
        renderItem={({ item: c }) => (
          <ChapterBlock c={c} count={maxVerses[c - 1] ?? 0} first={order[0]!} starts={starts} sections={sections} names={names} breaks={breaks} text={text.byAt}
            sel={sel} bookName={bookName} onVerse={(at) => setSel(sel === at ? null : at)} onStart={startAt} onSection={(at) => setPanel({ section: at })} />
        )}
      />

      <Sheet visible={panel === 'bible'} title={t('breakup.own.bibleTitle', { book: bookName })} sub={t('breakup.own.bibleSub')} onClose={() => setPanel(null)}>
        {text.options.length ? (
          <Group>
            {text.options.map((o, i) => (
              <Row key={o.itemId} icon="book" label={o.name} last={i === text.options.length - 1} role="radio" selected={o.itemId === text.option?.itemId}
                sub={o.from === 'language' || o.from === 'organization' ? t('breakup.own.teamBible', { language: languageLabel(o.language) }) : languageLabel(o.language)}
                right={o.itemId === text.option?.itemId ? <Ico name="check" size={22} color={C.green} strokeWidth={3} /> : undefined}
                onPress={() => { text.choose(o.itemId); setPanel(null); }} />
            ))}
          </Group>
        ) : <Text style={txt.smMuted}>{t('breakup.own.noText', { book: bookName })}</Text>}
      </Sheet>

      <Sheet visible={panel === 'jump'} title={t('breakup.own.jumpTitle')} sub={t('breakup.own.jumpSub')} onClose={() => setPanel(null)}>
        <View style={styles.grid}>
          {chapters.map((c) => {
            const n = sections.filter((s) => parseAt(s.start).chapter === c).length;
            return (
              <Pressable key={c} onPress={() => { setPanel(null); jump(c); }} accessibilityRole="button"
                accessibilityLabel={t('breakup.own.jumpLabel', { chapter: formatNumber(c), count: n })}
                style={({ pressed }) => [styles.tile, c === inView && { borderColor: C.primary }, pressed && { opacity: 0.7 }]}>
                <Text style={[txt.h3, { fontSize: 18, fontWeight: '800' }]}>{formatNumber(c)}</Text>
                <Text style={txt.xsStrong}>{formatNumber(n)}</Text>
              </Pressable>
            );
          })}
        </View>
      </Sheet>

      <Sheet visible={panel === 'from'} title={t('breakup.own.fromTitle')} sub={t('breakup.own.fromSub', { book: bookName })} onClose={() => setPanel(null)}>
        <Group>
          {offered.map((r, i) => {
            const fromStarts = startsOfWay(ways.docOf(r.choice), book, props.v11n);
            return (
              <Row key={r.choice.key} icon="book" label={r.choice.name} sub={t('breakup.own.sections', { count: fromStarts.size })} last={i === offered.length - 1}
                onPress={() => { setPanel(null); replace(fromStarts, t('breakup.own.startedFrom', { book: bookName, way: r.choice.name })); }} />
            );
          })}
        </Group>
        {offered.length === 0 ? <Text style={txt.smMuted}>{ways.loaded ? t('breakup.book.connectForWays') : t('common.loading')}</Text> : null}
      </Sheet>

      {section ? (
        <SectionSheet n={numberOf(section.start)} section={section} bookName={bookName} name={names[section.start] ?? ''}
          onName={(name) => setNames((cur) => ({ ...cur, [section.start]: name }))}
          onJoin={section.start === order[0] ? undefined : () => { setPanel(null); joinAt(section.start); }}
          onClose={() => setPanel(null)} />
      ) : null}

      <Sheet visible={panel === 'leave'} title={t('breakup.own.leaveTitle')} sub={t('breakup.own.leaveSub', { book: bookName })} onClose={() => setPanel(null)}
        footer={<>
          <PrimaryBtn label={t('breakup.own.save', { count: sections.length })} icon="check" busy={change.busy} disabled={!props.item} onPress={() => { setPanel(null); save(); }} />
          <QuietLinks items={[{ label: t('breakup.own.leaveAnyway'), icon: 'close', onPress: props.onClose }]} />
        </>}>
        {null}
      </Sheet>
      {change.sheets}
    </Screen>
  );
}

/** One chapter: a card where each section starts, a dashed line where many Bibles start one, the verses between. */
function ChapterBlock(props: {
  c: number; count: number; first: At; starts: ReadonlySet<At>; sections: Section[]; names: Readonly<Record<At, string>>; breaks: ReadonlyMap<string, number>;
  text: ReadonlyMap<At, string>; sel: At | null; bookName: string;
  onVerse: (at: At) => void; onStart: (at: At) => void; onSection: (at: At) => void;
}) {
  const { c } = props;
  const blocks: ReactNode[] = [];
  let run: ReactNode[] = [];
  const flush = (key: string) => {
    if (run.length) blocks.push(<Text key={`p${key}`} style={styles.para}>{run}</Text>);
    run = [];
  };
  for (let v = 1; v <= props.count; v++) {
    const at = atOf(c, v);
    const bibles = props.breaks.get(at) ?? 0;
    if (props.starts.has(at) || at === props.first) {
      flush(at);
      const i = props.sections.findIndex((s) => s.start === at);
      blocks.push(<SectionCard key={`s${at}`} n={i + 1} section={props.sections[i]!} name={props.names[at]} bookName={props.bookName}
        bibles={at === props.first ? null : bibles} onPress={() => props.onSection(at)} />);
    } else if (bibles >= SUGGEST) {
      flush(at);
      blocks.push(<Suggestion key={`g${at}`} at={at} bibles={bibles} onStart={() => props.onStart(at)} />);
    }
    const words = props.text.get(at);
    run.push(
      // No button role: on the web that makes each verse a block of its own instead of running text.
      <Text key={at} onPress={() => props.onVerse(at)} style={props.sel === at ? styles.selected : undefined} accessibilityLabel={t('breakup.own.verseLabel', { at })}>
        <Text style={styles.verseNo}>{`${formatNumber(v)} `}</Text>
        {words === undefined ? <Text style={{ color: C.faint }}>{'· · ·'}</Text> : words}{' '}
      </Text>
    );
  }
  flush('end');
  const goesOn = props.starts.has(atOf(c, 1)) || c === 1 ? 0 : props.sections.findIndex((s) => parseAt(s.start).chapter < c && parseAt(s.end).chapter >= c) + 1;
  return (
    <View>
      <View style={styles.chapterHead}>
        <Text style={txt.label}>{t('breakup.own.chapterHead', { n: formatNumber(c) })}</Text>
        {goesOn ? <Text style={txt.xs}>{t('breakup.own.goesOn', { n: formatNumber(goesOn) })}</Text> : null}
      </View>
      {blocks}
    </View>
  );
}

function SectionCard(props: { n: number; section: Section; name?: string; bookName: string; bibles: number | null; onPress: () => void }) {
  const where = `${props.bookName} ${sectionLabel(props.section)}`;
  const sub = [props.name ? where : '', t('breakup.own.verses', { count: props.section.verses }),
    props.bibles ? t('breakup.own.alsoBibles', { n: formatNumber(props.bibles), total: formatNumber(BIBLES_COUNTED) }) : ''].filter(Boolean).join(' · ');
  return (
    <Pressable onPress={props.onPress} accessibilityRole="button" style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}>
      <View style={styles.num}><Text style={styles.numText}>{formatNumber(props.n)}</Text></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[txt.body, { fontWeight: '800' }]} numberOfLines={1}>{props.name || where}</Text>
        <Text style={txt.xs}>{sub}</Text>
      </View>
      <Ico name="edit" size={18} color={C.muted} />
    </Pressable>
  );
}

function Suggestion(props: { at: At; bibles: number; onStart: () => void }) {
  const bibles = t('breakup.own.bibles', { n: formatNumber(props.bibles), total: formatNumber(BIBLES_COUNTED) });
  return (
    <Pressable onPress={props.onStart} accessibilityRole="button" accessibilityLabel={t('breakup.own.suggestionLabel', { at: props.at, bibles })}
      style={({ pressed }) => [styles.suggest, pressed && { opacity: 0.7 }]}>
      <Ico name="cut" size={16} color={C.muted} />
      <View style={{ flex: 1, minWidth: 0, paddingVertical: space.xs }}>
        <Text style={[txt.sm, { fontWeight: '800', color: C.dark }]}>{bibles}</Text>
        <Text style={txt.xs}>{t('breakup.own.startAt')}</Text>
      </View>
      <View style={styles.startPill}><Text style={[txt.sm, { color: C.primary, fontWeight: '800' }]}>{t('breakup.own.startPill')}</Text></View>
    </Pressable>
  );
}

function SectionSheet(props: { n: number; section: Section; bookName: string; name: string; onName: (name: string) => void; onJoin?: () => void; onClose: () => void }) {
  return (
    <Sheet visible title={t('breakup.own.sectionTitle', { n: formatNumber(props.n) })}
      sub={`${props.bookName} ${sectionLabel(props.section)} · ${t('breakup.own.verses', { count: props.section.verses })}`}
      onClose={props.onClose} footer={<PrimaryBtn label={t('common.done')} icon="check" onPress={props.onClose} />}>
      <Field label={t('breakup.own.nameLabel')} value={props.name} onChangeText={props.onName} placeholder={t('breakup.own.namePlaceholder')} autoCapitalize="sentences" />
      <Group>
        {props.onJoin
          ? <Row icon="join" label={t('breakup.own.joinWith', { n: formatNumber(props.n - 1) })} sub={t('breakup.own.joinSub')} last onPress={props.onJoin} />
          : <Row icon="book" label={t('breakup.own.bookStarts')} sub={t('breakup.own.firstCantJoin')} last />}
      </Group>
    </Sheet>
  );
}

type HelpsTab = 'outline' | 'notes' | 'guides';

/** What helps decide where sections start, under the text so both can be read: an outline, notes on verses, the guides. */
function HelpsPane(props: { book: string; helps: Help[]; outline: Part[]; onClose: () => void; onGo: (at: At) => void; onUse: () => void }) {
  const notes = props.helps.filter((h) => h.kind !== 'guide').flatMap((h) => h.parts.map((p) => ({ help: h, part: p })));
  const [tab, setTab] = useState<HelpsTab>(props.outline.length ? 'outline' : notes.length ? 'notes' : 'guides');
  const from = [...new Set(props.helps.filter((h) => h.kind === 'guide' && h.parts.length).map((h) => h.name))].join(', ');
  const tabs: [HelpsTab, string][] = [
    ['outline', t('breakup.own.tabOutline')],
    ['notes', t('breakup.own.tabNotes', { n: formatNumber(notes.length) })],
    ['guides', t('breakup.own.tabGuides')]
  ];
  return (
    <View style={styles.pane}>
      <View style={styles.selRow}>
        <Text style={[txt.h3, { flex: 1 }]}>{t('breakup.own.helpsTitle', { book: props.book })}</Text>
        <Round icon="close" label={t('breakup.own.closeHelps')} onPress={props.onClose} />
      </View>
      <View style={styles.tabs}>
        {tabs.map(([id, label]) => (
          <Pressable key={id} onPress={() => setTab(id)} accessibilityRole="tab" accessibilityState={{ selected: tab === id }}
            style={[styles.tab, tab === id && styles.tabOn]}>
            <Text style={[txt.sm, { fontWeight: '800', color: tab === id ? C.card : C.dark }]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={{ gap: space.sm, paddingBottom: space.sm }}>
        {tab === 'outline' ? (props.outline.length ? (
          <>
            <Text style={txt.xs}>{t('breakup.own.outlineFrom', { from })}</Text>
            <Group>
              {props.outline.map((p, i) => (
                <Row key={`${p.start}-${i}`} label={p.title} sub={`${props.book} ${sectionLabel(p)}`} last={i === props.outline.length - 1} onPress={() => props.onGo(p.start)} />
              ))}
            </Group>
            <Pressable onPress={props.onUse} accessibilityRole="button" style={({ pressed }) => [styles.useStarts, pressed && { opacity: 0.7 }]}>
              <Ico name="cut" size={16} color={C.primary} />
              <Text style={[txt.sm, { color: C.primary, fontWeight: '800' }]}>{t('breakup.own.useOutline')}</Text>
            </Pressable>
          </>
        ) : <Text style={txt.smMuted}>{t('breakup.own.noOutline', { book: props.book })}</Text>) : null}
        {tab === 'notes' ? (notes.length ? notes.map(({ help, part }, i) => (
          <View key={`${help.itemId}-${i}`} style={styles.note}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Ico name="note" size={16} color={TINT.amberText} />
              <Text style={[txt.sm, { fontWeight: '800', color: TINT.amberText, flex: 1 }]} numberOfLines={1}>
                {t('breakup.own.noteOn', { name: help.name, where: sectionLabel(part) })}
              </Text>
            </View>
            {help.body ? <Text style={txt.sm} numberOfLines={4}>{help.body}</Text> : null}
            <Pressable onPress={() => props.onGo(part.start)} accessibilityRole="button" style={{ minHeight: 36, justifyContent: 'center', alignSelf: 'flex-start' }}>
              <Text style={[txt.sm, { fontWeight: '800', color: TINT.amberText }]}>{t('breakup.own.showInText')}</Text>
            </Pressable>
          </View>
        )) : <Text style={txt.smMuted}>{t('breakup.own.noNotes', { book: props.book })}</Text>) : null}
        {tab === 'guides' ? (props.helps.length ? (
          <Group>
            {props.helps.map((h, i) => (
              <Row key={h.itemId} icon={h.kind === 'guide' ? 'sparkle' : 'file'} label={h.name} last={i === props.helps.length - 1}
                sub={[h.language ? languageLabel(h.language) : '', h.parts.length ? t('breakup.own.partsIn', { count: h.parts.length, book: props.book })
                  : h.wholeBook ? t('breakup.own.allOf', { book: props.book }) : t('breakup.own.nothingFor', { book: props.book })].filter(Boolean).join(' · ')}
                onPress={h.parts[0] ? () => props.onGo(h.parts[0]!.start) : undefined} />
            ))}
          </Group>
        ) : <Text style={txt.smMuted}>{t('breakup.own.noHelps', { book: props.book })}</Text>) : null}
      </ScrollView>
    </View>
  );
}

function Round(props: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} accessibilityRole="button" accessibilityLabel={props.label} hitSlop={4} style={styles.round}>
      <Ico name={props.icon} size={18} color={C.dark} />
    </Pressable>
  );
}

/** A pill above the text: the Bible and the helps in the helps' amber, the chapter plain. */
function Pill(props: { icon?: IconName; label: string; help?: boolean; down?: boolean; on?: boolean; onPress: () => void }) {
  const color = props.help ? TINT.amberText : C.dark;
  return (
    <Pressable onPress={props.onPress} accessibilityRole="button" accessibilityLabel={props.label} accessibilityState={props.on === undefined ? undefined : { expanded: props.on }}
      style={({ pressed }) => [styles.pill, props.help && styles.pillHelp, pressed && { opacity: 0.7 }]}>
      {props.icon ? <Ico name={props.icon} size={16} color={color} /> : null}
      <Text style={[txt.sm, { fontWeight: '700', color, flexShrink: 1 }]} numberOfLines={1}>{props.label}</Text>
      {props.down ? <Ico name="down" size={16} color={color} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tools: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm, borderBottomWidth: 1, borderColor: C.border },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: target.min, paddingHorizontal: space.md, borderRadius: radius.full, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card, flexShrink: 1 },
  pillHelp: { borderColor: TINT.noteBorder, backgroundColor: TINT.note },
  key: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', paddingTop: space.xs },
  chapterHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, paddingTop: 22, paddingBottom: space.xs },
  para: { fontSize: T.base, lineHeight: 27, color: C.dark, marginVertical: space.xs },
  verseNo: { fontSize: T.xs, fontWeight: '800', color: C.muted },
  selected: { backgroundColor: C.border },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.row, marginTop: space.md, marginBottom: 6,
    paddingHorizontal: space.md, paddingVertical: 10, borderRadius: radius.lg, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card
  },
  num: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  numText: { fontSize: T.sm, fontWeight: '800', color: C.primary },
  suggest: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: target.min, marginTop: space.sm, marginBottom: space.xs,
    paddingLeft: space.md, paddingRight: 6, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.faint
  },
  startPill: { height: 36, paddingHorizontal: space.md, borderRadius: 10, backgroundColor: C.light, justifyContent: 'center' },
  selRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  round: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { width: 60, height: 60, borderRadius: 14, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', gap: 1 },
  pane: { gap: space.sm, maxHeight: 380 },
  tabs: { flexDirection: 'row', gap: space.sm },
  tab: { height: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, justifyContent: 'center' },
  tabOn: { borderColor: TINT.amberText, backgroundColor: TINT.amberText },
  note: { padding: space.md, borderRadius: radius.lg, backgroundColor: TINT.amber, gap: 6 },
  useStarts: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, minHeight: target.min, borderRadius: 14, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card }
});
