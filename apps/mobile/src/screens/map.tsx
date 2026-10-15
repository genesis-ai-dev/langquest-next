// The Map (ng-langquest-ux src/screens/map.tsx): StatusHomeScreen (the
// progress overview), MapHomeScreen (a language's passage map, with its
// OutlineMap) and BookMapScreen (a book's chapter grid). MAP-1..8; ADR-009,
// ADR-017, ADR-004. A language's map and a book follow the simple redesign
// (decision 71; the demo's simple Map and MapBook, ADR-032, SIMPLE-12): search
// first, then "Next", then the books with a bar and a count; a book's chapters
// in three states, marked as well as coloured. The filters, the counts and
// the full key are one tap deeper, behind "Filter".
//
// A whole Bible is about 1,200 passages. Nothing here renders them as one
// list: the map is books (grouped, with progress), then a chapter grid per
// book, plus search and filters that narrow to counts first (ADR-009).
// Progress is several counts, never one number (ADR-004).
import {
  languageName, languageProgress, libraryItemView, percent, unitTitle,
  type KindDef, type LanguageProgress, type OrgState, type PassageState, type LanguageState
} from '@langquest-next/core';
import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { canonBook, chapterStage, countFilters, isMapFilter, MAP_FILTERS, type MapFilter, type Testament } from '../reference/canon';
import { deriveKinds, passageSummary } from '../i18n/coreText';
import type { Ctx } from '../shell/ctx';
import { edgeFor, type ScreenId } from '../shell/flow';
import { t } from '../i18n';
import { formatNumber, formatPercent } from '../i18n/format';
import { keptOfflineMap, OfflineMark, offlineWords, type KeptOffline } from '../sync/offline';
import { indexesFor } from '../sync/indexes';
import { useOrgSummary } from '../reports/useOrgSummary';
import {
  Card, Chip, ChipRow, EmptyState, Group, Header, Ico, IconBtn, PrimaryBtn, Row, Screen, SearchField, SectionLabel, Sheet, ShowMore,
  StepMarks, txt, useLayout, useOpenDetail
} from '../ui/kit';
import { mayWriteLibrary } from '../library/model';
import {
  agoWords, bookEntries, bookRowWords, chapterRows, chapterTiles, clauses, clusterView, filterEntries, filterLabel, flowLabel, funnelLayers, funnelRows,
  isOutline, languageEntries, mapSearch, mapShelf, needsConnection, openableLanguages as openableIn, openState, OTHER, outlineSections, PAGE,
  searchLanguages, sentences, statusLanguages, statusTotals, summarizeBooks, tileLabel, waitingBooks,
  type BookSummary, type ChapterTile, type Entry
} from '../map/mapModel';
import { useForYou, useNextPassage } from '../map/useMapLanguage';
import { NumberingNote } from '../breakup/parts';
import { useVerseNumbering } from '../breakup/useBreakup';
import { ChangedMark, useEarlierSections } from '../breakup/earlier';
import { BookBar, ChapterTileView, FullKey, NextLink, Pills, QuietIconLink, ShortKey } from '../map/mapParts';
import { chapterColumns } from '../ui/layout';
import type { ClusterFilter } from '../clusters/model';
import { contractsFor } from '../shell/screenContracts';
import { edgeAllowed, mapScreenFor } from '../shell/session';
import { C, onColor, radius, space, TINT, type as T } from '../ui/theme';

const fmt = (n: number) => formatNumber(n);

function canGo(ctx: Ctx, from: ScreenId, to: ScreenId): boolean {
  const edge = edgeFor(from, to);
  return !!edge && edgeAllowed(edge, ctx.session);
}

// ---- small shared pieces ---------------------------------------------------------------

/** Done in green, recorded in brand, the rest empty: two counts on one bar. */
function StackBar(props: { done: number; recorded: number; total: number; height?: number; recordedColor?: string }) {
  const h = props.height ?? 8;
  return (
    <View style={{ flexDirection: 'row', height: h, borderRadius: h, overflow: 'hidden', backgroundColor: C.bg }}>
      <View style={{ width: `${percent(props.done, props.total)}%`, backgroundColor: C.green }} />
      <View style={{ width: `${percent(props.recorded - props.done, props.total)}%`, backgroundColor: props.recordedColor ?? C.primary }} />
    </View>
  );
}

/** A count with an icon on an amber ground (feedback waiting). */
function IconCount(props: { icon: 'chat' | 'clock'; n: number; tone: 'amber' | 'brand' }) {
  const [bg, fg] = props.tone === 'amber' ? [TINT.amber, TINT.amberText] : [C.light, C.primary];
  return (
    <View style={[styles.iconCount, { backgroundColor: bg }]}>
      <Ico name={props.icon} size={14} color={fg} />
      <Text style={[txt.xsStrong, { color: fg }]}>{fmt(props.n)}</Text>
    </View>
  );
}

/** Where a passage stands as one glyph: not started, recording, in review (steps cleared), done. Never colour alone. */
function PassageDisc(props: { s: PassageState }) {
  const s = props.s;
  if (s.done) return <View style={[styles.disc, { backgroundColor: onColor.green }]}><Ico name="check" size={22} color={C.white} /></View>;
  if (!s.recorded) {
    return (
      <View style={[styles.disc, { borderWidth: 2, borderStyle: 'dashed', borderColor: s.drafting ? C.primary : C.border }]}>
        <Ico name="mic" size={18} color={s.drafting ? C.primary : C.faint} />
      </View>
    );
  }
  const cleared = s.steps.filter((st) => st.complete).length;
  const feedback = s.awaitingResponse.length > 0;
  return (
    <View style={[styles.disc, { borderWidth: 3, borderColor: feedback ? C.amber : C.primary, backgroundColor: feedback ? TINT.amber : C.light }]}>
      {feedback ? <Ico name="chat" size={18} color={TINT.amberText} /> : <Text style={[txt.xsStrong, { color: C.dark }]}>{fmt(cleared)}/{fmt(s.steps.length)}</Text>}
    </View>
  );
}

function PassageRow(props: { ctx: Ctx; state: LanguageState; kinds: KindDef[]; e: Entry; mine: boolean; last: boolean; onPress: () => void; changed?: boolean }) {
  const { e, ctx } = props;
  const me = ctx.session.actorId;
  const title = unitTitle(props.state, e.unitId);
  const summary = passageSummary(e.s, props.kinds, me, (id) => ctx.name(id, true));
  const beside = useOpenDetail();
  const offline = keptOfflineMap(ctx).get(e.unitId);
  return (
    <Row testID={`row-${e.unitId}`} label={title} sub={summary} last={props.last} onPress={props.onPress}
      current={beside?.screen === 'passage_record' && beside.params['unitId'] === e.unitId}
      accessibilityLabel={sentences([title, summary, ...(props.mine ? [t('map.forYou')] : []), ...(props.changed ? [t('map.changedSinceRecorded')] : []), offlineWords(offline)])}
      {...(props.mine ? { badge: t('map.forYou'), badgeTone: 'amber' as const } : {})}
      leading={(
        <View>
          <PassageDisc s={e.s} />
          {props.mine ? <View style={styles.discDot} /> : null}
          <OfflineMark u={offline} />
          {props.changed ? <ChangedMark /> : null}
        </View>
      )}
      {...(e.s.recorded && e.s.steps.length > 0
        ? { right: <StepMarks steps={e.s.steps.map((st) => ({ kinds: st.kinds, checkpoint: st.step.checkpoint }))} size={14} /> }
        : {})} />
  );
}

/**
 * The filters, one tap deeper (MAP-3; the simple Map, decision 71): a quiet
 * "Filter" link opens this sheet with the status choices, each with its
 * count, what the stat tiles used to say, and, on a book, the full key.
 * Picking one folds the sheet away again.
 */
function FilterSheet(props: {
  visible: boolean; onClose: () => void; filter: MapFilter; counts: Record<MapFilter, number>; onFilter: (f: MapFilter) => void;
  summary?: string[]; children?: ReactNode;
}) {
  return (
    <Sheet visible={props.visible} title={t('map.filter.title')} sub={t('map.filter.sub')} onClose={props.onClose}>
      {props.summary?.length ? <View style={{ gap: 2 }}>{props.summary.map((line) => <Text key={line} style={txt.smMuted}>{line}</Text>)}</View> : null}
      <View style={styles.filterChoices}>
        {MAP_FILTERS.filter((f) => f.id === 'all' || f.id === props.filter || props.counts[f.id] > 0).map((f) => (
          <Chip key={f.id} label={filterLabel(f.id)} on={props.filter === f.id} onPress={() => { props.onFilter(f.id); props.onClose(); }}
            {...(f.id === 'all' ? {} : { count: props.counts[f.id] })} {...(f.id === 'feedback' ? { icon: 'chat' as const } : {})} />
        ))}
      </View>
      {props.children}
    </Sheet>
  );
}

/** With a filter set, it shows above the list by name and count, with ✕ to clear it. */
function ActiveFilter(props: { filter: MapFilter; counts: Record<MapFilter, number>; onOpen: () => void; onClear: () => void }) {
  const active = props.filter !== 'all' ? MAP_FILTERS.find((f) => f.id === props.filter) : undefined;
  if (!active) return null;
  return (
    <View style={styles.filterBar}>
      <Chip icon="filter" label={filterLabel(active.id)} on count={props.counts[active.id]} onPress={props.onOpen}
        accessibilityLabel={t('map.filter.active', { filter: filterLabel(active.id) })} />
      <IconBtn name="close" label={t('map.filter.clear')} bg={C.card} onPress={props.onClear} />
    </View>
  );
}

// ---- progress overview (MAP-8) ------------------------------------------------------------

/**
 * Every stage of the language's flow on one track (MAP-8): each stage's bar
 * starts at zero and they overlap, the longest behind, so a passage further
 * along sits in a darker band. Stages are nested in practice, so the bands
 * read as how many passages stand at each stage. The legend under it gives
 * the exact counts, so identity is never colour alone.
 */
function FunnelRows(props: { progress: LanguageProgress; stepNames?: string[] }) {
  const p = props.progress;
  const rows = funnelRows(p, props.stepNames, C.green);
  // Longest first, so a shorter bar is never hidden behind a longer one.
  const layers = funnelLayers(rows);
  const h = 14;
  return (
    <View style={{ gap: space.sm }}>
      <View accessible accessibilityRole="progressbar"
        accessibilityLabel={clauses(rows.map((r) => t('map.funnel.item', { label: r.label, n: fmt(r.n), total: fmt(p.total) })))}
        style={{ height: h, borderRadius: h, backgroundColor: C.bg, overflow: 'hidden' }}>
        {layers.map((r) => (
          <View key={`${r.label}-${r.i}`} style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, minWidth: h, borderRadius: h,
            width: `${Math.min(100, (r.n / p.total) * 100)}%`, backgroundColor: r.color,
            borderRightWidth: r.n < p.total ? 2 : 0, borderColor: C.card
          }} />
        ))}
      </View>
      <View style={styles.legend}>
        {rows.map((r, i) => (
          <View key={`${r.label}-${i}`} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: r.color }]} />
            {r.checkpoint ? <Ico name="lock" size={12} color={TINT.amberText} /> : null}
            <Text style={txt.smMuted} numberOfLines={1}>{r.label}</Text>
            <Text style={[txt.sm, { fontWeight: '700' }]}>{fmt(r.n)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function StatusHome(ctx: Ctx) {
  const state = ctx.language.state;
  const beside = useOpenDetail();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  // One cluster at a time (decision 108, demo ADR-045); opened from a cluster's page, that one.
  const [cluster, setCluster] = useState<ClusterFilter>(ctx.params['clusterId'] ? { kind: 'cluster', clusterId: ctx.params['clusterId'] } : { kind: 'all' });
  // Every language the organization has; each is its own stream (decision
  // 63). This phone folds the one it has open; the dashboard's server
  // answers for the rest (decision 44), as of when it last caught up.
  const summary = useOrgSummary(ctx.session.actorId, ctx.language.orgId);
  // Only languages this person may open (a role at the organization or that
  // language's scope): opening one they hold nothing in would leave them with
  // no privileges at all, so no tabs and no home (NAV-042).
  const listed = useMemo(() => openableLanguages(ctx), [ctx.languages, ctx.org.state, ctx.session.actorId]);
  const languages = useMemo(
    () => statusLanguages({ listed, state, openId: ctx.language.languageId, org: ctx.org.state, summary }),
    [state, listed, ctx.language.languageId, ctx.org.state, summary]);
  const orgName = ctx.org.state?.org?.value.name ?? '';
  const header = <Header title={t('map.status.title')} sub={[orgName, t('map.status.allLanguages')].filter(Boolean).join(' · ')} />;
  if (!state) return <Screen header={header}><EmptyState icon="progress" title={t('common.loading')} /></Screen>;

  // The clusters among the languages listed here, and the languages the chosen one holds.
  const { clusters, filter, kept, outside } = clusterView(ctx.org.state, languages.map((l) => l.languageId), cluster);
  const inView = languages.filter((l) => kept.has(l.languageId));
  const { known, asOf, total, recorded, done, waiting } = statusTotals(inView);
  const q = query.trim().toLowerCase();
  const shown = searchLanguages(inView, query);
  // The param opens that language's stream.
  const open = (languageId: string) => ctx.go('map_home', { languageId });
  const isOpen = (languageId: string) => beside?.screen === 'map_home' && beside.params['languageId'] === languageId;

  return (
    <Screen header={header}>
      {clusters.length ? (
        <ChipRow>
          <Chip label={t('clusters.status.all')} count={languages.length} on={filter.kind === 'all'} onPress={() => { setCluster({ kind: 'all' }); setLimit(PAGE); }} />
          {clusters.map((c) => (
            <Chip key={c.clusterId} label={c.name} icon="layers" count={c.languageIds.length} on={filter.kind === 'cluster' && filter.clusterId === c.clusterId}
              onPress={() => { setCluster({ kind: 'cluster', clusterId: c.clusterId }); setLimit(PAGE); }} />
          ))}
          {outside ? <Chip label={t('clusters.status.none')} count={outside} on={filter.kind === 'none'} onPress={() => { setCluster({ kind: 'none' }); setLimit(PAGE); }} /> : null}
        </ChipRow>
      ) : null}
      {languages.length === 0 ? (
        <EmptyState icon="globe" title={t('map.noLanguages')} sub={t('map.status.noLanguagesSub')} />
      ) : (
        <Card>
          <Text style={[txt.sm, { color: C.muted, fontWeight: '600' }]}>
            {known.length === inView.length ? t('map.status.across', { count: inView.length }) : t('map.status.counted', { count: inView.length, known: fmt(known.length) })} · {t('map.passages', { count: total })}
          </Text>
          {asOf ? <Text style={txt.smMuted}>{t('map.status.asOf', { ago: agoWords(asOf) })}</Text> : null}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.xl }}>
            <View>
              <Text style={[styles.bigNumber, { color: C.primary }]}>{formatPercent(percent(recorded, total))}</Text>
              <Text style={txt.smMuted}>{t('map.status.recorded')}</Text>
            </View>
            <View>
              <Text style={[styles.bigNumber, { color: TINT.greenText }]}>{formatPercent(percent(done, total))}</Text>
              <Text style={txt.smMuted}>{t('map.status.done')}</Text>
            </View>
            <View style={{ marginLeft: 'auto', alignItems: 'flex-end' }}>
              <Text style={[txt.h2]}>{fmt(waiting)}</Text>
              <Text style={txt.smMuted}>{t('map.status.withReviewers')}</Text>
            </View>
          </View>
          <StackBar done={done} recorded={recorded} total={total} height={10} recordedColor={C.soft} />
        </Card>
      )}
      {languages.length > 5 ? <SearchField value={query} onChangeText={(t) => { setQuery(t); setLimit(PAGE); }} placeholder={t('map.status.find')} testID="map-search" /> : null}
      {shown.length > 0 ? <SectionLabel label={t('map.status.languages')} /> : null}
      {shown.slice(0, limit).map((l) => l.progress && l.here ? (
        <Card key={l.languageId} current={isOpen(l.languageId)} onPress={() => open(l.languageId)} accessibilityLabel={t('map.status.languageLabel', { name: l.name, recorded: fmt(l.progress.recorded), total: fmt(l.progress.total) })}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={styles.code}><Text style={[txt.sm, { fontWeight: '700', color: C.primary }]}>{l.code}</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[txt.body, { fontWeight: '600' }]} numberOfLines={1}>{l.name}</Text>
              <Text style={txt.smMuted} numberOfLines={1}>{t('map.passages', { count: l.progress.total })} · {l.flow}</Text>
            </View>
            {l.progress.waiting > 0 ? <IconCount icon="clock" n={l.progress.waiting} tone="brand" /> : null}
            <Ico name="right" size={24} color={C.muted} />
          </View>
          <FunnelRows progress={l.progress} {...(l.stepNames ? { stepNames: l.stepNames } : {})} />
        </Card>
      ) : (
        // Not open on this phone: opening it brings it down (decision 63).
        // The server's figures, when it has them, show what it holds meanwhile.
        <Card key={l.languageId} current={isOpen(l.languageId)} onPress={() => open(l.languageId)}
          accessibilityLabel={l.progress
            ? t('map.status.languageLabelAsOf', { name: l.name, recorded: fmt(l.progress.recorded), total: fmt(l.progress.total), ago: agoWords(l.asOf!) })
            : t('map.status.languageLabelAway', { name: l.name })}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={styles.code}><Ico name="download" size={20} color={C.primary} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[txt.body, { fontWeight: '600' }]} numberOfLines={1}>{l.name}</Text>
              <Text style={txt.smMuted} numberOfLines={1}>
                {l.progress ? t('map.status.passagesAsOf', { count: l.progress.total, ago: agoWords(l.asOf!) }) : t('map.status.openToBring')}
              </Text>
            </View>
            {l.progress && l.progress.waiting > 0 ? <IconCount icon="clock" n={l.progress.waiting} tone="brand" /> : null}
            <Ico name="right" size={24} color={C.muted} />
          </View>
          {l.progress ? <FunnelRows progress={l.progress} /> : null}
        </Card>
      ))}
      <ShowMore remaining={shown.length - limit} step={PAGE} onMore={() => setLimit((n) => n + PAGE)} />
      {q && shown.length === 0 ? <Text style={[txt.bodyMuted, { textAlign: 'center', paddingVertical: space.xl }]}>{t('map.status.noMatch', { query })}</Text> : null}
      {languages.length > 0 ? (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('map.status.explain')}</Text>
      ) : null}
    </Screen>
  );
}

// ---- a language's map (MAP-1..4, MAP-6, MAP-7) ------------------------------------------

/** One book as the simple Map shows it: name, bar, "25/97"; with a filter set, how many match. */
function BookRow(props: { b: BookSummary; filter: MapFilter; last: boolean; onPress: () => void }) {
  const { b, filter } = props;
  const words = bookRowWords(b, filter);
  const beside = useOpenDetail();
  return (
    <BookBar testID={`row-${b.key}`} name={b.name} total={b.total} recorded={b.recorded} done={b.done} last={props.last} onPress={props.onPress} waiting={!!b.waiting}
      {...(filter !== 'all' ? { count: fmt(b.matching) } : {})}
      current={beside?.screen === 'book_map' && beside.params['bookId'] === b.key}
      accessibilityLabel={words.label} />
  );
}

/** An outline language (lessons, stories): its folders and their items instead of books and chapters (MAP-6). */
function OutlineMap(props: { ctx: Ctx; state: LanguageState; kinds: KindDef[]; languageId: string; entries: Entry[]; forYou: Set<string> }) {
  const [limits, setLimits] = useState<Record<string, number>>({});
  const sections = useMemo(() => outlineSections(props.entries), [props.entries]);
  return (
    <>
      {sections.map(([name, list]) => {
        const limit = limits[name] ?? PAGE;
        const shown = list.slice(0, limit);
        return (
          <View key={name} style={{ gap: space.sm }}>
            <SectionLabel label={name} />
            <Group>
              {shown.map((e, i) => (
                <PassageRow key={e.unitId} ctx={props.ctx} state={props.state} kinds={props.kinds} e={e} mine={props.forYou.has(e.unitId)}
                  last={i === shown.length - 1} onPress={() => props.ctx.openPassage(e.unitId, props.languageId)} />
              ))}
            </Group>
            <ShowMore remaining={list.length - limit} step={PAGE} onMore={() => setLimits((l) => ({ ...l, [name]: limit + PAGE }))} />
          </View>
        );
      })}
    </>
  );
}

/** Languages this person may open: those a role of theirs covers, at org scope or the language's own (simple/mapModel.ts). */
function openableLanguages(ctx: Ctx): { languageId: string; name: string }[] {
  return openableIn(ctx.org.state, ctx.session.actorId, ctx.languages);
}

/**
 * A language's map, as the simple redesign has it (decision 71; demo Map):
 * the language as the title, search first, then "Next", then the books of
 * one testament with a bar and a count. The stat tiles, the filter and the
 * template and flow move one tap deeper, behind "Filter".
 */
export function MapHome(ctx: Ctx) {
  // The map is of the open language: a `languageId` param has opened it.
  const languageId = ctx.params['languageId'] ?? ctx.languageId;
  const state = openState(ctx.language, languageId);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  // A filter can come with the way here ("Feedback to answer" on a report opens the map showing those).
  const initial = ctx.params['filter'];
  const [filter, setFilter] = useState<MapFilter>(isMapFilter(initial) ? initial : 'all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [testament, setTestament] = useState<Testament | null>(null);
  const forYou = useForYou(ctx, state);
  const next = useNextPassage(ctx, state);
  const entries = useMemo(() => (state ? languageEntries(state) : []), [state]);
  // Books not broken up yet (decision 74), by the app's book id.
  const waiting = useMemo(() => (state ? waitingBooks(state) : []), [state]);
  const books = useMemo(() => summarizeBooks(entries, filter, forYou, waiting), [entries, filter, forYou, waiting]);
  // The team's Bibles numbering verses differently is worth one note (decision 74); it may be put away.
  const numbering = useVerseNumbering(ctx);
  // Sections whose divisions changed since work was recorded on them (decision 80).
  const earlier = useEarlierSections(ctx, state);
  const counts = useMemo(() => countFilters(entries.map((e) => e.s)), [entries]);
  const progress = useMemo(() => (state ? languageProgress(state, indexesFor(state)) : null), [state]);
  const kinds = useMemo(() => (state ? deriveKinds(state) : []), [state]);

  const language = languageId ? languageName(ctx.org.state, languageId) : t('map.home.title');
  const outline = isOutline(entries, waiting);
  const sel = state?.template?.value;
  const templateName = sel ? libraryItemView(ctx.org.state?.library ?? {}, sel.itemId)?.name : undefined;
  // What the header used to say under the title: in the Filter sheet now.
  const about = state ? [outline ? t('map.home.ownOutline') : templateName, flowLabel(state)].filter(Boolean).join(' · ') : '';
  // Workers land here from the Map tab; everyone else came from the overview or a language home.
  const backable = mapScreenFor(ctx.session) === 'status_home';
  const filterLink = state && entries.length > 0 && !outline
    ? <QuietIconLink icon="filter" label={t('map.filter.title')} onPress={() => setFilterOpen(true)} detail={t('map.home.filterHelp')} />
    : undefined;
  const header = <Header title={language} {...(backable ? { onBack: ctx.back } : {})} {...(filterLink ? { action: filterLink } : {})} />;

  if (!languageId) {
    return <Screen header={header}><EmptyState icon="globe" title={t('map.noLanguages')} sub={t('map.home.noLanguagesSub')} /></Screen>;
  }
  // Not read from the server this session, and the server cannot be reached: a
  // language never opened here has nothing on this device yet, so say it needs
  // a connection rather than loading for ever or looking empty (MAP-033,
  // decision 61). It comes down by itself once the phone is back online.
  const notHere = needsConnection({ showing: languageId, open: ctx.language.languageId, pulled: ctx.language.pulled, online: ctx.language.online, empty: !state || entries.length === 0 })
    ? <EmptyState icon="cloud" title={t('map.home.needsConnection', { language })} sub={t('map.home.needsConnectionSub')} />
    : null;
  if (!state || !progress) return <Screen header={header}>{notHere ?? <EmptyState icon="map" title={t('common.loading')} />}</Screen>;

  // Reached from the Map tab, a worker switches language here; from the
  // overview or a language home, the screen is about that one language.
  const choices = ctx.params['languageId'] ? [] : openableLanguages(ctx);
  const switchLanguage = (id: string) => {
    ctx.setLanguage(id);
    setQuery('');
    setLimit(PAGE);
  };
  const openBook = (key: string) => ctx.go('book_map', { languageId, bookId: key, ...(filter !== 'all' ? { filter } : {}) });
  const languageChips = choices.length > 1 ? (
    <ChipRow>
      {choices.map((l) => <Chip key={l.languageId} label={l.name} on={l.languageId === languageId} onPress={() => switchLanguage(l.languageId)} />)}
    </ChipRow>
  ) : null;

  if (entries.length === 0 && waiting.length === 0) {
    return (
      <Screen header={header}>
        {languageChips}
        {notHere ?? <EmptyState icon="book" title={t('map.home.noPassages')} sub={t('map.home.noPassagesSub', { language })} />}
      </Screen>
    );
  }

  const nextLink = next ? <NextLink title={unitTitle(state, next.unitId)} icon={next.icon} onPress={() => ctx.openPassage(next.unitId, languageId)} /> : null;

  if (outline) {
    return (
      <Screen header={header}>
        {languageChips}
        {nextLink}
        <OutlineMap ctx={ctx} state={state} kinds={kinds} languageId={languageId} entries={entries} forYou={forYou} />
      </Screen>
    );
  }

  const { searching, byChapter, bookHits, passageHits } = mapSearch(query, books, entries);
  // New Testament first (demo Map), then Old.
  const { testaments, shownTestament, visible, other } = mapShelf(books, filter, testament);
  const summary = [
    t('map.home.summary', { recorded: fmt(progress.recorded), total: fmt(progress.total), done: fmt(progress.done), waiting: fmt(progress.waiting) }),
    ...(about ? [about] : [])
  ];

  return (
    <Screen header={header}>
      {languageChips}
      <SearchField value={query} onChangeText={(v) => { setQuery(v); setLimit(PAGE); }} placeholder={t('map.home.find')} testID="map-search" />

      {searching ? (
        !byChapter ? (
          <>
            <Text style={[txt.sm, { color: C.muted, fontWeight: '600', paddingHorizontal: space.xs }]}>
              {bookHits.length ? t('map.home.bookHits', { count: bookHits.length }) : t('map.home.noBook')}
            </Text>
            {bookHits.length > 0 ? (
              <Group>
                {bookHits.map((b, i) => <BookRow key={b.key} b={b} filter="all" last={i === bookHits.length - 1} onPress={() => openBook(b.key)} />)}
              </Group>
            ) : null}
          </>
        ) : (
          <>
            <Text style={[txt.sm, { color: C.muted, fontWeight: '600', paddingHorizontal: space.xs }]}>
              {passageHits.length ? t('map.passages', { count: passageHits.length }) : t('map.home.noPassageMatch')}
            </Text>
            {passageHits.length > 0 ? (
              <Group>
                {passageHits.slice(0, limit).map((e, i, shown) => (
                  <PassageRow key={e.unitId} ctx={ctx} state={state} kinds={kinds} e={e} mine={forYou.has(e.unitId)} last={i === shown.length - 1} changed={earlier.over.has(e.unitId)}
                    onPress={() => ctx.openPassage(e.unitId, languageId)} />
                ))}
              </Group>
            ) : null}
            <ShowMore remaining={passageHits.length - limit} step={PAGE} onMore={() => setLimit((l) => l + PAGE)} />
          </>
        )
      ) : (
        <>
          {nextLink}
          {numbering.clash ? <NumberingNote clash={numbering.clash} onIgnore={numbering.ignore} /> : null}
          <ActiveFilter filter={filter} counts={counts} onOpen={() => setFilterOpen(true)} onClear={() => setFilter('all')} />
          {testaments.length > 1 && shownTestament ? (
            <Pills items={testaments.map((id) => ({ id, label: id === 'ot' ? t('map.home.oldTestament') : t('map.home.newTestament') }))} on={shownTestament} onPick={setTestament} />
          ) : null}

          {visible.length === 0 && !other ? (
            <Text style={[txt.bodyMuted, { textAlign: 'center', paddingVertical: space.xl }]}>
              {filter === 'all' ? t('map.home.noBooks') : t('map.nothingMatches')}
            </Text>
          ) : null}
          {visible.length > 0 ? (
            <Group>
              {visible.map((b, i) => <BookRow key={b.key} b={b} filter={filter} last={i === visible.length - 1} onPress={() => openBook(b.key)} />)}
            </Group>
          ) : null}
          {other ? (
            <View style={{ gap: space.sm }}>
              <SectionLabel label={t('map.other')} />
              <Group><BookRow b={other} filter={filter} last onPress={() => openBook(OTHER)} /></Group>
            </View>
          ) : null}
        </>
      )}
      <FilterSheet visible={filterOpen} onClose={() => setFilterOpen(false)} filter={filter} counts={counts} onFilter={setFilter} summary={summary} />
    </Screen>
  );
}

// ---- one book: a grid of chapters (MAP-5) ---------------------------------------------------

/**
 * A chapter in three states (the simple Map, decision 71): done, started, not
 * started, marked as well as coloured. What the old seven tones said (feedback
 * waiting, in review with its steps, recording begun, for you, kept on this
 * device) stays in its spoken label and under Filter's key; a kept chapter
 * keeps its mark at the corner.
 */
function Tile(props: { c: ChapterTile; testID?: string; onPress: () => void; current?: boolean; offline: Map<string, KeptOffline>; changed?: boolean }) {
  const { c } = props;
  const parts = c.list.length;
  // Kept passages of this chapter (decisions.md 61): the mark is green only when every kept one is ready.
  const kept = c.list.map((e) => props.offline.get(e.unitId)).filter((u): u is KeptOffline => !!u);
  const label = tileLabel(c, kept, !!props.changed);
  return (
    <ChapterTileView {...(props.testID ? { testID: props.testID } : {})} n={c.n} stage={chapterStage(c.tone)} dim={!c.matches} current={!!props.current} disabled={parts === 0} label={label} onPress={props.onPress}
      corner={kept.length ? <OfflineMark u={kept.every((u) => u.ready) ? kept[0] : kept.find((u) => !u.ready)} /> : props.changed ? <ChangedMark /> : undefined} />
  );
}

export function BookMap(ctx: Ctx) {
  const languageId = ctx.params['languageId'] ?? ctx.languageId;
  const state = openState(ctx.language, languageId);
  const offline = keptOfflineMap(ctx);
  const bookId = ctx.params['bookId'] ?? '';
  const initial = ctx.params['filter'];
  const [filter, setFilter] = useState<MapFilter>(isMapFilter(initial) ? initial : 'all');
  const [openChapter, setOpenChapter] = useState<number | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const forYou = useForYou(ctx, state);
  const earlier = useEarlierSections(ctx, state);
  const layout = useLayout();
  const beside = useOpenDetail();
  const book = canonBook(bookId);
  const entries = useMemo(() => (state ? bookEntries(languageEntries(state), bookId) : []), [state, languageId, bookId]);
  const counts = useMemo(() => countFilters(entries.map((e) => e.s)), [entries]);
  const kinds = useMemo(() => (state ? deriveKinds(state) : []), [state]);
  const chapters = useMemo(() => (book ? chapterTiles(book, entries, forYou, filter) : []), [book, entries, forYou, filter]);

  const language = languageId ? languageName(ctx.org.state, languageId) : '';
  const title = book?.name ?? t('map.other');
  const recordedCount = entries.filter((e) => e.s.recorded).length;
  const crumbs = [{ label: language || t('map.home.title'), onPress: () => ctx.go('map_home', languageId ? { languageId } : undefined) }, { label: title }];
  const canEdit = !!book && canGo(ctx, 'book_map', 'book_structure');
  // The demo's book (MapBook): the book's name and how many of its passages are recorded; nothing else up top.
  const header = <Header title={title} crumbs={crumbs} onBack={ctx.back} sub={t('map.book.sub', { count: entries.length, recorded: fmt(recordedCount) })} />;
  if (!languageId || (!book && bookId !== OTHER)) {
    return <Screen header={header}><EmptyState icon="book" title={t('map.book.notHere')} sub={t('map.book.notHereSub')} /></Screen>;
  }
  if (!state) return <Screen header={header}><EmptyState icon="book" title={t('common.loading')} /></Screen>;

  if (book && entries.length === 0 && waitingBooks(state).includes(book.id)) {
    // Breaking a book up publishes the language's template in the organization's library, so it takes the
    // privilege at organization scope (decision 74, content.tsx `canBreak`): a language lead is told who does it.
    const may = canGo(ctx, 'book_map', 'book_structure') && mayWriteLibrary(ctx.org.state, ctx.session.actorId, 'template');
    return (
      <Screen header={<Header title={title} crumbs={crumbs} onBack={ctx.back} sub={t('map.waiting')} />}
        footer={may ? <PrimaryBtn label={t('map.book.breakUp', { book: book.name })} icon="cut" onPress={() => ctx.go('book_structure', { languageId, bookId })} /> : undefined}>
        <EmptyState icon="cut" title={t('map.book.notBrokenUp', { book: book.name })}
          sub={may ? t('map.book.chooseHow', { book: book.name }) : t('map.book.coordinatorDecides', { book: book.name })} />
      </Screen>
    );
  }

  const open = (e: Entry) => ctx.openPassage(e.unitId, languageId);
  const sheet = openChapter ? chapters[openChapter - 1] : undefined;
  const summary = [language
    ? t('map.book.summaryIn', { count: entries.length, recorded: fmt(recordedCount), language })
    : t('map.book.summary', { count: entries.length, recorded: fmt(recordedCount) })];
  const filterSheet = (
    <FilterSheet visible={filterOpen} onClose={() => setFilterOpen(false)} filter={filter} counts={counts} onFilter={(f) => { setFilter(f); setLimit(PAGE); }} summary={summary}>
      {book ? (
        <>
          <SectionLabel label={t('map.book.key')} />
          <FullKey none={chapters.some((c) => c.tone === 'none')} />
        </>
      ) : null}
    </FilterSheet>
  );
  // The less likely ways on, quiet, under the chapters: the filters and the full key, and shaping the book for those who may.
  const quiet = (
    <View style={styles.quietRow}>
      <QuietIconLink icon="filter" label={t('map.filter.title')} onPress={() => setFilterOpen(true)} detail={t('map.book.filterHelp')} />
      {canEdit ? (
        <QuietIconLink icon="cut" label={t('map.book.breakUpDifferently')} onPress={() => ctx.go('book_structure', { languageId: languageId ?? '', bookId })}
          detail={t('map.book.breakUpDifferentlyHelp')} />
      ) : null}
    </View>
  );

  // Passages that sit in no book have no chapters to lay out: a list, 25 at a time.
  if (!book) {
    const shown = filterEntries(entries, filter);
    return (
      <Screen header={header}>
        <ActiveFilter filter={filter} counts={counts} onOpen={() => setFilterOpen(true)} onClear={() => setFilter('all')} />
        {shown.length === 0 ? <Text style={[txt.bodyMuted, { textAlign: 'center', paddingVertical: space.xl }]}>{t('map.nothingMatches')}</Text> : (
          <Group>
            {shown.slice(0, limit).map((e, i, list) => (
              <PassageRow key={e.unitId} ctx={ctx} state={state} kinds={kinds} e={e} mine={forYou.has(e.unitId)} last={i === list.length - 1} onPress={() => open(e)} changed={earlier.over.has(e.unitId)} />
            ))}
          </Group>
        )}
        <ShowMore remaining={shown.length - limit} step={PAGE} onMore={() => setLimit((l) => l + PAGE)} />
        {quiet}
        {filterSheet}
      </Screen>
    );
  }

  // Five across on a phone; on a wider column, as many as stay tile-sized.
  const cols = chapterColumns(layout.contentWidth, layout.kind);
  const rows = chapterRows(chapters, cols);

  return (
    <Screen header={header}>
      <ActiveFilter filter={filter} counts={counts} onOpen={() => setFilterOpen(true)} onClear={() => setFilter('all')} />
      <View style={{ gap: space.sm }}>
        {rows.map((row, r) => (
          <View key={r} style={{ flexDirection: 'row', gap: space.sm }}>
            {row.map((c) => (
              <Tile key={c.n} testID={`row-${bookId}-${c.n}`} c={c} offline={offline} changed={c.list.some((e) => earlier.over.has(e.unitId))} current={beside?.screen === 'passage_record' && c.list.some((e) => e.unitId === beside.params['unitId'])} onPress={() => {
                if (c.list.length === 1) open(c.list[0]!);
                else if (c.list.length > 1) setOpenChapter(c.n);
              }} />
            ))}
            {Array.from({ length: cols - row.length }, (_, i) => <View key={`pad-${i}`} style={{ flex: 1 }} />)}
          </View>
        ))}
      </View>
      <ShortKey offline={chapters.some((c) => c.list.some((e) => offline.has(e.unitId)))} />
      {quiet}
      {filterSheet}
      <Sheet visible={!!sheet} title={sheet ? t('map.book.chapterTitle', { book: book.name, n: fmt(sheet.n) }) : ''} sub={sheet ? t('map.book.pickPart', { count: sheet.list.length }) : ''} onClose={() => setOpenChapter(null)}>
        {sheet ? (
          <Group>
            {sheet.list.map((e, i) => (
              <PassageRow key={e.unitId} ctx={ctx} state={state} kinds={kinds} e={e} mine={forYou.has(e.unitId)} last={i === sheet.list.length - 1} changed={earlier.over.has(e.unitId)}
                onPress={() => { setOpenChapter(null); open(e); }} />
            ))}
          </Group>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  filterBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  quietRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginLeft: -space.sm },
  filterChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  disc: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  discDot: { position: 'absolute', top: -2, right: -2, width: 14, height: 14, borderRadius: 7, backgroundColor: C.amber, borderWidth: 2, borderColor: C.white },
  iconCount: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  bigNumber: { fontSize: T.display, fontWeight: '700' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md, rowGap: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  code: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' }
});

export const contracts = contractsFor('status_home', 'map_home', 'book_map');
