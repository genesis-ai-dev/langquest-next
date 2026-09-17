// Avatar P. Roles, content templates, reference library, key terms, review flows.
import type { Privilege, QuorumRule, Role, WorkflowStep } from '@langquest-next/core';
import { PRIVILEGES, CATALOG_VERSION, contentTemplates, deriveWorkflow, FLOW_TEMPLATES, instantiateFlow, instantiateQuestionSet, instantiateTemplate, keyTermsFor, keyTermsForUnit, keyTermView, materialsFor, QUESTION_TEMPLATES, questionSetMaterialId, REFERENCE_KINDS, takesLinkingTerm, templateStepId } from '@langquest-next/core';
import { Check, FileText, KeyRound, Plus, Trash2 } from 'lucide-react-native';
import * as Crypto from 'expo-crypto';
import { useState } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import type { Ctx } from '../ctx';
import { Badge, Footer, Header, Note, Row, Screen, Section } from '../pui';
import { colors, space } from '../theme';
import { Card, text } from '../ui';
import { SourceBibleSettings } from '../sourceBibleSettings';

export function RolesHome(ctx: Ctx) {
  const roles = Object.entries(ctx.org.state?.roles ?? {}).filter(([, r]) => !r.retired);
  return (
    <Screen footer={ctx.session.can('manage_roles')
      ? <Footer label="New role" onPress={() => ctx.go('role_editor', { roleId: 'new' })} /> : undefined}>
      <Header title="Roles" onBack={ctx.back} />
      <Section label="Defined at organization">
        {roles.map(([id, role]) => <Row key={id} label={role.name.value}
          sub={`${role.privileges.value.length} privileges`}
          onPress={() => ctx.go('role_editor', { roleId: id })} />)}
      </Section>
    </Screen>
  );
}

export function RoleEditor(ctx: Ctx) {
  const requested = ctx.params['roleId'] ?? 'new';
  const [newId] = useState(() => `role-${Crypto.randomUUID()}`);
  const roleId = requested === 'new' ? newId : requested;
  const existing = ctx.org.state?.roles[roleId];
  const [name, setName] = useState<string | null>(null);
  const [selected, setSelected] = useState<Privilege[] | null>(null);
  const privileges = selected ?? existing?.privileges.value ?? [];
  const label = name ?? existing?.name.value ?? '';
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const allowed = ctx.session.can('manage_roles');
  async function save() {
    if (!allowed) return;
    setBusy(true);
    try {
      await ctx.org.append('v1.RoleDefined', { roleId, name: label.trim(), privileges });
      ctx.back();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <Screen footer={allowed ? <Footer label="Save role" onPress={() => void save()}
      disabled={busy || !label.trim() || privileges.length === 0} /> : undefined}>
      <Header title={existing ? 'Edit role' : 'New role'} onBack={ctx.back} />
      <TextInput accessibilityLabel="Role name" placeholder="Role name" value={label}
        onChangeText={setName} editable={allowed} maxLength={100}
        style={{ padding: space.md, backgroundColor: colors.card }} />
      <Section label="Permissions">
        {PRIVILEGES.map((privilege) => <Row key={privilege}
          label={privilege.replaceAll('_', ' ')}
          right={<Switch accessibilityLabel={privilege.replaceAll('_', ' ')}
            disabled={!allowed || busy} value={privileges.includes(privilege)}
            onValueChange={(on) => setSelected(on ? [...privileges, privilege]
              : privileges.filter((p) => p !== privilege))} />} />)}
      </Section>
      {error ? <Note>{error}</Note> : null}
    </Screen>
  );
}

/** UX spec A42 at language level: exactly one content template per lane, from the catalog. Selecting instantiates the units (audit 5.D). */
export function TemplatesHome(ctx: Ctx) {
  const { state, appendMany } = ctx.project;
  const laneId = ctx.params['laneId'] ?? Object.keys(state?.lanes ?? {})[0] ?? '';
  const selected = state?.laneTemplates[laneId]?.value;
  const canManage = ctx.session.can('manage_templates') && !!laneId;
  const [busy, setBusy] = useState('');
  async function select(templateId: string) {
    if (!state || busy) return;
    setBusy(templateId);
    try {
      // Units the fold already has are skipped: the ids are deterministic, so
      // re-selecting (or a second admin selecting) adds nothing twice.
      const units = instantiateTemplate(templateId).filter((u) => !state.units[u.unitId]);
      await appendMany([
        { type: 'v1.LaneTemplateSelected' as const, payload: { laneId, templateId, catalogVersion: CATALOG_VERSION } },
        ...units.map((payload) => ({ type: 'v1.UnitAdded' as const, payload }))
      ]);
    } finally {
      setBusy('');
    }
  }
  return (
    <Screen>
      <Header title="Content templates" sub={state?.lanes[laneId]?.languoidId} onBack={ctx.back} />
      <Note>{selected ? `This language uses ${contentTemplates().find((t) => t.id === selected.templateId)?.name ?? selected.templateId} (catalog ${selected.catalogVersion}).` : 'No template selected for this language yet.'}</Note>
      <Section label="Catalog">
        {contentTemplates().map((t, i, a) => {
          const leaves = t.items.filter((it) => t.unitKinds.find((k) => k.id === it.kind)?.childKinds.length === 0).length;
          const on = selected?.templateId === t.id;
          return (
            <Row
              key={t.id}
              icon={FileText}
              label={t.name}
              sub={`${t.unitKinds.map((k) => k.label).join(' › ')} · ${leaves} units${busy === t.id ? ' · applying…' : ''}`}
              onPress={canManage && !on ? () => void select(t.id) : undefined}
              right={on ? <Check size={18} color={colors.done} /> : undefined}
              last={i === a.length - 1}
            />
          );
        })}
      </Section>
    </Screen>
  );
}

/** UX spec reference_home: general material by scope, stage-tied question sets, template-linked study material, and the key terms lists. */
export function ReferenceHome(ctx: Ctx) {
  const { state, appendMany } = ctx.project;
  const laneId = ctx.params['laneId'] ?? Object.keys(state?.lanes ?? {})[0] ?? '';
  const canManage = ctx.session.can('manage_reference');
  const all = state ? materialsFor(state, laneId ? { laneId } : {}) : [];
  const stageTied = all.filter((m) => m.scope.stepId !== undefined || (m.kind === 'questions' && m.templateRef));
  const general = all.filter((m) => !stageTied.includes(m) && m.kind !== 'questions');
  const written = all.filter((m) => !stageTied.includes(m) && m.kind === 'questions');
  const legacy = Object.entries(state?.references ?? {});
  const missingSets = QUESTION_TEMPLATES.filter((q) => !state?.materials[questionSetMaterialId(q.id)]);
  const kindName = (k: string) => REFERENCE_KINDS.find((r) => r.id === k)?.name ?? k;
  const row = (m: (typeof all)[number], i: number, a: unknown[]) => (
    <Row key={m.materialId} icon={FileText} label={m.title} sub={`${kindName(m.kind)}${m.blanks ? ` · ${m.blanks} blanks` : ''}${m.locked ? ' · locked' : ''}`} onPress={() => ctx.go('material_editor', { materialId: m.materialId, laneId })} last={i === a.length - 1} />
  );
  return (
    <Screen footer={canManage ? <Footer label="Add material" onPress={() => ctx.go('material_editor', { laneId })} /> : undefined}>
      <Header title="Reference library" sub={state?.lanes[laneId]?.languoidId} onBack={ctx.back} />
      <SourceBibleSettings ctx={ctx} />
      <Section label={`Key terms · ${state ? keyTermsFor(state, laneId).length : 0}`}>
        <Row icon={KeyRound} label="Key terms list" sub="Living glossary for this language" onPress={() => ctx.go('key_terms', { laneId })} last />
      </Section>
      <Section label={`General · ${general.length}`}>
        {general.map(row)}
        {general.length === 0 ? <Row label="None yet" last /> : null}
      </Section>
      <Section label={`Review question sets · ${stageTied.length + written.length}`}>
        {[...stageTied, ...written].map(row)}
        {canManage
          ? missingSets.map((q, i) => (
              <Row key={q.id} icon={Plus} label={`Add ${q.name} from the catalog`} onPress={() => void appendMany(instantiateQuestionSet(q.id, laneId) as never)} last={i === missingSets.length - 1} />
            ))
          : null}
      </Section>
      {legacy.length > 0 ? (
        <Section label={`Passage notes · ${legacy.length}`}>
          {legacy.map(([id, r], i) => (
            <Row key={id} label={r.text?.split('\n')[0] ?? id} sub={`${r.kind} · ${state?.units[r.unitId]?.label ?? r.unitId}`} last={i === legacy.length - 1} />
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}

/** Living glossary. From translation work (unitId param) the shortlist for that passage comes first. */
export function KeyTerms(ctx: Ctx) {
  const { state, append } = ctx.project;
  const unitId = ctx.params['unitId'];
  const takeId = ctx.params['takeId'];
  const laneId = ctx.params['laneId'] ?? Object.keys(state?.lanes ?? {})[0] ?? '';
  const all = state ? keyTermsFor(state, laneId) : [];
  const here = state && unitId ? keyTermsForUnit(state, laneId, unitId) : [];
  const other = all.filter((t) => !here.includes(t));
  const [adding, setAdding] = useState(false);
  const [term, setTerm] = useState('');
  const [gloss, setGloss] = useState('');
  const canAdd = ctx.session.can('fill_reference') || ctx.session.can('manage_reference');
  async function add() {
    const book = unitId ? state?.units[unitId]?.parentUnitId ?? unitId : undefined;
    await append('v1.KeyTermDefined', { termId: `kt-${Date.now()}`, laneId, term: term.trim(), gloss: gloss.trim(), unitScope: book ? [book] : [] });
    setTerm('');
    setGloss('');
    setAdding(false);
  }
  const rows = (items: typeof all) =>
    items.map((t, i) => (
      <Row key={t.termId} icon={KeyRound} label={t.term} sub={`${t.gloss}${t.renderings[0] ? ` · ${t.renderings[0].rendering}` : ''}`} onPress={() => ctx.go('key_term_detail', { termId: t.termId, ...(takeId ? { takeId } : {}), ...(unitId ? { unitId } : {}) })} last={i === items.length - 1} />
    ));
  return (
    <Screen footer={canAdd ? <Footer label={adding ? 'Save term' : 'Add term'} onPress={() => (adding ? void add() : setAdding(true))} disabled={adding && !term.trim()} /> : undefined}>
      <Header title="Key terms" sub={state?.lanes[laneId]?.languoidId} onBack={ctx.back} />
      {adding ? (
        <Card>
          <TextInput style={styles.input} placeholder="Source term, e.g. Word (Logos)" value={term} onChangeText={setTerm} />
          <TextInput style={styles.input} placeholder="Brief meaning" value={gloss} onChangeText={setGloss} />
        </Card>
      ) : null}
      {unitId ? <Section label={`For this passage · ${here.length}`}>{here.length ? rows(here) : <Row label="None" last />}</Section> : null}
      <Section label={`${unitId ? 'Other terms' : 'All terms'} · ${other.length}`}>{other.length ? rows(other) : <Row label="None" last />}</Section>
    </Screen>
  );
}

/** Renderings, recorded adjustments, and linked translations; adjust or tie the term to the translation in progress. */
export function KeyTermDetail(ctx: Ctx) {
  const { state, append } = ctx.project;
  const termId = ctx.params['termId'] ?? '';
  const takeId = ctx.params['takeId'];
  const t = state ? keyTermView(state, termId) : null;
  const [note, setNote] = useState('');
  const [rendering, setRendering] = useState('');
  const [context, setContext] = useState('');
  if (!state || !t) return <Note>Term not found.</Note>;
  const linked = takesLinkingTerm(state, termId);
  const isLinked = !!takeId && !!state.keyTermLinks[takeId]?.[termId];
  const canEdit = ctx.session.can('fill_reference') || ctx.session.can('manage_reference');
  async function adjust() {
    const adjustmentId = `adj-${Date.now()}`;
    await append('v1.KeyTermAdjusted', { termId, adjustmentId, note: note.trim(), ...(takeId ? { duringTakeId: takeId } : {}) });
    if (takeId && !isLinked) await append('v1.KeyTermLinked', { takeId, termId, adjustmentId });
    setNote('');
  }
  async function addRendering() {
    await append('v1.KeyTermRenderingAdded', { termId, renderingId: `r-${Date.now()}`, rendering: rendering.trim(), context: context.trim() });
    setRendering('');
    setContext('');
  }
  return (
    <Screen footer={takeId && !isLinked ? <Footer label="Tie to this translation" onPress={() => void append('v1.KeyTermLinked', { takeId, termId })} /> : undefined}>
      <Header title={t.term} sub={t.gloss} onBack={ctx.back} />
      {isLinked ? <Note>Tied to the translation in progress.</Note> : null}
      <Section label={`Renderings · ${t.renderings.length}`}>
        {t.renderings.map((r, i) => (
          <Row key={r.renderingId} label={r.rendering} sub={r.context} last={i === t.renderings.length - 1 && !canEdit} />
        ))}
        {canEdit ? (
          <Card>
            <TextInput style={styles.input} placeholder="Rendering" value={rendering} onChangeText={setRendering} />
            <TextInput style={styles.input} placeholder="When to use it and why" value={context} onChangeText={setContext} />
            <Pressable onPress={() => void addRendering()} disabled={!rendering.trim()} accessibilityLabel="Add rendering">
              <Plus size={22} color={colors.translate} />
            </Pressable>
          </Card>
        ) : null}
      </Section>
      <Section label={`Adjustments · ${t.adjustments.length}`}>
        {t.adjustments.map((a, i) => (
          <Row key={a.adjustmentId} label={a.note} sub={`${a.actorId.slice(0, 8)}${a.duringTakeId ? ` · during ${state.units[state.takes[a.duringTakeId]?.unitId ?? '']?.label ?? 'a translation'}` : ''}${a.blobHash ? ' · audio' : ''}`} last={i === t.adjustments.length - 1 && !canEdit} />
        ))}
        {canEdit ? (
          <Card>
            <TextInput style={styles.input} placeholder="What changed and why" value={note} onChangeText={setNote} multiline />
            <Pressable onPress={() => void adjust()} disabled={!note.trim()} accessibilityLabel="Record adjustment">
              <Plus size={22} color={colors.translate} />
            </Pressable>
          </Card>
        ) : null}
      </Section>
      <Section label={`Linked translations · ${linked.length}`}>
        {linked.map((l, i) => {
          const take = state.takes[l.takeId];
          return <Row key={l.takeId} label={state.units[take?.unitId ?? '']?.label ?? l.takeId} sub={l.note} onPress={take ? () => ctx.go('piece_version', { takeId: l.takeId, laneId: take.laneId, unitId: take.unitId }) : undefined} last={i === linked.length - 1} />;
        })}
        {linked.length === 0 ? <Row label="None yet" last /> : null}
      </Section>
    </Screen>
  );
}

/** UX spec A42 at language level: exactly one review flow per lane. Selecting writes one register per step (audit 5.F). */
export function FlowsHome(ctx: Ctx) {
  const { state, appendMany } = ctx.project;
  const laneId = ctx.params['laneId'] ?? Object.keys(state?.lanes ?? {})[0] ?? '';
  const selected = state?.laneFlows[laneId]?.value;
  const steps = state ? deriveWorkflow(state, laneId) : [];
  const canManage = ctx.session.can('manage_flows') && !!laneId;
  async function select(flowId: string) {
    if (!state) return;
    // Steps of a previously selected flow are removed; hand-edited steps stay.
    const removals = selected
      ? steps.filter((s) => s.id.startsWith(`${selected.flowId}@`)).map((s) => ({ type: 'v1.WorkflowStepRemoved' as const, payload: { stepId: s.id } }))
      : [];
    await appendMany([
      { type: 'v1.LaneFlowSelected' as const, payload: { laneId, flowId, catalogVersion: CATALOG_VERSION } },
      ...removals,
      ...instantiateFlow(flowId, laneId).map((payload) => ({ type: 'v1.WorkflowStepSet' as const, payload }))
    ]);
  }
  return (
    <Screen footer={canManage ? <Footer label="Edit stages" onPress={() => ctx.go('flow_editor', { laneId })} /> : undefined}>
      <Header title="Review flows" sub={state?.lanes[laneId]?.languoidId} onBack={ctx.back} />
      <Section label="Catalog">
        {FLOW_TEMPLATES.map((f, i, a) => {
          const on = selected?.flowId === f.id;
          return (
            <Row
              key={f.id}
              label={f.name}
              sub={f.stages.map((st) => st.label).join(' → ')}
              onPress={canManage && !on ? () => void select(f.id) : undefined}
              right={on ? <Check size={18} color={colors.done} /> : undefined}
              last={i === a.length - 1}
            />
          );
        })}
      </Section>
      <Section label="Applied stages">
        {steps.map((s, i) => (
          <Row key={s.id} label={s.label ?? s.id} sub={`${s.teamId ? `team ${state?.teams[s.teamId]?.name.value ?? s.teamId}` : s.role} · ${s.rule}${s.required ? ' · required' : ' · optional'}`} badge={`${i + 1}`} last={i === steps.length - 1} />
        ))}
        {steps.length === 0 ? <Row label="No stages" last /> : null}
      </Section>
    </Screen>
  );
}

const RULES: QuorumRule[] = ['any', 'majority', 'unanimous'];

/** Edits are one register per step, so two admins editing offline merge per step instead of clobbering a document. */
export function FlowEditor(ctx: Ctx) {
  const { state, appendMany } = ctx.project;
  const laneId = ctx.params['laneId'] ?? Object.keys(state?.lanes ?? {})[0] ?? '';
  const initial = state ? deriveWorkflow(state, laneId) : [];
  const [steps, setSteps] = useState<WorkflowStep[]>(initial);
  const [name, setName] = useState('');
  async function save() {
    const after = new Map(steps.map((s) => [s.id, s]));
    const removed = initial.filter((s) => !after.has(s.id)).map((s) => ({ type: 'v1.WorkflowStepRemoved' as const, payload: { stepId: s.id } }));
    const changed = steps
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => {
        const before = initial[i];
        return !before || before.id !== s.id || before.rule !== s.rule || before.required !== s.required || before.teamId !== s.teamId || !state?.workflowSteps[s.id];
      })
      .map(({ s, i }) => ({
        type: 'v1.WorkflowStepSet' as const,
        payload: {
          stepId: s.id, laneId, order: `s${String(i).padStart(2, '0')}`, role: s.role, required: s.required, rule: s.rule,
          ...(s.label !== undefined ? { label: s.label } : {}), ...(s.teamId !== undefined ? { teamId: s.teamId } : {})
        }
      }));
    await appendMany([...removed, ...changed]);
    ctx.back();
  }
  return (
    <Screen footer={<Footer label="Save flow" onPress={() => void save()} disabled={steps.length === 0} />}>
      <Header title="Edit stages" sub={state?.lanes[laneId]?.languoidId} onBack={ctx.back} />
      {steps.map((s, i) => (
        <Card key={s.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Badge label={`${i + 1}`} />
            <Text style={[text.h4, { flex: 1 }]}>{s.label ?? s.id}</Text>
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
        <TextInput style={[styles.input, { flex: 1 }]} placeholder="New stage name" value={name} onChangeText={setName} />
        <Pressable
          onPress={() => {
            if (!name.trim()) return;
            const stageId = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
            setSteps([...steps, { id: templateStepId('custom', CATALOG_VERSION, `${laneId}_${stageId}`), label: name.trim(), role: 'reviewer', required: true, rule: 'any' }]);
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

import { contractsFor } from '../screenContracts';
export const contracts = contractsFor('roles_home', 'role_editor', 'templates_home', 'reference_home', 'key_terms', 'key_term_detail', 'flows_home', 'flow_editor');
