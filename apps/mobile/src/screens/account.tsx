// Avatar P for inbox and settings; sign_out_confirm is Avatar U (one action, guarded, and it says what the guard is).
import { decodeHlc, deriveInbox } from '@langquest-next/core';
import { indexesFor } from '../indexes';
import type { SyncInspection } from '@langquest-next/client';
import { AlertCircle, ArrowDown, ArrowUp, Check, Cloud, CloudOff, CloudUpload, Database, LogOut, Radio, RefreshCw, User, Users } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { Ctx } from '../ctx';
import { Footer, Header, Note, NotWired, Row, Screen, Section } from '../pui';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cachedInbox, refreshInbox, enableNotifications, unregisterNotifications, type RemoteNotification } from '../notifications';
import { accountOutbox, queueAccountAction } from '../accountData';
import { useAccountActions, useDisplayNames } from '../useAccount';
import { supabase } from '../supabase';
import { colors, space } from '../theme';
import { ActionButton, Card, text } from '../ui';
import * as Updates from 'expo-updates';
import { runningBuildLabel } from '../updateStatus';

/** Notifications are derived: your open tasks, and decisions on your takes. */
export function InboxHome(ctx: Ctx) {
  const { state } = ctx.project;
  const me = ctx.session.actorId;
  const accountActions = useAccountActions(me).filter((a) => a.status !== 'sent');
  const localItems = state ? deriveInbox(state, me, indexesFor(state)) : [];
  const [remote, setRemote] = useState<RemoteNotification[]>([]);
  const [read, setRead] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    void (async () => {
      const [cached, seen] = await Promise.all([cachedInbox(me), AsyncStorage.getItem(`inbox-read:${me}`)]);
      if (active) { setRemote(cached); setRead(JSON.parse(seen ?? '[]')); }
      const rows = await refreshInbox(me);
      if (active) setRemote(rows);
    })().catch(() => {});
    return () => { active = false; };
  }, [me]);
  async function openRemote(row: RemoteNotification) {
    const next = [...new Set([...read, row.id])];
    await AsyncStorage.setItem(`inbox-read:${me}`, JSON.stringify(next));
    setRead(next);
    if (row.org_id !== ctx.project.orgId || (row.project_id !== '_org' && row.project_id !== ctx.project.projectId)) {
      await ctx.openOrganization(row.org_id, row.project_id === '_org' ? undefined : row.project_id);
    } else if (row.kind === 'join_request') ctx.go('members_list');
    else ctx.go('status_home');
  }
  return (
    <Screen>
      <Header title="Inbox" />
      {accountActions.length ? <Section label="Saved account changes">
        {accountActions.map((a) => <Row key={a.id}
          label={a.kind === 'join_request' ? 'Access request' : a.kind === 'profile' ? 'Profile' : 'Onboarding'}
          sub={a.error ?? 'Waiting to send'} badge={a.status}
          onPress={a.status === 'failed' ? () => { void accountOutbox(me).retry(a.id); } : undefined} />)}
      </Section> : null}
      <Section label="Your work">
        {!localItems.length ? <Row label="Nothing waiting" last /> : null}
        {localItems.map((item) => <Row key={item.id} label={item.title}
          badge={item.kind} onPress={() => ctx.go('status_home')} />)}
      </Section>
      <Section label="Organization updates">
        {remote.filter((r) => r.kind === 'join_request' || r.org_id !== ctx.project.orgId || r.project_id !== ctx.project.projectId)
          .map((row) => <Row key={row.id} label={row.title} badge={read.includes(row.id) ? undefined : 'new'}
            onPress={() => void openRemote(row)} />)}
      </Section>
    </Screen>
  );
}

export function SettingsHome(ctx: Ctx) {
  const [notificationMessage, setNotificationMessage] = useState('');
  const names = useDisplayNames(ctx.session.actorId);
  const s = ctx.session;
  return (
    <Screen>
      <Header title="Settings" />
      <Card>
        <Text style={text.h4}>{names[s.actorId] ?? s.email ?? s.actorId.slice(0, 8)}</Text>
        <Text style={text.muted}>{s.role ?? 'not a member'} · {ctx.org.state?.org?.value.name ?? ctx.project.orgId}</Text>
      </Card>
      <Section label="Account">
        <Row icon={User} label="Edit profile" onPress={() => ctx.go('profile_edit')} />
        <Row icon={Users} label="Switch organization" sub={ctx.org.state?.org?.value.name ?? ctx.project.orgId} onPress={() => ctx.go('org_switcher')} last />
      </Section>
      <Section label="App">
        <Row icon={Radio} label="Enable notifications" onPress={() => {
          void enableNotifications().then(() => setNotificationMessage('Notifications enabled.')).catch((e) => setNotificationMessage(e.message));
        }} />
        {notificationMessage ? <Note>{notificationMessage}</Note> : null}
        <Row icon={Cloud} label="Sync" sub={ctx.project.live ? 'live' : ctx.project.lastSync} onPress={() => ctx.go('sync_status')} />
        <Row icon={LogOut} label="Sign out" onPress={() => ctx.go('sign_out_confirm')} last />
      </Section>
      {ctx.canSwitchPersona ? (
        <Section label="Testing">
          <Row label="Switch persona" sub="sign in as a demo translator, reviewer or coordinator" onPress={ctx.openDev} last />
        </Section>
      ) : null}
    </Screen>
  );
}

export function ProfileEdit(ctx: Ctx) {
  const names = useDisplayNames(ctx.session.actorId);
  const [name, setName] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const actions = useAccountActions(ctx.session.actorId);
  const pending = actions.filter((a) => a.kind === 'profile' && a.status !== 'sent').at(-1);
  const value = name ?? String(pending?.payload.displayName ?? names[ctx.session.actorId] ?? '');
  async function save() {
    setBusy(true);
    try {
      await queueAccountAction(ctx.session.actorId, 'profile', { displayName: value.trim() });
      setMessage('Saved on this device. Your profile syncs when connected.');
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <Screen footer={<Footer label="Save profile" onPress={() => void save()} disabled={busy || !value.trim()} />}>
      <Header title="Profile" onBack={ctx.back} />
      <TextInput accessibilityLabel="Display name" placeholder="Your name"
        value={value} onChangeText={setName} maxLength={100}
        style={{ padding: space.md, backgroundColor: colors.card }} />
      {message ? <Note>{message}</Note> : null}
      {pending?.error ? <Note>{pending.error}</Note> : null}
    </Screen>
  );
}

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
    <Screen>
      <Header title="Organizations" onBack={ctx.back} />
      <Section label="Your organizations">
        {rows.map((r) => <Row key={`${r.org_id}:${r.project_id}`} label={r.name}
          sub={r.project_id ?? undefined}
          badge={r.org_id === ctx.project.orgId ? 'active' : undefined}
          onPress={() => void ctx.openOrganization(r.org_id, r.project_id ?? 'unselected').catch((e) => setError(e.message))} />)}
      </Section>
      {error ? <Note>{error}</Note> : null}
    </Screen>
  );
}

/**
 * Avatar U. One rule, and the screen says it: signing out is refused only
 * while this device holds queued events that this session can still deliver
 * (PLAN.md invariant 1 — no event is ever lost). Two things that used to
 * block it no longer do:
 *
 * - Offline with nothing queued: there is nothing to lose.
 * - A server refusal (this account is not a member): those events can never
 *   go out under this session, so trapping the user achieves nothing. They
 *   stay in the local log either way and go out if this account signs in
 *   again here with membership.
 */
export function SignOutConfirm(ctx: Ctx) {
  const { pending, online, refused } = ctx.project;
  const [error, setError] = useState('');
  async function signOut() {
    try { await unregisterNotifications(); const result = await supabase.auth.signOut(); if (result.error) throw result.error; }
    catch (e) { setError((e as Error).message); }
  }
  const blocked = pending > 0 && !refused;
  const why = blocked
    ? `${pending} ${pending === 1 ? 'change is' : 'changes are'} waiting to send${online === false ? ', and this device is offline' : ''}. Sign out once they have synced so they are not stranded on this device.`
    : refused
      ? 'This account cannot sync this project: the server refused it. Signing out is safe — anything queued stays on this device.'
      : 'Signed-in work is synced. Signing out keeps everything already on this device.';
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.xl, backgroundColor: colors.background }}>
      <View style={{ alignItems: 'center', gap: space.md }}>
        {blocked ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <CloudUpload size={40} color={colors.reference} />
            <Text style={text.h3}>{pending}</Text>
          </View>
        ) : refused ? (
          <CloudOff size={40} color={colors.reference} />
        ) : (
          <LogOut size={48} color={colors.mutedForeground} />
        )}
        <Text style={[text.muted, { textAlign: 'center' }]}>{why}</Text>
      </View>
      <View style={{ alignSelf: 'stretch', gap: space.sm }}>
        {error ? <Note>{error}</Note> : null}
        <ActionButton icon={LogOut} accessibilityLabel="Sign out" onPress={() => void signOut()} disabled={blocked} />
        <ActionButton label="Cancel" accessibilityLabel="Cancel" variant="outline" onPress={ctx.back} />
      </View>
    </View>
  );
}

/**
 * Avatar U. What the phone holds and where it is going, as icons and
 * numbers: the channel, the event queue, audio transfer with speed and a
 * bar, then the pending and refused events one line each so a developer
 * can see the log move. Polled once a second while open.
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
  const Channel = project.live ? Radio : offline ? CloudOff : Cloud;
  const channelColor = project.live ? colors.done : offline ? colors.reference : colors.mutedForeground;
  const channelLabel = project.live ? 'Live: changes arrive as they happen' : offline ? 'Offline: work is kept on this phone' : 'Polling';
  const pendingEvents = (ins?.pending.length ?? 0) + (orgIns?.pending.length ?? 0);
  const rejected = [...(ins?.rejected ?? []), ...(orgIns?.rejected ?? [])];
  const syncNow = async () => {
    setBusy(true);
    try { await Promise.all([project.sync(), org.sync()]); project.triggerUpload(); }
    finally { setBusy(false); }
  };
  return (
    <Screen footer={<ActionButton icon={RefreshCw} accessibilityLabel="Sync now" onPress={() => void syncNow()} disabled={busy || project.tooOld} />}>
      <Header title="" onBack={ctx.back} />
      <View style={sync.hero} accessible accessibilityLabel={channelLabel}>
        <Channel size={56} color={channelColor} />
        {project.refused ? <Text style={[text.small, { color: colors.reference }]}>{project.refused}</Text> : null}
        {project.tooOld ? <Text style={[text.small, { color: colors.reference }]}>Update the app to sync</Text> : null}
      </View>
      <View style={sync.tiles}>
        <Stat icon={ArrowUp} color={pendingEvents ? colors.translate : colors.done} value={pendingEvents} label="events waiting to upload" />
        <Stat icon={AlertCircle} color={rejected.length ? colors.reference : colors.mutedForeground} value={rejected.length} label="events refused by the server" />
        <Stat icon={Check} color={colors.done} value={ins?.cursor ?? 0} label="latest confirmed event" />
        <Stat icon={Database} color={colors.mutedForeground} value={ins?.checkpointSeq ?? 0} label="local checkpoint" />
      </View>
      <Transfer icon={ArrowUp} color={colors.translate} pending={project.blobs.pendingUp} peak={project.blobs.peakUp} rate={rates.up} label="audio uploading" />
      <Transfer icon={ArrowDown} color={colors.review} pending={project.blobs.pendingDown} peak={project.blobs.peakDown} rate={rates.down} label="audio downloading" />
      {ins && ins.pending.length ? (
        <Section label={`Waiting · ${ins.pending.length}`}>
          {ins.pending.slice(0, 20).map((l, i, a) => (
            <Row key={l.event.id} icon={CloudUpload} label={l.event.type.replace(/^v1\./, '')} sub={when(l.event.hlc)} last={i === a.length - 1} />
          ))}
        </Section>
      ) : null}
      {rejected.length ? (
        <Section label={`Refused · ${rejected.length}`}>
          {rejected.slice(0, 20).map((l, i, a) => (
            <Row key={l.event.id} icon={AlertCircle} label={l.event.type.replace(/^v1\./, '')} sub={l.rejectReason ?? when(l.event.hlc)} last={i === a.length - 1} />
          ))}
        </Section>
      ) : null}
      <Text style={[text.small, { textAlign: 'center' }]}>{ins ? `${ins.total} events on this phone` : ''}</Text>
      <Text style={[text.small, { textAlign: 'center' }]} selectable>
        {runningBuildLabel({ updateId: Updates.updateId ?? undefined, createdAt: Updates.createdAt ?? undefined, isEmbeddedLaunch: Updates.isEmbeddedLaunch })}
      </Text>
    </Screen>
  );
}

function when(hlc: string): string {
  try { return new Date(decodeHlc(hlc).wallMs).toLocaleTimeString(); } catch { return ''; }
}

function Stat(props: { icon: typeof ArrowUp; color: string; value: number; label: string }) {
  const Icon = props.icon;
  return (
    <View style={sync.tile} accessible accessibilityLabel={`${props.value} ${props.label}`}>
      <Icon size={26} color={props.color} />
      <Text style={[sync.value, { color: props.color }]}>{props.value}</Text>
    </View>
  );
}

function Transfer(props: { icon: typeof ArrowUp; color: string; pending: number; peak: number; rate: number; label: string }) {
  const Icon = props.icon;
  const total = Math.max(props.peak, props.pending);
  const done = total - props.pending;
  const fraction = total ? done / total : 1;
  const idle = props.pending === 0;
  return (
    <View style={sync.transfer} accessible accessibilityLabel={idle ? `No ${props.label}` : `${done} of ${total} ${props.label}, ${speed(props.rate)}`}>
      <Icon size={22} color={idle ? colors.mutedForeground : props.color} />
      <View style={sync.bar}>
        <View style={[sync.fill, { width: `${fraction * 100}%`, backgroundColor: idle ? colors.border : props.color }]} />
      </View>
      <Text style={[text.small, sync.speed]}>{idle ? `${total || ''}` : `${props.pending} · ${speed(props.rate)}`}</Text>
    </View>
  );
}

function speed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}

const sync = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: { width: '47%', flexGrow: 1, alignItems: 'center', gap: space.xs, paddingVertical: space.lg, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  value: { fontSize: 22, fontWeight: '700' },
  transfer: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  bar: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.muted, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  speed: { minWidth: 72, textAlign: 'right' }
});

import { contractsFor } from '../screenContracts';
export const contracts = contractsFor('inbox_home', 'settings_home', 'profile_edit', 'org_switcher', 'sign_out_confirm', 'sync_status');
