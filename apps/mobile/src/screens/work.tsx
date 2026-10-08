// My Work, as the simple redesign has it (decision 71): Ryder's Home with the
// app's tabs and the bell (ng-langquest-ux src/simple/translator.tsx, Home and
// HomeCoord; demo ADR-032, ADR-039; SIMPLE-1). It still ports the demo's
// MyWorkScreen: WORK-1..4, ONB-7; ADR-017, ADR-009, ADR-022, ADR-023.
//
// The one place that answers "what should I do next?" (ADR-017), with one
// decision on the first screen: a "Next for you" card with Start, then a
// short "Then" list, then "Waiting on others" one quiet tap away. A
// coordinator's Home leads with "Get ‹language› ready" until the language is
// (ADR-039, amended 2026-10-07), with join requests and checks asked of them
// under it. Everything here is derived from the record: what someone asked of
// you, feedback on your versions, your unsaved drafts, what you asked of
// others. Nothing here gates the work; every passage is still reachable from
// the Map. Getting started is gone: help mode (the ? in the header) explains
// each part for field workers, and the Get ready card leads coordinators.
import {
  derivePassage, deriveKinds, highlightsFor, languageName, membershipsOf, passageSummary, recommendedFor, timeAgo, unitTitle, upNext, waitingOn,
  type Highlight, type KindDef, type LanguageState, type OrgState, type Waiting
} from '@langquest-next/core';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Ctx } from '../ctx';
import { edgeFor, type ScreenId } from '../flow';
import { indexesFor } from '../indexes';
import { pendingRequests, type PendingRequest } from '../invites';
import { Card, Group, Header, Ico, Row, Screen, SectionLabel, SmallBtn, StepMarks, txt, type IconName } from '../kit';
import { dueText, when } from '../passageView';
import { noteExpected } from '../report';
import { contractsFor } from '../screenContracts';
import { edgeAllowed, mapScreenFor } from '../session';
import { Bell, NextCard, QuietToggle, ReadyCard } from '../simple/home';
import { nextSub, readiness, readySteps, THEN_CAP, workIcon, workSub, workTarget, workWhat, type Readiness } from '../simple/homeModel';
import { C, space, TINT } from '../theme';

const RECENT_CAP = 5;

/** May My Work take this edge for this session? A screen never offers what it cannot do. */
function canGo(ctx: Ctx, to: ScreenId): boolean {
  const edge = edgeFor('my_work', to);
  return !!edge && edgeAllowed(edge, ctx.session);
}

/** "asked just now", "asked 2 h ago", "asked Sep 2". */
function askedWhen(hlc: string): string {
  const w = when(hlc);
  return w === 'Just now' ? 'just now' : w;
}

function waitingText(state: LanguageState, kinds: KindDef[], w: Waiting, name: Ctx['name']): { title: string; sub: string } {
  const r = w.request;
  const what = r.what === 'record' ? 'Recording' : kinds.find((k) => k.id === r.kindId)?.name ?? 'Review';
  const who = r.profileId ? name(r.profileId) : r.guest?.name ?? 'someone';
  return { title: unitTitle(state, w.unitId), sub: `${what} · ${who} · ${r.dueDate ? dueText(r.dueDate) : `asked ${askedWhen(r.hlc)}`}` };
}

/** Everyone the organization has, at any scope, not counting removed members. */
function memberCount(org: OrgState | null): number {
  if (!org) return 0;
  return Object.keys(org.members).filter((id) => membershipsOf(org, id).length > 0).length;
}

/**
 * The open language's four questions (demo ADR-039), for those who get a
 * language ready: an admin who may take My Work to Get ready. Null for
 * everyone else.
 */
function readyFor(ctx: Ctx, state: LanguageState): Readiness | null {
  if (!ctx.session.isAdmin || !ctx.languageId || !canGo(ctx, 'get_ready')) return null;
  return readiness(readySteps({
    template: !!state.template,
    helps: recommendedFor(ctx.org.state?.recommendations, state).size,
    flow: !!state.flow,
    members: memberCount(ctx.org.state)
  }));
}

/**
 * People asking to join, for those who may let them in (the existing Assign
 * role & accept, in Edit Member). Read from the server; offline the list is
 * empty and the bell still counts them. Read again when the bell's count
 * moves, which it does when someone asks or is decided.
 */
function useJoinRequests(ctx: Ctx): PendingRequest[] {
  const may = ctx.session.can('invite_members') && canGo(ctx, 'edit_member');
  const orgId = ctx.language.orgId;
  const tick = ctx.inbox.unread;
  const [rows, setRows] = useState<PendingRequest[]>([]);
  useEffect(() => {
    if (!may) { setRows([]); return; }
    let live = true;
    pendingRequests(orgId).then((r) => { if (live) setRows(r); }).catch((e: unknown) => noteExpected('my work join requests', e));
    return () => { live = false; };
  }, [may, orgId, tick]);
  const decided = ctx.org.state?.joinDecisions ?? {};
  return rows.filter((r) => !decided[r.id]);
}

/** The sync state, small, beside the bell, only when it needs noticing: work still on this device, offline, or refused. */
function SyncChip(ctx: Ctx) {
  const p = ctx.language;
  if (!canGo(ctx, 'sync_status')) return null;
  const label = p.refused ? 'Not syncing' : p.pending > 0 ? `${p.pending.toLocaleString('en-US')} to send` : p.online === false ? 'Offline' : null;
  if (!label) return null;
  return <SmallBtn icon="cloud" label={label} onPress={() => ctx.go('sync_status')} />;
}

interface WorkItem {
  id: string;
  icon: IconName;
  tone: 'brand' | 'amber';
  title: string;
  sub: string;
  onPress: () => void;
}

function WorkRows(props: { items: WorkItem[] }) {
  return (
    <Group>
      {props.items.map((it, i) => (
        <Row key={it.id} icon={it.icon} label={it.title} sub={it.sub} last={i === props.items.length - 1} onPress={it.onPress}
          iconBg={it.tone === 'amber' ? TINT.amber : C.light} iconColor={it.tone === 'amber' ? TINT.amberText : C.primary} />
      ))}
    </Group>
  );
}

// ---- the screen -------------------------------------------------------------------------

export function MyWork(ctx: Ctx) {
  const state = ctx.language.state;
  const actorId = ctx.session.actorId;
  const canRecord = ctx.session.can('translate');
  const canReview = ctx.session.can('review');
  const waitingOpen = ctx.details('work:waiting');
  const recentOpen = ctx.details('work:recent');
  const [moreShown, setMoreShown] = useState(false);
  const joins = useJoinRequests(ctx);

  // Everything here is in the open language: its stream is the one on this phone.
  const languageId = ctx.languageId;
  const lists = useMemo(() => {
    if (!state) return null;
    const idx = indexesFor(state);
    const forYou = highlightsFor(state, actorId, { canRecord, canReview }, idx);
    const waiting = waitingOn(state, actorId, idx);
    const listed = new Set([...forYou, ...waiting].map((x) => x.unitId));
    const recent = ctx.recent
      .filter((r) => r.languageId === languageId && state.units[r.unitId] && !listed.has(r.unitId))
      .slice(0, RECENT_CAP)
      .map((r) => ({ ...r, s: derivePassage(state, r.unitId, idx) }));
    return { forYou, waiting, recent, kinds: deriveKinds(state) };
  }, [state, actorId, canRecord, canReview, ctx.recent, languageId]);

  const orgName = ctx.org.state?.org?.value.name ?? '';
  const language = languageId ? languageName(ctx.org.state, languageId) : '';
  const bell = canGo(ctx, 'inbox_home') ? <Bell count={ctx.inbox.unread} onPress={() => ctx.go('inbox_home', { from: 'my_work' })} /> : null;
  const header = (
    <Header title="My Work" sub={[language, orgName].filter(Boolean).join(' · ') || undefined}
      action={<View style={styles.headerActions}><SyncChip {...ctx} />{bell}</View>} />
  );
  if (!state || !lists) {
    return <Screen header={header}><Text style={[txt.bodyMuted, { textAlign: 'center', paddingVertical: space.xxl }]}>Loading your work…</Text></Screen>;
  }

  const { forYou, waiting, recent, kinds } = lists;
  const idx = indexesFor(state);

  function open(h: Highlight, languageId: string) {
    const base: Record<string, string> = { unitId: h.unitId, languageId };
    const requestId: Record<string, string> = h.request ? { requestId: h.request.id } : {};
    const kindId: Record<string, string> = h.request?.kindId ? { kindId: h.request.kindId } : {};
    const target = workTarget(h.kind);
    if (target === 'review' && canGo(ctx, 'review_capture')) return ctx.go('review_capture', { ...base, ...kindId, ...requestId });
    if (target === 'back_translation' && canGo(ctx, 'back_translation')) return ctx.go('back_translation', { ...base, ...kindId, ...requestId });
    ctx.openPassage(h.unitId, languageId);
  }

  /** One highlight's words: the passage, what to do, who asked and when it is due. */
  function words(h: Highlight): { title: string; what: string; by?: string; due?: string } {
    const r = h.request;
    const kindName = r?.kindId ? kinds.find((k) => k.id === r.kindId)?.name : undefined;
    return {
      title: unitTitle(state!, h.unitId),
      what: workWhat(h.kind, kindName),
      ...(h.kind === 'respond' && h.review ? {} : r?.by ? { by: ctx.name(r.by) } : {}),
      ...(r?.dueDate ? { due: dueText(r.dueDate) } : {})
    };
  }

  const toItem = (h: Highlight, languageId: string): WorkItem => {
    const w = words(h);
    const look = workIcon(h.kind);
    // Feedback says who it came from in the passage itself; the row stays short (demo Then list).
    const sub = h.kind === 'respond' ? w.what : workSub(w.what, { ...(w.by ? { by: w.by } : {}), ...(w.due ? { due: w.due } : {}) });
    // A check asked of you reads as one (demo HomeCoord: "Check Luke 1:1–4"); the rest by the passage alone.
    return { id: h.id, icon: look.icon, tone: look.tone, title: h.kind === 'review' ? `Check ${w.title}` : w.title, sub, onPress: () => open(h, languageId) };
  };
  const joinItems: WorkItem[] = joins.map((r) => ({
    id: `join:${r.id}`, icon: 'people', tone: 'brand',
    title: `${r.name ?? ctx.name(r.profileId)} wants to join`,
    sub: r.message.trim() || `Asked ${timeAgo(r.createdAt, Date.now())}`,
    onPress: () => ctx.go('edit_member', { memberId: r.profileId, requestId: r.id, ...(r.name ? { name: r.name } : {}), ...(r.message ? { message: r.message } : {}) })
  }));

  // ---- the lead card: Get ready, the next thing for you, or a good place to start ----
  const ready = readyFor(ctx, state);
  const getReady = ready && ready.next ? ready : null;
  const addLanguage = !languageId && ctx.session.isAdmin && canGo(ctx, 'new_language');
  const isAdminOnly = ctx.session.isAdmin && !canRecord && !canReview;
  let lead: React.JSX.Element | null = null;
  let rest: Highlight[] = forYou;
  let suggested = false;
  if (addLanguage) {
    lead = <NextCard label={`Get ${orgName || 'your organization'} ready`} title="Add a language" sub="The language your team speaks"
      cta="Add a language" onPress={() => ctx.go('new_language')} />;
  } else if (getReady && languageId) {
    lead = <ReadyCard language={language} done={getReady.done} total={getReady.total} question={getReady.next!.question}
      onChoose={() => ctx.go('get_ready', { languageId, step: String(getReady.step) })} />;
  } else if (forYou.length > 0 && languageId) {
    const first = forYou[0]!;
    const w = words(first);
    rest = forYou.slice(1);
    lead = <NextCard label="Next for you" title={w.title} cta="Start" onPress={() => open(first, languageId)}
      sub={nextSub(first.kind, w.what, { ...(w.by ? { by: w.by } : {}), ...(w.due ? { due: w.due } : {}) })} />;
  } else if (languageId) {
    // ONB-7: something real to do when nothing is waiting, instead of an empty list.
    const next = upNext(state, isAdminOnly ? { canRecord: true, canReview: false } : { canRecord, canReview }, idx);
    if (next) {
      suggested = true;
      const title = unitTitle(state, next.unitId);
      const by = next.kind === 'review' ? derivePassage(state, next.unitId, idx).latest?.by : undefined;
      const sub = isAdminOnly ? 'Nobody has recorded it yet · ask someone, or let your team pick any passage'
        : next.kind === 'record' ? "Nobody has recorded it yet · you don't need to be asked"
        : `${by ? ctx.name(by) : 'Someone'} recorded it · nobody has checked it yet`;
      lead = <NextCard label={isAdminOnly ? `Get ${language} started` : 'A good place to start'} title={title} sub={sub}
        cta={isAdminOnly ? 'Open it' : 'Start'} onPress={() => ctx.openPassage(next.unitId, languageId)} />;
    }
  }

  const items = [...joinItems, ...(languageId ? rest.map((h) => toItem(h, languageId)) : [])];
  const shown = moreShown ? items : items.slice(0, THEN_CAP);
  const listLabel = lead && !getReady && !addLanguage && !suggested ? 'Then' : 'Also for you';
  const nothing = !lead && items.length === 0;
  const map = () => ctx.go(mapScreenFor(ctx.session));

  return (
    <Screen header={header}>
      {lead}
      {nothing ? (
        <Card style={styles.caughtUp}>
          <View style={[styles.tile, { backgroundColor: TINT.green }]}><Ico name="check" size={24} color={TINT.greenText} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[txt.body, { fontWeight: '700' }]}>Nothing is waiting on you</Text>
            <Text style={[txt.smMuted, { marginTop: 2 }]}>
              {ctx.session.isAdmin ? 'Set up people, languages and review flows under Manage, or find any passage on the Map.' : 'Find any passage on the Map to keep going.'}
            </Text>
          </View>
        </Card>
      ) : null}

      {items.length > 0 ? (
        <>
          <SectionLabel label={listLabel} />
          <WorkRows items={shown} />
          {items.length > THEN_CAP ? (
            <QuietToggle label={moreShown ? 'Fewer' : `${items.length - THEN_CAP} more for you`} open={moreShown} onPress={() => setMoreShown((v) => !v)} />
          ) : null}
        </>
      ) : null}

      {/* The less likely ways on, each one labelled tap away (demo ADR-032): what you asked of others, what you opened lately, the whole map. */}
      <View style={styles.quietLinks}>
        {waiting.length > 0 && languageId ? (
          <QuietToggle label={`Waiting on others · ${waiting.length}`} open={waitingOpen.open} onPress={waitingOpen.onToggle}
            detail="What you asked of someone else that is not done yet." />
        ) : null}
        {waitingOpen.open && waiting.length > 0 && languageId ? (
          <Group>
            {waiting.map((w, i) => {
              const t = waitingText(state, kinds, w, ctx.name);
              return (
                <Row key={w.id} icon="clock" iconColor={C.muted} iconBg={C.bg} last={i === waiting.length - 1}
                  label={t.title} sub={t.sub} onPress={() => ctx.openPassage(w.unitId, languageId)} />
              );
            })}
          </Group>
        ) : null}
        {recent.length > 0 ? (
          <QuietToggle label={`Opened lately · ${recent.length}`} open={recentOpen.open} onPress={recentOpen.onToggle}
            detail="Passages you opened lately, to pick up where you were." />
        ) : null}
        {recentOpen.open && recent.length > 0 ? (
          <Group>
            {recent.map((r, i) => (
              <Row key={`${r.unitId}:${r.languageId}`} icon="history" iconColor={C.muted} iconBg={C.bg} last={i === recent.length - 1}
                label={unitTitle(state, r.unitId)}
                sub={passageSummary(r.s, kinds, actorId, (id) => ctx.name(id, true))}
                right={r.s.recorded && r.s.steps.length > 0
                  ? <StepMarks steps={r.s.steps.map((st) => ({ kinds: st.kinds, checkpoint: st.step.checkpoint }))} size={14} />
                  : undefined}
                onPress={() => ctx.openPassage(r.unitId, r.languageId)} />
            ))}
          </Group>
        ) : null}
        {languageId && (forYou.length === 0 || nothing) ? (
          <QuietToggle label={isAdminOnly ? 'See how every language is doing' : `Everything in ${language}`} onPress={map}
            detail="Every passage, and how far it has come." />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  caughtUp: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 76, paddingVertical: space.md },
  tile: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  quietLinks: { gap: space.sm, paddingTop: space.xs }
});

export const contracts = contractsFor('my_work');
