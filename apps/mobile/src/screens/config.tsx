// Avatar P. Roles, content templates, reference library, key terms, review flows.
import type { Privilege, ProjectState, ReviewKind } from '@langquest-next/core';
import { PRIVILEGES, CATALOG_VERSION, contentTemplates, deriveFlow, FLOW_TEMPLATES, instantiateFlow, instantiateFlowV2, READY_FLOWS, readyFlow, reviewKind, reviewKinds, instantiateQuestionSet, instantiateTemplate, keyTermsFor, keyTermsForUnit, keyTermView, materialsFor, QUESTION_TEMPLATES, questionSetMaterialId, REFERENCE_KINDS, takesLinkingTerm, templateStepId } from '@langquest-next/core';
import type { LucideIcon } from 'lucide-react-native';
import { ArrowDown, ArrowUp, BadgeCheck, Check, ChevronDown, ChevronRight, FileText, Globe, KeyRound, Languages, Link2, Lock, MapPin, MessageCircle, Mic, Octagon, Plus, Search, Star, Trash2, Users, Workflow, X } from 'lucide-react-native';
import * as Crypto from 'expo-crypto';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
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

/** The icon a kind names (catalog seeds and new kinds), with a generic fallback. */
function kindIcon(kind: Pick<ReviewKind, 'icon' | 'id'>): LucideIcon {
  switch (kind.icon) {
    case 'users': return Users;
    case 'languages': return Languages;
    case 'globe': return Globe;
    case 'badge-check': return BadgeCheck;
    case 'star': return Star;
    case 'map-pin': return MapPin;
    default: return MessageCircle;
  }
}

/** One step's kinds as words, "Peer Review + Back Translation". */
function kindNames(state: ProjectState, kindIds: string[]): string {
  return kindIds.map((k) => reviewKind(state, k).name).join(' + ');
}

/** The events a flow selection implies: ready-made flows emit v2 steps, legacy flows v1 steps. */
function flowEvents(flowId: string, laneId: string) {
  return readyFlow(flowId)
    ? instantiateFlowV2(flowId, laneId).map((payload) => ({ type: 'v2.WorkflowStepSet' as const, payload }))
    : instantiateFlow(flowId, laneId).map((payload) => ({ type: 'v1.WorkflowStepSet' as const, payload }));
}

/**
 * UX spec A42 / J-CFG-2: exactly one review flow per language, picked from
 * the ready-made flows. A ready-made flow replaces the language's steps with
 * v2 steps (kinds, checkpoints) under its own ids; Undo re-selects the
 * previous flow. Lanes on a legacy v1 flow keep it until someone picks again.
 */
export function FlowsHome(ctx: Ctx) {
  const { state, appendMany } = ctx.project;
  const { laneId, lanes, level } = viewLanes(ctx);
  const selected = laneId ? state?.laneFlows[laneId]?.value : undefined;
  const steps = state && laneId ? deriveFlow(state, laneId) : [];
  const canManage = ctx.session.can('manage_flows') && !!laneId;
  const [busy, setBusy] = useState('');
  const legacy = selected ? FLOW_TEMPLATES.find((f) => f.id === selected.flowId) : undefined;
  async function select(flowId: string) {
    if (!state || !laneId) return;
    const events = flowEvents(flowId, laneId);
    const keep = new Set(events.map((e) => e.payload.stepId));
    // The language runs one flow: its other lane steps go.
    const removals = Object.entries(state.workflowSteps)
      .filter(([id, s]) => !s.removed && s.step.hlc !== '' && s.step.value.laneId === laneId && !keep.has(id))
      .map(([stepId]) => ({ type: 'v1.WorkflowStepRemoved' as const, payload: { stepId } }));
    await appendMany([{ type: 'v1.LaneFlowSelected' as const, payload: { laneId, flowId, catalogVersion: CATALOG_VERSION } }, ...removals, ...events]);
  }
  function use(flowId: string, name: string) {
    if (busy) return;
    const previous = selected;
    setBusy(flowId);
    void select(flowId).then(() => ctx.toast(`${state?.lanes[laneId!]?.languoidId ?? 'This language'} now uses ${name}`,
      previous && (readyFlow(previous.flowId) || FLOW_TEMPLATES.some((f) => f.id === previous.flowId))
        ? () => void select(previous.flowId).then(() => ctx.toast('Undone — the previous flow is back'))
        : undefined)).finally(() => setBusy(''));
  }
  const scopeName = level === 'org' ? 'organization' : 'project';
  return (
    <Screen footer={canManage ? <Footer label="Edit flow" onPress={() => ctx.go('flow_editor', { laneId: laneId! })} /> : undefined}>
      <Header title="Review flows" sub={laneId ? state?.lanes[laneId]?.languoidId : `${level === 'org' ? 'Organization' : 'Project'} · ${lanes.length} language${lanes.length === 1 ? '' : 's'}`} onBack={ctx.back} />
      <Note>{laneId
        ? 'The flow suggests what should happen next for each passage in this language.'
        : `Each language runs one review flow — this view covers the ${lanes.length} language${lanes.length === 1 ? '' : 's'} in this ${scopeName}${level === 'org' ? ' that are open on this device' : ''}. Apply one from a language's home.`}</Note>
      <Section label="Ready-made flows">
        {READY_FLOWS.map((f, i, a) => {
          const users = lanes.filter((l) => state?.laneFlows[l]?.value.flowId === f.id);
          const shape = f.steps.length === 0 ? 'No reviews' : f.steps.map((st) => `${state ? kindNames(state, st.kindIds) : st.kindIds.join(' + ')}${st.checkpoint ? ' (checkpoint)' : ''}`).join(' → ');
          return (
            <Row key={f.id} icon={Workflow} label={f.name}
              sub={`${shape}${laneId ? '' : ` · ${users.length ? `Used by ${langNames(state, users)}` : 'Not used in this view'}`}`}
              right={laneId ? <UsePill label={f.name} on={selected?.flowId === f.id} busy={busy === f.id}
                onPress={canManage ? () => use(f.id, f.name) : undefined} /> : <View />}
              last={i === a.length - 1} />
          );
        })}
      </Section>
      {laneId ? (
        <Section label={legacy ? `Steps in use · ${legacy.name}` : 'Steps in use'}>
          {steps.map((s, i) => (
            <Row key={s.id} icon={s.checkpoint ? Octagon : undefined} label={s.label ?? (state ? kindNames(state, s.kindIds) : s.id)}
              sub={s.legacy
                ? `${s.legacy.teamId ? `team ${state?.teams[s.legacy.teamId]?.name.value ?? s.legacy.teamId}` : s.legacy.role} · ${s.legacy.rule}${s.legacy.required ? ' · required' : ' · optional'}`
                : `${s.kindIds.length > 1 ? 'Together · ' : ''}${s.checkpoint ? 'Checkpoint · later steps wait for it' : 'Can be set aside with a reason'}`}
              badge={`${i + 1}`} last={i === steps.length - 1 && selected?.flowId !== 'spoken_worldwide'} />
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

interface DraftStep { id: string; kindIds: string[]; checkpoint: boolean; label?: string; legacy: boolean }

/**
 * J-CFG-3/4/5/6: a language's flow as steps of review kinds. Kinds in one
 * step happen together; a checkpoint is the only hard stop. Saving writes one
 * `v2.WorkflowStepSet` per changed step (so two admins merge per step), a
 * removal per dropped step, and `v1.ReviewKindDefined` for new kinds. A v1
 * step is never edited with v2: saving replaces it under a new id, so an old
 * client sees fewer steps rather than a stale one.
 */
export function FlowEditor(ctx: Ctx) {
  const { state, appendMany } = ctx.project;
  const laneId = ctx.params['laneId'] ?? Object.keys(state?.lanes ?? {})[0] ?? '';
  const initial = state ? deriveFlow(state, laneId) : [];
  const [steps, setSteps] = useState<DraftStep[]>(() => initial.map((s) => ({
    id: s.id, kindIds: [...s.kindIds], checkpoint: s.checkpoint, legacy: s.legacy !== undefined, ...(s.label !== undefined ? { label: s.label } : {})
  })));
  const [newKinds, setNewKinds] = useState<{ kindId: string; name: string }[]>([]);
  const [picker, setPicker] = useState<number | null>(null);
  const [kindName, setKindName] = useState('');
  const [busy, setBusy] = useState(false);
  const canManage = ctx.session.can('manage_flows');
  const language = state?.lanes[laneId]?.languoidId ?? laneId;
  const nameOf = (id: string) => newKinds.find((k) => k.kindId === id)?.name ?? (state ? reviewKind(state, id).name : id);
  const kindOf = (id: string): ReviewKind => newKinds.find((k) => k.kindId === id) ? { id, name: nameOf(id), icon: 'message-circle' } : state ? reviewKind(state, id) : { id, name: id };
  const edit = (i: number, f: (s: DraftStep) => DraftStep) => setSteps((all) => all.map((s, j) => (j === i ? f(s) : s)));
  const move = (i: number, by: number) => setSteps((all) => {
    const j = i + by;
    if (j < 0 || j >= all.length) return all;
    const out = [...all];
    [out[i], out[j]] = [out[j]!, out[i]!];
    return out;
  });

  async function save() {
    if (!state || busy) return;
    setBusy(true);
    try {
      const kept = steps.filter((s) => s.kindIds.length > 0);
      const events: Parameters<typeof appendMany>[0] = [];
      for (const k of newKinds) {
        if (kept.some((s) => s.kindIds.includes(k.kindId))) events.push({ type: 'v1.ReviewKindDefined', payload: { kindId: k.kindId, name: k.name, icon: 'message-circle' } });
      }
      const finalIds = kept.map((s) => (s.legacy ? `step:${laneId}:${Crypto.randomUUID()}` : s.id));
      const before = new Map(initial.map((s) => [s.id, s]));
      for (const s of initial) if (!finalIds.includes(s.id)) events.push({ type: 'v1.WorkflowStepRemoved', payload: { stepId: s.id } });
      kept.forEach((s, i) => {
        const stepId = finalIds[i]!;
        const order = `s${String(i).padStart(2, '0')}`;
        const was = before.get(stepId);
        if (was && !was.legacy && was.order === order && was.checkpoint === s.checkpoint && was.kindIds.join('|') === s.kindIds.join('|')) return;
        events.push({ type: 'v2.WorkflowStepSet', payload: {
          stepId, laneId, order, kindIds: s.kindIds, checkpoint: s.checkpoint, ...(s.label !== undefined && !s.legacy ? { label: s.label } : {})
        } });
      });
      // No steps left: the language collects only, rather than inheriting the project's steps.
      if (kept.length === 0 && initial.length > 0) events.push({ type: 'v1.LaneFlowSelected', payload: { laneId, flowId: 'collect_only', catalogVersion: CATALOG_VERSION } });
      if (events.length) await appendMany(events);
      ctx.toast(`${language} flow saved`);
      ctx.back();
    } finally { setBusy(false); }
  }

  function addKind(kindId: string) {
    if (picker === null) return;
    edit(picker, (s) => (s.kindIds.includes(kindId) ? s : { ...s, kindIds: [...s.kindIds, kindId] }));
    setPicker(null);
  }
  function createKind() {
    const name = kindName.trim();
    if (!name) return;
    const kindId = `kind:${Crypto.randomUUID()}`;
    setNewKinds((k) => [...k, { kindId, name }]);
    setKindName('');
    addKind(kindId);
  }

  const available = state ? [...reviewKinds(state), ...newKinds.map((k) => kindOf(k.kindId))] : [];
  return (
    <Screen footer={canManage ? <View style={{ gap: space.sm }}>
      <Text style={text.small}>{`Used by ${language}. Changes apply to its passages right away — nothing already recorded is lost.`}</Text>
      <Footer label="Save flow" onPress={() => void save()} disabled={busy} />
    </View> : undefined}>
      <Header title="Edit flow" sub={`Review flow · ${language}`} onBack={ctx.back} />
      <Note>Steps are a suggested order. Kinds in the same step can happen together. Anyone can set a step aside with a reason; a checkpoint is the only hard stop — moving past one needs permission, and the reason is recorded.</Note>
      {steps.length === 0 ? <Note>No reviews. A passage counts as done once it's recorded. Teams can still record reviews — they just aren't suggested.</Note> : null}
      {steps.map((s, i) => (
        <View key={s.id} style={{ gap: space.xs }}>
          {i > 0 ? <Text style={[text.small, { textAlign: 'center' }]}>{steps[i - 1]!.checkpoint ? 'then, once cleared' : 'then'}</Text> : null}
          <Card style={s.checkpoint ? { borderColor: colors.review, borderWidth: 1.5 } : undefined}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Badge label={`${i + 1}`} />
              <Text style={[text.h4, { flex: 1 }]}>{s.kindIds.length > 1 ? 'Together' : 'Step'}</Text>
              {canManage ? <>
                <Pressable onPress={() => move(i, -1)} disabled={i === 0} hitSlop={4} style={styles.iconHit} accessibilityRole="button" accessibilityLabel="Move step up">
                  <ArrowUp size={18} color={i === 0 ? colors.mutedForeground : colors.foreground} />
                </Pressable>
                <Pressable onPress={() => move(i, 1)} disabled={i === steps.length - 1} hitSlop={4} style={styles.iconHit} accessibilityRole="button" accessibilityLabel="Move step down">
                  <ArrowDown size={18} color={i === steps.length - 1 ? colors.mutedForeground : colors.foreground} />
                </Pressable>
                <Pressable onPress={() => setSteps(steps.filter((_, j) => j !== i))} hitSlop={4} style={styles.iconHit} accessibilityRole="button" accessibilityLabel="Remove step">
                  <Trash2 size={18} color={colors.reference} />
                </Pressable>
              </> : null}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {s.kindIds.map((k) => {
                const kind = kindOf(k);
                const Icon = kindIcon(kind);
                return (
                  <View key={k} style={styles.chip} accessible accessibilityLabel={`${kind.name}${kind.produces ? `, makes a ${kind.produces.what}` : ''}`}>
                    <Icon size={16} color={colors.review} />
                    <Text style={text.small}>{kind.name}</Text>
                    {kind.produces ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}><Mic size={12} color={colors.mutedForeground} /><Text style={text.small}>makes a recording</Text></View> : null}
                    {canManage ? <Pressable onPress={() => edit(i, (x) => ({ ...x, kindIds: x.kindIds.filter((y) => y !== k) }))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${kind.name}`}>
                      <X size={14} color={colors.mutedForeground} />
                    </Pressable> : null}
                  </View>
                );
              })}
              {canManage ? <Pressable onPress={() => setPicker(i)} style={styles.chip} accessibilityRole="button" accessibilityLabel={s.kindIds.length ? 'Add a kind alongside' : 'Add kind'}>
                <Plus size={16} color={colors.translate} /><Text style={text.small}>{s.kindIds.length ? 'Alongside' : 'Add kind'}</Text>
              </Pressable> : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Octagon size={18} color={s.checkpoint ? colors.review : colors.mutedForeground} />
              <View style={{ flex: 1 }}>
                <Text style={text.body}>Checkpoint</Text>
                <Text style={text.small}>{s.checkpoint ? 'Later steps wait for this one.' : 'Can be set aside with a reason.'}</Text>
              </View>
              <Switch value={s.checkpoint} disabled={!canManage} accessibilityLabel={`Checkpoint for step ${i + 1}`}
                onValueChange={(v) => edit(i, (x) => ({ ...x, checkpoint: v }))} />
            </View>
          </Card>
        </View>
      ))}
      {canManage ? <Pressable onPress={() => { setSteps([...steps, { id: `step:${laneId}:${Crypto.randomUUID()}`, kindIds: [], checkpoint: false, legacy: false }]); setPicker(steps.length); }}
        style={[styles.chip, { alignSelf: 'flex-start', minHeight: 48 }]} accessibilityRole="button" accessibilityLabel="Add step">
        <Plus size={20} color={colors.translate} /><Text style={text.body}>Add step</Text>
      </Pressable> : null}

      <Modal visible={picker !== null} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' }} onPress={() => setPicker(null)} accessibilityLabel="Close" accessibilityRole="button" />
        <View style={styles.sheet}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={[text.h4, { flex: 1 }]}>Add a kind of review</Text>
            <Pressable onPress={() => setPicker(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={colors.foreground} /></Pressable>
          </View>
          <Text style={text.small}>Kinds are your organization's vocabulary. Add your own if these don't fit.</Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {available.filter((k) => picker === null || !steps[picker]?.kindIds.includes(k.id)).map((k, i, a) => (
              <Row key={k.id} icon={kindIcon(k)} label={k.name}
                sub={`${k.description ?? 'Defined by your organization.'}${k.produces ? ` · makes a ${k.produces.what}` : ''}`}
                onPress={() => addKind(k.id)} last={i === a.length - 1} />
            ))}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
            <TextInput style={[styles.input, { flex: 1 }]} placeholder="New kind — e.g. Elder Review" value={kindName} onChangeText={setKindName}
              accessibilityLabel="New kind name" onSubmitEditing={createKind} />
            <Pressable onPress={createKind} style={styles.iconHit} accessibilityRole="button" accessibilityLabel="Add new kind">
              <Plus size={24} color={colors.translate} />
            </Pressable>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = {
  opt: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: 8, backgroundColor: colors.muted },
  chip: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, minHeight: 36, paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: 18, backgroundColor: colors.muted },
  iconHit: { minWidth: 48, minHeight: 48, alignItems: 'center' as const, justifyContent: 'center' as const },
  sheet: { padding: space.lg, paddingBottom: space.xl, gap: space.md, backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, backgroundColor: colors.card, color: colors.foreground }
};

import { contractsFor } from '../screenContracts';
export const contracts = contractsFor('roles_home', 'role_editor', 'templates_home', 'reference_home', 'key_terms', 'key_term_detail', 'flows_home', 'flow_editor');
