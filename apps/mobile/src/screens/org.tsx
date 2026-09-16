// Avatar P. Org, project, and language homes; members; invites; review teams.
import type { Role } from '@langquest-next/core';
import { deriveWorkflow } from '@langquest-next/core';
import { Building2, Check, FileText, Globe, ListChecks, Plus, QrCode, Users, Workflow, X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { decideRequest, inviteUri, issueInvite, pendingRequests, type NewInvite, type PendingRequest } from '../invites';
import type { Ctx } from '../ctx';
import { Badge, Footer, Header, Note, NotWired, Row, Screen, Section } from '../pui';
import { colors, space } from '../theme';
import { Card, text } from '../ui';

// One org for now, the same constant App.tsx opens with.
const ORG_ID = process.env.EXPO_PUBLIC_ORG_ID ?? 'org1';

const ROLES: Role[] = ['owner', 'coordinator', 'translator', 'reviewer', 'viewer'];

function catalogRows(ctx: Ctx) {
  return (
    <>
      <Section label="Manage content">
        <Row icon={FileText} label="Content templates" onPress={() => ctx.go('templates_home')} />
        <Row icon={FileText} label="Reference material" onPress={() => ctx.go('reference_home')} last />
      </Section>
      <Section label="Manage processes">
        <Row icon={Workflow} label="Review flows" onPress={() => ctx.go('flows_home')} last />
      </Section>
    </>
  );
}

function memberRows(ctx: Ctx) {
  const n = ctx.project.state ? Object.values(ctx.project.state.members).filter((m) => !m.removed.value).length : 0;
  return (
    <Section label="Manage members">
      <Row icon={ListChecks} label="Roles" sub={`${ROLES.length} roles`} onPress={() => ctx.go('roles_home')} />
      <Row icon={Users} label="Members" sub={`${n} members`} onPress={() => ctx.go('members_list')} last />
    </Section>
  );
}

export function OrgHome(ctx: Ctx) {
  const { state } = ctx.project;
  const name = state?.project?.value.name ?? 'Project';
  return (
    <Screen>
      <Header title="Organization" crumbs={[{ label: 'org1' }]} />
      <Section label="Manage projects">
        <Row icon={Building2} label={name} sub={`${Object.keys(state?.lanes ?? {}).length} languages`} onPress={() => ctx.go('project_home')} />
        {ctx.session.isAdmin ? <Row icon={Plus} label="New project" onPress={() => ctx.go('new_project')} last /> : <Row label="" last />}
      </Section>
      {catalogRows(ctx)}
      {memberRows(ctx)}
    </Screen>
  );
}

export function ProjectHome(ctx: Ctx) {
  const { state } = ctx.project;
  const lanes = state ? Object.entries(state.lanes) : [];
  const name = state?.project?.value.name ?? 'Project';
  return (
    <Screen>
      <Header title={name} crumbs={[{ label: 'org1', onPress: () => ctx.go('org_home') }, { label: name }]} />
      <Section label="Manage languages">
        {lanes.map(([laneId, l]) => (
          <Row key={laneId} icon={Globe} label={l.languoidId} onPress={() => ctx.go('language_home', { laneId })} />
        ))}
        {ctx.session.isAdmin ? <Row icon={Plus} label="New language" onPress={() => ctx.go('new_language')} last /> : <Row label="" last />}
      </Section>
      {catalogRows(ctx)}
      {memberRows(ctx)}
      <Section label="Status">
        <Row label="Open status" onPress={() => ctx.go('status_home')} last />
      </Section>
    </Screen>
  );
}

export function LanguageHome(ctx: Ctx) {
  const { state } = ctx.project;
  const laneId = ctx.params['laneId'] ?? Object.keys(state?.lanes ?? {})[0] ?? '';
  const name = state?.project?.value.name ?? 'Project';
  const lang = state?.lanes[laneId]?.languoidId ?? laneId;
  return (
    <Screen>
      <Header title={lang} crumbs={[{ label: 'org1', onPress: () => ctx.go('org_home') }, { label: name, onPress: () => ctx.go('project_home') }, { label: lang }]} />
      {catalogRows(ctx)}
      <Section label="Review">
        <Row icon={Users} label="Review teams" onPress={() => ctx.go('review_teams', { laneId })} last />
      </Section>
      {memberRows(ctx)}
      <Section label="Status">
        <Row label="Open status" onPress={() => ctx.go('language_status', { laneId })} last />
      </Section>
    </Screen>
  );
}

export function MembersList(ctx: Ctx) {
  const { state } = ctx.project;
  const orgId = ctx.project.orgId;
  const members = state ? Object.entries(state.members).filter(([, m]) => !m.removed.value) : [];
  const mayAdmit = ctx.session.can('invite_members');
  const roles = Object.entries(ctx.org.state?.roles ?? {}).filter(([, r]) => !r.retired);
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!mayAdmit) return;
    try {
      setRequests(await pendingRequests(orgId));
    } catch {
      // Offline: the list is a server read with no local mirror, so it stays
      // empty rather than claiming nobody asked.
    }
  }, [mayAdmit, orgId]);
  useEffect(() => void refresh(), [refresh]);

  async function decide(id: string, accepted: boolean) {
    setError('');
    try {
      await decideRequest(id, accepted, roles.find(([r]) => r === 'translator')?.[0] ?? roles[0]?.[0]);
      await refresh();
      await ctx.org.sync();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Screen>
      <Header title="Members" onBack={ctx.back} action={ctx.session.isAdmin ? <Badge label="Invite" color={colors.translate} /> : undefined} />
      {requests.length > 0 ? (
        <Section label={`Asking to join · ${requests.length}`}>
          {requests.map((r, i) => (
            <Row
              key={r.id}
              icon={Users}
              label={r.profileId.slice(0, 8)}
              sub={r.message || 'No message'}
              right={
                <View style={{ flexDirection: 'row', gap: space.md }}>
                  <Pressable onPress={() => void decide(r.id, true)} hitSlop={8} accessibilityLabel="Accept">
                    <Check size={20} color={colors.translate} />
                  </Pressable>
                  <Pressable onPress={() => void decide(r.id, false)} hitSlop={8} accessibilityLabel="Decline">
                    <X size={20} color={colors.mutedForeground} />
                  </Pressable>
                </View>
              }
              last={i === requests.length - 1}
            />
          ))}
        </Section>
      ) : null}
      {error ? <Text style={{ color: colors.reference }}>{error}</Text> : null}
      <Section label={`Project members · ${members.length}`}>
        {members.map(([id, m], i) => (
          <Row key={id} icon={Users} label={id === ctx.session.actorId ? 'You' : id.slice(0, 8)} sub={id} badge={m.role.value} onPress={ctx.session.isAdmin ? () => ctx.go('edit_member', { memberId: id }) : undefined} last={i === members.length - 1} />
        ))}
      </Section>
      {ctx.session.isAdmin ? <Footer label="Invite" onPress={() => ctx.go('invite_member')} /> : null}
    </Screen>
  );
}

export function InviteMember(ctx: Ctx) {
  const roles = Object.entries(ctx.org.state?.roles ?? {}).filter(([, r]) => !r.retired);
  const [roleId, setRoleId] = useState(roles[0]?.[0] ?? '');

  return (
    <Screen footer={<Footer label="Next" onPress={() => ctx.go('invite_qr', { roleId })} disabled={!roleId} />}>
      <Header title="Invite" onBack={ctx.back} />
      <Note>Pick what they join as. The next screen makes the code, which is shown once.</Note>
      <Section label="They join as">
        {roles.map(([id, r], i) => (
          <Row key={id} label={r.name.value || id} onPress={() => setRoleId(id)} right={roleId === id ? <Check size={18} color={colors.translate} /> : <View />} last={i === roles.length - 1} />
        ))}
      </Section>
    </Screen>
  );
}

/** The issued code, shown once. The QR image itself is still to come. */
export function InviteQr(ctx: Ctx) {
  const orgId = ctx.project.orgId;
  const roles = Object.entries(ctx.org.state?.roles ?? {}).filter(([, r]) => !r.retired);
  const [roleId, setRoleId] = useState(ctx.params['roleId'] ?? roles[0]?.[0] ?? '');
  const [invite, setInvite] = useState<NewInvite | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    setError('');
    try {
      setInvite(await issueInvite(orgId, roleId, { level: 'org' }));
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <Screen footer={invite ? <Footer label="Done" onPress={() => ctx.go('members_list')} /> : <Footer label="Create invite" onPress={() => void generate()} disabled={busy || !roleId} />}>
      <Header title="Invite by QR" onBack={ctx.back} />
      {invite ? (
        <>
          <View style={{ alignItems: 'center', paddingVertical: space.xl }}>
            <QRCode value={inviteUri(orgId, invite.token)} size={200} backgroundColor="transparent" />
          </View>
          <Card>
            <Text style={text.small}>Or type this code</Text>
            <Text selectable style={[text.body, { fontFamily: 'Courier' }]}>{invite.token}</Text>
          </Card>
          <Note>Shown once. Leaving this screen loses the code, and you make a new invite instead. It expires {new Date(invite.expiresAt).toDateString()}.</Note>
        </>
      ) : (
        <>
          <View style={{ alignItems: 'center', paddingVertical: space.xl }}>
            <QrCode size={160} color={colors.mutedForeground} />
          </View>
          <Note>Anyone who scans this joins the organization in the role you pick, once. The code is never stored, here or on the server.</Note>
          <Section label="They join as">
            {roles.map(([id, r], i) => (
              <Row key={id} label={r.name.value || id} onPress={() => setRoleId(id)} right={roleId === id ? <Check size={18} color={colors.translate} /> : <View />} last={i === roles.length - 1} />
            ))}
          </Section>
        </>
      )}
      {error ? <Text style={{ color: colors.reference }}>{error}</Text> : null}
    </Screen>
  );
}

export function EditMember(ctx: Ctx) {
  const { state, append } = ctx.project;
  const memberId = ctx.params['memberId'] ?? '';
  const current = state?.members[memberId]?.role.value ?? 'viewer';
  const [role, setRole] = useState<Role>(current);
  async function save() {
    if (role !== current) await append('v1.MemberRoleChanged', { profileId: memberId, role });
    ctx.back();
  }
  async function remove() {
    await append('v1.MemberRemoved', { profileId: memberId });
    ctx.back();
  }
  return (
    <Screen footer={<Footer label="Save assignment" onPress={() => void save()} secondary={{ label: 'Remove', onPress: () => void remove() }} />}>
      <Header title="Edit member" sub={memberId} onBack={ctx.back} />
      <Section label="Role">
        {ROLES.map((r, i) => (
          <Row key={r} label={r} onPress={() => setRole(r)} right={role === r ? <Check size={18} color={colors.translate} /> : <View />} last={i === ROLES.length - 1} />
        ))}
      </Section>
    </Screen>
  );
}

export function NewProject(ctx: Ctx) {
  return (
    <Screen footer={<Footer label="Create project" onPress={ctx.back} disabled />}>
      <Header title="New project" onBack={ctx.back} />
      <NotWired what="A second project per organization" />
    </Screen>
  );
}

export function NewLanguage(ctx: Ctx) {
  const { append } = ctx.project;
  const [code, setCode] = useState('');
  async function create() {
    await append('v1.LaneAdded', { laneId: `L-${code.trim()}`, languoidId: code.trim() });
    ctx.back();
  }
  return (
    <Screen footer={<Footer label="Create language" onPress={() => void create()} disabled={!code.trim()} />}>
      <Header title="New language" onBack={ctx.back} />
      <TextInput style={styles.input} placeholder="Language code (e.g. din)" autoCapitalize="none" value={code} onChangeText={setCode} />
    </Screen>
  );
}

/** UX spec review teams: named groups of reviewers per language, owning that language's reviewer stages (audit 5.F). */
export function ReviewTeams(ctx: Ctx) {
  const { state } = ctx.project;
  const laneId = ctx.params['laneId'] ?? Object.keys(state?.lanes ?? {})[0] ?? '';
  const teams = Object.entries(state?.teams ?? {}).filter(([, t]) => t.laneId === laneId);
  const canManage = ctx.session.can('manage_teams');
  return (
    <Screen footer={canManage ? <Footer label={teams.length ? 'Edit team' : 'New team'} onPress={() => ctx.go('review_team_editor', { laneId, ...(teams[0] ? { teamId: teams[0][0] } : {}) })} /> : undefined}>
      <Header title="Review teams" sub={state?.lanes[laneId]?.languoidId} onBack={ctx.back} />
      {teams.map(([teamId, t]) => {
        const members = Object.entries(t.members).filter(([, m]) => m.value).map(([id]) => id);
        return (
          <Section key={teamId} label={`${t.name.value || teamId} · ${members.length}`}>
            {members.map((id, i) => (
              <Row key={id} icon={Users} label={id.slice(0, 8)} last={i === members.length - 1} />
            ))}
            {members.length === 0 ? <Row label="Nobody yet" last /> : null}
          </Section>
        );
      })}
      {teams.length === 0 ? <Note>No review team for this language yet. Reviewer stages fall back to everyone holding the reviewer role.</Note> : null}
      <Section label="Stages">
        <Row icon={Workflow} label="Edit stages" onPress={() => ctx.go('flow_editor', { laneId })} last />
      </Section>
    </Screen>
  );
}

/** Toggle members in the language's team; the team then owns every reviewer stage of that language. */
export function ReviewTeamEditor(ctx: Ctx) {
  const { state, appendMany } = ctx.project;
  const laneId = ctx.params['laneId'] ?? '';
  const teamId = ctx.params['teamId'] ?? `team-${laneId}`;
  const team = state?.teams[teamId];
  const members = state ? Object.entries(state.members).filter(([, m]) => !m.removed.value) : [];
  const current = new Set(Object.entries(team?.members ?? {}).filter(([, m]) => m.value).map(([id]) => id));
  const [chosen, setChosen] = useState<Set<string>>(current);
  const [name, setName] = useState(team?.name.value ?? 'Community reviewers');
  async function save() {
    if (!state) return;
    const events: Parameters<typeof appendMany>[0] = [];
    if (!team || team.name.value !== name.trim()) events.push({ type: 'v1.ReviewTeamDefined', payload: { teamId, laneId, name: name.trim() || 'Review team' } });
    for (const id of chosen) if (!current.has(id)) events.push({ type: 'v1.ReviewTeamMemberSet', payload: { teamId, profileId: id, member: true } });
    for (const id of current) if (!chosen.has(id)) events.push({ type: 'v1.ReviewTeamMemberSet', payload: { teamId, profileId: id, member: false } });
    // The team owns the language's reviewer stages.
    deriveWorkflow(state, laneId).forEach((s, i) => {
      if (s.role !== 'reviewer' || s.teamId === teamId) return;
      events.push({
        type: 'v1.WorkflowStepSet',
        payload: { stepId: s.id, laneId, order: `s${String(i).padStart(2, '0')}`, role: s.role, teamId, required: s.required, rule: s.rule, ...(s.label !== undefined ? { label: s.label } : {}) }
      });
    });
    await appendMany(events);
    ctx.back();
  }
  return (
    <Screen footer={<Footer label="Save team" onPress={() => void save()} />}>
      <Header title="Review team" sub={state?.lanes[laneId]?.languoidId} onBack={ctx.back} />
      <TextInput style={styles.input} placeholder="Team name" value={name} onChangeText={setName} />
      <Section label="Members">
        {members.map(([id, m], i) => (
          <Row key={id} label={id.slice(0, 8)} sub={m.role.value} onPress={() => setChosen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })} right={chosen.has(id) ? <Check size={18} color={colors.done} /> : <View />} last={i === members.length - 1} />
        ))}
      </Section>
      <View>{void text}</View>
    </Screen>
  );
}

const styles = {
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, backgroundColor: colors.card, color: colors.foreground }
};
