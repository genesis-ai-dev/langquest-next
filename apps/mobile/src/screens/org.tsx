// Avatar P. Org, project, and language homes; members; invites; review teams.
import type { Role } from '@langquest-next/core';
import { CATALOG_VERSION, contentTemplates, derivePieces, deriveWorkflow, instantiateTemplate } from '@langquest-next/core';
import { Building2, Check, FileText, Globe, Headphones, ListChecks, Plus, QrCode, Users, Workflow, X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { decideRequest, inviteUri, issueInvite, pendingRequests, type NewInvite, type PendingRequest } from '../invites';
import type { Ctx } from '../ctx';
import { Badge, Footer, Header, Note, Row, Screen, Section } from '../pui';
import { colors, space } from '../theme';
import { Card, text } from '../ui';
import { templateSubtree } from '../setupFlow';

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
        {ctx.session.isAdmin ? <Row icon={Plus} label={state?.project ? "Set up project" : "New project"} onPress={() => ctx.go('new_project')} last /> : <Row label="" last />}
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
  const { state, appendMany } = ctx.project;
  const laneEntries = state ? Object.entries(state.lanes) : [];
  const laneId = laneEntries[0]?.[0] ?? `lane-${ctx.project.projectId}`;
  const [step, setStep] = useState(0);
  const [templateId, setTemplateId] = useState(state?.laneTemplates[laneId]?.value.templateId ?? 'bible');
  const [rootItemId, setRootItemId] = useState('');
  const [language, setLanguage] = useState(laneEntries[0]?.[1].languoidId ?? 'und');
  const [reference, setReference] = useState('');
  const [referenceAudioHash, setReferenceAudioHash] = useState('');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [projectName, setProjectName] = useState(state?.project?.value.name ?? '');
  const canStructure = ctx.session.can('manage_templates') && (laneEntries.length > 0 || ctx.session.can('manage_structure'));
  const canReference = ctx.session.can('manage_reference');
  const canAssign = ctx.session.can('assign_work');
  const members = state ? Object.entries(state.members).filter(([, m]) => !m.removed.value) : [];
  const template = contentTemplates().find((t) => t.id === templateId);
  const rootUnitId = rootItemId ? `${templateId}@${CATALOG_VERSION}/${rootItemId}` : '';
  const pieces = state ? derivePieces(state, laneId) : [];
  const targetPiece = pieces.find((piece) => {
    let id: string | null = piece.unitId;
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      if (id === rootUnitId) return true;
      seen.add(id); id = state?.units[id]?.parentUnitId ?? null;
    }
    return false;
  });
  const sourceRecordings = state
    ? Object.entries(state.recordings).filter(([, r]) => {
        if (r.kind !== 'source' || r.laneId !== laneId || !r.cards[0]) return false;
        if (!rootUnitId) return false;
        let id: string | null = r.unitId;
        const seen = new Set<string>();
        while (id && !seen.has(id)) {
          seen.add(id);
          if (id === rootUnitId) return true;
          id = state.units[id]?.parentUnitId ?? null;
        }
        return false;
      })
    : [];
  const assigned = !!targetPiece && !!state && Object.values(state.assignments).some((a) => a.laneId === laneId && a.unitId === targetPiece.unitId && a.role === 'translator');

  function setupUnits(templateId: string) {
    const t = contentTemplates().find((candidate) => candidate.id === templateId);
    if (!t) return [];
    const root = rootItemId;
    if (!root) return [];
    const ids = templateSubtree(t, root);
    return instantiateTemplate(templateId).filter((unit) => ids.has(unit.unitId.split('/').pop() ?? ''));
  }

  async function saveStructure() {
    if (!canStructure || busy || !template) return;
    setBusy(true);
    setError('');
    try {
      const events: Parameters<typeof appendMany>[0] = [];
      if (!state?.project) {
        const name = projectName.trim();
        if (!name) throw new Error('Enter a project name first.');
        await ctx.org.append('v1.ProjectRegistered', { projectId: ctx.project.projectId, name });
        await ctx.project.append('v1.ProjectCreated', { name, sourceLanguoidId: 'eng' });
        await ctx.project.append('v1.MemberAdded', { profileId: ctx.session.actorId, role: 'owner' });
      }
      if (!state?.lanes[laneId]) events.push({ type: 'v1.LaneAdded', payload: { laneId, languoidId: language.trim() || 'und' } });
      const selected = state?.laneTemplates[laneId]?.value;
      if (selected?.templateId !== templateId) {
        events.push({ type: 'v1.LaneTemplateSelected', payload: { laneId, templateId, catalogVersion: CATALOG_VERSION } });
      }
      const existing = state?.units ?? {};
      events.push(...setupUnits(templateId).filter((u) => !existing[u.unitId]).map((payload) => ({ type: 'v1.UnitAdded' as const, payload })));
      if (events.length) await appendMany(events);
      setStep(1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveReference() {
    if (!canReference || busy || (!reference.trim() && !referenceAudioHash)) return;
    setBusy(true);
    setError('');
    try {
      const materialId = `setup-brief:${ctx.project.projectId}:${laneId}:${rootUnitId}`;
      const events: Parameters<typeof appendMany>[0] = [];
      if (!state?.materials[materialId]) events.push({ type: 'v1.MaterialDefined', payload: { materialId, kind: 'fia_study', title: 'Reference walkthrough', scope: { laneId, ...(rootUnitId ? { unitId: rootUnitId } : {}) }, templateRef: 'fia_study' } });
      events.push({ type: 'v1.MaterialFieldSet', payload: { materialId, fieldId: 'summary', ...(reference.trim() ? { text: reference.trim() } : {}), ...(referenceAudioHash ? { blobHash: referenceAudioHash } : {}) } });
      await appendMany(events);
      setStep(2);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveAssignment() {
    if (busy || assigned) {
      if (assigned) ctx.go('project_home');
      return;
    }
    if (!canAssign || !assignee || !targetPiece) return;
    setBusy(true);
    setError('');
    try {
      await ctx.project.append('v1.AssignmentMade', { unitId: targetPiece.unitId, laneId, profileId: assignee, role: 'translator' });
      ctx.go('project_home');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const footer = step === 0
    ? <Footer label="Use structure" onPress={() => void saveStructure()} disabled={busy || !canStructure || !template || !rootItemId} />
    : step === 1
      ? <Footer label="Save reference material" onPress={() => void saveReference()} disabled={busy || !canReference || (!reference.trim() && !referenceAudioHash)} secondary={{ label: 'Skip for now', onPress: () => setStep(2) }} />
    : <Footer label={assigned ? 'Open project' : 'Send assignment'} onPress={() => void saveAssignment()} disabled={busy || (!assigned && (!canAssign || !assignee || !targetPiece))} />;

  return (
    <Screen footer={footer}>
      <Header title="Set up project" sub={`Step ${step + 1} of 3`} onBack={() => (step > 0 ? setStep(step - 1) : ctx.back())} />
      {step === 0 ? (
        <>
          <Note>Choose a known structure. It creates ordinary project units that translators can receive.</Note>
          {!state?.project ? <TextInput style={styles.input} placeholder="Project name" value={projectName} onChangeText={setProjectName} /> : null}
          {laneEntries.length === 0 ? <TextInput style={styles.input} placeholder="Target language code" autoCapitalize="none" value={language} onChangeText={setLanguage} /> : null}
          <Section label="Structure">
            {contentTemplates().map((t, i, a) => <Row key={t.id} icon={FileText} label={t.name} sub={t.description} onPress={() => { setTemplateId(t.id); setRootItemId(''); setReferenceAudioHash(''); }} right={templateId === t.id ? <Check size={18} color={colors.translate} /> : <View />} last={i === a.length - 1} />)}
          </Section>
          {template ? <Section label="Known book or collection">
            {template.items.filter((item) => item.parentItemId === null).map((item, i, a) => <Row key={item.itemId} label={item.label} onPress={() => { setRootItemId(item.itemId); setReferenceAudioHash(''); }} right={rootItemId === item.itemId ? <Check size={18} color={colors.translate} /> : <View />} last={i === a.length - 1} />)}
          </Section> : null}
        </>
      ) : step === 1 ? (
        <>
          <Note>Give the team one shared brief or reference note before work starts.</Note>
          <TextInput style={[styles.input, { minHeight: 110 }]} placeholder="Reference note (optional with audio)" multiline value={reference} onChangeText={setReference} />
          {sourceRecordings.map(([id, r], i, a) => <Row key={id} icon={Headphones} label={state?.units[r.unitId]?.label ?? r.unitId} sub="Source audio" onPress={() => setReferenceAudioHash((hash) => hash === r.cards[0]!.hash ? '' : r.cards[0]!.hash)} right={referenceAudioHash === r.cards[0]!.hash ? <Check size={18} color={colors.translate} /> : <View />} last={i === a.length - 1} />)}
          {referenceAudioHash ? <Note>Selected audio is shared with this language’s reference slides.</Note> : null}
          {state?.materials[`setup-brief:${ctx.project.projectId}:${laneId}:${rootUnitId}`] ? <Note>Project brief is already attached.</Note> : null}
        </>
      ) : (
        <>
          <Note>Send the first passage to a translator. You can assign the remaining passages from project status.</Note>
          <Section label="First passage">
            <Row icon={FileText} label={targetPiece?.label ?? 'Choose a structure first'} sub={targetPiece ? `${pieces.length} passages ready` : 'No passages yet'} last />
          </Section>
          <Section label="Translator">
            {members.map(([id, m], i, a) => <Row key={id} label={id === ctx.session.actorId ? 'You' : id.slice(0, 8)} sub={m.role.value} onPress={() => setAssignee(id)} right={assignee === id ? <Check size={18} color={colors.translate} /> : <View />} last={i === a.length - 1} />)}
            {members.length === 0 ? <Row label="No members yet" last /> : null}
          </Section>
          {assigned ? <Note>The first passage already has an assignment.</Note> : null}
        </>
      )}
      {error ? <Text style={{ color: colors.reference }}>{error}</Text> : null}
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
