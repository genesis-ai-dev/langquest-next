// Avatar P for inbox and settings; sign_out_confirm is Avatar U (one action, guarded, and it says what the guard is).
import { CloudOff, CloudUpload, LogOut, RefreshCw, User, Users } from 'lucide-react-native';
import { Text, View } from 'react-native';
import type { Ctx } from '../ctx';
import { Footer, Header, Note, NotWired, Row, Screen, Section } from '../pui';
import { supabase } from '../supabase';
import { colors, space } from '../theme';
import { ActionButton, Card, text } from '../ui';

/** 
 * Avatar P: admin notification centre (join requests + decisions on takes).
 * Unlike My Work, Inbox does NOT show the task list — that duplication was
 * the P0 confusion. Inbox shows only notifications addressed to this actor.
 */
export function InboxHome(ctx: Ctx) {
  const { state } = ctx.project;
  const me = ctx.session.actorId;
  const decisions = state
    ? Object.entries(state.takes)
        .filter(([, t]) => t.actorId === me)
        .flatMap(([takeId, t]) =>
          Object.entries(state.reviews[takeId] ?? {}).flatMap(([stepId, byActor]) =>
            Object.entries(byActor).map(([actor, r]) => ({ 
              id: `${takeId}:${stepId}:${actor}`, 
              takeId,
              unitId: t.unitId,
              laneId: t.laneId,
              unit: state.units[t.unitId]?.label ?? t.unitId, 
              stepId, 
              decision: r.value.decision, 
              actor 
            }))
          )
        )
    : [];
  return (
    <Screen>
      <Header title="Inbox" />
      <Section label={`Decisions on your takes · ${decisions.length}`}>
        {decisions.length === 0 ? <Row label="None yet" last /> : null}
        {decisions.map((d, i) => (
          <Row 
            key={d.id} 
            label={`${d.unit} · ${d.stepId}`} 
            sub={`${d.actor.slice(0, 8)}`} 
            badge={d.decision === 'approve' ? 'approved' : 'suggestions'} 
            onPress={() => ctx.go('piece_review', { takeId: d.takeId, stepId: d.stepId, actorId: d.actor })}
            last={i === decisions.length - 1} 
          />
        ))}
      </Section>
      <Note>Join requests and other org notifications will appear here once the notification worker is built.</Note>
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
