// Running the organization (Manage tab). Ports the demo's src/screens/org.tsx:
// OrgHomeScreen, ProjectHomeScreen, LanguageHomeScreen (with HomeSection,
// HomeCatalogRows, HomeMemberRows, HomeProgressBars), MembersListScreen,
// InviteMemberScreen (invite and edit), InviteQrScreen, ReviewTeamsScreen,
// ReviewTeamEditorScreen and NewStructureItemScreen (new project, new
// language). Requirements ORG-1, ORG-2, ORG-5, ORG-6, ORG-7, NAV-6, FLOW-5;
// ADR-017 (admins reach these homes through Manage), ADR-025 (a language
// owns its template, starting from the one its project suggests).
import { deriveFlow, keyTermsFor, laneName, languageProgress, materialsFor, contentTemplate, SEED_ROLES, type LanguageProgress, type Role, type Scope, type ScopeLevel } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Share, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import type { Ctx } from '../ctx';
import { indexesFor } from '../indexes';
import { decideRequest, inviteUri, issueInvite, pendingRequests, type NewInvite, type PendingRequest } from '../invites';
import {
  Badge, Banner, Card, Chip, EmptyState, Field, GhostBtn, Group, Header, Ico, LinkBtn, PrimaryBtn, ProgressBar, Row,
  Screen, SectionLabel, Segments, ShowMore, SmallBtn, Toggle, txt
} from '../kit';
import {
  addLanguage, assignableLevels, changeMembership, editableAt, grantFloor, groupBelow, LANGUAGE_SCOPES, LEVEL_LABEL,
  membersAbove, membersAt, memberEntries, newLaneId, parseLevel, progressLine, removeMembership, reviewEligible,
  saveTeam, scopeAt, suggestedTemplate, sumProgress, teamMembers,
  type HomeProgress, type LanguageScope, type MemberEntry, type OrgOp
} from '../orgAdmin';
import { plural, when } from '../passageView';
import { contractsFor } from '../screenContracts';
import { supabase } from '../supabase';
import { C, radius, space } from '../theme';
import { PersonAvatar, usePerson } from '../UserChip';

// ---- shared reading ----------------------------------------------------------------------

/** Names and progress for the open organization and project, derived once per fold. */
function useOrgView(ctx: Ctx) {
  const state = ctx.project.state;
  const org = ctx.org.state;
  const projectId = ctx.project.projectId;
  const progress = useMemo(() => {
    const out = new Map<string, LanguageProgress>();
    if (!state) return out;
    const idx = indexesFor(state);
    for (const laneId of Object.keys(state.lanes)) out.set(laneId, languageProgress(state, laneId, idx));
    return out;
  }, [state]);
  const lanes = useMemo(() => state
    ? Object.keys(state.lanes).sort((a, b) => laneName(state, a).localeCompare(laneName(state, b))) : [], [state]);
  const orgName = org?.org?.value.name ?? 'Organization';
  const projectName = (id: string) => org?.projects[id]?.name ?? (id === projectId ? state?.project?.value.name : undefined) ?? 'Project';
  /** Projects the org registered, plus the open one if it predates the registry. */
  const projects = useMemo(() => {
    const ids = Object.keys(org?.projects ?? {});
    if (state?.project && !ids.includes(projectId)) ids.push(projectId);
    return ids.sort((a, b) => projectName(a).localeCompare(projectName(b)));
    // projectName reads the same two folds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, state, projectId]);
  const laneLabel = (laneId: string) => (state?.lanes[laneId] ? laneName(state, laneId) : laneId);
  const laneProgress = (laneId: string): HomeProgress => progress.get(laneId) ?? { total: 0, recorded: 0, done: 0 };
  const projectProgress = sumProgress(lanes.map(laneProgress));
  /** "Dinka · Luke Project": where a membership applies. */
  const target = (scope: Scope) => scope.level === 'org' ? orgName
    : scope.level === 'project' ? projectName(scope.projectId ?? '')
    : `${scope.laneId ? laneLabel(scope.laneId) : 'Language'} · ${projectName(scope.projectId ?? '')}`;
  return { state, org, projectId, orgName, projectName, projects, lanes, laneLabel, laneProgress, projectProgress, target };
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

/** A home section: label, a card of rows, and an add row. Open unless hidden (kept across Back). */
function HomeSection(props: { ctx: Ctx; id: string; label: string; add?: { label: string; onPress: () => void }; children?: ReactNode }) {
  const hidden = props.ctx.details(`home:${props.id}`);
  return (
    <View>
      <SectionLabel label={props.label} action={<LinkBtn label={hidden.open ? 'Show' : 'Hide'} onPress={hidden.onToggle} />} />
      {hidden.open ? null : (
        <Group>
          {props.children}
          {props.add ? <Row icon="plus" label={props.add.label} onPress={props.add.onPress} last /> : null}
        </Group>
      )}
    </View>
  );
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

type HomeId = 'org_home' | 'project_home' | 'language_home';

/**
 * Manage Content and Manage Processes (ORG-1): only the rows this person may
 * open, each saying what the languages under this home use.
 */
function CatalogRows(props: { ctx: Ctx; from: HomeId; level: ScopeLevel; laneIds: string[]; laneId?: string }) {
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
      templates: uniq(laneIds.map((l) => contentTemplate(state.laneTemplates[l]?.value.templateId ?? '')?.name ?? 'None')),
      flows: uniq(laneIds.map((l) => deriveFlow(state, l).name))
    };
  }, [state, laneIds, props.laneId]);
  const applied = (names: string[]) => props.level === 'lane'
    ? `${names[0] ?? 'None'} applied`
    : laneIds.length === 0 ? 'No languages yet' : `${names.join(', ')} · ${plural(laneIds.length, 'language')}`;
  const templates = can('manage_templates');
  const reference = can('manage_reference');
  const flows = can('manage_flows');
  const teams = props.from === 'language_home';
  return (
    <>
      {templates || reference ? (
        <HomeSection ctx={ctx} id={`${props.from}:content`} label="Manage Content">
          {templates ? <Row icon="template" label="Content Templates" sub={applied(counts.templates)} onPress={() => ctx.go('templates_home', params)} last={!reference} /> : null}
          {reference ? <Row icon="book" label="Reference Material" onPress={() => ctx.go('reference_home', params)} last
            sub={`${counts.study} study · ${counts.questions} question sets · ${counts.terms} key terms`} /> : null}
        </HomeSection>
      ) : null}
      {flows || teams ? (
        <HomeSection ctx={ctx} id={`${props.from}:process`} label="Manage Processes">
          {flows ? <Row icon="flow" label="Review Flows" sub={applied(counts.flows)} onPress={() => ctx.go('flows_home', params)} last={!teams} /> : null}
          {teams ? <Row icon="people" label="Review Teams" sub="Language reviewers grouped into teams" last
            onPress={() => ctx.go('review_teams', { laneId: props.laneId ?? '' })} /> : null}
        </HomeSection>
      ) : null}
    </>
  );
}

/** Manage Members: roles visible here and who is assigned. */
function MemberRows(props: { ctx: Ctx; from: HomeId; level: ScopeLevel; laneId?: string }) {
  const { ctx } = props;
  const entries = useMemo(() => memberEntries(ctx.org.state, ctx.project.state, ctx.project.projectId), [ctx.org.state, ctx.project.state, ctx.project.projectId]);
  const here = membersAt(entries, props.level, ctx.project.projectId, props.laneId).length;
  const people = new Set(entries.map((e) => e.profileId)).size;
  const sub = props.level === 'org' ? `${here} at org level · ${people} total`
    : props.level === 'project' ? `${here} assigned in this project` : `${here} assigned at this language`;
  const params = { level: props.level, ...(props.laneId ? { laneId: props.laneId } : {}) };
  return (
    <HomeSection ctx={ctx} id={`${props.from}:members`} label="Manage Members">
      <Row icon="star" label="Roles" sub={`${plural(liveRoles(ctx).length, 'role')} at this level and above`} onPress={() => ctx.go('roles_home', params)} />
      <Row icon="people" label="Members" sub={sub} onPress={() => ctx.go('members_list', params)} last />
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

export function OrgHome(ctx: Ctx) {
  const v = useOrgView(ctx);
  const [shown, setShown] = useState(20);
  if (!v.org) return <Loading title="Organization" />;
  const mine = Object.values(v.org.members[ctx.session.actorId] ?? {}).find((m) => m.removed.value === false && m.scope.level === 'org');
  const memberCount = new Set(memberEntries(v.org, v.state, v.projectId).map((e) => e.profileId)).size;
  const open = (id: string) => {
    if (id === v.projectId) ctx.go('project_home');
    else void ctx.openOrganization(ctx.project.orgId, id).catch((e: Error) => ctx.toast(`Could not open it: ${e.message}`));
  };
  return (
    <Screen header={<Header title={v.orgName} />}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ width: 56, height: 56, borderRadius: radius.lg, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' }}>
            <Ico name="building" size={28} color={C.primary} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={txt.h3}>{v.orgName}</Text>
            <Text style={txt.xs}>{plural(v.projects.length, 'project')} · {plural(memberCount, 'member')}</Text>
            {mine ? <View style={{ flexDirection: 'row' }}><Badge label={roleName(ctx, mine.roleId.value)} tone="brand" /></View> : null}
          </View>
        </View>
      </Card>
      <HomeSection ctx={ctx} id="org_home:projects" label="Manage Projects"
        add={ctx.session.can('manage_structure') ? { label: 'New project', onPress: () => ctx.go('new_project') } : undefined}>
        {v.projects.length === 0 ? (
          <View style={{ padding: space.lg }}>
            <Text style={txt.smMuted}>No projects yet. A project holds the languages you translate into — add one to start.</Text>
          </View>
        ) : v.projects.slice(0, shown).map((id) => (
          <Row key={id} icon="folder" label={v.projectName(id)} onPress={() => open(id)}
            sub={id === v.projectId ? progressLine(v.projectProgress) : 'Open it to see its progress'} />
        ))}
      </HomeSection>
      <ShowMore remaining={v.projects.length - shown} step={20} onMore={() => setShown((n) => n + 20)} />
      <CatalogRows ctx={ctx} from="org_home" level="org" laneIds={v.lanes} />
      <MemberRows ctx={ctx} from="org_home" level="org" />
    </Screen>
  );
}

// ---- Project Home ----------------------------------------------------------------------------------

export function ProjectHome(ctx: Ctx) {
  const v = useOrgView(ctx);
  const [shown, setShown] = useState(20);
  const [listed, setListed] = useState(false);
  const [visibilityError, setVisibilityError] = useState('');
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const mayList = ctx.session.can('manage_structure');
  useEffect(() => {
    if (!mayList) return;
    void supabase.from('project_visibility').select('listed')
      .eq('org_id', ctx.project.orgId).eq('project_id', ctx.project.projectId)
      .maybeSingle().then(({ data, error }) => {
        if (error) setVisibilityError(error.message);
        else setListed(data?.listed ?? false);
      });
  }, [mayList, ctx.project.orgId, ctx.project.projectId]);
  async function setVisibility(value: boolean) {
    setVisibilityBusy(true);
    const { error } = await supabase.rpc('set_project_visibility', { p_org: ctx.project.orgId, p_project: ctx.project.projectId, p_listed: value });
    if (error) setVisibilityError(error.message);
    else { setListed(value); setVisibilityError(''); }
    setVisibilityBusy(false);
  }
  if (!v.state) return <Loading title="Project" />;
  const name = v.projectName(v.projectId);
  const atRoot = ctx.session.adminScope?.level === 'project';
  return (
    <Screen header={<Header title={name} onBack={atRoot ? undefined : ctx.back}
      crumbs={[{ label: v.orgName, onPress: () => ctx.go('org_home') }, { label: name }]} />}>
      <Card>
        <Text style={txt.xs}>{plural(v.lanes.length, 'language')}</Text>
        <HomeProgressBars p={v.projectProgress} />
      </Card>
      <HomeSection ctx={ctx} id="project_home:languages" label="Manage Languages"
        add={ctx.session.can('manage_structure') ? { label: 'New language', onPress: () => ctx.go('new_language') } : undefined}>
        {v.lanes.length === 0 ? (
          <View style={{ padding: space.lg }}><Text style={txt.smMuted}>No languages in this project yet.</Text></View>
        ) : v.lanes.slice(0, shown).map((laneId) => (
          <Row key={laneId} icon="globe" label={v.laneLabel(laneId)} onPress={() => ctx.go('language_home', { laneId })}
            sub={`${deriveFlow(v.state!, laneId).name} · ${progressLine(v.laneProgress(laneId))}`} />
        ))}
      </HomeSection>
      <ShowMore remaining={v.lanes.length - shown} step={20} onMore={() => setShown((n) => n + 20)} />
      <CatalogRows ctx={ctx} from="project_home" level="project" laneIds={v.lanes} />
      <MemberRows ctx={ctx} from="project_home" level="project" />
      {mayList ? (
        <HomeSection ctx={ctx} id="project_home:discovery" label="Discovery">
          <Row icon="globe" label="List this project publicly" sub="Share its name, languages and progress only" last
            right={<Toggle label="List this project publicly" on={listed} disabled={visibilityBusy} onToggle={() => void setVisibility(!listed)} />} />
        </HomeSection>
      ) : null}
      {visibilityError ? <Banner icon="flag" tone="amber" title="Could not read or change the listing" body={visibilityError} /> : null}
    </Screen>
  );
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
  if (!v.state) return <Loading title="Language" />;
  if (!v.state.lanes[laneId]) {
    return (
      <Screen header={<Header title="Language" onBack={ctx.back} />}>
        <EmptyState icon="globe" title="No languages yet" sub="Add a language from the project home first." />
      </Screen>
    );
  }
  const name = v.laneLabel(laneId);
  const project = v.projectName(v.projectId);
  const atRoot = ctx.session.adminScope?.level === 'lane';
  const who = translators.length ? translators.map((id) => ctx.name(id)).join(', ') : 'Unassigned';
  return (
    <Screen header={<Header title={name} onBack={atRoot ? undefined : ctx.back} crumbs={[
      { label: v.orgName, onPress: () => ctx.go('org_home') },
      { label: project, onPress: () => ctx.go('project_home') },
      { label: name }
    ]} />}>
      <Card>
        <Text style={txt.xs}>Translator: {who} · Review flow: {deriveFlow(v.state, laneId).name} · Code {v.state.lanes[laneId]!.languoidId.toUpperCase()}</Text>
        <HomeProgressBars p={v.laneProgress(laneId)} />
      </Card>
      <Card style={{ backgroundColor: C.primary, borderColor: C.primary }} accessibilityLabel="Passage map"
        onPress={() => { ctx.setLane(laneId); ctx.go('map_home', { laneId }); }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
            <Ico name="map" size={22} color={C.white} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[txt.body, { color: C.white, fontWeight: '700' }]}>Passage map</Text>
            <Text style={[txt.xs, { color: 'rgba(255,255,255,0.85)' }]}>Every passage, where it stands, and what's next</Text>
          </View>
          <Ico name="right" size={22} color={C.white} />
        </View>
      </Card>
      <CatalogRows ctx={ctx} from="language_home" level="lane" laneIds={[laneId]} laneId={laneId} />
      <MemberRows ctx={ctx} from="language_home" level="lane" laneId={laneId} />
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
  return (
    <Row leading={<Avatar id={e.profileId} />} label={ctx.name(e.profileId)} muted={!props.editable} last={props.last}
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
    try { setRequests(await pendingRequests(ctx.project.orgId)); } catch {
      // Offline: the list is a server read with no local mirror, so it stays
      // empty rather than claiming nobody asked.
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
  const group = (by: 'project' | 'lane', label: string) => {
    const groups = groupBelow(entries, by, v.projectId, level);
    const count = [...groups.values()].reduce((n, g) => n + g.length, 0);
    const d = ctx.details(`members:${level}:${by}`);
    return (
      <View style={{ gap: space.sm }}>
        <Row icon={by === 'project' ? 'folder' : 'globe'} label={label} sub={plural(count, 'member')} last
          onPress={d.onToggle} right={<Ico name={d.open ? 'up' : 'down'} size={22} color={C.primary} />} />
        {d.open ? [...groups].map(([key, list]) => (
          <View key={key} style={{ gap: space.xs }}>
            <Text style={[txt.label, { paddingHorizontal: space.xs }]}>
              {by === 'project' ? v.projectName(key) : v.laneLabel(key.split('/')[1] ?? key)} · {list.length}
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
          {level === 'org' ? group('project', 'By project') : null}
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

/** A list of choices on one card, the chosen one ticked. */
function Choices(props: { items: { id: string; label: string; sub?: string; badge?: string }[]; value: string; onChoose: (id: string) => void; empty?: string }) {
  if (props.items.length === 0) return <Text style={txt.smMuted}>{props.empty ?? 'Nothing to choose from.'}</Text>;
  return (
    <Group>
      {props.items.map((it, i) => (
        <Row key={it.id} label={it.label} sub={it.sub} badge={it.badge} onPress={() => props.onChoose(it.id)} last={i === props.items.length - 1}
          right={props.value === it.id ? <Ico name="check" size={22} color={C.primary} /> : <View style={{ width: 22 }} />} />
      ))}
    </Group>
  );
}

/** Role, assignment scope, and the project or language it applies to (ORG-6, ORG-7). */
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
  const projects = admin?.level === 'org' ? v.projects : [v.projectId];
  const lanes = admin?.level === 'lane' && admin.laneId ? [admin.laneId] : v.lanes;
  return (
    <>
      <SectionLabel label="Role" />
      <Choices items={props.roles.map((r) => ({ id: r.id, label: r.name, sub: r.sub }))} value={value.roleId}
        onChoose={(roleId) => props.onChange({ ...value, roleId })} empty="No roles available here." />
      <SectionLabel label="Assignment scope" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {props.levels.map((l) => (
          <Chip key={l} label={LEVEL_LABEL[l]} on={value.level === l} onPress={() => props.onChange({
            ...value, level: l,
            projectId: l === 'org' ? '' : value.projectId || (projects.length === 1 ? projects[0]! : v.projectId),
            laneId: l === 'lane' ? value.laneId || (lanes.length === 1 ? lanes[0]! : '') : ''
          })} />
        ))}
      </View>
      <Text style={txt.xs}>Where this person can use the selected role's privileges.</Text>
      {value.level === 'project' ? (
        <>
          <SectionLabel label="Project" />
          <Text style={txt.xs}>Which project this assignment applies to.</Text>
          <Choices items={projects.map((id) => ({ id, label: v.projectName(id) }))} value={value.projectId}
            onChoose={(projectId) => props.onChange({ ...value, projectId })} />
        </>
      ) : null}
      {value.level === 'lane' ? (
        <>
          <SectionLabel label="Language" />
          <Text style={txt.xs}>Which language this assignment applies to.</Text>
          <Choices items={lanes.map((id) => ({ id, label: v.laneLabel(id), sub: v.projectName(v.projectId) }))} value={value.laneId}
            onChoose={(laneId) => props.onChange({ ...value, laneId, projectId: v.projectId })} empty="No languages in this project yet." />
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
    projectId: floor && floor !== 'org' ? ctx.project.projectId : '',
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
      setError((e as Error).message);
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
          <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' }}>
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
  async function attempt(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await work(); ctx.back(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
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
      await ctx.act(change(next, 'do'), `${who} is now ${role}`, () => change(was, 'undo'));
      return;
    }
    const plan = changeMembership(entry, { roleId: form.roleId, scope });
    if (plan.apply.length === 0) return;
    await runOrg(plan.apply);
    ctx.toast(`${who} is now ${role}`, async () => { await runOrg(plan.undo); ctx.toast('Put back.'); });
  });
  const remove = () => attempt(async () => {
    if (!entry) return;
    const where = LEVEL_LABEL[entry.scope.level].toLowerCase();
    if (legacy) {
      const id = Crypto.randomUUID();
      await ctx.act([{ id: `${id}:0`, type: 'v1.MemberRemoved', payload: { profileId: memberId } }], `${who} removed from this project`,
        () => [{ id: `${id}:1`, type: 'v1.MemberRoleChanged', payload: { profileId: memberId, role: entry.legacyRole! } }]);
      return;
    }
    const plan = removeMembership(entry);
    await runOrg(plan.apply);
    ctx.toast(`${who} removed at ${where} level`, async () => { await runOrg(plan.undo); ctx.toast('Put back.'); });
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
          {pending ? <GhostBtn label="Decline" tone="red" onPress={() => void decline()} disabled={busy} />
            : <GhostBtn label={`Remove from ${LEVEL_LABEL[entry!.scope.level].toLowerCase()}`} tone="red" onPress={() => void remove()} disabled={busy} />}
        </>
      ) : undefined}>
      <Row leading={<Avatar id={memberId} size={48} />} label={who} sub={pending ? 'Asked to join' : v.target(entry!.scope)} />
      <Text style={txt.xs}>{pending
        ? 'This person created an account and asked to join. Assign a role to give them access; they join at organization scope, and you can narrow it here afterwards.'
        : legacy ? 'Added to this project before organization roles. Their role applies to this project.'
        : 'Pick a role, then choose the scope this assignment applies to. Scope can be this level or below.'}</Text>
      {allowed ? <AssignmentForm ctx={ctx} roles={roles} levels={levels} value={form} onChange={setForm} />
        : <Banner icon="lock" title="View only" body="Only people who can invite members change roles." />}
      {error ? <Banner icon="flag" tone="amber" title="Not saved" body={error} /> : null}
    </Screen>
  );
}

// ---- Invite by QR -------------------------------------------------------------------------------------

const QR_STEPS = ['Role', 'Name', 'QR code'];

export function InviteQr(ctx: Ctx) {
  const level = parseLevel(ctx.params['level'] ?? ctx.session.adminScope?.level);
  const floor = grantFloor(ctx.session.adminScope, level) ?? level;
  const scope = scopeAt(floor, ctx.project.projectId, floor === 'lane' ? laneParam(ctx) : undefined);
  const roles = liveRoles(ctx);
  // Started from a role ("Invite someone as …"), the role is already chosen: start at the name.
  const preferred = ctx.params['roleId'];
  const [step, setStep] = useState(preferred && roles.some((r) => r.id === preferred) ? 1 : 0);
  const [roleId, setRoleId] = useState(preferred ?? '');
  const [name, setName] = useState('');
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
      setInvite(await issueInvite(ctx.project.orgId, roleId, scope));
      setStep(2);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const params = { level, ...(ctx.params['laneId'] ? { laneId: ctx.params['laneId'] } : {}) };
  // The scanner shows who it is for, the role, the org and who invited them
  // before redeeming (AUTH-3). "From" is your name as others see it, never "You".
  const me = usePerson()(ctx.session.actorId);
  const myName = Object.values(ctx.org.state?.members[ctx.session.actorId] ?? {}).find((m) => m.displayName)?.displayName ?? me.name;
  const uri = invite ? inviteUri(ctx.project.orgId, invite.token, {
    name: name.trim(), role: role?.name, orgName: ctx.org.state?.org?.value.name, from: myName
  }) : '';
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
          <Text style={txt.xs}>A name so you can recognize them. If they already have an account, their name replaces this when they scan.</Text>
          <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Nyibol Deng" autoCapitalize="words" />
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
            <Text style={txt.xs}>Shown once: leaving this screen loses the code. It can be used once, until {new Date(invite.expiresAt).toDateString()}.</Text>
            <SmallBtn label="Share invite" icon="share" onPress={() => void Share.share({ message: uri })} />
          </Card>
        </>
      ) : null}
      {error ? <Banner icon="flag" tone="amber" title="No code was made" body={error} /> : null}
    </Screen>
  );
}

// ---- New project / language --------------------------------------------------------------------------

export function NewProject(ctx: Ctx) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function create() {
    const title = name.trim();
    if (!title || busy) return;
    setBusy(true);
    setError('');
    try {
      const projectId = `p-${Crypto.randomUUID()}`;
      await ctx.org.append('v1.ProjectRegistered', { projectId, name: title });
      ctx.toast(`${title} created — add its languages next`);
      // Nothing open yet (a new organization): open the project just made.
      const state = ctx.project.state;
      if (!state?.project && Object.keys(state?.lanes ?? {}).length === 0 && !ctx.org.state?.projects[ctx.project.projectId]) {
        await ctx.openOrganization(ctx.project.orgId, projectId);
        return;
      }
      ctx.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen header={<Header title="New Project" onBack={ctx.back} />}
      footer={<PrimaryBtn label="Create Project" disabled={!name.trim()} busy={busy} onPress={() => void create()} />}>
      <Text style={txt.xs}>A project groups languages that share templates, reference material, and review flows.</Text>
      <Field label="Project name" value={name} onChangeText={setName} placeholder="Enter project name" autoCapitalize="words" />
      {error ? <Banner icon="flag" tone="amber" title="Not created" body={error} /> : null}
    </Screen>
  );
}

export function NewLanguage(ctx: Ctx) {
  const state = ctx.project.state;
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [scope, setScope] = useState<LanguageScope>('nt');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const templateId = useMemo(() => suggestedTemplate(state, ctx.org.state, ctx.project.projectId), [state, ctx.org.state, ctx.project.projectId]);
  const template = contentTemplate(templateId);
  const project = ctx.org.state?.projects[ctx.project.projectId]?.name ?? state?.project?.value.name ?? 'the project';
  async function create() {
    const title = name.trim();
    if (!title || busy) return;
    setBusy(true);
    setError('');
    try {
      const languoid = code.trim() || title.slice(0, 3);
      const commandId = Crypto.randomUUID();
      const specs = addLanguage(state, { commandId, laneId: newLaneId(languoid, commandId), code: languoid, name: title, templateId, scope });
      await ctx.act(specs, `${title} added to ${project} · uses ${template?.name ?? templateId}`);
      ctx.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen header={<Header title="New Language" onBack={ctx.back} />}
      footer={<PrimaryBtn label="Create Language" disabled={!name.trim() || !state} busy={busy} onPress={() => void create()} />}>
      <Text style={txt.xs}>This language is added to the current project. You can invite language admins from Members after it is created.</Text>
      <Field label="Language name" value={name} onChangeText={setName} placeholder="Enter language name" autoCapitalize="words" />
      <Field label="Language code" value={code} onChangeText={setCode} placeholder="e.g. DIN" autoCapitalize="none" />
      <SectionLabel label="Scope" />
      <Choices items={LANGUAGE_SCOPES.map((s) => ({ id: s.id, label: s.label, sub: s.sub }))} value={scope} onChoose={(id) => setScope(id as LanguageScope)} />
      <Text style={txt.xs}>Its passages come from {template?.name ?? 'the suggested template'}, the one this project suggests. It can be changed later under Content Templates.</Text>
      {error ? <Banner icon="flag" tone="amber" title="Not created" body={error} /> : null}
    </Screen>
  );
}

// ---- Review Teams (FLOW-5) --------------------------------------------------------------------------------

export function ReviewTeams(ctx: Ctx) {
  const state = ctx.project.state;
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
          <Card key={teamId} accessibilityLabel={t.name.value}
            onPress={canManage ? () => ctx.go('review_team_editor', { laneId, teamId }) : undefined}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
              <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' }}>
                <Ico name="people" size={22} color={C.primary} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[txt.body, { fontWeight: '600' }]}>{t.name.value || 'Review team'}</Text>
                <Text style={txt.xs}>{plural(people.length, 'member')}</Text>
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
      const plan = saveTeam(state, { commandId: Crypto.randomUUID(), teamId, laneId, name: title, members: chosen });
      await ctx.act(plan.specs, `${title} saved · ${plural(chosen.length, 'person', 'people')}`, plan.undo ?? undefined);
      ctx.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen header={<Header title={name.trim() || (team ? team.name.value : 'New Review Team')} sub={team ? 'Review team' : 'New review team'} onBack={ctx.back} />}
      footer={<PrimaryBtn label="Save Team" disabled={!name.trim() || !ctx.session.can('manage_teams')} busy={busy} onPress={() => void save()} />}>
      <Field label="Team name" value={name} onChangeText={setName} placeholder="Team name" autoCapitalize="words" />
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

export const contracts = contractsFor('org_home', 'project_home', 'language_home', 'members_list', 'invite_member', 'invite_qr',
  'edit_member', 'new_project', 'new_language', 'review_teams', 'review_team_editor');
