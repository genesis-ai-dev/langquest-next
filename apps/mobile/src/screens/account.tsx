// The Inbox and Settings tabs. Ports the demo's src/screens/account.tsx
// (InboxHomeScreen, SettingsHomeScreen, ProfileEditScreen,
// OrgSwitcherScreen, SignOutConfirmScreen); SyncStatus is app only (the
// local log, realtime state and transfers), as are the Send diagnostics
// switch in Settings (docs/diagnostics.md), Delete Account (store
// rules, decisions.md 46), and reports in the Inbox and Blocked people in
// Settings (store rules, decisions.md 48).
// Requirements INBOX-1, INBOX-2, AUTH-7, AUTH-8, ONB-2 and ONB-5 (the
// Settings rows back to them), CORE-12 (sign-out never strands work).
import { signInName } from '../accounts';
import { readHelp, type SignInHelp } from '../signInHelp';
import { CommandError, decodeHlc, deriveKinds, kindOf, laneName, unitTitle, type Update } from '@langquest-next/core';
import type { SyncInspection } from '@langquest-next/client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { accountOutbox, queueAccountAction } from '../accountData';
import { deleteAccount } from '../accountDeletion';
import { groupByRead, updateText } from '../accountText';
import type { Ctx } from '../ctx';
import { OfflineCard, offlineLine, useOfflineSummary } from '../offline';
import { diagnosticsEnabled, setDiagnosticsEnabled } from '../diagnostics';
import { groupReports, reasonLabel, reportSummary, reportTitle, type ReportGroup } from '../moderation';
import { openReports } from '../moderationData';
import { decideRequest, pendingRequests, type PendingRequest } from '../invites';
import {
  Badge, Banner, Card, Disclosure, EmptyState, Field, GhostBtn, Group, Header, Ico, PrimaryBtn, ProgressBar, Row, Screen,
  SectionLabel, Sheet, ShowMore, SmallBtn, txt, useLayout, useOpenDetail, type IconName
} from '../kit';
import { cachedInbox, enableNotifications, refreshInbox, unregisterNotifications, type RemoteNotification } from '../notifications';
import { dueText, plural, when } from '../passageView';
import { personLook } from '../people';
import { noteExpected, reportError, failureMessage } from '../report';
import { ReportActions } from '../reportSheet';
import { contractsFor } from '../screenContracts';
import { homeScreenFor } from '../session';
import { FORGETS_ON_SIGN_OUT, forgetThisBrowser } from '../forgetBrowser';
import { HANDS_OVER, signOutHandingOver } from '../handOver';
import { supabase } from '../supabase';
import { C, radius, space, tile, TINT, type as T } from '../theme';
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
  /** The passage it opens, so the row is marked while that passage shows beside the Inbox. */
  unitId?: string;
}

const INBOX_STEP = 25;

/**
 * What to say when something fails (error-tracking): a command's own reason,
 * or, for a fault, a code a tester can read out, having reported it.
 */
const failure = failureMessage;

/** The org's role and name for the signed-in person: "Translator · Wycliffe Associates". */
function useAccountLine(ctx: Ctx) {
  const org = ctx.org.state;
  const me = ctx.session.actorId;
  const mine = Object.values(org?.members[me] ?? {}).filter((m) => !m.removed.value);
  const roleName = mine.map((m) => org?.roles[m.roleId.value]?.name.value).find(Boolean)
    ?? (ctx.session.role ? ctx.session.role[0]!.toUpperCase() + ctx.session.role.slice(1) : 'No role yet');
  // Before the org's name has synced, a neutral phrase: never its id.
  const orgName = org?.org?.value.name ?? 'your organization';
  return { roleName, orgName, memberName: mine.find((m) => m.displayName)?.displayName };
}

/**
 * What happened that concerns you, grouped Unread / Earlier (INBOX-1): one
 * about a passage opens its record and is marked read. Join requests offer
 * Assign role & accept, or Decline (INBOX-2). Updates from another
 * organization open it.
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
    pendingRequests(orgId).then((rows) => { if (active) setRequests(rows); }).catch((e: unknown) => {
      // Offline: the server notifications below stand in for the list.
      noteExpected('inbox join requests', e);
      if (active) setRequests(null);
    });
    return () => { active = false; };
  }, [canAdmit, orgId, requestsTick]);
  const [openRequest, setOpenRequest] = useState<PendingRequest | null>(null);
  const [declining, setDeclining] = useState(false);

  // Open reports for those who act on them (decisions.md 48): content for
  // whoever manages the language, people for whoever admits members.
  // Needs the server; offline, the server notifications below stand in.
  const canModerate = ctx.session.can('manage_structure') || canAdmit;
  const [reports, setReports] = useState<ReportGroup[] | null>(null);
  const [reportsTick, setReportsTick] = useState(0);
  useEffect(() => {
    if (!canModerate) return;
    let active = true;
    openReports(orgId).then((rows) => { if (active) setReports(groupReports(orgId, rows)); }).catch((e: unknown) => {
      noteExpected('inbox reports', e);
      if (active) setReports(null);
    });
    return () => { active = false; };
  }, [canModerate, orgId, reportsTick]);
  const [openReport, setOpenReport] = useState<ReportGroup | null>(null);

  // Server notifications about other organizations (and join requests when the list above is unavailable).
  const [remote, setRemote] = useState<RemoteNotification[]>([]);
  const [remoteRead, setRemoteRead] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    void (async () => {
      const [cached, seen] = await Promise.all([cachedInbox(me), AsyncStorage.getItem(`inbox-read:${me}`)]);
      if (active) { setRemote(cached); setRemoteRead(JSON.parse(seen ?? '[]')); }
      const rows = await refreshInbox(me);
      if (active) setRemote(rows);
    })().catch((e: unknown) => {
      // Offline or the server is away: the saved notifications stay shown.
      noteExpected('inbox refresh', e);
    });
    return () => { active = false; };
  }, [me]);
  async function openRemote(row: RemoteNotification) {
    const next = [...new Set([...remoteRead, row.id])];
    setRemoteRead(next);
    // Losing the read mark costs only a dot shown again: report it, carry on.
    await AsyncStorage.setItem(`inbox-read:${me}`, JSON.stringify(next)).catch((e: unknown) => { reportError('inbox mark read', e); });
    if (row.org_id !== orgId) {
      await ctx.openOrganization(row.org_id)
        .catch((e: unknown) => ctx.toast(failure('inbox open organization', e)));
    } else if (row.kind === 'join_request') ctx.go('members_list');
    else if (row.kind === 'content_report') ctx.toast('Connect to the internet to see what was reported.');
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
  for (const g of reports ?? []) {
    const t = g.target;
    const where = t.unitId && state?.units[t.unitId] ? ` · ${unitTitle(state, t.unitId)}` : '';
    items.push({
      id: `report:${g.key}`, icon: 'flag', title: reportTitle(t, ctx.name), read: false,
      body: `${reportSummary(g)}${where}`, time: new Date(g.latest).toLocaleDateString(), onPress: () => setOpenReport(g)
    });
  }
  if (words) {
    for (const u of ctx.inbox.updates) {
      const w = words(u);
      items.push({
        id: u.id, icon: w.icon, title: w.title, body: w.body, time: when(u.hlc), read: ctx.inbox.isRead(u.id), unitId: u.unitId,
        onPress: () => { ctx.inbox.markRead([u.id]); ctx.openPassage(u.unitId, u.laneId); }
      });
    }
  }
  const seen = new Set(remoteRead);
  for (const row of remote) {
    const here = row.org_id === orgId;
    // This organization's updates are derived above, and its join requests and reports too once they are listed.
    if (here && row.kind === 'join_request' && (requests !== null || !(canAdmit && ctx.session.can('assign_work')))) continue;
    if (here && row.kind === 'content_report' && (reports !== null || !canModerate)) continue;
    if (here && row.kind !== 'join_request' && row.kind !== 'content_report') continue;
    items.push({
      id: `remote:${row.id}`, icon: row.kind === 'join_request' ? 'people' : row.kind === 'content_report' ? 'flag' : 'notif', title: row.title,
      body: !here ? 'In another organization. Opening it switches to it.'
        : row.kind === 'content_report' ? 'Connect to see what was reported.' : 'Open Members to assign a role.',
      read: seen.has(row.id), onPress: () => void openRemote(row)
    });
  }

  const { unread, earlier } = groupByRead(items, (i) => i.read);
  const beside = useOpenDetail();
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
      // Offline or refused: the server's answer says which.
      noteExpected('decline join request', e);
      ctx.toast(`Not declined: ${e instanceof Error ? e.message : 'try again when connected'}`);
    } finally {
      setDeclining(false);
    }
  }

  const list = (rows: InboxItem[], shown: number) => (
    <Group>
      {rows.slice(0, shown).map((n, i, a) => (
        <Row key={n.id} icon={n.icon} iconBg={n.read ? C.bg : C.light} label={n.title}
          sub={n.time ? `${n.body} · ${n.time}` : n.body} last={i === a.length - 1} onPress={n.onPress}
          current={!!n.unitId && beside?.screen === 'passage_record' && beside.params['unitId'] === n.unitId}
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
    // Reached from My Work's bell (no Inbox tab there): Back returns to it.
    <Screen header={<Header title="Inbox" {...(ctx.params['from'] === 'my_work' ? { onBack: ctx.back } : {})} />}>
      {accountActions.length ? (
        <>
          <SectionLabel label="Saved account changes" />
          <Group>
            {accountActions.map((a, i, all) => (
              <Row key={a.id} icon={a.status === 'failed' ? 'flag' : 'cloud'} iconColor={a.status === 'failed' ? TINT.redText : C.primary}
                label={a.kind === 'join_request' ? 'Access request' : a.kind === 'profile' ? 'Profile' : a.kind === 'report' ? 'Report'
                  : a.kind === 'block' ? (a.payload.blocked ? 'Block' : 'Unblock') : 'Onboarding'}
                sub={a.status === 'failed' ? `${a.error ?? 'Not accepted'} · Tap to try again` : 'Waiting to send'}
                badge={a.status === 'failed' ? 'Not sent' : 'Saved'} last={i === all.length - 1}
                onPress={a.status === 'failed' ? () => { void accountOutbox(me).retry(a.id).catch((e: unknown) => ctx.toast(failure('account retry', e))); } : undefined} />
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

      {openReport ? (
        <Sheet visible title={reportTitle(openReport.target, ctx.name)} sub={`${reportSummary(openReport)} · ${new Date(openReport.latest).toLocaleDateString()}`}
          onClose={() => setOpenReport(null)}
          footer={<ReportActions ctx={ctx} target={openReport.target}
            onDone={() => { setOpenReport(null); setReportsTick((t) => t + 1); }}
            onOpen={() => {
              const t = openReport.target;
              setOpenReport(null);
              if (t.kind === 'person') ctx.go('members_list');
              else if (t.unitId && t.laneId) ctx.openPassage(t.unitId, t.laneId);
            }} />}>
          <View style={styles.requestBody}>
            <Text style={txt.body}>
              {openReport.target.kind === 'person'
                ? `Someone reported ${ctx.name(openReport.target.profileId)} for ${openReport.reasons.map((r) => reasonLabel(r).toLowerCase()).join(', ')}. You can remove them from the organization under Members.`
                : `Someone reported this for ${openReport.reasons.map((r) => reasonLabel(r).toLowerCase()).join(', ')}. It was made by ${ctx.name(openReport.target.profileId)}. Look at it, then remove it from the record or keep it.`}
            </Text>
            {openReport.details.slice(0, 5).map((d, i) => <Text key={i} style={[txt.sm, { fontStyle: 'italic' }]}>"{d}"</Text>)}
          </View>
          <Text style={txt.xs}>Reports never say who sent them. The LangQuest team sees every report too.</Text>
        </Sheet>
      ) : null}
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

// ---- Getting back in, for an account without email (decisions.md 59) ---------------------------------

/** Who invited this person, by the invite they redeemed: the one to ask on a new phone. */
function useInviterName(ctx: Ctx): string | undefined {
  const me = ctx.session.actorId;
  const invite = Object.values(ctx.org.state?.invites ?? {}).find((i) => i.redeemedBy === me);
  return invite?.issuedBy && invite.issuedBy !== me ? ctx.name(invite.issuedBy) : undefined;
}

/**
 * Whether a looked-after account has a password: one made by joining has
 * none until its owner sets one (the `join` function marks it); older ones
 * chose one when they joined. Null until read from the stored session.
 */
function useHasPassword(): [boolean | null, () => void] {
  const [has, setHas] = useState<boolean | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setHas(data.session?.user.user_metadata?.['has_password'] !== false);
    });
    return () => { active = false; };
  }, [tick]);
  return [has, () => setTick((t) => t + 1)];
}

// ---- Settings (AUTH-7, AUTH-8, ONB-2, ONB-5) ------------------------------------------------------

/** Account and app rows only; everything about running the org lives under Manage. */
export function SettingsHome(ctx: Ctx) {
  const [notificationMessage, setNotificationMessage] = useState('');
  const [blockedOpen, setBlockedOpen] = useState(false);
  const diag = useDiagnosticsSwitch(ctx);
  const names = useDisplayNames(ctx.session.actorId);
  const s = ctx.session;
  const { roleName, orgName, memberName } = useAccountLine(ctx);
  const inviter = useInviterName(ctx);
  const [hasPassword] = useHasPassword();
  const [help, setHelp] = useState<SignInHelp | null>(null);
  useEffect(() => { void readHelp(s.actorId).then(setHelp); }, [s.actorId]);
  const name = names[s.actorId] ?? memberName ?? s.email?.split('@')[0] ?? 'You';
  const p = ctx.project;
  const offline = useOfflineSummary(ctx);
  const syncSub = p.refused ? 'This account cannot sync this organization'
    : p.pending > 0 ? `${p.pending.toLocaleString('en-US')} ${p.pending === 1 ? 'change' : 'changes'} waiting to send`
    : p.live ? 'Live: changes arrive as they happen'
    : p.online === false ? 'Offline: work is kept on this phone'
    : p.lastSync ? `Last synced ${p.lastSync}` : 'Everything is saved on this phone';
  // Known and one: no Switch Organization row. Unknown (never listed on this phone): the row stays.
  const orgs = useOrganizations(s.actorId).rows;
  const canSwitch = orgs === null || orgs.length > 1;
  const advanced = ctx.details('settings:advanced');
  const blocked = ctx.blocks.ids.length;
  // Unsent work is the one thing here that needs noticing, so it leads the summary.
  const advancedSummary = [
    p.pending > 0 || p.refused ? syncSub : 'Sync',
    'diagnostics',
    ...(blocked > 0 ? ['blocked people'] : [])
  ].join(', ');
  return (
    <Screen header={<Header title="Settings" />}>
      <Card>
        <View style={styles.profile}>
          <PersonAvatar look={personLook(s.actorId, name)} size={52} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={txt.h3} numberOfLines={1}>{name}</Text>
            {/* A looked-after account's address means nothing to the person (decisions.md 59). */}
            <Text style={[txt.xs, (!s.email || s.isManaged) && { color: TINT.amberText }]} numberOfLines={1}>
              {s.isManaged || !s.email ? 'No email yet' : s.email}
            </Text>
            <Text style={[txt.xs, { color: C.primary, fontWeight: '600' }]} numberOfLines={1}>{roleName} · {orgName}</Text>
          </View>
        </View>
        {s.isManaged ? (
          <View style={{ gap: 2 }}>
            <Text style={txt.xs}>New phone? {inviter ?? 'The person who invited you'} or an admin can help you sign in.</Text>
            {help ? (
              <Text style={txt.xs}>Signed in on this phone with {help.helper ? `${help.helper}'s` : 'someone\'s'} help · {new Date(help.at).toLocaleDateString()}</Text>
            ) : null}
          </View>
        ) : null}
      </Card>
      {/* One list in the order people need it (Hick's law, ADR-029): their profile, help, the rare switch, then Sign Out. */}
      <Group>
        <Row icon="user" label="Edit Profile" onPress={() => ctx.go('profile_edit')} />
        {/* For a shared phone: then they can sign back in after someone else has used it (decisions.md 59). */}
        {s.isManaged && hasPassword === false ? (
          <Row icon="lock" label="Set a password" sub="If other people use this phone" onPress={() => ctx.go('profile_edit')} />
        ) : null}
        {/* No push on the web yet: requests and feedback still reach the Inbox there. */}
        {Platform.OS !== 'web' ? (
          <Row icon="notif" label="Notifications" sub={notificationMessage || 'Hear about requests and feedback'} onPress={() => {
            void enableNotifications().then(() => setNotificationMessage('Notifications are on.')).catch((e: Error) => setNotificationMessage(e.message));
          }} />
        ) : null}
        {homeScreenFor(s) === 'my_work' ? (
          <Row icon="play" label="Getting started" sub="Your first-day checklist" onPress={() => ctx.go('my_work', { showGettingStarted: '1' })} />
        ) : null}
        {/* What comes along to the field, out of Advanced so it is seen before a trip (decisions.md 61). */}
        <Row icon={offline && offline.kept > 0 && offline.ready === offline.kept ? 'onPhone' : 'notOnPhone'} label="Ready for offline" sub={offlineLine(offline)}
          onPress={() => ctx.go('sync_status')} />
        <Row icon="book" label="What is LangQuest?" onPress={() => ctx.go('vision')} last={!canSwitch} />
        {canSwitch ? (
          <Row icon="building" label="Switch Organization" sub={`${orgName} (active)`} onPress={() => ctx.go('org_switcher')} last />
        ) : null}
      </Group>
      <View style={{ paddingTop: space.sm }}>
        <GhostBtn label="Sign Out" tone="red" onPress={() => ctx.go('sign_out_confirm')} />
      </View>
      {/* Set once and rarely touched, behind one tap (progressive disclosure). App only: none of these is in the demo. */}
      <Disclosure icon="settings" title="Advanced" summary={advancedSummary} open={advanced.open} onToggle={advanced.onToggle}>
        <Row icon="cloud" label="Sync" sub={syncSub} badge={p.pending > 0 ? String(p.pending) : undefined} onPress={() => ctx.go('sync_status')} />
        {/* docs/diagnostics.md, decisions.md 39: on by default, off here. */}
        <Row icon="progress" label="Send diagnostics" sub="Sends speed and error reports, never recordings, what you type or names."
          role="switch" checked={diag.on === true} disabled={diag.on === null} onPress={diag.toggle} />
        {/* Store rules, decisions.md 48: shown once someone is blocked (blocking starts from the flag on what they made). */}
        {blocked > 0 ? (
          <Row icon="block" label="Blocked people" sub={plural(blocked, 'person', 'people')} onPress={() => setBlockedOpen(true)} />
        ) : null}
      </Disclosure>
      {/* Store rules, decisions.md 46: kept where the store answers and the App Review notes say it is (Settings → Delete account), not under Advanced. */}
      <Group>
        <Row icon="trash" iconColor={TINT.redText} iconBg={TINT.red} label="Delete account" sub="Your account and your name, for good"
          onPress={() => ctx.go('delete_account')} last />
      </Group>
      {ctx.canSwitchPersona ? (
        <>
          <SectionLabel label="Testing" />
          <Group>
            <Row icon="people" label="Switch persona" sub="Sign in as a demo translator, reviewer or admin" onPress={ctx.openDev} last />
          </Group>
        </>
      ) : null}
      {blockedOpen ? <BlockedPeople ctx={ctx} onClose={() => setBlockedOpen(false)} /> : null}
    </Screen>
  );
}

type OrgRow = { org_id: string; name: string };

/**
 * The organizations this account belongs to: those saved on this phone at
 * once (null when none were ever listed here), then the server's list, saved
 * for next time. Offline, the saved list stays and `error` says so.
 */
function useOrganizations(actorId: string): { rows: OrgRow[] | null; error: string } {
  const [rows, setRows] = useState<OrgRow[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const key = `organizations:${actorId}`;
    void (async () => {
      const saved = await AsyncStorage.getItem(key);
      if (active && saved) setRows(JSON.parse(saved) as OrgRow[]);
      const { data, error } = await supabase.rpc('my_organizations');
      if (error) { if (active) setError('Unable to refresh. Saved organizations remain available.'); return; }
      // One row per organization: the server lists a row per registered partition.
      const orgs = [...new Map(((data ?? []) as OrgRow[]).map((r) => [r.org_id, { org_id: r.org_id, name: r.name }])).values()];
      await AsyncStorage.setItem(key, JSON.stringify(orgs));
      if (active) setRows(orgs);
    })().catch((e: unknown) => { if (active) setError(failure('org switcher', e)); });
    return () => { active = false; };
  }, [actorId]);
  return { rows, error };
}

/**
 * Who this account blocked, each with Unblock. Blocking happens from the
 * flag on something they made. Someone unblocked here stays listed, with
 * Block again, until the sheet closes: a toast would sit behind the sheet.
 */
function BlockedPeople(props: { ctx: Ctx; onClose: () => void }) {
  const { ctx } = props;
  // The list as the sheet opened, so a row keeps its place when its button is used.
  const [listed] = useState(() => ctx.blocks.ids);
  async function set(id: string, blocked: boolean) {
    try {
      await ctx.blocks.set(id, blocked);
    } catch (e) {
      ctx.toast(failure(blocked ? 'block person' : 'unblock person', e));
    }
  }
  const shown = [...listed, ...ctx.blocks.ids.filter((id) => !listed.includes(id))];
  return (
    <Sheet visible title="Blocked people" sub="What they add is hidden for you. They aren't told." onClose={props.onClose}>
      {shown.length ? (
        <Group>
          {shown.map((id, i, all) => {
            const blocked = ctx.blocks.has(id);
            return (
              <Row key={id} leading={<PersonAvatar look={personLook(id, ctx.name(id))} size={36} />} label={ctx.name(id)}
                {...(blocked ? {} : { sub: 'Unblocked' })} last={i === all.length - 1}
                right={blocked
                  ? <SmallBtn label="Unblock" onPress={() => void set(id, false)} />
                  : <SmallBtn label="Block again" tone="plain" onPress={() => void set(id, true)} />} />
            );
          })}
        </Group>
      ) : (
        <EmptyState icon="block" title="Nobody blocked" sub="To block someone, tap the flag on a note, version or review they made." />
      )}
    </Sheet>
  );
}

/** The diagnostics switch: the saved choice once read (null until then), flipped at once and put back if saving fails. */
function useDiagnosticsSwitch(ctx: Ctx): { on: boolean | null; toggle: () => void } {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void diagnosticsEnabled().then((v) => { if (active) setOn(v); });
    return () => { active = false; };
  }, []);
  function toggle() {
    if (on === null) return;
    const next = !on;
    setOn(next);
    void setDiagnosticsEnabled(next).catch((e: unknown) => {
      setOn(!next);
      ctx.toast(failure('diagnostics setting', e));
    });
  }
  return { on, toggle };
}

// ---- Edit Profile (AUTH-7) ------------------------------------------------------------------------------

/** Your name, saved on this phone and sent when connected. */
export function ProfileEdit(ctx: Ctx) {
  const names = useDisplayNames(ctx.session.actorId);
  const [name, setName] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [hasPassword, recheck] = useHasPassword();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const actions = useAccountActions(ctx.session.actorId);
  const pending = actions.filter((a) => a.kind === 'profile' && a.status !== 'sent').at(-1);
  const value = name ?? String(pending?.payload.displayName ?? names[ctx.session.actorId] ?? '');
  const managed = ctx.session.isManaged;
  const handle = signInName(ctx.session.email);
  async function save() {
    setBusy(true);
    setError('');
    try {
      // A password goes to the server now (it needs a connection); the name syncs whenever it can.
      if (managed && password) {
        if (password.length < 6) { setError('Choose a password of 6 or more characters.'); return; }
        const { error } = await supabase.auth.updateUser({ password, data: { has_password: true } });
        if (error) { noteExpected('set password', error); setError(/fetch|network/i.test(error.message) ? 'Setting a password needs a connection.' : error.message); return; }
        recheck();
      }
      await queueAccountAction(ctx.session.actorId, 'profile', { displayName: value.trim() });
      ctx.toast(managed && password ? 'Saved. You can sign in with your sign-in name and this password.' : 'Profile saved. It syncs when you are connected.');
      ctx.back();
    } catch (e) { setError(failure('save profile', e)); }
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
        {/* A looked-after account's address is not an email anyone can use (accounts.ts). */}
        <Text style={txt.body}>{managed || !ctx.session.email ? 'No email yet' : ctx.session.email}</Text>
      </View>
      {managed ? (
        <View style={{ gap: space.xs }}>
          <Field label={hasPassword ? 'New password (optional)' : 'Password (optional)'} value={password} onChangeText={setPassword}
            placeholder="6 or more characters" secure autoCapitalize="none" />
          <Text style={txt.xs}>
            {password || hasPassword
              ? `You sign in with ${handle ?? 'your sign-in name'} and this password. Write the name down.`
              : 'Set one if other people use this phone, so you can sign back in after they do.'}
          </Text>
        </View>
      ) : null}
      {pending?.status === 'failed' ? <Banner icon="flag" tone="amber" title="Your last change was not accepted" body={pending.error} /> : null}
      {pending?.status === 'queued' ? <Banner icon="cloud" title="Saved on this phone" body="It sends when you are connected." /> : null}
      {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
    </Screen>
  );
}

// ---- Switch Organization (AUTH-8) --------------------------------------------------------------------------

export function OrgSwitcher(ctx: Ctx) {
  const { rows: listed, error: listError } = useOrganizations(ctx.session.actorId);
  const rows = listed ?? [];
  const [switchError, setError] = useState('');
  const error = switchError || listError;
  return (
    <Screen header={<Header title="Switch Organization" onBack={ctx.back} />}>
      {error ? <Banner icon="cloud" tone="amber" title={error} /> : null}
      {rows.map((r) => {
        const active = r.org_id === ctx.project.orgId;
        return (
          <Card key={r.org_id} accessibilityLabel={active ? `${r.name}, active` : r.name}
            onPress={() => void ctx.openOrganization(r.org_id).catch((e: unknown) => setError(failure('switch organization', e)))}>
            <View style={styles.profile}>
              <View style={styles.tile}><Ico name="building" size={24} color={active ? C.primary : C.muted} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[txt.body, { fontWeight: '600' }]} numberOfLines={1}>{r.name}</Text>
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
 * device holds something this session can still deliver (PLAN.md invariant
 * 1: no event is ever lost): work events, organization events, audio
 * waiting to upload, or saved account changes (terms, profile, a request to
 * join). Offline with nothing queued is fine, and so is a server refusal of
 * the organization: those events can never go out under this session, so they
 * stay in the local log and go out if this account signs in again here with
 * membership. An account change the server already turned down (shown in
 * the Inbox) cannot be delivered either, so it does not hold sign-out.
 */
export function SignOutConfirm(ctx: Ctx) {
  const { online, refused } = ctx.project;
  const waiting = useUnsent(ctx);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Without an email or a password, getting back in takes a helper's code (decisions.md 59).
  const inviter = useInviterName(ctx);
  const [hasPassword] = useHasPassword();
  const needsHelp = ctx.session.isManaged && hasPassword === false;
  // A phone hands unsent work over and sends it as you later (decisions.md 60); a browser waits for it.
  const handsOver = HANDS_OVER && waiting.length > 0;
  async function signOut() {
    setBusy(true);
    try {
      if (handsOver) {
        const { orgId, projectId } = ctx.project;
        await signOutHandingOver(ctx.session.actorId, ctx.project.blobs.unsent().map((ref) => ({ orgId, projectId, ref })));
        return;
      }
      await unregisterNotifications();
      const result = await supabase.auth.signOut();
      if (result.error) throw result.error;
      await forgetThisBrowser();
    } catch (e) { setError(failure('sign out', e)); setBusy(false); }
  }
  const blocked = waiting.length > 0 && !handsOver;
  const helpLine = `To sign back in, you'll need a code from ${inviter ?? 'the person who invited you'} or an admin.`;
  const why = handsOver
    ? `Still to send: ${waiting.join(', ')}. All of it will still be sent, as you, when this phone is online.${needsHelp ? ` ${helpLine}` : ''}`
    : blocked
      ? `Still to send: ${waiting.join(', ')}${online === false ? '. This phone is offline' : ''}. Sign out once they have synced so they are not stranded here.`
      : refused
        ? 'This account cannot sync this organization: the server refused it. Signing out is safe; anything queued stays on this phone.'
        : needsHelp
          ? `${helpLine} If other people use this phone, set a password in Edit Profile first.`
          : FORGETS_ON_SIGN_OUT
            ? 'You can sign back in anytime. This browser forgets everything it kept for you, so the next person here sees none of it.'
            : 'You can sign back in anytime.';
  return (
    <Screen bodyStyle={styles.centered}
      footer={
        <>
          <PrimaryBtn label={busy ? 'Signing out…' : 'Sign Out'} tone="red" onPress={() => void signOut()} disabled={blocked || busy} />
          <GhostBtn label="Cancel" onPress={ctx.back} />
        </>
      }>
      <View style={[styles.bigTile, { backgroundColor: waiting.length > 0 ? TINT.amber : TINT.red }]}>
        <Ico name={waiting.length > 0 ? 'cloud' : 'user'} size={32} color={waiting.length > 0 ? TINT.amberText : C.red} />
      </View>
      <Text style={[txt.h2, { textAlign: 'center' }]} accessibilityRole="header">{blocked ? 'Not yet' : 'Sign out?'}</Text>
      <Text style={[txt.bodyMuted, { textAlign: 'center' }]}>{why}</Text>
      {error ? <Text style={[txt.error, { textAlign: 'center' }]} accessibilityRole="alert">{error}</Text> : null}
    </Screen>
  );
}

/** What this session could still deliver from this phone; sign-out and deletion wait for it. */
function useUnsent(ctx: Ctx): string[] {
  const { pending, refused } = ctx.project;
  const accountQueued = useAccountActions(ctx.session.actorId).filter((a) => a.status === 'queued').length;
  return [
    !refused && pending > 0 ? plural(pending, 'change') : null,
    ctx.org.pending > 0 ? plural(ctx.org.pending, 'organization change') : null,
    !refused && ctx.project.blobs.pendingUp > 0 ? plural(ctx.project.blobs.pendingUp, 'recording') : null,
    accountQueued > 0 ? plural(accountQueued, 'account change') : null
  ].filter((w): w is string => w !== null);
}

// ---- Delete Account (app only: store rules; decisions.md 46) -------------------------------------------------

/**
 * Deletes the sign-in and everything that names the person, and takes them
 * out of every organization. The work they recorded stays with the
 * organization, no longer linked to them. It waits for unsent work, as
 * sign-out does, so the organization gets it first, and it needs the
 * server, so it says so offline.
 */
export function DeleteAccount(ctx: Ctx) {
  const waiting = useUnsent(ctx);
  const offline = ctx.project.online === false;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      await deleteAccount(ctx.session.actorId, {
        deleteOnServer: async () => (await supabase.rpc('delete_my_account')).error?.message ?? null,
        storage: AsyncStorage,
        signOutHere: async () => { await supabase.auth.signOut({ scope: 'local' }); await forgetThisBrowser(); }
      });
    } catch (e) { setError(failure('delete account', e)); setBusy(false); }
  }
  const blocked = waiting.length > 0 || offline;
  return (
    <Screen header={<Header title="Delete Account" onBack={ctx.back} />}
      footer={
        <>
          <PrimaryBtn label={busy ? 'Deleting…' : 'Delete My Account'} tone="red" onPress={() => void remove()} disabled={blocked || busy} />
          <GhostBtn label="Cancel" onPress={ctx.back} />
        </>
      }>
      {waiting.length > 0 ? (
        <Banner icon="cloud" tone="amber" title="Send your work first"
          body={`Still to send: ${waiting.join(', ')}. Delete your account once they have synced, so your organization gets them.`} />
      ) : offline ? (
        <Banner icon="cloud" tone="amber" title="You're offline" body="Connect to the internet to delete your account." />
      ) : null}
      <Text style={txt.h2} accessibilityRole="header">Delete your account?</Text>
      <Group>
        <Row icon="user" label="Deleted" sub="Your sign-in, email, name, notifications, blocks and diagnostics. You leave every organization." />
        <Row icon="people" label="Kept by your organization" sub="Recordings, reviews and notes you made stay part of its work, without your name." last />
      </Group>
      <Text style={txt.bodyMuted}>This cannot be undone. To use LangQuest again you would create a new account.</Text>
      {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
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
  // Polled every second: report a failing read once per visit, not per tick.
  const reported = useRef(false);
  useEffect(() => {
    let alive = true;
    const failed = (e: unknown) => {
      if (reported.current) return;
      reported.current = true;
      ctx.toast(failure('sync inspect', e));
    };
    const tick = () => {
      void project.inspect().then((i) => { if (alive) setIns(i); }).catch(failed);
      void org.inspect().then((i) => { if (alive) setOrgIns(i); }).catch(failed);
      setRates(project.blobs.rates());
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(timer); };
    // ctx.toast is stable for the visit; project and org drive the poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, org]);
  const offline = project.online === false;
  const offlineSummaryNow = useOfflineSummary(ctx);
  const pendingEvents = (ins?.pending.length ?? 0) + (orgIns?.pending.length ?? 0);
  const rejected = [...(ins?.rejected ?? []), ...(orgIns?.rejected ?? [])];
  const syncNow = async () => {
    setBusy(true);
    try { await Promise.all([project.sync(), org.sync()]); project.triggerUpload(); }
    catch (e) { ctx.toast(failure('sync now', e)); }
    finally { setBusy(false); }
  };
  return (
    <Screen header={<Header title="Sync" onBack={ctx.back} />}
      footer={<PrimaryBtn label={busy ? 'Syncing…' : 'Sync now'} icon="restart" onPress={() => void syncNow()} disabled={project.tooOld || busy} />}>
      <Banner icon="cloud" tone={project.live ? 'green' : offline ? 'amber' : 'brand'}
        title={project.live ? 'Live: changes arrive as they happen' : offline ? 'Offline: work is kept on this phone' : 'Checking for changes now and then'}
        body={project.refused ?? (project.tooOld ? 'Update the app to sync.' : undefined)} />
      {/* Settings' "Ready for offline" opens here (decisions.md 61): what comes along comes first. */}
      <OfflineCard ctx={ctx} s={offlineSummaryNow} />
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
  // Two by two on a phone; one row of four once the column is wide enough.
  const { kind, contentWidth } = useLayout();
  return (
    <View style={[styles.tile2, kind !== 'phone' && contentWidth >= 600 && { width: '22%' }]} accessible accessibilityLabel={`${props.value} ${props.label}`}>
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
  tile: { width: tile.md, height: tile.md, borderRadius: 16, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  check: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  avatarBlock: { alignItems: 'center', paddingVertical: space.md },
  centered: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl, gap: space.lg },
  bigTile: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile2: { width: '47%', flexGrow: 1, alignItems: 'center', gap: space.xs, paddingVertical: space.lg, paddingHorizontal: space.sm, borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, backgroundColor: C.card },
  statValue: { fontSize: T.xl, fontWeight: '700' }
});

export const contracts = contractsFor('inbox_home', 'settings_home', 'profile_edit', 'org_switcher', 'sign_out_confirm', 'delete_account', 'sync_status');
