// Avatar P. Roles, content templates, reference library, key terms, review flows.
import type { QuorumRule, Role, WorkflowStep } from '@langquest-next/core';
import { DEFAULT_CONFIG } from '@langquest-next/core';
import { Check, FileText, KeyRound, Plus, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { Ctx } from '../ctx';
import { Badge, Footer, Header, Note, Row, Screen, Section } from '../pui';
import { colors, space } from '../theme';
import { Card, text } from '../ui';

const ROLE_PRIVS: Record<Role, string[]> = {
  owner: ['Manage org structure', 'Invite members', 'Manage roles', 'Manage content', 'Manage review flows', 'Assign work', 'Translate', 'Review', 'View status'],
  coordinator: ['Invite members', 'Manage content', 'Manage review flows', 'Assign work', 'Translate', 'Review', 'View status'],
  translator: ['Translate', 'Send to reviewers', 'View status'],
  reviewer: ['Review', 'View status'],
  viewer: ['View status']
};

export function RolesHome(ctx: Ctx) {
  const { state } = ctx.project;
  const counts = new Map<string, number>();
  for (const m of Object.values(state?.members ?? {})) if (!m.removed.value) counts.set(m.role.value, (counts.get(m.role.value) ?? 0) + 1);
  return (
    <Screen>
      <Header title="Roles" onBack={ctx.back} />
      <Note>Roles are fixed for now. Custom roles with privilege switches come with organizations above projects.</Note>
      <Section label="Defined at organization">
        {(Object.keys(ROLE_PRIVS) as Role[]).map((r, i, a) => (
          <Row key={r} label={r} sub={`${counts.get(r) ?? 0} members · ${ROLE_PRIVS[r].length} privileges`} onPress={() => ctx.go('role_editor', { roleId: r })} last={i === a.length - 1} />
        ))}
      </Section>
    </Screen>
  );
}

export function RoleEditor(ctx: Ctx) {
  const { state } = ctx.project;
  const roleId = (ctx.params['roleId'] ?? 'translator') as Role | 'new';
  const privs = roleId === 'new' ? [] : ROLE_PRIVS[roleId];
  const members = Object.entries(state?.members ?? {}).filter(([, m]) => !m.removed.value && m.role.value === roleId);
  return (
    <Screen>
      <Header title={roleId === 'new' ? 'New role' : roleId} sub="Role · Organization" onBack={ctx.back} />
      {roleId === 'new' ? <Note>Custom roles are not wired yet.</Note> : null}
      <Section label="Members with this role">
        {members.length === 0 ? <Row label="Nobody" last /> : null}
        {members.map(([id], i) => (
          <Row key={id} label={id.slice(0, 8)} onPress={ctx.session.isAdmin ? () => ctx.go('edit_member', { memberId: id }) : undefined} last={i === members.length - 1} />
        ))}
      </Section>
      <Section label="Permissions">
        {privs.map((p, i) => (
          <Row key={p} label={p} right={<Check size={18} color={colors.done} />} last={i === privs.length - 1} />
        ))}
      </Section>
    </Screen>
  );
}

export function TemplatesHome(ctx: Ctx) {
  const { state } = ctx.project;
  const kinds = (state?.config?.value ?? DEFAULT_CONFIG).unitKinds;
  return (
    <Screen>
      <Header title="Content templates" onBack={ctx.back} />
      <Note>The applied template is the unit tree: {kinds.map((k) => k.label).join(' › ')}.</Note>
      <Section label="Applied">
        {kinds.map((k, i) => (
          <Row key={k.id} icon={FileText} label={k.label} sub={k.childKinds.length ? `holds ${k.childKinds.join(', ')}` : 'unit of work'} last={i === kinds.length - 1} />
        ))}
      </Section>
    </Screen>
  );
}

export function ReferenceHome(ctx: Ctx) {
  const { state } = ctx.project;
  const refs = Object.entries(state?.references ?? {});
  const byKind = new Map<string, typeof refs>();
  for (const r of refs) byKind.set(r[1].kind, [...(byKind.get(r[1].kind) ?? []), r]);
  const firstUnit = Object.keys(state?.units ?? {}).find((u) => state!.units[u]!.parentUnitId !== null) ?? '';
  return (
    <Screen footer={ctx.session.isAdmin ? <Footer label="Add material" onPress={() => ctx.go('material_editor', { unitId: firstUnit })} /> : undefined}>
      <Header title="Reference library" onBack={ctx.back} />
      <Section label={`Key terms · ${byKind.get('key_terms')?.length ?? 0}`}>
        <Row icon={KeyRound} label="Living glossary" onPress={() => ctx.go('key_terms')} last />
      </Section>
      {[...byKind.entries()].filter(([k]) => k !== 'key_terms').map(([kind, items]) => (
        <Section key={kind} label={`${kind.replace('_', ' ')} · ${items.length}`}>
          {items.map(([id, r], i) => (
            <Row key={id} label={r.text?.split('\n')[0] ?? id} sub={state?.units[r.unitId]?.label} onPress={ctx.session.isAdmin ? () => ctx.go('material_editor', { refId: id }) : undefined} last={i === items.length - 1} />
          ))}
        </Section>
      ))}
    </Screen>
  );
}

export function KeyTerms(ctx: Ctx) {
  const { state } = ctx.project;
  const unitId = ctx.params['unitId'];
  const all = Object.entries(state?.references ?? {}).filter(([, r]) => r.kind === 'key_terms');
  const here = unitId ? all.filter(([, r]) => r.unitId === unitId) : [];
  const other = unitId ? all.filter(([, r]) => r.unitId !== unitId) : all;
  const rows = (items: typeof all) =>
    items.map(([id, r], i) => (
      <Row key={id} icon={KeyRound} label={r.text ?? id} sub={state?.units[r.unitId]?.label} onPress={() => ctx.go('key_term_detail', { refId: id })} last={i === items.length - 1} />
    ));
  return (
    <Screen>
      <Header title="Key terms" onBack={ctx.back} />
      {unitId ? <Section label={`In this passage · ${here.length}`}>{here.length ? rows(here) : <Row label="None" last />}</Section> : null}
      <Section label={`${unitId ? 'Other terms' : 'All terms'} · ${other.length}`}>{other.length ? rows(other) : <Row label="None" last />}</Section>
    </Screen>
  );
}

export function KeyTermDetail(ctx: Ctx) {
  const { state } = ctx.project;
  const refId = ctx.params['refId'] ?? '';
  const r = state?.references[refId];
  if (!r) return <Note>Term not found.</Note>;
  return (
    <Screen>
      <Header title={r.text ?? refId} sub={state?.units[r.unitId]?.label} onBack={ctx.back} />
      <Note>Renderings and adjustment history arrive with living-glossary events.</Note>
      <Section label="Linked translations">
        {Object.entries(state?.takes ?? {}).filter(([, t]) => t.unitId === r.unitId && !t.archived).map(([id, t], i, a) => (
          <Row key={id} label={`${t.cardHashes.length} cards`} sub={t.actorId.slice(0, 8)} onPress={() => ctx.go('piece_version', { takeId: id, laneId: t.laneId, unitId: t.unitId })} last={i === a.length - 1} />
        ))}
      </Section>
    </Screen>
  );
}

export function FlowsHome(ctx: Ctx) {
  const { state } = ctx.project;
  const steps = (state?.config?.value ?? DEFAULT_CONFIG).workflow;
  return (
    <Screen footer={ctx.session.isAdmin ? <Footer label="Edit stages" onPress={() => ctx.go('flow_editor')} /> : undefined}>
      <Header title="Review flows" onBack={ctx.back} />
      <Section label="Applied flow">
        {steps.map((s, i) => (
          <Row key={s.id} label={s.id} sub={`${s.role} · ${s.rule}${s.required ? ' · required' : ' · optional'}`} badge={`${i + 1}`} last={i === steps.length - 1} />
        ))}
      </Section>
    </Screen>
  );
}

const RULES: QuorumRule[] = ['any', 'majority', 'unanimous'];

export function FlowEditor(ctx: Ctx) {
  const { state, append } = ctx.project;
  const config = state?.config?.value ?? DEFAULT_CONFIG;
  const [steps, setSteps] = useState<WorkflowStep[]>(config.workflow);
  const [name, setName] = useState('');
  async function save() {
    await append('v1.ProjectConfigChanged', { config: { ...config, workflow: steps } }, state?.config?.eventId);
    ctx.back();
  }
  return (
    <Screen footer={<Footer label="Save flow" onPress={() => void save()} disabled={steps.length === 0} />}>
      <Header title="Edit stages" onBack={ctx.back} />
      {steps.map((s, i) => (
        <Card key={s.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Badge label={`${i + 1}`} />
            <Text style={[text.h4, { flex: 1 }]}>{s.id}</Text>
            <Pressable onPress={() => setSteps(steps.filter((_, j) => j !== i))} hitSlop={8} accessibilityLabel="Remove stage">
              <Trash2 size={18} color={colors.reference} />
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {RULES.map((r) => (
              <Pressable key={r} onPress={() => setSteps(steps.map((x, j) => (j === i ? { ...x, rule: r } : x)))} style={[styles.opt, s.rule === r && { backgroundColor: colors.translate }]}>
                <Text style={[text.small, s.rule === r && { color: colors.white }]}>{r}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => setSteps(steps.map((x, j) => (j === i ? { ...x, required: !x.required } : x)))} style={[styles.opt, s.required && { backgroundColor: colors.review }]}>
              <Text style={[text.small, s.required && { color: colors.white }]}>required</Text>
            </Pressable>
          </View>
        </Card>
      ))}
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
        <TextInput style={[styles.input, { flex: 1 }]} placeholder="New stage id" autoCapitalize="none" value={name} onChangeText={setName} />
        <Pressable
          onPress={() => {
            if (!name.trim()) return;
            setSteps([...steps, { id: name.trim(), role: 'reviewer', required: true, rule: 'any' }]);
            setName('');
          }}
          accessibilityLabel="Add stage"
        >
          <Plus size={24} color={colors.translate} />
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = {
  opt: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: 8, backgroundColor: colors.muted },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, backgroundColor: colors.card, color: colors.foreground }
};
