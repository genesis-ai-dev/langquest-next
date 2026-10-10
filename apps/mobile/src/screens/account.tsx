// The Inbox and the Me tab. Ports the demo's src/screens/account.tsx
// (InboxHomeScreen, SettingsHomeScreen, ProfileEditScreen,
// OrgSwitcherScreen, SignOutConfirmScreen); Settings is Me in the simple
// redesign (decision 71; ng-langquest-ux src/simple/translator.tsx, Me), with
// the rest under More settings (app only). SyncStatus is app only (the
// local log, realtime state and transfers), as are the Send diagnostics
// switch (docs/diagnostics.md), Delete Account (store rules, decisions.md
// 46), and reports in the Inbox and Blocked people (store rules,
// decisions.md 48).
// Requirements INBOX-1, INBOX-2, AUTH-7, AUTH-8, ONB-2 (the Me rows back to
// them), CORE-12 (sign-out never strands work).
import { signInName } from '../accounts';
import { readHelp, type SignInHelp } from '../signInHelp';
import { CommandError, decodeHlc, languageName, unitTitle, type Update } from '@langquest-next/core';
import type { SyncInspection } from '@langquest-next/client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../text';
import { accountOutbox, queueAccountAction } from '../accountData';
import { deleteAccount } from '../accountDeletion';
import { authErrorText, groupByRead, outboxErrorText, remoteTitle, roleWords, updateText } from '../accountText';
import { deriveKinds, kindOf } from '../coreText';
import type { Ctx } from '../ctx';
import { t } from '../i18n';
import { formatAgo, formatDayTime, formatNumber, formatShortDate, formatTime } from '../i18n/format';
import { OfflineCard, useOfflineSummary } from '../offline';
import { offlineCount, moreSettingsSub } from '../simple/meModel';
import { useHelpPress } from '../helpContext';
import { diagnosticsEnabled, setDiagnosticsEnabled } from '../diagnostics';
import { groupReports, reasonLabel, reportSummary, reportTitle, type ReportGroup } from '../moderation';
import { openReports } from '../moderationData';
import { decideRequest, pendingRequests, type PendingRequest } from '../invites';
import {
  Badge, Banner, Card, EmptyState, Field, GhostBtn, Group, Header, Ico, PrimaryBtn, ProgressBar, Row, Screen,
  SectionLabel, Sheet, ShowMore, SmallBtn, txt, useLayout, useOpenDetail, type IconName
} from '../kit';
import { cachedInbox, enableNotifications, refreshInbox, unregisterNotifications, type RemoteNotification } from '../notifications';
import { dueText } from '../passageView';
import { personLook } from '../people';
import { noteExpected, reportError, failureMessage } from '../report';
import { ReportActions } from '../reportSheet';
import { contractsFor } from '../screenContracts';
import { FORGETS_ON_SIGN_OUT, forgetThisBrowser } from '../forgetBrowser';
import { HANDS_OVER, signOutHandingOver } from '../handOver';
import { supabase } from '../supabase';
import { C, radius, space, target, tile, TINT, type as T } from '../theme';
import { useAccountActions, useDisplayNames } from '../useAccount';
import { runningBuildLabel } from '../updateStatus';
import { PersonAvatar } from '../UserChip';
import { LanguageRow } from '../uiLanguage';

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
    ?? (ctx.session.role ? roleWords(ctx.session.role) : t('account.more.noRole'));
  // Before the org's name has synced, a neutral phrase: never its id.
  const orgName = org?.org?.value.name ?? t('entry.welcome.yourOrganization');
  return { roleName, orgName };
}

/**
 * What happened that concerns you, grouped Unread / Earlier (INBOX-1): one
 * about a passage opens its record and is marked read. Join requests offer
 * Assign role & accept, or Decline (INBOX-2). Updates from another
 * organization open it.
 */
export function InboxHome(ctx: Ctx) {
  const { state } = ctx.language;
  const me = ctx.session.actorId;
  const orgId = ctx.language.orgId;
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
    else if (row.kind === 'content_report') ctx.toast(t('account.inbox.reportsNeedConnection'));
  }

  // The words for each record-derived update, memoized on the fold. Updates are the open language's.
  const languageId = ctx.language.languageId;
  const language = languageName(ctx.org.state, languageId);
  const words = useMemo(() => {
    if (!state) return null;
    const kinds = deriveKinds(state);
    const kindName = (id: string | undefined) => (id ? (kinds.find((k) => k.id === id) ?? kindOf(state, id)).name : t('account.updates.reviewFallback'));
    const produces = (id: string) => !!(kinds.find((k) => k.id === id) ?? kindOf(state, id)).produces;
    return (u: Update) => updateText(u, {
      name: ctx.name, passage: unitTitle(state, u.unitId), language, kindName, produces, due: (d) => dueText(d)
    });
  }, [state, language, ctx.name]);

  // Built each render: only the shown rows are drawn, and the words are memoized above.
  const items: InboxItem[] = [];
  const decided = ctx.org.state?.joinDecisions ?? {};
  for (const r of requests ?? []) {
    if (decided[r.id]) continue;
    items.push({
      id: `join:${r.id}`, icon: 'people', title: t('account.inbox.joinRequest'), read: false,
      body: t('account.inbox.askedToJoin', { name: r.name ?? names[r.profileId] ?? personLook(r.profileId).name, org: orgName }),
      time: formatShortDate(r.createdAt), onPress: () => setOpenRequest(r)
    });
  }
  for (const g of reports ?? []) {
    const target = g.target;
    const where = target.unitId && target.languageId === languageId && state?.units[target.unitId] ? ` · ${unitTitle(state, target.unitId)}` : '';
    items.push({
      id: `report:${g.key}`, icon: 'flag', title: reportTitle(target, ctx.name), read: false,
      body: `${reportSummary(g)}${where}`, time: formatShortDate(g.latest), onPress: () => setOpenReport(g)
    });
  }
  if (words) {
    for (const u of ctx.inbox.updates) {
      const w = words(u);
      items.push({
        id: u.id, icon: w.icon, title: w.title, body: w.body, time: ago(u.hlc), read: ctx.inbox.isRead(u.id), unitId: u.unitId,
        onPress: () => { ctx.inbox.markRead([u.id]); ctx.openPassage(u.unitId, languageId); }
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
      id: `remote:${row.id}`, icon: row.kind === 'join_request' ? 'people' : row.kind === 'content_report' ? 'flag' : 'notif', title: remoteTitle(row),
      body: !here ? t('account.inbox.otherOrg')
        : row.kind === 'content_report' ? t('account.inbox.connectToSee') : t('account.inbox.openMembers'),
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
      ctx.toast(t('account.inbox.declined'));
      setOpenRequest(null);
      setRequestsTick((n) => n + 1);
    } catch (e) {
      // Offline or refused (the server's answer, in English, goes to the log).
      noteExpected('decline join request', e);
      ctx.toast(t('account.inbox.notDeclined'));
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
              {!n.read ? <View style={styles.dot} accessibilityLabel={t('account.inbox.unread')} /> : null}
              <Ico name="right" size={22} color={C.muted} />
            </View>
          } />
      ))}
    </Group>
  );

  const canAssign = ctx.session.can('assign_work');
  return (
    // Reached from My Work's bell (no Inbox tab there): Back returns to it.
    <Screen header={<Header title={t('account.inbox.title')} {...(ctx.params['from'] === 'my_work' ? { onBack: ctx.back } : {})} />}>
      {accountActions.length ? (
        <>
          <SectionLabel label={t('account.inbox.savedChanges')} />
          <Group>
            {accountActions.map((a, i, all) => (
              <Row key={a.id} icon={a.status === 'failed' ? 'flag' : 'cloud'} iconColor={a.status === 'failed' ? TINT.redText : C.primary}
                label={a.kind === 'join_request' ? t('account.inbox.actions.joinRequest') : a.kind === 'profile' ? t('account.inbox.actions.profile')
                  : a.kind === 'report' ? t('account.inbox.actions.report')
                  : a.kind === 'block' ? (a.payload.blocked ? t('account.inbox.actions.block') : t('account.inbox.actions.unblock')) : t('account.inbox.actions.onboarding')}
                sub={a.status === 'failed' ? t('account.inbox.failedSub', { reason: outboxErrorText(a.error) }) : t('account.inbox.waiting')}
                badge={a.status === 'failed' ? t('account.inbox.badgeNotSent') : t('account.inbox.badgeSaved')} last={i === all.length - 1}
                onPress={a.status === 'failed' ? () => { void accountOutbox(me).retry(a.id).catch((e: unknown) => ctx.toast(failure('account retry', e))); } : undefined} />
            ))}
          </Group>
        </>
      ) : null}
      {unread.length ? (
        <>
          <SectionLabel label={t('account.inbox.unreadCount', { n: unread.length })} />
          {list(unread, shownUnread)}
          <ShowMore remaining={unread.length - shownUnread} step={INBOX_STEP} onMore={() => setShownUnread(shownUnread + INBOX_STEP)} />
        </>
      ) : null}
      {earlier.length ? (
        <>
          <SectionLabel label={t('account.inbox.earlier')} />
          {list(earlier, shownEarlier)}
          <ShowMore remaining={earlier.length - shownEarlier} step={INBOX_STEP} onMore={() => setShownEarlier(shownEarlier + INBOX_STEP)} />
        </>
      ) : null}
      {!items.length ? <EmptyState icon="inbox" title={t('account.inbox.emptyTitle')} sub={t('account.inbox.emptySub')} /> : null}

      {openReport ? (
        <Sheet visible title={reportTitle(openReport.target, ctx.name)} sub={`${reportSummary(openReport)} · ${formatShortDate(openReport.latest)}`}
          onClose={() => setOpenReport(null)}
          footer={<ReportActions ctx={ctx} target={openReport.target}
            onDone={() => { setOpenReport(null); setReportsTick((n) => n + 1); }}
            onOpen={() => {
              const target = openReport.target;
              setOpenReport(null);
              if (target.kind === 'person') ctx.go('members_list');
              else if (target.unitId && target.languageId) ctx.openPassage(target.unitId, target.languageId);
            }} />}>
          <View style={styles.requestBody}>
            <Text style={txt.body}>
              {openReport.target.kind === 'person'
                ? t('account.inbox.reportedPerson', { name: ctx.name(openReport.target.profileId), reasons: openReport.reasons.map((r) => reasonLabel(r)).join(', ') })
                : t('account.inbox.reportedContent', { name: ctx.name(openReport.target.profileId), reasons: openReport.reasons.map((r) => reasonLabel(r)).join(', ') })}
            </Text>
            {openReport.details.slice(0, 5).map((d, i) => <Text key={i} style={[txt.sm, { fontStyle: 'italic' }]}>"{d}"</Text>)}
          </View>
          <Text style={txt.xs}>{t('account.inbox.reportsAnonymous')}</Text>
        </Sheet>
      ) : null}
      <Sheet visible={!!openRequest} title={t('account.inbox.joinRequest')} sub={openRequest ? formatDayTime(openRequest.createdAt) : undefined}
        onClose={() => setOpenRequest(null)}
        footer={openRequest ? (
          <>
            {canAssign ? (
              <PrimaryBtn label={t('account.inbox.assignAccept')} icon="check" onPress={() => {
                const r = openRequest;
                setOpenRequest(null);
                ctx.go('edit_member', { memberId: r.profileId, requestId: r.id, ...(r.name ? { name: r.name } : {}) });
              }} />
            ) : null}
            <GhostBtn label={t('account.inbox.decline')} tone="red" disabled={declining} onPress={() => void decline(openRequest)} />
          </>
        ) : undefined}>
        {openRequest ? (
          <View style={styles.requestBody}>
            <Text style={txt.body}>
              {t('account.inbox.askedToJoin', { name: openRequest.name ?? names[openRequest.profileId] ?? personLook(openRequest.profileId).name, org: orgName })}
            </Text>
            {openRequest.message ? <Text style={[txt.sm, { fontStyle: 'italic' }]}>"{openRequest.message}"</Text> : null}
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

/** When an update happened, as people say it: "Just now", "5 min ago", "Oct 1". */
function ago(hlc: string): string {
  return hlc ? formatAgo(decodeHlc(hlc).wallMs) : '';
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
  return [has, () => setTick((n) => n + 1)];
}

// ---- Me (AUTH-7, AUTH-8, ONB-2; decision 71) -------------------------------------------------------

/**
 * Me (the simple redesign, demo ADR-032): the five things people change, on
 * one card, then Sign out. Everything else Settings had is under More
 * settings, one labelled tap away; nothing about running the org is here
 * (that lives under Manage).
 */
export function SettingsHome(ctx: Ctx) {
  const names = useDisplayNames(ctx.session.actorId);
  const s = ctx.session;
  const name = names[s.actorId] ?? s.email?.split('@')[0] ?? t('common.you');
  const offline = useOfflineSummary(ctx);
  // The language's sync needs noticing when work is waiting to send: say so on More settings' row.
  const p = ctx.language;
  const moreSub = p.refused ? t('account.me.moreRefused')
    : p.pending > 0 ? t('account.me.morePending', { count: p.pending }) : moreSettingsSub();
  return (
    <Screen header={<Header title={t('account.me.title')} />}>
      <Group>
        <Row icon="user" label={name} sub={t('account.me.nameSub')} onPress={() => ctx.go('profile_edit')} />
        {/* What comes along to the field, seen before a trip (decisions.md 61). */}
        <Row icon="download" label={t('account.me.offline')} sub={offlineCount(offline)} onPress={() => ctx.go('sync_status')} />
        <Row icon="mic" label={t('account.me.mic')} sub={t('account.me.micSub')} onPress={() => ctx.go('mic_setup')} />
        <Row icon="help" label={t('account.me.tour')} sub={t('account.me.tourSub')} onPress={() => ctx.go('vision')} />
        <LanguageRow />
        <Row icon="settings" label={t('account.me.more')} sub={moreSub} onPress={() => ctx.go('settings_more')}
          {...(p.pending > 0 ? { badge: formatNumber(p.pending) } : {})} last />
      </Group>
      <DangerLink label={t('account.me.signOut')} onPress={() => ctx.go('sign_out_confirm')} />
    </Screen>
  );
}

/** A red line of text for leaving (Sign out): plain, centred, 56pt, never louder than the card above it. */
function DangerLink(props: { label: string; onPress: () => void }) {
  const onPress = useHelpPress(props.label, t('account.me.signOutHelp'), props.onPress);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={props.label}
      style={({ pressed }) => [styles.dangerLink, pressed && { opacity: 0.7 }]}>
      <Text style={styles.dangerText}>{props.label}</Text>
    </Pressable>
  );
}

// ---- More settings (AUTH-7, AUTH-8; decision 71) -------------------------------------------------

/**
 * Everything Settings had that Me does not lead with: the account, a
 * password for a looked-after account, notifications, switching
 * organization, sync, diagnostics, blocked people and deleting the account.
 */
export function SettingsMore(ctx: Ctx) {
  const [notificationMessage, setNotificationMessage] = useState('');
  const [blockedOpen, setBlockedOpen] = useState(false);
  const diag = useDiagnosticsSwitch(ctx);
  const names = useDisplayNames(ctx.session.actorId);
  const s = ctx.session;
  const { roleName, orgName } = useAccountLine(ctx);
  const inviter = useInviterName(ctx);
  const [hasPassword] = useHasPassword();
  const [help, setHelp] = useState<SignInHelp | null>(null);
  useEffect(() => { void readHelp(s.actorId).then(setHelp); }, [s.actorId]);
  const name = names[s.actorId] ?? s.email?.split('@')[0] ?? t('common.you');
  const p = ctx.language;
  const syncSub = p.refused ? t('account.more.syncRefused')
    : p.pending > 0 ? t('account.more.syncPending', { count: p.pending })
    : p.live ? t('account.more.syncLive')
    : p.online === false ? t('account.more.syncOffline')
    : lastSyncText(p.lastSync);
  // Switch Organization is always offered (it also starts a new one); with only one organization it says so.
  const orgs = useOrganizations(s.actorId).rows;
  const canSwitch = orgs === null || orgs.length > 1;
  const blocked = ctx.blocks.ids.length;
  return (
    <Screen header={<Header title={t('account.me.more')} onBack={ctx.back} />}>
      <Card>
        <View style={styles.profile}>
          <PersonAvatar look={personLook(s.actorId, name)} size={52} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={txt.h3} numberOfLines={1}>{name}</Text>
            {/* A looked-after account's address means nothing to the person (decisions.md 59). */}
            <Text style={[txt.xs, (!s.email || s.isManaged) && { color: TINT.amberText }]} numberOfLines={1}>
              {s.isManaged || !s.email ? t('account.more.noEmail') : s.email}
            </Text>
            <Text style={[txt.xs, { color: C.primary, fontWeight: '600' }]} numberOfLines={1}>{roleName} · {orgName}</Text>
          </View>
        </View>
        {s.isManaged ? (
          <View style={{ gap: 2 }}>
            <Text style={txt.xs}>{inviter ? t('account.more.newDevice', { name: inviter }) : t('account.more.newDeviceNoName')}</Text>
            {help ? (
              <Text style={txt.xs}>
                {help.helper ? t('account.more.helpedBy', { name: help.helper, date: formatShortDate(help.at) }) : t('account.more.helpedBySomeone', { date: formatShortDate(help.at) })}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Card>
      <Group>
        {/* For a shared phone: then they can sign back in after someone else has used it (decisions.md 59). */}
        {s.isManaged && hasPassword === false ? (
          <Row icon="lock" label={t('account.more.setPassword')} sub={t('account.more.setPasswordSub')} onPress={() => ctx.go('profile_edit')} />
        ) : null}
        {/* No push on the web yet: requests and feedback still reach the Inbox there. */}
        {Platform.OS !== 'web' ? (
          <Row icon="notif" label={t('account.more.notifications')} sub={notificationMessage || t('account.more.notificationsSub')} onPress={() => {
            void enableNotifications().then(() => setNotificationMessage(t('account.more.notificationsOn'))).catch((e: unknown) => {
              // Turned off on the phone says so in its own words (push.ts); anything else is the server or the device.
              if (!(e instanceof CommandError)) noteExpected('enable notifications', e);
              setNotificationMessage(e instanceof CommandError ? e.message : t('account.more.notificationsFailed'));
            });
          }} />
        ) : null}
        {/* Always here: someone in one organization may start another (Switch Organization, then New organization). */}
        <Row icon="building" label={t('account.more.switchOrg')} sub={canSwitch ? t('account.more.switchActive', { org: orgName }) : t('account.more.switchOrStart', { org: orgName })} onPress={() => ctx.go('org_switcher')} last />
      </Group>
      <SectionLabel label={t('account.more.thisDevice')} />
      <Group>
        <Row icon="cloud" label={t('account.more.sync')} sub={syncSub} badge={p.pending > 0 ? formatNumber(p.pending) : undefined} onPress={() => ctx.go('sync_status')} />
        {/* docs/diagnostics.md, decisions.md 39: on by default, off here. */}
        <Row icon="progress" label={t('account.more.diagnostics')} sub={t('account.more.diagnosticsSub')}
          role="switch" checked={diag.on === true} disabled={diag.on === null} onPress={diag.toggle} last={blocked === 0} />
        {/* Store rules, decisions.md 48: shown once someone is blocked (blocking starts from the flag on what they made). */}
        {blocked > 0 ? (
          <Row icon="block" label={t('account.more.blocked')} sub={t('account.more.blockedCount', { count: blocked })} onPress={() => setBlockedOpen(true)} last />
        ) : null}
      </Group>
      {/* Store rules, decisions.md 46: the store answers and the App Review notes say Settings → Delete account; it is here, under Me › More settings. */}
      <Group>
        <Row icon="trash" iconColor={TINT.redText} iconBg={TINT.red} label={t('account.more.deleteAccount')} sub={t('account.more.deleteSub')}
          onPress={() => ctx.go('delete_account')} last />
      </Group>
      {ctx.canSwitchPersona ? (
        <>
          <SectionLabel label={t('account.more.testing')} />
          <Group>
            <Row icon="people" label={t('entry.signIn.switchPersona')} sub={t('account.more.personaSub')} onPress={ctx.openDev} last />
          </Group>
        </>
      ) : null}
      {blockedOpen ? <BlockedPeople ctx={ctx} onClose={() => setBlockedOpen(false)} /> : null}
    </Screen>
  );
}

/**
 * The last sync, from useLanguage's `lastSync` (a diagnostic token, not
 * words: 'never', 'offline', 'up to date', 'pushed N, pulled N, rejected N',
 * 'refused: …', 'error: …').
 */
function lastSyncText(lastSync: string): string {
  if (lastSync === 'up to date' || lastSync.startsWith('pushed ')) return t('account.more.syncUpToDate');
  if (lastSync === 'offline') return t('account.more.syncOffline');
  if (lastSync.startsWith('refused')) return t('account.more.syncRefused');
  if (lastSync.startsWith('error')) return t('account.more.syncError');
  return t('account.more.syncSaved');
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
      if (error) { if (active) setError(t('account.orgs.stale')); return; }
      const orgs = ((data ?? []) as OrgRow[]).map((r) => ({ org_id: r.org_id, name: r.name }));
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
      // i18n-ignore: log labels for the report, not words on screen
      ctx.toast(failure(blocked ? 'block person' : 'unblock person', e));
    }
  }
  const shown = [...listed, ...ctx.blocks.ids.filter((id) => !listed.includes(id))];
  return (
    <Sheet visible title={t('account.more.blocked')} sub={t('account.blocked.sub')} onClose={props.onClose}>
      {shown.length ? (
        <Group>
          {shown.map((id, i, all) => {
            const blocked = ctx.blocks.has(id);
            return (
              <Row key={id} leading={<PersonAvatar look={personLook(id, ctx.name(id))} size={36} />} label={ctx.name(id)}
                {...(blocked ? {} : { sub: t('account.blocked.unblocked') })} last={i === all.length - 1}
                right={blocked
                  ? <SmallBtn label={t('account.blocked.unblock')} onPress={() => void set(id, false)} />
                  : <SmallBtn label={t('account.blocked.blockAgain')} tone="plain" onPress={() => void set(id, true)} />} />
            );
          })}
        </Group>
      ) : (
        <EmptyState icon="block" title={t('account.blocked.emptyTitle')} sub={t('account.blocked.emptySub')} />
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
        if (password.length < 6) { setError(t('account.profile.shortPassword')); return; }
        const { error } = await supabase.auth.updateUser({ password, data: { has_password: true } });
        if (error) {
          noteExpected('set password', error);
          setError(authErrorText(error, t('account.profile.passwordFailed'), t('account.profile.passwordNeedsConnection')));
          return;
        }
        recheck();
      }
      await queueAccountAction(ctx.session.actorId, 'profile', { displayName: value.trim() });
      ctx.toast(managed && password ? t('account.profile.savedWithPassword') : t('account.profile.saved'));
      ctx.back();
    } catch (e) { setError(failure('save profile', e)); }
    finally { setBusy(false); }
  }
  return (
    <Screen
      header={<Header title={t('account.profile.title')} onBack={ctx.back} />}
      footer={<PrimaryBtn label={t('account.profile.save')} onPress={() => void save()} disabled={!value.trim()} busy={busy} />}
    >
      <View style={styles.avatarBlock}>
        <PersonAvatar look={personLook(ctx.session.actorId, value)} size={72} />
      </View>
      <Field label={t('account.profile.nameLabel')} value={value} onChangeText={setName} placeholder={t('entry.fields.yourName')} autoCapitalize="words" />
      <View style={{ gap: space.xs }}>
        <Text style={txt.xsStrong}>{t('entry.fields.email')}</Text>
        {/* A looked-after account's address is not an email anyone can use (accounts.ts). */}
        <Text style={txt.body}>{managed || !ctx.session.email ? t('account.more.noEmail') : ctx.session.email}</Text>
      </View>
      {managed ? (
        <View style={{ gap: space.xs }}>
          <Field label={hasPassword ? t('account.profile.newPassword') : t('account.profile.password')} value={password} onChangeText={setPassword}
            placeholder={t('account.profile.passwordPlaceholder')} secure autoCapitalize="none" />
          <Text style={txt.xs}>
            {password || hasPassword
              ? (handle ? t('account.profile.signInWith', { name: handle }) : t('account.profile.signInWithYourName'))
              : t('account.profile.setOne')}
          </Text>
        </View>
      ) : null}
      {pending?.status === 'failed' ? <Banner icon="flag" tone="amber" title={t('account.profile.lastChangeRefused')} body={outboxErrorText(pending.error)} /> : null}
      {pending?.status === 'queued' ? <Banner icon="cloud" title={t('entry.shared.savedOnDevice')} body={t('account.profile.savedBody')} /> : null}
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
    <Screen header={<Header title={t('account.more.switchOrg')} onBack={ctx.back} />}>
      {error ? <Banner icon="cloud" tone="amber" title={error} /> : null}
      {rows.map((r) => {
        const active = r.org_id === ctx.language.orgId;
        return (
          <Card key={r.org_id} accessibilityLabel={active ? t('account.orgs.activeLabel', { name: r.name }) : r.name}
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
      {!rows.length && !error ? <EmptyState icon="building" title={t('account.orgs.loading')} /> : null}
      {/* App only: someone already in an organization starts another, and is its Organization Admin. */}
      <Card onPress={() => ctx.go('create_org')} accessibilityLabel={t('account.orgs.newOrg')}>
        <View style={styles.profile}>
          <View style={styles.tile}><Ico name="plus" size={24} color={C.primary} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[txt.body, { fontWeight: '600', color: C.primary }]}>{t('account.orgs.newOrg')}</Text>
            <Text style={txt.xs}>{t('account.orgs.newOrgSub')}</Text>
          </View>
        </View>
      </Card>
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
  const { online, refused } = ctx.language;
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
        const { orgId, languageId } = ctx.language;
        await signOutHandingOver(ctx.session.actorId, ctx.language.blobs.unsent().map((ref) => ({ orgId, languageId, ref })));
        return;
      }
      await unregisterNotifications();
      const result = await supabase.auth.signOut();
      if (result.error) throw result.error;
      await forgetThisBrowser();
    } catch (e) { setError(failure('sign out', e)); setBusy(false); }
  }
  const blocked = waiting.length > 0 && !handsOver;
  const helpLine = inviter ? t('account.signOut.helpLine', { name: inviter }) : t('account.signOut.helpLineNoName');
  const things = waiting.join(', ');
  // Two whole sentences side by side where both apply.
  const why = handsOver
    ? [t('account.signOut.handsOver', { things }), ...(needsHelp ? [helpLine] : [])].join(' ')
    : blocked
      ? online === false ? t('account.signOut.blockedOffline', { things }) : t('account.signOut.blocked', { things })
      : refused
        ? t('account.signOut.refused')
        : needsHelp
          ? `${helpLine} ${t('account.signOut.setPasswordFirst')}`
          : FORGETS_ON_SIGN_OUT
            ? t('account.signOut.forgets')
            : t('account.signOut.anytime');
  return (
    <Screen bodyStyle={styles.centered}
      footer={
        <>
          <PrimaryBtn label={busy ? t('account.signOut.signingOut') : t('account.signOut.button')} tone="red" onPress={() => void signOut()} disabled={blocked || busy} />
          <GhostBtn label={t('common.cancel')} onPress={ctx.back} />
        </>
      }>
      <View style={[styles.bigTile, { backgroundColor: waiting.length > 0 ? TINT.amber : TINT.red }]}>
        <Ico name={waiting.length > 0 ? 'cloud' : 'user'} size={32} color={waiting.length > 0 ? TINT.amberText : C.red} />
      </View>
      <Text style={[txt.h2, { textAlign: 'center' }]} accessibilityRole="header">{blocked ? t('account.signOut.notYet') : t('account.signOut.question')}</Text>
      <Text style={[txt.bodyMuted, { textAlign: 'center' }]}>{why}</Text>
      {error ? <Text style={[txt.error, { textAlign: 'center' }]} accessibilityRole="alert">{error}</Text> : null}
    </Screen>
  );
}

/** What this session could still deliver from this phone; sign-out and deletion wait for it. */
function useUnsent(ctx: Ctx): string[] {
  const { pending, refused } = ctx.language;
  const accountQueued = useAccountActions(ctx.session.actorId).filter((a) => a.status === 'queued').length;
  return [
    !refused && pending > 0 ? t('account.unsent.changes', { count: pending }) : null,
    ctx.org.pending > 0 ? t('account.unsent.orgChanges', { count: ctx.org.pending }) : null,
    !refused && ctx.language.blobs.pendingUp > 0 ? t('account.unsent.recordings', { count: ctx.language.blobs.pendingUp }) : null,
    accountQueued > 0 ? t('account.unsent.accountChanges', { count: accountQueued }) : null
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
  const offline = ctx.language.online === false;
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
    <Screen header={<Header title={t('account.delete.title')} onBack={ctx.back} />}
      footer={
        <>
          <PrimaryBtn label={busy ? t('account.delete.deleting') : t('account.delete.button')} tone="red" onPress={() => void remove()} disabled={blocked || busy} />
          <GhostBtn label={t('common.cancel')} onPress={ctx.back} />
        </>
      }>
      {waiting.length > 0 ? (
        <Banner icon="cloud" tone="amber" title={t('account.delete.sendFirstTitle')}
          body={t('account.delete.sendFirstBody', { things: waiting.join(', ') })} />
      ) : offline ? (
        <Banner icon="cloud" tone="amber" title={t('account.delete.offlineTitle')} body={t('account.delete.offlineBody')} />
      ) : null}
      <Text style={txt.h2} accessibilityRole="header">{t('account.delete.question')}</Text>
      <Group>
        <Row icon="user" label={t('account.delete.deleted')} sub={t('account.delete.deletedSub')} />
        <Row icon="people" label={t('account.delete.kept')} sub={t('account.delete.keptSub')} last />
      </Group>
      <Text style={txt.bodyMuted}>{t('account.delete.cannotUndo')}</Text>
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
  const { language, org } = ctx;
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
      void language.inspect().then((i) => { if (alive) setIns(i); }).catch(failed);
      void org.inspect().then((i) => { if (alive) setOrgIns(i); }).catch(failed);
      setRates(language.blobs.rates());
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(timer); };
    // ctx.toast is stable for the visit; language and org drive the poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, org]);
  const offline = language.online === false;
  const offlineSummaryNow = useOfflineSummary(ctx);
  const pendingEvents = (ins?.pending.length ?? 0) + (orgIns?.pending.length ?? 0);
  const rejected = [...(ins?.rejected ?? []), ...(orgIns?.rejected ?? [])];
  const syncNow = async () => {
    setBusy(true);
    try { await Promise.all([language.sync(), org.sync()]); language.triggerUpload(); }
    catch (e) { ctx.toast(failure('sync now', e)); }
    finally { setBusy(false); }
  };
  return (
    <Screen header={<Header title={t('account.more.sync')} onBack={ctx.back} />}
      footer={<PrimaryBtn label={busy ? t('account.sync.syncing') : t('account.sync.syncNow')} icon="restart" onPress={() => void syncNow()} disabled={language.tooOld || busy} />}>
      {/* The server's refusal is English (its reason goes to the log): say what it means. */}
      <Banner icon="cloud" tone={language.live ? 'green' : offline ? 'amber' : 'brand'}
        title={language.live ? t('account.more.syncLive') : offline ? t('account.more.syncOffline') : t('account.sync.checking')}
        body={language.refused ? t('account.sync.refused') : language.tooOld ? t('account.sync.tooOld') : undefined} />
      {/* Settings' "Ready for offline" opens here (decisions.md 61): what comes along comes first. */}
      <OfflineCard ctx={ctx} s={offlineSummaryNow} />
      <View style={styles.tiles}>
        <Stat icon="up" color={pendingEvents ? C.primary : C.green} value={pendingEvents} label={t('account.sync.waitingUpload')} />
        <Stat icon="flag" color={rejected.length ? TINT.redText : C.muted} value={rejected.length} label={t('account.sync.refusedByServer')} />
        <Stat icon="check" color={C.green} value={ins?.cursor ?? 0} label={t('account.sync.latestConfirmed')} />
        <Stat icon="layers" color={C.muted} value={ins?.checkpointSeq ?? 0} label={t('account.sync.localCheckpoint')} />
      </View>
      <Transfer icon="up" pending={language.blobs.pendingUp} peak={language.blobs.peakUp} rate={rates.up} label={t('account.sync.audioUp')} />
      <Transfer icon="download" pending={language.blobs.pendingDown} peak={language.blobs.peakDown} rate={rates.down} label={t('account.sync.audioDown')} />
      {ins && ins.pending.length ? (
        <>
          <SectionLabel label={t('account.sync.waitingCount', { n: ins.pending.length })} />
          <Group>
            {ins.pending.slice(0, 20).map((l, i, a) => (
              <Row key={l.event.id} icon="cloud" label={l.event.type.replace(/^v\d\./, '')} sub={clock(l.event.hlc)} last={i === a.length - 1} />
            ))}
          </Group>
        </>
      ) : null}
      {rejected.length ? (
        <>
          <SectionLabel label={t('account.sync.refusedCount', { n: rejected.length })} />
          <Group>
            {rejected.slice(0, 20).map((l, i, a) => (
              <Row key={l.event.id} icon="flag" iconColor={TINT.redText} label={l.event.type.replace(/^v\d\./, '')} sub={l.rejectReason ?? clock(l.event.hlc)} last={i === a.length - 1} />
            ))}
          </Group>
        </>
      ) : null}
      <Text style={[txt.xs, { textAlign: 'center' }]}>{ins ? t('account.sync.events', { count: ins.total }) : ''}</Text>
      <Text style={[txt.xs, { textAlign: 'center' }]} selectable>
        {runningBuildLabel({ updateId: Updates.updateId ?? undefined, createdAt: Updates.createdAt ?? undefined, isEmbeddedLaunch: Updates.isEmbeddedLaunch })}
      </Text>
    </Screen>
  );
}

function clock(hlc: string): string {
  try { return formatTime(decodeHlc(hlc).wallMs, { seconds: true }); } catch { return ''; }
}

function Stat(props: { icon: IconName; color: string; value: number; label: string }) {
  // Two by two on a phone; one row of four once the column is wide enough.
  const { kind, contentWidth } = useLayout();
  return (
    <View style={[styles.tile2, kind !== 'phone' && contentWidth >= 600 && { width: '22%' }]} accessible
      accessibilityLabel={t('account.sync.statLabel', { value: formatNumber(props.value), label: props.label })}>
      <Ico name={props.icon} size={24} color={props.color} />
      <Text style={[styles.statValue, { color: props.color }]}>{formatNumber(props.value)}</Text>
      <Text style={[txt.xs, { textAlign: 'center' }]}>{props.label}</Text>
    </View>
  );
}

function Transfer(props: { icon: IconName; pending: number; peak: number; rate: number; label: string }) {
  const total = Math.max(props.peak, props.pending);
  const done = total - props.pending;
  const idle = props.pending === 0;
  return (
    <Card accessibilityLabel={idle ? t('account.sync.transferIdle', { label: props.label })
      : t('account.sync.transferBusy', { label: props.label, done, total, speed: speed(props.rate) })}>
      <View style={styles.profile}>
        <Ico name={props.icon} size={22} color={idle ? C.muted : C.primary} />
        <Text style={[txt.sm, { flex: 1, fontWeight: '600' }]}>{props.label}</Text>
        {idle ? <Badge label={t('account.more.syncUpToDate')} tone="green" /> : <Text style={txt.xs}>{t('account.sync.left', { count: props.pending, speed: speed(props.rate) })}</Text>}
      </View>
      {idle ? null : <ProgressBar value={total ? (done / total) * 100 : 100} />}
    </Card>
  );
}

function speed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return t('account.sync.speedB', { value: formatNumber(Math.round(bytesPerSecond)) });
  if (bytesPerSecond < 1024 * 1024) return t('account.sync.speedKB', { value: formatNumber(bytesPerSecond / 1024, { maximumFractionDigits: 0 }) });
  return t('account.sync.speedMB', { value: formatNumber(bytesPerSecond / (1024 * 1024), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
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
  statValue: { fontSize: T.xl, fontWeight: '700' },
  dangerLink: { minHeight: target.primary, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', paddingHorizontal: space.xl },
  dangerText: { fontSize: T.base, fontWeight: '700', color: TINT.redText }
});

export const contracts = contractsFor('inbox_home', 'settings_home', 'settings_more', 'profile_edit', 'org_switcher', 'sign_out_confirm', 'delete_account', 'sync_status');
