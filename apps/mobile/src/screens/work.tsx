// My Work (ng-langquest-ux src/screens/work.tsx, MyWorkScreen with its
// GettingStartedCard and UpNext cards). ONB-5, ONB-7, WORK-1..4; ADR-017,
// ADR-009, ADR-022, ADR-023.
//
// The one place that answers "what should I do next?" (ADR-017). Everything
// on it is derived from the record: what someone asked of you, feedback on
// your versions, your unsaved drafts, what you asked of others. Nothing here
// gates the work; every passage is still reachable from the Map.
import {
  derivePassage, deriveFlow, deriveKinds, highlightsFor, laneName, passageSummary, unitTitle, upNext, waitingOn,
  type Highlight, type KindDef, type ProjectState, type Waiting
} from '@langquest-next/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Ctx } from '../ctx';
import { edgeFor, type ScreenId } from '../flow';
import { indexesFor } from '../indexes';
import {
  Card, GhostBtn, Group, Header, Ico, Row, Screen, SectionLabel, Segments, SmallBtn, StepMarks, txt, type IconName
} from '../kit';
import { dueText, feedbackSource, plural, when } from '../passageView';
import { contractsFor } from '../screenContracts';
import { edgeAllowed } from '../session';
import { C, radius, space, TINT } from '../theme';

const FOR_YOU_CAP = 5;
const WAITING_CAP = 3;
const RECENT_CAP = 5;

/** May My Work take this edge for this session? A screen never offers what it cannot do. */
function canGo(ctx: Ctx, to: ScreenId): boolean {
  const edge = edgeFor('my_work', to);
  return !!edge && edgeAllowed(edge, ctx.session);
}

function highlightStyle(kind: Highlight['kind']): { icon: IconName; bg: string; fg: string; cta: string } {
  switch (kind) {
    case 'respond': return { icon: 'chat', bg: TINT.amber, fg: TINT.amberText, cta: 'Respond' };
    case 'record': return { icon: 'mic', bg: C.light, fg: C.primary, cta: 'Record' };
    case 'draft': return { icon: 'mic', bg: C.light, fg: C.primary, cta: 'Continue' };
    case 'review': return { icon: 'check', bg: TINT.green, fg: TINT.greenText, cta: 'Review' };
    case 'produce': return { icon: 'swap', bg: C.light, fg: C.primary, cta: 'Start' };
  }
}

/** The demo's card wording for one highlight (domain/record.ts `highlightsFor`). */
function highlightText(state: ProjectState, kinds: KindDef[], h: Highlight, name: Ctx['name']): { title: string; sub: string } {
  const title = unitTitle(state, h.unitId);
  const kind = (id?: string) => kinds.find((k) => k.id === id);
  const asked = () => {
    const r = h.request;
    const who = r?.by ? `${name(r.by)} asked` : 'Asked of you';
    return `${who}${r?.dueDate ? ` · ${dueText(r.dueDate)}` : ''}`;
  };
  switch (h.kind) {
    case 'respond':
      return { title: `Feedback on ${title}`, sub: `${kind(h.review?.kindId)?.name ?? 'Review'} · from ${h.review ? feedbackSource(h.review, (id) => name(id, true)) : 'a reviewer'}` };
    case 'record':
      return { title: `Record ${title}`, sub: asked() };
    case 'review':
      return { title: `${kind(h.request?.kindId)?.name ?? 'Review'} · ${title}`, sub: asked() };
    case 'produce': {
      const action = kind(h.request?.kindId)?.produces?.action.replace(/ it$/, '') ?? 'Start';
      return { title: `${action} ${title}`, sub: asked() };
    }
    case 'draft':
      return { title: `Continue ${title}`, sub: 'Recording started, not saved yet' };
  }
}

/** "asked just now", "asked 2 h ago", "asked Sep 2". */
function askedWhen(hlc: string): string {
  const w = when(hlc);
  return w === 'Just now' ? 'just now' : w;
}

function waitingText(state: ProjectState, kinds: KindDef[], w: Waiting, name: Ctx['name']): { title: string; sub: string } {
  const r = w.request;
  const what = r.what === 'record' ? 'Recording' : kinds.find((k) => k.id === r.kindId)?.name ?? 'Review';
  const who = r.profileId ? name(r.profileId) : r.guest?.name ?? 'someone';
  return { title: unitTitle(state, w.unitId), sub: `${what} · ${who} · ${r.dueDate ? dueText(r.dueDate) : `asked ${askedWhen(r.hlc)}`}` };
}

// ---- Getting started (ONB-5) -------------------------------------------------------

interface StartRow {
  id: string;
  icon: IconName;
  label: string;
  sub: string;
  /** Why it matters, shown while it is the next step. */
  body: string;
  done: boolean;
  /** Waits on an earlier row. */
  disabled?: boolean;
  /** The next step's one button; absent when there is no way from here (the Map is a tab). */
  action?: { label: string; onPress: () => void };
}

/** The card's hidden flag lives on this device; Settings › Getting started brings it back. */
function useFirstDay(actorId: string, show: boolean): { hidden: boolean; hide: () => void } {
  const key = `first-day-hidden:${actorId}`;
  const [hidden, setHidden] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    if (show) {
      setHidden(false);
      AsyncStorage.removeItem(key).catch(() => {});
      return;
    }
    AsyncStorage.getItem(key)
      .then((v) => { if (live) setHidden(v === '1'); })
      .catch(() => { if (live) setHidden(false); });
    return () => { live = false; };
  }, [key, show]);
  const hide = useCallback(() => {
    setHidden(true);
    AsyncStorage.setItem(key, '1').catch(() => {});
  }, [key]);
  // Hidden until the flag is read, so the card never flashes.
  return { hidden: hidden !== false, hide };
}

/** Everyone the organization or project has, not counting removed members. */
function memberCount(ctx: Ctx, state: ProjectState): number {
  const ids = new Set<string>();
  for (const [id, m] of Object.entries(state.members)) if (!m.removed.value) ids.add(id);
  for (const [id, scopes] of Object.entries(ctx.org.state?.members ?? {})) {
    if (Object.values(scopes).some((m) => !m.removed.value)) ids.add(id);
  }
  return ids.size;
}

function startRows(ctx: Ctx, state: ProjectState): { title: string; promise: string; rows: StartRow[] } | null {
  const s = ctx.session;
  const idx = indexesFor(state);
  const laneId = ctx.laneId;
  const lane = laneId ? laneName(state, laneId) : null;
  const orgName = ctx.org.state?.org?.value.name ?? 'your organization';
  const open = (to: ScreenId, label: string, params?: Record<string, string>) =>
    canGo(ctx, to) ? { label, onPress: () => ctx.go(to, params) } : undefined;

  if (s.isAdmin) {
    const projectName = state.project?.value.name ?? Object.values(ctx.org.state?.projects ?? {}).at(-1)?.name ?? null;
    const projectDone = !!projectName;
    const lanes = idx.lanes;
    const languageDone = lanes.length > 0;
    const lastLane = lanes.at(-1);
    const flowLane = laneId ?? lastLane;
    const flowLaneName = flowLane ? laneName(state, flowLane) : null;
    const members = memberCount(ctx, state);
    const teamDone = members > 1;
    return {
      title: `Let's get ${orgName} recording`,
      promise: 'A few short steps, about 3 minutes. Then your team can start.',
      rows: [
        { id: 'org', icon: 'building', label: 'Name your organization', sub: orgName, body: '', done: true },
        {
          id: 'project', icon: 'folder', label: 'Create a project', done: projectDone,
          sub: projectName ?? 'A home for your languages',
          body: 'A project holds the languages your teams translate into — say, one country or one Bible. About a minute.',
          action: open('new_project', 'Create a project')
        },
        {
          id: 'language', icon: 'globe', label: 'Add a language', done: languageDone, disabled: !projectDone,
          sub: lastLane ? laneName(state, lastLane) : 'The language your team speaks',
          body: `Which language will your first team record? It goes in ${projectName ?? 'your project'}, with every passage ready to record.`,
          action: open('new_language', 'Add a language')
        },
        {
          id: 'flow', icon: 'flow', label: 'Choose how passages get checked', disabled: !languageDone,
          done: !!(flowLane && state.laneFlows[flowLane]),
          sub: flowLane ? `${deriveFlow(state, flowLane).name} for ${flowLaneName}` : 'The checks a passage goes through',
          body: `Every passage in ${flowLaneName ?? 'the language'} goes through a few checks before it's done. Keep the standard ones, or pick others.`,
          action: open('flows_home', "Choose how it's checked", flowLane ? { laneId: flowLane } : undefined)
        },
        {
          // Nothing on the record says roles were "decided"; putting someone in one is the real sign.
          id: 'roles', icon: 'user', label: 'Decide who can do what', done: teamDone,
          sub: 'Translator, reviewer, consultant and more',
          body: 'Roles say who can record, review, invite and more. The usual ones are ready — open one to see what it allows, and invite someone into it from there.',
          action: open('roles_home', 'See the roles')
        },
        {
          id: 'invite', icon: 'people', label: 'Invite your team', done: teamDone,
          sub: teamDone ? plural(members, 'member') : 'By email or QR code',
          body: "The people who'll record and check. No email? Show them a QR code to scan.",
          action: open('invite_member', 'Invite your team')
        }
      ]
    };
  }

  const canRecord = s.can('translate');
  const canReview = s.can('review');
  if (!canRecord && !canReview) return null;
  const rows: StartRow[] = [{
    id: 'map', icon: 'map', label: 'Find your passages on the Map', done: ctx.recent.length > 0,
    sub: lane ? `Every passage in ${lane}` : 'Every passage, and how far it has come',
    body: `Every passage in ${lane ?? 'your language'}, and how far each one has come.${canRecord ? ' Anyone can start one — no need to be asked.' : ''} Tap Map at the bottom of the screen.`
  }];
  if (canRecord) {
    const mine = Object.values(state.submissions).some((x) => x.actorId === s.actorId);
    const first = laneId && !mine ? upNext(state, laneId, { canRecord: true, canReview: false }, idx) : null;
    const title = first ? unitTitle(state, first.unitId) : null;
    rows.push({
      id: 'record', icon: 'mic', label: 'Record your first passage', done: mine,
      sub: mine ? 'Saved to the record' : 'Your first version, saved to the record',
      body: title ? `Nobody has recorded ${title} yet. Open it and tap Record.` : 'Open any passage on the Map and tap Record.',
      ...(first && laneId ? { action: { label: `Open ${title}`, onPress: () => ctx.openPassage(first.unitId, laneId) } } : {})
    });
  }
  if (canReview) {
    const mine = Object.values(state.kindReviews).some((r) => r.by === s.actorId)
      || Object.values(state.reviews).some((bySteps) => Object.values(bySteps).some((byActor) => !!byActor[s.actorId]));
    const first = laneId && !mine ? upNext(state, laneId, { canRecord: false, canReview: true }, idx) : null;
    const by = first && laneId ? derivePassage(state, first.unitId, laneId, idx).latest?.by : undefined;
    const title = first ? unitTitle(state, first.unitId) : null;
    rows.push({
      id: 'review', icon: 'listen', label: 'Give your first review', done: mine,
      sub: mine ? 'Saved to the record' : 'Listen, and say what you heard',
      body: title ? `${by ? ctx.name(by) : 'Someone'} recorded ${title}, and nobody has checked it yet.` : 'When someone asks you to review, it shows here under For you.',
      ...(first && laneId ? { action: { label: `Open ${title}`, onPress: () => ctx.openPassage(first.unitId, laneId) } } : {})
    });
  }
  return {
    title: lane ? `Welcome to the ${lane} team` : 'Welcome',
    promise: "A few minutes, and you'll know your way around.",
    rows
  };
}

// The next step is open with its reason and one button; done steps are ticked;
// later steps are dimmed and wait their turn.
function GettingStartedCard(props: { title: string; promise: string; rows: StartRow[]; onHide: () => void }) {
  const { rows } = props;
  const done = rows.filter((r) => r.done).length;
  const nextIndex = rows.findIndex((r) => !r.done && !r.disabled);
  if (done === rows.length) {
    return (
      <View style={[styles.allSet]}>
        <Ico name="check" size={22} color={TINT.greenText} />
        <Text style={[txt.body, { flex: 1, fontWeight: '600', color: TINT.greenText }]}>You're all set · {done} of {rows.length} done</Text>
        <SmallBtn label="Hide" onPress={props.onHide} />
      </View>
    );
  }
  return (
    <View style={styles.startCard}>
      <View style={styles.startHead}>
        <Text style={[txt.label, { color: C.primary }]}>{done === 0 ? 'Getting started' : `${done} of ${rows.length} done — keep going`}</Text>
        <Text style={txt.h2}>{props.title}</Text>
        {done === 0 ? <Text style={txt.smMuted}>{props.promise}</Text> : null}
        <View style={{ marginTop: space.xs }}>
          <Segments total={rows.length} done={(i) => rows[i]!.done} current={nextIndex} />
        </View>
      </View>
      {rows.map((r, i) => {
        const isNext = i === nextIndex;
        const num = (
          <View style={[styles.num, r.done ? { backgroundColor: TINT.green } : isNext ? { backgroundColor: C.primary } : { backgroundColor: C.bg }]}>
            {r.done ? <Ico name="check" size={22} color={TINT.greenText} />
              : <Text style={[txt.h3, { color: isNext ? C.white : C.muted }]}>{i + 1}</Text>}
          </View>
        );
        if (isNext) {
          return (
            <View key={r.id} style={styles.startRow}>
              {num}
              <View style={{ flex: 1, minWidth: 0, gap: space.md }}>
                <View style={{ gap: 4 }}>
                  <Text style={txt.h3}>{r.label}</Text>
                  <Text style={txt.smMuted}>{r.body}</Text>
                </View>
                {r.action ? <View style={{ alignSelf: 'flex-start' }}><SmallBtn label={r.action.label} icon={r.icon} tone="primary" onPress={r.action.onPress} /></View> : null}
              </View>
            </View>
          );
        }
        const tappable = r.done && r.action;
        const body = (
          <>
            {num}
            <View style={{ flex: 1, minWidth: 0, opacity: r.done ? 1 : 0.55 }}>
              <Text style={[txt.body, { fontWeight: '600', color: r.done ? C.muted : C.dark }]} numberOfLines={2}>{r.label}</Text>
              <Text style={txt.smMuted} numberOfLines={1}>{r.sub}</Text>
            </View>
            {tappable ? <Ico name="right" size={20} color={C.muted} /> : null}
          </>
        );
        return tappable ? (
          <Pressable key={r.id} onPress={r.action!.onPress} accessibilityRole="button" style={({ pressed }) => [styles.startRow, styles.startRowCompact, pressed && { opacity: 0.7 }]}>
            {body}
          </Pressable>
        ) : (
          <View key={r.id} style={[styles.startRow, styles.startRowCompact]} accessibilityLabel={`${r.label}${r.done ? ', done' : ''}`}>{body}</View>
        );
      })}
      <Pressable onPress={props.onHide} accessibilityRole="button" style={({ pressed }) => [styles.hide, pressed && { opacity: 0.6 }]}>
        <Text style={[txt.sm, { color: C.muted, fontWeight: '600' }]}>Hide this — find it again in Settings</Text>
      </Pressable>
    </View>
  );
}

// ---- cards and rows ------------------------------------------------------------------

function AskCard(props: { icon: IconName; bg: string; fg: string; title: string; sub: string; cta: string; onPress: () => void }) {
  return (
    <Card onPress={props.onPress} accessibilityLabel={`${props.title}. ${props.sub}. ${props.cta}`} style={styles.ask}>
      <View style={[styles.tile, { backgroundColor: props.bg }]}><Ico name={props.icon} size={24} color={props.fg} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[txt.body, { fontWeight: '600' }]}>{props.title}</Text>
        <Text style={[txt.smMuted, { marginTop: 2 }]}>{props.sub}</Text>
      </View>
      <View style={[styles.cta, { backgroundColor: props.bg }]}>
        <Text style={[txt.sm, { fontWeight: '700', color: props.fg }]}>{props.cta}</Text>
      </View>
    </Card>
  );
}

function UpNextCard(props: { icon: IconName; title: string; sub: string; action?: { label: string; onPress: () => void } }) {
  return (
    <Card>
      <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
        <View style={[styles.tile, { backgroundColor: C.light }]}><Ico name={props.icon} size={24} color={C.primary} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[txt.body, { fontWeight: '600' }]}>{props.title}</Text>
          <Text style={[txt.smMuted, { marginTop: 2 }]}>{props.sub}</Text>
        </View>
      </View>
      {props.action ? <GhostBtn label={props.action.label} onPress={props.action.onPress} /> : null}
    </Card>
  );
}

/** The sync state, small, beside the title: what is still on this phone only, and whether the live channel is up. */
function SyncChip(ctx: Ctx) {
  const p = ctx.project;
  const label = p.pending > 0 ? `${p.pending.toLocaleString('en-US')} to send` : p.online === false ? 'Offline' : p.live ? 'Live' : 'Saved';
  if (!canGo(ctx, 'sync_status')) return null;
  return <SmallBtn icon="cloud" label={label} onPress={() => ctx.go('sync_status')} />;
}

// ---- the screen -------------------------------------------------------------------------

export function MyWork(ctx: Ctx) {
  const state = ctx.project.state;
  const actorId = ctx.session.actorId;
  const canRecord = ctx.session.can('translate');
  const canReview = ctx.session.can('review');
  const [allForYou, setAllForYou] = useState(false);
  const [allWaiting, setAllWaiting] = useState(false);
  const firstDay = useFirstDay(actorId, ctx.params['showGettingStarted'] === '1');

  const lists = useMemo(() => {
    if (!state) return null;
    const idx = indexesFor(state);
    const forYou = highlightsFor(state, actorId, { canRecord, canReview }, idx);
    const waiting = waitingOn(state, actorId, {}, idx);
    const listed = new Set([...forYou, ...waiting].map((x) => `${x.unitId}:${x.laneId}`));
    const recent = ctx.recent
      .filter((r) => state.units[r.unitId] && state.lanes[r.laneId] && !listed.has(`${r.unitId}:${r.laneId}`))
      .slice(0, RECENT_CAP)
      .map((r) => ({ ...r, s: derivePassage(state, r.unitId, r.laneId, idx) }));
    const lanes = new Set([...forYou, ...waiting, ...recent].map((x) => x.laneId));
    return { forYou, waiting, recent, kinds: deriveKinds(state), spansLanes: lanes.size > 1 };
  }, [state, actorId, canRecord, canReview, ctx.recent]);

  const orgName = ctx.org.state?.org?.value.name ?? state?.project?.value.name ?? '';
  const header = <Header title="My Work" sub={orgName || undefined} action={<SyncChip {...ctx} />} />;
  if (!state || !lists) {
    return <Screen header={header}><Text style={[txt.bodyMuted, { textAlign: 'center', paddingVertical: space.xxl }]}>Loading your work…</Text></Screen>;
  }

  const { forYou, waiting, recent, kinds, spansLanes } = lists;
  const withLanguage = (laneId: string, sub: string) => (spansLanes ? `${laneName(state, laneId)} · ${sub}` : sub);
  const start = firstDay.hidden ? null : startRows(ctx, state);
  const setupOpen = !!start && ctx.session.isAdmin && start.rows.some((r) => !r.done);

  function openHighlight(h: Highlight) {
    const base: Record<string, string> = { unitId: h.unitId, laneId: h.laneId };
    const requestId: Record<string, string> = h.request ? { requestId: h.request.id } : {};
    const kindId: Record<string, string> = h.request?.kindId ? { kindId: h.request.kindId } : {};
    if (h.kind === 'record' && canGo(ctx, 'workspace')) return ctx.go('workspace', { ...base, ...requestId });
    if (h.kind === 'draft' && canGo(ctx, 'workspace')) return ctx.go('workspace', base);
    if (h.kind === 'review' && canGo(ctx, 'review_capture')) return ctx.go('review_capture', { ...base, ...kindId, ...requestId });
    if (h.kind === 'produce' && canGo(ctx, 'back_translation')) return ctx.go('back_translation', { ...base, ...kindId, ...requestId });
    ctx.openPassage(h.unitId, h.laneId);
  }

  // ONB-7: something real to do when nothing is waiting, instead of an empty list.
  const suggestions: { id: string; icon: IconName; title: string; sub: string; action?: { label: string; onPress: () => void } }[] = [];
  if (forYou.length === 0 && !setupOpen && ctx.laneId) {
    const laneId = ctx.laneId;
    const lane = laneName(state, laneId);
    const idx = indexesFor(state);
    if (ctx.session.isAdmin && !canRecord && !canReview) {
      const first = upNext(state, laneId, { canRecord: true, canReview: false }, idx);
      if (first) {
        const title = unitTitle(state, first.unitId);
        suggestions.push({ id: 'first', icon: 'mic', title: `Get ${lane} started`, sub: `Ask someone to record ${title} — or let your team pick any passage.`,
          action: { label: `Open ${title}`, onPress: () => ctx.openPassage(first.unitId, laneId) } });
      }
      suggestions.push({ id: 'map', icon: 'progress', title: 'See how every language is doing', sub: 'Recorded, checked, done — for each language, as your teams work. Tap Map at the bottom of the screen.' });
    } else {
      const next = upNext(state, laneId, { canRecord, canReview }, idx);
      if (next) {
        const title = unitTitle(state, next.unitId);
        const open = { label: 'Open it', onPress: () => ctx.openPassage(next.unitId, laneId) };
        if (next.kind === 'record') {
          suggestions.push({ id: 'record', icon: 'mic', title: `Start ${title}`, sub: "Nobody has recorded it yet. You don't need to be asked — anyone on the team can start.", action: open });
        } else {
          const by = derivePassage(state, next.unitId, laneId, idx).latest?.by;
          suggestions.push({ id: 'listen', icon: 'play', title: `Listen to ${title}`, sub: `${by ? ctx.name(by) : 'Someone'} recorded it, and nobody has checked it yet.`, action: open });
        }
      }
      suggestions.push({ id: 'map', icon: 'map', title: `Everything in ${lane}`, sub: "Every passage, and how far it's come. Tap Map at the bottom of the screen." });
    }
  }

  const shownForYou = allForYou ? forYou : forYou.slice(0, FOR_YOU_CAP);
  const shownWaiting = allWaiting ? waiting : waiting.slice(0, WAITING_CAP);

  return (
    <Screen header={header}>
      {start ? <GettingStartedCard {...start} onHide={firstDay.hide} /> : null}

      <SectionLabel label={`For you${forYou.length ? ` · ${forYou.length}` : ''}`} />
      {forYou.length === 0 && suggestions.length > 0 ? (
        <>
          <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>Nobody has asked you for anything yet. Here's a good place to start:</Text>
          {suggestions.map(({ id, ...u }) => <UpNextCard key={id} {...u} />)}
        </>
      ) : forYou.length === 0 ? (
        <Card style={styles.ask}>
          <View style={[styles.tile, { backgroundColor: TINT.green }]}><Ico name="check" size={24} color={TINT.greenText} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[txt.body, { fontWeight: '600' }]}>Nothing is waiting on you</Text>
            <Text style={[txt.smMuted, { marginTop: 2 }]}>
              {ctx.session.isAdmin ? 'Set up people, projects and review flows under Manage, or find any passage on the Map.' : 'Find any passage on the Map to keep going.'}
            </Text>
          </View>
        </Card>
      ) : shownForYou.map((h) => {
        const st = highlightStyle(h.kind);
        const t = highlightText(state, kinds, h, ctx.name);
        return <AskCard key={h.id} icon={st.icon} bg={st.bg} fg={st.fg} cta={st.cta} title={t.title} sub={withLanguage(h.laneId, t.sub)} onPress={() => openHighlight(h)} />;
      })}
      {forYou.length > FOR_YOU_CAP ? <GhostBtn label={allForYou ? 'Show fewer' : `Show all ${forYou.length}`} onPress={() => setAllForYou((a) => !a)} /> : null}

      {recent.length > 0 ? (
        <>
          <SectionLabel label="Recent" />
          <Group>
            {recent.map((r, i) => (
              <Row key={`${r.unitId}:${r.laneId}`} icon="history" iconColor={C.muted} iconBg={C.bg} last={i === recent.length - 1}
                label={unitTitle(state, r.unitId)}
                sub={withLanguage(r.laneId, passageSummary(r.s, kinds, actorId, (id) => ctx.name(id, true)))}
                right={r.s.recorded && r.s.steps.length > 0
                  ? <StepMarks steps={r.s.steps.map((st) => ({ kinds: st.kinds, checkpoint: st.step.checkpoint }))} size={14} />
                  : undefined}
                onPress={() => ctx.openPassage(r.unitId, r.laneId)} />
            ))}
          </Group>
        </>
      ) : null}

      {waiting.length > 0 ? (
        <>
          <SectionLabel label={`Waiting on others · ${waiting.length}`} />
          <Group>
            {shownWaiting.map((w, i) => {
              const t = waitingText(state, kinds, w, ctx.name);
              return (
                <Row key={w.id} icon="clock" iconColor={C.muted} iconBg={C.bg} last={i === shownWaiting.length - 1}
                  label={t.title} sub={withLanguage(w.laneId, t.sub)} onPress={() => ctx.openPassage(w.unitId, w.laneId)} />
              );
            })}
          </Group>
          {waiting.length > WAITING_CAP ? <GhostBtn label={allWaiting ? 'Show fewer' : `Show all ${waiting.length}`} onPress={() => setAllWaiting((a) => !a)} /> : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  ask: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 76, paddingVertical: space.md },
  tile: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  cta: { borderRadius: radius.full, paddingHorizontal: space.md, paddingVertical: space.sm },
  allSet: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: TINT.green, borderRadius: radius.xl, paddingLeft: space.lg, paddingRight: space.sm, paddingVertical: space.sm },
  startCard: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: 1.5, borderColor: C.primary, overflow: 'hidden' },
  startHead: { backgroundColor: C.light, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md, gap: 4 },
  startRow: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.lg, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  startRowCompact: { alignItems: 'center', minHeight: 60, paddingVertical: space.md },
  num: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  hide: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border }
});

export const contracts = contractsFor('my_work');
