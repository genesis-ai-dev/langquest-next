import { StyleSheet } from '../theme';
// Avatar U. My Work answers "what should I do next?" (J-HOME-1, J-WORK-2…10):
// For you, Recent (this device), Waiting on others, and the last few things
// you finished, struck through, so a returning person sees where they were.
// Everything is derived from the record (core record.ts); nothing here gates
// the work, and every passage is also reachable from the Map. Reference copy
// lives in accessibility labels; the only visible words are the header,
// passage references, language codes, due dates and counts.
import {
  decodeHlc, derivePassageRecord, highlightsFor, isObtLane, recentlyDone, recordHeadline, reviewKind, waitingOn,
  type DoneItem, type Highlight, type RecordAsk, type Task
} from '@langquest-next/core';
import type { LucideIcon } from 'lucide-react-native';
import {
  Building2, Check, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Clock, CloudAlert, CloudCheck, CloudUpload,
  Headphones, History, Inbox, ListChecks, LoaderCircle, Map as MapIcon, MessageSquare, Mic
} from 'lucide-react-native';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Ctx } from '../ctx';
import { edgeFor, type ScreenId } from '../flow';
import { indexesFor } from '../indexes';
import { onRecentChange, readRecent, recentKey, type RecentPassage } from '../recent';
import { edgeAllowed, manageHomeFor, mapScreenFor } from '../session';
import { colors, radius, space, tint } from '../theme';
import { ActionButton, text } from '../ui';
import { PersonAvatar, usePerson } from '../UserChip';
import { useQuery } from '../useQuery';
import { contractsFor } from '../screenContracts';

const FOR_YOU_CAP = 5;
const WAITING_CAP = 3;

/** One "For you" item: a record highlight, or a legacy OBT stage task. */
type ForYou = { kind: Highlight['kind']; h: Highlight } | { kind: 'obt'; task: Task };

/** Icon and hue per kind (analysis §4.2); read at render so the palette follows light/dark. */
function look(kind: ForYou['kind']): { icon: LucideIcon; color: string; tint: string; cta: string } {
  switch (kind) {
    case 'respond': return { icon: MessageSquare, color: colors.review, tint: tint.review, cta: 'Respond' };
    case 'record': return { icon: Mic, color: colors.translate, tint: tint.translate, cta: 'Record' };
    case 'draft': return { icon: Mic, color: colors.translate, tint: tint.translate, cta: 'Continue' };
    case 'review': return { icon: ListChecks, color: colors.review, tint: tint.review, cta: 'Review' };
    case 'obt': return { icon: Headphones, color: colors.translate, tint: tint.translate, cta: 'Start' };
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10-01" → "Oct 1"; legacy free-text dates ("Sep 30") pass through. */
function shortDue(due: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(due);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : due;
}
function shortClock(hlc: string): string {
  const d = new Date(decodeHlc(hlc).wallMs);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function MyWork(ctx: Ctx) {
  const { state } = ctx.project;
  const actorId = ctx.session.actorId;
  const person = usePerson();
  const [allForYou, setAllForYou] = useState(false);
  const [allWaiting, setAllWaiting] = useState(false);

  // Derived once per state change; each walks only this person's asks and takes.
  const derived = useMemo(() => {
    if (!state) return null;
    const idx = indexesFor(state);
    return { highlights: highlightsFor(state, actorId, idx), waiting: waitingOn(state, actorId, idx), done: recentlyDone(state, actorId, 3) };
  }, [state, actorId]);

  // Legacy OBT lanes keep their stage tasks (highlightsFor leaves them out).
  const obtLanes = state ? Object.keys(state.lanes).filter((l) => isObtLane(state, l)) : [];
  const obtTasks = useQuery(ctx.project, async (q) => {
    const pages = await Promise.all(obtLanes.map((laneId) => q.listTasks(actorId, { status: ['todo', 'doing'], laneId }, null, 50)));
    return pages.flatMap((p) => p.tasks).filter((t) => t.obtStage);
  }, [actorId, obtLanes.join(',')], [] as Task[]).data;

  // Recent is device-local (J-WORK-8); App.tsx writes it when a passage opens.
  const key = recentKey(ctx.project.orgId, ctx.project.projectId, actorId);
  const [recent, setRecent] = useState<RecentPassage[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => void readRecent(key).then((r) => { if (live) setRecent(r); });
    load();
    const off = onRecentChange((k) => { if (k === key) load(); });
    return () => { live = false; off(); };
  }, [key]);

  if (!state || !derived) return <Text style={[text.muted, styles.pad]}>Opening local log…</Text>;

  const forYou: ForYou[] = [...derived.highlights.map((h) => ({ kind: h.kind, h }) as ForYou), ...obtTasks.map((task) => ({ kind: 'obt', task }) as ForYou)];
  const pk = (unitId: string, laneId: string) => `${unitId}:${laneId}`;
  const listed = new Set([...forYou.map((f) => (f.kind === 'obt' ? pk(f.task.unitId, f.task.laneId) : pk(f.h.unitId, f.h.laneId))),
    ...derived.waiting.map((w) => pk(w.unitId, w.laneId)), ...derived.done.map((d) => pk(d.unitId, d.laneId))]);
  const recentShown = recent.filter((r) => state.units[r.unitId] && state.lanes[r.laneId] && !listed.has(pk(r.unitId, r.laneId)));

  const multiLane = Object.keys(state.lanes).length > 1;
  const labelOf = (unitId: string) => state.units[unitId]?.label ?? unitId;
  const langOf = (laneId: string) => (multiLane ? state.lanes[laneId]?.languoidId ?? laneId : undefined);
  const nameOf = (id: string) => (id === actorId ? 'you' : person(id).name);
  const can = (to: ScreenId) => { const e = edgeFor('my_work', to); return !!e && edgeAllowed(e, ctx.session); };
  const openRecord = (unitId: string, laneId: string) => ctx.go('passage_record', { unitId, laneId });

  /** The primary action of a For you item; falls back to the record when the gate is closed. */
  const act = (f: ForYou) => {
    if (f.kind === 'obt') return ctx.go('obt_passage', { unitId: f.task.unitId, laneId: f.task.laneId, taskId: f.task.id });
    const { h } = f;
    const params = { unitId: h.unitId, laneId: h.laneId };
    if ((h.kind === 'record' || h.kind === 'draft') && can('workspace')) return ctx.go('workspace', params);
    const produces = h.kind === 'review' && !!h.kindId && !!state && !!reviewKind(state, h.kindId).produces;
    if (h.kind === 'review' && produces && can('back_translation')) {
      return ctx.go('back_translation', { ...params, ...(h.stepId ? { stepId: h.stepId } : {}), kindId: h.kindId! });
    }
    if (h.kind === 'review' && !produces && can('review_capture')) {
      return ctx.go('review_capture', { ...params, ...(h.takeId ? { takeId: h.takeId } : {}), ...(h.stepId ? { stepId: h.stepId } : {}), ...(h.kindId ? { kindId: h.kindId } : {}) });
    }
    return openRecord(h.unitId, h.laneId);
  };
  const describe = (f: ForYou): string => {
    if (f.kind === 'obt') return `${labelOf(f.task.unitId)} · ${f.task.obtStage ?? ''}`;
    const { h } = f;
    const label = labelOf(h.unitId);
    const asked = h.askedBy ? `${nameOf(h.askedBy)} asked${h.dueDate ? ` · due ${shortDue(h.dueDate)}` : ''}` : '';
    if (h.kind === 'respond') return `Feedback on ${label} · from ${h.reviewerId ? nameOf(h.reviewerId) : 'a reviewer'}`;
    if (h.kind === 'record') return `Record ${label} · ${asked}`;
    if (h.kind === 'review') return `Review ${label} · ${asked}`;
    return `Continue ${label} · recorded, not saved yet`;
  };

  const top = forYou[0];
  const shownForYou = allForYou ? forYou : forYou.slice(0, FOR_YOU_CAP);
  const shownWaiting = allWaiting ? derived.waiting : derived.waiting.slice(0, WAITING_CAP);
  const manage = manageHomeFor(ctx.session);
  const orgName = ctx.org.state?.org?.value.name ?? '';
  const pending = ctx.project.pending;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={text.h3}>My Work</Text>
          <Text style={text.muted} numberOfLines={1}>{[person(actorId).name, orgName].filter(Boolean).join(' · ')}</Text>
        </View>
        <Pressable onPress={() => ctx.go('sync_status')} hitSlop={8} accessibilityRole="button" style={styles.statusChip}
          accessibilityLabel={ctx.project.saving ? 'Saving' : ctx.project.tooOld ? 'Update the app to sync' : `Saved locally. Sync: ${ctx.project.lastSync}`}>
          {ctx.project.saving ? (
            // A write is queued or in flight: what is shown is in memory, not yet on disk.
            <LoaderCircle size={16} color={colors.mutedForeground} />
          ) : ctx.project.tooOld ? (
            // The server no longer accepts this app version; work is safe locally.
            <><CloudAlert size={16} color={colors.foreground} /><Text style={text.small}>{pending}</Text></>
          ) : pending > 0 ? (
            <><CloudUpload size={16} color={colors.mutedForeground} /><Text style={text.small}>{pending}</Text></>
          ) : (
            <CloudCheck size={16} color={colors.done} />
          )}
          {ctx.project.live ? <View style={styles.liveDot} /> : null}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SectionMark icon={Inbox} count={forYou.length} label="For you" />
        {forYou.length === 0 ? (
          <View style={styles.empty} accessible accessibilityLabel={`Nothing is waiting on you. ${manage
            ? 'Set up people, projects and review flows under Manage, or find any passage on the Map.'
            : 'Find any passage on the Map to keep going.'}`}>
            <View style={[styles.tile, { backgroundColor: tint.done }]}><CheckCircle2 size={28} color={colors.done} /></View>
            <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm }}>
              {manage ? <IconLink icon={Building2} label="Manage" onPress={() => ctx.go(manage)} /> : null}
              <IconLink icon={MapIcon} label="Map" onPress={() => ctx.go(mapScreenFor(ctx.session))} />
            </View>
          </View>
        ) : (
          <View style={styles.cards}>
            {shownForYou.map((f) => {
              const unitId = f.kind === 'obt' ? f.task.unitId : f.h.unitId;
              const laneId = f.kind === 'obt' ? f.task.laneId : f.h.laneId;
              const k = look(f.kind);
              const due = f.kind !== 'obt' && f.h.dueDate ? shortDue(f.h.dueDate) : undefined;
              return (
                <Card key={f.kind === 'obt' ? f.task.id : `${f.kind}:${unitId}:${laneId}:${f.h.stepId ?? ''}:${f.h.reviewerId ?? ''}`}
                  icon={k.icon} color={k.color} background={k.tint} dashed={f.kind === 'draft'}
                  title={labelOf(unitId)} sub={[langOf(laneId), due].filter(Boolean).join(' · ')}
                  accessibilityLabel={describe(f)}
                  onPress={() => (f.kind === 'obt' ? act(f) : openRecord(unitId, laneId))}
                  trailing={f.kind === 'obt' ? undefined : (
                    <Pressable onPress={() => act(f)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${k.cta} ${labelOf(unitId)}`}
                      style={[styles.cta, { backgroundColor: k.tint, borderColor: k.color }]}>
                      <k.icon size={20} color={k.color} />
                    </Pressable>
                  )} />
              );
            })}
            {forYou.length > FOR_YOU_CAP ? <ShowAll all={allForYou} total={forYou.length} onToggle={() => setAllForYou((a) => !a)} /> : null}
          </View>
        )}

        {recentShown.length > 0 ? (
          <>
            <SectionMark icon={History} label="Recent" />
            <View style={styles.group}>
              {recentShown.map((r, i) => {
                const rec = derivePassageRecord(state, r.unitId, r.laneId, actorId, indexesFor(state));
                return (
                  <ListRow key={pk(r.unitId, r.laneId)} last={i === recentShown.length - 1}
                    icon={<History size={20} color={colors.mutedForeground} />}
                    title={labelOf(r.unitId)} sub={langOf(r.laneId)}
                    accessibilityLabel={`${labelOf(r.unitId)} · ${recordHeadline(rec, nameOf)}`}
                    trailing={rec.feedbackIsMine ? <MessageSquare size={18} color={colors.review} /> : rec.done ? <Check size={18} color={colors.done} /> : undefined}
                    onPress={() => openRecord(r.unitId, r.laneId)} />
                );
              })}
            </View>
          </>
        ) : null}

        {derived.waiting.length > 0 ? (
          <>
            <SectionMark icon={Clock} count={derived.waiting.length} label="Waiting on others" />
            <View style={styles.group}>
              {shownWaiting.map((w, i) => <WaitingRow key={`${w.unitId}:${w.laneId}:${w.profileId}:${w.role}`} w={w} last={i === shownWaiting.length - 1}
                title={labelOf(w.unitId)} lang={langOf(w.laneId)} nameOf={nameOf} onPress={() => openRecord(w.unitId, w.laneId)} />)}
            </View>
            {derived.waiting.length > WAITING_CAP ? <ShowAll all={allWaiting} total={derived.waiting.length} onToggle={() => setAllWaiting((a) => !a)} /> : null}
          </>
        ) : null}

        {derived.done.length > 0 ? (
          <>
            <SectionMark icon={CheckCircle2} label="Done" />
            <View style={styles.group}>
              {derived.done.map((d, i) => <DoneRow key={`${d.unitId}:${d.laneId}`} d={d} last={i === derived.done.length - 1}
                title={labelOf(d.unitId)} lang={langOf(d.laneId)} onPress={() => openRecord(d.unitId, d.laneId)} />)}
            </View>
          </>
        ) : null}
      </ScrollView>

      {top ? (
        // The one yellow element: the top For you item's action.
        <View style={styles.footer}>
          <ActionButton icon={look(top.kind).icon} accessibilityLabel={describe(top)} onPress={() => act(top)} />
        </View>
      ) : null}
    </View>
  );
}

function SectionMark(props: { icon: LucideIcon; label: string; count?: number }) {
  const Icon = props.icon;
  return (
    <View style={styles.sectionMark} accessible accessibilityRole="header" accessibilityLabel={props.count ? `${props.label} · ${props.count}` : props.label}>
      <Icon size={18} color={colors.mutedForeground} />
      {props.count ? <Text style={[text.small, { fontWeight: '700' }]}>{props.count}</Text> : null}
    </View>
  );
}

function Card(props: {
  icon: LucideIcon; color: string; background: string; dashed?: boolean; title: string; sub?: string;
  accessibilityLabel: string; onPress: () => void; trailing?: ReactNode;
}) {
  const Icon = props.icon;
  return (
    <Pressable onPress={props.onPress} accessibilityRole="button" accessibilityLabel={props.accessibilityLabel}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
      <View style={[styles.tile, { backgroundColor: props.background, borderColor: props.color }, props.dashed && styles.dashed]}>
        <Icon size={24} color={props.color} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={text.h4} numberOfLines={1}>{props.title}</Text>
        {props.sub ? <Text style={text.small} numberOfLines={1}>{props.sub}</Text> : null}
      </View>
      {props.trailing ?? <ChevronRight size={20} color={colors.mutedForeground} />}
    </Pressable>
  );
}

function ListRow(props: { icon: ReactNode; title: string; sub?: string | undefined; accessibilityLabel: string; trailing?: ReactNode; strike?: boolean; last: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} accessibilityRole="button" accessibilityLabel={props.accessibilityLabel}
      style={({ pressed }) => [styles.row, !props.last && styles.rowBorder, pressed && { opacity: 0.8 }]}>
      <View style={styles.rowIcon}>{props.icon}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[text.body, props.strike && styles.strike]} numberOfLines={1}>{props.title}</Text>
        {props.sub ? <Text style={text.small} numberOfLines={1}>{props.sub}</Text> : null}
      </View>
      {props.trailing ?? <ChevronRight size={18} color={colors.mutedForeground} />}
    </Pressable>
  );
}

function WaitingRow(props: { w: RecordAsk; title: string; lang: string | undefined; nameOf: (id: string) => string; last: boolean; onPress: () => void }) {
  const person = usePerson();
  const { w } = props;
  const when = w.dueDate ? `due ${shortDue(w.dueDate)}` : `asked ${shortClock(w.at)}`;
  return (
    <ListRow last={props.last} onPress={props.onPress} title={props.title}
      sub={[props.lang, w.dueDate ? shortDue(w.dueDate) : undefined].filter(Boolean).join(' · ') || undefined}
      icon={<PersonAvatar look={person(w.profileId)} size={24} />}
      accessibilityLabel={`${props.title} · ${w.kind === 'record' ? 'Recording' : 'Review'} · ${props.nameOf(w.profileId)} · ${when}`}
      trailing={<Clock size={18} color={colors.mutedForeground} />} />
  );
}

function DoneRow(props: { d: DoneItem; title: string; lang: string | undefined; last: boolean; onPress: () => void }) {
  const { d } = props;
  const what = d.kind === 'version' ? 'You saved a version' : d.decision === 'approve' ? 'You approved it' : 'You asked for changes';
  const Icon = d.kind === 'version' ? Mic : ListChecks;
  return (
    <ListRow last={props.last} onPress={props.onPress} title={props.title} sub={props.lang} strike
      icon={<Icon size={20} color={colors.mutedForeground} />}
      accessibilityLabel={`Done: ${props.title} · ${what} · ${shortClock(d.at)}`}
      trailing={<Check size={18} color={colors.done} />} />
  );
}

function ShowAll(props: { all: boolean; total: number; onToggle: () => void }) {
  return (
    <Pressable onPress={props.onToggle} accessibilityRole="button" accessibilityLabel={props.all ? 'Show fewer' : `Show all ${props.total}`} style={styles.showAll}>
      {props.all ? <ChevronUp size={20} color={colors.translate} /> : <ChevronDown size={20} color={colors.translate} />}
      {props.all ? null : <Text style={[text.muted, { color: colors.translate, fontWeight: '600' }]}>{props.total}</Text>}
    </Pressable>
  );
}

function IconLink(props: { icon: LucideIcon; label: string; onPress: () => void }) {
  const Icon = props.icon;
  return (
    <Pressable onPress={props.onPress} accessibilityRole="button" accessibilityLabel={props.label} style={styles.iconLink}>
      <Icon size={22} color={colors.translate} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  pad: { padding: space.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md,
    backgroundColor: colors.card, borderBottomWidth: 1, borderColor: colors.border },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: space.xs, padding: space.sm },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.done },
  content: { padding: space.lg, gap: space.sm, paddingBottom: space.xl },
  sectionMark: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingTop: space.md, paddingHorizontal: space.xs },
  cards: { gap: space.sm },
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.card },
  tile: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  dashed: { borderStyle: 'dashed' },
  cta: { width: 44, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  empty: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border },
  iconLink: { width: 48, height: 48, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.card },
  group: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.md, minHeight: 60 },
  rowBorder: { borderBottomWidth: 1, borderColor: colors.border },
  rowIcon: { width: 36, height: 36, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted },
  strike: { color: colors.mutedForeground, textDecorationLine: 'line-through' },
  showAll: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, minHeight: 48, borderRadius: radius.lg,
    backgroundColor: tint.translate },
  footer: { padding: space.lg, backgroundColor: colors.card, borderTopWidth: 1, borderColor: colors.border }
});

export const contracts = contractsFor('my_work');
