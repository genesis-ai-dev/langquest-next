// The Inbox and Settings tabs. Ports the demo's src/screens/account.tsx
// (InboxHomeScreen, SettingsHomeScreen, ProfileEditScreen,
// OrgSwitcherScreen, SignOutConfirmScreen); SyncStatus is app only (the
// local log, realtime state and transfers).
// Requirements INBOX-1, INBOX-2, AUTH-7, AUTH-8, ONB-2 and ONB-5 (the
// Settings rows back to them), CORE-12 (sign-out never strands work).
import { decodeHlc, deriveKinds, kindOf, laneName, unitTitle, type Update } from '@langquest-next/core';
import type { SyncInspection } from '@langquest-next/client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { accountOutbox, queueAccountAction } from '../accountData';
import { groupByRead, joinRequestIdOf, updateText } from '../accountText';
import type { Ctx } from '../ctx';
import { decideRequest, pendingRequests, type PendingRequest } from '../invites';
import {
  Badge, Banner, Card, EmptyState, Field, GhostBtn, Group, Header, Ico, PrimaryBtn, ProgressBar, Row, Screen,
  SectionLabel, Sheet, ShowMore, txt, type IconName
} from '../kit';
import { cachedInbox, enableNotifications, refreshInbox, unregisterNotifications, type RemoteNotification } from '../notifications';
import { dueText, when } from '../passageView';
import { personLook } from '../people';
import { contractsFor } from '../screenContracts';
import { homeScreenFor } from '../session';
import { supabase } from '../supabase';
import { C, radius, space, TINT } from '../theme';
import { useAccountActions, useDisplayNames } from '../useAccount';
import { runningBuildLabel } from '../updateStatus';
import { PersonAvatar } from '../UserChip';

// ---- Inbox (INBOX-1, INBOX-2) ---------------------------------------------------------------

interface InboxItem {
  id: string;
  icon: IconName;
  title: string;
  body: string;
  time?: string;
  read: boolean;
  onPress: () => void;
}

const INBOX_STEP = 25;

/** The org's role and name for the signed-in person: "Translator · Wycliffe Associates". */
function useAccountLine(ctx: Ctx) {
  const org = ctx.org.state;
  const me = ctx.session.actorId;
  const mine = Object.values(org?.members[me] ?? {}).filter((m) => !m.removed.value);
  const roleName = mine.map((m) => org?.roles[m.roleId.value]?.name.value).find(Boolean)
    ?? (ctx.session.role ? ctx.session.role[0]!.toUpperCase() + ctx.session.role.slice(1) : 'No role yet');
  const orgName = org?.org?.value.name ?? ctx.project.orgId;
  return { roleName, orgName, memberName: mine.find((m) => m.displayName)?.displayName };
}

/**
 * What happened that concerns you, grouped Unread / Earlier (INBOX-1): one
 * about a passage opens its record and is marked read. Join requests offer
 * Assign role & accept, or Decline (INBOX-2). Updates from another
 * organization or project open it.
 */
export function InboxHome(ctx: Ctx) {
  const { state } = ctx.project;
  const me = ctx.session.actorId;
  const orgId = ctx.project.orgId;
  const accountActions = useAccountActions(me).filter((a) => a.status !== 'sent');
  const names = useDisplayNames(me);
  const { orgName } = useAccountLine(ctx);

  // Join requests for this organization, for those who may admit people.
  const canAdmit = ctx.session.can('invite_members');
  const [requests, setRequests] = useState<PendingRequest[] | null>(null);
  const [requestsTick, setRequestsTick] = useState(0);
  useEffect(() => {
    if (!canAdmit) return;
    let active = true;
    pendingRequests(orgId).then((rows) => { if (active) setRequests(rows); }).catch(() => { if (active) setRequests(null); });
    return () => { active = false; };
  }, [canAdmit, orgId, requestsTick]);
  const [openRequest, setOpenRequest] = useState<PendingRequest | null>(null);
  const [declining, setDeclining] = useState(false);

  // Server notifications about other organizations and projects (and join requests when the list above is unavailable).
  const [remote, setRemote] = useState<RemoteNotification[]>([]);
  const [remoteRead, setRemoteRead] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    void (async () => {
      const [cached, seen] = await Promise.all([cachedInbox(me), AsyncStorage.getItem(`inbox-read:${me}`)]);
      if (active) { setRemote(cached); setRemoteRead(JSON.parse(seen ?? '[]')); }
      const rows = await refreshInbox(me);
      if (active) setRemote(rows);
    })().catch(() => {});
    return () => { active = false; };
  }, [me]);
  async function openRemote(row: RemoteNotification) {
    const next = [...new Set([...remoteRead, row.id])];
    setRemoteRead(next);
    await AsyncStorage.setItem(`inbox-read:${me}`, JSON.stringify(next)).catch(() => {});
    if (row.org_id !== orgId || (row.project_id !== '_org' && row.project_id !== ctx.project.projectId)) {
      await ctx.openOrganization(row.org_id, row.project_id === '_org' ? undefined : row.project_id).catch((e: Error) => ctx.toast(e.message));
    } else if (row.kind === 'join_request') ctx.go('members_list');
  }

  // The words for each record-derived update, memoized on the fold.
  const words = useMemo(() => {
    if (!state) return null;
    const kinds = deriveKinds(state);
    const kindName = (id: string | undefined) => (id ? (kinds.find((k) => k.id === id) ?? kindOf(state, id)).name : 'review');
    const produces = (id: string) => !!(kinds.find((k) => k.id === id) ?? kindOf(state, id)).produces;
    return (u: Update) => updateText(u, {
      name: ctx.name, passage: unitTitle(state, u.unitId), lane: laneName(state, u.laneId), kindName, produces, due: (d) => dueText(d)
    });
  }, [state, ctx.name]);

  // Built each render: only the shown rows are drawn, and the words are memoized above.
  const items: InboxItem[] = [];
  const decided = ctx.org.state?.joinDecisions ?? {};
  for (const r of requests ?? []) {
    if (decided[r.id]) continue;
    items.push({
      id: `join:${r.id}`, icon: 'people', title: 'Join request', read: false,
      body: `${names[r.profileId] ?? personLook(r.profileId).name} asked to join ${orgName}. Assign a role to give them access.`,
      time: new Date(r.createdAt).toLocaleDateString(), onPress: () => setOpenRequest(r)
    });
  }
  if (words) {
    for (const u of ctx.inbox.updates) {
      const w = words(u);
      items.push({
        id: u.id, icon: w.icon, title: w.title, body: w.body, time: when(u.hlc), read: ctx.inbox.isRead(u.id),
        onPress: () => { ctx.inbox.markRead([u.id]); ctx.openPassage(u.unitId, u.laneId); }
      });
    }
  }
  const seen = new Set(remoteRead);
  for (const row of remote) {
    const here = row.org_id === orgId && (row.project_id === '_org' || row.project_id === ctx.project.projectId);
    // This project's updates are derived above, and this org's join requests too once they are listed.
    if (here && (row.kind !== 'join_request' || requests !== null)) continue;
    if (here && !(canAdmit && ctx.session.can('assign_work'))) continue;
    items.push({
      id: `remote:${row.id}`, icon: row.kind === 'join_request' ? 'people' : 'notif', title: row.title,
      body: here ? 'Open Members to assign a role.' : joinRequestIdOf(row.id) ? 'In another organization. Opening it switches to it.' : 'In another project. Opening it switches to it.',
      read: seen.has(row.id), onPress: () => void openRemote(row)
    });
  }

  const { unread, earlier } = groupByRead(items, (i) => i.read);
  const [shownUnread, setShownUnread] = useState(INBOX_STEP);
  const [shownEarlier, setShownEarlier] = useState(INBOX_STEP);

  async function decline(r: PendingRequest) {
    setDeclining(true);
    try {
      await decideRequest(r.id, false);
      ctx.toast('Declined. They were not given access.');
      setOpenRequest(null);
      setRequestsTick((t) => t + 1);
    } catch (e) {
      ctx.toast(`Not declined: ${(e as Error).message}`);
    } finally {
      setDeclining(false);
    }
  }

  const list = (rows: InboxItem[], shown: number) => (
    <Group>
      {rows.slice(0, shown).map((n, i, a) => (
        <Row key={n.id} icon={n.icon} iconBg={n.read ? C.bg : C.light} label={n.title}
          sub={n.time ? `${n.body} · ${n.time}` : n.body} last={i === a.length - 1} onPress={n.onPress}
          right={
            <View style={styles.rowEnd}>
              {!n.read ? <View style={styles.dot} accessibilityLabel="Unread" /> : null}
              <Ico name="right" size={22} color={C.muted} />
            </View>
          } />
      ))}
    </Group>
  );

  const canAssign = ctx.session.can('assign_work');
  return (
    <Screen header={<Header title="Inbox" />}>
      {accountActions.length ? (
        <>
          <SectionLabel label="Saved account changes" />
          <Group>
            {accountActions.map((a, i, all) => (
              <Row key={a.id} icon={a.status === 'failed' ? 'flag' : 'cloud'} iconColor={a.status === 'failed' ? TINT.redText : C.primary}
                label={a.kind === 'join_request' ? 'Access request' : a.kind === 'profile' ? 'Profile' : 'Onboarding'}
                sub={a.status === 'failed' ? `${a.error ?? 'Not accepted'} · Tap to try again` : 'Waiting to send'}
                badge={a.status === 'failed' ? 'Not sent' : 'Saved'} last={i === all.length - 1}
                onPress={a.status === 'failed' ? () => { void accountOutbox(me).retry(a.id); } : undefined} />
            ))}
          </Group>
        </>
      ) : null}
      {unread.length ? (
        <>
          <SectionLabel label={`Unread (${unread.length.toLocaleString('en-US')})`} />
          {list(unread, shownUnread)}
          <ShowMore remaining={unread.length - shownUnread} step={INBOX_STEP} onMore={() => setShownUnread(shownUnread + INBOX_STEP)} />
        </>
      ) : null}
      {earlier.length ? (
        <>
          <SectionLabel label="Earlier" />
          {list(earlier, shownEarlier)}
          <ShowMore remaining={earlier.length - shownEarlier} step={INBOX_STEP} onMore={() => setShownEarlier(shownEarlier + INBOX_STEP)} />
        </>
      ) : null}
      {!items.length ? <EmptyState icon="inbox" title="Nothing yet" sub="Requests and feedback about your passages show up here." /> : null}

      <Sheet visible={!!openRequest} title="Join request" sub={openRequest ? new Date(openRequest.createdAt).toLocaleString() : undefined}
        onClose={() => setOpenRequest(null)}
        footer={openRequest ? (
          <>
            {canAssign ? (
              <PrimaryBtn label="Assign role & accept" icon="check" onPress={() => {
                const r = openRequest;
                setOpenRequest(null);
                ctx.go('edit_member', { memberId: r.profileId, requestId: r.id });
              }} />
            ) : null}
            <GhostBtn label="Decline" tone="red" disabled={declining} onPress={() => void decline(openRequest)} />
          </>
        ) : undefined}>
        {openRequest ? (
          <View style={styles.requestBody}>
            <Text style={txt.body}>
              {names[openRequest.profileId] ?? personLook(openRequest.profileId).name} asked to join {orgName}. Assign a role to give them access.
            </Text>
            {openRequest.message ? <Text style={[txt.sm, { fontStyle: 'italic' }]}>"{openRequest.message}"</Text> : null}
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

// ---- Settings (AUTH-7, AUTH-8, ONB-2, ONB-5) ------------------------------------------------------

/** Account and app rows only; everything about running the org lives under Manage. */
export function SettingsHome(ctx: Ctx) {
  const [notificationMessage, setNotificationMessage] = useState('');
  const names = useDisplayNames(ctx.session.actorId);
  const s = ctx.session;
  const { roleName, orgName, memberName } = useAccountLine(ctx);
  const name = names[s.actorId] ?? memberName ?? s.email?.split('@')[0] ?? 'You';
  const p = ctx.project;
  const syncSub = p.refused ? 'This account cannot sync this project'
    : p.pending > 0 ? `${p.pending.toLocaleString('en-US')} ${p.pending === 1 ? 'change' : 'changes'} waiting to send`
    : p.live ? 'Live: changes arrive as they happen'
    : p.online === false ? 'Offline: work is kept on this phone'
    : p.lastSync ? `Last synced ${p.lastSync}` : 'Everything is saved on this phone';
  return (
    <Screen header={<Header title="Settings" />}>
      <Card>
        <View style={styles.profile}>
          <PersonAvatar look={personLook(s.actorId, name)} size={52} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={txt.h3} numberOfLines={1}>{name}</Text>
            <Text style={[txt.xs, !s.email && { color: TINT.amberText }]} numberOfLines={1}>{s.email ?? 'No email linked'}</Text>
            <Text style={[txt.xs, { color: C.primary, fontWeight: '600' }]} numberOfLines={1}>{roleName} · {orgName}</Text>
          </View>
        </View>
      </Card>
      <SectionLabel label="Account" />
      <Group>
        <Row icon="user" label="Edit Profile" onPress={() => ctx.go('profile_edit')} />
        <Row icon="building" label="Switch Organization" sub={`${orgName} (active)`} onPress={() => ctx.go('org_switcher')} last />
      </Group>
      <SectionLabel label="App" />
      <Group>
        {homeScreenFor(s) === 'my_work' ? (
          <Row icon="play" label="Getting started" sub="Your first-day checklist" onPress={() => ctx.go('my_work', { showGettingStarted: '1' })} />
        ) : null}
        <Row icon="book" label="What is LangQuest?" onPress={() => ctx.go('vision')} />
        <Row icon="notif" label="Notification Settings" sub={notificationMessage || 'Hear about requests and feedback'} onPress={() => {
          void enableNotifications().then(() => setNotificationMessage('Notifications are on.')).catch((e: Error) => setNotificationMessage(e.message));
        }} />
        <Row icon="cloud" label="Sync" sub={syncSub} badge={p.pending > 0 ? String(p.pending) : undefined} onPress={() => ctx.go('sync_status')} last />
      </Group>
      {ctx.canSwitchPersona ? (
        <>
          <SectionLabel label="Testing" />
          <Group>
            <Row icon="people" label="Switch persona" sub="Sign in as a demo translator, reviewer or admin" onPress={ctx.openDev} last />
          </Group>
        </>
      ) : null}
      <View style={{ paddingTop: space.md }}>
        <GhostBtn label="Sign Out" tone="red" onPress={() => ctx.go('sign_out_confirm')} />
      </View>
    </Screen>
  );
}

// ---- Edit Profile (AUTH-7) ------------------------------------------------------------------------------

/** Your name, saved on this phone and sent when connected. */
export function ProfileEdit(ctx: Ctx) {
  const names = useDisplayNames(ctx.session.actorId);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const actions = useAccountActions(ctx.session.actorId);
  const pending = actions.filter((a) => a.kind === 'profile' && a.status !== 'sent').at(-1);
  const value = name ?? String(pending?.payload.displayName ?? names[ctx.session.actorId] ?? '');
  async function save() {
    setBusy(true);
    setError('');
    try {
      await queueAccountAction(ctx.session.actorId, 'profile', { displayName: value.trim() });
      ctx.toast('Profile saved. It syncs when you are connected.');
      ctx.back();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <Screen
      header={<Header title="Edit Profile" onBack={ctx.back} />}
      footer={<PrimaryBtn label="Save Profile" onPress={() => void save()} disabled={!value.trim()} busy={busy} />}
    >
      <View style={styles.avatarBlock}>
        <PersonAvatar look={personLook(ctx.session.actorId, value)} size={72} />
      </View>
      <Field label="Full Name" value={value} onChangeText={setName} placeholder="Your name" autoCapitalize="words" />
      <View style={{ gap: space.xs }}>
        <Text style={txt.xsStrong}>Email</Text>
        <Text style={txt.body}>{ctx.session.email ?? 'No email linked'}</Text>
      </View>
      {pending?.status === 'failed' ? <Banner icon="flag" tone="amber" title="Your last change was not accepted" body={pending.error} /> : null}
      {pending?.status === 'queued' ? <Banner icon="cloud" title="Saved on this phone" body="It sends when you are connected." /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Screen>
  );
}

// ---- Switch Organization (AUTH-8) --------------------------------------------------------------------------

export function OrgSwitcher(ctx: Ctx) {
  const [rows, setRows] = useState<{ org_id: string; project_id: string | null; name: string }[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const key = `organizations:${ctx.session.actorId}`;
    void (async () => {
      const cached = JSON.parse(await AsyncStorage.getItem(key) ?? '[]');
      if (active) setRows(cached);
      const { data, error } = await supabase.rpc('my_organizations');
      if (error) { if (active) setError('Unable to refresh. Saved organizations remain available.'); return; }
      await AsyncStorage.setItem(key, JSON.stringify(data));
      if (active) setRows(data ?? []);
    })().catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [ctx.session.actorId]);
  return (
    <Screen header={<Header title="Switch Organization" onBack={ctx.back} />}>
      {error ? <Banner icon="cloud" tone="amber" title={error} /> : null}
      {rows.map((r) => {
        const active = r.org_id === ctx.project.orgId && (!r.project_id || r.project_id === ctx.project.projectId);
        return (
          <Card key={`${r.org_id}:${r.project_id}`} accessibilityLabel={active ? `${r.name}, active` : r.name}
            onPress={() => void ctx.openOrganization(r.org_id, r.project_id ?? 'unselected').catch((e: Error) => setError(e.message))}>
            <View style={styles.profile}>
              <View style={styles.tile}><Ico name="building" size={24} color={active ? C.primary : C.muted} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[txt.body, { fontWeight: '600' }]} numberOfLines={1}>{r.name}</Text>
                {r.project_id ? <Text style={txt.xs} numberOfLines={1}>{r.project_id}</Text> : null}
              </View>
              {active ? <View style={styles.check}><Ico name="check" size={16} color={C.white} strokeWidth={3} /></View> : null}
            </View>
          </Card>
        );
      })}
      {!rows.length && !error ? <EmptyState icon="building" title="Loading your organizations…" /> : null}
    </Screen>
  );
}

// ---- Sign Out (AUTH-8, CORE-12) -----------------------------------------------------------------------------

/**
 * One rule, and the screen says it: signing out is refused only while this
 * device holds queued events that this session can still deliver (PLAN.md
 * invariant 1: no event is ever lost). Offline with nothing queued is fine,
 * and so is a server refusal: those events can never go out under this
 * session, so they stay in the local log and go out if this account signs
 * in again here with membership.
 */
export function SignOutConfirm(ctx: Ctx) {
  const { pending, online, refused } = ctx.project;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try {
      await unregisterNotifications();
      const result = await supabase.auth.signOut();
      if (result.error) throw result.error;
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  const blocked = pending > 0 && !refused;
  const why = blocked
    ? `${pending} ${pending === 1 ? 'change is' : 'changes are'} waiting to send${online === false ? ', and this phone is offline' : ''}. Sign out once they have synced so they are not stranded here.`
    : refused
      ? 'This account cannot sync this project: the server refused it. Signing out is safe; anything queued stays on this phone.'
      : 'You can sign back in anytime.';
  return (
    <Screen bodyStyle={styles.centered}
      footer={
        <>
          <PrimaryBtn label={busy ? 'Signing out…' : 'Sign Out'} tone="red" onPress={() => void signOut()} disabled={blocked || busy} />
          <GhostBtn label="Cancel" onPress={ctx.back} />
        </>
      }>
      <View style={[styles.bigTile, { backgroundColor: blocked ? TINT.amber : TINT.red }]}>
        <Ico name={blocked ? 'cloud' : 'user'} size={32} color={blocked ? TINT.amberText : C.red} />
      </View>
      <Text style={[txt.h2, { textAlign: 'center' }]} accessibilityRole="header">{blocked ? 'Not yet' : 'Sign out?'}</Text>
      <Text style={[txt.bodyMuted, { textAlign: 'center' }]}>{why}</Text>
      {error ? <Text style={[styles.error, { textAlign: 'center' }]}>{error}</Text> : null}
    </Screen>
  );
}

// ---- Sync (app only) ---------------------------------------------------------------------------------------------

/**
 * What the phone holds and where it is going: the channel, the event queue,
 * audio transfer with speed and a bar, then the waiting and refused events
 * one line each so a developer can see the log move. Polled once a second.
 */
export function SyncStatus(ctx: Ctx) {
  const { project, org } = ctx;
  const [ins, setIns] = useState<SyncInspection | null>(null);
  const [orgIns, setOrgIns] = useState<SyncInspection | null>(null);
  const [rates, setRates] = useState({ up: 0, down: 0 });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const tick = () => {
      void project.inspect().then((i) => { if (alive) setIns(i); });
      void org.inspect().then((i) => { if (alive) setOrgIns(i); });
      setRates(project.blobs.rates());
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [project, org]);
  const offline = project.online === false;
  const pendingEvents = (ins?.pending.length ?? 0) + (orgIns?.pending.length ?? 0);
  const rejected = [...(ins?.rejected ?? []), ...(orgIns?.rejected ?? [])];
  const syncNow = async () => {
    setBusy(true);
    try { await Promise.all([project.sync(), org.sync()]); project.triggerUpload(); }
    finally { setBusy(false); }
  };
  return (
    <Screen header={<Header title="Sync" onBack={ctx.back} />}
      footer={<PrimaryBtn label={busy ? 'Syncing…' : 'Sync now'} icon="restart" onPress={() => void syncNow()} disabled={project.tooOld || busy} />}>
      <Banner icon="cloud" tone={project.live ? 'green' : offline ? 'amber' : 'brand'}
        title={project.live ? 'Live: changes arrive as they happen' : offline ? 'Offline: work is kept on this phone' : 'Checking for changes now and then'}
        body={project.refused ?? (project.tooOld ? 'Update the app to sync.' : undefined)} />
      <View style={styles.tiles}>
        <Stat icon="up" color={pendingEvents ? C.primary : C.green} value={pendingEvents} label="waiting to upload" />
        <Stat icon="flag" color={rejected.length ? TINT.redText : C.muted} value={rejected.length} label="refused by the server" />
        <Stat icon="check" color={C.green} value={ins?.cursor ?? 0} label="latest confirmed" />
        <Stat icon="layers" color={C.muted} value={ins?.checkpointSeq ?? 0} label="local checkpoint" />
      </View>
      <Transfer icon="up" pending={project.blobs.pendingUp} peak={project.blobs.peakUp} rate={rates.up} label="Audio uploading" />
      <Transfer icon="download" pending={project.blobs.pendingDown} peak={project.blobs.peakDown} rate={rates.down} label="Audio downloading" />
      {ins && ins.pending.length ? (
        <>
          <SectionLabel label={`Waiting · ${ins.pending.length}`} />
          <Group>
            {ins.pending.slice(0, 20).map((l, i, a) => (
              <Row key={l.event.id} icon="cloud" label={l.event.type.replace(/^v\d\./, '')} sub={clock(l.event.hlc)} last={i === a.length - 1} />
            ))}
          </Group>
        </>
      ) : null}
      {rejected.length ? (
        <>
          <SectionLabel label={`Refused · ${rejected.length}`} />
          <Group>
            {rejected.slice(0, 20).map((l, i, a) => (
              <Row key={l.event.id} icon="flag" iconColor={TINT.redText} label={l.event.type.replace(/^v\d\./, '')} sub={l.rejectReason ?? clock(l.event.hlc)} last={i === a.length - 1} />
            ))}
          </Group>
        </>
      ) : null}
      <Text style={[txt.xs, { textAlign: 'center' }]}>{ins ? `${ins.total.toLocaleString('en-US')} events on this phone` : ''}</Text>
      <Text style={[txt.xs, { textAlign: 'center' }]} selectable>
        {runningBuildLabel({ updateId: Updates.updateId ?? undefined, createdAt: Updates.createdAt ?? undefined, isEmbeddedLaunch: Updates.isEmbeddedLaunch })}
      </Text>
    </Screen>
  );
}

function clock(hlc: string): string {
  try { return new Date(decodeHlc(hlc).wallMs).toLocaleTimeString(); } catch { return ''; }
}

function Stat(props: { icon: IconName; color: string; value: number; label: string }) {
  return (
    <View style={styles.tile2} accessible accessibilityLabel={`${props.value} ${props.label}`}>
      <Ico name={props.icon} size={24} color={props.color} />
      <Text style={[styles.statValue, { color: props.color }]}>{props.value.toLocaleString('en-US')}</Text>
      <Text style={[txt.xs, { textAlign: 'center' }]}>{props.label}</Text>
    </View>
  );
}

function Transfer(props: { icon: IconName; pending: number; peak: number; rate: number; label: string }) {
  const total = Math.max(props.peak, props.pending);
  const done = total - props.pending;
  const idle = props.pending === 0;
  return (
    <Card accessibilityLabel={idle ? `${props.label}: nothing` : `${props.label}: ${done} of ${total}, ${speed(props.rate)}`}>
      <View style={styles.profile}>
        <Ico name={props.icon} size={22} color={idle ? C.muted : C.primary} />
        <Text style={[txt.sm, { flex: 1, fontWeight: '600' }]}>{props.label}</Text>
        {idle ? <Badge label="Up to date" tone="green" /> : <Text style={txt.xs}>{props.pending} left · {speed(props.rate)}</Text>}
      </View>
      {idle ? null : <ProgressBar value={total ? (done / total) * 100 : 100} />}
    </Card>
  );
}

function speed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}

const styles = StyleSheet.create({
  rowEnd: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.primary },
  requestBody: { backgroundColor: C.light, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  tile: { width: 48, height: 48, borderRadius: 16, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  check: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  avatarBlock: { alignItems: 'center', paddingVertical: space.md },
  error: { fontSize: 15, color: TINT.redText, lineHeight: 21 },
  centered: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl, gap: space.lg },
  bigTile: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile2: { width: '47%', flexGrow: 1, alignItems: 'center', gap: space.xs, paddingVertical: space.lg, paddingHorizontal: space.sm, borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, backgroundColor: C.card },
  statValue: { fontSize: 22, fontWeight: '700' }
});

export const contracts = contractsFor('inbox_home', 'settings_home', 'profile_edit', 'org_switcher', 'sign_out_confirm', 'sync_status');
