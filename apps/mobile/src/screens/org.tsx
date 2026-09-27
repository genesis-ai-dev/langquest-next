// Avatar P. Org, project, and language homes; members; invites; review teams.
import type { LanguageProgress, OrgState, Privilege, ProjectState, Role, Scope, ScopeLevel } from '@langquest-next/core';
import {
  CATALOG_VERSION, contentTemplates, deriveWorkflow, FLOW_TEMPLATES, READY_FLOWS,
  instantiateFlow, instantiateTemplate, keyTermsFor, languageProgress, materialsFor, membershipsOf, privilegesFor,
  privilegesOfFixedRole, scopeKey
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { BookOpen, Building2, Check, ChevronRight, Clock, FileText, FolderOpen, Globe, ListChecks, Lock, Map as MapIcon, Plus, QrCode, Users, Workflow, X, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, Share, Text, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { decideRequest, inviteUri, issueInvite, pendingRequests, type NewInvite, type PendingRequest } from '../invites';
import type { Ctx } from '../ctx';
import { indexesFor } from '../indexes';
import { Footer, Header, Note, Row, Screen, Section } from '../pui';
import { colors, radius, space, tint } from '../theme';
import { Card, text } from '../ui';
import { translateUi } from '../uiLanguage';
import { supabase } from '../supabase';
import { usePerson } from '../UserChip';
import { partitionClient } from '../useOrg';
import { privilegeLabel } from './config';

const ROLES: Role[] = ['owner', 'coordinator', 'translator', 'reviewer', 'viewer'];
const LEVEL_LABEL: Record<ScopeLevel, string> = { org: 'Organization', project: 'Project', lane: 'Language' };
const RANK: Record<ScopeLevel, number> = { org: 0, project: 1, lane: 2 };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---- derived counts (ADR-004: several counts, never one percent) ----------

export type LaneCounts = LanguageProgress;

/** Core languageProgress (record.ts) with this device's cached indexes. */
export function laneCounts(state: ProjectState, laneId: string): LaneCounts {
  return languageProgress(state, laneId, indexesFor(state));
}

function sumCounts(all: LaneCounts[]): LaneCounts {
  return all.reduce((a, c) => ({ ...a, total: a.total + c.total, recorded: a.recorded + c.recorded, done: a.done + c.done, waiting: a.waiting + c.waiting }),
    { laneId: '', total: 0, recorded: 0, done: 0, waiting: 0, steps: [] } as LaneCounts);
}

export function progressLine(c: LaneCounts): string {
  return c.total === 0 ? 'No passages yet' : `${c.recorded} of ${c.total} recorded · ${c.done} done`;
}

export function flowName(state: ProjectState | null, laneId: string): string {
  const flowId = state?.laneFlows[laneId]?.value.flowId;
  const named = READY_FLOWS.find((f) => f.id === flowId)?.name ?? FLOW_TEMPLATES.find((f) => f.id === flowId)?.name;
  if (named) return named;
  const steps = state ? deriveWorkflow(state, laneId).length : 0;
  return steps ? plural(steps, 'review step') : 'No review flow';
}

/** One bar per count: recorded, each step of the flow, done. Words carry the meaning; colour only shades. */
export function CountBars(props: { counts: LaneCounts; summary?: boolean }) {
  const c = props.counts;
  const rows = [
    { label: 'Recorded', n: c.recorded, color: colors.translate },
    ...(props.summary ? [] : c.steps.map((s) => ({ label: s.label, n: s.cleared, color: colors.review }))),
    ...(props.summary || c.steps.length ? [{ label: 'Done', n: c.done, color: colors.done }] : [])
  ];
  return (
    <View style={{ gap: space.sm }}>
      {rows.map((r, i) => (
        <View key={i} accessible accessibilityLabel={`${r.label}: ${r.n} of ${c.total}`} style={{ gap: 3 }}>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Text style={[text.small, { flex: 1, color: colors.foreground }]} numberOfLines={1}>{r.label}</Text>
            <Text style={text.small}>{r.n} of {c.total}</Text>
          </View>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.muted, overflow: 'hidden' }}>
            <View style={{ height: 6, borderRadius: 3, width: `${c.total ? Math.round((100 * r.n) / c.total) : 0}%`, backgroundColor: r.color }} />
          </View>
        </View>
      ))}
    </View>
  );
}

// ---- scope helpers ----------------------------------------------------------

function orgName(ctx: Ctx): string {
  return ctx.org.state?.org?.value.name ?? 'Organization';
}

function projectName(ctx: Ctx, projectId?: string): string {
  const id = projectId ?? ctx.project.projectId;
  return ctx.org.state?.projects[id]?.name
    ?? (id === ctx.project.projectId ? ctx.project.state?.project?.value.name : undefined) ?? 'Project';
}

/** "Luke", "din · Luke", or the org's name. Lanes of projects that are not open show their id. */
export function scopeLabel(ctx: Ctx, scope: Scope): string {
  if (scope.level === 'org') return orgName(ctx);
  const project = projectName(ctx, scope.projectId);
  if (scope.level === 'project') return project;
  const lang = scope.projectId === ctx.project.projectId ? ctx.project.state?.lanes[scope.laneId ?? '']?.languoidId : undefined;
  return `${lang ?? scope.laneId ?? 'Language'} · ${project}`;
}

/**
 * Held through an organization-level membership (or the legacy project
 * owner). The invite and join-request RPCs check invite_members at the org
 * level only, so a narrower admin would be refused.
 */
function canAtOrg(ctx: Ctx, p: Privilege): boolean {
  const org = ctx.org.state;
  const viaOrg = !!org && membershipsOf(org, ctx.session.actorId).some((m) => {
    const role = org.roles[m.roleId.value];
    return m.scope.level === 'org' && !!role && !role.retired && (role.privileges.value ?? []).includes(p);
  });
  return viaOrg || (ctx.session.role === 'owner' && ctx.session.can(p));
}

/** Levels an admin may grant: their own admin level and below (reference assignableScopes). */
function grantableLevels(ctx: Ctx): ScopeLevel[] {
  const floor = RANK[ctx.session.adminScope?.level ?? 'lane'];
  return (['org', 'project', 'lane'] as ScopeLevel[]).filter((l) => RANK[l] >= floor);
}

function activeRoles(org: OrgState | null) {
  return Object.entries(org?.roles ?? {}).filter(([, r]) => !r.retired);
}

function roleSummary(privileges: readonly Privilege[]): string {
  if (privileges.length === 0) return 'No privileges yet';
  const names = privileges.map(privilegeLabel);
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ');
}

function rowsWithLast<T>(items: T[], render: (item: T, last: boolean) => ReactNode) {
  return items.map((item, i) => render(item, i === items.length - 1));
}

/**
 * One setup folder (PLAN.md section 16). Its colour is the colour its
 * contents have for the translator; the summary says what is filled in.
 */
function SetupFolder(props: { icon: LucideIcon; hue: string; tint: string; title: string; summary: string; onPress?: () => void }) {
  const Icon = props.icon;
  const face = { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 };
  return (
    <Pressable onPress={props.onPress} disabled={!props.onPress} accessibilityRole="button"
      accessibilityLabel={`${translateUi(props.title)}: ${props.summary}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1, paddingTop: 13 })}>
      <View style={[face, { position: 'absolute', top: 0, left: 0, width: '42%', height: 16,
        borderBottomWidth: 0, borderTopLeftRadius: 10, borderTopRightRadius: 10 }]}>
        <View style={{ flex: 1, backgroundColor: props.tint, borderTopLeftRadius: 10, borderTopRightRadius: 10 }} />
      </View>
      <View style={[face, { borderRadius: radius.lg, borderTopLeftRadius: 0 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg,
          minHeight: 72, backgroundColor: props.tint, borderRadius: radius.lg, borderTopLeftRadius: 0 }}>
          <Icon size={26} color={props.hue} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[text.body, { fontWeight: '700' }]}>{translateUi(props.title)}</Text>
            <Text style={text.small} numberOfLines={2}>{props.summary}</Text>
          </View>
          {props.onPress ? <ChevronRight size={20} color={colors.mutedForeground} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

/** Folder summaries for one language, from the fold. */
function setupSummary(state: ProjectState | null, laneId: string) {
  const templateId = state?.laneTemplates[laneId]?.value.templateId;
  const terms = state ? keyTermsFor(state, laneId).length : 0;
  const materials = state ? materialsFor(state, { laneId }).length : 0;
  return {
    translate: contentTemplates().find((t) => t.id === templateId)?.name ?? 'Not chosen yet',
    study: `${plural(terms, 'key term')} · ${plural(materials, 'material')}`,
    checks: flowName(state, laneId)
  };
}

/** Manage Content and Manage Processes rows on the org and project homes, each hidden without its privilege. */
function CatalogRows(props: { ctx: Ctx; level: 'org' | 'project' }) {
  const { ctx, level } = props;
  const state = ctx.project.state;
  const laneIds = Object.keys(state?.lanes ?? {});
  const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const templates = uniq(laneIds.map((l) => state?.laneTemplates[l]?.value.templateId))
    .map((id) => contentTemplates().find((t) => t.id === id)?.name ?? id);
  const flows = uniq(laneIds.map((l) => flowName(state, l)));
  const materials = state ? materialsFor(state, {}).filter((m) => m.kind !== 'fia_progress') : [];
  const study = materials.filter((m) => m.kind === 'fia_study').length;
  const questions = materials.filter((m) => m.kind === 'questions').length;
  const terms = state ? laneIds.reduce((n, l) => n + keyTermsFor(state, l).length, 0) : 0;
  const content = [
    ctx.session.can('manage_templates') ? { key: 't', icon: FileText, label: 'Content templates',
      sub: `${templates.join(', ') || 'None in use'} · ${plural(laneIds.length, 'language')}`, to: 'templates_home' as const } : null,
    ctx.session.can('manage_reference') ? { key: 'r', icon: BookOpen, label: 'Reference material',
      sub: `${study} study · ${plural(questions, 'question set')} · ${plural(terms, 'key term')}`, to: 'reference_home' as const } : null
  ].filter((x) => !!x);
  return (
    <>
      {content.length ? (
        <Section label="Manage content">
          {rowsWithLast(content, (r, last) => <Row key={r.key} icon={r.icon} label={r.label} sub={r.sub} onPress={() => ctx.go(r.to, { level })} last={last} />)}
        </Section>
      ) : null}
      {ctx.session.can('manage_flows') ? (
        <Section label="Manage processes">
          <Row icon={Workflow} label="Review flows" sub={flows.join(', ') || 'None in use'} onPress={() => ctx.go('flows_home', { level })} last />
        </Section>
      ) : null}
    </>
  );
}

function MemberRows(props: { ctx: Ctx; membersSub: string; params: Record<string, string> }) {
  const { ctx } = props;
  const roles = activeRoles(ctx.org.state).length;
  return (
    <Section label="Manage members">
      <Row icon={ListChecks} label="Roles" sub={plural(roles, 'role')} onPress={() => ctx.go('roles_home')} />
      <Row icon={Users} label="Members" sub={props.membersSub} onPress={() => ctx.go('members_list', props.params)} last />
    </Section>
  );
}

/** Distinct people with an active membership, optionally only those whose scope passes `keep`. */
function countPeople(org: OrgState | null, keep: (s: Scope) => boolean = () => true): number {
  return Object.values(org?.members ?? {}).filter((scopes) =>
    Object.values(scopes).some((m) => m.removed.value === false && keep(m.scope))).length;
}

// ---- homes ------------------------------------------------------------------

export function OrgHome(ctx: Ctx) {
  const { state } = ctx.project;
  const org = ctx.org.state;
  const projects = Object.entries(org?.projects ?? {});
  // Older orgs registered no project; the open one still belongs here.
  if (!projects.length && state?.project) projects.push([ctx.project.projectId, { name: state.project.value.name }]);
  const counts = useMemo(() => state ? sumCounts(Object.keys(state.lanes).map((l) => laneCounts(state, l))) : null, [state]);
  const canStructure = canAtOrg(ctx, 'manage_structure');
  const total = countPeople(org);
  return (
    <Screen>
      <Header title={orgName(ctx)} sub={`${plural(projects.length, 'project')} · ${plural(total, 'member')}`} />
      <Section label="Manage projects">
        {projects.length === 0
          ? <Row icon={Building2} label="No projects yet" sub="A project holds the languages you translate into — add one to start." last={!canStructure} /> : null}
        {rowsWithLast(projects, ([id, p], last) => (
          <Row key={id} icon={FolderOpen} label={p.name}
            // Only the open project is folded on this device; others need opening.
            sub={id === ctx.project.projectId && counts ? progressLine(counts) : 'Open to see progress'}
            onPress={() => {
              if (id === ctx.project.projectId) ctx.go('project_home');
              else void ctx.openOrganization(ctx.project.orgId, id, 'project_home');
            }} last={last && !canStructure} />
        ))}
        {canStructure ? <Row icon={Plus} label="New project" onPress={() => ctx.go('new_project')} last /> : null}
      </Section>
      <CatalogRows ctx={ctx} level="org" />
      <MemberRows ctx={ctx} params={{ level: 'org' }}
        membersSub={`${countPeople(org, (s) => s.level === 'org')} at organization level · ${total} total`} />
    </Screen>
  );
}

export function ProjectHome(ctx: Ctx) {
  const { state } = ctx.project;
  const lanes = state ? Object.entries(state.lanes) : [];
  const name = projectName(ctx);
  const perLane = useMemo(() => new Map(state ? Object.keys(state.lanes).map((l) => [l, laneCounts(state, l)] as const) : []), [state]);
  const counts = sumCounts([...perLane.values()]);
  const orgAdmin = ctx.session.adminScope?.level === 'org';
  const canStructure = ctx.session.can('manage_structure');
  const here = countPeople(ctx.org.state, (s) => s.level !== 'org' && s.projectId === ctx.project.projectId);
  return (
    <Screen>
      <Header title={name} sub={plural(lanes.length, 'language')}
        crumbs={[{ label: orgName(ctx), ...(orgAdmin ? { onPress: () => ctx.go('org_home') } : {}) }, { label: name }]} />
      {counts.total ? <Card><CountBars counts={counts} summary /></Card> : null}
      <Section label="Manage languages">
        {lanes.length === 0 ? <Row icon={Globe} label="No languages in this project yet." last={!canStructure} /> : null}
        {rowsWithLast(lanes, ([laneId, l], last) => {
          const c = perLane.get(laneId);
          return <Row key={laneId} icon={Globe} label={l.languoidId}
            sub={`${flowName(state, laneId)} · ${c ? progressLine(c) : 'No passages yet'}`}
            onPress={() => ctx.go('language_home', { laneId })} last={last && !canStructure} />;
        })}
        {canStructure ? <Row icon={Plus} label="New language" onPress={() => ctx.go('new_language')} last /> : null}
      </Section>
      <CatalogRows ctx={ctx} level="project" />
      <MemberRows ctx={ctx} params={{ level: 'project' }} membersSub={`${here} assigned in this project`} />
    </Screen>
  );
}

export function LanguageHome(ctx: Ctx) {
  const { state } = ctx.project;
  const laneId = ctx.params['laneId'] ?? Object.keys(state?.lanes ?? {})[0] ?? '';
  const name = projectName(ctx);
  const lang = state?.lanes[laneId]?.languoidId ?? laneId;
  const summary = setupSummary(state, laneId);
  const counts = useMemo(() => state && laneId ? laneCounts(state, laneId) : null, [state, laneId]);
  const level = ctx.session.adminScope?.level;
  const can = (p: 'manage_templates' | 'manage_reference' | 'manage_flows') => ctx.session.can(p) && !!laneId;
  const here = countPeople(ctx.org.state, (s) => s.level === 'lane' && s.laneId === laneId && s.projectId === ctx.project.projectId);
  return (
    <Screen>
      <Header title={lang} sub={`Review flow: ${summary.checks}`} crumbs={[
        { label: orgName(ctx), ...(level === 'org' ? { onPress: () => ctx.go('org_home') } : {}) },
        { label: name, ...(level === 'org' || level === 'project' ? { onPress: () => ctx.go('project_home') } : {}) },
        { label: lang }]} />
      {counts ? <Card><CountBars counts={counts} /></Card> : null}
      <Section label="Passages">
        <Row icon={MapIcon} label="Passage map" sub="Every passage, where it stands, and what's next" onPress={() => ctx.go('map_home', { laneId })} last />
      </Section>
      <View style={{ gap: space.md }}>
        <SetupFolder icon={BookOpen} hue={colors.translate} tint={tint.translate} title="What to translate"
          summary={summary.translate} onPress={can('manage_templates') ? () => ctx.go('templates_home', { laneId }) : undefined} />
        <SetupFolder icon={FolderOpen} hue={colors.reference} tint={tint.reference} title="What to study"
          summary={summary.study} onPress={can('manage_reference') ? () => ctx.go('reference_home', { laneId }) : undefined} />
        <SetupFolder icon={ListChecks} hue={colors.review} tint={tint.review} title="How it's checked"
          summary={summary.checks} onPress={can('manage_flows') ? () => ctx.go('flows_home', { laneId }) : undefined} />
      </View>
      <Section label="Manage processes">
        <Row icon={Users} label="Review teams" sub="Language reviewers grouped into teams" onPress={() => ctx.go('review_teams', { laneId })} last />
      </Section>
      <MemberRows ctx={ctx} params={{ level: 'lane', laneId }} membersSub={`${here} assigned at this language`} />
    </Screen>
  );
}

// ---- members ----------------------------------------------------------------

interface MemberEntry { profileId: string; key: string; scope: Scope; roleId: string }

function orgEntries(org: OrgState | null): MemberEntry[] {
  const out: MemberEntry[] = [];
  for (const [profileId, scopes] of Object.entries(org?.members ?? {})) {
    for (const [key, m] of Object.entries(scopes)) {
      if (m.removed.value === false) out.push({ profileId, key, scope: m.scope, roleId: m.roleId.value });
    }
  }
  return out;
}

export function MembersList(ctx: Ctx) {
  const org = ctx.org.state;
  const orgId = ctx.project.orgId;
  const projectId = ctx.project.projectId;
  const level = (ctx.params['level'] as ScopeLevel | undefined) ?? ctx.session.adminScope?.level ?? 'org';
  const laneId = ctx.params['laneId'];
  const inviter = canAtOrg(ctx, 'invite_members');
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!inviter) return;
    try {
      setRequests(await pendingRequests(orgId));
    } catch {
      // Offline: the list is a server read with no local mirror, so it stays
      // empty rather than claiming nobody asked.
    }
  }, [inviter, orgId]);
  useEffect(() => void refresh(), [refresh]);

  async function decline(id: string) {
    setError('');
    try {
      await decideRequest(id, false);
      await refresh();
      await ctx.org.sync();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const entries = orgEntries(org);
  const inView = (s: Scope) => level === 'org' || (s.projectId === projectId && (level === 'project' || s.laneId === laneId));
  const atLevel = entries.filter((e) => e.scope.level === level && inView(e.scope));
  const below = entries.filter((e) => RANK[e.scope.level] > RANK[level] && inView(e.scope));
  const above = entries.filter((e) => RANK[e.scope.level] < RANK[level] && (e.scope.level === 'org' || e.scope.projectId === projectId));
  // Legacy v1.MemberAdded rows in the project log with no org membership (PLAN 16.1 rule 5).
  const raw = ctx.project.state?.members ?? {};
  const legacy = Object.entries(raw).filter(([id, m]) => !m.removed.value && !org?.members[id]);
  const openInvites = Object.entries(org?.invites ?? {}).filter(([, i]) => !i.redeemedBy && Date.parse(i.expiresAt) > Date.now());
  const roleName = (id: string) => org?.roles[id]?.name.value ?? id;
  const member = (e: MemberEntry, last: boolean, editable: boolean) => (
    <Row key={`${e.profileId}:${e.key}`} personId={e.profileId} label={e.profileId === ctx.session.actorId ? 'You' : undefined}
      sub={scopeLabel(ctx, e.scope)} badge={roleName(e.roleId)}
      right={editable ? undefined : <Lock size={16} color={colors.mutedForeground} accessibilityLabel="View only" />}
      onPress={editable ? () => ctx.go('edit_member', { memberId: e.profileId, scopeKey: e.key }) : undefined} last={last} />
  );

  return (
    <Screen footer={inviter ? <Footer label="Invite" onPress={() => ctx.go('invite_member', { level, ...(laneId ? { laneId } : {}) })} /> : undefined}>
      <Header title="Members" sub={`${LEVEL_LABEL[level]} · ${level === 'org' ? orgName(ctx) : scopeLabel(ctx, { level, projectId, ...(laneId ? { laneId } : {}) })}`} onBack={ctx.back} />
      {requests.length > 0 ? (
        <Section label={`Asking to join · ${requests.length}`}>
          {rowsWithLast(requests, (r, last) => (
            <Row key={r.id} personId={r.profileId} sub={r.message || 'No message'} last={last}
              right={
                <View style={{ flexDirection: 'row', gap: space.md }}>
                  <Pressable onPress={() => ctx.go('edit_member', { memberId: r.profileId, requestId: r.id })} hitSlop={8} accessibilityLabel="Assign role and accept">
                    <Check size={20} color={colors.translate} />
                  </Pressable>
                  <Pressable onPress={() => void decline(r.id)} hitSlop={8} accessibilityLabel="Decline">
                    <X size={20} color={colors.mutedForeground} />
                  </Pressable>
                </View>
              } />
          ))}
        </Section>
      ) : null}
      {error ? <Note>{error}</Note> : null}
      <Section label={`${LEVEL_LABEL[level]} members · ${atLevel.length}`}>
        {atLevel.length === 0 ? <Row label="No members assigned at this level yet." last /> : null}
        {rowsWithLast(atLevel, (e, last) => member(e, last, inviter))}
      </Section>
      {below.length ? (
        <Section label={`${level === 'org' ? 'By project and language' : 'By language'} · ${below.length}`}>
          {rowsWithLast(below, (e, last) => member(e, last, inviter))}
        </Section>
      ) : null}
      {above.length ? (
        <Section label={`Higher levels · view only · ${above.length}`}>
          {rowsWithLast(above, (e, last) => member(e, last, false))}
        </Section>
      ) : null}
      {openInvites.length ? (
        <Section label={`Invited · not yet joined · ${openInvites.length}`}>
          {rowsWithLast(openInvites, ([id, i], last) => (
            <Row key={id} icon={QrCode} label={roleName(i.roleId)} sub={`${scopeLabel(ctx, i.scope)} · expires ${new Date(i.expiresAt).toDateString()}`} last={last} />
          ))}
        </Section>
      ) : null}
      {legacy.length ? (
        <Section label={`Project log members · ${legacy.length}`}>
          {rowsWithLast(legacy, ([id, m], last) => (
            <Row key={id} personId={id} label={id === ctx.session.actorId ? 'You' : undefined} sub={projectName(ctx)} badge={m.role.value}
              onPress={ctx.session.can('invite_members') ? () => ctx.go('edit_member', { memberId: id }) : undefined} last={last} />
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}

/** Role cards with their privileges spelled out; the choice is marked with a check, not colour alone. */
function RolePicker(props: { ctx: Ctx; roleId: string; onPick: (id: string) => void; disabled?: boolean }) {
  const roles = activeRoles(props.ctx.org.state);
  return (
    <Section label="Role">
      {roles.length === 0 ? <Row label="No roles yet" last /> : null}
      {rowsWithLast(roles, ([id, r], last) => (
        <Row key={id} label={r.name.value || id} sub={roleSummary(r.privileges.value ?? [])}
          onPress={props.disabled ? undefined : () => props.onPick(id)}
          right={props.roleId === id ? <Check size={18} color={colors.translate} accessibilityLabel="Selected" /> : <View />} last={last} />
      ))}
    </Section>
  );
}

function defaultScope(ctx: Ctx, level: ScopeLevel, laneId?: string): Scope {
  const projectId = ctx.project.projectId;
  if (level === 'org') return { level: 'org' };
  if (level === 'project') return { level: 'project', projectId };
  return { level: 'lane', projectId, laneId: laneId ?? Object.keys(ctx.project.state?.lanes ?? {})[0] ?? '' };
}

function scopeFromParams(ctx: Ctx): Scope {
  const level = (ctx.params['scopeLevel'] as ScopeLevel | undefined) ?? 'org';
  if (level === 'org') return { level };
  return { level, projectId: ctx.params['projectId'] ?? ctx.project.projectId, ...(level === 'lane' ? { laneId: ctx.params['scopeLaneId'] ?? '' } : {}) };
}

function scopeParams(s: Scope): Record<string, string> {
  return { scopeLevel: s.level, ...(s.projectId ? { projectId: s.projectId } : {}), ...(s.laneId ? { scopeLaneId: s.laneId } : {}) };
}

/**
 * Organization, project, or language. Languages are listed for the open
 * project only: other projects are not folded on this device.
 */
function ScopePicker(props: { ctx: Ctx; scope: Scope; onChange: (s: Scope) => void }) {
  const { ctx, scope, onChange } = props;
  const levels = grantableLevels(ctx);
  const projects = Object.entries(ctx.org.state?.projects ?? {});
  if (!projects.length && ctx.project.state?.project) projects.push([ctx.project.projectId, { name: ctx.project.state.project.value.name }]);
  const lanes = Object.entries(ctx.project.state?.lanes ?? {});
  const tick = (on: boolean) => on ? <Check size={18} color={colors.translate} accessibilityLabel="Selected" /> : <View />;
  return (
    <>
      <Section label="Assignment scope">
        {rowsWithLast(levels, (l, last) => (
          <Row key={l} label={LEVEL_LABEL[l]} onPress={() => onChange(defaultScope(ctx, l))} right={tick(scope.level === l)} last={last} />
        ))}
      </Section>
      <Note>Where this person can use the selected role's privileges. Scope can be this level or below.</Note>
      {scope.level === 'project' ? (
        <Section label="Project">
          {rowsWithLast(projects, ([id, p], last) => (
            <Row key={id} icon={FolderOpen} label={p.name} onPress={() => onChange({ level: 'project', projectId: id })} right={tick(scope.projectId === id)} last={last} />
          ))}
        </Section>
      ) : null}
      {scope.level === 'lane' ? (
        <Section label={`Language · ${projectName(ctx)}`}>
          {lanes.length === 0 ? <Row label="No languages in this project yet." last /> : null}
          {rowsWithLast(lanes, ([id, l], last) => (
            <Row key={id} icon={Globe} label={l.languoidId} onPress={() => onChange({ level: 'lane', projectId: ctx.project.projectId, laneId: id })} right={tick(scope.laneId === id)} last={last} />
          ))}
        </Section>
      ) : null}
    </>
  );
}

async function sendInviteEmail(invite: NewInvite, email: string) {
  const { error } = await supabase.functions.invoke('send-invite', {
    body: { inviteId: invite.inviteId, token: invite.token, email }
  });
  if (error) {
    const details = error.context instanceof Response ? await error.context.json() : null;
    throw new Error(details?.error ?? error.message);
  }
}

export function InviteMember(ctx: Ctx) {
  const orgId = ctx.project.orgId;
  const roles = activeRoles(ctx.org.state);
  const [roleId, setRoleId] = useState(roles[0]?.[0] ?? '');
  const level = (ctx.params['level'] as ScopeLevel | undefined) ?? 'org';
  const [scope, setScope] = useState<Scope>(() => defaultScope(ctx, grantableLevels(ctx).includes(level) ? level : 'org', ctx.params['laneId']));
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const complete = !!roleId && (scope.level !== 'lane' || !!scope.laneId);
  async function send() {
    if (busy || !complete) return;
    setBusy(true);
    setError('');
    try {
      const invite = await issueInvite(orgId, roleId, scope);
      await sendInviteEmail(invite, email.trim());
      ctx.toast(`Invite sent to ${email.trim()}`);
      ctx.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen footer={<Footer label={busy ? 'Sending…' : 'Send invite'} onPress={() => void send()} disabled={busy || !complete || !email.includes('@')} />}>
      <Header title="Invite member" onBack={ctx.back} />
      <Note>Pick a role, then choose the scope this assignment applies to. Scope can be this level or below.</Note>
      <Section label="No email?">
        <Row icon={QrCode} label="Invite by QR code" sub="For people without email — they scan to join"
          onPress={() => ctx.go('invite_qr', { roleId, ...scopeParams(scope) })} last />
      </Section>
      <TextInput accessibilityLabel="Email address" placeholder="name@example.com" value={email} onChangeText={setEmail}
        autoCapitalize="none" keyboardType="email-address" editable={!busy} style={styles.input} />
      <RolePicker ctx={ctx} roleId={roleId} onPick={setRoleId} />
      <ScopePicker ctx={ctx} scope={scope} onChange={setScope} />
      {error ? <Note>{error}</Note> : null}
    </Screen>
  );
}

/** Role, then one redeemable QR. The reference's name step waits for a fact that stores it (Phase 2). */
export function InviteQr(ctx: Ctx) {
  const orgId = ctx.project.orgId;
  const roles = activeRoles(ctx.org.state);
  const scope = scopeFromParams(ctx);
  const [roleId, setRoleId] = useState(ctx.params['roleId'] ?? roles[0]?.[0] ?? '');
  const roleName = roles.find(([id]) => id === roleId)?.[1].name.value;
  const [step, setStep] = useState(0);
  const [invite, setInvite] = useState<NewInvite | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  async function sendEmail() {
    if (!invite) return;
    setBusy(true);
    setError('');
    try {
      await sendInviteEmail(invite, email.trim());
      setEmailSent(true);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function generate() {
    setBusy(true);
    setError('');
    try {
      setInvite(await issueInvite(orgId, roleId, scope));
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const footer = step === 0
    ? <Footer label="Next" onPress={() => setStep(1)} disabled={!roleName} />
    : invite ? <Footer label="Done" onPress={() => ctx.go('members_list')} />
      : <Footer label={busy ? 'Creating…' : 'Create invite'} onPress={() => void generate()} disabled={busy || !roleName} />;
  return (
    <Screen footer={footer}>
      <Header title="Invite by QR" sub={`Step ${step + 1} of 2 — ${step === 0 ? 'Role' : 'QR code'}`}
        onBack={step > 0 && !invite ? () => setStep(0) : ctx.back} />
      {step === 0 ? (
        <>
          <Note>Pick the role this person should have. You don't need their email.</Note>
          <RolePicker ctx={ctx} roleId={roleId} onPick={setRoleId} />
          {ctx.session.can('manage_roles') ? (
            <Section label="Missing a role?">
              <Row icon={Plus} label="Create a new role" onPress={() => ctx.go('role_editor', { roleId: 'new' })} last />
            </Section>
          ) : null}
        </>
      ) : invite ? (
        <>
          <View style={{ alignItems: 'center', paddingVertical: space.xl }}>
            <QRCode value={inviteUri(orgId, invite.token)} size={200} backgroundColor="white" />
          </View>
          <Text style={[text.h4, { textAlign: 'center' }]}>{roleName} · {scopeLabel(ctx, scope)}</Text>
          <Note>Hold this up for them to scan. Tap Done when it has been scanned.</Note>
          <Card>
            <Text style={text.small}>Or type this code</Text>
            <Text selectable style={[text.body, { fontFamily: 'Courier' }]}>{invite.token}</Text>
          </Card>
          <Note>Shown once. Leaving this screen loses the code, and you make a new invite instead. It expires {new Date(invite.expiresAt).toDateString()}.</Note>
          <TextInput accessibilityLabel="Invitation email" placeholder="Email address (optional)"
            value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
            editable={!emailSent && !busy} style={styles.input} />
          <Row label={emailSent ? 'Email sent' : busy ? 'Sending…' : 'Send invite by email'}
            onPress={!busy && !emailSent && email.includes('@') ? () => void sendEmail() : undefined} />
          <Row label="Share invite" onPress={() => void Share.share({ message: inviteUri(orgId, invite.token) })} last />
        </>
      ) : (
        <>
          <View style={{ alignItems: 'center', paddingVertical: space.xl }}>
            <QrCode size={160} color={colors.mutedForeground} />
          </View>
          <Note>{`They join as ${roleName ?? 'the chosen role'} at ${LEVEL_LABEL[scope.level].toLowerCase()} level (${scopeLabel(ctx, scope)}). This invite can be used once.`}</Note>
        </>
      )}
      {error ? <Note>{error}</Note> : null}
    </Screen>
  );
}

/**
 * Change a member's role or scope, or give a join request its role. A scope
 * change is the new membership added, then the old one removed. Accepting a
 * request grants organization scope: decide_join_request takes no scope.
 */
export function EditMember(ctx: Ctx) {
  const memberId = ctx.params['memberId'] ?? '';
  const requestId = ctx.params['requestId'];
  const person = usePerson()(memberId).name;
  const memberships = Object.entries(ctx.org.state?.members[memberId] ?? {}).filter(([, m]) => !m.removed.value);
  const [key, setKey] = useState(ctx.params['scopeKey'] ?? memberships[0]?.[0] ?? '');
  const membership = memberships.find(([k]) => k === key)?.[1];
  const legacyRole = ctx.project.state?.members[memberId]?.role.value ?? 'viewer';
  const [roleId, setRoleId] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);
  const role = roleId ?? membership?.roleId.value ?? (requestId ? activeRoles(ctx.org.state)[0]?.[0] ?? '' : legacyRole);
  const target = scope ?? membership?.scope ?? { level: 'org' as const };
  const roleName = ctx.org.state?.roles[role]?.name.value ?? role;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const allowed = requestId ? canAtOrg(ctx, 'invite_members') : ctx.session.can('invite_members');
  const legacy = !membership && !requestId;

  async function save(remove: boolean) {
    if (!allowed || busy) return;
    setBusy(true);
    setError('');
    try {
      if (requestId) {
        await decideRequest(requestId, true, role);
        await ctx.org.sync();
      } else if (membership) {
        if (remove) await ctx.org.append('v1.OrgMemberRemoved', { profileId: memberId, scope: membership.scope });
        else {
          const moved = scopeKey(target) !== scopeKey(membership.scope);
          if (moved || role !== membership.roleId.value) {
            await ctx.org.append('v1.OrgMemberAdded', { profileId: memberId, roleId: role, scope: target });
          }
          if (moved) await ctx.org.append('v1.OrgMemberRemoved', { profileId: memberId, scope: membership.scope });
        }
      } else if (remove) await ctx.project.append('v1.MemberRemoved', { profileId: memberId });
      else if (role !== legacyRole) await ctx.project.append('v1.MemberRoleChanged', { profileId: memberId, role: role as Role });
      ctx.toast(remove ? `${person} removed from ${scopeLabel(ctx, target)}` : `${person} is now ${roleName}`);
      ctx.back();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Screen footer={allowed ? <Footer label={requestId ? 'Assign role' : 'Save assignment'} onPress={() => void save(false)} disabled={busy || !role}
      secondary={requestId ? undefined : { label: 'Remove from this scope', onPress: () => void save(true) }} /> : undefined}>
      <Header title={requestId ? 'Assign role' : person} sub={requestId ? person : `${roleName} · ${legacy ? projectName(ctx) : scopeLabel(ctx, target)}`} onBack={ctx.back} />
      {requestId ? <Note>This person created an account and asked to join. Assign a role to give them access. They join at organization level; narrow the scope here after they join.</Note> : null}
      {!allowed ? <Note>View only — you do not have permission to change members.</Note> : null}
      {memberships.length > 1 && !requestId ? (
        <Section label="Assignments">
          {rowsWithLast(memberships, ([k, m], last) => (
            <Row key={k} label={scopeLabel(ctx, m.scope)} sub={ctx.org.state?.roles[m.roleId.value]?.name.value ?? m.roleId.value}
              onPress={() => { setKey(k); setRoleId(null); setScope(null); }}
              right={k === key ? <Check size={18} color={colors.translate} accessibilityLabel="Selected" /> : <View />} last={last} />
          ))}
        </Section>
      ) : null}
      {legacy ? (
        <Section label="Role">
          {rowsWithLast(ROLES, (r, last) => (
            <Row key={r} label={r} onPress={allowed ? () => setRoleId(r) : undefined}
              right={role === r ? <Check size={18} color={colors.translate} accessibilityLabel="Selected" /> : <View />} last={last} />
          ))}
        </Section>
      ) : <RolePicker ctx={ctx} roleId={role} onPick={setRoleId} disabled={!allowed} />}
      {membership && allowed ? <ScopePicker ctx={ctx} scope={target} onChange={setScope} /> : null}
      {error ? <Note>{error}</Note> : null}
    </Screen>
  );
}

// ---- structure ----------------------------------------------------------------

/**
 * A project is registered in the org partition and born in its own
 * partition. A description waits for a fact that stores it (Phase 2).
 */
export function NewProject(ctx: Ctx) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const allowed = canAtOrg(ctx, 'manage_structure');
  async function create() {
    const trimmed = name.trim();
    if (!allowed || busy || !trimmed) return;
    setBusy(true);
    setError('');
    try {
      const projectId = Crypto.randomUUID();
      await ctx.org.append('v1.ProjectRegistered', { projectId, name: trimmed });
      const project = await partitionClient(ctx.session.actorId, ctx.project.orgId, projectId);
      await project.appendMany([
        { type: 'v1.ProjectCreated', payload: { name: trimmed, sourceLanguoidId: 'eng' } },
        { type: 'v1.MemberAdded', payload: { profileId: ctx.session.actorId, role: 'owner' } }
      ]);
      // The org first: the registration authorizes the project's first events.
      // Offline, both stay pending and push later.
      await ctx.org.sync().then(() => project.sync()).catch(() => {});
      ctx.toast(`${trimmed} created — add its languages next`);
      ctx.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen footer={<Footer label={busy ? 'Creating…' : 'Create project'} onPress={() => void create()} disabled={busy || !allowed || !name.trim()} />}>
      <Header title="New project" onBack={ctx.back} />
      <Note>A project groups languages that share templates, reference material, and review flows.</Note>
      <TextInput accessibilityLabel="Project name" style={styles.input} placeholder="Project name" value={name} onChangeText={setName} maxLength={100} />
      {!allowed ? <Note>You need Manage Org Structure at the organization level to add a project.</Note> : null}
      {error ? <Note>{error}</Note> : null}
    </Screen>
  );
}

const DEFAULT_TEMPLATE = 'dynamic';
const DEFAULT_FLOW = 'standard_bible';

/**
 * A language starts with the default template and review flow, each only
 * when this admin may set it. A display name waits for a fact that stores it
 * (Phase 2), so the language is known by its code.
 */
export function NewLanguage(ctx: Ctx) {
  const { state, appendMany } = ctx.project;
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const project = projectName(ctx);
  const withTemplate = ctx.session.can('manage_templates');
  const withFlow = ctx.session.can('manage_flows');
  const template = contentTemplates().find((t) => t.id === DEFAULT_TEMPLATE)?.name ?? DEFAULT_TEMPLATE;
  const flow = FLOW_TEMPLATES.find((f) => f.id === DEFAULT_FLOW)?.name ?? DEFAULT_FLOW;
  async function create() {
    const languoidId = code.trim();
    const laneId = `L-${languoidId}`;
    if (busy || !languoidId) return;
    if (state?.lanes[laneId]) { setError('That language is already in this project.'); return; }
    setBusy(true);
    setError('');
    try {
      const units = withTemplate ? instantiateTemplate(DEFAULT_TEMPLATE).filter((u) => !state?.units[u.unitId]) : [];
      await appendMany([
        { type: 'v1.LaneAdded' as const, payload: { laneId, languoidId } },
        ...(withTemplate ? [
          { type: 'v1.LaneTemplateSelected' as const, payload: { laneId, templateId: DEFAULT_TEMPLATE, catalogVersion: CATALOG_VERSION } },
          ...units.map((payload) => ({ type: 'v1.UnitAdded' as const, payload }))
        ] : []),
        ...(withFlow ? [
          { type: 'v1.LaneFlowSelected' as const, payload: { laneId, flowId: DEFAULT_FLOW, catalogVersion: CATALOG_VERSION } },
          ...instantiateFlow(DEFAULT_FLOW, laneId).map((payload) => ({ type: 'v1.WorkflowStepSet' as const, payload }))
        ] : [])
      ]);
      ctx.toast(`${languoidId} added to ${project}`);
      ctx.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen footer={<Footer label={busy ? 'Creating…' : 'Create language'} onPress={() => void create()} disabled={busy || !code.trim()} />}>
      <Header title="New language" sub={project} onBack={ctx.back} />
      <Note>This language is added to the current project. You can invite language admins from Members after it is created.</Note>
      <TextInput accessibilityLabel="Language code" style={styles.input} placeholder="Language code, e.g. din" autoCapitalize="none" value={code} onChangeText={setCode} maxLength={40} />
      <Section label="It starts with">
        <Row icon={FileText} label={template} sub={withTemplate ? 'Content template · change it from the language home' : 'Content template · someone with Manage Content Templates picks it'} />
        <Row icon={Workflow} label={flow} sub={withFlow ? 'Review flow · change it from the language home' : 'Review flow · someone with Manage Review Flows picks it'} last />
      </Section>
      {error ? <Note>{error}</Note> : null}
    </Screen>
  );
}

// ---- review teams ---------------------------------------------------------------

/**
 * People who may review in this language: an org membership whose scope
 * covers it grants Review, or a project-log member whose fixed role reviews.
 */
function languageReviewers(ctx: Ctx, laneId: string): string[] {
  const org = ctx.org.state;
  const state = ctx.project.state;
  const projectId = ctx.project.projectId;
  const ids = new Set([...Object.keys(org?.members ?? {}), ...Object.keys(state?.members ?? {})]);
  return [...ids].filter((id) => {
    if (org && privilegesFor(org, id, { projectId, laneId }).has('review')) return true;
    const m = state?.members[id];
    return !!m && !m.removed.value && privilegesOfFixedRole(m.role.value).has('review');
  });
}

export function ReviewTeams(ctx: Ctx) {
  const { state } = ctx.project;
  const laneId = ctx.params['laneId'] ?? Object.keys(state?.lanes ?? {})[0] ?? '';
  const lang = state?.lanes[laneId]?.languoidId ?? laneId;
  const teams = Object.entries(state?.teams ?? {}).filter(([, t]) => t.laneId === laneId);
  const canManage = ctx.session.can('manage_teams');
  const person = usePerson();
  return (
    <Screen footer={canManage ? <Footer label="New team" onPress={() => ctx.go('review_team_editor', { laneId })} /> : undefined}>
      <Header title="Review teams" sub={lang} onBack={ctx.back} />
      <Note>{`Teams for ${lang}. Members must hold the Review privilege for this language.`}</Note>
      <Section label={`Teams · ${teams.length}`}>
        {teams.length === 0 ? <Row icon={Users} label="No review teams" sub="Create a team to group language reviewers." last /> : null}
        {rowsWithLast(teams, ([teamId, t], last) => {
          const members = Object.entries(t.members).filter(([, m]) => m.value).map(([id]) => id);
          return (
            <Row key={teamId} icon={Users} label={t.name.value || teamId}
              sub={`${plural(members.length, 'member')}${members.length ? ` · ${members.slice(0, 3).map((id) => person(id).name).join(', ')}${members.length > 3 ? '…' : ''}` : ''}`}
              onPress={canManage ? () => ctx.go('review_team_editor', { laneId, teamId }) : undefined} last={last} />
          );
        })}
      </Section>
    </Screen>
  );
}

/**
 * Name a team and choose its members. Saving writes the team's own facts
 * only: it no longer rewrites the language's workflow steps to point at the
 * team, which silently changed who could review every step.
 */
export function ReviewTeamEditor(ctx: Ctx) {
  const { state, appendMany } = ctx.project;
  const laneId = ctx.params['laneId'] ?? '';
  const [newId] = useState(() => `team-${Crypto.randomUUID()}`);
  const teamId = ctx.params['teamId'] ?? newId;
  const team = state?.teams[teamId];
  const current = new Set(Object.entries(team?.members ?? {}).filter(([, m]) => m.value).map(([id]) => id));
  const eligible = languageReviewers(ctx, laneId);
  const shown = [...new Set([...eligible, ...current])];
  const [chosen, setChosen] = useState<Set<string>>(current);
  const [name, setName] = useState(team?.name.value ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canManage = ctx.session.can('manage_teams');
  async function save() {
    if (!state || busy || !canManage) return;
    const label = name.trim() || 'Review team';
    const events: Parameters<typeof appendMany>[0] = [];
    if (!team || team.name.value !== label) events.push({ type: 'v1.ReviewTeamDefined', payload: { teamId, laneId, name: label } });
    for (const id of chosen) if (!current.has(id)) events.push({ type: 'v1.ReviewTeamMemberSet', payload: { teamId, profileId: id, member: true } });
    for (const id of current) if (!chosen.has(id)) events.push({ type: 'v1.ReviewTeamMemberSet', payload: { teamId, profileId: id, member: false } });
    setBusy(true);
    setError('');
    try {
      if (events.length) await appendMany(events);
      ctx.toast(`${label} saved · ${plural(chosen.size, 'person', 'people')}`);
      ctx.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen footer={canManage ? <Footer label="Save team" onPress={() => void save()} disabled={busy} /> : undefined}>
      <Header title={team ? team.name.value || 'Review team' : 'New team'} sub={state?.lanes[laneId]?.languoidId} onBack={ctx.back} />
      <TextInput accessibilityLabel="Team name" style={styles.input} placeholder="Team name" value={name} onChangeText={setName} editable={canManage} maxLength={100} />
      <Section label={`Members · ${chosen.size}`}>
        {shown.length === 0 ? <Row label="No eligible reviewers" sub="Invite members with a Review role scoped to this language first." last /> : null}
        {rowsWithLast(shown, (id, last) => (
          <Row key={id} personId={id} label={id === ctx.session.actorId ? 'You' : undefined}
            sub={eligible.includes(id) ? undefined : 'No longer has Review here'}
            onPress={canManage ? () => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }) : undefined}
            right={chosen.has(id) ? <Check size={18} color={colors.done} accessibilityLabel="In team" /> : <View />} last={last} />
        ))}
      </Section>
      <Note>Only members with the Review privilege for this language can be added. A team does not change who reviews a step by itself.</Note>
      {error ? <Note>{error}</Note> : null}
    </Screen>
  );
}

/** The clock badge a status row carries when passages wait on reviewers. */
export function WaitingBadge(props: { n: number }) {
  if (!props.n) return null;
  return (
    <View accessible accessibilityLabel={`${props.n} with reviewers`} style={{ flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.full, backgroundColor: tint.reviewChip }}>
      <Clock size={14} color={colors.review} />
      <Text style={[text.small, { color: colors.review, fontWeight: '600' }]}>{props.n}</Text>
    </View>
  );
}

const styles = {
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, backgroundColor: colors.card, color: colors.foreground }
};


import { contractsFor } from '../screenContracts';
export const contracts = contractsFor('org_home', 'project_home', 'language_home', 'members_list', 'invite_member', 'invite_qr', 'edit_member', 'new_project', 'new_language', 'review_teams', 'review_team_editor');
