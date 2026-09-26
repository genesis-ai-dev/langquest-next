// Avatar P. Roles, content templates, reference library, key terms, review flows.
import type { Privilege, ProjectState, QuorumRule, WorkflowStep } from '@langquest-next/core';
import { PRIVILEGES, CATALOG_VERSION, contentTemplates, deriveWorkflow, FLOW_TEMPLATES, instantiateFlow, instantiateQuestionSet, instantiateTemplate, keyTermsFor, keyTermsForUnit, keyTermView, materialsFor, QUESTION_TEMPLATES, questionSetMaterialId, REFERENCE_KINDS, takesLinkingTerm, templateStepId } from '@langquest-next/core';
import { Check, ChevronDown, ChevronRight, FileText, KeyRound, Link2, Lock, Plus, Search, Trash2, Workflow } from 'lucide-react-native';
import * as Crypto from 'expo-crypto';
import { useState } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import type { Ctx } from '../ctx';
import { Badge, Footer, Header, Note, Row, Screen, Section } from '../pui';
import { colors, space } from '../theme';
import { Card, text } from '../ui';
import { Byline } from '../UserChip';
import { SourceBibleSettings } from '../sourceBibleSettings';
import { FiaReferenceSetup } from '../fia';

/** Reference PRIVILEGE_DESC, trimmed where a clause names something this app cannot do yet. */
const PRIVILEGE_TEXT: Record<Privilege, { label: string; desc: string }> = {
  manage_structure: { label: 'Manage Org Structure', desc: 'Change org structures in their scope (projects, languages)' },
  invite_members: { label: 'Invite Members', desc: 'Invite people in their scope' },
  manage_roles: { label: 'Manage Roles', desc: 'Create and edit roles in their scope' },
  manage_templates: { label: 'Manage Content Templates', desc: 'Make and edit content templates in their scope' },
  manage_reference: { label: 'Manage Reference Material', desc: 'Make and edit reference material in their scope' },
  manage_flows: { label: 'Manage Review Flows', desc: 'Make review flows and apply flows to languages' },
  manage_teams: { label: 'Manage Review Teams', desc: 'Make and edit review teams (groups) in their scope' },
  assign_work: { label: 'Assign Work', desc: 'Ask anyone in their scope to record or review a passage' },
  translate: { label: 'Translate', desc: 'Record and revise translations (turn off to keep, say, consultants from drafting)' },
  fill_reference: { label: 'Fill Reference Content', desc: 'Add key terms, notes, and reference content' },
  send_to_reviewers: { label: 'Ask for Reviews', desc: 'Ask teammates to review' },
  review: { label: 'Review', desc: 'Give reviews' },
  view_status: { label: 'View Status', desc: 'See the map and passage records read-only in their scope' }
};

export function privilegeLabel(p: Privilege): string {
  return PRIVILEGE_TEXT[p]?.label ?? p;
}

/** Active memberships holding a role, org-wide. */
function holdersOf(ctx: Ctx, roleId: string) {
  const out: { profileId: string; scopeKey: string }[] = [];
  for (const [profileId, scopes] of Object.entries(ctx.org.state?.members ?? {})) {
    for (const [scopeKey, m] of Object.entries(scopes)) {
      if (m.removed.value === false && m.roleId.value === roleId) out.push({ profileId, scopeKey });
    }
  }
  return out;
}

/**
 * Every role reads as defined at the organization: where a role is defined
 * (and its description) waits for a fact that stores it (Phase 2).
 */
export function RolesHome(ctx: Ctx) {
  const roles = Object.entries(ctx.org.state?.roles ?? {}).filter(([, r]) => !r.retired);
  const canManage = ctx.session.can('manage_roles');
  return (
    <Screen footer={canManage ? <Footer label="New role" onPress={() => ctx.go('role_editor', { roleId: 'new' })} /> : undefined}>
      <Header title="Roles" onBack={ctx.back} />
      <Note>{`Roles are privilege sets without a fixed scope. Scope is chosen when assigning a role to a member.${canManage ? ' Roles created here can be assigned at any level.' : ' View only.'}`}</Note>
      <Section label={`Defined at Organization · ${roles.length}`}>
        {roles.length === 0 ? <Row label="No roles yet" last /> : null}
        {roles.map(([id, role], i) => {
          const members = new Set(holdersOf(ctx, id).map((h) => h.profileId)).size;
          const n = role.privileges.value.length;
          return <Row key={id} label={role.name.value || id}
            sub={`${members} member${members === 1 ? '' : 's'} · ${n} privilege${n === 1 ? '' : 's'}`}
            onPress={() => ctx.go('role_editor', { roleId: id })} last={i === roles.length - 1} />;
        })}
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
  const holders = existing ? holdersOf(ctx, roleId) : [];
  // role_editor→edit_member is gated on Assign Work (flow.ts); changing a member also needs Invite Members.
  const canOpenMember = ctx.session.can('assign_work') && ctx.session.can('invite_members');
  async function save() {
    if (!allowed) return;
    setBusy(true);
    try {
      await ctx.org.append('v1.RoleDefined', { roleId, name: label.trim(), privileges });
      ctx.toast(`${label.trim()} role ${existing ? 'saved' : 'created'}`);
      ctx.back();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <Screen footer={allowed ? <Footer label={existing ? 'Save role' : 'Create role'} onPress={() => void save()}
      // A role with no privilege is refused here; the reference allows placeholder roles.
      disabled={busy || !label.trim() || privileges.length === 0} /> : undefined}>
      <Header title={label || (existing ? 'Role' : 'New role')} sub={`${existing ? 'Role' : 'New role'} · Organization`} onBack={ctx.back} />
      {!allowed ? <Note>View only — you do not have permission to edit this role.</Note> : null}
      <TextInput accessibilityLabel="Role name" placeholder="Role name" value={label}
        onChangeText={setName} editable={allowed} maxLength={100} style={styles.input} />
      {existing ? (
        <Section label={`Members with this role · ${holders.length}`}>
          {holders.length === 0 ? <Row label="Nobody holds this role yet" last /> : null}
          {holders.map((h, i) => (
            <Row key={`${h.profileId}:${h.scopeKey}`} personId={h.profileId}
              onPress={canOpenMember ? () => ctx.go('edit_member', { memberId: h.profileId, scopeKey: h.scopeKey }) : undefined}
              last={i === holders.length - 1} />
          ))}
        </Section>
      ) : null}
      <Note>Scope is not set here — choose organization, project, or language when inviting or editing a member.</Note>
      <Section label="Permissions">
        {PRIVILEGES.map((privilege, i) => <Row key={privilege}
          label={PRIVILEGE_TEXT[privilege].label} sub={PRIVILEGE_TEXT[privilege].desc}
          right={<Switch accessibilityLabel={PRIVILEGE_TEXT[privilege].label}
            disabled={!allowed || busy} value={privileges.includes(privilege)}
            onValueChange={(on) => setSelected(on ? [...privileges, privilege]
              : privileges.filter((p) => p !== privilege))} />} last={i === PRIVILEGES.length - 1} />)}
      </Section>
      {error ? <Note>{error}</Note> : null}
    </Screen>
  );
}

/** Lanes this catalog view covers: one lane, or every lane of the open project (the only one folded here). */
function viewLanes(ctx: Ctx): { laneId: string | null; lanes: string[]; level: string } {
  const state = ctx.project.state;
  const level = ctx.params['level'];
  if (level === 'org' || level === 'project') return { laneId: null, lanes: Object.keys(state?.lanes ?? {}), level };
  const laneId = ctx.params['laneId'] ?? Object.keys(state?.lanes ?? {})[0] ?? '';
  return { laneId, lanes: laneId ? [laneId] : [], level: 'lane' };
}

function langNames(state: ProjectState | null, lanes: string[]): string {
  return lanes.map((l) => state?.lanes[l]?.languoidId ?? l).join(', ');
}

/** "Use" / "In use": the state reads as a word and a check, never colour alone. */
function UsePill(props: { on: boolean; busy?: boolean; onPress?: () => void; label: string }) {
  if (props.on) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} accessibilityLabel={`${props.label} in use`}>
        <Check size={16} color={colors.done} />
        <Text style={[text.small, { color: colors.done, fontWeight: '600' }]}>In use</Text>
      </View>
    );
  }
  if (!props.onPress) return <View />;
  return (
    <Pressable onPress={props.onPress} disabled={props.busy} accessibilityRole="button" accessibilityLabel={`Use ${props.label}`} hitSlop={8}
      style={{ paddingHorizontal: space.md, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border }}>
      <Text style={[text.small, { color: colors.foreground, fontWeight: '600' }]}>{props.busy ? '…' : 'Use'}</Text>
    </Pressable>
  );
}

/**
 * UX spec A42 / J-CFG-1: exactly one content template per language. At the
 * language level Use applies it (with Undo, which re-selects the previous
 * one); at org or project level the view says who uses what.
 */
export function TemplatesHome(ctx: Ctx) {
  const { state, appendMany } = ctx.project;
  const { laneId, lanes, level } = viewLanes(ctx);
  const selected = laneId ? state?.laneTemplates[laneId]?.value : undefined;
  const canManage = ctx.session.can('manage_templates') && !!laneId;
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(false);
  async function select(templateId: string) {
    if (!state || busy || !laneId) return;
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
  function use(templateId: string, name: string) {
    const previous = selected;
    void select(templateId).then(() => ctx.toast(`${state?.lanes[laneId!]?.languoidId ?? 'This language'} now uses ${name}`, previous ? () => {
      void appendMany([{ type: 'v1.LaneTemplateSelected' as const, payload: { laneId: laneId!, templateId: previous.templateId, catalogVersion: previous.catalogVersion } }])
        .then(() => ctx.toast('Undone — the previous template is back'));
    } : undefined));
  }
  const scopeName = level === 'org' ? 'organization' : 'project';
  return (
    <Screen>
      <Header title="Content templates" sub={laneId ? state?.lanes[laneId]?.languoidId : `${level === 'org' ? 'Organization' : 'Project'} · ${lanes.length} language${lanes.length === 1 ? '' : 's'}`} onBack={ctx.back} />
      <Note>{laneId
        ? 'Templates divide Scripture into passages. Choose the one this language records against. Passages from an earlier template stay.'
        : `Templates divide Scripture into passages. Each language applies exactly one — this view covers the ${lanes.length} language${lanes.length === 1 ? '' : 's'} in this ${scopeName}${level === 'org' ? ' that are open on this device' : ''}. Apply one from a language's home.`}</Note>
      <Section label="Catalog">
        {contentTemplates().map((t, i, a) => {
          const users = lanes.filter((l) => state?.laneTemplates[l]?.value.templateId === t.id);
          return (
            <Row key={t.id} icon={FileText} label={t.name}
              sub={laneId ? t.description : users.length ? `Used by ${langNames(state, users)}` : 'Not used in this view'}
              right={laneId ? <UsePill label={t.name} on={selected?.templateId === t.id} busy={busy === t.id}
                onPress={canManage ? () => use(t.id, t.name) : undefined} /> : <View />}
              last={i === a.length - 1} />
          );
        })}
      </Section>
      {!laneId && lanes.length ? (
        <>
          <Row icon={open ? ChevronDown : ChevronRight} label="By language" onPress={() => setOpen(!open)} right={<View />} last />
          {open ? <Section label="By language">
            {lanes.map((l, i) => <Row key={l} label={state?.lanes[l]?.languoidId ?? l}
              sub={contentTemplates().find((t) => t.id === state?.laneTemplates[l]?.value.templateId)?.name ?? 'Not chosen yet'} last={i === lanes.length - 1} />)}
          </Section> : null}
        </>
      ) : null}
    </Screen>
  );
}

/**
 * Reference material, key terms and review questions. Material is homed on a
 * language today (MaterialScope has lane, unit, step); org and project views
 * list what their open languages hold until material can live higher (Phase 2).
 */
export function ReferenceHome(ctx: Ctx) {
  const { state, appendMany } = ctx.project;
  const { laneId, lanes } = viewLanes(ctx);
  const canManage = ctx.session.can('manage_reference');
  const all = state ? (laneId ? materialsFor(state, { laneId }) : materialsFor(state, {}))
    .filter(m => m.kind !== 'fia_progress') : [];
  const study = all.filter((m) => m.kind === 'fia_study');
  const questions = all.filter((m) => m.kind === 'questions');
  const general = all.filter((m) => m.kind !== 'questions' && m.kind !== 'fia_study');
  const legacy = Object.entries(state?.references ?? {});
  const missingSets = laneId ? QUESTION_TEMPLATES.filter((q) => !state?.materials[questionSetMaterialId(q.id)]) : [];
  const kindName = (k: string) => REFERENCE_KINDS.find((r) => r.id === k)?.name ?? k;
  const terms = state ? lanes.reduce((n, l) => n + keyTermsFor(state, l).length, 0) : 0;
  const row = (m: (typeof all)[number], i: number, a: unknown[]) => (
    <Row key={m.materialId} icon={FileText} label={m.title}
      sub={`${kindName(m.kind)}${m.blanks ? ` · ${m.blanks} unfilled blanks` : ''}${m.scope.laneId && !laneId ? ` · ${state?.lanes[m.scope.laneId]?.languoidId ?? m.scope.laneId}` : ''}`}
      right={m.locked ? <Lock size={16} color={colors.mutedForeground} accessibilityLabel="Locked" /> : undefined}
      onPress={() => ctx.go('material_editor', { materialId: m.materialId, laneId: m.scope.laneId ?? laneId ?? '' })} last={i === a.length - 1} />
  );
  return (
    <Screen footer={canManage && laneId ? <Footer label="Add material" onPress={() => ctx.go('material_editor', { laneId })} /> : undefined}>
      <Header title="Reference material" sub={laneId ? state?.lanes[laneId]?.languoidId : `${ctx.params['level'] === 'org' ? 'Organization' : 'Project'} · ${lanes.length} language${lanes.length === 1 ? '' : 's'}`} onBack={ctx.back} />
      <Note>Translators see reference material in the workspace; reviewers see the questions for their review.</Note>
      {laneId ? <SourceBibleSettings ctx={ctx} /> : null}
      {laneId ? <FiaReferenceSetup ctx={ctx} laneId={laneId} /> : null}
      {laneId ? (
        <Section label="Key terms">
          <Row icon={KeyRound} label="Key terms" sub={`${terms} term${terms === 1 ? '' : 's'} · a rendering per language`} onPress={() => ctx.go('key_terms', { laneId })} last />
        </Section>
      ) : null}
      <Section label={`Study material · ${study.length}`}>
        {study.map(row)}
        {study.length === 0 ? <Row label="No study material for this view." last /> : null}
      </Section>
      <Section label={`Review questions · ${questions.length}`}>
        {questions.map(row)}
        {canManage
          ? missingSets.map((q, i) => (
              <Row key={q.id} icon={Plus} label={`Add ${q.name} from the catalog`} onPress={() => void appendMany(instantiateQuestionSet(q.id, laneId!) as never)} last={i === missingSets.length - 1} />
            ))
          : null}
        {questions.length === 0 && missingSets.length === 0 ? <Row label="No review questions for this view." last /> : null}
      </Section>
      <Section label={`General · ${general.length}`}>
        {general.map(row)}
        {general.length === 0 ? <Row label="No general materials yet." last /> : null}
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

/** Where a term came from: the automatic BSB list, FIA, or this project. */
function termSource(termId: string): string {
  if (termId.startsWith('bsb-terms@')) return 'BSB';
  if (termId.startsWith('fia')) return 'FIA';
  return 'Project';
}

/** Living glossary. From translation work (unitId param) the shortlist for that passage comes first. */
export function KeyTerms(ctx: Ctx) {
  const { state, appendMany } = ctx.project;
  const unitId = ctx.params['unitId'];
  const takeId = ctx.params['takeId'];
  const laneId = ctx.params['laneId'] ?? Object.keys(state?.lanes ?? {})[0] ?? '';
  const lang = state?.lanes[laneId]?.languoidId ?? laneId;
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const match = (t: { term: string; gloss: string; renderings: { rendering: string }[] }) =>
    !q || `${t.term} ${t.gloss} ${t.renderings.map((r) => r.rendering).join(' ')}`.toLowerCase().includes(q);
  const all = state ? keyTermsFor(state, laneId).filter(match) : [];
  const here = state && unitId ? keyTermsForUnit(state, laneId, unitId).filter(match) : [];
  const other = all.filter((t) => !here.includes(t));
  const [adding, setAdding] = useState(false);
  const [term, setTerm] = useState('');
  const [gloss, setGloss] = useState('');
  const [rendering, setRendering] = useState('');
  const [context, setContext] = useState('');
  const [error, setError] = useState('');
  const canAdd = ctx.session.can('fill_reference') || ctx.session.can('manage_reference');
  async function add() {
    const book = unitId ? state?.units[unitId]?.parentUnitId ?? unitId : undefined;
    const termId = `kt-${Crypto.randomUUID()}`;
    setError('');
    try {
      await appendMany([
        { type: 'v1.KeyTermDefined', payload: { termId, laneId, term: term.trim(), gloss: gloss.trim(), unitScope: book ? [book] : [] } },
        { type: 'v1.KeyTermRenderingAdded', payload: { termId, renderingId: `r-${Crypto.randomUUID()}`, rendering: rendering.trim(), context: context.trim() } },
        { type: 'v1.KeyTermAdjusted', payload: { termId, adjustmentId: `adj-${Crypto.randomUUID()}`, note: `Added with rendering “${rendering.trim()}”` } }
      ]);
      ctx.toast(`${term.trim()} added`);
      setTerm(''); setGloss(''); setRendering(''); setContext('');
      setAdding(false);
    } catch (e) { setError((e as Error).message); }
  }
  const rows = (items: typeof all) =>
    items.map((t, i) => (
      <Row key={t.termId} icon={KeyRound} label={t.term}
        sub={`${termSource(t.termId)}${t.gloss ? ` · ${t.gloss}` : ''} · ${t.renderings.at(-1)?.rendering ?? `No ${lang} rendering yet`}`}
        onPress={() => ctx.go('key_term_detail', { termId: t.termId, ...(takeId ? { takeId } : {}), ...(unitId ? { unitId } : {}) })} last={i === items.length - 1} />
    ));
  return (
    <Screen footer={canAdd ? <Footer label={adding ? 'Add term' : 'New term'} onPress={() => (adding ? void add() : setAdding(true))}
      disabled={adding && (!term.trim() || !rendering.trim())} secondary={adding ? { label: 'Cancel', onPress: () => setAdding(false) } : undefined} /> : undefined}>
      <Header title="Key terms" sub={`${lang} renderings`} onBack={ctx.back} />
      {adding ? (
        <Card>
          <Text style={text.h4}>New key term</Text>
          <Text style={text.small}>Added to this language's list with its rendering.</Text>
          <TextInput accessibilityLabel="Source term" style={styles.input} placeholder="Source term — e.g. grace (charis)" value={term} onChangeText={setTerm} />
          <TextInput accessibilityLabel="Meaning" style={styles.input} placeholder="Meaning, briefly" value={gloss} onChangeText={setGloss} />
          <TextInput accessibilityLabel={`${lang} rendering`} style={styles.input} placeholder={`${lang} rendering`} value={rendering} onChangeText={setRendering} />
          <TextInput accessibilityLabel="When to use it" style={styles.input} placeholder="When to use it, and why" value={context} onChangeText={setContext} multiline />
          {error ? <Text style={text.small}>{error}</Text> : null}
        </Card>
      ) : (
        <View style={[styles.input, { flexDirection: 'row', alignItems: 'center', gap: space.sm }]}>
          <Search size={16} color={colors.mutedForeground} />
          <TextInput accessibilityLabel="Search terms" placeholder="Search terms" value={query} onChangeText={setQuery} style={{ flex: 1, color: colors.foreground }} />
        </View>
      )}
      {unitId ? <Section label={`In this passage · ${here.length}`}>{here.length ? rows(here) : <Row label="None" last />}</Section> : null}
      <Section label={`${unitId ? 'Other terms' : 'All terms'} · ${other.length}`}>{other.length ? rows(other) : <Row label={q ? `No term matches “${query}”` : 'None'} last />}</Section>
      <Note>Each language keeps its own renderings and the reasons behind them.</Note>
    </Screen>
  );
}

/** Gloss, this language's renderings, why they changed, and where the term is used. */
export function KeyTermDetail(ctx: Ctx) {
  const { state, append, appendMany } = ctx.project;
  const termId = ctx.params['termId'] ?? '';
  const takeId = ctx.params['takeId'];
  const t = state ? keyTermView(state, termId) : null;
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const [rendering, setRendering] = useState('');
  const [context, setContext] = useState('');
  const [showWhy, setShowWhy] = useState(false);
  const [showWhere, setShowWhere] = useState(false);
  if (!state || !t) return <Note>Term not found.</Note>;
  const lang = state.lanes[t.laneId]?.languoidId ?? t.laneId;
  const linked = takesLinkingTerm(state, termId);
  const isLinked = !!takeId && !!state.keyTermLinks[takeId]?.[termId];
  const canEdit = ctx.session.can('fill_reference') || ctx.session.can('manage_reference');
  const books = t.unitScope.map((u) => state.units[u]?.label ?? u);
  const latest = t.adjustments.at(-1);
  async function save() {
    const adjustmentId = `adj-${Crypto.randomUUID()}`;
    await appendMany([
      ...(rendering.trim() ? [{ type: 'v1.KeyTermRenderingAdded' as const, payload: { termId, renderingId: `r-${Crypto.randomUUID()}`, rendering: rendering.trim(), context: context.trim() } }] : []),
      { type: 'v1.KeyTermAdjusted' as const, payload: { termId, adjustmentId, note: note.trim() || `Added rendering “${rendering.trim()}”`, ...(takeId ? { duringTakeId: takeId } : {}) } },
      ...(takeId && !isLinked ? [{ type: 'v1.KeyTermLinked' as const, payload: { takeId, termId, adjustmentId } }] : [])
    ]);
    setNote(''); setRendering(''); setContext(''); setEditing(false);
    ctx.toast('Saved with your reason');
  }
  return (
    <Screen footer={canEdit ? <Footer label={editing ? 'Save' : 'Adjust or add a rendering'} onPress={() => (editing ? void save() : setEditing(true))}
      disabled={editing && !note.trim() && !rendering.trim()} secondary={editing ? { label: 'Cancel', onPress: () => setEditing(false) } : undefined} /> : undefined}>
      <Header title={t.term} sub={`${termSource(t.termId)} · ${lang} term`} onBack={ctx.back} />
      <Card>
        <Text style={text.body}>{t.gloss || 'No meaning written yet.'}</Text>
        {books.length ? <Text style={text.small}>Appears in {books.join(', ')}</Text> : null}
      </Card>
      {takeId ? (
        <Row icon={Link2} label={isLinked ? 'Tied to your draft' : 'Tie to your draft'}
          sub={isLinked ? 'Reviewers will see this term and your reasoning.' : 'So reviewers know this term shaped your draft.'}
          onPress={isLinked ? undefined : () => void append('v1.KeyTermLinked', { takeId, termId })}
          right={isLinked ? <Check size={18} color={colors.done} accessibilityLabel="Tied" /> : undefined} last />
      ) : null}
      {editing ? (
        <Card>
          <Text style={text.h4}>{`${lang} · “${t.term}”`}</Text>
          <Text style={text.small}>Every change is recorded with your reason.</Text>
          <TextInput accessibilityLabel="New rendering" style={styles.input} placeholder="New rendering (optional)" value={rendering} onChangeText={setRendering} />
          <TextInput accessibilityLabel="When to use it" style={styles.input} placeholder="When to use it" value={context} onChangeText={setContext} />
          <TextInput accessibilityLabel="What changed and why" style={styles.input} placeholder="Type what changed, and why" value={note} onChangeText={setNote} multiline />
        </Card>
      ) : null}
      <Section label={`In ${lang} · ${t.renderings.length}`}>
        {t.renderings.map((r, i) => (
          <Row key={r.renderingId} label={r.rendering} sub={r.context} last={i === t.renderings.length - 1} />
        ))}
        {t.renderings.length === 0 ? <Row label="No rendering yet" sub={`Add how ${lang} says this, and when to use it.`} last /> : null}
      </Section>
      <Row icon={showWhy ? ChevronDown : ChevronRight} label="Why it's rendered this way"
        sub={t.adjustments.length ? <Byline before={`${t.adjustments.length} change${t.adjustments.length === 1 ? '' : 's'} · latest by`} id={latest!.actorId} /> : 'No changes recorded yet'}
        onPress={() => setShowWhy(!showWhy)} right={<View />} last />
      {showWhy ? <Section label="Changes">
        {t.adjustments.map((a, i) => (
          <Row key={a.adjustmentId} label={a.note} sub={<Byline id={a.actorId} after={`${a.duringTakeId ? ` · during ${state.units[state.takes[a.duringTakeId]?.unitId ?? '']?.label ?? 'a translation'}` : ''}${a.blobHash ? ' · audio' : ''}`.trim() || undefined} />} last={i === t.adjustments.length - 1} />
        ))}
      </Section> : null}
      <Row icon={showWhere ? ChevronDown : ChevronRight} label="Where it's used" sub={`${linked.length} translation${linked.length === 1 ? '' : 's'}`}
        onPress={() => setShowWhere(!showWhere)} right={<View />} last />
      {showWhere ? <Section label="Used in">
        {linked.map((l, i) => {
          const take = state.takes[l.takeId];
          return <Row key={l.takeId} label={state.units[take?.unitId ?? '']?.label ?? l.takeId} sub={l.note} onPress={take ? () => ctx.go('version_detail', { takeId: l.takeId, laneId: take.laneId, unitId: take.unitId }) : undefined} last={i === linked.length - 1} />;
        })}
        {linked.length === 0 ? <Row label="None yet" last /> : null}
      </Section> : null}
    </Screen>
  );
}

/**
 * UX spec A42 / J-CFG-2: exactly one review flow per language, picked from
 * the ready-made flows. Use writes one register per step; Undo re-selects the
 * previous flow. Parallel kinds and checkpoints wait for v2 steps (Phase 2).
 */
export function FlowsHome(ctx: Ctx) {
  const { state, appendMany } = ctx.project;
  const { laneId, lanes, level } = viewLanes(ctx);
  const selected = laneId ? state?.laneFlows[laneId]?.value : undefined;
  const steps = state && laneId ? deriveWorkflow(state, laneId) : [];
  const canManage = ctx.session.can('manage_flows') && !!laneId;
  const [busy, setBusy] = useState('');
  async function select(flowId: string, from: typeof selected) {
    if (!state || !laneId) return;
    const current = deriveWorkflow(state, laneId);
    // Steps of the previously selected flow are removed; hand-edited steps stay.
    const removals = from
      ? current.filter((s) => s.id.startsWith(`${from.flowId}@`)).map((s) => ({ type: 'v1.WorkflowStepRemoved' as const, payload: { stepId: s.id } }))
      : [];
    await appendMany([
      { type: 'v1.LaneFlowSelected' as const, payload: { laneId, flowId, catalogVersion: CATALOG_VERSION } },
      ...removals,
      ...instantiateFlow(flowId, laneId).map((payload) => ({ type: 'v1.WorkflowStepSet' as const, payload }))
    ]);
  }
  function use(flowId: string, name: string) {
    if (busy) return;
    const previous = selected;
    setBusy(flowId);
    void select(flowId, previous).then(() => ctx.toast(`${state?.lanes[laneId!]?.languoidId ?? 'This language'} now uses ${name}`,
      previous && FLOW_TEMPLATES.some((f) => f.id === previous.flowId)
        ? () => void select(previous.flowId, { flowId, catalogVersion: CATALOG_VERSION }).then(() => ctx.toast('Undone — the previous flow is back'))
        : undefined)).finally(() => setBusy(''));
  }
  const scopeName = level === 'org' ? 'organization' : 'project';
  return (
    <Screen footer={canManage ? <Footer label="Edit stages" onPress={() => ctx.go('flow_editor', { laneId: laneId! })} /> : undefined}>
      <Header title="Review flows" sub={laneId ? state?.lanes[laneId]?.languoidId : `${level === 'org' ? 'Organization' : 'Project'} · ${lanes.length} language${lanes.length === 1 ? '' : 's'}`} onBack={ctx.back} />
      <Note>{laneId
        ? 'The flow suggests what should happen next for each passage in this language.'
        : `Each language runs one review flow — this view covers the ${lanes.length} language${lanes.length === 1 ? '' : 's'} in this ${scopeName}${level === 'org' ? ' that are open on this device' : ''}. Apply one from a language's home.`}</Note>
      <Section label="Ready-made flows">
        {FLOW_TEMPLATES.map((f, i, a) => {
          const users = lanes.filter((l) => state?.laneFlows[l]?.value.flowId === f.id);
          return (
            <Row key={f.id} icon={Workflow} label={f.name}
              sub={`${f.stages.map((st) => st.label).join(' → ')}${laneId ? '' : ` · ${users.length ? `Used by ${langNames(state, users)}` : 'Not used in this view'}`}`}
              right={laneId ? <UsePill label={f.name} on={selected?.flowId === f.id} busy={busy === f.id}
                onPress={canManage ? () => use(f.id, f.name) : undefined} /> : <View />}
              last={i === a.length - 1} />
          );
        })}
      </Section>
      {laneId ? (
        <Section label="Steps in use">
          {steps.map((s, i) => (
            <Row key={s.id} label={s.label ?? s.id} sub={`${s.teamId ? `team ${state?.teams[s.teamId]?.name.value ?? s.teamId}` : s.role} · ${s.rule}${s.required ? ' · required' : ' · optional'}`} badge={`${i + 1}`} last={i === steps.length - 1 && selected?.flowId !== 'spoken_worldwide'} />
          ))}
          {steps.length === 0 ? <Row label="No reviews — done once recorded" last={selected?.flowId !== 'spoken_worldwide'} /> : null}
          {/* Legacy Spoken Worldwide lanes keep their oral workflow settings. */}
          {selected?.flowId === 'spoken_worldwide' && canManage
            ? <Row icon={Workflow} label="Oral workflow settings" onPress={() => ctx.go('obt_manage', { laneId: laneId! })} last /> : null}
        </Section>
      ) : null}
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
