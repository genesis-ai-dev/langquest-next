// Running the organization (Manage tab). Ports the demo's src/screens/org.tsx:
// OrgHomeScreen, LanguageHomeScreen (with HomeSection, HomePrimary,
// HomeSetup, HomeProgressBars), MembersListScreen, InviteMemberScreen
// (invite and edit), InviteQrScreen, ReviewTeamsScreen,
// ReviewTeamEditorScreen and NewStructureItemScreen (new language).
// Requirements ORG-1, ORG-2, ORG-5, ORG-6, ORG-7, NAV-6, FLOW-5; ADR-017
// (admins reach these homes through Manage), ADR-025 (a language owns its
// template, starting from the one its organization suggests). The demo's
// Project Home and New Project are not ported: an organization holds its
// languages directly (docs/decisions.md 63).
import {
  CommandError, deriveFlow, emptyLanguageState, isMoreOpen, keyTermsFor, kindOf, languageInfo, languageName, languageProgress, LICENSE_INFO,
  libraryItemView, materialsFor, mayChangeLicense, orgLicense, privilegesFor, recommendedFor, SEED_ROLES,
  type EventSpec, type LanguageProgress, type License, type Scope, type ScopeLevel, type TemplateDoc
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { choiceLine, libraryChoices, STARTER_TEMPLATE, type LibraryChoice } from '../contentTemplates';
import type { Ctx } from '../ctx';
import { indexesFor } from '../indexes';
import { canHelpSignIn, decideRequest, inviteUri, issueInvite, issueSignInCode, pendingRequests, type NewInvite, type PendingRequest } from '../invites';
import { APP_URL } from '../appUrl';
import { signInUri } from '../inviteCode';
import {
  Badge, Banner, Card, Chip, ChipRow, Disclosure, EmptyState, Field, GhostBtn, Group, Header, Ico, KindIcon, LinkBtn, PrimaryBtn, ProgressBar, Row,
  Screen, SectionLabel, Segments, ShowMore, SmallBtn, Toggle, txt, useOpenDetail, type IconName
} from '../kit';
import { edgeFor } from '../flow';
import { loadDocs } from '../library/docStore';
import { sourceLine } from '../library/model';
import { useLibrary, useLibraryDocs, useSharedItems } from '../library/useLibrary';
import {
  addLanguage, assignableLevels, booksInScope, changeMembership, grantableLanguages, grantFloor, groupBelow, LANGUAGE_SCOPES, LEVEL_LABEL,
  mayGrantAt, membersAbove, membersAt, memberEntries, newLanguageId, parseLevel, progressLine, removeMembership, reviewEligible,
  saveTeam, STARTER_FLOW, suggestedChoice, sumProgress, teamMembers,
  type HomeProgress, type LanguageScope, type MemberEntry, type OrgOp
} from '../orgAdmin';
import { plural, when } from '../passageView';
import { noteExpected, reportError, failureMessage } from '../report';
import { LicenseRow, LicenseSheet } from '../licenseSheet';
import { appendToLanguage } from '../languageWriter';
import { contractsFor } from '../screenContracts';
import { languageFigures } from '../orgFigures';
import { edgeAllowed } from '../session';
import { shareText } from '../share';
import { supabase } from '../supabase';
import { C, radius, space, tile, TINT } from '../theme';
import { useOrgSummary } from '../useOrgSummary';
import { personLook } from '../people';
import { PersonAvatar, usePerson } from '../UserChip';

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
  const orgName = org?.org?.value.name ?? 'Organization';
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
function HomeSetup(props: { ctx: Ctx; from: HomeId; level: ScopeLevel; languageIds: string[]; languageId?: string; extra?: { label: string; rows: ReactNode } }) {
  const { ctx, languageIds } = props;
  const state = ctx.language.state;
  const can = ctx.session.can;
  const params = { level: props.level, ...(props.languageId ? { languageId: props.languageId } : {}) };
  // Only the open language is on this phone; the others are their own streams (decision 63).
  const counts = useMemo(() => {
    if (!state || !ctx.language.languageId) return { study: 0, questions: 0, terms: 0, templates: [] as string[], flows: [] as string[] };
    const mats = materialsFor(state);
    const template = state.template?.value;
    return {
      study: mats.filter((m) => m.kind === 'fia_study').length,
      questions: mats.filter((m) => m.kind === 'questions').length,
      terms: keyTermsFor(state).length,
      templates: [template ? libraryItemView(ctx.org.state?.library ?? {}, template.itemId)?.name ?? 'A template' : 'None'],
      flows: [state.flow ? deriveFlow(state).name : 'None']
    };
  }, [state, ctx.language.languageId, ctx.org.state]);
  const applied = (names: string[]) => props.level === 'language'
    ? `${names[0] ?? 'None'} applied`
    : languageIds.length === 0 ? 'No languages yet' : [names.join(', '), plural(languageIds.length, 'language')].filter(Boolean).join(' · ');
  const templates = can('manage_templates');
  const reference = can('manage_reference');
  const flows = can('manage_flows');
  const open = ctx.details(`home:${props.from}:setup`);
  const names = [templates && 'Content templates', reference && 'reference', flows && 'review flows', 'roles', props.extra?.label].filter(Boolean);
  const summary = names.join(', ').replace(/^./, (c) => c.toUpperCase());
  // A language's page is its setup (demo ADR-039): what they record, what helps them and who checks,
  // in the admin's words and always shown; roles and the public listing stay under More.
  if (props.level === 'language') {
    const helps = recommendedFor(ctx.org.state?.recommendations, state).size;
    return (
      <>
        <HomeSection label="Ready for translators">
          {templates ? <Row icon="template" label="They record" sub={counts.templates[0] ?? 'Not chosen yet'} onPress={() => ctx.go('templates_home', params)} /> : null}
          {reference ? <Row icon="book" label="What helps them" onPress={() => ctx.go('reference_home', params)}
            sub={[helps ? plural(helps, 'Bible or guide') + ' offered' : 'Nothing offered yet', counts.terms ? plural(counts.terms, 'key term') : ''].filter(Boolean).join(' · ')} /> : null}
          {flows ? <Row icon="flow" label="Who checks" sub={counts.flows[0] ?? 'Not chosen yet'} onPress={() => ctx.go('flows_home', params)} last /> : null}
        </HomeSection>
        <View style={{ paddingTop: space.md }}>
          <Disclosure icon="settings" title="More" summary={['Roles', props.extra?.label].filter(Boolean).join(', ')} open={open.open} onToggle={open.onToggle}>
            <Row icon="star" label="Roles" sub={`${plural(liveRoles(ctx).length, 'role')} at this level and above`} onPress={() => ctx.go('roles_home', params)}
              last={!props.extra} />
            {props.extra?.rows}
          </Disclosure>
        </View>
      </>
    );
  }
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
function PeopleRows(props: { ctx: Ctx; level: ScopeLevel; languageId?: string }) {
  const { ctx } = props;
  const entries = useMemo(() => memberEntries(ctx.org.state), [ctx.org.state]);
  const here = membersAt(entries, props.level, props.languageId).length;
  const people = new Set(entries.map((e) => e.profileId)).size;
  const sub = props.level === 'language' ? `${here} assigned at this language` : `${here} at org level · ${people} total`;
  const params = { level: props.level, ...(props.languageId ? { languageId: props.languageId } : {}) };
  const teams = props.level === 'language';
  return (
    <HomeSection label="People">
      <Row icon="people" label="Members" sub={sub} onPress={() => ctx.go('members_list', params)} last={!teams} />
      {teams ? <Row icon="people" label="Review groups" sub="Optional: who comes first when someone asks for a check" last
        onPress={() => ctx.go('review_teams', { languageId: props.languageId ?? '' })} /> : null}
    </HomeSection>
  );
}

function Loading(props: { title: string; onBack?: () => void }) {
  return (
    <Screen header={<Header title={props.title} onBack={props.onBack} />}>
      <EmptyState icon="cloud" title="Loading" sub="Reading this organization from this device." />
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
  if (!v.org || !v.state) return <Loading title="Organization" />;
  const mine = Object.values(v.org.members[ctx.session.actorId] ?? {}).find((m) => m.removed.value === false && m.scope.level === 'org');
  const memberCount = new Set(memberEntries(v.org).map((e) => e.profileId)).size;
  // Adding a language is the organization's to do: org-scope Manage structure.
  const mayAdd = privilegesFor(v.org, ctx.session.actorId).has('manage_structure');
  // The demo's "Invite people" (gate assigner), and Invite itself, which a role may hold without assigning: it asks both.
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
            <Text style={txt.xs}>{plural(v.languages.length, 'language')} · {plural(memberCount, 'member')}</Text>
            {mine ? <View style={{ flexDirection: 'row' }}><Badge label={roleName(ctx, mine.roleId.value)} tone="brand" /></View> : null}
          </View>
        </View>
        {v.languages.length && v.orgProgress ? <HomeProgressBars p={v.orgProgress} /> : null}
      </Card>
      {canInvite ? <HomePrimary label="Invite people" icon="plus" onPress={() => ctx.go('invite_member', { level: 'org' })} /> : null}
      <HomeSection label="Languages"
        add={mayAdd ? { label: 'New language', onPress: () => ctx.go('new_language') } : undefined}>
        {v.languages.length === 0 ? (
          <View style={{ padding: space.lg }}><Text style={txt.smMuted}>No languages yet. Add the first one your team will record.</Text></View>
        ) : v.languages.slice(0, shown).map((languageId) => {
          const p = v.progressOf(languageId);
          // Only the open language's flow is on this phone.
          const flow = languageId === v.openId && v.state?.flow ? `${deriveFlow(v.state).name} · ` : '';
          return (
            <Row key={languageId} icon="globe" label={v.label(languageId)} onPress={() => ctx.go('language_home', { languageId })}
              current={beside?.screen === 'language_home' && beside.params['languageId'] === languageId}
              sub={p ? `${flow}${progressLine(p)}` : 'Open it to bring it onto this device'} />
          );
        })}
      </HomeSection>
      <ShowMore remaining={v.languages.length - shown} step={20} onMore={() => setShown((n) => n + 20)} />
      <PeopleRows ctx={ctx} level="org" />
      <HomeSetup ctx={ctx} from="org_home" level="org" languageIds={v.languages} extra={{ label: 'license', rows: <LicenseSection ctx={ctx} /> }} />
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
      await ctx.org.append('v1.LicenseSet', { license });
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

/** Whether the open language is listed on Explore (one listing per language). */
function usePublicListing(ctx: Ctx) {
  const may = ctx.session.can('manage_structure');
  const { orgId, languageId } = ctx.language;
  const [listed, setListed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!may || !languageId) return;
    let active = true;
    void supabase.from('language_visibility').select('listed').eq('org_id', orgId).eq('language_id', languageId).maybeSingle()
      .then(({ data, error: failed }) => {
        if (!active) return;
        // Offline or refused: say so rather than showing "not listed".
        if (failed) { noteExpected('read listing', failed); setError(failed.message); } else setListed(data?.listed ?? false);
      });
    return () => { active = false; };
  }, [may, orgId, languageId]);
  async function set(value: boolean) {
    setBusy(true);
    try {
      const { error: failed } = await supabase.rpc('set_language_visibility', { p_org: orgId, p_language: languageId, p_listed: value });
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
  // A language's screens are about the open language: navigating with its id opens it.
  const languageId = v.openId;
  const translators = useMemo(() => {
    const org = ctx.org.state;
    if (!org) return [];
    return memberEntries(org)
      .filter((e) => e.scope.level === 'language' && e.scope.languageId === languageId && org.roles[e.roleId]?.privileges.value?.includes('translate'))
      .map((e) => e.profileId);
  }, [ctx.org.state, languageId]);
  const listing = usePublicListing(ctx);
  if (!v.state) return <Loading title="Language" />;
  const info = languageInfo(v.org, languageId);
  if (!info) {
    return (
      <Screen header={<Header title="Language" onBack={ctx.back} />}>
        <EmptyState icon="globe" title="No languages yet" sub="Add a language from the organization home first." />
      </Screen>
    );
  }
  const name = info.name;
  const atRoot = ctx.session.adminScope?.level === 'language';
  const who = translators.length ? translators.map((id) => ctx.name(id)).join(', ') : 'Unassigned';
  return (
    <Screen header={<Header title={name} onBack={atRoot ? undefined : ctx.back} crumbs={[
      { label: v.orgName, onPress: () => ctx.go('org_home') },
      { label: name }
    ]} />}>
      <Card>
        <Text style={txt.xs}>Translator: {who} · Review flow: {v.state.flow ? deriveFlow(v.state).name : 'None yet'} · Code {info.code.toUpperCase()}</Text>
        <HomeProgressBars p={v.progressOf(languageId) ?? { total: 0, recorded: 0, done: 0 }} />
      </Card>
      <HomePrimary label="Open the passage map" icon="map" onPress={() => { ctx.setLanguage(languageId); ctx.go('map_home', { languageId }); }} />
      <PeopleRows ctx={ctx} level="language" languageId={languageId} />
      <HomeSetup ctx={ctx} from="language_home" level="language" languageIds={[languageId]} languageId={languageId}
        {...(listing.may ? { extra: { label: 'public listing', rows: (
          <Row icon="globe" label="List publicly" sub="Share its name and progress only" last
            right={<Toggle label={`List ${name} publicly`} on={listing.listed} disabled={listing.busy} onToggle={() => void listing.set(!listing.listed)} />} />
        ) } } : {})} />
      {listing.error ? <Banner icon="flag" tone="amber" title="Could not read or change the listing" body={listing.error} /> : null}
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
        <Row icon="globe" label={label} sub={plural(count, 'member')} last
          onPress={d.onToggle} expanded={d.open} right={<Ico name={d.open ? 'up' : 'down'} size={22} color={C.primary} />} />
        {d.open ? [...groups].map(([key, list]) => (
          <View key={key} style={{ gap: space.xs }}>
            <Text style={[txt.label, { paddingHorizontal: space.xs }]}>
              {v.label(key)} · {list.length}
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
          <Row key={r.id} leading={<Avatar id={r.profileId} name={r.name} />} label={r.name ?? ctx.name(r.profileId)} sub={r.message || 'Asked to join'}
            onPress={() => ctx.go('edit_member', { memberId: r.profileId, requestId: r.id, level, ...(r.name ? { name: r.name } : {}) })}
            right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}><Badge label="Pending" tone="amber" /><Ico name="right" size={22} color={C.muted} /></View>} />
        ))}
        {rows(current.slice(0, shown))}
        {current.length === 0 && requests.length === 0 ? (
          <View style={{ padding: space.lg }}><Text style={txt.smMuted}>No members assigned at this level yet.</Text></View>
        ) : null}
      </Group>
      <ShowMore remaining={current.length - shown} step={30} onMore={() => setShown((n) => n + 30)} />
      {level !== 'language' ? (
        <>
          <SectionLabel label="Expand by" />
          {group('language', 'By language')}
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
      <SectionLabel label="What will they do?" />
      <Choices items={props.roles.map((r) => ({ id: r.id, label: r.name, sub: r.sub }))} value={value.roleId}
        onChoose={(roleId) => props.onChange({ ...value, roleId })} empty="No roles available here." />
      {/* Something other than the usual roles: make one here (demo ADR-039, amended 2026-10-08). */}
      {ctx.session.can('manage_roles') && TO_ROLE_EDITOR.some((from) => edgeFor(from, 'role_editor')) ? (
        <GhostBtn label="Something else: make a new role" icon="plus" onPress={() => ctx.go('role_editor', { roleId: 'new' })} />
      ) : null}
      <SectionLabel label="Where?" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {props.levels.map((l) => (
          <Chip key={l} label={LEVEL_LABEL[l]} on={value.level === l} onPress={() => {
            const languageId = l === 'language' ? value.languageId || defaultLanguage(languages, v.openId) : '';
            props.onChange({ ...value, level: l, languageId });
          }} />
        ))}
      </View>
      <Text style={txt.xs}>Where this person can use the selected role's privileges.</Text>
      {value.level === 'language' ? (
        <>
          <SectionLabel label="Language" />
          <Text style={txt.xs}>Which language this assignment applies to.</Text>
          <Choices items={languages.map((id) => ({ id, label: v.label(id) }))} value={value.languageId}
            onChoose={(languageId) => props.onChange({ ...value, languageId })} empty="No languages yet." />
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

export function InviteMember(ctx: Ctx) {
  const level = parseLevel(ctx.params['level'] ?? ctx.session.adminScope?.level);
  const me = ctx.session.actorId;
  const levels = assignableLevels(ctx.org.state, me, level);
  const floor = levels[0] ?? null;
  const roles = liveRoles(ctx);
  const [email, setEmail] = useState('');
  const [form, setForm] = useState<Assignment>(() => ({
    roleId: '', level: floor ?? 'org',
    languageId: floor === 'language' ? defaultLanguage(grantableLanguages(ctx.org.state, me), ctx.language.languageId) : ''
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scope = scopeOf(form);
  const ready = /\S+@\S+\.\S+/.test(email.trim()) && !!form.roleId && !!scope && !!floor;
  async function send() {
    if (!ready || !scope) return;
    setBusy(true);
    setError('');
    try {
      const invite = await issueInvite(ctx.language.orgId, form.roleId, scope);
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
  const params = { level, ...(ctx.params['languageId'] ? { languageId: ctx.params['languageId'] } : {}) };
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

export function EditMember(ctx: Ctx) {
  const v = useOrgView(ctx);
  const memberId = ctx.params['memberId'] ?? '';
  const requestId = ctx.params['requestId'];
  const viewLevel = parseLevel(ctx.params['level'] ?? ctx.session.adminScope?.level);
  const entries = useMemo(() => memberEntries(v.org).filter((e) => e.profileId === memberId), [v.org, memberId]);
  const entry = entries.find((e) => e.key === ctx.params['entry']) ?? entries[0];
  const pending = !!requestId;
  const roles = liveRoles(ctx);
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
  const allowed = ctx.session.can('invite_members');
  const scope = scopeOf(form);
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
      ctx.toast('Put back.');
    } catch (e) {
      ctx.toast(`Not put back. ${failure(where, e)}`);
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
      ctx.toast(`${who} is now ${role}`);
      return;
    }
    if (!entry) return;
    const plan = changeMembership(entry, { roleId: form.roleId, scope });
    if (plan.apply.length === 0) return;
    await runOrg(plan.apply);
    ctx.toast(`${who} is now ${role}`, () => undoOrg(plan.undo, 'undo role change'));
  });
  const remove = () => attempt(async () => {
    if (!entry) return;
    const where = LEVEL_LABEL[entry.scope.level].toLowerCase();
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
      <Row leading={<Avatar id={memberId} name={requesterName} size={48} />} label={who} sub={pending ? 'Asked to join' : v.target(entry!.scope)} />
      {!pending && memberId ? <HelpSignIn memberId={memberId} who={who} /> : null}
      <Text style={txt.xs}>{pending
        ? 'This person created an account and asked to join. Assign a role and scope to give them access.'
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
    catch (e) { noteExpected('sign-in code', e); setError(e instanceof Error ? e.message : 'Try again when connected.'); }
    finally { setBusy(false); }
  }
  return (
    <>
      {key ? (
        <Card style={{ alignItems: 'center' }}>
          <QRCode value={signInUri(key.code, APP_URL)} size={200} backgroundColor={C.white} color={C.dark} />
          <Text style={txt.h3}>Sign-in code for {props.who}</Text>
          <Text style={[txt.smMuted, { textAlign: 'center' }]}>
            On their new device, {first} opens LangQuest, taps Scan a code and points it here. It works once, for one hour.
            {key.lost ? ' Using it signs their old device out.' : ''}
          </Text>
          <Text style={[txt.xs, { textAlign: 'center' }]}>{first} will see in Settings that you helped them sign in.</Text>
        </Card>
      ) : (
        <Card>
          <View style={HELP_ROW}>
            <Ico name="lock" size={22} color={C.primary} />
            <Text style={[txt.body, { flex: 1 }]}>{first} has no email. On a new device, show them a sign-in code.</Text>
          </View>
          <View style={HELP_ROW}>
            <Text style={[txt.sm, { flex: 1 }]}>Their old device is lost or stolen: sign it out</Text>
            <Toggle on={lost} onToggle={() => setLost(!lost)} label="Their old device is lost or stolen" />
          </View>
          <PrimaryBtn label="Help them sign in" icon="qr" busy={busy} disabled={busy} onPress={() => void make()} />
        </Card>
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
  const me = ctx.session.actorId;
  const floor = grantFloor(ctx.org.state, me, level) ?? level;
  const scope: Scope = floor === 'language'
    ? { level: 'language', languageId: defaultLanguage(grantableLanguages(ctx.org.state, me), ctx.language.languageId) || ctx.language.languageId }
    : { level: 'org' };
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
      setInvite(await issueInvite(ctx.language.orgId, roleId, scope, { label: name, maxUses: audience === 'group' ? GROUP_USES : 1 }));
      setStep(2);
    } catch (e) {
      // Offline or refused by the server: its words say which.
      noteExpected('issue invite', e);
      setError(e instanceof Error ? e.message : 'Try again when connected.');
    } finally {
      setBusy(false);
    }
  }
  const params = { level, ...(ctx.params['languageId'] ? { languageId: ctx.params['languageId'] } : {}) };
  // The link carries the org and the token only: a scanner shows nothing a
  // forwarded link could have altered. The name stays on this screen.
  const uri = invite ? inviteUri(ctx.language.orgId, invite.token, APP_URL) : '';
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
          {/* A new invite for someone already on the team makes a second account (decisions.md 59). */}
          <Banner icon="lock" title="Already on the team, with a new device?"
            body="Open them in Members and tap Help them sign in. A new invite would make a second account." />
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

/** Use a library choice here: ours as it is, a shared one followed with automatic updates (copied when its owner does not allow following). */
async function adoptChoice(lib: ReturnType<typeof useLibrary>, c: LibraryChoice): Promise<string> {
  if (c.source === 'ours') return c.item.itemId;
  return c.shared.subscribable ? lib.subscribe(c.shared, true) : lib.copy(c.shared);
}

/**
 * A new language (ORG-2, decision 63): its name and code, which part of
 * the Bible, its template and its review flow. It is listed in the
 * organization's stream first; its own stream then starts with the
 * template and the flow, which every language needs.
 */
export function NewLanguage(ctx: Ctx) {
  const state = ctx.language.state;
  const lib = useLibrary(ctx);
  const library = ctx.org.state?.library;
  const sharedTemplates = useSharedItems('template', lib.orgId);
  const sharedFlows = useSharedItems('flow', lib.orgId);
  // The organization's own first, then shared ones (LangQuest's starter first).
  const templates = useMemo(() => libraryChoices(library ?? {}, lib.items('template'), sharedTemplates.rows, STARTER_TEMPLATE.name), [library, lib.items, sharedTemplates.rows]);
  const flows = useMemo(() => libraryChoices(library ?? {}, lib.items('flow'), sharedFlows.rows, STARTER_FLOW.name), [library, lib.items, sharedFlows.rows]);
  // Suggested: what the open language uses, else LangQuest's starter.
  const suggestedTemplate = useMemo(() => suggestedChoice(state?.template?.value.itemId, templates, STARTER_TEMPLATE), [state, templates]);
  const suggestedFlow = useMemo(() => suggestedChoice(state?.flow?.value.itemId, flows, STARTER_FLOW), [state, flows]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [scope, setScope] = useState<LanguageScope>('nt');
  const [pickedTemplate, setPickedTemplate] = useState<string | null>(null);
  const [chosenBooks, setChosenBooks] = useState<Set<string>>(new Set());
  const [pickedFlow, setPickedFlow] = useState<string | null>(null);
  const [templateLimit, setTemplateLimit] = useState(6);
  const [flowLimit, setFlowLimit] = useState(6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const template = templates.find((c) => c.key === (pickedTemplate ?? suggestedTemplate));
  const flow = flows.find((c) => c.key === (pickedFlow ?? suggestedFlow));
  const docs = useLibraryDocs(lib.orgId, [template?.hash]);
  const doc = docs.get<TemplateDoc>(template?.hash);
  const orgName = ctx.org.state?.org?.value.name ?? 'the organization';
  const shownTemplates = [...templates.filter((c) => c.source === 'ours'), ...templates.filter((c) => c.source === 'shared').slice(0, templateLimit)];
  const shownFlows = [...flows.filter((c) => c.source === 'ours'), ...flows.filter((c) => c.source === 'shared').slice(0, flowLimit)];
  async function create() {
    const title = name.trim();
    if (!title || busy || !template || !flow) return;
    setBusy(true);
    setError('');
    try {
      const org = ctx.org.state;
      // The new language has no members yet: its first events go in under org-scope privileges.
      const mine = org ? privilegesFor(org, ctx.session.actorId) : new Set<string>();
      if (!mine.has('manage_templates') || !mine.has('manage_flows')) {
        throw new CommandError('Adding a language needs permission to manage templates and review flows for the whole organization.');
      }
      const languoid = code.trim() || title.slice(0, 3);
      const languageId = newLanguageId(languoid, Crypto.randomUUID());
      const loaded = (await loadDocs(lib.orgId, [template.hash])).get(template.hash);
      if (!loaded || loaded.format !== 'template@1') throw new CommandError('Its template is not on this device yet. Try again when connected.');
      const books = booksInScope(loaded, scope, chosenBooks);
      if (books && books.length === 0) throw new CommandError('Choose at least one book.');
      const templateItem = await adoptChoice(lib, template);
      const flowItem = await adoptChoice(lib, flow);
      const fresh = emptyLanguageState();
      const plan = addLanguage(org, {
        languageId, code: languoid, name: title,
        template: await lib.applySpecs(templateItem, { docHash: template.hash, into: fresh, ...(books ? { books } : {}) }),
        flow: await lib.applySpecs(flowItem, { docHash: flow.hash, into: fresh })
      });
      await ctx.org.append('v1.LanguageAdded', plan.added);
      // Its stream takes events once the organization's lists it: send that first when connected.
      await ctx.org.sync().catch((e: unknown) => noteExpected('new language listing', e));
      await appendToLanguage({ orgId: ctx.language.orgId, languageId, actorId: ctx.session.actorId, specs: plan.specs });
      ctx.toast(`${title} added to ${orgName} · uses ${template.name} and ${flow.name}`);
      // Back opens it: the language this person works in is the one the app opens.
      ctx.setLanguage(languageId);
      ctx.back();
    } catch (e) {
      setError(failure('new language', e));
    } finally {
      setBusy(false);
    }
  }
  const followed = (c: LibraryChoice) => c.source === 'shared'
    ? ` ${orgName} ${c.shared.subscribable ? 'follows' : 'copies'} it from ${c.shared.org_name}${c.shared.subscribable ? ', so new versions reach the language by themselves' : ''}.`
    : '';
  return (
    <Screen header={<Header title="New Language" onBack={ctx.back} />}
      footer={<PrimaryBtn label="Create Language" disabled={!name.trim() || !template || !flow} busy={busy} onPress={() => void create()} />}>
      <Text style={txt.xs}>This language is added to {orgName}. You can invite language admins from Members after it is created.</Text>
      <Field label="Language name" value={name} onChangeText={setName} placeholder="Enter language name" autoCapitalize="words" />
      <Field label="Language code" value={code} onChangeText={setCode} placeholder="e.g. DIN" autoCapitalize="none" />
      {doc?.structure !== 'outline' ? (
        <>
          <SectionLabel label="Which books?" />
          <Choices items={LANGUAGE_SCOPES.map((s) => ({ id: s.id, label: s.label, sub: s.sub }))} value={scope} onChoose={(id) => setScope(id as LanguageScope)} />
          {scope === 'custom' && doc?.bible ? (
            <ChipRow>
              {doc.bible.books.map((b) => (
                <Chip key={b.book} label={b.name || b.book} on={chosenBooks.has(b.book)}
                  onPress={() => setChosenBooks((cur) => { const next = new Set(cur); if (next.has(b.book)) next.delete(b.book); else next.add(b.book); return next; })} />
              ))}
            </ChipRow>
          ) : null}
        </>
      ) : null}
      <SectionLabel label="What will they record?" />
      <Text style={txt.xs}>Pick a ready-made set of passages. You can divide the books your own way afterwards, under What they record.</Text>
      {sharedTemplates.error ? (
        <Banner icon="cloud" tone="amber" title="Could not refresh the shared templates"
          body={sharedTemplates.rows.length ? 'Showing the list this device saved.' : 'Connect to see the ones other organizations share.'} />
      ) : null}
      <Choices items={shownTemplates.map((c) => ({ id: c.key, label: c.name, sub: choiceLine(c, sourceLine), ...(c.key === suggestedTemplate ? { badge: 'Suggested' } : {}) }))}
        value={template?.key ?? ''} onChoose={setPickedTemplate} empty={sharedTemplates.loaded ? 'No templates to choose from yet.' : 'Loading…'} />
      <ShowMore remaining={templates.length - shownTemplates.length} step={6} onMore={() => setTemplateLimit((l) => l + 6)} />
      {template ? (
        <Text style={txt.xs}>Its passages come from {template.name}.{followed(template)} It can be changed later under Content Templates.</Text>
      ) : null}
      <SectionLabel label="Who checks the recordings?" />
      {sharedFlows.error ? (
        <Banner icon="cloud" tone="amber" title="Could not refresh the shared flows"
          body={sharedFlows.rows.length ? 'Showing the list this device saved.' : 'Connect to see the ones other organizations share.'} />
      ) : null}
      <Choices items={shownFlows.map((c) => ({ id: c.key, label: c.name, sub: choiceLine(c, sourceLine), ...(c.key === suggestedFlow ? { badge: 'Suggested' } : {}) }))}
        value={flow?.key ?? ''} onChoose={setPickedFlow} empty={sharedFlows.loaded ? 'No review flows to choose from yet.' : 'Loading…'} />
      <ShowMore remaining={flows.length - shownFlows.length} step={6} onMore={() => setFlowLimit((l) => l + 6)} />
      {flow ? (
        <Text style={txt.xs}>Passages are checked with {flow.name}.{followed(flow)} It can be changed later under Review Flows.</Text>
      ) : null}
      {error ? <Banner icon="flag" tone="amber" title="Not created" body={error} /> : null}
    </Screen>
  );
}

// ---- Review Teams (FLOW-5) --------------------------------------------------------------------------------

export function ReviewTeams(ctx: Ctx) {
  const state = ctx.language.state;
  const beside = useOpenDetail();
  const languageId = ctx.language.languageId;
  const canManage = ctx.session.can('manage_teams');
  const teams = useMemo(() => Object.entries(state?.teams ?? {})
    .sort(([, a], [, b]) => a.name.value.localeCompare(b.name.value)), [state]);
  const language = languageInfo(ctx.org.state, languageId)?.name ?? 'this language';
  return (
    <Screen header={<Header title="Review Teams" onBack={ctx.back}
      action={canManage ? <SmallBtn label="Team" icon="plus" tone="primary" onPress={() => ctx.go('review_team_editor', { languageId })} /> : undefined} />}>
      <Text style={txt.xs}>Teams for {language}. Members must have the Review privilege for this language.</Text>
      {teams.length === 0 ? (
        <EmptyState icon="people" title="No review teams" sub={canManage ? 'Create a team to group language reviewers.' : 'No teams have been set up yet.'} />
      ) : teams.map(([teamId, t]) => {
        const people = state ? teamMembers(state, teamId) : [];
        return (
          <Card key={teamId} accessibilityLabel={t.name.value} current={beside?.screen === 'review_team_editor' && beside.params['teamId'] === teamId}
            onPress={canManage ? () => ctx.go('review_team_editor', { languageId, teamId }) : undefined}>
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
  const state = ctx.language.state;
  const languageId = ctx.language.languageId;
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
    const ids = state ? deriveFlow(state).steps.flatMap((st) => st.kindIds) : [];
    return [...new Set([...ids, ...(kindBefore ? [kindBefore] : [])])];
  }, [state, kindBefore]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const eligible = useMemo(() => {
    const ids = new Set([...reviewEligible(ctx.org.state, languageId), ...before]);
    return [...ids].sort((a, b) => ctx.name(a).localeCompare(ctx.name(b)));
    // ctx.name reads the same people map for the whole visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.org.state, languageId, before]);
  const toggle = (id: string) => setChosen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  async function save() {
    const title = name.trim();
    if (!state || !title || busy) return;
    setBusy(true);
    setError('');
    try {
      const commandId = Crypto.randomUUID();
      const plan = saveTeam(state, { commandId, teamId, name: title, members: chosen });
      // The kind it usually reviews (ADR-029): written only when it changed.
      const kindSpec = (id: string, value: string | null): EventSpec => ({ id, type: 'v1.ReviewTeamKindSet', payload: { teamId, kindId: value } } as EventSpec);
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
