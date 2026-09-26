import { StyleSheet } from '../theme';
// Avatar P, also used by translators to find work. The passage map
// (J-MAP-2…7): map_home is one language — counts, search, filter chips, a
// testament toggle and book rows; book_map is one book as a grid of chapter
// tiles, with a parts sheet for chapters recorded in several passages. Both
// read one derivation per state change (core `mapPassages`) so a whole Bible
// stays quick. Colours are ours with icons, and never yellow: "for you" is an
// Inbox mark, not a yellow dot (analysis §4.2).
import {
  bookMatches, canonBook, canonIndex, highlightsFor, locateLabel, mapPassages, matchesQuery, parseQuery,
  type CanonBook, type MapPassage, type ProjectState, type Testament
} from '@langquest-next/core';
import type { LucideIcon } from 'lucide-react-native';
import { BookOpen, Check, ChevronDown, ChevronRight, Clock, Inbox, MessageSquare, Mic } from 'lucide-react-native';
import { useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { collectionAudio, ShareAudioButton } from '../audioExport';
import type { Ctx } from '../ctx';
import { edgeFor } from '../flow';
import { indexesFor } from '../indexes';
import { Header, Note, Row, Screen } from '../pui';
import { edgeAllowed } from '../session';
import { colors, radius, space, tint } from '../theme';
import { BackButton, Card, text } from '../ui';
import { contractsFor } from '../screenContracts';
import { flowName } from './org';

// ─── Derivations, once per state ──────────────────────────────────────────────

/** A passage placed in the canon: its book key and chapters. */
interface Placed extends MapPassage {
  /** Canon book id ("luk"), or `unit:{parent}` for a book outside the canon. */
  bookKey: string;
  chapters: number[];
}

const placedCache = new WeakMap<ProjectState, Map<string, Placed[]>>();
/** Every passage of a lane, placed; cached per fold so map_home and book_map share one derivation. */
function placedPassages(state: ProjectState, laneId: string): Placed[] {
  let byLane = placedCache.get(state);
  if (!byLane) placedCache.set(state, (byLane = new Map()));
  let out = byLane.get(laneId);
  if (!out) {
    out = mapPassages(state, laneId, indexesFor(state)).map((p) => {
      const parent = state.units[p.unitId]?.parentUnitId ?? null;
      // A passage's own label places it; its book container is the fallback.
      const at = locateLabel(p.label) ?? (parent ? locateLabel(state.units[parent]?.label ?? '') : null);
      return { ...p, bookKey: at ? at.book.id : `unit:${parent ?? ''}`, chapters: at?.chapters ?? [] };
    });
    byLane.set(laneId, out);
  }
  return out;
}

const forYouCache = new WeakMap<ProjectState, Map<string, Set<string>>>();
/** Passages with something for this person on My Work: marked on the Map, not listed. */
function forYouUnits(state: ProjectState, actorId: string, laneId: string): Set<string> {
  let byKey = forYouCache.get(state);
  if (!byKey) forYouCache.set(state, (byKey = new Map()));
  const key = `${actorId}:${laneId}`;
  let out = byKey.get(key);
  if (!out) {
    out = new Set(highlightsFor(state, actorId, indexesFor(state)).filter((h) => h.laneId === laneId).map((h) => h.unitId));
    byKey.set(key, out);
  }
  return out;
}

// ─── Filters (J-MAP-4) ────────────────────────────────────────────────────────

type MapFilter = 'all' | 'feedback' | 'waiting' | 'review' | 'done' | 'todo';
const FILTERS: { id: MapFilter; label: string; noun: string }[] = [
  { id: 'all', label: 'All', noun: '' },
  { id: 'feedback', label: 'Feedback waiting', noun: 'with feedback' },
  { id: 'waiting', label: 'With reviewers', noun: 'with reviewers' },
  { id: 'review', label: 'In review', noun: 'in review' },
  { id: 'done', label: 'Done', noun: 'done' },
  { id: 'todo', label: 'Not recorded', noun: 'not recorded' }
];
const asFilter = (v: string | undefined): MapFilter => (FILTERS.some((f) => f.id === v) ? (v as MapFilter) : 'all');

function matchesFilter(p: MapPassage, f: MapFilter): boolean {
  switch (f) {
    case 'all': return true;
    case 'feedback': return p.feedback > 0;
    case 'waiting': return p.waiting;
    case 'done': return p.done;
    case 'todo': return !p.recorded;
    case 'review': return p.recorded && !p.done;
  }
}

function countFilters(ps: MapPassage[]): Record<MapFilter, number> {
  const c: Record<MapFilter, number> = { all: ps.length, feedback: 0, waiting: 0, review: 0, done: 0, todo: 0 };
  for (const p of ps) for (const f of FILTERS) if (f.id !== 'all' && matchesFilter(p, f.id)) c[f.id]++;
  return c;
}

function FilterChips(props: { filter: MapFilter; counts: Record<MapFilter, number>; onFilter: (f: MapFilter) => void }) {
  // Zero-count chips hide unless selected, so a chip always leads somewhere.
  return (
    <View style={styles.chips}>
      {FILTERS.filter((f) => f.id === 'all' || f.id === props.filter || props.counts[f.id] > 0).map((f) => {
        const on = props.filter === f.id;
        return (
          <Pressable key={f.id} onPress={() => props.onFilter(f.id)} accessibilityRole="button" accessibilityState={{ selected: on }}
            accessibilityLabel={f.id === 'all' ? f.label : `${f.label}: ${props.counts[f.id]}`}
            style={[styles.chip, on && { backgroundColor: colors.foreground, borderColor: colors.foreground }]}>
            {f.id === 'feedback' ? <MessageSquare size={14} color={on ? colors.background : colors.review} /> : null}
            <Text style={[text.muted, { fontWeight: '600', color: on ? colors.background : colors.foreground }]}>{f.label}</Text>
            {f.id !== 'all' ? <Text style={[text.small, { fontWeight: '700', color: on ? colors.background : colors.mutedForeground }]}>{props.counts[f.id]}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Books ────────────────────────────────────────────────────────────────────

interface BookSummary {
  key: string;
  name: string;
  book: CanonBook | null;
  total: number;
  recorded: number;
  done: number;
  feedback: number;
  matching: number;
  mine: number;
}

function summarizeBooks(state: ProjectState, ps: Placed[], filter: MapFilter, mine: Set<string>): BookSummary[] {
  const by = new Map<string, BookSummary>();
  for (const p of ps) {
    let row = by.get(p.bookKey);
    if (!row) {
      const book = canonBook(p.bookKey) ?? null;
      const name = book?.name ?? state.units[p.bookKey.slice(5)]?.label ?? 'Other';
      by.set(p.bookKey, (row = { key: p.bookKey, name, book, total: 0, recorded: 0, done: 0, feedback: 0, matching: 0, mine: 0 }));
    }
    row.total++;
    if (p.recorded) row.recorded++;
    if (p.done) row.done++;
    if (p.feedback) row.feedback++;
    if (matchesFilter(p, filter)) row.matching++;
    if (mine.has(p.unitId)) row.mine++;
  }
  return [...by.values()].sort((a, b) => canonIndex(a.book?.id ?? '') - canonIndex(b.book?.id ?? '') || a.name.localeCompare(b.name));
}

const pct = (n: number, total: number) => (total ? `${Math.round((100 * n) / total)}%` : '0%') as `${number}%`;

function BookRow(props: { b: BookSummary; filter: MapFilter; last: boolean; onPress: () => void }) {
  const { b } = props;
  const started = b.recorded > 0;
  const noun = FILTERS.find((f) => f.id === props.filter)!.noun;
  const sub = props.filter !== 'all'
    ? `${b.matching} ${noun} · ${b.recorded} of ${b.total} recorded`
    : started ? `${b.recorded} of ${b.total} recorded${b.done ? ` · ${b.done} done` : ''}`
      : `Not started · ${b.book ? `${b.book.chapters} chapter${b.book.chapters === 1 ? '' : 's'}` : `${b.total} passage${b.total === 1 ? '' : 's'}`}`;
  return (
    <Pressable onPress={props.onPress} accessibilityRole="button"
      accessibilityLabel={`${b.name}, ${sub}${b.mine ? `, ${b.mine} for you` : ''}${b.feedback ? `, ${b.feedback} with feedback` : ''}`}
      style={({ pressed }) => [styles.row, !props.last && styles.rowBorder, pressed && { opacity: 0.8 }]}>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.inline}>
          <Text style={[text.body, { fontWeight: '600', color: started ? colors.foreground : colors.mutedForeground }]} numberOfLines={1}>{b.name}</Text>
          {b.mine ? <ForYouMark n={b.mine} /> : null}
        </View>
        {started ? (
          <View style={styles.bar}>
            <View style={{ width: pct(b.done, b.total), backgroundColor: colors.done }} />
            <View style={{ width: pct(b.recorded - b.done, b.total), backgroundColor: colors.translate }} />
          </View>
        ) : null}
        <Text style={text.small} numberOfLines={1}>{sub}</Text>
      </View>
      {b.feedback && props.filter === 'all' ? (
        <View style={styles.pill}><MessageSquare size={14} color={colors.review} /><Text style={[text.small, { color: colors.review, fontWeight: '700' }]}>{b.feedback}</Text></View>
      ) : null}
      <ChevronRight size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

/** "For you": an Inbox mark in the translate hue. Yellow is reserved for the one next action. */
function ForYouMark(props: { n?: number }) {
  return (
    <View style={styles.pill} accessibilityLabel={props.n ? `${props.n} for you` : 'For you'}>
      <Inbox size={12} color={colors.translate} />
      {props.n ? <Text style={[text.small, { color: colors.translate, fontWeight: '700' }]}>{props.n}</Text> : null}
    </View>
  );
}

// ─── One passage ──────────────────────────────────────────────────────────────

function summary(p: MapPassage): string {
  if (p.done) return 'Done';
  if (p.feedback) return `Feedback waiting (${p.feedback})`;
  if (!p.recorded) return p.drafting ? 'Recording started' : 'Not recorded';
  if (p.waiting) return `With reviewers · ${p.cleared} of ${p.steps} steps`;
  return p.steps ? `In review · ${p.cleared} of ${p.steps} steps` : 'Recorded';
}

/** Where a passage stands as one glyph: done, feedback, in review (steps cleared), recording, not started. */
function PassageDisc(props: { p: MapPassage }) {
  const { p } = props;
  if (p.done) return <View style={[styles.disc, { backgroundColor: colors.done, borderColor: colors.done }]}><Check size={20} color={colors.white} /></View>;
  if (p.feedback) return <View style={[styles.disc, { backgroundColor: tint.review, borderColor: colors.review }]}><MessageSquare size={18} color={colors.review} /></View>;
  if (!p.recorded) {
    return <View style={[styles.disc, styles.dashed, { borderColor: p.drafting ? colors.translate : colors.border }]}>
      <Mic size={18} color={p.drafting ? colors.translate : colors.mutedForeground} />
    </View>;
  }
  return <View style={[styles.disc, { backgroundColor: tint.review, borderColor: colors.review }]}>
    <Text style={[text.small, { fontWeight: '700', color: colors.foreground }]}>{p.steps ? `${p.cleared}/${p.steps}` : '✓'}</Text>
  </View>;
}

function PassageRow(props: { p: MapPassage; mine: boolean; last: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} accessibilityRole="button"
      accessibilityLabel={`${props.p.label}, ${summary(props.p)}${props.mine ? ', for you' : ''}`}
      style={({ pressed }) => [styles.row, !props.last && styles.rowBorder, props.mine && styles.mineRow, pressed && { opacity: 0.8 }]}>
      <PassageDisc p={props.p} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.inline}>
          <Text style={[text.body, { fontWeight: '600' }]} numberOfLines={1}>{props.p.label}</Text>
          {props.mine ? <ForYouMark /> : null}
        </View>
        <Text style={[text.small, props.p.feedback ? { color: colors.review } : null]} numberOfLines={1}>{summary(props.p)}</Text>
      </View>
      <ChevronRight size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

function ShowMore(props: { remaining: number; step: number; onMore: () => void }) {
  if (props.remaining <= 0) return null;
  return (
    <Pressable onPress={props.onMore} accessibilityRole="button" style={styles.showMore}>
      <Text style={[text.muted, { color: colors.translate, fontWeight: '600' }]}>{`Show ${Math.min(props.step, props.remaining)} more`}</Text>
    </Pressable>
  );
}

function Sheet(props: { title: string; sub?: string; onClose: () => void; children: ReactNode }) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={props.onClose}>
      <Pressable style={styles.scrim} onPress={props.onClose} accessibilityLabel="Close" />
      <View style={styles.sheet}>
        <Text style={text.h4}>{props.title}</Text>
        {props.sub ? <Text style={text.muted}>{props.sub}</Text> : null}
        <View style={styles.group}>{props.children}</View>
      </View>
    </Modal>
  );
}

// ─── map_home ─────────────────────────────────────────────────────────────────

const RESULT_PAGE = 25;

export function MapHome(ctx: Ctx) {
  const { state } = ctx.project;
  const lanes = state ? Object.keys(state.lanes) : [];
  // The Map tab opens this with no lane: a worker's map is their first language.
  // Switching language swaps the lane in place; no navigation (J-MAP-5).
  const [picked, setLaneId] = useState<string | null>(null);
  const laneId = picked ?? ctx.params['laneId'] ?? lanes[0] ?? '';
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(RESULT_PAGE);
  const [filter, setFilter] = useState<MapFilter>(asFilter(ctx.params['filter']));
  const [picking, setPicking] = useState(false);
  const [testament, setTestament] = useState<Testament>('NT');
  const actorId = ctx.session.actorId;

  const passages = useMemo(() => (state && state.lanes[laneId] ? placedPassages(state, laneId) : []), [state, laneId]);
  const mine = useMemo(() => (state ? forYouUnits(state, actorId, laneId) : new Set<string>()), [state, actorId, laneId]);
  const books = useMemo(() => (state ? summarizeBooks(state, passages, filter, mine) : []), [state, passages, filter, mine]);
  const counts = useMemo(() => countFilters(passages), [passages]);
  const totals = useMemo(() => ({
    recorded: passages.filter((p) => p.recorded).length,
    done: passages.filter((p) => p.done).length,
    waiting: passages.filter((p) => p.waiting).length
  }), [passages]);

  if (!state) return <Text style={[text.muted, { padding: space.lg }]}>Opening local log…</Text>;
  const lane = state.lanes[laneId];

  const search = parseQuery(query);
  const searching = query.trim().length > 0;
  const bookHits = searching && search.chapter === undefined ? books.filter((b) => (b.book ? bookMatches(b.book, search.book) : b.name.toLowerCase().startsWith(search.book))) : [];
  const passageHits = searching && search.chapter !== undefined ? passages.filter((p) => matchesQuery(p.label, query)) : [];

  const testaments = [...new Set(books.flatMap((b) => (b.book ? [b.book.testament] : [])))];
  const shownTestament = testaments.includes(testament) ? testament : testaments[0];
  const visible = books.filter((b) => (filter === 'all' || b.matching > 0) && (!b.book || b.book.testament === shownTestament));
  const groups = [...new Set(visible.map((b) => b.book?.group ?? 'Other'))];

  const openBook = (b: BookSummary) => ctx.go('book_map', { laneId, book: b.key, filter });
  const openPassage = (unitId: string) => ctx.go('passage_record', { unitId, laneId });
  const bibleEdge = edgeFor('map_home', 'dynamic_bible');
  const bible = lane && state.laneTemplates[laneId]?.value.templateId === 'dynamic' && !state.obt.workspace && !!bibleEdge && edgeAllowed(bibleEdge, ctx.session);

  return (
    <Screen>
      <View style={styles.titleRow}>
        {ctx.params['laneId'] ? <BackButton onPress={ctx.back} /> : null}
        <Pressable disabled={lanes.length < 2} onPress={() => setPicking(true)} accessibilityRole="button" style={{ flex: 1 }}
          accessibilityLabel={lanes.length > 1 ? `${lane?.languoidId ?? laneId}, switch language` : lane?.languoidId ?? laneId}>
          <View style={styles.inline}>
            <Text style={text.h3}>{lane?.languoidId ?? laneId}</Text>
            {lanes.length > 1 ? <ChevronDown size={24} color={colors.mutedForeground} /> : null}
          </View>
          <Text style={text.muted} numberOfLines={1}>{`${state.project?.value.name ?? 'Project'} · ${flowName(state, laneId)}`}</Text>
        </Pressable>
      </View>
      {!lane ? <Note>No languages yet.</Note> : null}

      {bible ? <Row icon={BookOpen} label="Bible" sub="Choose the next passage to translate" onPress={() => ctx.go('dynamic_bible', { laneId })} last /> : null}

      <TextInput value={query} onChangeText={(q) => { setQuery(q); setLimit(RESULT_PAGE); }} placeholder="Find a book or chapter — “John 3”"
        accessibilityLabel="Find a book or chapter" placeholderTextColor={colors.mutedForeground} style={styles.search} autoCorrect={false} />

      {searching ? (
        search.chapter === undefined ? (
          <>
            <Text style={[text.muted, { fontWeight: '600' }]}>
              {bookHits.length ? `${bookHits.length} book${bookHits.length === 1 ? '' : 's'} · add a chapter number to jump straight to it` : 'No book by that name in this project'}
            </Text>
            {bookHits.length ? <View style={styles.group}>{bookHits.map((b, i) => <BookRow key={b.key} b={b} filter="all" last={i === bookHits.length - 1} onPress={() => openBook(b)} />)}</View> : null}
          </>
        ) : (
          <>
            <Text style={[text.muted, { fontWeight: '600' }]}>
              {passageHits.length ? `${passageHits.length} passage${passageHits.length === 1 ? '' : 's'}` : 'No passage matches — try a book name, then a chapter'}
            </Text>
            {passageHits.length ? (
              <View style={styles.group}>
                {passageHits.slice(0, limit).map((p, i, a) => <PassageRow key={p.unitId} p={p} mine={mine.has(p.unitId)} last={i === a.length - 1} onPress={() => openPassage(p.unitId)} />)}
              </View>
            ) : null}
            <ShowMore remaining={passageHits.length - limit} step={RESULT_PAGE} onMore={() => setLimit((l) => l + RESULT_PAGE)} />
          </>
        )
      ) : (
        <>
          <View style={styles.tiles}>
            <CountTile icon={Mic} color={colors.translate} value={`${totals.recorded}`} of={`of ${passages.length}`} label="Recorded" />
            <CountTile icon={Check} color={colors.done} value={`${totals.done}`} label="Done" />
            <CountTile icon={Clock} color={colors.review} value={`${totals.waiting}`} label="With reviewers" />
          </View>
          <Text style={styles.sectionLabel}>BOOKS</Text>
          <FilterChips filter={filter} counts={counts} onFilter={setFilter} />
          {testaments.length > 1 ? (
            <View style={styles.segment}>
              {(['OT', 'NT'] as const).map((t) => {
                const on = shownTestament === t;
                const n = books.filter((b) => b.book?.testament === t && (filter === 'all' || b.matching > 0)).length;
                return (
                  <Pressable key={t} onPress={() => setTestament(t)} accessibilityRole="button" accessibilityState={{ selected: on }}
                    accessibilityLabel={`${t === 'OT' ? 'Old Testament' : 'New Testament'}: ${n} books`} style={[styles.segmentItem, on && styles.segmentOn]}>
                    <Text style={[text.body, { fontWeight: '600', color: on ? colors.foreground : colors.mutedForeground }]}>{t === 'OT' ? 'Old Testament' : 'New Testament'}</Text>
                    <Text style={text.small}>{n}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {visible.length === 0 ? <Note>{filter === 'all' ? 'No books in this project yet.' : 'Nothing here matches this filter.'}</Note> : null}
          {groups.map((g) => {
            const rows = visible.filter((b) => (b.book?.group ?? 'Other') === g);
            return (
              <View key={g} style={{ gap: space.xs }}>
                <Text style={[text.muted, { fontWeight: '700', color: colors.foreground }]}>{g}</Text>
                <View style={styles.group}>
                  {rows.map((b, i) => <BookRow key={b.key} b={b} filter={filter} last={i === rows.length - 1} onPress={() => openBook(b)} />)}
                </View>
              </View>
            );
          })}
        </>
      )}

      {picking ? (
        <Sheet title="Switch language" onClose={() => setPicking(false)}>
          {lanes.map((id, i) => (
            <Pressable key={id} onPress={() => { setLaneId(id); setPicking(false); }} accessibilityRole="button"
              accessibilityState={{ selected: id === laneId }} style={[styles.row, i < lanes.length - 1 && styles.rowBorder]}>
              <View style={styles.codeTile}><Text style={[text.small, { color: colors.translate, fontWeight: '700' }]}>{state.lanes[id]!.languoidId.slice(0, 3)}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={[text.body, { fontWeight: '600' }]}>{state.lanes[id]!.languoidId}</Text>
                <Text style={text.small}>{flowName(state, id)}</Text>
              </View>
              {id === laneId ? <Check size={20} color={colors.translate} /> : null}
            </Pressable>
          ))}
        </Sheet>
      ) : null}
    </Screen>
  );
}

function CountTile(props: { icon: LucideIcon; color: string; value: string; of?: string; label: string }) {
  const Icon = props.icon;
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${props.value} ${props.of ?? ''} ${props.label}`}>
      <View style={styles.inline}>
        <Icon size={14} color={props.color} />
        <Text style={[text.h4, { color: props.color }]}>{props.value}</Text>
        {props.of ? <Text style={text.small}>{props.of}</Text> : null}
      </View>
      <Text style={text.small}>{props.label}</Text>
    </View>
  );
}

// ─── book_map ─────────────────────────────────────────────────────────────────

type Tone = 'done' | 'feedback' | 'review' | 'drafting' | 'todo';

function chapterTone(ps: MapPassage[]): Tone {
  if (ps.some((p) => p.feedback)) return 'feedback';
  if (ps.length && ps.every((p) => p.done)) return 'done';
  if (ps.some((p) => p.recorded)) return 'review';
  if (ps.some((p) => p.drafting)) return 'drafting';
  return 'todo';
}

function toneLook(tone: Tone): { bg: string; fg: string; border: string; icon: LucideIcon | null; dashed: boolean; label: string } {
  switch (tone) {
    case 'done': return { bg: tint.done, fg: colors.done, border: colors.done, icon: Check, dashed: false, label: 'Done' };
    case 'feedback': return { bg: tint.reviewChip, fg: colors.review, border: colors.review, icon: MessageSquare, dashed: false, label: 'Feedback waiting' };
    case 'review': return { bg: tint.review, fg: colors.review, border: tint.reviewBar, icon: null, dashed: false, label: 'Recorded, in review' };
    case 'drafting': return { bg: tint.translate, fg: colors.translate, border: colors.translate, icon: Mic, dashed: true, label: 'Recording started' };
    case 'todo': return { bg: colors.card, fg: colors.mutedForeground, border: colors.border, icon: null, dashed: true, label: 'Not recorded' };
  }
}

export function BookMap(ctx: Ctx) {
  const { state } = ctx.project;
  const laneId = ctx.params['laneId'] ?? '';
  const bookKey = ctx.params['book'] ?? '';
  const [filter, setFilter] = useState<MapFilter>(asFilter(ctx.params['filter']));
  const [openChapter, setOpenChapter] = useState<number | null>(null);
  const actorId = ctx.session.actorId;

  const passages = useMemo(() => (state && state.lanes[laneId] ? placedPassages(state, laneId).filter((p) => p.bookKey === bookKey) : []), [state, laneId, bookKey]);
  const mine = useMemo(() => (state ? forYouUnits(state, actorId, laneId) : new Set<string>()), [state, actorId, laneId]);
  const counts = useMemo(() => countFilters(passages), [passages]);
  const book = canonBook(bookKey) ?? null;
  const chapters = useMemo(() => (book ? Array.from({ length: book.chapters }, (_, i) => {
    const n = i + 1;
    const list = passages.filter((p) => p.chapters.includes(n));
    const recorded = list.filter((p) => p.recorded);
    const steps = recorded[0]?.steps ?? 0;
    const cleared = list.length && recorded.length === list.length ? Math.min(...recorded.map((p) => p.cleared)) : 0;
    return { n, list, steps, cleared, tone: chapterTone(list), mine: list.some((p) => mine.has(p.unitId)), matches: filter === 'all' || list.some((p) => matchesFilter(p, filter)) };
  }) : []), [book, passages, mine, filter]);
  // Whole-book passages, and every passage of a book outside the canon, are rows.
  const loose = passages.filter((p) => !book || p.chapters.length === 0);
  const containers = useMemo(() => [...new Set(passages.map((p) => state?.units[p.unitId]?.parentUnitId).filter((x): x is string => !!x))], [passages, state]);

  if (!state) return <Text style={[text.muted, { padding: space.lg }]}>Opening local log…</Text>;
  const name = book?.name ?? state.units[bookKey.slice(5)]?.label ?? 'Book';
  const recorded = passages.filter((p) => p.recorded).length;
  const openPassage = (unitId: string) => ctx.go('passage_record', { unitId, laneId });
  const sheet = openChapter ? chapters[openChapter - 1] : undefined;

  return (
    <Screen>
      <Header title={name} sub={`${state.lanes[laneId]?.languoidId ?? laneId} · ${recorded} of ${passages.length} recorded`} onBack={ctx.back} />
      <Card>
        <Text style={text.small}>Share approved passages in order</Text>
        <ShareAudioButton project={ctx.project} name={name} hashes={containers.flatMap((c) => collectionAudio(ctx.project, c, laneId))} />
      </Card>
      <FilterChips filter={filter} counts={counts} onFilter={setFilter} />
      {book ? (
        <View style={styles.grid}>
          {chapters.map((c) => {
            const t = toneLook(c.tone);
            const parts = c.list.length;
            const Icon = t.icon;
            return (
              <Pressable key={c.n} disabled={parts === 0}
                onPress={() => (parts === 1 ? openPassage(c.list[0]!.unitId) : setOpenChapter(c.n))}
                accessibilityRole="button"
                accessibilityLabel={`Chapter ${c.n}: ${parts === 0 ? 'no passage' : t.label}${c.tone === 'review' && c.steps ? ` (${c.cleared} of ${c.steps} steps)` : ''}${parts > 1 ? `, ${parts} parts` : ''}${c.mine ? ', for you' : ''}`}
                style={({ pressed }) => [styles.chapter, { backgroundColor: t.bg, borderColor: t.border, borderStyle: t.dashed ? 'dashed' : 'solid',
                  opacity: c.matches ? (pressed ? 0.8 : 1) : 0.28 }]}>
                <Text style={[text.h4, { color: t.fg }]}>{c.n}</Text>
                {parts > 1 ? <Text style={[text.small, { color: t.fg }]}>{`${parts} parts`}</Text> : Icon ? <Icon size={14} color={t.fg} /> : null}
                {c.tone === 'review' && c.steps > 0 ? (
                  <View style={styles.stepBar}>
                    {Array.from({ length: c.steps }, (_, i) => <View key={i} style={[styles.stepSeg, { backgroundColor: i < c.cleared ? colors.review : tint.reviewBar }]} />)}
                  </View>
                ) : null}
                {c.mine ? <View style={styles.corner}><Inbox size={12} color={colors.translate} /></View> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {loose.length ? (
        <View style={styles.group}>
          {loose.map((p, i) => <PassageRow key={p.unitId} p={p} mine={mine.has(p.unitId)} last={i === loose.length - 1} onPress={() => openPassage(p.unitId)} />)}
        </View>
      ) : null}
      {filter !== 'all' && counts[filter] === 0 ? <Note>Nothing here matches this filter.</Note> : null}
      {book ? (
        <View style={{ gap: space.sm }}>
          <Text style={text.small}>The bar on a chapter shows how many review steps it has cleared.</Text>
          <View style={styles.legend}>
            {(['done', 'review', 'feedback', 'drafting', 'todo'] as const).map((k) => {
              const t = toneLook(k);
              return (
                <View key={k} style={styles.inline}>
                  <View style={[styles.swatch, { backgroundColor: t.bg, borderColor: t.border, borderStyle: t.dashed ? 'dashed' : 'solid' }]} />
                  <Text style={text.small}>{t.label}</Text>
                </View>
              );
            })}
            <View style={styles.inline}><Inbox size={12} color={colors.translate} /><Text style={text.small}>For you</Text></View>
          </View>
        </View>
      ) : null}

      {sheet ? (
        <Sheet title={`${name} ${sheet.n}`} sub={`${sheet.list.length} parts — pick one`} onClose={() => setOpenChapter(null)}>
          {sheet.list.map((p, i) => (
            <PassageRow key={p.unitId} p={p} mine={mine.has(p.unitId)} last={i === sheet.list.length - 1}
              onPress={() => { setOpenChapter(null); openPassage(p.unitId); }} />
          ))}
        </Sheet>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  search: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, backgroundColor: colors.card, color: colors.foreground, fontSize: 16 },
  tiles: { flexDirection: 'row', gap: space.sm },
  tile: { flex: 1, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, gap: 2 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: colors.mutedForeground, letterSpacing: 0.6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.full,
    borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
  segment: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: radius.lg, backgroundColor: colors.muted },
  segmentItem: { flex: 1, minHeight: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: space.xs },
  segmentOn: { backgroundColor: colors.card },
  group: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, minHeight: 60 },
  rowBorder: { borderBottomWidth: 1, borderColor: colors.border },
  mineRow: { borderLeftWidth: 4, borderLeftColor: colors.translate },
  bar: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.muted },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.full, backgroundColor: tint.reviewChip },
  disc: { width: 40, height: 40, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  dashed: { borderStyle: 'dashed' },
  showMore: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, backgroundColor: tint.translate },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: { padding: space.lg, paddingBottom: space.xl, gap: space.md, backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '75%' },
  codeTile: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: tint.translateBadge },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chapter: { width: '18%', aspectRatio: 1, borderRadius: radius.md, borderWidth: 2, alignItems: 'center', justifyContent: 'center', gap: 2 },
  stepBar: { position: 'absolute', left: 6, right: 6, bottom: 6, flexDirection: 'row', gap: 2 },
  stepSeg: { flex: 1, height: 4, borderRadius: 2 },
  corner: { position: 'absolute', top: 4, right: 4 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  swatch: { width: 14, height: 14, borderRadius: 4, borderWidth: 2 }
});

export const contracts = contractsFor('map_home', 'book_map');
