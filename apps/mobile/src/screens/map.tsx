// The Map (ng-langquest-ux src/screens/map.tsx): StatusHomeScreen (the
// progress overview), MapHomeScreen (a language's passage map, with its
// OutlineMap) and BookMapScreen (a book's chapter grid). MAP-1..8; ADR-009,
// ADR-017, ADR-004.
//
// A whole Bible is about 1,200 passages. Nothing here renders them as one
// list: the map is books (grouped, with progress), then a chapter grid per
// book, plus search and filters that narrow to counts first (ADR-009).
// Progress is several counts, never one number (ADR-004).
import {
  deriveFlow, libraryItemView, deriveKinds, derivePassage, highlightsFor, languageInfo, languageName, languageProgress,
  passageSummary, percent, privilegesFor, timeAgo, unitPlace, unitTitle,
  type KindDef, type LanguageProgress, type OrgState, type PassageState, type LanguageState, type UnitPlace
} from '@langquest-next/core';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  bookMatches, canonBook, canonBooks, CANON_GROUPS, chapterTone, countFilters, isMapFilter, MAP_FILTERS, matchesFilter, parseQuery,
  placeMatches, type CanonBook, type ChapterTone, type MapFilter, type Testament
} from '../canon';
import type { Ctx } from '../ctx';
import { edgeFor, type ScreenId } from '../flow';
import { indexesFor } from '../indexes';
import { keptOfflineMap, OfflineMark, offlineWords, type KeptOffline } from '../offline';
import { languageFigures, oldestAsOf } from '../orgFigures';
import { useOrgSummary } from '../useOrgSummary';
import {
  Card, Chip, ChipRow, EmptyState, Group, Header, Ico, IconBtn, Row, Screen, SearchField, SectionLabel, Sheet, ShowMore,
  StepMarks, txt, useLayout, useOpenDetail
} from '../kit';
import { chapterColumns } from '../layout';
import { plural } from '../passageView';
import { contractsFor } from '../screenContracts';
import { edgeAllowed, mapScreenFor } from '../session';
import { C, onColor, radius, space, TINT, type as T, withAlpha } from '../theme';

const PAGE = 25;
const OTHER = 'other';

const fmt = (n: number) => n.toLocaleString('en-US');

function canGo(ctx: Ctx, from: ScreenId, to: ScreenId): boolean {
  const edge = edgeFor(from, to);
  return !!edge && edgeAllowed(edge, ctx.session);
}

// ---- one language's passages, read once per revision ---------------------------------

interface Entry {
  unitId: string;
  place: UnitPlace;
  s: PassageState;
}

const entryCache = new WeakMap<LanguageState, Entry[]>();

/** Every passage the open language works on, with where it sits and where it stands; shared by the map and its books. */
function languageEntries(state: LanguageState): Entry[] {
  const hit = entryCache.get(state);
  if (hit) return hit;
  const idx = indexesFor(state);
  const out = idx.passages.map((unitId) => ({ unitId, place: unitPlace(state, unitId), s: derivePassage(state, unitId, idx) }));
  entryCache.set(state, out);
  return out;
}

/** Passages with something for this person on My Work: marked on the map, not listed (ADR-017). */
function useForYou(ctx: Ctx, state: LanguageState | null): Set<string> {
  const canRecord = ctx.session.can('translate');
  const canReview = ctx.session.can('review');
  return useMemo(() => new Set(state
    ? highlightsFor(state, ctx.session.actorId, { canRecord, canReview }, indexesFor(state)).map((h) => h.unitId)
    : []), [state, ctx.session.actorId, canRecord, canReview]);
}

function flowLabel(state: LanguageState): string {
  const flow = deriveFlow(state);
  return flow.steps.length ? flow.name : 'No review flow';
}

function languageCode(org: OrgState | null, languageId: string): string {
  return (languageInfo(org, languageId)?.code || languageId).slice(0, 3).toUpperCase();
}

/**
 * The open language's state, or null while it is loading or another one is
 * opening: a `languageId` param opens that language's stream, and until it
 * has, the state on hand is the previous language's.
 */
function openState(ctx: Ctx, languageId: string | null): LanguageState | null {
  return languageId && languageId === ctx.language.languageId ? ctx.language.state : null;
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
      {feedback ? <Ico name="chat" size={18} color={TINT.amberText} /> : <Text style={[txt.xsStrong, { color: C.dark }]}>{cleared}/{s.steps.length}</Text>}
    </View>
  );
}

function PassageRow(props: { ctx: Ctx; state: LanguageState; kinds: KindDef[]; e: Entry; mine: boolean; last: boolean; onPress: () => void }) {
  const { e, ctx } = props;
  const me = ctx.session.actorId;
  const title = unitTitle(props.state, e.unitId);
  const summary = passageSummary(e.s, props.kinds, me, (id) => ctx.name(id, true));
  const beside = useOpenDetail();
  const offline = keptOfflineMap(ctx).get(e.unitId);
  return (
    <Row label={title} sub={summary} last={props.last} onPress={props.onPress}
      current={beside?.screen === 'passage_record' && beside.params['unitId'] === e.unitId}
      accessibilityLabel={`${title}. ${summary}${props.mine ? '. For you' : ''}. ${offlineWords(offline)}`}
      {...(props.mine ? { badge: 'For you', badgeTone: 'amber' as const } : {})}
      leading={(
        <View>
          <PassageDisc s={e.s} />
          {props.mine ? <View style={styles.discDot} /> : null}
          <OfflineMark u={offline} />
        </View>
      )}
      {...(e.s.recorded && e.s.steps.length > 0
        ? { right: <StepMarks steps={e.s.steps.map((st) => ({ kinds: st.kinds, checkpoint: st.step.checkpoint }))} size={14} /> }
        : {})} />
  );
}

/**
 * One "Filter" chip (MAP-3, ADR-029); the status chips open under it on
 * request (progressive disclosure), and picking one folds them away again.
 * With a filter set, the chip names it and an ✕ beside it clears it.
 */
function FilterChips(props: { filter: MapFilter; counts: Record<MapFilter, number>; onFilter: (f: MapFilter) => void }) {
  const [open, setOpen] = useState(false);
  const active = props.filter !== 'all' ? MAP_FILTERS.find((f) => f.id === props.filter) : undefined;
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.filterBar}>
        <Chip icon="filter" label={active ? active.label : 'Filter'} on={!!active} onPress={() => setOpen((o) => !o)}
          {...(active ? { count: props.counts[active.id] } : {})}
          accessibilityLabel={`${active ? `Filter: ${active.label}` : 'Filter'}. ${open ? 'Hides' : 'Shows'} the choices`} />
        {active && !open ? <IconBtn name="close" label="Clear filter" bg={C.card} onPress={() => props.onFilter('all')} /> : null}
      </View>
      {open ? (
        <View style={styles.filterChoices}>
          {MAP_FILTERS.filter((f) => f.id === 'all' || f.id === props.filter || props.counts[f.id] > 0).map((f) => (
            <Chip key={f.id} label={f.label} on={props.filter === f.id} onPress={() => { props.onFilter(f.id); setOpen(false); }}
              {...(f.id === 'all' ? {} : { count: props.counts[f.id] })} {...(f.id === 'feedback' ? { icon: 'chat' as const } : {})} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ---- progress overview (MAP-8) ------------------------------------------------------------

/** `n` steps of the brand hue, pale to full: later stages read darker (sequential ramp). */
function stageRamp(n: number): string[] {
  const from = [0xc2, 0xb2, 0xf3], to = [0x4b, 0x2c, 0x9e];
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 1 : i / (n - 1);
    return '#' + from.map((a, k) => Math.round(a + (to[k]! - a) * t).toString(16).padStart(2, '0')).join('');
  });
}

/**
 * Every stage of the language's flow on one track (MAP-8): each stage's bar
 * starts at zero and they overlap, the longest behind, so a passage further
 * along sits in a darker band. Stages are nested in practice, so the bands
 * read as how many passages stand at each stage. The legend under it gives
 * the exact counts, so identity is never colour alone.
 */
function FunnelRows(props: { progress: LanguageProgress }) {
  const p = props.progress;
  const ramp = stageRamp(1 + p.steps.length);
  const rows = [
    { label: 'Recorded', n: p.recorded, color: ramp[0]!, checkpoint: false },
    ...p.steps.map((st, i) => ({ label: st.name, n: st.cleared, color: ramp[i + 1]!, checkpoint: st.checkpoint })),
    ...(p.steps.length ? [{ label: 'Done', n: p.done, color: C.green, checkpoint: false }] : [])
  ];
  // Longest first, so a shorter bar is never hidden behind a longer one.
  const layers = rows.map((r, i) => ({ ...r, i })).filter((r) => r.n > 0).sort((a, b) => b.n - a.n || a.i - b.i);
  const h = 14;
  return (
    <View style={{ gap: space.sm }}>
      <View accessible accessibilityRole="progressbar"
        accessibilityLabel={rows.map((r) => `${r.label}: ${fmt(r.n)} of ${fmt(p.total)}`).join(', ')}
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
  // Every language the organization has; each is its own stream (decision
  // 63). This phone folds the one it has open; the dashboard's server
  // answers for the rest (decision 44), as of when it last caught up.
  const summary = useOrgSummary(ctx.session.actorId, ctx.language.orgId);
  const languages = useMemo(() => {
    const openId = state ? ctx.language.languageId : null;
    const ids = ctx.languages.map((l) => l.languageId);
    const local = new Map(state && openId ? [[openId, languageProgress(state, indexesFor(state))]] : []);
    const figures = languageFigures(ids, local, summary);
    return ctx.languages.map(({ languageId, name }) => {
      const here = languageId === openId;
      const f = figures.get(languageId);
      return {
        languageId, here, name, code: languageCode(ctx.org.state, languageId),
        flow: here ? flowLabel(state!) : '', progress: f?.progress ?? null, asOf: f?.asOf ?? null
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [state, ctx.languages, ctx.language.languageId, ctx.org.state, summary]);
  const orgName = ctx.org.state?.org?.value.name ?? '';
  const header = <Header title="Progress" sub={[orgName, 'All languages'].filter(Boolean).join(' · ')} />;
  if (!state) return <Screen header={header}><EmptyState icon="progress" title="Loading…" /></Screen>;

  const known = languages.flatMap((l) => (l.progress ? [l.progress] : []));
  const asOf = oldestAsOf(languages.flatMap((l) => (l.progress ? [{ progress: l.progress, asOf: l.asOf }] : [])));
  const total = known.reduce((n, p) => n + p.total, 0);
  const recorded = known.reduce((n, p) => n + p.recorded, 0);
  const done = known.reduce((n, p) => n + p.done, 0);
  const waiting = known.reduce((n, p) => n + p.waiting, 0);
  const q = query.trim().toLowerCase();
  const shown = q ? languages.filter((l) => `${l.name} ${l.code}`.toLowerCase().includes(q)) : languages;
  // The param opens that language's stream.
  const open = (languageId: string) => ctx.go('map_home', { languageId });
  const isOpen = (languageId: string) => beside?.screen === 'map_home' && beside.params['languageId'] === languageId;

  return (
    <Screen header={header}>
      {languages.length === 0 ? (
        <EmptyState icon="globe" title="No languages yet" sub="Once a language is added, its progress shows here." />
      ) : (
        <Card>
          <Text style={[txt.sm, { color: C.muted, fontWeight: '600' }]}>
            {known.length === languages.length ? `Across ${plural(languages.length, 'language')}` : `${known.length} of ${plural(languages.length, 'language')} counted`} · {plural(total, 'passage')}
          </Text>
          {asOf ? <Text style={txt.smMuted}>Languages not on this phone as of {timeAgo(asOf, Date.now())}</Text> : null}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.xl }}>
            <View>
              <Text style={[styles.bigNumber, { color: C.primary }]}>{percent(recorded, total)}%</Text>
              <Text style={txt.smMuted}>recorded</Text>
            </View>
            <View>
              <Text style={[styles.bigNumber, { color: TINT.greenText }]}>{percent(done, total)}%</Text>
              <Text style={txt.smMuted}>done</Text>
            </View>
            <View style={{ marginLeft: 'auto', alignItems: 'flex-end' }}>
              <Text style={[txt.h2]}>{fmt(waiting)}</Text>
              <Text style={txt.smMuted}>with reviewers</Text>
            </View>
          </View>
          <StackBar done={done} recorded={recorded} total={total} height={10} recordedColor={C.soft} />
        </Card>
      )}
      {languages.length > 5 ? <SearchField value={query} onChangeText={(t) => { setQuery(t); setLimit(PAGE); }} placeholder="Find a language" /> : null}
      {shown.length > 0 ? <SectionLabel label="Languages" /> : null}
      {shown.slice(0, limit).map((l) => l.progress && l.here ? (
        <Card key={l.languageId} current={isOpen(l.languageId)} onPress={() => open(l.languageId)} accessibilityLabel={`${l.name}: ${fmt(l.progress.recorded)} of ${fmt(l.progress.total)} recorded. Open its map.`}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={styles.code}><Text style={[txt.sm, { fontWeight: '700', color: C.primary }]}>{l.code}</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[txt.body, { fontWeight: '600' }]} numberOfLines={1}>{l.name}</Text>
              <Text style={txt.smMuted} numberOfLines={1}>{plural(l.progress.total, 'passage')} · {l.flow}</Text>
            </View>
            {l.progress.waiting > 0 ? <IconCount icon="clock" n={l.progress.waiting} tone="brand" /> : null}
            <Ico name="right" size={24} color={C.muted} />
          </View>
          <FunnelRows progress={l.progress} />
        </Card>
      ) : (
        // Not open on this phone: opening it brings it down (decision 63).
        // The server's figures, when it has them, show what it holds meanwhile.
        <Card key={l.languageId} current={isOpen(l.languageId)} onPress={() => open(l.languageId)}
          accessibilityLabel={l.progress ? `${l.name}: ${fmt(l.progress.recorded)} of ${fmt(l.progress.total)} recorded, as of ${timeAgo(l.asOf!, Date.now())}. Not on this phone yet. Open it.` : `${l.name}. Not on this phone yet. Open it.`}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={styles.code}><Ico name="download" size={20} color={C.primary} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[txt.body, { fontWeight: '600' }]} numberOfLines={1}>{l.name}</Text>
              <Text style={txt.smMuted} numberOfLines={1}>
                {l.progress ? `${plural(l.progress.total, 'passage')} · as of ${timeAgo(l.asOf!, Date.now())}` : 'Open it to bring it onto this phone'}
              </Text>
            </View>
            {l.progress && l.progress.waiting > 0 ? <IconCount icon="clock" n={l.progress.waiting} tone="brand" /> : null}
            <Ico name="right" size={24} color={C.muted} />
          </View>
          {l.progress ? <FunnelRows progress={l.progress} /> : null}
        </Card>
      ))}
      <ShowMore remaining={shown.length - limit} step={PAGE} onMore={() => setLimit((n) => n + PAGE)} />
      {q && shown.length === 0 ? <Text style={[txt.bodyMuted, { textAlign: 'center', paddingVertical: space.xl }]}>No language matches “{query}”.</Text> : null}
      {languages.length > 0 ? (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>
          Each bar layers the steps of the language's review flow: the further a passage has come, the darker its band. A passage is done when every step is complete — or, with no flow, once it's recorded. Locked steps are checkpoints.
        </Text>
      ) : null}
    </Screen>
  );
}

// ---- a language's map (MAP-1..4, MAP-6, MAP-7) ------------------------------------------

interface BookSummary {
  key: string;
  book: CanonBook | null;
  name: string;
  group: string;
  total: number;
  recorded: number;
  done: number;
  feedback: number;
  matching: number;
  mine: number;
}

function summarizeBooks(entries: Entry[], filter: MapFilter, forYou: Set<string>): BookSummary[] {
  const by = new Map<string, BookSummary>();
  for (const e of entries) {
    const book = canonBook(e.place.bookId) ?? null;
    const key = book?.id ?? OTHER;
    let row = by.get(key);
    if (!row) {
      row = { key, book, name: book?.name ?? 'Other', group: book?.group ?? 'Other', total: 0, recorded: 0, done: 0, feedback: 0, matching: 0, mine: 0 };
      by.set(key, row);
    }
    row.total++;
    if (e.s.recorded) row.recorded++;
    if (e.s.done) row.done++;
    if (e.s.awaitingResponse.length) row.feedback++;
    if (matchesFilter(e.s, filter)) row.matching++;
    if (forYou.has(e.unitId)) row.mine++;
  }
  return [...canonBooks().flatMap((b) => by.get(b.id) ?? []), ...(by.get(OTHER) ? [by.get(OTHER)!] : [])];
}

function BookRow(props: { b: BookSummary; filter: MapFilter; last: boolean; onPress: () => void }) {
  const { b, filter } = props;
  const started = b.recorded > 0;
  const noun = MAP_FILTERS.find((f) => f.id === filter)?.noun ?? '';
  const sub = filter !== 'all'
    ? `${fmt(b.matching)} ${noun} · ${fmt(b.recorded)} of ${fmt(b.total)} recorded`
    : started
      ? `${fmt(b.recorded)} of ${fmt(b.total)} recorded${b.done ? ` · ${fmt(b.done)} done` : ''}`
      : `Not started · ${b.book ? plural(b.book.chapters, 'chapter') : plural(b.total, 'passage')}`;
  const feedback = b.feedback > 0 && filter === 'all';
  const beside = useOpenDetail();
  return (
    <Row label={b.name} sub={sub} muted={!started} last={props.last} onPress={props.onPress}
      current={beside?.screen === 'book_map' && beside.params['bookId'] === b.key}
      accessibilityLabel={`${b.name}. ${sub}${b.mine ? `. ${b.mine} for you` : ''}${b.feedback ? `. ${b.feedback} with feedback` : ''}`}
      {...(b.mine > 0 ? { badge: `${b.mine} for you`, badgeTone: 'amber' as const } : {})}
      {...(started ? { below: <StackBar done={b.done} recorded={b.recorded} total={b.total} /> } : {})}
      {...(feedback ? {
        right: (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <IconCount icon="chat" n={b.feedback} tone="amber" />
            <Ico name="right" size={22} color={C.muted} />
          </View>
        )
      } : {})} />
  );
}

/** An outline language (lessons, stories): its folders and their items instead of books and chapters (MAP-6). */
function OutlineMap(props: { ctx: Ctx; state: LanguageState; kinds: KindDef[]; languageId: string; entries: Entry[]; forYou: Set<string> }) {
  const [limits, setLimits] = useState<Record<string, number>>({});
  const sections = useMemo(() => {
    const by = new Map<string, Entry[]>();
    for (const e of props.entries) {
      const list = by.get(e.place.bookLabel);
      if (list) list.push(e);
      else by.set(e.place.bookLabel, [e]);
    }
    return [...by.entries()];
  }, [props.entries]);
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

/** Languages this person may open: those a role of theirs covers, at org scope or the language's own. */
function openableLanguages(ctx: Ctx): { languageId: string; name: string }[] {
  const org = ctx.org.state;
  if (!org) return [];
  return ctx.languages.filter((l) => privilegesFor(org, ctx.session.actorId, l.languageId).size > 0);
}

export function MapHome(ctx: Ctx) {
  // The map is of the open language: a `languageId` param has opened it.
  const languageId = ctx.params['languageId'] ?? ctx.languageId;
  const state = openState(ctx, languageId);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [filter, setFilter] = useState<MapFilter>('all');
  const [testament, setTestament] = useState<Testament | null>(null);
  const forYou = useForYou(ctx, state);
  const entries = useMemo(() => (state ? languageEntries(state) : []), [state]);
  const books = useMemo(() => summarizeBooks(entries, filter, forYou), [entries, filter, forYou]);
  const counts = useMemo(() => countFilters(entries.map((e) => e.s)), [entries]);
  const progress = useMemo(() => (state ? languageProgress(state, indexesFor(state)) : null), [state]);
  const kinds = useMemo(() => (state ? deriveKinds(state) : []), [state]);

  const language = languageId ? languageName(ctx.org.state, languageId) : 'Passage Map';
  const outline = entries.length > 0 && entries.every((e) => !e.place.bookId);
  const sel = state?.template?.value;
  const templateName = sel ? libraryItemView(ctx.org.state?.library ?? {}, sel.itemId)?.name : undefined;
  const sub = state
    ? [outline ? 'Own outline' : templateName, flowLabel(state)].filter(Boolean).join(' · ')
    : undefined;
  // Workers land here from the Map tab; everyone else came from the overview or a language home.
  const backable = mapScreenFor(ctx.session) === 'status_home';
  const header = <Header title={language} {...(sub ? { sub } : {})} {...(backable ? { onBack: ctx.back } : {})} />;

  if (!languageId) {
    return <Screen header={header}><EmptyState icon="globe" title="No languages yet" sub="Once a language is added, its passages show here." /></Screen>;
  }
  if (!state || !progress) return <Screen header={header}><EmptyState icon="map" title="Loading…" /></Screen>;

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

  if (entries.length === 0) {
    return (
      <Screen header={header}>
        {languageChips}
        <EmptyState icon="book" title="No passages yet" sub={`Once ${language} has passages to record, they show here by book and chapter.`} />
      </Screen>
    );
  }

  if (outline) {
    return (
      <Screen header={header}>
        {languageChips}
        <OutlineMap ctx={ctx} state={state} kinds={kinds} languageId={languageId} entries={entries} forYou={forYou} />
      </Screen>
    );
  }

  const search = parseQuery(query);
  const searching = query.trim().length > 0;
  const bookHits = searching && search.chapter === undefined ? books.filter((b) => b.book && bookMatches(b.book, search.book)) : [];
  const passageHits = searching && search.chapter !== undefined ? entries.filter((e) => placeMatches(e.place, query)) : [];

  const testaments = (['ot', 'nt'] as const).filter((t) => books.some((b) => b.book?.testament === t));
  const shownTestament = testament && testaments.includes(testament) ? testament : testaments.includes('nt') ? 'nt' : testaments[0];
  const inFilter = (b: BookSummary) => filter === 'all' || b.matching > 0;
  const visible = books.filter((b) => b.book && b.book.testament === shownTestament && inFilter(b));
  const other = books.find((b) => !b.book && inFilter(b));
  const groups = CANON_GROUPS.filter((g) => visible.some((b) => b.group === g));

  return (
    <Screen header={header}>
      {languageChips}
      <SearchField value={query} onChangeText={(v) => { setQuery(v); setLimit(PAGE); }} placeholder="Find a book or chapter — “John 3”" />

      {searching ? (
        search.chapter === undefined ? (
          <>
            <Text style={[txt.sm, { color: C.muted, fontWeight: '600', paddingHorizontal: space.xs }]}>
              {bookHits.length ? `${plural(bookHits.length, 'book')} · add a chapter number to jump straight to it` : 'No book by that name in this language'}
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
              {passageHits.length ? plural(passageHits.length, 'passage') : 'No passage matches — try a book name, then a chapter'}
            </Text>
            {passageHits.length > 0 ? (
              <Group>
                {passageHits.slice(0, limit).map((e, i, shown) => (
                  <PassageRow key={e.unitId} ctx={ctx} state={state} kinds={kinds} e={e} mine={forYou.has(e.unitId)} last={i === shown.length - 1}
                    onPress={() => ctx.openPassage(e.unitId, languageId)} />
                ))}
              </Group>
            ) : null}
            <ShowMore remaining={passageHits.length - limit} step={PAGE} onMore={() => setLimit((l) => l + PAGE)} />
          </>
        )
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {[
              { label: 'Recorded', value: fmt(progress.recorded), of: `of ${fmt(progress.total)}`, color: C.primary },
              { label: 'Done', value: fmt(progress.done), of: '', color: TINT.greenText },
              { label: 'With reviewers', value: fmt(progress.waiting), of: '', color: TINT.amberText }
            ].map((t) => (
              <View key={t.label} style={styles.stat}>
                <Text style={[styles.statValue, { color: t.color }]} numberOfLines={1}>
                  {t.value}{t.of ? <Text style={[txt.xsStrong]}> {t.of}</Text> : null}
                </Text>
                <Text style={txt.smMuted} numberOfLines={1}>{t.label}</Text>
              </View>
            ))}
          </View>

          <SectionLabel label="Books" />
          <FilterChips filter={filter} counts={counts} onFilter={setFilter} />
          {testaments.length > 1 ? (
            <ChipRow>
              {testaments.map((t) => (
                <Chip key={t} label={t === 'ot' ? 'Old Testament' : 'New Testament'} on={shownTestament === t} onPress={() => setTestament(t)}
                  count={books.filter((b) => b.book?.testament === t && inFilter(b)).length} />
              ))}
            </ChipRow>
          ) : null}

          {visible.length === 0 && !other ? (
            <Text style={[txt.bodyMuted, { textAlign: 'center', paddingVertical: space.xl }]}>
              {filter === 'all' ? 'No books in this language yet.' : 'Nothing here matches this filter.'}
            </Text>
          ) : null}
          {groups.map((g) => {
            const list = visible.filter((b) => b.group === g);
            return (
              <View key={g} style={{ gap: space.sm }}>
                <Text style={[txt.sm, { fontWeight: '700', paddingHorizontal: space.xs, paddingTop: space.sm }]}>{g}</Text>
                <Group>
                  {list.map((b, i) => <BookRow key={b.key} b={b} filter={filter} last={i === list.length - 1} onPress={() => openBook(b.key)} />)}
                </Group>
              </View>
            );
          })}
          {other ? (
            <View style={{ gap: space.sm }}>
              <Text style={[txt.sm, { fontWeight: '700', paddingHorizontal: space.xs, paddingTop: space.sm }]}>Other</Text>
              <Group><BookRow b={other} filter={filter} last onPress={() => openBook(OTHER)} /></Group>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

// ---- one book: a grid of chapters (MAP-5) ---------------------------------------------------

const TONES: Record<ChapterTone, { bg: string; fg: string; border: string; dashed: boolean; label: string }> = {
  done: { bg: onColor.green, fg: C.white, border: onColor.green, dashed: false, label: 'Done' },
  feedback: { bg: TINT.amber, fg: TINT.amberText, border: C.amber, dashed: false, label: 'Feedback waiting' },
  review: { bg: C.light, fg: C.primary, border: C.light, dashed: false, label: 'Recorded, in review' },
  drafting: { bg: C.card, fg: C.primary, border: C.primary, dashed: true, label: 'Recording started' },
  todo: { bg: C.card, fg: C.muted, border: C.border, dashed: true, label: 'Not recorded' },
  none: { bg: TINT.gray, fg: C.faint, border: TINT.gray, dashed: false, label: 'No passage' }
};

interface ChapterTile {
  n: number;
  list: Entry[];
  tone: ChapterTone;
  steps: number;
  cleared: number;
  mine: boolean;
  matches: boolean;
}

function Tile(props: { c: ChapterTile; onPress: () => void; current?: boolean; offline: Map<string, KeptOffline> }) {
  const { c } = props;
  const t = TONES[c.tone];
  const parts = c.list.length;
  // Kept passages of this chapter (decisions.md 61): the mark is green only when every kept one is ready.
  const kept = c.list.map((e) => props.offline.get(e.unitId)).filter((u): u is KeptOffline => !!u);
  const keptLabel = kept.length === 0 ? '' : `, ${kept.length === parts ? (parts > 1 ? 'all parts' : 'kept') : `${kept.length} of ${parts} parts`} on this phone${kept.every((u) => u.ready) ? '' : ' (downloading)'}`;
  const label = `Chapter ${c.n}: ${t.label}${c.tone === 'review' && c.steps ? ` (${c.cleared} of ${c.steps} steps)` : ''}${parts > 1 ? `, ${parts} parts` : ''}${c.mine ? ', for you' : ''}${keptLabel}${c.matches ? '' : ', outside the filter'}`;
  // The tone's icon goes with its colour, even beside "N parts" (never colour alone).
  const toneIcon = c.tone === 'done' ? <Ico name="check" size={14} color={t.fg} strokeWidth={3} />
    : c.tone === 'drafting' ? <Ico name="mic" size={14} color={t.fg} /> : null;
  return (
    <Pressable onPress={props.onPress} disabled={parts === 0} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: parts === 0, selected: !!props.current }}
      style={({ pressed }) => [styles.tile, { backgroundColor: t.bg, borderColor: t.border, borderStyle: t.dashed ? 'dashed' : 'solid', opacity: c.matches ? 1 : 0.28 },
        props.current && { borderColor: C.primary, borderWidth: 3, borderStyle: 'solid' },
        pressed && { transform: [{ scale: 0.95 }] }]}>
      <Text style={[styles.tileNumber, { color: t.fg }]}>{c.n}</Text>
      {parts > 1 ? (
        <View style={styles.tileParts}>
          {toneIcon}
          <Text style={[txt.xsStrong, { color: t.fg }]}>{parts} parts</Text>
        </View>
      ) : toneIcon}
      {c.tone === 'feedback' ? <View style={styles.tileFoot}><Ico name="chat" size={14} color={t.fg} /></View> : null}
      {c.tone === 'review' && c.steps > 0 ? (
        <View style={styles.tileBar}>
          {Array.from({ length: c.steps }, (_, i) => (
            <View key={i} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: i < c.cleared ? C.primary : withAlpha(C.primary, 0.18) }} />
          ))}
        </View>
      ) : null}
      {c.mine ? <View style={styles.tileDot} /> : null}
      {kept.length ? <OfflineMark corner u={kept.every((u) => u.ready) ? kept[0] : kept.find((u) => !u.ready)} /> : null}
    </Pressable>
  );
}

function Legend(props: { none: boolean }) {
  const tones: ChapterTone[] = ['done', 'review', 'feedback', 'drafting', 'todo', ...(props.none ? ['none' as const] : [])];
  return (
    <View style={{ gap: space.sm, paddingHorizontal: space.xs }}>
      <Text style={txt.smMuted}>The bar on a chapter shows how many review steps it has cleared.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, rowGap: space.sm }}>
        {tones.map((k) => {
          const t = TONES[k];
          return (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={{ width: 16, height: 16, borderRadius: 5, backgroundColor: t.bg, borderWidth: 2, borderColor: t.border, borderStyle: t.dashed ? 'dashed' : 'solid' }} />
              <Text style={txt.smMuted}>{t.label}</Text>
            </View>
          );
        })}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: C.amber }} />
          <Text style={txt.smMuted}>For you</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Ico name="onPhone" size={16} color={onColor.green} />
          <Text style={txt.smMuted}>On this phone offline</Text>
        </View>
      </View>
    </View>
  );
}

export function BookMap(ctx: Ctx) {
  const languageId = ctx.params['languageId'] ?? ctx.languageId;
  const state = openState(ctx, languageId);
  const offline = keptOfflineMap(ctx);
  const bookId = ctx.params['bookId'] ?? '';
  const initial = ctx.params['filter'];
  const [filter, setFilter] = useState<MapFilter>(isMapFilter(initial) ? initial : 'all');
  const [openChapter, setOpenChapter] = useState<number | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const forYou = useForYou(ctx, state);
  const layout = useLayout();
  const beside = useOpenDetail();
  const book = canonBook(bookId);
  const entries = useMemo(() => {
    if (!state) return [];
    return languageEntries(state).filter((e) => (bookId === OTHER ? !canonBook(e.place.bookId) : e.place.bookId === bookId));
  }, [state, languageId, bookId]);
  const counts = useMemo(() => countFilters(entries.map((e) => e.s)), [entries]);
  const kinds = useMemo(() => (state ? deriveKinds(state) : []), [state]);
  const chapters = useMemo((): ChapterTile[] => {
    if (!book) return [];
    const byChapter = new Map<number, Entry[]>();
    for (const e of entries) for (const n of e.place.chapters) {
      const list = byChapter.get(n);
      if (list) list.push(e);
      else byChapter.set(n, [e]);
    }
    return Array.from({ length: book.chapters }, (_, i) => {
      const n = i + 1;
      const list = byChapter.get(n) ?? [];
      const ss = list.map((e) => e.s);
      const recorded = ss.filter((s) => s.recorded);
      const steps = recorded[0]?.steps.length ?? 0;
      const cleared = recorded.length === ss.length && ss.length ? Math.min(...recorded.map((s) => s.steps.filter((st) => st.complete).length)) : 0;
      return { n, list, tone: chapterTone(ss), steps, cleared, mine: list.some((e) => forYou.has(e.unitId)),
        matches: filter === 'all' || ss.some((s) => matchesFilter(s, filter)) };
    });
  }, [book, entries, forYou, filter]);

  const language = languageId ? languageName(ctx.org.state, languageId) : '';
  const title = book?.name ?? 'Other';
  const recordedCount = entries.filter((e) => e.s.recorded).length;
  const crumbs = [{ label: language || 'Passage Map', onPress: () => ctx.go('map_home', languageId ? { languageId } : undefined) }, { label: title }];
  const canEdit = !!book && canGo(ctx, 'book_map', 'book_structure');
  const header = (
    <Header title={title} crumbs={crumbs} onBack={ctx.back}
      sub={`${language ? `${language} · ` : ''}${fmt(recordedCount)} of ${fmt(entries.length)} recorded`}
      action={canEdit ? (
        // Quieter than the page's work (ADR-029): shaping a book is rare, so it reads as a muted link, still 48pt.
        <Pressable onPress={() => ctx.go('book_structure', { languageId: languageId ?? '', bookId })} accessibilityRole="button" accessibilityLabel="Edit passages"
          style={({ pressed }) => [styles.quietAction, pressed && { opacity: 0.6 }]}>
          <Ico name="cut" size={18} color={C.muted} />
          <Text style={[txt.sm, { color: C.muted, fontWeight: '500' }]}>Edit passages</Text>
        </Pressable>
      ) : undefined} />
  );
  if (!languageId || (!book && bookId !== OTHER)) {
    return <Screen header={header}><EmptyState icon="book" title="This book isn't in this language" sub="Go back to the map to pick another." /></Screen>;
  }
  if (!state) return <Screen header={header}><EmptyState icon="book" title="Loading…" /></Screen>;

  const open = (e: Entry) => ctx.openPassage(e.unitId, languageId);
  const sheet = openChapter ? chapters[openChapter - 1] : undefined;

  // Passages that sit in no book have no chapters to lay out: a list, 25 at a time.
  if (!book) {
    const shown = entries.filter((e) => filter === 'all' || matchesFilter(e.s, filter));
    return (
      <Screen header={header}>
        <FilterChips filter={filter} counts={counts} onFilter={(f) => { setFilter(f); setLimit(PAGE); }} />
        {shown.length === 0 ? <Text style={[txt.bodyMuted, { textAlign: 'center', paddingVertical: space.xl }]}>Nothing here matches this filter.</Text> : (
          <Group>
            {shown.slice(0, limit).map((e, i, list) => (
              <PassageRow key={e.unitId} ctx={ctx} state={state} kinds={kinds} e={e} mine={forYou.has(e.unitId)} last={i === list.length - 1} onPress={() => open(e)} />
            ))}
          </Group>
        )}
        <ShowMore remaining={shown.length - limit} step={PAGE} onMore={() => setLimit((l) => l + PAGE)} />
      </Screen>
    );
  }

  // Five across on a phone; on a wider column, as many as stay tile-sized.
  const cols = chapterColumns(layout.contentWidth, layout.kind);
  const rows: ChapterTile[][] = [];
  for (let i = 0; i < chapters.length; i += cols) rows.push(chapters.slice(i, i + cols));

  return (
    <Screen header={header}>
      <FilterChips filter={filter} counts={counts} onFilter={setFilter} />
      <View style={{ gap: space.sm }}>
        {rows.map((row, r) => (
          <View key={r} style={{ flexDirection: 'row', gap: space.sm }}>
            {row.map((c) => (
              <Tile key={c.n} c={c} offline={offline} current={beside?.screen === 'passage_record' && c.list.some((e) => e.unitId === beside.params['unitId'])} onPress={() => {
                if (c.list.length === 1) open(c.list[0]!);
                else if (c.list.length > 1) setOpenChapter(c.n);
              }} />
            ))}
            {Array.from({ length: cols - row.length }, (_, i) => <View key={`pad-${i}`} style={{ flex: 1 }} />)}
          </View>
        ))}
      </View>
      <Legend none={chapters.some((c) => c.tone === 'none')} />
      <Sheet visible={!!sheet} title={sheet ? `${book.name} ${sheet.n}` : ''} sub={sheet ? `${sheet.list.length} parts — pick one` : ''} onClose={() => setOpenChapter(null)}>
        {sheet ? (
          <Group>
            {sheet.list.map((e, i) => (
              <PassageRow key={e.unitId} ctx={ctx} state={state} kinds={kinds} e={e} mine={forYou.has(e.unitId)} last={i === sheet.list.length - 1}
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
  filterChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  quietAction: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.sm },
  disc: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  discDot: { position: 'absolute', top: -2, right: -2, width: 14, height: 14, borderRadius: 7, backgroundColor: C.amber, borderWidth: 2, borderColor: C.white },
  iconCount: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  bigNumber: { fontSize: T.display, fontWeight: '700' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md, rowGap: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  code: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  stat: { flex: 1, backgroundColor: C.card, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, paddingHorizontal: space.md, paddingVertical: space.md },
  statValue: { fontSize: T.xl, fontWeight: '700' },
  tile: { flex: 1, aspectRatio: 1, minHeight: 48, borderRadius: radius.lg, borderWidth: 2, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tileNumber: { fontSize: T.xl, fontWeight: '700' },
  tileParts: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  tileFoot: { position: 'absolute', bottom: 5 },
  tileBar: { position: 'absolute', bottom: 7, left: 8, right: 8, flexDirection: 'row', gap: 2 },
  tileDot: { position: 'absolute', top: 5, right: 5, width: 12, height: 12, borderRadius: 6, backgroundColor: C.amber, borderWidth: 2, borderColor: C.white }
});

export const contracts = contractsFor('status_home', 'map_home', 'book_map');
