// Running the organization (Manage tab). Ports the demo's src/screens/org.tsx:
// OrgHomeScreen, LanguageHomeScreen (with HomeSection, HomePrimary,
// HomeSetup, HomeProgressBars), MembersListScreen, InviteMemberScreen
// (invite and edit), InviteQrScreen and NewStructureItemScreen (new
// language). The demo's review teams are a check's people now, on the check
// itself (screens/checks.tsx, decision 91).
// Requirements ORG-1, ORG-2, ORG-5, ORG-6, ORG-7, NAV-6, FLOW-5; ADR-017
// (admins reach these homes through Manage), ADR-025 (a language owns its
// template, starting from the one its organization suggests). The demo's
// Project Home and New Project are not ported: an organization holds its
// languages directly (docs/decisions.md 63). A cluster (decision 108, demo
// ADR-045) is a name on some of them, with a page of its own (ClusterHome).
import {
  clusterName, clustersOf, mayManageClusters, orgClusters,
  decodeHlc, deriveFlow, goesWith, isMoreOpen, keyTermsFor, languageInfo, languageName, languageProgress,
  leavesNoRoleManager, libraryItemView, materialsFor, mayChangeLicense, mayChangeMembership, mayGrantRole, mayRenameLanguage, mayRenameOrg, orgLicense, orgName, privilegesFor, SEED_ROLES,
  subscriptionItemId, templateBooks, type LanguageProgress, type LibraryDoc, type License, type Scope, type ScopeLevel, type SourceDoc
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { Text } from '../ui/text';
import QRCode from 'react-native-qrcode-svg';
import type { LibraryChoice } from '../templates/contentTemplates';
import { deriveKinds, kindOf, licenseText } from '../i18n/coreText';
import type { Ctx } from '../shell/ctx';
import { t, Trans } from '../i18n';
import { formatAgo, formatClock, formatDayYear, formatNumber } from '../i18n/format';
import { indexesFor } from '../sync/indexes';
import { canHelpSignIn, decideRequest, inviteUri, issueInvite, issueSignInCode, pendingRequests, type NewInvite, type PendingRequest } from '../invites/invites';
import { APP_URL } from '../web/appUrl';
import { signInUri } from '../invites/inviteCode';
import { Badge, Banner, Card, Chip, Disclosure, EmptyState, Field, GhostBtn, Group, HelpInfo, Header, Ico, KindIcon, LinkBtn, MovingBar, PrimaryBtn, ProgressBar, QuietLinks, Row, Screen, SearchField, SectionLabel, Segments, Sheet, ShowMore, SmallBtn, Toggle, type IconName } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { useOpenDetail } from '../ui/useLayout';
import { edgeFor } from '../shell/flow';
import { loadDocs } from '../library/docStore';
import { useLibrary, useLibraryDocs, useSharedItems } from '../library/useLibrary';
import {
  assignableLevels, booksInScope, changeMembership, grantableLanguages, groupBelow, inviteScope, LANGUAGE_SCOPES, languageScopeLabel, levelLabel,
  mayGrantAt, membersAbove, membersAt, memberEntries, parseLevel, progressLine, removeMembership, reviewEligible,
  saveTeam, similarLanguages, sumProgress, teamMembers,
  type HomeProgress, type LanguageScope, type MemberEntry, type OrgOp
} from '../org/orgAdmin';
import { noteExpected, reportError, failureMessage } from '../diagnostics/report';
import { LicenseRow, LicenseSheet } from '../org/licenseSheet';
import { appendToLanguage } from '../sync/languageWriter';
import { createLanguages, newLanguageParts, type Making, type NewOne, type Offer } from '../org/newLanguage';
import { emailInvite } from '../org/emailInvite';
import { looksLikeEmail, signInFailure } from '../org/model';
import { usePublicListing } from '../org/usePublicListing';
import { contractsFor } from '../shell/screenContracts';
import { languageFigures } from '../org/orgFigures';
import { LanguoidPicker } from '../org/languoidPicker';
import { useLanguoidName, useLanguoidSearch } from '../org/useLanguoids';
import type { LanguoidHit } from '../org/languoidModel';
import { edgeAllowed } from '../shell/session';
import { shareText } from '../ui/share';
import { C, radius, space, tile, TINT } from '../ui/theme';
import { useOrgSummary } from '../reports/useOrgSummary';
import { useHelpMode } from '../helpMode/useHelpMode';
import { AmberNote, BigTop, CheckRow, ChoiceCard, CountBadge, DashedRow, IconTile, NumberedSteps, Pills, Question, QuietLink, RadioRow, WorkSteps } from '../admin/admin';
import { inviteFailureText } from '../admin/inviteText';
import { askedAgo, firstName, flowSub, guideShortName, joinAnd, languageLabel, QUESTIONS, questionLabel, stepTitle } from '../admin/adminModel';
import { useCheckChoices, type FlowEntry } from '../admin/useChoices';
import { rowsOf, stepsOf } from '../checks/model';
import { setChecksDraft } from '../checks/draft';
import { useChecksDraft } from '../checks/useChecksDraft';
import { TranslateQuestion } from '../breakup/TranslateStep';
import { useTranslate } from '../breakup/useTranslate';
import { InviteSomeone } from '../invites/invite';
import { refKindOf } from '../reference/model';
import type { GuideSet } from '../reference/guideSets';
import { memberIn, startingLanguage } from '../reference/languageChoices';
import { docLanguage, readerLanguage, sameLanguage } from '../reference/languages';
import { ReferenceLanguagePage } from '../reference/ReferenceLanguagePage';
import { useReferenceLanguages } from '../reference/useReferenceLanguages';
import { ReadyChecklist } from '../admin/ready';
import { howItWorks, plainRoleHelp } from '../admin/readyText';
import { usePendingRequests, usePlainRoles, useReadySummary } from '../admin/useReadySummary';
import { personLook } from '../ui/people';
import { PersonAvatar } from '../ui/UserChip';
import { usePerson } from '../ui/usePerson';
import { clusterEvents, clusterNamed, languagesOutsideClusters, newClusterId, ungroupEvents } from '../clusters/model';
import { ClusterRow, ClusterTile, LanguageClustersRow } from '../clusters/parts';
import { appendClusterEvents } from '../clusters/clusterActions';

/**
 * What to say when something fails (error-tracking): a command's own reason,
 * or, for a fault, a code a tester can read out, having reported it.
 */
const failure = failureMessage;

// ---- shared reading ----------------------------------------------------------------------

/**
 * Names and progress for the open organization, derived once per fold.
 * Every language the organization lists is here (docs/decisions.md 63). A
 * phone pulls just the language it has open, so the others' progress comes
 * from the dashboard's server when it can be reached (decision 44).
 */
function useOrgView(ctx: Ctx) {
  const state = ctx.language.state;
  const org = ctx.org.state;
  const openId = ctx.language.languageId;
  const summary = useOrgSummary(ctx.session.actorId, ctx.language.orgId);
  const local = useMemo(() => {
    const out = new Map<string, LanguageProgress>();
    if (state && openId) out.set(openId, languageProgress(state, indexesFor(state)));
    return out;
  }, [state, openId]);
  const languages = useMemo(() => ctx.languages.map((l) => l.languageId), [ctx.languages]);
  // The open language from this phone's fold, the others from the dashboard's server (decision 44).
  const progress = useMemo(() => new Map([...languageFigures(languages, local, summary)].map(([id, f]) => [id, f.progress])), [languages, local, summary]);
  const orgName = org?.org?.value.name ?? t('org.home.title');
  const label = (languageId: string) => languageName(org, languageId);
  /** Progress of a language, folded here or from the server; null when neither knows it. */
  const progressOf = (languageId: string): HomeProgress | null => progress.get(languageId) ?? null;
  const allKnown = languages.every((l) => progress.has(l));
  const orgProgress = allKnown ? sumProgress(languages.map((l) => progress.get(l)!)) : null;
  /** "Dinka" or "Wycliffe Associates": where a membership applies. */
  const target = (scope: Scope) => (scope.level === 'language' ? label(scope.languageId) : orgName);
  return { state, org, openId, orgName, languages, label, progressOf, orgProgress, target };
}

function roleName(ctx: Ctx, roleId: string): string {
  return ctx.org.state?.roles[roleId]?.name.value || SEED_ROLES.find((r) => r.roleId === roleId)?.name || roleId;
}

function liveRoles(ctx: Ctx): { id: string; name: string; privileges: number }[] {
  return Object.entries(ctx.org.state?.roles ?? {}).filter(([, r]) => !r.retired)
    .map(([id, r]) => ({ id, name: r.name.value || id, privileges: r.privileges.value?.length ?? 0 }))
    .sort((a, b) => b.privileges - a.privileges || a.name.localeCompare(b.name));
}


// ---- level home building blocks ----------------------------------------------------------------

// Every home follows one shape (ADR-029; Hick's law, progressive
// disclosure): one main button at the top, then what people open most (the
// languages, then People), then everything set up once and rarely touched in
// one collapsed "Setup" card, never nested deeper than that.

/** A home section: label, a card of rows, and an add row. Always open (ADR-029). */
function HomeSection(props: { label: string; add?: { label: string; onPress: () => void; help?: string } | undefined; children?: ReactNode }) {
  return (
    <View>
      <SectionLabel label={props.label} />
      <Group>
        {props.children}
        {props.add ? <Row icon="plus" label={props.add.label} help={props.add.help} onPress={props.add.onPress} last /> : null}
      </Group>
    </View>
  );
}

/** The one main button at the top of a home. */
function HomePrimary(props: { label: string; icon: IconName; onPress: () => void; help?: string }) {
  return <PrimaryBtn label={props.label} icon={props.icon} help={props.help} onPress={props.onPress} />;
}

/** Demo HomeProgressBars: recorded and done, each with its count. */
function HomeProgressBars(props: { p: HomeProgress }) {
  const pct = (n: number) => (props.p.total === 0 ? 0 : Math.round((n / props.p.total) * 100));
  // Bars and bare counts: help says what they count.
  return (
    <HelpInfo label={t('org.progress.label')} detail={t('org.progress.help')} style={{ gap: space.sm }}>
      {([[t('org.progress.recorded'), props.p.recorded, C.primary], [t('org.progress.done'), props.p.done, C.green]] as const).map(([label, n, color]) => (
        <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text style={[txt.xsStrong, { width: 72 }]}>{label}</Text>
          <View style={{ flex: 1 }}><ProgressBar value={pct(n)} color={color} /></View>
          <Text style={[txt.xsStrong, { color: C.dark, minWidth: 72, textAlign: 'right' }]}>
            {formatNumber(n)}/{formatNumber(props.p.total)}
          </Text>
        </View>
      ))}
    </HelpInfo>
  );
}

type HomeId = 'org_home' | 'language_home';

/**
 * Setup (ORG-1, ADR-029): content templates, reference material, review
 * flows, roles and the home's other set-once rows, together behind one tap.
 * Only the rows this person may open, each saying what the languages under
 * this home use. Open state is kept across Back.
 */
function HomeSetup(props: { ctx: Ctx; from: HomeId; level: ScopeLevel; languageIds: string[]; languageId?: string; extra?: { label: string; rows: ReactNode } }) {
  const { ctx, languageIds } = props;
  const state = ctx.language.state;
  const can = ctx.session.can;
  const params = { level: props.level, ...(props.languageId ? { languageId: props.languageId } : {}) };
  // Only the open language is on this phone; the others are their own streams (decision 63).
  const counts = useMemo(() => {
    if (!state || !ctx.language.languageId) return { study: 0, questions: 0, terms: 0, template: null as string | null, flow: null as string | null };
    const mats = materialsFor(state);
    const template = state.template?.value;
    return {
      study: mats.filter((m) => m.kind === 'fia_study').length,
      questions: mats.filter((m) => m.kind === 'questions').length,
      terms: keyTermsFor(state).length,
      template: template ? libraryItemView(ctx.org.state?.library ?? {}, template.itemId)?.name ?? t('org.setup.aTemplate') : null,
      flow: state.flow ? deriveFlow(state).name : null
    };
  }, [state, ctx.language.languageId, ctx.org.state]);
  /** What the open language uses ("FIA passages applied"), or at the organization, that and how many languages. */
  const applied = (name: string | null) => props.level === 'language'
    ? (name ? t('org.setup.applied', { name }) : t('org.setup.noneApplied'))
    : languageIds.length === 0 ? t('org.setup.noLanguages') : [name ?? t('org.setup.none'), t('org.setup.languages', { count: languageIds.length })].join(' · ');
  const templates = can('manage_templates');
  const reference = can('manage_reference');
  const flows = can('manage_flows');
  const open = ctx.details(`home:${props.from}:setup`);
  // What is behind the tap, the first one said as a list starts ("Content templates, reference, …").
  const parts: [string, string][] = [
    ...(templates ? [[t('org.setup.summary.templates'), t('org.setup.summary.templates')] as [string, string]] : []),
    ...(reference ? [[t('org.setup.summary.referenceFirst'), t('org.setup.summary.reference')] as [string, string]] : []),
    ...(flows ? [[t('org.setup.summary.flowsFirst'), t('org.setup.summary.flows')] as [string, string]] : []),
    [t('org.setup.summary.rolesFirst'), t('org.setup.summary.roles')],
    ...(props.extra ? [[props.extra.label, props.extra.label] as [string, string]] : [])
  ];
  const summary = parts.map(([first, later], i) => (i === 0 ? first : later)).join(t('admin.list.separator'));
  // A language's page has its own setup now (LanguageHome: the four questions, then More).
  return (
    <View style={{ paddingTop: space.md }}>
      <Disclosure icon="settings" title={t('org.setup.title')} summary={summary} open={open.open} onToggle={open.onToggle}
        {...(open.open ? {} : { help: t('org.setup.titleHelp') })}>
        {templates ? <Row icon="template" label={t('org.setup.templates')} sub={applied(counts.template)} help={t('org.setup.templatesHelp')} onPress={() => ctx.go('templates_home', params)} /> : null}
        {reference ? <Row icon="book" label={t('org.setup.reference')} help={t('org.setup.referenceHelp')} onPress={() => ctx.go('reference_home', params)}
          sub={t('org.setup.referenceSub', { study: formatNumber(counts.study), questions: formatNumber(counts.questions), terms: formatNumber(counts.terms) })} /> : null}
        {flows ? <Row icon="flow" label={t('org.setup.flows')} sub={applied(counts.flow)} help={t('org.setup.flowsHelp')} onPress={() => ctx.go('flows_home', params)} /> : null}
        <Row icon="star" label={t('org.setup.roles')} sub={t('org.setup.rolesSub', { count: liveRoles(ctx).length })} help={t('org.setup.rolesHelp')} onPress={() => ctx.go('roles_home', params)}
          last={!props.extra} />
        {props.extra?.rows}
      </Disclosure>
    </View>
  );
}

/** People: who is assigned here (Members). A check's people are on the check itself (decision 91). */
function PeopleRows(props: { ctx: Ctx; level: ScopeLevel; languageId?: string }) {
  const { ctx } = props;
  const entries = useMemo(() => memberEntries(ctx.org.state), [ctx.org.state]);
  const here = membersAt(entries, props.level, props.languageId).length;
  const people = new Set(entries.map((e) => e.profileId)).size;
  const sub = props.level === 'language' ? t('org.people.assignedHere', { count: here }) : t('org.people.orgSub', { here: formatNumber(here), total: formatNumber(people) });
  const params = { level: props.level, ...(props.languageId ? { languageId: props.languageId } : {}) };
  return (
    <HomeSection label={t('org.people.title')}>
      <Row icon="people" label={t('org.people.members')} sub={sub} help={t('org.people.membersHelp')} onPress={() => ctx.go('members_list', params)} last />
    </HomeSection>
  );
}

function Loading(props: { title: string; onBack?: () => void }) {
  return (
    <Screen header={<Header title={props.title} onBack={props.onBack} />}>
      <EmptyState icon="cloud" title={t('org.loading.title')} sub={t('org.loading.sub')} />
    </Screen>
  );
}

// ---- Org Home -----------------------------------------------------------------------------------

/**
 * The organization and its languages (demo OrgHome with ProjectHome's
 * language list folded in): its languages, what they use and who is
 * assigned. Each language is its own stream (decision 63): the open one's
 * progress is folded here, the others' come from the dashboard's server.
 */
export function OrgHome(ctx: Ctx) {
  const v = useOrgView(ctx);
  const [shown, setShown] = useState(20);
  const beside = useOpenDetail();
  if (!v.org || !v.state) return <Loading title={t('org.home.title')} />;
  const mine = Object.values(v.org.members[ctx.session.actorId] ?? {}).find((m) => m.removed.value === false && m.scope.level === 'org');
  const memberCount = new Set(memberEntries(v.org).map((e) => e.profileId)).size;
  // Adding a language is the organization's to do: org-scope Manage structure.
  const mayAdd = privilegesFor(v.org, ctx.session.actorId).has('manage_structure');
  // The demo's "Invite people" (gate assigner), and Invite itself, which a role may hold without assigning: it asks both.
  const canInvite = edgeAllowed(edgeFor('org_home', 'invite_member')!, ctx.session) && ctx.session.can('invite_members');
  // Clusters first, then the languages in none (decision 108): a language in a cluster shows under it.
  const clusters = orgClusters(v.org);
  const loose = languagesOutsideClusters(v.org, v.languages);
  return (
    <Screen header={<Header title={v.orgName} />}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ width: tile.lg, height: tile.lg, borderRadius: radius.lg, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' }}>
            <Ico name="building" size={28} color={C.primary} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={txt.h3}>{v.orgName}</Text>
            {/* Also a row inside Setup. Named here so the home shows the license without opening Setup. */}
            <HelpInfo label={licenseText(orgLicense(v.org)).name} detail={t('org.home.licenseHelp')} style={{ alignSelf: 'flex-start' }}>
              <Text style={txt.xs}>{licenseText(orgLicense(v.org)).name}</Text>
            </HelpInfo>
            <Text style={txt.xs}>{t('org.home.languages', { count: v.languages.length })} · {t('org.home.members', { count: memberCount })}</Text>
            {mine ? (
              <View style={{ flexDirection: 'row' }}>
                <HelpInfo label={roleName(ctx, mine.roleId.value)} detail={t('org.home.roleHelp')}><Badge label={roleName(ctx, mine.roleId.value)} tone="brand" /></HelpInfo>
              </View>
            ) : null}
          </View>
        </View>
        {v.languages.length && v.orgProgress ? <HomeProgressBars p={v.orgProgress} /> : null}
      </Card>
      {canInvite ? <HomePrimary label={t('org.home.invite')} icon="plus" help={t('org.home.inviteHelp')} onPress={() => ctx.go('invite_member', { level: 'org' })} /> : null}
      <HomeSection label={t('org.home.languagesTitle')}
        add={mayAdd ? { label: t('org.home.newLanguageOrCluster'), help: t('org.home.newLanguageHelp'), onPress: () => ctx.go('new_language') } : undefined}>
        {v.languages.length === 0 ? (
          <View style={{ padding: space.lg }}><Text style={txt.smMuted}>{t('org.home.noLanguages')}</Text></View>
        ) : null}
        {clusters.map((c) => (
          <ClusterRow key={c.clusterId} ctx={ctx} c={c} current={beside?.screen === 'cluster_home' && beside.params['clusterId'] === c.clusterId} />
        ))}
        {loose.slice(0, shown).map((languageId) => <LanguageListRow key={languageId} ctx={ctx} v={v} languageId={languageId} />)}
      </HomeSection>
      <ShowMore remaining={loose.length - shown} step={20} onMore={() => setShown((n) => n + 20)} />
      <PeopleRows ctx={ctx} level="org" />
      <HomeSetup ctx={ctx} from="org_home" level="org" languageIds={v.languages}
        extra={{ label: t('org.setup.summary.nameAndLicense'), rows: <><OrgNameSection ctx={ctx} /><LicenseSection ctx={ctx} /></> }} />
    </Screen>
  );
}

/** A language in a home's list: its name, its flow when it is open here, and its progress. */
function LanguageListRow(props: { ctx: Ctx; v: ReturnType<typeof useOrgView>; languageId: string; bar?: boolean; last?: boolean }) {
  const { ctx, v, languageId } = props;
  const beside = useOpenDetail();
  const p = v.progressOf(languageId);
  // Only the open language's flow is on this phone.
  const flow = languageId === v.openId && v.state?.flow ? `${deriveFlow(v.state).name} · ` : '';
  return (
    <Row icon="globe" label={v.label(languageId)} onPress={() => ctx.go('language_home', { languageId })} last={!!props.last}
      help={props.bar && p && p.total > 0 ? t('clusters.home.languageHelp') : t('org.home.languageHelp')}
      current={beside?.screen === 'language_home' && beside.params['languageId'] === languageId}
      sub={p ? `${flow}${progressLine(p)}` : t('org.home.openToBring')}
      below={props.bar && p && p.total > 0 ? <ProgressBar value={Math.round((p.recorded / p.total) * 100)} color={C.primary} /> : undefined} />
  );
}

// ---- A cluster -----------------------------------------------------------------------------------

/**
 * A cluster's page (decision 108, demo ADR-045): its languages and their
 * progress together, and what changes it: adding a language, new or
 * already here, renaming it, and ungrouping it. A cluster is only a name:
 * none of this changes a language, its people or its stream.
 */
export function ClusterHome(ctx: Ctx) {
  const v = useOrgView(ctx);
  const clusterId = ctx.params['clusterId'] ?? '';
  const [sheet, setSheet] = useState<'add' | 'rename' | 'ungroup' | null>(null);
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [rename, setRename] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!v.org) return <Loading title={t('screens.cluster_home')} onBack={ctx.back} />;
  const c = orgClusters(v.org).find((x) => x.clusterId === clusterId);
  if (!c) {
    // Every language taken out of it, here or on another device: the cluster is gone, its languages are not.
    return (
      <Screen header={<Header title={clusterName(v.org, clusterId) ?? t('screens.cluster_home')} onBack={ctx.back} />}>
        <EmptyState icon="layers" title={t('clusters.home.gone')} sub={t('clusters.home.goneSub', { org: v.orgName })} />
      </Screen>
    );
  }
  const may = mayManageClusters(v.org, ctx.session.actorId);
  const others = v.languages.filter((id) => !c.languageIds.includes(id));
  const known = c.languageIds.every((id) => v.progressOf(id));
  const together = known ? sumProgress(c.languageIds.map((id) => v.progressOf(id)!)) : null;
  const close = () => { setSheet(null); setError(''); };
  async function run(what: string, events: Parameters<typeof appendClusterEvents>[1], done: string, after?: () => void) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await appendClusterEvents(ctx, events);
      close();
      ctx.toast(done);
      after?.();
    } catch (e) {
      setError(failure(what, e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen header={<Header title={c.name} sub={t('clusters.home.sub', { count: c.languageIds.length })} onBack={ctx.back} />}
      footer={may ? (
        <>
          <PrimaryBtn label={t('clusters.home.add')} icon="plus" onPress={() => { setAdding(new Set()); setSheet('add'); }} />
          <QuietLinks items={[
            { label: t('clusters.home.rename'), icon: 'edit', help: t('clusters.home.renameHelp'), onPress: () => { setRename(c.name); setSheet('rename'); } },
            { label: t('clusters.home.ungroup'), icon: 'layers', help: t('clusters.home.ungroupHelp'), onPress: () => setSheet('ungroup') }
          ]} />
        </>
      ) : undefined}>
      {together ? (
        <Card>
          <Text style={txt.xsStrong}>{t('clusters.home.together')}</Text>
          <HomeProgressBars p={together} />
        </Card>
      ) : null}
      <HomeSection label={t('clusters.home.itsLanguages')}>
        {c.languageIds.map((languageId, i) => <LanguageListRow key={languageId} ctx={ctx} v={v} languageId={languageId} bar last={i === c.languageIds.length - 1} />)}
      </HomeSection>
      <Sheet visible={sheet === 'add'} title={t('clusters.add.title', { cluster: c.name })} onClose={close}
        footer={others.length ? <PrimaryBtn label={t('clusters.add.button')} icon="check" busy={busy} disabled={adding.size === 0} help={t('clusters.add.buttonHelp')}
          // i18n-ignore: the first argument is a log label
          onPress={() => void run('add to cluster', clusterEvents(v.org, { clusterId, add: [...adding] }), t('clusters.add.done', { count: adding.size, cluster: c.name }))} /> : undefined}>
        {v.org && privilegesFor(v.org, ctx.session.actorId).has('manage_structure') ? (
          <Group>
            <Row leading={<ClusterTile size={40} />} label={t('clusters.add.newLanguage')} sub={t('clusters.add.newLanguageSub', { cluster: c.name })} last
              onPress={() => { close(); ctx.go('new_language', { clusterId }); }} />
          </Group>
        ) : null}
        {others.length ? (
          <View>
            <SectionLabel label={t('clusters.add.alreadyIn', { org: v.orgName })} />
            {others.map((id, i) => (
              <CheckRow key={id} label={v.label(id)} checked={adding.has(id)} last={i === others.length - 1}
                detail={adding.has(id) ? t('clusters.add.pickedHelp') : t('clusters.add.pickHelp')}
                onToggle={() => setAdding((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; })} />
            ))}
          </View>
        ) : <Text style={txt.smMuted}>{t('clusters.add.none', { org: v.orgName })}</Text>}
        {error ? <Banner icon="flag" tone="amber" title={t('clusters.home.notSaved')} body={error} /> : null}
      </Sheet>
      <Sheet visible={sheet === 'rename'} title={t('clusters.rename.title', { cluster: c.name })} onClose={close}
        footer={<PrimaryBtn label={t('clusters.rename.save')} icon="check" busy={busy} disabled={!rename.trim() || rename.trim() === c.name} help={t('help.details.save')}
          // i18n-ignore: the first argument is a log label
          onPress={() => void run('rename cluster', clusterEvents(v.org, { clusterId, name: rename }), t('clusters.rename.done', { name: rename.trim() }))} />}>
        <Field label={t('clusters.rename.label')} value={rename} onChangeText={setRename} autoCapitalize="words" />
        {error ? <Banner icon="flag" tone="amber" title={t('clusters.home.notSaved')} body={error} /> : null}
      </Sheet>
      <Sheet visible={sheet === 'ungroup'} title={t('clusters.ungroup.title', { cluster: c.name })} onClose={close}
        footer={<>
          <PrimaryBtn label={t('clusters.ungroup.confirm')} icon="layers" busy={busy} help={t('clusters.ungroup.confirmHelp')}
            // i18n-ignore: the first argument is a log label
            onPress={() => void run('ungroup cluster', ungroupEvents(v.org, clusterId), t('clusters.ungroup.done', { cluster: c.name }), ctx.back)} />
          <QuietLinks items={[{ label: t('clusters.ungroup.keep'), icon: 'close', help: t('clusters.ungroup.keepHelp'), onPress: close }]} />
        </>}>
        <Text style={txt.body}>{t('clusters.ungroup.body', { count: c.languageIds.length })}</Text>
        {error ? <Banner icon="flag" tone="amber" title={t('clusters.home.notSaved')} body={error} /> : null}
      </Sheet>
    </Screen>
  );
}

/**
 * A name row that whoever may rename opens into a sheet: the organization's
 * and a language's. Names identify nothing (decision 76), so a rename is
 * how two alike are told apart. `warn` says what the new name repeats.
 */
function RenameRow(props: {
  ctx: Ctx; current: string; may: boolean; title: string; sub: string; what: string;
  warn?: (name: string) => string | null; save: (name: string) => Promise<void>; last?: boolean;
}) {
  const { ctx, current } = props;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const next = name.trim();
  const warning = next && next !== current ? props.warn?.(next) ?? null : null;
  async function save() {
    if (!next || next === current) return;
    setBusy(true);
    setError('');
    try {
      await props.save(next);
      setOpen(false);
      ctx.toast(t('org.rename.done', { name: next }));
    } catch (e) {
      setError(failure(props.what, e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Row icon="edit" label={t('org.rename.row')} sub={current} last={props.last} help={t('org.rename.rowHelp')}
        {...(props.may ? { onPress: () => { setName(current); setError(''); setOpen(true); } } : {})} />
      <Sheet visible={open} title={props.title} sub={props.sub} onClose={() => setOpen(false)}
        footer={<PrimaryBtn label={t('org.rename.save')} icon="check" busy={busy} disabled={!next || next === current} onPress={() => void save()} />}>
        <Field label={t('org.itsName')} value={name} onChangeText={setName} placeholder={current} autoCapitalize="words" />
        {warning ? <Banner icon="flag" tone="amber" title={t('org.rename.taken')} body={warning} /> : null}
        {error ? <Banner icon="flag" tone="amber" title={t('org.rename.failed')} body={error} /> : null}
      </Sheet>
    </>
  );
}

/**
 * Which language in the world it is: its link to the language list
 * (docs/languoids.md). One added offline, or not found there, is unlinked
 * until someone who may rename it links it here (v1.LanguageCodeSet); the
 * link also gives it the list's code. Its name stays its own.
 */
function LanguoidLinkRow(props: { ctx: Ctx; languageId: string; name: string; code: string; languoidId: string | null; may: boolean; last?: boolean }) {
  const { ctx } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<LanguoidHit | null>(null);
  const search = useLanguoidSearch(query, open && !picked);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const linked = !!props.languoidId;
  const linkedName = useLanguoidName(props.languoidId);
  async function link() {
    if (!picked) return;
    setBusy(true);
    setError('');
    try {
      await ctx.org.append('v1.LanguageCodeSet', { languageId: props.languageId, code: picked.code, languoidId: picked.id });
      setOpen(false);
      ctx.toast(t('org.link.done', { name: props.name, linked: picked.name }));
    } catch (e) {
      setError(failure('link language', e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Row icon="globe" label={t('org.link.row')}
        sub={linked ? (linkedName ? t('org.link.linkedTo', { name: linkedName, code: props.code.toUpperCase() }) : t('org.link.linked', { code: props.code.toUpperCase() })) : t('org.link.notLinked')}
        last={props.last} {...(!linked && props.may ? { badge: t('org.link.linkIt'), badgeTone: 'amber' as const } : {})}
        help={linked ? t('org.link.rowHelp') : t('org.link.rowLinkHelp')}
        {...(props.may ? { onPress: () => { setQuery(props.name); setPicked(null); setError(''); setOpen(true); } } : {})} />
      <Sheet visible={open} title={linked ? t('org.link.titleAgain', { name: props.name }) : t('org.link.title', { name: props.name })} onClose={() => setOpen(false)}
        sub={t('org.link.sub', { name: props.name })}
        footer={<PrimaryBtn label={t('org.link.linkIt')} icon="check" busy={busy} disabled={!picked} onPress={() => void link()} />}>
        <SearchField value={query} onChangeText={(q) => { setQuery(q); setPicked(null); }} placeholder={t('org.link.searchPlaceholder')} />
        <LanguoidPicker search={search} picked={picked} onPick={setPicked}
          unlisted={t('org.link.unlisted')} unreachable={t('org.link.unreachable')} />
        {error ? <Banner icon="flag" tone="amber" title={t('org.link.failed')} body={error} /> : null}
      </Sheet>
    </>
  );
}

/**
 * The organization's name. Two organizations made offline can share one,
 * so an Organization Admin may rename theirs (decision 76). Everyone sees
 * the name; only they may change it. Not in the partner demo.
 */
function OrgNameSection(props: { ctx: Ctx }) {
  const { ctx } = props;
  return (
    <RenameRow ctx={ctx} current={orgName(ctx.org.state) ?? ''} may={mayRenameOrg(ctx.org.state, ctx.session.actorId)}
      title={t('org.rename.orgTitle')} sub={t('org.rename.orgSub')} what="rename organization" // i18n-ignore: log label
      save={(name) => ctx.org.append('v1.OrgRenamed', { name }).then(() => undefined)} />
  );
}

/**
 * The license the organization's work is under (docs/licensing.md). Every
 * member sees it, since it is their recordings; an Organization Admin may
 * open it further, never close it. Not in the partner demo (decision 38).
 */
function LicenseSection(props: { ctx: Ctx }) {
  const { ctx } = props;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = orgLicense(ctx.org.state);
  const may = mayChangeLicense(ctx.org.state, ctx.session.actorId);
  async function openTo(license: License) {
    // Someone else may have opened it further while the sheet was up.
    if (!isMoreOpen(license, orgLicense(ctx.org.state))) { setOpen(false); return; }
    setBusy(true);
    try {
      await ctx.org.append('v1.LicenseSet', { license });
      setOpen(false);
      ctx.toast(t('org.license.now', { license: licenseText(license).name }));
    } catch (e) {
      ctx.toast(failure('open license', e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <LicenseRow license={current} onPress={() => setOpen(true)} last />
      <LicenseSheet visible={open} mode={may ? 'open' : 'view'} current={current} busy={busy}
        onClose={() => setOpen(false)} onConfirm={(l) => void openTo(l)} />
    </>
  );
}

// ---- Language Home ----------------------------------------------------------------------------------

/**
 * A language's page (decision 71, demo ADR-039; the prototype's AdminStart
 * and LangReady): until it is ready for translators, the four questions that
 * get it ready; once it is, the same four as a summary (they record, what
 * helps them, who checks, people) with join requests under them, each row
 * opening one screen. Everything else the page had (progress, members,
 * review groups, roles, the public listing, the library behind each
 * question) is under More, one labelled tap deeper.
 */
export function LanguageHome(ctx: Ctx) {
  const v = useOrgView(ctx);
  // A language's screens are about the open language: navigating with its id opens it.
  const languageId = v.openId;
  const s = useReadySummary(ctx);
  const requests = usePendingRequests(ctx);
  const help = useHelpMode();
  const listing = usePublicListing(ctx);
  const more = ctx.details(`language_home:${languageId}:more`);
  if (!v.state) return <Loading title={t('org.language.title')} />;
  const info = languageInfo(v.org, languageId);
  if (!info) {
    return (
      <Screen header={<Header title={t('org.language.title')} onBack={ctx.back} />}>
        <EmptyState icon="globe" title={t('org.setup.noLanguages')} sub={t('org.language.addFirst')} />
      </Screen>
    );
  }
  const name = info.name;
  const atRoot = ctx.session.adminScope?.level === 'language';
  const back = atRoot ? undefined : ctx.back;
  const can = ctx.session.can;
  const params = { level: 'language', languageId };
  const openMap = () => { ctx.setLanguage(languageId); ctx.go('map_home', { languageId }); };
  const n = s.team.length;
  const joinRows = requests.length === 0 ? null : requests.length === 1 ? (
    <Row leading={<IconTile icon="people" />} label={t('org.join.wantsToJoin', { name: requests[0]!.name ?? ctx.name(requests[0]!.profileId) })} sub={t('org.join.tapToLetIn')} last
      right={<CountBadge n={1} />} help={t('org.join.oneHelp')}
      onPress={() => ctx.go('edit_member', { memberId: requests[0]!.profileId, requestId: requests[0]!.id, level: 'language', asked: requests[0]!.createdAt,
        ...(requests[0]!.message ? { message: requests[0]!.message } : {}), ...(requests[0]!.name ? { name: requests[0]!.name } : {}) })} />
  ) : (
    <Row leading={<IconTile icon="people" />} label={t('org.join.peopleWant', { count: requests.length })} sub={t('org.join.tapToLetIn')} last
      right={<CountBadge n={requests.length} />} help={t('org.join.manyHelp')} onPress={() => ctx.go('members_list', params)} />
  );
  const clusters = clustersOf(v.org, languageId);
  const showClusters = clusters.length > 0 || mayManageClusters(v.org, ctx.session.actorId);
  const moreCard = (
    <Disclosure icon="settings" title={t('org.more.title')}
      summary={[t('org.more.summary.progress'), t('org.more.summary.members'), t('org.more.summary.roles'),
        listing.may ? t('org.more.summary.publicListing') : '', t('org.more.summary.name'), t('org.more.summary.languageList'),
        showClusters ? t('org.more.summary.cluster') : ''].filter(Boolean).join(t('admin.list.separator'))}
      open={more.open} onToggle={more.onToggle} {...(more.open ? {} : { help: t('org.more.titleHelp') })}>
      <View style={{ padding: space.lg, gap: space.sm }}>
        <Text style={txt.xs}>{t('org.more.orgAndCode', { org: v.orgName, code: info.code.toUpperCase() })}</Text>
        <HomeProgressBars p={v.progressOf(languageId) ?? { total: 0, recorded: 0, done: 0 }} />
      </View>
      {s.readiness.ready ? null : <Row icon="book" label={t('org.more.seeWork')} sub={t('org.more.seeWorkSub')} onPress={openMap} />}
      <Row icon="people" label={t('org.people.members')} sub={t('org.more.membersSub', { count: membersAt(memberEntries(v.org), 'language', languageId).length, language: name })}
        help={t('org.people.membersHelp')} onPress={() => ctx.go('members_list', params)} />
      {/* Roles are the organization's: whoever may change them opens them there (decision 63). */}
      <Row icon="star" label={t('org.setup.roles')} sub={t('org.more.rolesSub', { count: liveRoles(ctx).length })} help={t('org.setup.rolesHelp')}
        onPress={() => ctx.go('roles_home', v.org && privilegesFor(v.org, ctx.session.actorId).has('manage_roles') ? { level: 'org' } : params)} />
      {can('manage_templates') ? <Row icon="template" label={t('org.more.templates')} sub={t('org.more.templatesSub')} onPress={() => ctx.go('templates_home', { level: 'language', languageId })} /> : null}
      {can('manage_reference') ? <Row icon="layers" label={t('org.more.reference')} sub={t('org.more.referenceSub')} onPress={() => ctx.go('reference_home', params)} /> : null}
      {can('manage_flows') ? <Row icon="flow" label={t('org.more.flows')} sub={t('org.more.flowsSub')} onPress={() => ctx.go('flows_home', params)} /> : null}
      {listing.may ? (
        <Row icon="globe" label={t('org.more.publicList')} sub={t('org.more.publicListSub')} role="switch" checked={listing.listed} disabled={listing.busy}
          help={listing.listed ? t('org.more.publicListOnHelp') : t('org.more.publicListOffHelp')} onPress={() => void listing.set(!listing.listed)} />
      ) : null}
      <Row icon="building" label={v.orgName} sub={t('org.more.orgPage')} onPress={() => ctx.go('org_home')} />
      {/* Its name and its link to the language list: whoever manages its structure, here or for the organization, changes them (decision 76). */}
      <RenameRow ctx={ctx} current={name} may={mayRenameLanguage(v.org, ctx.session.actorId, languageId)}
        title={t('org.rename.languageTitle', { name })} sub={t('org.rename.languageSub', { org: v.orgName, code: info.code.toUpperCase() })}
        what="rename language" // i18n-ignore: log label
        warn={(next) => {
          const alike = similarLanguages(v.org, { code: '', name: next, except: languageId });
          return alike.length ? t('org.rename.takenBody', { languages: alike.map((l) => `${l.name} (${l.code.toUpperCase()})`).join(t('admin.list.separator')) }) : null;
        }}
        save={(next) => ctx.org.append('v1.LanguageRenamed', { languageId, name: next }).then(() => undefined)} />
      <LanguoidLinkRow ctx={ctx} languageId={languageId} name={name} code={info.code} languoidId={info.languoidId}
        may={mayRenameLanguage(v.org, ctx.session.actorId, languageId)} last={!showClusters} />
      {/* The clusters it is in (decision 108): a name the organization puts on it, nothing more. */}
      <LanguageClustersRow ctx={ctx} languageId={languageId} language={name} last />
    </Disclosure>
  );
  const listingError = listing.error ? <Banner icon="flag" tone="amber" title={t('org.listing.failed')} body={listing.error} /> : null;

  if (!s.readiness.ready) {
    const next = s.readiness.current;
    return (
      <Screen header={<BigTop onBack={back} over={name} title={t('getReady.title', { language: name })} />} bodyStyle={{ gap: space.md }}
        footer={next >= 0 ? <PrimaryBtn label={questionLabel(QUESTIONS[next]!.id)} icon="right" help={t('getReady.nextQuestionHelp')}
          onPress={() => ctx.go('get_ready', { languageId, step: String(next + 1) })} /> : undefined}>
        <ReadyChecklist ctx={ctx} s={s} />
        {help ? <QuietLink icon="playSolid" label={t('admin.howItWorks.link', { length: formatClock(40_000) })} detail={t('admin.howItWorks.detail')}
          onPress={() => { help.setOn(true); help.tell(t('admin.howItWorks.title'), howItWorks(name)); }} /> : null}
        {joinRows ? <Group>{joinRows}</Group> : null}
        {moreCard}
        {listingError}
      </Screen>
    );
  }
  return (
    <Screen header={<BigTop onBack={back} {...(clusters.length ? { over: clusters.map((c) => c.name).join(t('admin.list.separator')) } : {})} title={name}
      status={t('org.language.readyStatus', { count: n })} statusTone="green" />} bodyStyle={{ gap: space.md }}
      footer={<PrimaryBtn label={t('org.more.seeWork')} icon="book" help={t('org.more.seeWorkHelp')} onPress={openMap} />}>
      <Group>
        <Row leading={<IconTile icon="file" />} label={t('org.language.theyRecord')} sub={s.lines[0]} help={t('org.language.theyRecordHelp')}
          onPress={() => ctx.go('get_ready', { languageId, step: '1', only: '1' })} />
        <Row leading={<IconTile icon="listen" />} label={t('org.language.whatHelps')} sub={s.lines[1] ?? t('org.language.nothingOffered')} help={t('org.language.whatHelpsHelp')}
          onPress={() => ctx.go('get_ready', { languageId, step: 'helps' })} />
        <Row leading={<IconTile icon="route" />} label={t('checks.title')} sub={s.lines[2]} help={t('org.language.checksHelp')}
          onPress={can('manage_flows') ? () => ctx.go('flow_editor', { languageId, steps: 'language' }) : () => ctx.go('get_ready', { languageId, step: '3' })} />
        <Row leading={<IconTile icon="qr" />} label={t('org.people.title')} sub={t('org.language.peopleSub', { count: n })} help={t('org.people.membersHelp')}
          onPress={() => ctx.go('members_list', params)} last={!joinRows} />
        {joinRows}
      </Group>
      {moreCard}
      {listingError}
    </Screen>
  );
}

// ---- Members ----------------------------------------------------------------------------------

function Avatar(props: { id: string; name?: string | undefined; size?: number }) {
  const person = usePerson();
  return <PersonAvatar look={props.name ? personLook(props.id, props.name) : person(props.id)} size={props.size ?? 40} />;
}

/** One member: role badge and edit, or view only with a lock (demo MemberRows). */
function MemberRow(props: { ctx: Ctx; e: MemberEntry; target: string; editable: boolean; level: ScopeLevel; last?: boolean }) {
  const { ctx, e } = props;
  const beside = useOpenDetail();
  return (
    <Row testID={`person-${e.profileId}`} leading={<Avatar id={e.profileId} />} label={ctx.name(e.profileId)} muted={!props.editable} last={props.last}
      current={beside?.screen === 'edit_member' && beside.params['memberId'] === e.profileId}
      sub={e.since ? t('org.members.joined', { target: props.target, when: formatAgo(decodeHlc(e.since).wallMs) }) : props.target}
      onPress={props.editable ? () => ctx.go('edit_member', { memberId: e.profileId, entry: e.key, level: props.level }) : undefined} help={t('org.members.memberHelp')}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          <Badge label={roleName(ctx, e.roleId)} tone={props.editable ? 'brand' : 'default'} />
          {props.editable ? <Ico name="right" size={22} color={C.muted} />
            : <HelpInfo label={t('common.viewOnly')} detail={t('org.members.lockedHelp')}><Ico name="lock" size={18} color={C.faint} /></HelpInfo>}
        </View>
      } />
  );
}

export function MembersList(ctx: Ctx) {
  const v = useOrgView(ctx);
  const level = parseLevel(ctx.params['level'] ?? ctx.session.adminScope?.level);
  const languageId = level === 'language' ? v.openId : undefined;
  const mayInvite = ctx.session.can('invite_members');
  const entries = useMemo(() => memberEntries(v.org), [v.org]);
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [shown, setShown] = useState(30);
  const refresh = useCallback(async () => {
    if (!mayInvite) return;
    try { setRequests(await pendingRequests(ctx.language.orgId)); } catch (e) {
      // Offline: the list is a server read with no local mirror, so it stays
      // empty rather than claiming nobody asked.
      noteExpected('members join requests', e);
    }
  }, [mayInvite, ctx.language.orgId]);
  useEffect(() => void refresh(), [refresh]);

  const current = membersAt(entries, level, languageId);
  const higher = membersAbove(entries, level);
  const params = { level, ...(languageId ? { languageId } : {}) };
  // Only at a scope where this person holds Invite (the server checks the same).
  const edit = (e: MemberEntry) => mayInvite && mayGrantAt(v.org, ctx.session.actorId, e.scope);
  const rows = (list: MemberEntry[]) => list.map((e, i) => (
    <MemberRow key={e.key} ctx={ctx} e={e} target={v.target(e.scope)} editable={edit(e)} level={level} last={i === list.length - 1} />
  ));
  const group = (by: 'language', label: string) => {
    const groups = groupBelow(entries);
    const count = [...groups.values()].reduce((n, g) => n + g.length, 0);
    const d = ctx.details(`members:${level}:${by}`);
    return (
      <View style={{ gap: space.sm }}>
        <Row icon="globe" label={label} sub={t('org.members.count', { count })} last
          help={d.open ? t('help.details.disclosureOpen') : t('org.members.byLanguageHelp')} onPress={d.onToggle} expanded={d.open} right={<Ico name={d.open ? 'up' : 'down'} size={22} color={C.primary} />} />
        {d.open ? [...groups].map(([key, list]) => (
          <View key={key} style={{ gap: space.xs }}>
            <Text style={[txt.label, { paddingHorizontal: space.xs }]}>
              {v.label(key)} · {formatNumber(list.length)}
            </Text>
            <Group>{rows(list)}</Group>
          </View>
        )) : null}
      </View>
    );
  };
  if (!v.org) return <Loading title={t('org.people.members')} onBack={ctx.back} />;
  const total = formatNumber(current.length + requests.length);
  return (
    <Screen header={<Header title={t('org.people.members')} onBack={ctx.back}
      action={mayInvite ? <SmallBtn label={t('org.members.invite')} icon="plus" tone="primary" help={t('org.home.inviteHelp')} onPress={() => ctx.go('invite_member', params)} /> : undefined} />}>
      <Text style={txt.xs}>{level === 'org' ? t('org.members.introOrg') : t('org.members.introLanguage')}</Text>
      <SectionLabel label={level === 'org' ? t('org.members.sectionOrg', { total }) : t('org.members.sectionLanguage', { total })} />
      <Group>
        {requests.map((r) => (
          <Row key={r.id} leading={<Avatar id={r.profileId} name={r.name} />} label={r.name ?? ctx.name(r.profileId)} sub={r.message || t('admin.asked.toJoin')}
            help={t('org.members.requestHelp')} onPress={() => ctx.go('edit_member', { memberId: r.profileId, requestId: r.id, level, ...(r.name ? { name: r.name } : {}) })}
            right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}><Badge label={t('org.members.pending')} tone="amber" /><Ico name="right" size={22} color={C.muted} /></View>} />
        ))}
        {rows(current.slice(0, shown))}
        {current.length === 0 && requests.length === 0 ? (
          <View style={{ padding: space.lg }}><Text style={txt.smMuted}>{t('org.members.none')}</Text></View>
        ) : null}
      </Group>
      <ShowMore remaining={current.length - shown} step={30} onMore={() => setShown((n) => n + 30)} />
      {level !== 'language' ? (
        <>
          <SectionLabel label={t('org.members.expandBy')} />
          {group('language', t('org.members.byLanguage'))}
        </>
      ) : null}
      {higher.length > 0 ? (
        <>
          <SectionLabel label={t('org.members.higher')} />
          <Group>{higher.map((e, i) => <MemberRow key={e.key} ctx={ctx} e={e} target={v.target(e.scope)} editable={false} level={level} last={i === higher.length - 1} />)}</Group>
        </>
      ) : null}
    </Screen>
  );
}

// ---- Invite, and editing a member (one form, as in the demo) ------------------------------------

/** A list of choices on one card, the chosen one ticked; a screen reader hears radio buttons and which is selected. */
function Choices(props: { items: { id: string; label: string; sub?: string; badge?: string; help?: string }[]; value: string; onChoose: (id: string) => void; empty?: string }) {
  if (props.items.length === 0) return <Text style={txt.smMuted}>{props.empty ?? t('org.choices.empty')}</Text>;
  return (
    <Group>
      {props.items.map((it, i) => (
        <Row key={it.id} label={it.label} sub={it.sub} badge={it.badge} help={it.help} onPress={() => props.onChoose(it.id)} last={i === props.items.length - 1}
          role="radio" selected={props.value === it.id}
          right={props.value === it.id ? <Ico name="check" size={22} color={C.primary} /> : <View style={{ width: 22 }} />} />
      ))}
    </Group>
  );
}

/** What the invite and member forms edit. */
interface Assignment {
  roleId: string;
  level: ScopeLevel;
  languageId: string;
}

const TO_ROLE_EDITOR = ['invite_member', 'edit_member'] as const;

/** Role, assignment scope, and the language it applies to (ORG-6, ORG-7). */
function AssignmentForm(props: {
  ctx: Ctx;
  roles: { id: string; name: string; sub?: string }[];
  levels: ScopeLevel[];
  value: Assignment;
  onChange: (v: Assignment) => void;
}) {
  const { ctx, value } = props;
  const v = useOrgView(ctx);
  // The languages this person may grant in, and the one already chosen when editing.
  const granted = grantableLanguages(v.org, ctx.session.actorId);
  const languages = value.languageId && !granted.includes(value.languageId) ? [value.languageId, ...granted] : granted;
  return (
    <>
      <SectionLabel label={t('admin.invite.whatWillTheyDo')} />
      {/* Something other than the usual roles: make one here (demo ADR-039, amended 2026-10-08), first and set apart (design principle 12). */}
      {ctx.session.can('manage_roles') && TO_ROLE_EDITOR.some((from) => edgeFor(from, 'role_editor')) ? (
        <DashedRow icon="plus" label={t('admin.invite.newRole')} detail={t('admin.invite.newRoleHelp')} onPress={() => ctx.go('role_editor', { roleId: 'new' })} />
      ) : null}
      <Choices items={props.roles.map((r) => ({ id: r.id, label: r.name, sub: r.sub, help: t('admin.invite.pickRoleHelp') }))} value={value.roleId}
        onChoose={(roleId) => props.onChange({ ...value, roleId })} empty={t('org.assign.noRoles')} />
      <SectionLabel label={t('org.assign.where')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {props.levels.map((l) => (
          <Chip key={l} label={levelLabel(l)} on={value.level === l} help={l === 'org' ? t('org.assign.orgHelp') : t('org.assign.languageLevelHelp')} onPress={() => {
            const languageId = l === 'language' ? value.languageId || defaultLanguage(languages, v.openId) : '';
            props.onChange({ ...value, level: l, languageId });
          }} />
        ))}
      </View>
      <Text style={txt.xs}>{t('org.assign.whereHelp')}</Text>
      {value.level === 'language' ? (
        <>
          <SectionLabel label={t('org.assign.language')} />
          <Text style={txt.xs}>{t('org.assign.languageHelp')}</Text>
          <Choices items={languages.map((id) => ({ id, label: v.label(id), help: t('org.assign.pickLanguageHelp') }))} value={value.languageId}
            onChoose={(languageId) => props.onChange({ ...value, languageId })} empty={t('org.assign.noLanguages')} />
        </>
      ) : null}
    </>
  );
}

/** The language a language-level grant starts on: the open one when it may be granted in, else the only one. */
function defaultLanguage(languages: string[], open: string): string {
  if (languages.includes(open)) return open;
  return languages.length === 1 ? languages[0]! : '';
}

function scopeOf(value: Assignment): Scope | null {
  if (value.level === 'org') return { level: 'org' };
  return value.languageId ? { level: 'language', languageId: value.languageId } : null;
}

/**
 * Invite someone (decision 71, demo ADR-039; the prototype's Invite): what
 * will they do, in plain words, then a code to scan. The email invite and a
 * code for one person by name (Invite by QR) are one quiet tap away, as are
 * the organization's other roles and a new one.
 */
export function InviteMember(ctx: Ctx) {
  const v = useOrgView(ctx);
  const level = parseLevel(ctx.params['level'] ?? ctx.session.adminScope?.level);
  const me = ctx.session.actorId;
  const granted = grantableLanguages(ctx.org.state, me);
  const mayOrg = level === 'org' && mayGrantAt(ctx.org.state, me, { level: 'org' });
  const scopes = [
    ...granted.map((id) => ({ key: id, label: v.label(id), scope: { level: 'language', languageId: id } as Scope })),
    ...(mayOrg ? [{ key: 'org', label: granted.length ? t('org.invite.allOfThem') : v.orgName, scope: { level: 'org' } as Scope }] : [])
  ];
  const asked = ctx.params['languageId'];
  const initial = asked && granted.includes(asked) ? asked : level === 'language' && granted.includes(ctx.language.languageId) ? ctx.language.languageId : mayOrg ? 'org' : granted[0] ?? '';
  const [email, setEmail] = useState<{ roleId: string; scope: Scope } | null>(null);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function send() {
    if (!email || !looksLikeEmail(address)) return;
    setBusy(true);
    setError('');
    try {
      const refused = await emailInvite(ctx.language.orgId, email.roleId, email.scope, address);
      if (refused) { setError(refused); return; }
      ctx.toast(t('org.invite.sent', { address: address.trim(), role: roleName(ctx, email.roleId) }));
      setEmail(null);
      ctx.back();
    } catch (e) {
      // Offline, or the server would not make the invite.
      noteExpected('send invite', e);
      setError(inviteFailureText(e));
    } finally {
      setBusy(false);
    }
  }
  const params = (roleId: string | null, s: { scope: Scope } | null) => ({
    level: s?.scope.level ?? level, ...(s?.scope.level === 'language' ? { languageId: s.scope.languageId } : {}), ...(roleId ? { roleId } : {})
  });
  return (
    <>
      <InviteSomeone ctx={ctx} scopes={scopes} initialScope={initial}
        header={(_shown, back, s) => <Header title={t('org.invite.title')} sub={!s ? v.orgName : s.scope.level === 'org' ? v.orgName : s.label} onBack={back} />}
        label={(s) => t('admin.invite.teamLabel', { name: s.scope.level === 'org' ? v.orgName : s.label })}
        onDone={ctx.back}
        {...(ctx.session.can('manage_roles') ? { onNewRole: () => ctx.go('role_editor', { roleId: 'new' }) } : {})}
        disabled={scopes.length === 0 ? t('org.invite.cannot') : undefined}
        links={(roleId, s) => [
          ...(roleId && s ? [{ label: t('org.invite.byEmail'), icon: 'send' as const, help: t('org.invite.byEmailHelp'), onPress: () => setEmail({ roleId, scope: s.scope }) }] : []),
          { label: t('org.invite.byName'), icon: 'user' as const, help: t('org.invite.byNameHelp'), onPress: () => ctx.go('invite_qr', params(roleId, s)) }
        ]} />
      <Sheet visible={!!email} title={t('org.invite.emailTitle')} sub={email ? `${roleName(ctx, email.roleId)} · ${email.scope.level === 'org' ? v.orgName : v.label(email.scope.languageId)}` : undefined}
        onClose={() => setEmail(null)}
        footer={<PrimaryBtn label={t('org.invite.send')} icon="send" busy={busy} disabled={!looksLikeEmail(address)} onPress={() => void send()} />}>
        <Field label={t('org.invite.emailLabel')} value={address} onChangeText={setAddress} placeholder={t('org.invite.emailPlaceholder')} keyboardType="email-address" autoCapitalize="none" />
        {error ? <Banner icon="flag" tone="amber" title={t('org.invite.notSent')} body={error} /> : null}
      </Sheet>
    </>
  );
}

/**
 * Letting someone in (decision 71, demo ADR-039; the prototype's
 * JoinRequest): what will they do, in the same plain words as inviting, and
 * in which language; then Let them in, or Say no. It decides the request
 * as Members and the Inbox always have (decide_join_request_v2).
 */
function JoinRequest(ctx: Ctx) {
  const v = useOrgView(ctx);
  const requestId = ctx.params['requestId']!;
  const memberId = ctx.params['memberId'] ?? '';
  const who = ctx.params['name'] ?? ctx.name(memberId);
  const me = ctx.session.actorId;
  const granted = grantableLanguages(v.org, me);
  const mayOrg = mayGrantAt(v.org, me, { level: 'org' });
  const [asked, setAsked] = useState(ctx.params['asked']);
  const [message, setMessage] = useState(ctx.params['message'] ?? '');
  useEffect(() => {
    if (asked) return;
    let live = true;
    // Opened from the Inbox or Members: when they asked, and what they said, come with the request.
    void pendingRequests(ctx.language.orgId).then((list) => {
      const r = list.find((x) => x.id === requestId);
      if (live && r) { setAsked(r.createdAt); setMessage(r.message); }
    }).catch((e: unknown) => noteExpected('join request', e));
    return () => { live = false; };
  }, [asked, requestId, ctx.language.orgId]);
  const [choice, setChoice] = useState<string>('translate');
  const [others, setOthers] = useState(false);
  const open = ctx.language.languageId;
  const [where, setWhere] = useState<string>(granted.includes(open) ? open : granted[0] ?? 'org');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const allowed = ctx.session.can('invite_members');
  const scope: Scope | null = where === 'org' ? (mayOrg ? { level: 'org' } : null) : { level: 'language', languageId: where };
  // Only roles they may grant where the person is let in (decisions.md 75); with no scope yet, none.
  const roles = usePlainRoles(ctx, scope ?? { level: 'org' });
  const roleId = roles.choices.find((c) => c.id === choice)?.roleId ?? roles.others.find((r) => r.id === choice)?.id ?? null;
  const first = firstName(who);
  async function decide(accept: boolean) {
    if (busy || (accept && (!roleId || !scope))) return;
    setBusy(true);
    setError('');
    try {
      if (accept) await decideRequest(requestId, true, roleId!, scope!);
      else await decideRequest(requestId, false);
      await ctx.org.sync();
      ctx.toast(!accept ? t('org.join.saidNo', { name: who })
        : scope?.level === 'language' ? t('org.join.inAsRoleIn', { name: who, role: roleName(ctx, roleId!), language: v.label(scope.languageId) })
          : t('org.join.inAsRole', { name: who, role: roleName(ctx, roleId!) }));
      ctx.back();
    } catch (e) {
      setError(failure('decide join request', e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen header={<Header title={t('org.join.wantsToJoin', { name: who })} sub={askedAgo(asked, Date.now())} onBack={ctx.back} close />}
      bodyStyle={{ paddingHorizontal: 20, gap: space.md }}
      footer={allowed ? (
        <>
          <PrimaryBtn label={t('org.join.letIn', { name: first })} icon="check" busy={busy} disabled={!roleId || !scope} onPress={() => void decide(true)} />
          <QuietLinks items={[{ label: t('org.join.sayNo'), icon: 'close', help: t('org.join.sayNoHelp'), onPress: () => void decide(false) }]} />
        </>
      ) : undefined}>
      {message ? <Text style={[txt.sm, { color: C.muted, paddingHorizontal: space.xs }]}>{t('org.join.message', { message })}</Text> : null}
      <SectionLabel label={t('admin.invite.whatWillTheyDo')} />
      {ctx.session.can('manage_roles') ? <DashedRow icon="plus" label={t('admin.invite.newRole')} detail={t('admin.invite.newRoleHelp')} onPress={() => ctx.go('role_editor', { roleId: 'new' })} /> : null}
      {roles.choices.map((c) => (
        <RadioRow key={c.id} icon={c.icon as IconName} label={c.label} help={plainRoleHelp(c.id)} on={choice === c.id} onPress={() => setChoice(c.id)} />
      ))}
      {roles.others.length ? (others ? roles.others.map((r) => (
        <RadioRow key={r.id} icon="star" label={r.name} help={t('admin.invite.pickRoleHelp')} on={choice === r.id} onPress={() => setChoice(r.id)} />
      )) : <QuietLink icon="down" label={t('admin.invite.otherRoles', { total: formatNumber(roles.others.length) })} detail={t('admin.invite.otherRolesHelp')}
        onPress={() => setOthers(true)} />) : null}
      <SectionLabel label={t('admin.invite.whichLanguage')} />
      <Pills>
        {granted.map((id) => <Chip key={id} label={v.label(id)} on={where === id} help={t('admin.invite.scopeLanguageHelp')} onPress={() => setWhere(id)} />)}
        {mayOrg ? <Chip label={granted.length ? t('org.invite.allOfThem') : v.orgName} on={where === 'org'} help={t('admin.invite.scopeOrgHelp')} onPress={() => setWhere('org')} /> : null}
      </Pills>
      {!allowed ? <Banner icon="lock" title={t('common.viewOnly')} body={t('org.join.viewOnly')} /> : null}
      {error ? <Banner icon="flag" tone="amber" title={t('org.notSaved')} body={error} /> : null}
    </Screen>
  );
}

export function EditMember(ctx: Ctx) {
  return ctx.params['requestId'] ? <JoinRequest {...ctx} /> : <MemberEditor {...ctx} />;
}

/** One member's role and where it applies (ORG-7), with their sign-in help and Remove. */
function MemberEditor(ctx: Ctx) {
  const v = useOrgView(ctx);
  const memberId = ctx.params['memberId'] ?? '';
  const requestId = ctx.params['requestId'];
  const viewLevel = parseLevel(ctx.params['level'] ?? ctx.session.adminScope?.level);
  const entries = useMemo(() => memberEntries(v.org).filter((e) => e.profileId === memberId), [v.org, memberId]);
  const entry = entries.find((e) => e.key === ctx.params['entry']) ?? entries[0];
  const pending = !!requestId;
  // The demo's "Assign a role and scope": deciding needs org-scope Invite, so every level is open.
  const levels: ScopeLevel[] = pending ? assignableLevels(v.org, ctx.session.actorId, 'org')
    : [...new Set([...(entry ? [entry.scope.level] : []), ...assignableLevels(v.org, ctx.session.actorId, viewLevel)])];
  const [form, setForm] = useState<Assignment>({
    roleId: entry?.roleId ?? '',
    level: pending ? 'org' : entry?.scope.level ?? 'org',
    languageId: entry?.scope.level === 'language' ? entry.scope.languageId : ''
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Nobody changes or removes a role that holds more than they do (decisions.md 75).
  const outranked = !!entry && !mayChangeMembership(v.org, ctx.session.actorId, memberId, entry.scope);
  const allowed = ctx.session.can('invite_members') && !outranked;
  const scope = scopeOf(form);
  // An organization always keeps someone who can manage roles (decided 2026-10-13, PEOPLE-026; the server holds it).
  const onlyManager = !pending && entry?.scope.level === 'org' && leavesNoRoleManager(v.org, memberId, undefined);
  const keepsManager = !onlyManager || !leavesNoRoleManager(v.org, memberId, scope?.level === 'org' ? form.roleId : undefined);
  // Only roles they could grant at the chosen scope, and the one held now.
  const roles = liveRoles(ctx).filter((r) => r.id === entry?.roleId || (!!scope && mayGrantRole(v.org, ctx.session.actorId, r.id, scope)));
  // A requester's name comes with the request (decisions.md 65), not from the members' names.
  const requesterName = pending ? ctx.params['name'] : undefined;
  const who = requesterName ?? ctx.name(memberId);

  async function runOrg(ops: OrgOp[]) {
    for (const op of ops) await ctx.org.append(op.type, op.payload as never);
  }
  /** Undo from the toast: the screen may be gone by then, so the outcome is a toast too. */
  async function undoOrg(ops: OrgOp[], where: string) {
    try {
      await runOrg(ops);
      ctx.toast(t('org.member.putBack'));
    } catch (e) {
      ctx.toast(t('org.member.notPutBack', { reason: failure(where, e) }));
    }
  }
  async function attempt(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await work(); ctx.back(); } catch (e) {
      setError(failure('edit member', e));
    } finally { setBusy(false); }
  }
  const save = () => attempt(async () => {
    if (!scope || !form.roleId) return;
    const role = roleName(ctx, form.roleId);
    if (pending) {
      await decideRequest(requestId!, true, form.roleId, scope);
      await ctx.org.sync();
      ctx.toast(t('org.member.isNow', { name: who, role }));
      return;
    }
    if (!entry) return;
    const plan = changeMembership(entry, { roleId: form.roleId, scope });
    if (plan.apply.length === 0) return;
    await runOrg(plan.apply);
    ctx.toast(t('org.member.isNow', { name: who, role }), () => undoOrg(plan.undo, 'undo role change')); // i18n-ignore: log label
  });
  const remove = () => attempt(async () => {
    if (!entry) return;
    const plan = removeMembership(entry);
    await runOrg(plan.apply);
    const said = entry.scope.level === 'org' ? t('org.member.removedOrg', { name: who }) : t('org.member.removedLanguage', { name: who });
    ctx.toast(said, () => undoOrg(plan.undo, 'undo remove member')); // i18n-ignore: log label
  });
  const decline = () => attempt(async () => {
    await decideRequest(requestId!, false);
    await ctx.org.sync();
    ctx.toast(t('org.member.declined', { name: who }));
  });

  if (!entry && !pending) {
    return (
      <Screen header={<Header title={t('org.member.editTitle')} onBack={ctx.back} />}>
        <EmptyState icon="user" title={t('org.member.notMember')} sub={t('org.member.notMemberSub')} />
      </Screen>
    );
  }
  const sub = pending ? (ctx.params['message'] || t('org.member.awaiting')) : `${roleName(ctx, entry!.roleId)} · ${v.target(entry!.scope)}`;
  // Save Assignment waits for a change (a request is decided by choosing, so it is ready at once).
  const changed = pending || (!!entry && !!scope && changeMembership(entry, { roleId: form.roleId, scope }).apply.length > 0);
  const ready = allowed && !!form.roleId && !!scope && changed && keepsManager;
  return (
    <Screen header={<Header title={pending ? t('org.member.assignRole') : who} sub={sub} onBack={ctx.back} />}
      footer={allowed ? (
        <>
          <PrimaryBtn label={pending ? t('org.member.assignRole') : t('org.member.saveAssignment')} disabled={!ready} busy={busy} onPress={() => void save()} />
          {pending ? <GhostBtn label={t('org.member.decline')} tone="red" help={t('org.member.declineHelp')} onPress={() => void decline()} disabled={busy} /> : null}
        </>
      ) : undefined}>
      <Row leading={<Avatar id={memberId} name={requesterName} size={48} />} label={who} sub={pending ? t('admin.asked.toJoin') : v.target(entry!.scope)} />
      {!pending && memberId ? <HelpSignIn memberId={memberId} who={who} /> : null}
      <Text style={txt.xs}>{pending ? t('org.member.introPending') : t('org.member.intro')}</Text>
      {allowed ? <AssignmentForm ctx={ctx} roles={roles} levels={levels} value={form} onChange={setForm} />
        : <Banner icon="lock" title={t('common.viewOnly')} body={outranked ? t('org.member.outranked', { name: who }) : t('org.member.viewOnly')} />}
      {allowed && onlyManager ? <Banner icon="lock" title={memberId === ctx.session.actorId ? t('org.member.onlyManagerYou') : t('org.member.onlyManager', { name: who })} body={t('org.member.onlyManagerSub')} /> : null}
      {error ? <Banner icon="flag" tone="amber" title={t('org.notSaved')} body={error} /> : null}
      {allowed && !pending && !onlyManager ? (
        // The demo has no Remove here; kept as a quiet link below the form,
        // away from Save, and it offers Undo.
        <LinkBtn label={entry!.scope.level === 'org' ? t('org.member.removeFromOrg') : t('org.member.removeFromLanguage')} color={TINT.redText}
          help={t('org.member.removeHelp')} onPress={() => { if (!busy) void remove(); }} style={{ alignSelf: 'center' }} />
      ) : null}
    </Screen>
  );
}

/**
 * Help a member without email back in on a new phone (flow F, decisions.md
 * 59): anyone who may invite them where they are shows a one-time code, and
 * they scan it from Sign In and are in, with nothing to type. "Their old
 * phone is lost" makes the code sign that phone out. Shown only when the
 * server says this session may help this person, at the top of their page so
 * a new invite (a second account) is not the first thing a helper reaches for.
 */
const HELP_ROW = { flexDirection: 'row', alignItems: 'center', gap: space.md } as const;

function HelpSignIn(props: { memberId: string; who: string }) {
  const [may, setMay] = useState(false);
  const [lost, setLost] = useState(false);
  const [key, setKey] = useState<{ code: string; signInName: string; lost: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void canHelpSignIn(props.memberId).then((ok) => { if (active) setMay(ok); });
    return () => { active = false; };
  }, [props.memberId]);
  if (!may) return null;
  const first = props.who.split(' ')[0] || props.who;
  async function make() {
    setBusy(true);
    setError('');
    try { setKey({ ...(await issueSignInCode(props.memberId, lost)), lost }); }
    catch (e) { noteExpected('sign-in code', e); setError(signInFailure(e)); }
    finally { setBusy(false); }
  }
  return (
    <>
      {key ? (
        <Card style={{ alignItems: 'center' }}>
          <QRCode value={signInUri(key.code, APP_URL)} size={200} backgroundColor={C.white} color={C.dark} />
          <Text style={txt.h3}>{t('org.signIn.codeFor', { name: props.who })}</Text>
          <Text style={[txt.smMuted, { textAlign: 'center' }]}>
            {key.lost ? t('org.signIn.howToLost', { name: first }) : t('org.signIn.howTo', { name: first })}
          </Text>
          <Text style={[txt.xs, { textAlign: 'center' }]}>{t('org.signIn.willSee', { name: first })}</Text>
        </Card>
      ) : (
        <Card>
          <View style={HELP_ROW}>
            <Ico name="lock" size={22} color={C.primary} />
            <Text style={[txt.body, { flex: 1 }]}>{t('org.signIn.noEmail', { name: first })}</Text>
          </View>
          <View style={HELP_ROW}>
            <Text style={[txt.sm, { flex: 1 }]}>{t('org.signIn.lostSignOut')}</Text>
            <Toggle on={lost} onToggle={() => setLost(!lost)} label={t('org.signIn.lost')} help={lost ? t('org.signIn.lostOnHelp') : t('org.signIn.lostOffHelp')} />
          </View>
          <PrimaryBtn label={t('org.signIn.help')} icon="qr" busy={busy} disabled={busy} help={t('org.signIn.showCodeHelp')} onPress={() => void make()} />
        </Card>
      )}
      {error ? <Banner icon="flag" tone="amber" title={t('org.noCode')} body={error} /> : null}
    </>
  );
}

// ---- Invite by QR -------------------------------------------------------------------------------------

/** Invite by QR's three steps, as the step line names them. */
function qrStep(step: number): string {
  return step === 0 ? t('org.qr.steps.role') : step === 1 ? t('org.qr.steps.name') : t('org.qr.steps.code');
}
const QR_STEP_COUNT = 3;
/** How many people a group code admits (the server allows up to 50). */
const GROUP_USES = 30;

export function InviteQr(ctx: Ctx) {
  const level = parseLevel(ctx.params['level'] ?? ctx.session.adminScope?.level);
  const me = ctx.session.actorId;
  // The language chosen on Invite someone, not just the open one.
  const scope = inviteScope(ctx.org.state, me, level, ctx.params['languageId'], ctx.language.languageId);
  /** Where the code applies, by name, so a wrong language shows. */
  const where = scope.level === 'org' ? ctx.org.state?.org?.value.name || levelLabel('org') : languageName(ctx.org.state, scope.languageId);
  // Only roles this person may grant there: nobody invites to more than they hold (decisions.md 75).
  const roles = liveRoles(ctx).filter((r) => mayGrantRole(ctx.org.state, me, r.id, scope));
  // Started from a role ("Invite someone as …"), the role is already chosen: start at the name.
  const preferred = ctx.params['roleId'];
  const [step, setStep] = useState(preferred && roles.some((r) => r.id === preferred) ? 1 : 0);
  const [roleId, setRoleId] = useState(preferred ?? '');
  const [name, setName] = useState('');
  // One person, or a group (a workshop table) that shares one code.
  const [audience, setAudience] = useState<'one' | 'group'>('one');
  const [invite, setInvite] = useState<NewInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const role = roles.find((r) => r.id === roleId) ?? null;
  const canAdvance = step === 0 ? !!role : step === 1 ? name.trim().length > 0 : true;
  async function next() {
    if (step === 0) return setStep(1);
    setBusy(true);
    setError('');
    try {
      // A role made a moment ago must be on the server before an invite names it.
      await ctx.org.sync();
      // The name goes to the server with the invite, so the person scanning
      // sees whom it is for (docs/invites-and-accounts.md section 4).
      setInvite(await issueInvite(ctx.language.orgId, roleId, scope, { label: name, maxUses: audience === 'group' ? GROUP_USES : 1 }));
      setStep(2);
    } catch (e) {
      // Offline or refused by the server.
      noteExpected('issue invite', e);
      setError(inviteFailureText(e));
    } finally {
      setBusy(false);
    }
  }
  const params = { level, ...(ctx.params['languageId'] ? { languageId: ctx.params['languageId'] } : {}) };
  // The link carries the org and the token only: a scanner shows nothing a
  // forwarded link could have altered. The name stays on this screen.
  const uri = invite ? inviteUri(ctx.language.orgId, invite.token, APP_URL) : '';
  return (
    <Screen header={<Header title={t('org.qr.title')} sub={role ? role.name : t('org.qr.sub')}
      onBack={step === 1 && !invite ? () => setStep(0) : ctx.back} />}
      footer={step < 2
        ? <PrimaryBtn label={t('org.continue')} disabled={!canAdvance} busy={busy} help={step === 0 ? t('org.qr.toNameHelp') : t('org.qr.makeCodeHelp')} onPress={() => void next()} />
        : <PrimaryBtn label={t('common.done')} icon="check" help={t('org.qr.doneHelp')} onPress={() => ctx.go('members_list', params)} />}>
      <View style={{ gap: space.xs }}>
        <Segments total={QR_STEP_COUNT} current={step} done={(i) => i < step} />
        <Text style={[txt.xs, { textAlign: 'center' }]}>
          {t('org.qr.step', { step: formatNumber(step + 1), total: formatNumber(QR_STEP_COUNT), name: qrStep(step) })}
        </Text>
      </View>
      {step === 0 ? (
        <>
          <Text style={txt.xs}>{t('org.qr.pickRole')}</Text>
          {/* A new invite for someone already on the team makes a second account (decisions.md 59). */}
          <Banner icon="lock" title={t('org.qr.alreadyTitle')} body={t('org.qr.alreadyBody')} />
          {ctx.session.can('manage_roles') ? (
            <DashedRow icon="plus" label={t('org.qr.createRole')} detail={t('admin.invite.newRoleHelp')} onPress={() => ctx.go('role_editor', { roleId: 'new' })} />
          ) : null}
          <Choices items={roles.map((r) => ({ id: r.id, label: r.name, sub: t('org.qr.privileges', { count: r.privileges }), help: t('admin.invite.pickRoleHelp') }))} value={roleId} onChoose={setRoleId}
            empty={t('org.qr.noRoles')} />
        </>
      ) : null}
      {step === 1 ? (
        <>
          <Choices items={[
            { id: 'one', label: t('org.qr.one'), sub: t('org.qr.oneSub') },
            { id: 'group', label: t('org.qr.group'), sub: t('org.qr.groupSub', { count: GROUP_USES }) }
          ]} value={audience} onChoose={(id) => setAudience(id as 'one' | 'group')} />
          <Text style={txt.xs}>{audience === 'one' ? t('org.qr.nameHelpOne') : t('org.qr.nameHelpGroup')}</Text>
          <Field label={audience === 'one' ? t('org.qr.nameLabel') : t('org.qr.groupNameLabel')} value={name} onChangeText={setName}
            placeholder={audience === 'one' ? t('org.qr.namePlaceholder') : t('org.qr.groupNamePlaceholder')} autoCapitalize="words"
            help={audience === 'one' ? t('org.qr.nameFieldHelp') : t('org.qr.groupNameFieldHelp')} />
        </>
      ) : null}
      {step === 2 && invite && role ? (
        <>
          <Card style={{ alignItems: 'center' }}>
            <QRCode value={uri} size={220} backgroundColor={C.white} color={C.dark} />
            <View style={{ alignItems: 'center', gap: 2 }}>
              <Text style={txt.h3}>{name.trim()}</Text>
              <Text style={txt.smMuted}>{role.name} · {where}</Text>
            </View>
            <Text style={[txt.xs, { textAlign: 'center' }]}>{t('org.qr.holdUp')}</Text>
          </Card>
          <Card>
            <Text style={txt.xsStrong}>{t('org.qr.orType')}</Text>
            {/* i18n-ignore: a font's name */}
            <Text selectable style={[txt.sm, { fontFamily: 'Courier' }]}>{invite.token}</Text>
            <Text style={txt.xs}>{audience === 'group'
              ? t('org.qr.shownOnceGroup', { count: GROUP_USES, date: formatDayYear(invite.expiresAt) })
              : t('org.qr.shownOnceOne', { date: formatDayYear(invite.expiresAt) })}</Text>
            <SmallBtn label={t('org.qr.share')} icon="share" help={t('org.qr.shareHelp')} onPress={() => void shareText(uri).then((r) => {
              if (r === 'copied') ctx.toast(t('admin.invite.linkCopied'));
              else if (r === 'failed') ctx.toast(t('org.qr.couldNotShare'));
            })} />
          </Card>
        </>
      ) : null}
      {error ? <Banner icon="flag" tone="amber" title={t('org.noCode')} body={error} /> : null}
    </Screen>
  );
}

// ---- New language --------------------------------------------------------------------------

/** Use a library choice here: ours as it is, a shared one followed with automatic updates (copied when its owner does not allow following). */
async function adoptChoice(lib: ReturnType<typeof useLibrary>, c: LibraryChoice): Promise<string> {
  if (c.source === 'ours') return c.item.itemId;
  return c.shared.subscribable ? lib.subscribe(c.shared, true) : lib.copy(c.shared);
}

/** Step 3's "I'll choose the steps" card. */
const CHOOSE_STEPS = 'choose';

/** "In a cluster?" on one language: a new cluster, named below it. */
const NEW_CLUSTER = 'new';

/**
 * A new language (ORG-2, decision 63; decision 71 and the prototype's
 * NewLang and NewLangFlow): one question per step, the likely answer picked.
 *   1 its name, found in the language list as it is typed (online), or
 *     a name and code of its own, unlinked until someone links it
 *   2 what it will translate (its template, and which part of the Bible)
 *   3 how recordings get checked (its review flow, or one made here with
 *     "I'll choose the steps"); Continue adds it, and offers its team the
 *     Bible and study guides named in the note, saying what it is doing
 *     part by part under a bar that keeps moving
 *   4 invite its translators (a group code to scan)
 * It is listed in the organization's stream first; its own stream then
 * starts with the template, the flow and what it is offered.
 */
/** Name, what it translates, how it is checked, the language of its reference material, invite (decision 84 added the fourth). */
const STEPS = 5;

export function NewLanguage(ctx: Ctx) {
  const state = ctx.language.state;
  const lib = useLibrary(ctx);
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  // Picked from the language list (docs/languoids.md); none leaves it unlinked, to link from its page later.
  const [picked, setPicked] = useState<LanguoidHit | null>(null);
  const search = useLanguoidSearch(name, !picked);
  // One language, or a cluster of several (decision 108, demo ADR-045). Opened from a cluster's page, one language already in it.
  const fromCluster = ctx.params['clusterId'] ?? null;
  const mayGroup = mayManageClusters(ctx.org.state, ctx.session.actorId);
  const [many, setMany] = useState(false);
  // One language: the cluster it joins (an id, NEW_CLUSTER, or none), and a new one's name.
  const [joins, setJoins] = useState<string | null>(fromCluster);
  const [newCluster, setNewCluster] = useState('');
  // A cluster: its name, the new languages it brings, and those already here it takes in.
  const [clusterTitle, setClusterTitle] = useState('');
  const [batch, setBatch] = useState<NewOne[]>([]);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  // Languages already added by a Continue that failed partway: tried again, they are not added twice.
  const madeRef = useRef(new Map<string, { languageId: string; name: string }>());
  const [scope, setScope] = useState<LanguageScope>('nt');
  const [chosenBooks, setChosenBooks] = useState<Set<string>>(new Set());
  const [flowKey, setFlowKey] = useState<string | null>(null);
  const [moreFlows, setMoreFlows] = useState(false);
  // What Continue is doing now, of the parts it will do (the step 3 screen shows them while it runs).
  const [making, setMaking] = useState<{ parts: Making[]; now: Making } | null>(null);
  const [created, setCreated] = useState<{ languages: { languageId: string; name: string }[]; cluster: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // What it translates and how the Bible is broken up (decision 74); what other languages here use comes first.
  const tq = useTranslate(ctx, null);
  const kinds = useMemo(() => (state ? deriveKinds(state) : []), [state]);
  const chk = useCheckChoices(ctx, state?.flow?.value.itemId ?? null, kinds);
  // The language its Bibles and study guides are in, a step of its own (decision 84): the admin's own when there is anything in it, else English.
  const [readsPicked, setReadsPicked] = useState<string[] | null>(null);
  const reader = readerLanguage();
  const refs = useReferenceLanguages(ctx, [...(readsPicked ?? []), reader, 'eng']);
  // The languages its Bibles and guides may be in, the main one first (decision 110).
  const readsAll = readsPicked ?? [startingLanguage(refs.choices, reader)];
  const reads = readsAll[0]!;
  const offers = useNewLanguageOffers(ctx, reads, refs.sets);
  const doc = tq.doc;
  // "I'll choose the checks": the language's own checks, edited on the Checks screen before it exists
  // (checks/draft.ts, decision 91), starting from the way picked before that.
  const choosing = flowKey === CHOOSE_STEPS;
  const flow = choosing ? null : chk.entries.find((e) => e.c.key === (flowKey ?? chk.first?.c.key)) ?? null;
  const lastFlow = useRef<FlowEntry | null>(null);
  if (flow) lastFlow.current = flow;
  const draft = useChecksDraft();
  // A draft left from an earlier New language is not this one's.
  useEffect(() => { setChecksDraft(null); return () => setChecksDraft(null); }, []);
  // What the language starts with: the way picked, copied (decision 91), or its own checks.
  const checks = choosing
    ? (draft ? { name: undefined, kinds: draft.kinds, steps: stepsOf(draft.rows) } : null)
    : flow ? { name: flow.c.name, kinds: chk.kindsOf(flow.doc), steps: flow.doc.steps } : null;
  const orgName = ctx.org.state?.org?.value.name ?? t('org.newLanguage.theOrganization');
  const title = many ? clusterTitle.trim() || t('clusters.newLanguage.theCluster') : name.trim() || t('org.newLanguage.theLanguage');
  // What Continue adds: the one language, or each new one of the cluster.
  const toMake: NewOne[] = many ? batch : [{ key: 'one', name: name.trim(), code: (picked?.code ?? code).trim(), languoidId: picked?.id ?? null }];
  const clusters = orgClusters(ctx.org.state);
  const ready1 = many ? !!clusterTitle.trim() && batch.length + existing.size > 0 : !!name.trim() && (joins !== NEW_CLUSTER || !!newCluster.trim());
  // Names and codes identify nothing, so a second Dinka is only warned about (decision 76).
  const theCode = picked?.code ?? code;
  const alike = useMemo(() => similarLanguages(ctx.org.state, { code: theCode, name }), [ctx.org.state, theCode, name]);

  function chooseSteps() {
    if (!draft) {
      const from = lastFlow.current;
      setChecksDraft({ kinds: from ? chk.kindsOf(from.doc) : kinds, rows: from ? rowsOf(from.doc.steps) : [] });
    }
    ctx.go('flow_editor', { draft: '1', name: title });
  }

  /** The cluster the new languages go in: one already here (by id, or by the same name), or a new one with its name. */
  function clusterTarget(): { clusterId: string; name?: string } | null {
    const org = ctx.org.state;
    const named = (n: string) => {
      const same = clusterNamed(org, n);
      return same ? { clusterId: same.clusterId } : { clusterId: newClusterId(n, Crypto.randomUUID()), name: n.trim() };
    };
    if (many) return named(clusterTitle);
    if (joins === NEW_CLUSTER) return newCluster.trim() ? named(newCluster) : null;
    return joins && clusterName(org, joins) ? { clusterId: joins } : null;
  }

  /** A cluster of languages already here and nothing new: it is made at once, and its page opens. */
  async function groupOnly() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const target = clusterTarget()!;
      await appendClusterEvents(ctx, clusterEvents(ctx.org.state, { ...target, add: [...existing] }));
      ctx.toast(t('clusters.newLanguage.made', { cluster: clusterTitle.trim(), count: existing.size }));
      ctx.go('cluster_home', { clusterId: target.clusterId });
    } catch (e) {
      setError(failure('new cluster', e));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const list = toMake;
    if (list.length === 0 || list.some((l) => !l.name) || busy || !tq.ready || !checks) return;
    setBusy(true);
    setError('');
    const target = clusterTarget();
    // Each part is named on screen before it starts, and the screen is drawn before the work goes on.
    const parts = newLanguageParts(offers.items.length > 0, { ...(many ? { each: list.length } : {}), cluster: !!target });
    try {
      const made = await createLanguages({
        org: ctx.org.state, actorId: ctx.session.actorId, reads, alsoReads: readsAll.slice(1), scope, chosenBooks, checks, offers: offers.items,
        languages: list, each: many, done: madeRef.current,
        cluster: target ? { ...target, ...(many ? { existing: [...existing] } : {}) } : null
      }, {
        resolveTemplate: () => tq.resolve(),
        loadDoc: async (hash) => (await loadDocs(lib.orgId, [hash])).get(hash) ?? undefined,
        adopt: (shared) => (shared.subscribable ? lib.subscribe(shared, true) : lib.copy(shared)),
        applySpecs: (itemId, opts) => lib.applySpecs(itemId, opts),
        appendOrg: (type, payload) => ctx.org.append(type, payload),
        syncOrg: () => ctx.org.sync(),
        appendToLanguage: (languageId, specs) => appendToLanguage({ orgId: ctx.language.orgId, languageId, actorId: ctx.session.actorId, specs }),
        newId: () => Crypto.randomUUID(),
        onPart: async (now) => {
          setMaking({ parts, now });
          await new Promise<void>((done) => requestAnimationFrame(() => setTimeout(done, 0)));
        },
        note: noteExpected
      });
      const group = target ? target.name ?? clusterName(ctx.org.state, target.clusterId) ?? null : null;
      const first = made.languages[0]!;
      ctx.toast(many
        ? (made.notOffered.length
          ? t('clusters.newLanguage.addedNotOffered', { count: made.languages.length, org: orgName, cluster: group ?? title, offers: joinAnd(made.notOffered) })
          : t('clusters.newLanguage.added', { count: made.languages.length, org: orgName, cluster: group ?? title }))
        : made.notOffered.length
          ? t('org.newLanguage.addedNotOffered', { language: first.name, org: orgName, offers: joinAnd(made.notOffered) })
          : t('org.newLanguage.added', { language: first.name, org: orgName }));
      // The language this person works in is the one the app opens: a cluster's first.
      ctx.setLanguage(first.languageId);
      setCreated({ languages: made.languages, cluster: many ? group : null });
      setChecksDraft(null);
      setStep(5);
    } catch (e) {
      setError(many ? failure('new cluster', e) : failure('new language', e));
    } finally {
      setBusy(false);
      setMaking(null);
    }
  }

  const header = (
    <View style={{ backgroundColor: C.bg }}>
      {/* Leaving while it is being added would leave it half made: ✕ says to wait until it is done. */}
      <Header title={t('org.home.newLanguage')} sub={t('org.newLanguage.step', { step: formatNumber(step), total: formatNumber(STEPS) })}
        onBack={making ? () => ctx.toast(t('org.newLanguage.making.wait', { language: title })) : ctx.back} close />
      <View style={{ paddingHorizontal: 20, paddingBottom: space.sm }}>
        <Segments total={STEPS} current={step - 1} done={(i) => i < step - 1} />
      </View>
    </View>
  );
  const back = step > 1 && step < 5 ? <QuietLinks items={[{ label: t('common.back'), icon: 'arrowL', help: t('org.newLanguage.backHelp'), onPress: () => setStep(step - 1) }]} /> : null;
  const bodyStyle = { paddingHorizontal: 20, gap: 14 } as const;

  if (step === 5 && created) return <NewLanguageInvite ctx={ctx} languages={created.languages} cluster={created.cluster} />;

  // Step 4: the language of its Bibles and study guides, and what will be offered in it.
  if (step === 4 && !making) {
    return (
      <Screen header={header} bodyStyle={bodyStyle}
        footer={<><PrimaryBtn label={t('org.continue')} icon="right" busy={busy} disabled={!checks || !tq.ready || !ready1}
          help={many ? t('clusters.newLanguage.addHelp', { cluster: title }) : t('org.newLanguage.addHelp', { language: title })} onPress={() => void create()} />{back}</>}>
        <ReferenceLanguagePage team={title} choices={refs.choices} value={readsAll} first={[startingLanguage(refs.choices, reader)]} onChange={setReadsPicked} loading={refs.loading}>
          {offers.names.length ? (
            <AmberNote icon="layers">
              <Trans i18nKey={goesWith(tq.doc, 'FIA') && offers.names.some((n) => /FIA/.test(n)) ? 'org.newLanguage.offerNoteFia' : 'org.newLanguage.offerNote'}
                values={{ offers: joinAnd(offers.names), language: title }} components={{ b: <Text style={{ fontWeight: '800' }} /> }} />
            </AmberNote>
          ) : offers.may && !refs.loading ? (
            <AmberNote icon="layers">
              <Trans i18nKey="org.newLanguage.offerNothing" values={{ reads: languageLabel(reads), language: title }} components={{ b: <Text style={{ fontWeight: '800' }} /> }} />
            </AmberNote>
          ) : null}
        </ReferenceLanguagePage>
        {error ? <Banner icon="flag" tone="amber" title={t('org.newLanguage.notAdded')} body={error} /> : null}
      </Screen>
    );
  }

  if (step === 1) {
    const orgLangs = ctx.languages.map((l) => l.languageId);
    // A new cluster's languages: picked from the language list one after another, or typed when it is not there.
    const addTyped = () => {
      const typed = name.trim();
      if (!typed) return;
      setBatch((cur) => [...cur, { key: Crypto.randomUUID(), name: typed, code: code.trim(), languoidId: null }]);
      setName('');
      setCode('');
    };
    const onlyExisting = many && batch.length === 0 && existing.size > 0;
    return (
      <Screen header={header} bodyStyle={bodyStyle}
        footer={onlyExisting
          ? <PrimaryBtn label={t('clusters.newLanguage.make')} icon="layers" busy={busy} disabled={!clusterTitle.trim()} onPress={() => void groupOnly()} />
          : <PrimaryBtn label={t('org.continue')} icon="right" disabled={!ready1} help={t('org.newLanguage.continueHelp')} onPress={() => setStep(2)} />}>
        {mayGroup ? (
          <>
            {/* One language, or a cluster of several (decision 108): asked first, with one language picked. */}
            <Question>{t('clusters.newLanguage.what')}</Question>
            <ChoiceCard on={!many} icon="globe" title={t('clusters.newLanguage.one')} sub={t('clusters.newLanguage.oneSub')} onPress={() => setMany(false)} />
            <ChoiceCard on={many} icon="layers" title={t('clusters.newLanguage.cluster')} sub={t('clusters.newLanguage.clusterSub')} onPress={() => { setMany(true); setPicked(null); }}>
              {many ? <Field label={t('clusters.newLanguage.clusterName')} value={clusterTitle} onChangeText={setClusterTitle}
                placeholder={t('clusters.newLanguage.clusterPlaceholder')} autoCapitalize="words" /> : null}
            </ChoiceCard>
          </>
        ) : <Question>{t('org.newLanguage.called')}</Question>}
        {many ? (
          <>
            {clusterNamed(ctx.org.state, clusterTitle) ? (
              <Text style={[txt.sm, { color: C.muted }]}>{t('clusters.newLanguage.joinsNamed', { org: orgName, cluster: clusterNamed(ctx.org.state, clusterTitle)!.name })}</Text>
            ) : null}
            <SectionLabel label={t('clusters.newLanguage.itsLanguages', { number: formatNumber(batch.length + existing.size) })} />
            {batch.length || existing.size ? (
              <Group>
                {batch.map((l) => (
                  <Row key={l.key} icon="globe" label={l.name} sub={l.code ? t('clusters.newLanguage.newWithCode', { code: l.code }) : t('clusters.newLanguage.new')}
                    right={<SmallBtn label={t('clusters.newLanguage.takeOut')} icon="close" tone="plain" help={t('clusters.newLanguage.takeOutHelp')}
                      onPress={() => setBatch((cur) => cur.filter((x) => x.key !== l.key))} />} />
                ))}
                {[...existing].map((id) => (
                  <Row key={id} icon="globe" label={languageName(ctx.org.state, id)} sub={t('clusters.newLanguage.already', { org: orgName })}
                    right={<SmallBtn label={t('clusters.newLanguage.takeOut')} icon="close" tone="plain" help={t('clusters.newLanguage.takeOutHelp')}
                      onPress={() => setExisting((cur) => { const next = new Set(cur); next.delete(id); return next; })} />} />
                ))}
              </Group>
            ) : null}
            <Field label={t('clusters.newLanguage.addOne')} value={name} onChangeText={setName} placeholder={t('org.newLanguage.namePlaceholder')} autoCapitalize="words"
              help={t('org.newLanguage.nameHelp')} />
            <LanguoidPicker search={search} picked={null}
              onPick={(h) => { if (h) { setBatch((cur) => [...cur, { key: h.id, name: h.name, code: h.code, languoidId: h.id }]); setName(''); } }}
              unlisted={t('clusters.newLanguage.unlisted')} unreachable={t('org.newLanguage.unreachable')} />
            {name.trim() && (search.status === 'none' || search.status === 'unreachable') ? (
              <>
                <Field label={t('org.newLanguage.codeLabel')} value={code} onChangeText={setCode} placeholder={t('org.newLanguage.codePlaceholder')} autoCapitalize="none" />
                <QuietLink icon="plus" label={t('clusters.newLanguage.addTyped', { name: name.trim() })} detail={t('clusters.newLanguage.addTypedHelp')} onPress={addTyped} />
              </>
            ) : null}
            {orgLangs.some((id) => !existing.has(id)) ? (
              <>
                <SectionLabel label={t('clusters.add.alreadyIn', { org: orgName })} />
                <Pills>
                  {orgLangs.filter((id) => !existing.has(id)).map((id) => (
                    <Chip key={id} label={languageName(ctx.org.state, id)} on={false} icon="plus" help={t('clusters.newLanguage.addExistingHelp')}
                      onPress={() => setExisting((cur) => new Set(cur).add(id))} />
                  ))}
                </Pills>
              </>
            ) : null}
            <Text style={[txt.sm, { color: C.muted }]}>
              {batch.length === 0 ? t('clusters.newLanguage.onlyExisting') : t('clusters.newLanguage.note', { count: batch.length })}
            </Text>
          </>
        ) : (
          <>
            {mayGroup ? <Question>{t('org.newLanguage.called')}</Question> : null}
            <Field label={t('org.itsName')} value={name} onChangeText={setName} placeholder={t('org.newLanguage.namePlaceholder')} autoCapitalize="words"
              help={t('org.newLanguage.nameHelp')} />
            <LanguoidPicker search={search} picked={picked} onPick={(h) => { setPicked(h); if (h) setName(h.name); }}
              unlisted={t('org.newLanguage.unlisted')} unreachable={t('org.newLanguage.unreachable')} />
            {picked ? null : <Field label={t('org.newLanguage.codeLabel')} value={code} onChangeText={setCode} placeholder={t('org.newLanguage.codePlaceholder')} autoCapitalize="none" />}
            {mayGroup ? (
              <>
                {/* Which cluster it joins, if any: made right here when it is new (decision 108). */}
                <SectionLabel label={t('clusters.newLanguage.inCluster')} />
                <Pills>
                  <Chip label={t('clusters.newLanguage.no')} on={joins === null} help={t('clusters.newLanguage.noHelp')} onPress={() => setJoins(null)} />
                  {clusters.map((c) => <Chip key={c.clusterId} label={c.name} icon="layers" on={joins === c.clusterId} help={t('clusters.newLanguage.joinHelp')}
                    onPress={() => setJoins(c.clusterId)} />)}
                  {fromCluster && !clusters.some((c) => c.clusterId === fromCluster) && clusterName(ctx.org.state, fromCluster) ? (
                    <Chip label={clusterName(ctx.org.state, fromCluster)!} icon="layers" on={joins === fromCluster} help={t('clusters.newLanguage.joinHelp')} onPress={() => setJoins(fromCluster)} />
                  ) : null}
                  <Chip label={t('clusters.newLanguage.newCluster')} icon="plus" on={joins === NEW_CLUSTER} help={t('clusters.newLanguage.newClusterHelp')} onPress={() => setJoins(NEW_CLUSTER)} />
                </Pills>
                {joins === NEW_CLUSTER ? <Field label={t('clusters.newLanguage.clusterName')} value={newCluster} onChangeText={setNewCluster}
                  placeholder={t('clusters.newLanguage.clusterPlaceholder')} autoCapitalize="words" /> : null}
              </>
            ) : null}
            <Text style={[txt.sm, { color: C.muted }]}>{t('org.newLanguage.goesIn', { org: orgName })}</Text>
            {alike.length ? (
              <Banner icon="flag" tone="amber" title={t('org.newLanguage.alikeTitle', { org: orgName })}
                body={t('org.newLanguage.alikeBody', { count: alike.length, languages: alike.map((l) => `${l.name} (${l.code.toUpperCase()})`).join(t('admin.list.separator')) })} />
            ) : null}
          </>
        )}
        {error ? <Banner icon="flag" tone="amber" title={t('clusters.newLanguage.notMade')} body={error} /> : null}
      </Screen>
    );
  }

  if (step === 2) {
    return (
      <Screen header={header} bodyStyle={bodyStyle}
        footer={<>
          {tq.showContinue ? <PrimaryBtn label={t('org.continue')} icon="right" disabled={tq.last ? !tq.ready : !tq.canContinue} help={t('org.newLanguage.continueHelp')}
            onPress={() => { if (!tq.advance()) setStep(3); }} /> : null}
          <QuietLinks items={[{ label: t('common.back'), icon: 'arrowL', help: t('org.newLanguage.backHelp'), onPress: () => { if (!tq.retreat()) setStep(1); } }]} />
        </>}>
        <TranslateQuestion ctx={ctx} t={tq} lang={title} canMake={ctx.session.can('manage_templates')} onMake={() => ctx.go('template_editor', { new: '1', kind: 'outline' })} />
        {doc?.bible && tq.page === 'ways' ? (
          <>
            <SectionLabel label={t('getReady.record.whichPart')} />
            <Pills>
              {/* Choose books starts from the part picked before (the New Testament, say), to change (design principle 12). */}
              {LANGUAGE_SCOPES.map((sc) => <Chip key={sc} label={languageScopeLabel(sc)} on={scope === sc}
                help={sc === 'custom' ? t('getReady.record.chooseBooksHelp') : t('getReady.record.partHelp')} onPress={() => {
                if (sc === 'custom' && scope !== 'custom' && chosenBooks.size === 0) setChosenBooks(new Set(booksInScope(doc, scope) ?? templateBooks(doc).map((b) => b.book)));
                setScope(sc);
              }} />)}
            </Pills>
            {scope === 'custom' ? (
              <Pills>
                {templateBooks(doc).map((b) => (
                  <Chip key={b.book} label={b.name || b.book} on={chosenBooks.has(b.book)} help={chosenBooks.has(b.book) ? t('getReady.record.bookOnHelp') : t('getReady.record.bookOffHelp')}
                    onPress={() => setChosenBooks((cur) => { const next = new Set(cur); if (next.has(b.book)) next.delete(b.book); else next.add(b.book); return next; })} />
                ))}
              </Pills>
            ) : null}
            <Text style={[txt.sm, { color: C.muted }]}>{t('org.newLanguage.breakUpLater')}</Text>
          </>
        ) : null}
      </Screen>
    );
  }

  if (making) {
    const at = making.parts.indexOf(making.now);
    const label = (p: Making) => p === 'passages' ? t('org.newLanguage.making.passages')
      : p === 'checks' ? t('org.newLanguage.making.checks')
        : p === 'helps' ? t('org.newLanguage.making.helps', { offers: joinAnd(offers.names) })
          : p === 'listing' ? t('org.newLanguage.making.listing', { language: title, org: orgName })
            : p === 'saving' ? t('org.newLanguage.making.saving', { language: title })
              : p === 'cluster' ? t('clusters.newLanguage.making.grouping', { cluster: many ? title : joins === NEW_CLUSTER ? newCluster.trim() : clusterName(ctx.org.state, joins ?? '') ?? '' })
                : t('clusters.newLanguage.making.adding', { language: toMake[Number(p.slice('language:'.length))]?.name ?? '' });
    return (
      <Screen header={header} bodyStyle={bodyStyle}>
        <Question>{t('org.newLanguage.making.title', { language: title })}</Question>
        <MovingBar height={8} />
        <WorkSteps items={making.parts.map((p, i) => ({ key: p, label: label(p), state: i < at ? 'done' : i === at ? 'now' : 'later' }))} />
        <Text style={[txt.sm, { color: C.muted, paddingHorizontal: space.xs }]}>{t('org.newLanguage.making.keepOpen')}</Text>
      </Screen>
    );
  }

  // Spoken's method is offered beside the suggested ways (the prototype's NewLangFlow); the rest one tap deeper.
  const spoken = chk.rest.filter((e) => /spoken/i.test(e.c.name));
  const rest = chk.rest.filter((e) => !spoken.includes(e));
  const flowCard = (e: FlowEntry) => {
    const on = flow === e;
    const from = flowFrom(e.c);
    // A long description would push the rest off the screen: then its number of checks says enough.
    const sub = e === chk.first ? t('org.newLanguage.suggested', { from }) : e.doc.description && e.doc.description.length <= 60 ? e.doc.description : `${flowSub(e.doc.steps)} · ${from}`;
    return (
      <ChoiceCard key={e.c.key} on={on} icon="route" title={e.c.name} sub={sub} help={t('getReady.checks.wayHelp')} onPress={() => setFlowKey(e.c.key)}>
        {on && e.doc.steps.length ? <NumberedSteps items={e.doc.steps.map((st) => ({ label: stepTitle(st.kindIds, chk.kindsOf(e.doc)), lock: !!st.checkpoint }))} /> : null}
      </ChoiceCard>
    );
  };
  return (
    <Screen header={header} bodyStyle={bodyStyle}
      footer={<>
        {choosing && !draft ? <PrimaryBtn label={t('getReady.checks.chooseSteps')} icon="right" onPress={chooseSteps} />
          : <PrimaryBtn label={t('org.continue')} icon="right" disabled={!checks || !tq.ready || !ready1} help={t('org.newLanguage.continueHelp')} onPress={() => setStep(4)} />}
        {back}
      </>}>
      <Question>{t('org.newLanguage.howChecked')}</Question>
      {many ? <Text style={[txt.sm, { color: C.muted }]}>{t('clusters.newLanguage.forNew', { count: batch.length, cluster: title })}</Text> : null}
      {/* Making your own comes first, set apart, so the ready-made list below can grow (design principle 12). */}
      {ctx.session.can('manage_flows') && chk.loaded ? (
        <ChoiceCard own on={choosing} icon="edit" title={t('getReady.checks.illChoose')} help={t('getReady.checks.illChooseHelp')} onPress={() => setFlowKey(CHOOSE_STEPS)}>
          {choosing && draft ? (
            <>
              <NumberedSteps items={stepsOf(draft.rows).map((st) => ({ label: stepTitle(st.kindIds, draft.kinds), lock: st.checkpoint }))} />
              <QuietLink icon="edit" label={t('checks.change')} detail={t('org.newLanguage.changeChecksHelp')} onPress={chooseSteps} />
            </>
          ) : null}
        </ChoiceCard>
      ) : null}
      {[...chk.main, ...spoken].map(flowCard)}
      {rest.length ? (moreFlows ? rest.map(flowCard)
        : <QuietLink icon="down" label={t('getReady.checks.otherWaysCount', { total: formatNumber(rest.length) })} detail={t('getReady.checks.otherWaysHelp')}
          onPress={() => setMoreFlows(true)} />) : null}
      {chk.entries.length === 0 ? <Text style={txt.smMuted}>{chk.loaded ? t('org.newLanguage.noWays') : t('common.loading')}</Text> : null}
    </Screen>
  );
}

/**
 * Where a review flow comes from, under its name: the organization it is
 * followed from or shared by, else its version ("Version 3").
 */
function flowFrom(c: LibraryChoice): string {
  if (c.source === 'shared') return t('org.newLanguage.fromOrg', { org: c.shared.org_name });
  const it = c.item;
  if (it.source === 'subscription' && it.subscription) {
    return it.subscription.active ? t('org.newLanguage.fromOrg', { org: it.subscription.sourceOrgName }) : t('org.newLanguage.stoppedFollowing', { org: it.subscription.sourceOrgName });
  }
  return it.versions.length ? t('org.newLanguage.version', { number: formatNumber(it.versions.length) }) : t('org.newLanguage.notPublished');
}

/**
 * What a new language's team is offered from the start, in the language
 * chosen for its reference material (decision 84): a Bible and study
 * guides, FIA's first, the organization's own when it has them, else what
 * LangQuest shares. A guide set (FIA) is offered in that language when it
 * has it; nothing is offered in a language it is not in.
 */
function useNewLanguageOffers(ctx: Ctx, reads: string, sets: readonly GuideSet[]) {
  const lib = useLibrary(ctx);
  const shared = useSharedItems('material', lib.orgId);
  const own = lib.items('material').filter((it) => it.current && !it.archived);
  const others = shared.rows.filter((s) => s.latest_hash && !ctx.org.state?.library[subscriptionItemId(s.org_id, s.item_id)]);
  const docs = useLibraryDocs(lib.orgId, [...own.map((it) => it.current), ...others.map((s) => s.latest_hash)], { deps: false });
  const fia = (n: string) => (/fia/i.test(n) ? 0 : /example/i.test(n) ? 2 : 1);
  const web = (n: string) => (/world english/i.test(n) ? 0 : 1);
  const pickSet = (): Offer | null => {
    for (const set of [...sets].sort((a, b) => fia(a.name) - fia(b.name))) {
      const member = memberIn(set, reads);
      if (member) {
        return { itemId: member.itemId, shared: member.shared, name: member.name, set, member,
          label: t('org.offers.guidesIn', { name: guideShortName(set.name), language: languageLabel(member.language) }) };
      }
    }
    return null;
  };
  const pick = (kind: 'source' | 'guide', rank: (n: string) => number): Offer | null => {
    // A guide still on its way is known by its name ("FIA study guides (English)"), so FIA's is offered even before it loads.
    const named = (n: string) => kind === 'guide' && reads === 'eng' && /study guides?/i.test(n) && /\(English\)/.test(n);
    const fits = (doc: LibraryDoc | null, n: string) => (doc ? refKindOf(doc) === kind && sameLanguage(docLanguage(doc) ?? 'eng', reads) : named(n));
    const mine = own.map((it) => ({ it, doc: docs.get(it.current) })).filter((x) => fits(x.doc, x.it.name))
      .sort((a, b) => rank(a.it.name) - rank(b.it.name))[0];
    if (mine) return { itemId: mine.it.itemId, shared: null, name: mine.it.name, label: kind === 'source' ? bibleOffer(mine.it.name) : guidesOffer(mine.it.name, mine.doc) };
    const theirs = others.map((s) => ({ s, doc: docs.get(s.latest_hash) }))
      .filter((x) => fits(x.doc, x.s.name))
      .sort((a, b) => rank(a.s.name) - rank(b.s.name))[0];
    if (theirs) {
      return { itemId: null, shared: theirs.s, name: theirs.s.name,
        label: kind === 'source' ? bibleOffer((theirs.doc as SourceDoc | null)?.name || theirs.s.name) : guidesOffer(theirs.s.name, theirs.doc) };
    }
    return null;
  };
  const guide = pickSet() ?? pick('guide', fia);
  const items = [pick('source', web), guide].filter((o): o is Offer => !!o);
  const may = ctx.session.can('manage_reference');
  return { items: may ? items : [], names: may ? items.map((o) => o.label) : [], guide: may ? guide : null, may };
}

/** Study guides as the offer note names them: "FIA's study guides in English", or without the language when they give none. */
function guidesOffer(name: string, doc: LibraryDoc | null): string {
  const language = docLanguage(doc);
  return language ? t('org.offers.guidesIn', { name: guideShortName(name), language: languageLabel(language) }) : t('org.offers.guides', { name: guideShortName(name) });
}

/** A Bible as the offer note names it: "the World English Bible" (an English name that reads with "the"), else its name. */
function bibleOffer(name: string): string {
  return /^World\b/.test(name) ? t('org.offers.theBible', { name }) : name;
}

/**
 * Last: invite the new language's translators (the prototype's Invite, after
 * NewLangFlow). After a cluster, its new languages are chips: a code is for
 * one language, as a membership is (decision 108: a cluster is no scope).
 */
function NewLanguageInvite(props: { ctx: Ctx; languages: { languageId: string; name: string }[]; cluster: string | null }) {
  const { ctx } = props;
  const scopes = props.languages.map((l) => ({ key: l.languageId, label: l.name, scope: { level: 'language', languageId: l.languageId } as Scope }));
  const first = props.languages[0]!;
  const may = ctx.session.can('invite_members') && scopes.every((s) => mayGrantAt(ctx.org.state, ctx.session.actorId, s.scope));
  const names = props.cluster ?? first.name;
  return (
    <InviteSomeone ctx={ctx} scopes={scopes} initialScope={first.languageId}
      header={(shown, back) => <Header title={t('org.invite.title')} sub={names} onBack={shown ? back : ctx.back} />}
      label={(scope) => t('admin.invite.teamLabel', { name: scope.label })} onDone={ctx.back}
      disabled={may ? undefined : t('org.newLanguage.inviteLater', { language: names })}
      links={() => [{ label: t('org.newLanguage.later'), icon: 'clock', help: t('org.newLanguage.laterHelp'), onPress: ctx.back }]}
      {...(ctx.session.can('manage_roles') ? { onNewRole: () => ctx.go('role_editor', { roleId: 'new' }) } : {})} />
  );
}

export const contracts = contractsFor('org_home', 'cluster_home', 'language_home', 'members_list', 'invite_member', 'invite_qr',
  'edit_member', 'new_language');
