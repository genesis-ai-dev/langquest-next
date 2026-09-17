// Avatar P for inbox and settings; sign_out_confirm is Avatar U (one action, guarded, and it says what the guard is).
import { decodeHlc, deriveTasks } from '@langquest-next/core';
import type { SyncInspection } from '@langquest-next/client';
import { AlertCircle, ArrowDown, ArrowUp, Check, Cloud, CloudOff, CloudUpload, Database, LogOut, Radio, RefreshCw, User, Users } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Ctx } from '../ctx';
import { Footer, Header, Note, NotWired, Row, Screen, Section } from '../pui';
import { supabase } from '../supabase';
import { colors, space } from '../theme';
import { ActionButton, Card, text } from '../ui';

/** Notifications are derived: your open tasks, and decisions on your takes. */
export function InboxHome(ctx: Ctx) {
  const { state } = ctx.project;
  const me = ctx.session.actorId;
  const tasks = state ? deriveTasks(state, me).filter((t) => t.status !== 'done') : [];
  const decisions = state
    ? Object.entries(state.takes)
        .filter(([, t]) => t.actorId === me)
        .flatMap(([takeId, t]) =>
          Object.entries(state.reviews[takeId] ?? {}).flatMap(([stepId, byActor]) =>
            Object.entries(byActor).map(([actor, r]) => ({ id: `${takeId}:${stepId}:${actor}`, unit: state.units[t.unitId]?.label ?? t.unitId, stepId, decision: r.value.decision, actor }))
          )
        )
    : [];
  return (
    <Screen>
      <Header title="Inbox" />
      <Section label={`To do · ${tasks.length}`}>
        {tasks.length === 0 ? <Row label="Nothing waiting" last /> : null}
        {tasks.map((t, i) => (
          <Row key={t.id} label={`${t.type}: ${state?.units[t.unitId]?.label ?? t.unitId}`} sub={t.dueDate ? `Due ${t.dueDate}` : undefined} onPress={() => ctx.go(t.type === 'review' ? 'review_passage' : 'translate_passage', { taskId: t.id })} last={i === tasks.length - 1} />
        ))}
      </Section>
      <Section label={`Decisions on your takes · ${decisions.length}`}>
        {decisions.length === 0 ? <Row label="None yet" last /> : null}
        {decisions.map((d, i) => (
          <Row key={d.id} label={`${d.unit} · ${d.stepId}`} sub={`${d.actor.slice(0, 8)}`} badge={d.decision === 'approve' ? 'approved' : 'suggestions'} last={i === decisions.length - 1} />
        ))}
      </Section>
    </Screen>
  );
}

export function SettingsHome(ctx: Ctx) {
  const s = ctx.session;
  return (
    <Screen>
      <Header title="Settings" />
      <Card>
        <Text style={text.h4}>{s.email ?? s.actorId.slice(0, 8)}</Text>
        <Text style={text.muted}>{s.role ?? 'not a member'} · org1</Text>
      </Card>
      <Section label="Account">
        <Row icon={User} label="Edit profile" onPress={() => ctx.go('profile_edit')} />
        <Row icon={Users} label="Switch organization" sub="org1 (active)" onPress={() => ctx.go('org_switcher')} last />
      </Section>
      <Section label="App">
        <Row icon={Cloud} label="Sync" sub={ctx.project.live ? 'live' : ctx.project.lastSync} onPress={() => ctx.go('sync_status')} />
        <Row icon={RefreshCw} label="Replay organization walkthrough" onPress={() => ctx.go('walkthrough')} />
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
  return (
    <Screen footer={<Footer label="Save profile" onPress={ctx.back} disabled />}>
      <Header title="Profile" onBack={ctx.back} />
      <NotWired what="Profile names and photos" />
    </Screen>
  );
}

export function OrgSwitcher(ctx: Ctx) {
  return (
    <Screen>
      <Header title="Organizations" onBack={ctx.back} />
      <Section label="Your organizations">
        <Row label="org1" badge="active" last />
      </Section>
      <Note>Multiple organizations come with org-level membership.</Note>
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
        <ActionButton icon={LogOut} accessibilityLabel="Sign out" onPress={() => void supabase.auth.signOut()} disabled={blocked} />
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
