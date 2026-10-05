// Running the organization (Manage tab). Ports the demo's src/screens/org.tsx:
// OrgHomeScreen, LanguageHomeScreen (with HomeSection, HomePrimary,
// HomeSetup, HomeProgressBars), MembersListScreen, InviteMemberScreen
// (invite and edit), InviteQrScreen, ReviewTeamsScreen,
// ReviewTeamEditorScreen and NewStructureItemScreen (new language).
// Requirements ORG-1, ORG-2, ORG-5, ORG-6, ORG-7, NAV-6, FLOW-5; ADR-017
// (admins reach these homes through Manage), ADR-025 (a language owns its
// template, starting from the one its organization suggests). The demo's
// Project Home and New Project are not ported: an organization holds its
// languages directly (docs/decisions.md 34).
import { CommandError, deriveFlow, emptyState, kindOf, partitionOfLane, isMoreOpen, keyTermsFor, laneName, languageProgress, LICENSE_INFO, materialsFor, mayChangeLicense, libraryItemView, orgLicense, SEED_ROLES, type LanguageProgress, type License, type Role, type Scope, type ScopeLevel, type EventSpec, type TemplateDoc } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { choiceLine, laneTemplateOf, libraryChoices, STARTER_TEMPLATE } from '../contentTemplates';
import type { Ctx } from '../ctx';
import { indexesFor } from '../indexes';
import { canHelpSignIn, decideRequest, inviteUri, issueInvite, issueSignInCode, pendingRequests, type NewInvite, type PendingRequest } from '../invites';
import { APP_URL } from '../appUrl';
import { signInUri } from '../inviteCode';
import {
  Badge, Banner, Card, Chip, Disclosure, EmptyState, Field, GhostBtn, Group, Header, Ico, KindIcon, LinkBtn, PrimaryBtn, ProgressBar, Row,
  Screen, SectionLabel, Segments, ShowMore, SmallBtn, Toggle, txt, useOpenDetail, type IconName
} from '../kit';
import { edgeFor } from '../flow';
import { loadDocs } from '../library/docStore';
import { sourceLine } from '../library/model';
import { useLibrary, useLibraryDocs, useSharedItems } from '../library/useLibrary';
import {
  addLanguage, assignableLevels, booksInScope, changeMembership, editableAt, grantFloor, groupBelow, LANGUAGE_SCOPES, LEVEL_LABEL,
  membersAbove, membersAt, memberEntries, newLaneId, parseLevel, progressLine, removeMembership, reviewEligible,
  saveTeam, scopeAt, suggestedTemplate, sumProgress, teamMembers,
  type HomeProgress, type LanguageScope, type MemberEntry, type OrgOp
} from '../orgAdmin';
import { plural, when } from '../passageView';
import { noteExpected, reportError, failureMessage } from '../report';
import { languagesToList } from '../languages';
import { LicenseRow, LicenseSheet } from '../licenseSheet';
import { appendToPartition } from '../partitionWriter';
import { contractsFor } from '../screenContracts';
import { laneFigures } from '../orgFigures';
import { edgeAllowed } from '../session';
import { shareText } from '../share';
import { supabase } from '../supabase';
import { C, radius, space, tile, TINT } from '../theme';
import { useOrgSummary } from '../useOrgSummary';
import { PersonAvatar, usePerson } from '../UserChip';

/**
 * What to say when something fails (error-tracking): a command's own reason,
 * or, for a fault, a code a tester can read out, having reported it.
 */
const failure = failureMessage;

// ---- shared reading ----------------------------------------------------------------------

/**
 * Names and progress for the open organization, derived once per fold.
 * Every language the organization lists is here (docs/decisions.md 37). A
 * phone pulls just the language it has open, so the others' progress comes
 * from the dashboard's server when it can be reached (decision 44).
 */
function useOrgView(ctx: Ctx) {
  const state = ctx.project.state;
  const org = ctx.org.state;
  const projectId = ctx.project.projectId;
  const summary = useOrgSummary(ctx.session.actorId, ctx.project.orgId);
  const local = useMemo(() => {
    const out = new Map<string, LanguageProgress>();
    if (!state) return out;
    const idx = indexesFor(state);
    for (const laneId of Object.keys(state.lanes)) out.set(laneId, languageProgress(state, laneId, idx));
    return out;
  }, [state]);
  const names = useMemo(() => new Map(ctx.languages.map((l) => [l.laneId, l.name])), [ctx.languages]);
  const laneLabel = (laneId: string) => (state?.lanes[laneId] ? laneName(state, laneId) : names.get(laneId) ?? laneId);
  const lanes = useMemo(() => {
    return languagesToList(ctx.languages, state, ctx.project.projectId).sort((a, b) => laneLabel(a).localeCompare(laneLabel(b)));
    // laneLabel reads state and names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.languages, state, names, ctx.project.projectId]);
  // The open language from this phone's fold, the others from the dashboard's server (decision 44).
  const progress = useMemo(() => new Map([...laneFigures(lanes, local, summary)].map(([laneId, f]) => [laneId, f.progress])), [lanes, local, summary]);
  const orgName = org?.org?.value.name ?? 'Organization';
  /** Progress of a language, folded here or from the server; null when neither knows it. */
  const laneProgress = (laneId: string): HomeProgress | null => progress.get(laneId) ?? null;
  const allKnown = lanes.every((l) => progress.has(l));
  const orgProgress = allKnown ? sumProgress(lanes.map((l) => progress.get(l)!)) : null;
  /** "Dinka", "Wycliffe Associates" or "All languages": where a membership applies. */
  const target = (scope: Scope) => scope.level === 'lane' ? (scope.laneId ? laneLabel(scope.laneId) : 'Language')
    : scope.level === 'project' ? LEVEL_LABEL.project : orgName;
  return { state, org, projectId, orgName, lanes, laneLabel, laneProgress, orgProgress, target, partitionOf: (laneId: string) => partitionOfLane(org, laneId) };
}

function roleName(ctx: Ctx, roleId: string): string {
  return ctx.org.state?.roles[roleId]?.name.value || SEED_ROLES.find((r) => r.roleId === roleId)?.name || roleId;
}

function liveRoles(ctx: Ctx): { id: string; name: string; privileges: number }[] {
  return Object.entries(ctx.org.state?.roles ?? {}).filter(([, r]) => !r.retired)
    .map(([id, r]) => ({ id, name: r.name.value || id, privileges: r.privileges.value?.length ?? 0 }))
    .sort((a, b) => b.privileges - a.privileges || a.name.localeCompare(b.name));
}

/** The lane a screen is about: its param, else the language this person works in. */
function laneParam(ctx: Ctx): string {
  const state = ctx.project.state;
  const id = ctx.params['laneId'];
  if (id && (!state || state.lanes[id])) return id;
  return ctx.laneId ?? Object.keys(state?.lanes ?? {})[0] ?? '';
}

// ---- level home building blocks ----------------------------------------------------------------

// Every home follows one shape (ADR-029; Hick's law, progressive
// disclosure): one main button at the top, then what people open most (the
// languages, then People), then everything set up once and rarely touched in
// one collapsed "Setup" card, never nested deeper than that.

/** A home section: label, a card of rows, and an add row. Always open (ADR-029). */
function HomeSection(props: { label: string; add?: { label: string; onPress: () => void } | undefined; children?: ReactNode }) {
  return (
    <View>
      <SectionLabel label={props.label} />
      <Group>
        {props.children}
        {props.add ? <Row icon="plus" label={props.add.label} onPress={props.add.onPress} last /> : null}
      </Group>
    </View>
  );
}

/** The one main button at the top of a home. */
function HomePrimary(props: { label: string; icon: IconName; onPress: () => void }) {
  return <PrimaryBtn label={props.label} icon={props.icon} onPress={props.onPress} />;
}

/** Demo HomeProgressBars: recorded and done, each with its count. */
function HomeProgressBars(props: { p: HomeProgress }) {
  const pct = (n: number) => (props.p.total === 0 ? 0 : Math.round((n / props.p.total) * 100));
  return (
    <View style={{ gap: space.sm }}>
      {([['Recorded', props.p.recorded, C.primary], ['Done', props.p.done, C.green]] as const).map(([label, n, color]) => (
        <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text style={[txt.xsStrong, { width: 72 }]}>{label}</Text>
          <View style={{ flex: 1 }}><ProgressBar value={pct(n)} color={color} /></View>
          <Text style={[txt.xsStrong, { color: C.dark, minWidth: 72, textAlign: 'right' }]}>
            {n.toLocaleString('en-US')}/{props.p.total.toLocaleString('en-US')}
          </Text>
        </View>
      ))}
    </View>
  );
}

type HomeId = 'org_home' | 'language_home';

/**
 * Setup (ORG-1, ADR-029): content templates, reference material, review
 * flows, roles and the home's other set-once rows, together behind one tap.
 * Only the rows this person may open, each saying what the languages under
 * this home use. Open state is kept across Back.
 */
function HomeSetup(props: { ctx: Ctx; from: HomeId; level: ScopeLevel; laneIds: string[]; laneId?: string; extra?: { label: string; rows: ReactNode } }) {
  const { ctx, laneIds } = props;
  const state = ctx.project.state;
  const can = ctx.session.can;
  const params = { level: props.level, ...(props.laneId ? { laneId: props.laneId } : {}) };
  const counts = useMemo(() => {
    if (!state) return { study: 0, questions: 0, terms: 0, templates: [] as string[], flows: [] as string[] };
    const mats = props.laneId ? materialsFor(state, { laneId: props.laneId }) : materialsFor(state);
    const uniq = (xs: string[]) => [...new Set(xs)];
    return {
      study: mats.filter((m) => m.kind === 'fia_study').length,
      questions: mats.filter((m) => m.kind === 'questions').length,
      terms: laneIds.reduce((n, l) => n + keyTermsFor(state, l).length, 0),
      // Only languages on this phone are known; the others are their own partitions (decisions.md 37).
      templates: uniq(laneIds.filter((l) => state.lanes[l]).map((l) => {
        const t = laneTemplateOf(state, l);
        return !t ? 'None' : t.source === 'legacy' ? t.name : libraryItemView(ctx.org.state?.library ?? {}, t.itemId)?.name ?? 'A template';
      })),
      flows: uniq(laneIds.filter((l) => state.lanes[l]).map((l) => deriveFlow(state, l).name))
    };
  }, [state, laneIds, props.laneId, ctx.org.state?.library]);
  const applied = (names: string[]) => props.level === 'lane'
    ? `${names[0] ?? 'None'} applied`
    : laneIds.length === 0 ? 'No languages yet' : `${names.join(', ')} · ${plural(laneIds.length, 'language')}`;
  const templates = can('manage_templates');
  const reference = can('manage_reference');
  const flows = can('manage_flows');
  const open = ctx.details(`home:${props.from}:setup`);
  const names = [templates && 'Content templates', reference && 'reference', flows && 'review flows', 'roles', props.extra?.label].filter(Boolean);
  const summary = names.join(', ').replace(/^./, (c) => c.toUpperCase());
  return (
    <View style={{ paddingTop: space.md }}>
      <Disclosure icon="settings" title="Setup" summary={summary} open={open.open} onToggle={open.onToggle}>
        {templates ? <Row icon="template" label="Content Templates" sub={applied(counts.templates)} onPress={() => ctx.go('templates_home', params)} /> : null}
        {reference ? <Row icon="book" label="Reference Material" onPress={() => ctx.go('reference_home', params)}
          sub={`${counts.study} study · ${counts.questions} question sets · ${counts.terms} key terms`} /> : null}
        {flows ? <Row icon="flow" label="Review Flows" sub={applied(counts.flows)} onPress={() => ctx.go('flows_home', params)} /> : null}
        <Row icon="star" label="Roles" sub={`${plural(liveRoles(ctx).length, 'role')} at this level and above`} onPress={() => ctx.go('roles_home', params)}
          last={!props.extra} />
        {props.extra?.rows}
      </Disclosure>
    </View>
  );
}

/** People: who is assigned here (Members), and on a language its review teams. */
function PeopleRows(props: { ctx: Ctx; level: ScopeLevel; laneId?: string }) {
  const { ctx } = props;
  const entries = useMemo(() => memberEntries(ctx.org.state, ctx.project.state, ctx.project.projectId), [ctx.org.state, ctx.project.state, ctx.project.projectId]);
  const here = membersAt(entries, props.level, ctx.project.projectId, props.laneId).length;
  const people = new Set(entries.map((e) => e.profileId)).size;
  const sub = props.level === 'lane' ? `${here} assigned at this language` : `${here} at org level · ${people} total`;
  const params = { level: props.level, ...(props.laneId ? { laneId: props.laneId } : {}) };
  const teams = props.level === 'lane';
  return (
    <HomeSection label="People">
      <Row icon="people" label="Members" sub={sub} onPress={() => ctx.go('members_list', params)} last={!teams} />
      {teams ? <Row icon="people" label="Review Teams" sub="Language reviewers grouped into teams" last
        onPress={() => ctx.go('review_teams', { laneId: props.laneId ?? '' })} /> : null}
    </HomeSection>
  );
}

function Loading(props: { title: string; onBack?: () => void }) {
  return (
    <Screen header={<Header title={props.title} onBack={props.onBack} />}>
      <EmptyState icon="cloud" title="Loading" sub="Reading this organization from the phone." />
    </Screen>
  );
}

// ---- Org Home -----------------------------------------------------------------------------------

/**
 * The organization and its languages (demo OrgHome with ProjectHome's
 * language list folded in, decision 34): its languages, what they use and
 * who is assigned. Each language is its own partition (decision 37), so a
 * language's progress shows once this phone has it open.
 */
export function OrgHome(ctx: Ctx) {
  const v = useOrgView(ctx);
  const [shown, setShown] = useState(20);
  const beside = useOpenDetail();
  if (!v.org || !v.state) return <Loading title="Organization" />;
  const mine = Object.values(v.org.members[ctx.session.actorId] ?? {}).find((m) => m.removed.value === false && m.scope.level === 'org');
  const memberCount = new Set(memberEntries(v.org, v.state, v.projectId).map((e) => e.profileId)).size;
  // The demo's "Invite people" (gate assigner); a looked-after account may not invite (session.ts), so it asks both.
  const canInvite = edgeAllowed(edgeFor('org_home', 'invite_member')!, ctx.session) && ctx.session.can('invite_members');
  return (
    <Screen header={<Header title={v.orgName} />}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ width: tile.lg, height: tile.lg, borderRadius: radius.lg, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' }}>
            <Ico name="building" size={28} color={C.primary} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={txt.h3}>{v.orgName}</Text>
            <Text style={txt.xs}>{plural(v.lanes.length, 'language')} · {plural(memberCount, 'member')}</Text>
            {mine ? <View style={{ flexDirection: 'row' }}><Badge label={roleName(ctx, mine.roleId.value)} tone="brand" /></View> : null}
          </View>
        </View>
        {v.lanes.length && v.orgProgress ? <HomeProgressBars p={v.orgProgress} /> : null}
      </Card>
      {canInvite ? <HomePrimary label="Invite people" icon="plus" onPress={() => ctx.go('invite_member', { level: 'org' })} /> : null}
      <HomeSection label="Languages"
        add={ctx.session.can('manage_structure') ? { label: 'New language', onPress: () => ctx.go('new_language') } : undefined}>
        {v.lanes.length === 0 ? (
          <View style={{ padding: space.lg }}><Text style={txt.smMuted}>No languages yet. Add the first one your team will record.</Text></View>
        ) : v.lanes.slice(0, shown).map((laneId) => {
          const p = v.laneProgress(laneId);
          return (
            <Row key={laneId} icon="globe" label={v.laneLabel(laneId)} onPress={() => ctx.go('language_home', { laneId })}
              current={beside?.screen === 'language_home' && beside.params['laneId'] === laneId}
              sub={p ? `${deriveFlow(v.state!, laneId).name} · ${progressLine(p)}` : 'Open it to bring it onto this phone'} />
          );
        })}
      </HomeSection>
      <ShowMore remaining={v.lanes.length - shown} step={20} onMore={() => setShown((n) => n + 20)} />
      <PeopleRows ctx={ctx} level="org" />
      <HomeSetup ctx={ctx} from="org_home" level="org" laneIds={v.lanes} extra={{ label: 'license', rows: <LicenseSection ctx={ctx} /> }} />
    </Screen>
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
      await ctx.org.append('v1.OrgLicenseSet', { license });
      setOpen(false);
      ctx.toast(`Your work is now under ${LICENSE_INFO[license].name}.`);
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

/**
 * Whether a language is listed on Explore. The server keys the listing by
 * partition, and each language is its own (docs/decisions.md 37), so this is
 * the open language's listing.
 */
function usePublicListing(ctx: Ctx) {
  const may = ctx.session.can('manage_structure');
  const { orgId, projectId } = ctx.project;
  const [listed, setListed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!may) return;
    let active = true;
    void supabase.from('project_visibility').select('listed').eq('org_id', orgId).eq('project_id', projectId).maybeSingle()
      .then(({ data, error: failed }) => {
        if (!active) return;
        // Offline or refused: say so rather than showing "not listed".
        if (failed) { noteExpected('read listing', failed); setError(failed.message); } else setListed(data?.listed ?? false);
      });
    return () => { active = false; };
  }, [may, orgId, projectId]);
  async function set(value: boolean) {
    setBusy(true);
    try {
      const { error: failed } = await supabase.rpc('set_project_visibility', { p_org: orgId, p_project: projectId, p_listed: value });
      if (failed) { noteExpected('change listing', failed); setError(failed.message); } else { setListed(value); setError(''); }
    } catch (e) {
      setError(failure('change listing', e));
    } finally {
      setBusy(false);
    }
  }
  return { may, listed, error, busy, set };
}

// ---- Language Home ----------------------------------------------------------------------------------

export function LanguageHome(ctx: Ctx) {
  const v = useOrgView(ctx);
  const laneId = laneParam(ctx);
  const translators = useMemo(() => {
    const org = ctx.org.state;
    if (!org) return [];
    return memberEntries(org, v.state, v.projectId)
      .filter((e) => e.scope.level === 'lane' && e.scope.laneId === laneId && org.roles[e.roleId]?.privileges.value?.includes('translate'))
      .map((e) => e.profileId);
  }, [ctx.org.state, v.state, v.projectId, laneId]);
  const listing = usePublicListing(ctx);
  if (!v.state) return <Loading title="Language" />;
  if (!v.state.lanes[laneId]) {
    return (
      <Screen header={<Header title="Language" onBack={ctx.back} />}>
        <EmptyState icon="globe" title="No languages yet" sub="Add a language from the organization home first." />
      </Screen>
    );
  }
  const name = v.laneLabel(laneId);
  const atRoot = ctx.session.adminScope?.level === 'lane';
  const who = translators.length ? translators.map((id) => ctx.name(id)).join(', ') : 'Unassigned';
  return (
    <Screen header={<Header title={name} onBack={atRoot ? undefined : ctx.back} crumbs={[
      { label: v.orgName, onPress: () => ctx.go('org_home') },
      { label: name }
    ]} />}>
      <Card>
        <Text style={txt.xs}>Translator: {who} · Review flow: {deriveFlow(v.state, laneId).name} · Code {v.state.lanes[laneId]!.languoidId.toUpperCase()}</Text>
        <HomeProgressBars p={v.laneProgress(laneId) ?? { total: 0, recorded: 0, done: 0 }} />
      </Card>
      <HomePrimary label="Open the passage map" icon="map" onPress={() => { ctx.setLane(laneId); ctx.go('map_home', { laneId }); }} />
      <PeopleRows ctx={ctx} level="lane" laneId={laneId} />
      <HomeSetup ctx={ctx} from="language_home" level="lane" laneIds={[laneId]} laneId={laneId}
        {...(listing.may ? { extra: { label: 'public listing', rows: (
          <Row icon="globe" label="List publicly" sub="Share its name and progress only" last
            right={<Toggle label={`List ${name} publicly`} on={listing.listed} disabled={listing.busy} onToggle={() => void listing.set(!listing.listed)} />} />
        ) } } : {})} />
      {listing.error ? <Banner icon="flag" tone="amber" title="Could not read or change the listing" body={listing.error} /> : null}
    </Screen>
  );
}

// ---- Members ----------------------------------------------------------------------------------

function Avatar(props: { id: string; size?: number }) {
  const person = usePerson();
  return <PersonAvatar look={person(props.id)} size={props.size ?? 40} />;
}

/** One member: role badge and edit, or view only with a lock (demo MemberRows). */
function MemberRow(props: { ctx: Ctx; e: MemberEntry; target: string; editable: boolean; level: ScopeLevel; last?: boolean }) {
  const { ctx, e } = props;
  const beside = useOpenDetail();
  return (
    <Row leading={<Avatar id={e.profileId} />} label={ctx.name(e.profileId)} muted={!props.editable} last={props.last}
      current={beside?.screen === 'edit_member' && beside.params['memberId'] === e.profileId}
      sub={`${props.target}${e.since ? ` · joined ${when(e.since)}` : ''}`}
      onPress={props.editable ? () => ctx.go('edit_member', { memberId: e.profileId, entry: e.key, level: props.level }) : undefined}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          <Badge label={roleName(ctx, e.roleId)} tone={props.editable ? 'brand' : 'default'} />
          {props.editable ? <Ico name="right" size={22} color={C.muted} /> : <Ico name="lock" size={18} color={C.faint} />}
        </View>
      } />
  );
}

export function MembersList(ctx: Ctx) {
  const v = useOrgView(ctx);
  const level = parseLevel(ctx.params['level'] ?? ctx.session.adminScope?.level);
  const laneId = level === 'lane' ? laneParam(ctx) : undefined;
  const mayInvite = ctx.session.can('invite_members');
  const entries = useMemo(() => memberEntries(v.org, v.state, v.projectId), [v.org, v.state, v.projectId]);
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [shown, setShown] = useState(30);
  const refresh = useCallback(async () => {
    if (!mayInvite) return;
    try { setRequests(await pendingRequests(ctx.project.orgId)); } catch (e) {
      // Offline: the list is a server read with no local mirror, so it stays
      // empty rather than claiming nobody asked.
      noteExpected('members join requests', e);
    }
  }, [mayInvite, ctx.project.orgId]);
  useEffect(() => void refresh(), [refresh]);

  const current = membersAt(entries, level, v.projectId, laneId);
  const higher = membersAbove(entries, level, v.projectId);
  const params = { level, ...(laneId ? { laneId } : {}) };
  const edit = (e: MemberEntry) => mayInvite && editableAt(e.scope, level);
  const rows = (list: MemberEntry[]) => list.map((e, i) => (
    <MemberRow key={e.key} ctx={ctx} e={e} target={v.target(e.scope)} editable={edit(e)} level={level} last={i === list.length - 1} />
  ));
  const group = (by: 'lane', label: string) => {
    const groups = groupBelow(entries);
    const count = [...groups.values()].reduce((n, g) => n + g.length, 0);
    const d = ctx.details(`members:${level}:${by}`);
    return (
      <View style={{ gap: space.sm }}>
        <Row icon="globe" label={label} sub={plural(count, 'member')} last
          onPress={d.onToggle} expanded={d.open} right={<Ico name={d.open ? 'up' : 'down'} size={22} color={C.primary} />} />
        {d.open ? [...groups].map(([key, list]) => (
          <View key={key} style={{ gap: space.xs }}>
            <Text style={[txt.label, { paddingHorizontal: space.xs }]}>
              {v.laneLabel(key)} · {list.length}
            </Text>
            <Group>{rows(list)}</Group>
          </View>
        )) : null}
      </View>
    );
  };
  if (!v.org) return <Loading title="Members" onBack={ctx.back} />;
  return (
    <Screen header={<Header title="Members" onBack={ctx.back}
      action={mayInvite ? <SmallBtn label="Invite" icon="plus" tone="primary" onPress={() => ctx.go('invite_member', params)} /> : undefined} />}>
      <Text style={txt.xs}>
        Members assigned at {LEVEL_LABEL[level].toLowerCase()} scope{level !== 'org' ? ' for this view' : ''}. Expand the groups below for the other levels.
      </Text>
      <SectionLabel label={`${LEVEL_LABEL[level]} members · ${current.length + requests.length}`} />
      <Group>
        {requests.map((r) => (
          <Row key={r.id} leading={<Avatar id={r.profileId} />} label={ctx.name(r.profileId)} sub={r.message || 'Asked to join'}
            onPress={() => ctx.go('edit_member', { memberId: r.profileId, requestId: r.id, level })}
            right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}><Badge label="Pending" tone="amber" /><Ico name="right" size={22} color={C.muted} /></View>} />
        ))}
        {rows(current.slice(0, shown))}
        {current.length === 0 && requests.length === 0 ? (
          <View style={{ padding: space.lg }}><Text style={txt.smMuted}>No members assigned at this level yet.</Text></View>
        ) : null}
      </Group>
      <ShowMore remaining={current.length - shown} step={30} onMore={() => setShown((n) => n + 30)} />
      {level !== 'lane' ? (
        <>
          <SectionLabel label="Expand by" />
          {group('lane', 'By language')}
        </>
      ) : null}
      {higher.length > 0 ? (
        <>
          <SectionLabel label="Higher levels · view only" />
          <Group>{higher.map((e, i) => <MemberRow key={e.key} ctx={ctx} e={e} target={v.target(e.scope)} editable={false} level={level} last={i === higher.length - 1} />)}</Group>
        </>
      ) : null}
    </Screen>
  );
}

// ---- Invite, and editing a member (one form, as in the demo) ------------------------------------

/** A list of choices on one card, the chosen one ticked; a screen reader hears radio buttons and which is selected. */
function Choices(props: { items: { id: string; label: string; sub?: string; badge?: string }[]; value: string; onChoose: (id: string) => void; empty?: string }) {
  if (props.items.length === 0) return <Text style={txt.smMuted}>{props.empty ?? 'Nothing to choose from.'}</Text>;
  return (
    <Group>
      {props.items.map((it, i) => (
        <Row key={it.id} label={it.label} sub={it.sub} badge={it.badge} onPress={() => props.onChoose(it.id)} last={i === props.items.length - 1}
          role="radio" selected={props.value === it.id}
          right={props.value === it.id ? <Ico name="check" size={22} color={C.primary} /> : <View style={{ width: 22 }} />} />
      ))}
    </Group>
  );
}

/** Role, assignment scope, and the language it applies to (ORG-6, ORG-7). */
function AssignmentForm(props: {
  ctx: Ctx;
  roles: { id: string; name: string; sub?: string }[];
  levels: ScopeLevel[];
  value: { roleId: string; level: ScopeLevel; projectId: string; laneId: string };
  onChange: (v: { roleId: string; level: ScopeLevel; projectId: string; laneId: string }) => void;
}) {
  const { ctx, value } = props;
  const v = useOrgView(ctx);
  const admin = ctx.session.adminScope;
  const lanes = admin?.level === 'lane' && admin.laneId ? [admin.laneId] : v.lanes;
  return (
    <>
      <SectionLabel label="Role" />
      <Choices items={props.roles.map((r) => ({ id: r.id, label: r.name, sub: r.sub }))} value={value.roleId}
        onChoose={(roleId) => props.onChange({ ...value, roleId })} empty="No roles available here." />
      <SectionLabel label="Assignment scope" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {props.levels.map((l) => (
          <Chip key={l} label={LEVEL_LABEL[l]} on={value.level === l} onPress={() => {
            const laneId = l === 'lane' ? value.laneId || (lanes.length === 1 ? lanes[0]! : '') : '';
            // A language's role names that language's own partition (decisions.md 37).
            props.onChange({ ...value, level: l, laneId, projectId: l === 'org' ? '' : laneId ? v.partitionOf(laneId) : v.projectId });
          }} />
        ))}
      </View>
      <Text style={txt.xs}>Where this person can use the selected role's privileges.</Text>
      {value.level === 'lane' ? (
        <>
          <SectionLabel label="Language" />
          <Text style={txt.xs}>Which language this assignment applies to.</Text>
          <Choices items={lanes.map((id) => ({ id, label: v.laneLabel(id) }))} value={value.laneId}
            onChoose={(laneId) => props.onChange({ ...value, laneId, projectId: v.partitionOf(laneId) })} empty="No languages yet." />
        </>
      ) : null}
    </>
  );
}

function scopeOf(value: { level: ScopeLevel; projectId: string; laneId: string }): Scope | null {
  if (value.level === 'org') return { level: 'org' };
  if (!value.projectId) return null;
  if (value.level === 'project') return { level: 'project', projectId: value.projectId };
  return value.laneId ? { level: 'lane', projectId: value.projectId, laneId: value.laneId } : null;
}

export function InviteMember(ctx: Ctx) {
  const level = parseLevel(ctx.params['level'] ?? ctx.session.adminScope?.level);
  const floor = grantFloor(ctx.session.adminScope, level);
  const levels = assignableLevels(ctx.session.adminScope, level);
  const roles = liveRoles(ctx);
  const [email, setEmail] = useState('');
  const [form, setForm] = useState({
    roleId: '', level: floor ?? 'org' as ScopeLevel,
    projectId: floor === 'lane' ? partitionOfLane(ctx.org.state, laneParam(ctx)) : floor && floor !== 'org' ? ctx.project.projectId : '',
    laneId: floor === 'lane' ? laneParam(ctx) : ''
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scope = scopeOf(form);
  const ready = /\S+@\S+\.\S+/.test(email.trim()) && !!form.roleId && !!scope && !!floor;
  async function send() {
    if (!ready || !scope) return;
    setBusy(true);
    setError('');
    try {
      const invite = await issueInvite(ctx.project.orgId, form.roleId, scope);
      const { error: failed } = await supabase.functions.invoke('send-invite', { body: { inviteId: invite.inviteId, token: invite.token, email: email.trim() } });
      if (failed) {
        const details = failed.context instanceof Response ? await failed.context.json().catch(() => null) : null;
        throw new Error(details?.error ?? failed.message);
      }
      ctx.toast(`Invite sent to ${email.trim()} as ${roleName(ctx, form.roleId)}`);
      ctx.back();
    } catch (e) {
      // Offline or the server said no: its words say which.
      noteExpected('send invite', e);
      setError(e instanceof Error ? e.message : 'Try again when connected.');
    } finally {
      setBusy(false);
    }
  }
  const params = { level, ...(ctx.params['laneId'] ? { laneId: ctx.params['laneId'] } : {}) };
  return (
    <Screen header={<Header title="Invite Member" onBack={ctx.back} />}
      footer={<PrimaryBtn label="Send Invite" icon="share" disabled={!ready} busy={busy} onPress={() => void send()} />}>
      <Text style={txt.xs}>{floor
        ? 'Pick a role, then choose the scope this assignment applies to. Scope can be this level or below.'
        : 'Sign in as an admin to invite members.'}</Text>
      <Card onPress={() => ctx.go('invite_qr', params)} accessibilityLabel="Invite by QR code">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ width: tile.sm, height: tile.sm, borderRadius: radius.md, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' }}>
            <Ico name="qr" size={22} color={C.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[txt.body, { fontWeight: '600' }]}>Invite by QR code</Text>
            <Text style={txt.xs}>For people without email — they scan to join</Text>
          </View>
          <Ico name="right" size={22} color={C.muted} />
        </View>
      </Card>
      <Field label="Email address" value={email} onChangeText={setEmail} placeholder="name@example.com" keyboardType="email-address" autoCapitalize="none" />
      <AssignmentForm ctx={ctx} roles={roles} levels={levels} value={form} onChange={setForm} />
      {error ? <Banner icon="flag" tone="amber" title="The invite was not sent" body={error} /> : null}
    </Screen>
  );
}

/** A failure ctx.act has already shown. */
class AlreadySaid extends Error {
  override name = 'AlreadySaid';
}

export function EditMember(ctx: Ctx) {
  const v = useOrgView(ctx);
  const memberId = ctx.params['memberId'] ?? '';
  const requestId = ctx.params['requestId'];
  const viewLevel = parseLevel(ctx.params['level'] ?? ctx.session.adminScope?.level);
  const entries = useMemo(() => memberEntries(v.org, v.state, v.projectId).filter((e) => e.profileId === memberId), [v.org, v.state, v.projectId, memberId]);
  const entry = entries.find((e) => e.key === ctx.params['entry']) ?? entries[0];
  const legacy = entry?.legacyRole !== undefined;
  const pending = !!requestId;
  const roles = legacy
    ? SEED_ROLES.map((r) => ({ id: r.roleId, name: r.name }))
    : liveRoles(ctx);
  const levels: ScopeLevel[] = pending ? ['org'] : legacy ? ['project'] : [...new Set([...(entry ? [entry.scope.level] : []), ...assignableLevels(ctx.session.adminScope, viewLevel)])];
  const [form, setForm] = useState({
    roleId: entry?.roleId ?? '',
    level: (pending ? 'org' : entry?.scope.level ?? 'org') as ScopeLevel,
    projectId: entry?.scope.projectId ?? '',
    laneId: entry?.scope.laneId ?? ''
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const allowed = ctx.session.can('invite_members');
  const scope = scopeOf(form);
  const who = ctx.name(memberId);

  async function runOrg(ops: OrgOp[]) {
    for (const op of ops) await ctx.org.append(op.type, op.payload as never);
  }
  /** Undo from the toast: the screen may be gone by then, so the outcome is a toast too. */
  async function undoOrg(ops: OrgOp[], where: string) {
    try {
      await runOrg(ops);
      ctx.toast('Put back.');
    } catch (e) {
      ctx.toast(`Not put back. ${failure(where, e)}`);
    }
  }
  /** ctx.act says "Not saved" and why itself; this only keeps the screen open without a second message. */
  const act: Ctx['act'] = (...args) => ctx.act(...args).catch(() => { throw new AlreadySaid(); });
  async function attempt(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await work(); ctx.back(); } catch (e) {
      if (!(e instanceof AlreadySaid)) setError(failure('edit member', e));
    } finally { setBusy(false); }
  }
  const save = () => attempt(async () => {
    if (!scope || !form.roleId) return;
    const role = roleName(ctx, form.roleId);
    if (pending) {
      await decideRequest(requestId!, true, form.roleId);
      await ctx.org.sync();
      ctx.toast(`${who} is now ${role}`);
      return;
    }
    if (!entry) return;
    if (legacy) {
      const next = SEED_ROLES.find((r) => r.roleId === form.roleId)?.fixed;
      const was = entry.legacyRole!;
      if (!next || next === was) return;
      const id = Crypto.randomUUID();
      const change = (r: Role, n: string) => [{ id: `${id}:${n}`, type: 'v1.MemberRoleChanged' as const, payload: { profileId: memberId, role: r } }];
      await act(change(next, 'do'), `${who} is now ${role}`, () => change(was, 'undo'));
      return;
    }
    const plan = changeMembership(entry, { roleId: form.roleId, scope });
    if (plan.apply.length === 0) return;
    await runOrg(plan.apply);
    ctx.toast(`${who} is now ${role}`, () => undoOrg(plan.undo, 'undo role change'));
  });
  const remove = () => attempt(async () => {
    if (!entry) return;
    const where = LEVEL_LABEL[entry.scope.level].toLowerCase();
    if (legacy) {
      const id = Crypto.randomUUID();
      await act([{ id: `${id}:0`, type: 'v1.MemberRemoved', payload: { profileId: memberId } }], `${who} removed`,
        () => [{ id: `${id}:1`, type: 'v1.MemberRoleChanged', payload: { profileId: memberId, role: entry.legacyRole! } }]);
      return;
    }
    const plan = removeMembership(entry);
    await runOrg(plan.apply);
    ctx.toast(`${who} removed at ${where} level`, () => undoOrg(plan.undo, 'undo remove member'));
  });
  const decline = () => attempt(async () => {
    await decideRequest(requestId!, false);
    await ctx.org.sync();
    ctx.toast(`Declined ${who}'s request`);
  });

  if (!entry && !pending) {
    return (
      <Screen header={<Header title="Edit Member" onBack={ctx.back} />}>
        <EmptyState icon="user" title="Not a member here" sub="This person has no role in this organization any more." />
      </Screen>
    );
  }
  const sub = pending ? (ctx.params['message'] || 'Awaiting approval') : `${roleName(ctx, entry!.roleId)} · ${v.target(entry!.scope)}`;
  const ready = allowed && !!form.roleId && !!scope;
  return (
    <Screen header={<Header title={pending ? 'Assign Role' : who} sub={sub} onBack={ctx.back} />}
      footer={allowed ? (
        <>
          <PrimaryBtn label={pending ? 'Assign Role' : 'Save Assignment'} disabled={!ready} busy={busy} onPress={() => void save()} />
          {pending ? <GhostBtn label="Decline" tone="red" onPress={() => void decline()} disabled={busy} /> : null}
        </>
      ) : undefined}>
      <Row leading={<Avatar id={memberId} size={48} />} label={who} sub={pending ? 'Asked to join' : v.target(entry!.scope)} />
      <Text style={txt.xs}>{pending
        ? 'This person created an account and asked to join. Assign a role to give them access; they join at organization scope, and you can narrow it here afterwards.'
        : legacy ? 'Added before organization roles. Their role applies to every language.'
        : 'Pick a role, then choose the scope this assignment applies to. Scope can be this level or below.'}</Text>
      {allowed ? <AssignmentForm ctx={ctx} roles={roles} levels={levels} value={form} onChange={setForm} />
        : <Banner icon="lock" title="View only" body="Only people who can invite members change roles." />}
      {error ? <Banner icon="flag" tone="amber" title="Not saved" body={error} /> : null}
      {allowed && !pending ? (
        // The demo has no Remove here; kept as a quiet link below the form,
        // away from Save, and it offers Undo.
        <LinkBtn label={`Remove from ${LEVEL_LABEL[entry!.scope.level].toLowerCase()}`} color={TINT.redText}
          onPress={() => { if (!busy) void remove(); }} style={{ alignSelf: 'center' }} />
      ) : null}
      {!pending && memberId ? <HelpSignIn memberId={memberId} who={who} /> : null}
    </Screen>
  );
}

/**
 * Help a looked-after member back in (docs/invites-and-accounts.md flow F):
 * their steward, or an organization admin, shows a one-time QR, and the
 * person scans it from Sign In to choose a new password. Shown only when the
 * server says this session may help this person.
 */
function HelpSignIn(props: { memberId: string; who: string }) {
  const [may, setMay] = useState(false);
  const [key, setKey] = useState<{ code: string; signInName: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void canHelpSignIn(props.memberId).then((ok) => { if (active) setMay(ok); });
    return () => { active = false; };
  }, [props.memberId]);
  if (!may) return null;
  async function make() {
    setBusy(true);
    setError('');
    try { setKey(await issueSignInCode(props.memberId)); }
    catch (e) { noteExpected('sign-in code', e); setError(e instanceof Error ? e.message : 'Try again when connected.'); }
    finally { setBusy(false); }
  }
  return (
    <>
      <SectionLabel label="Signing in" />
      {key ? (
        <Card style={{ alignItems: 'center' }}>
          <QRCode value={signInUri(key.code, APP_URL)} size={200} backgroundColor={C.white} color={C.dark} />
          <Text style={txt.h3}>Sign-in name: {key.signInName}</Text>
          <Text style={[txt.xs, { textAlign: 'center' }]}>
            On their phone, {props.who} taps Scan a code on Sign In, scans this, and chooses a new password. It works once, for one hour.
          </Text>
        </Card>
      ) : (
        <GhostBtn label="Help them sign in" icon="lock" disabled={busy} onPress={() => void make()} />
      )}
      {error ? <Banner icon="flag" tone="amber" title="No code was made" body={error} /> : null}
    </>
  );
}

// ---- Invite by QR -------------------------------------------------------------------------------------

const QR_STEPS = ['Role', 'Name', 'QR code'];
/** How many people a group code admits (the server allows up to 50). */
const GROUP_USES = 30;

export function InviteQr(ctx: Ctx) {
  const level = parseLevel(ctx.params['level'] ?? ctx.session.adminScope?.level);
  const floor = grantFloor(ctx.session.adminScope, level) ?? level;
  const scope = floor === 'lane' ? scopeAt(floor, partitionOfLane(ctx.org.state, laneParam(ctx)), laneParam(ctx)) : scopeAt(floor, ctx.project.projectId);
  const roles = liveRoles(ctx);
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
      // The name goes to the server with the invite, so the person scanning
      // sees whom it is for (docs/invites-and-accounts.md section 4).
      setInvite(await issueInvite(ctx.project.orgId, roleId, scope, { label: name, maxUses: audience === 'group' ? GROUP_USES : 1 }));
      setStep(2);
    } catch (e) {
      // Offline or refused by the server: its words say which.
      noteExpected('issue invite', e);
      setError(e instanceof Error ? e.message : 'Try again when connected.');
    } finally {
      setBusy(false);
    }
  }
  const params = { level, ...(ctx.params['laneId'] ? { laneId: ctx.params['laneId'] } : {}) };
  // The link carries the org and the token only: a scanner shows nothing a
  // forwarded link could have altered. The name stays on this screen.
  const uri = invite ? inviteUri(ctx.project.orgId, invite.token, APP_URL) : '';
  return (
    <Screen header={<Header title="Invite by QR" sub={role ? role.name : 'Role and name only'}
      onBack={step === 1 && !invite ? () => setStep(0) : ctx.back} />}
      footer={step < 2
        ? <PrimaryBtn label="Continue" disabled={!canAdvance} busy={busy} onPress={() => void next()} />
        : <PrimaryBtn label="Done" icon="check" onPress={() => ctx.go('members_list', params)} />}>
      <View style={{ gap: space.xs }}>
        <Segments total={QR_STEPS.length} current={step} done={(i) => i < step} />
        <Text style={[txt.xs, { textAlign: 'center' }]}>Step {step + 1} of {QR_STEPS.length} — {QR_STEPS[step]}</Text>
      </View>
      {step === 0 ? (
        <>
          <Text style={txt.xs}>Pick the role this person should have. You don't need their email.</Text>
          <Choices items={roles.map((r) => ({ id: r.id, label: r.name, sub: plural(r.privileges, 'privilege') }))} value={roleId} onChoose={setRoleId}
            empty="No roles yet." />
          {ctx.session.can('manage_roles') ? (
            <GhostBtn label="Create a new role" icon="plus" onPress={() => ctx.go('role_editor', { roleId: 'new' })} />
          ) : null}
        </>
      ) : null}
      {step === 1 ? (
        <>
          <Choices items={[
            { id: 'one', label: 'One person', sub: 'The code works once' },
            { id: 'group', label: 'A group', sub: `Up to ${GROUP_USES} people share one code, for a workshop` }
          ]} value={audience} onChoose={(id) => setAudience(id as 'one' | 'group')} />
          <Text style={txt.xs}>{audience === 'one'
            ? 'Their name is shown to them when they scan, so they know the code is theirs, and offered as their name.'
            : 'A name for the group, shown to everyone who scans it.'}</Text>
          <Field label={audience === 'one' ? 'Name' : 'Group name'} value={name} onChangeText={setName}
            placeholder={audience === 'one' ? 'e.g. Nyibol Deng' : 'e.g. Juba workshop'} autoCapitalize="words" />
        </>
      ) : null}
      {step === 2 && invite && role ? (
        <>
          <Card style={{ alignItems: 'center' }}>
            <QRCode value={uri} size={220} backgroundColor={C.white} color={C.dark} />
            <View style={{ alignItems: 'center', gap: 2 }}>
              <Text style={txt.h3}>{name.trim()}</Text>
              <Text style={txt.smMuted}>{role.name} · {LEVEL_LABEL[floor]}</Text>
            </View>
            <Text style={[txt.xs, { textAlign: 'center' }]}>Hold this up for them to scan. Tap Done when it has been scanned.</Text>
          </Card>
          <Card>
            <Text style={txt.xsStrong}>Or type this code</Text>
            <Text selectable style={[txt.sm, { fontFamily: 'Courier' }]}>{invite.token}</Text>
            <Text style={txt.xs}>Shown once: leaving this screen loses the code. {audience === 'group' ? `Up to ${GROUP_USES} people can use it` : 'It can be used once'}, until {new Date(invite.expiresAt).toDateString()}.</Text>
            <SmallBtn label="Share invite" icon="share" onPress={() => void shareText(uri).then((r) => {
              if (r === 'copied') ctx.toast('Invite link copied. Paste it into a message.');
              else if (r === 'failed') ctx.toast('Could not share it. Type the code above instead.');
            })} />
          </Card>
        </>
      ) : null}
      {error ? <Banner icon="flag" tone="amber" title="No code was made" body={error} /> : null}
    </Screen>
  );
}

// ---- New language --------------------------------------------------------------------------

export function NewLanguage(ctx: Ctx) {
  const state = ctx.project.state;
  const lib = useLibrary(ctx);
  const library = ctx.org.state?.library;
  const shared = useSharedItems('template', lib.orgId);
  // The organization's templates first, then shared ones (LangQuest's starter first).
  const choices = useMemo(() => libraryChoices(library ?? {}, lib.items('template'), shared.rows, STARTER_TEMPLATE.name), [library, lib.items, shared.rows]);
  const suggested = useMemo(() => suggestedTemplate(state, choices), [state, choices]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [scope, setScope] = useState<LanguageScope>('nt');
  const [picked, setPicked] = useState<string | null>(null);
  const [limit, setLimit] = useState(6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choice = choices.find((c) => c.key === (picked ?? suggested));
  const docs = useLibraryDocs(lib.orgId, [choice?.hash]);
  const doc = docs.get<TemplateDoc>(choice?.hash);
  const orgName = ctx.org.state?.org?.value.name ?? 'the organization';
  const ours = choices.filter((c) => c.source === 'ours');
  const others = choices.filter((c) => c.source === 'shared');
  const shown = [...ours, ...others.slice(0, limit)];
  async function create() {
    const title = name.trim();
    if (!title || busy || !choice) return;
    setBusy(true);
    setError('');
    try {
      const languoid = code.trim() || title.slice(0, 3);
      const commandId = Crypto.randomUUID();
      const laneId = newLaneId(languoid, commandId);
      const template = (await loadDocs(lib.orgId, [choice.hash])).get(choice.hash);
      if (!template || template.format !== 'template@1') throw new CommandError('Its template is not on this phone yet. Try again when connected.');
      const books = booksInScope(template, scope);
      // Another organization's template is followed, with automatic updates, before a language uses it.
      const itemId = choice.source === 'shared' ? await lib.subscribe(choice.shared, true) : choice.item.itemId;
      // The language is its own partition (decisions.md 37): listed in the
      // organization's partition so everyone can see it, and started with
      // its structure before anyone opens it.
      const fresh = emptyState();
      const templateSpecs = await lib.applySpecs(laneId, itemId, { docHash: choice.hash, into: fresh, ...(books ? { books } : {}) });
      const specs = addLanguage(fresh, { commandId, laneId, code: languoid, name: title, template: templateSpecs });
      await ctx.org.append('v1.ProjectRegistered', { projectId: laneId, name: title });
      await appendToPartition({ orgId: ctx.project.orgId, projectId: laneId, actorId: ctx.session.actorId, specs });
      ctx.toast(`${title} added to ${orgName} · uses ${choice.name}`);
      ctx.setLane(laneId);
      ctx.back();
    } catch (e) {
      setError(failure('new language', e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen header={<Header title="New Language" onBack={ctx.back} />}
      footer={<PrimaryBtn label="Create Language" disabled={!name.trim() || !state || !choice} busy={busy} onPress={() => void create()} />}>
      <Text style={txt.xs}>This language is added to {orgName}. You can invite language admins from Members after it is created.</Text>
      <Field label="Language name" value={name} onChangeText={setName} placeholder="Enter language name" autoCapitalize="words" />
      <Field label="Language code" value={code} onChangeText={setCode} placeholder="e.g. DIN" autoCapitalize="none" />
      {doc?.structure !== 'outline' ? (
        <>
          <SectionLabel label="Scope" />
          <Choices items={LANGUAGE_SCOPES.map((s) => ({ id: s.id, label: s.label, sub: s.sub }))} value={scope} onChoose={(id) => setScope(id as LanguageScope)} />
        </>
      ) : null}
      <SectionLabel label="Template" />
      {shared.error ? (
        <Banner icon="cloud" tone="amber" title="Could not refresh the shared templates"
          body={shared.rows.length ? 'Showing the list this phone saved.' : 'Connect to see the ones other organizations share.'} />
      ) : null}
      <Choices items={shown.map((c) => ({ id: c.key, label: c.name, sub: choiceLine(c, sourceLine), ...(c.key === suggested ? { badge: 'Suggested' } : {}) }))}
        value={choice?.key ?? ''} onChoose={setPicked} empty={shared.loaded ? 'No templates to choose from yet.' : 'Loading…'} />
      <ShowMore remaining={others.length - limit} step={6} onMore={() => setLimit((l) => l + 6)} />
      {choice ? (
        <Text style={txt.xs}>
          Its passages come from {choice.name}.{choice.source === 'shared' ? ` ${orgName} follows it from ${choice.shared.org_name}, so new versions reach the language by themselves.` : ''} It can be changed later under Content Templates.
        </Text>
      ) : null}
      {error ? <Banner icon="flag" tone="amber" title="Not created" body={error} /> : null}
    </Screen>
  );
}

// ---- Review Teams (FLOW-5) --------------------------------------------------------------------------------

export function ReviewTeams(ctx: Ctx) {
  const state = ctx.project.state;
  const beside = useOpenDetail();
  const laneId = laneParam(ctx);
  const canManage = ctx.session.can('manage_teams');
  const teams = useMemo(() => Object.entries(state?.teams ?? {})
    .filter(([, t]) => t.laneId === laneId)
    .sort(([, a], [, b]) => a.name.value.localeCompare(b.name.value)), [state, laneId]);
  const language = state && state.lanes[laneId] ? laneName(state, laneId) : 'this language';
  return (
    <Screen header={<Header title="Review Teams" onBack={ctx.back}
      action={canManage ? <SmallBtn label="Team" icon="plus" tone="primary" onPress={() => ctx.go('review_team_editor', { laneId })} /> : undefined} />}>
      <Text style={txt.xs}>Teams for {language}. Members must have the Review privilege for this language.</Text>
      {teams.length === 0 ? (
        <EmptyState icon="people" title="No review teams" sub={canManage ? 'Create a team to group language reviewers.' : 'No teams have been set up yet.'} />
      ) : teams.map(([teamId, t]) => {
        const people = state ? teamMembers(state, teamId) : [];
        return (
          <Card key={teamId} accessibilityLabel={t.name.value} current={beside?.screen === 'review_team_editor' && beside.params['teamId'] === teamId}
            onPress={canManage ? () => ctx.go('review_team_editor', { laneId, teamId }) : undefined}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
              <View style={{ width: tile.sm, height: tile.sm, borderRadius: radius.md, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' }}>
                <Ico name="people" size={22} color={C.primary} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[txt.body, { fontWeight: '600' }]}>{t.name.value || 'Review team'}</Text>
                <Text style={txt.xs}>{plural(people.length, 'member')}{t.kindId?.value && state ? ` · Usually ${kindOf(state, t.kindId.value).name}` : ''}</Text>
                {people.length > 0 ? <Text style={txt.sm}>{people.map((id) => ctx.name(id)).join(', ')}</Text> : null}
              </View>
              {canManage ? <Ico name="right" size={22} color={C.muted} /> : null}
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}

export function ReviewTeamEditor(ctx: Ctx) {
  const state = ctx.project.state;
  const laneId = laneParam(ctx);
  const [newId] = useState(() => `team:${Crypto.randomUUID()}`);
  const teamId = ctx.params['teamId'] ?? newId;
  const team = state?.teams[teamId];
  const before = useMemo(() => (state && team ? teamMembers(state, teamId) : []), [state, team, teamId]);
  const [name, setName] = useState(team?.name.value ?? '');
  const [chosen, setChosen] = useState<string[]>(before);
  const kindBefore = team?.kindId?.value ?? null;
  const [kindId, setKindId] = useState<string | null>(kindBefore);
  // The language's flow kinds, in flow order, plus the one already chosen if the flow dropped it.
  const kindIds = useMemo(() => {
    const ids = state ? deriveFlow(state, laneId).steps.flatMap((st) => st.kindIds) : [];
    return [...new Set([...ids, ...(kindBefore ? [kindBefore] : [])])];
  }, [state, laneId, kindBefore]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const eligible = useMemo(() => {
    const ids = new Set([...reviewEligible(ctx.org.state, state, ctx.project.projectId, laneId), ...before]);
    return [...ids].sort((a, b) => ctx.name(a).localeCompare(ctx.name(b)));
    // ctx.name reads the same people map for the whole visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.org.state, state, ctx.project.projectId, laneId, before]);
  const toggle = (id: string) => setChosen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  async function save() {
    const title = name.trim();
    if (!state || !title || busy) return;
    setBusy(true);
    setError('');
    try {
      const commandId = Crypto.randomUUID();
      const plan = saveTeam(state, { commandId, teamId, laneId, name: title, members: chosen });
      // The kind it usually reviews (ADR-029): written only when it changed.
      const kindSpec = (id: string, value: string | null): EventSpec => ({ id, type: 'v1.ReviewTeamKindSet', payload: { teamId, laneId, kindId: value } } as EventSpec);
      const kindChanged = kindId !== kindBefore;
      const specs = kindChanged ? [...plan.specs, kindSpec(`${commandId}:kind`, kindId)] : plan.specs;
      const undoPlan = plan.undo;
      const undo = undoPlan ? () => [...undoPlan(), ...(kindChanged ? [kindSpec(`${commandId}:undo:kind`, kindBefore)] : [])] : undefined;
      // ctx.act says "Not saved" and why; stay on the form to try again.
      try { await ctx.act(specs, `${title} saved · ${plural(chosen.length, 'person', 'people')}`, undo); } catch { return; }
      ctx.back();
    } catch (e) {
      setError(failure('save review team', e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen header={<Header title={name.trim() || (team ? team.name.value : 'New Review Team')} sub={team ? 'Review team' : 'New review team'} onBack={ctx.back} />}
      footer={<PrimaryBtn label="Save Team" disabled={!name.trim() || !ctx.session.can('manage_teams')} busy={busy} onPress={() => void save()} />}>
      <Field label="Team name" value={name} onChangeText={setName} placeholder="Team name" autoCapitalize="words" />
      <SectionLabel label="Usually reviews" />
      <Text style={txt.xs}>Send to … goes to this team for that kind of review. Anyone else can still be asked.</Text>
      <Group>
        {[null, ...kindIds].map((id, i, all) => {
          const on = kindId === id;
          return (
            <Row key={id ?? 'any'} role="radio" selected={on} onPress={() => setKindId(id)} last={i === all.length - 1}
              {...(id ? { leading: <KindIcon kindId={id} size={36} /> } : { icon: 'people' as const })}
              label={id && state ? kindOf(state, id).name : 'Any kind'}
              right={
                <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: on ? C.primary : C.border,
                  alignItems: 'center', justifyContent: 'center' }}>
                  {on ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: C.primary }} /> : null}
                </View>
              } />
          );
        })}
      </Group>
      <SectionLabel label={`Members · ${chosen.length}`} />
      <Text style={txt.xs}>Only members with Review privilege at this language can be added.</Text>
      {eligible.length === 0 ? (
        <Banner icon="people" title="No eligible reviewers" body="Invite members with a Review role scoped to this language first." />
      ) : (
        <Group>
          {eligible.map((id, i) => {
            const on = chosen.includes(id);
            return (
              <Row key={id} leading={<Avatar id={id} size={36} />} label={ctx.name(id)} onPress={() => toggle(id)} last={i === eligible.length - 1}
                right={
                  <View accessibilityLabel={on ? 'In the team' : 'Not in the team'} style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 2,
                    borderColor: on ? C.primary : C.border, backgroundColor: on ? C.primary : C.card, alignItems: 'center', justifyContent: 'center' }}>
                    {on ? <Ico name="check" size={18} color={C.white} strokeWidth={3} /> : null}
                  </View>
                } />
            );
          })}
        </Group>
      )}
      {error ? <Banner icon="flag" tone="amber" title="Not saved" body={error} /> : null}
    </Screen>
  );
}

export const contracts = contractsFor('org_home', 'language_home', 'members_list', 'invite_member', 'invite_qr',
  'edit_member', 'new_language', 'review_teams', 'review_team_editor');
