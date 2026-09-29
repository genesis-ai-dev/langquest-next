// Avatar P. Configuration: roles, reference material, key terms, review flows.
// Ports the demo's src/screens/config.tsx (RolesHomeScreen, RoleEditorScreen,
// AppliedCatalogScreen for review flows, FlowStepsInline, FlowEditorScreen,
// KindPickerSheet, ReferenceLibraryScreen, KeyTermsScreen, AddKeyTermSheet,
// KeyTermDetailScreen, AdjustKeyTermSheet) and review.tsx MaterialEditorScreen,
// with the working material editor from main (fields as registers, lock,
// new material) in the new look.
// Requirements ORG-3, ORG-4, ORG-8, TERM-1..6, FLOW-1..4.
// ADR-002 (one model for reference), ADR-004 (done is read from the record),
// ADR-005 (kinds arranged by the flow designer), ADR-016 (parallel kinds).
// Pure reading lives in configModel.ts.
import {
  catalogKey, CommandError, commands, deriveKinds, derivePassage, FLOWS, formatQuestionField, keyTermsFor, keyTermView, laneName,
  materialView, parseQuestionField, privilegesFor, PRIVILEGES, QUESTION_TEMPLATES, REFERENCE_KINDS, SOURCE_BIBLES,
  sourceBibleEnabled, takesLinkingTerm, templateFields, unitTitle, V1_STAGE_KINDS,
  type EventSpec, type FlowStep, type KeyTermView, type KindDef, type MaterialView,
  type Privilege, type ProjectState, type QuestionSpec, deriveFlow
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AudioClip } from '../audioClip';
import type { Ctx } from '../ctx';
import { indexesFor } from '../indexes';
import {
  Badge, Banner, Card, Chip, ChipRow, Disclosure, EmptyState, Field, GhostBtn, Group, Header, Ico, IconBtn, KindIcon,
  PrimaryBtn, Row, Screen, SearchField, SectionLabel, Sheet, ShowMore, SmallBtn, Toggle, txt
} from '../kit';
import { when } from '../passageView';
import { reportError, failureMessage } from '../report';
import { contractsFor } from '../screenContracts';
import { sourceText } from '../scripture';
import { C, radius, space, TINT } from '../theme';
import { VoiceNote } from '../voiceNote';
import {
  catalogFlowOf, draftChanged, draftFromLane, fieldLabel, flowLabel, holdersOf, isFiaTerm, LEVEL_LABEL, laneFlows,
  matchesTerm, moveStep, newKindId, nextFieldId, otherLanguageRenderings, plural, PRIVILEGE_INFO, questionCount,
  questionCountLabel, questionDrafts, referenceView, roleRows, scopeName, setKindName, stepsToSave, termsInPassage,
  viewLevelFrom, type DraftStep, type QuestionDraft
} from './configModel';

/** Long lists grow 25 at a time (ADR-009). */
const STEP = 25;

/**
 * What to say when something fails (error-tracking): a command's own reason,
 * or, for a fault, a code a tester can read out, having reported it.
 */
const failure = failureMessage;

/**
 * Build a core command's events and hand them to `ctx.act`. A command that
 * refuses (CommandError) is said in a toast; ctx.act says "Not saved" and
 * why by itself, so nothing is said twice. True when it was saved.
 */
async function actCommand(ctx: Ctx, where: string, build: () => EventSpec[], message: string, undo?: () => EventSpec[]): Promise<boolean> {
  let specs: EventSpec[];
  try {
    specs = build();
  } catch (e) {
    ctx.toast(failure(where, e));
    return false;
  }
  try {
    await ctx.act(specs, message, undo);
    return true;
  } catch {
    // ctx.act has already said "Not saved" and why.
    return false;
  }
}

/** The latest value, for an Undo that runs after the screen has re-rendered with the change. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function Intro(props: { children: ReactNode }) {
  return <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{props.children}</Text>;
}

/** A list capped at 25 with "Show more" (ADR-009). */
function Capped<T>(props: { items: T[]; render: (item: T, last: boolean) => ReactNode; empty?: string }) {
  const [n, setN] = useState(STEP);
  if (props.items.length === 0) {
    return props.empty ? <Card><Text style={txt.smMuted}>{props.empty}</Text></Card> : null;
  }
  const shown = props.items.slice(0, n);
  return (
    <>
      <Group>{shown.map((item, i) => props.render(item, i === shown.length - 1))}</Group>
      <ShowMore remaining={props.items.length - n} step={STEP} onMore={() => setN(n + STEP)} />
    </>
  );
}

/** A switch with a label and a line saying what it does, wrapping in full. */
function ToggleRow(props: { label: string; desc: string; on: boolean; disabled?: boolean; onToggle: () => void; last?: boolean; icon?: ReactNode }) {
  return (
    <View style={[styles.toggleRow, !props.last && styles.rowBorder]}>
      {props.icon}
      <View style={{ flex: 1 }}>
        <Text style={[txt.body, { fontWeight: '600' }]}>{props.label}</Text>
        <Text style={[txt.smMuted, { marginTop: 2 }]}>{props.desc}</Text>
      </View>
      <Toggle on={props.on} disabled={props.disabled} label={props.label} onToggle={props.onToggle} />
    </View>
  );
}

function projectName(ctx: Ctx): string {
  return ctx.project.state?.project?.value.name ?? 'Project';
}

// ─── Roles (ORG-3, ORG-4) ──────────────────────────────────────────────────────────

export function RolesHome(ctx: Ctx) {
  const level = viewLevelFrom(ctx.params, ctx.session.adminScope);
  const org = ctx.org.state;
  const state = ctx.project.state;
  const rows = useMemo(() => roleRows(org, state, level), [org, state, level]);
  const canManage = ctx.session.can('manage_roles') && level === 'org';
  return (
    <Screen header={<Header title="Roles" sub={LEVEL_LABEL[level]} onBack={ctx.back}
      action={canManage ? <SmallBtn label="Role" icon="plus" tone="primary" onPress={() => ctx.go('role_editor', { roleId: 'new', level })} /> : undefined} />}>
      <Intro>
        Roles are privilege sets without a fixed scope. Scope is chosen when assigning a role to a member.
        {level === 'org'
          ? ' Roles created here can be assigned at any level.'
          : ' Roles are defined for the whole organization, so here they are view only. Edit them from Organization Home.'}
      </Intro>
      {!org ? <EmptyState icon="people" title="Loading roles…" /> : rows.length === 0 ? (
        <EmptyState icon="people" title="No roles yet" sub={canManage ? 'Make one for each way people help: what they may do, not where.' : undefined} />
      ) : (
        <>
          <SectionLabel label="Defined at Organization" />
          <Group>
            {rows.map((r, i) => (
              <Row key={r.roleId} icon={r.inherited ? 'lock' : r.builtIn ? 'people' : 'star'}
                iconColor={r.inherited ? TINT.grayText : C.primary} iconBg={r.inherited ? TINT.gray : undefined}
                label={r.name} muted={r.inherited}
                sub={r.inherited ? 'View only · edit from the level where it was defined'
                  : `${plural(r.members, 'member')} · ${plural(r.privileges.length, 'privilege')}`}
                badge={r.inherited ? 'View only' : undefined}
                onPress={() => ctx.go('role_editor', { roleId: r.roleId, level })} last={i === rows.length - 1} />
            ))}
          </Group>
        </>
      )}
    </Screen>
  );
}

export function RoleEditor(ctx: Ctx) {
  const level = viewLevelFrom(ctx.params, ctx.session.adminScope);
  const requested = ctx.params['roleId'] ?? 'new';
  const isNew = requested === 'new';
  const [newId] = useState(() => `role-${Crypto.randomUUID()}`);
  const roleId = isNew ? newId : requested;
  const org = ctx.org.state;
  const existing = isNew ? undefined : org?.roles[roleId];
  const inherited = !isNew && level !== 'org';
  const readOnly = inherited || !ctx.session.can('manage_roles');
  const [name, setName] = useState<string | null>(null);
  const [picked, setPicked] = useState<Privilege[] | null>(null);
  const [busy, setBusy] = useState(false);
  const label = name ?? existing?.name.value ?? '';
  const privileges = picked ?? existing?.privileges.value ?? [];
  const state = ctx.project.state;
  const holders = useMemo(() => (isNew ? [] : holdersOf(org, state, roleId)), [isNew, org, state, roleId]);
  const canAssign = ctx.session.can('assign_work');
  const dirty = isNew
    ? label.trim() !== ''
    : !!existing && (label.trim() !== existing.name.value
      || privileges.length !== existing.privileges.value.length || privileges.some((p) => !existing.privileges.value.includes(p)));

  if (!isNew && !existing) {
    return (
      <Screen header={<Header title="Role" onBack={ctx.back} />}>
        <EmptyState icon="people" title={org ? 'This role is not here any more' : 'Loading the role…'} />
      </Screen>
    );
  }

  async function save() {
    if (readOnly || busy || !label.trim()) return;
    const next = { roleId, name: label.trim(), privileges: PRIVILEGES.filter((p) => privileges.includes(p)) };
    const prev = existing ? { roleId, name: existing.name.value, privileges: [...existing.privileges.value] } : null;
    setBusy(true);
    try {
      await ctx.org.append('v1.RoleDefined', next);
      ctx.toast(isNew ? `${next.name} created.` : `${next.name} saved.`, prev ? async () => {
        try { await ctx.org.append('v1.RoleDefined', prev); ctx.toast('Undone.'); } catch (e) { ctx.toast(`Not undone. ${failure('undo role', e)}`); }
      } : undefined);
      ctx.back();
    } catch (e) {
      ctx.toast(`Not saved. ${failure('save role', e)}`);
      setBusy(false);
    }
  }

  const toggle = (p: Privilege) => setPicked(privileges.includes(p) ? privileges.filter((x) => x !== p) : [...privileges, p]);
  return (
    <Screen
      header={<Header title={label || (isNew ? 'New Role' : 'Role')} sub={`${isNew ? 'New role' : 'Role'} · Organization`} onBack={ctx.back} />}
      footer={readOnly ? undefined : <PrimaryBtn label={isNew ? 'Create Role' : 'Save Role'} onPress={() => void save()} disabled={!label.trim() || !dirty} busy={busy} />}>
      {inherited ? <Banner icon="lock" title="View only" body="Defined at the organization level. Edit it from Organization Home." /> : null}
      {readOnly && !inherited ? <Banner icon="lock" title="View only" body="You do not have permission to edit this role." /> : null}
      {!readOnly ? <Field label="Role name" value={label} onChangeText={setName} placeholder="Role name" autoCapitalize="words" /> : null}
      {!isNew ? (
        <>
          <SectionLabel label="Members with this role" />
          {canAssign ? <GhostBtn label={`Invite someone as ${label || 'this role'}`} icon="qr" onPress={() => ctx.go('invite_qr', { roleId })} /> : null}
          <Capped items={holders} empty="No members have this role yet." render={(h, last) => (
            <Row key={`${h.profileId}-${h.scope ? JSON.stringify(h.scope) : 'project'}`} icon="user"
              label={h.profileId === ctx.session.actorId ? 'You' : h.displayName ?? ctx.name(h.profileId)}
              sub={scopeName(h.scope, org, state, ctx.project.projectId)}
              onPress={canAssign ? () => ctx.go('edit_member', { memberId: h.profileId }) : undefined} last={last} />
          )} />
        </>
      ) : null}
      <Card style={{ backgroundColor: C.light }}>
        <Text style={txt.sm}>
          {isNew
            ? 'Scope is not set here: choose organization, project, or language when inviting or editing a member.'
            : 'Scope is assigned per member when this role is given.'}
        </Text>
      </Card>
      <SectionLabel label="Permissions" />
      <Group>
        {PRIVILEGES.map((p, i) => (
          <ToggleRow key={p} label={PRIVILEGE_INFO[p].label} desc={PRIVILEGE_INFO[p].desc} on={privileges.includes(p)}
            disabled={readOnly || busy} onToggle={() => toggle(p)} last={i === PRIVILEGES.length - 1} />
        ))}
      </Group>
    </Screen>
  );
}

// ─── Review flows (FLOW-1..4) ───────────────────────────────────────────────────────

/** A flow at a glance: steps left to right, parallel kinds stacked, checkpoints locked. */
function FlowStepsInline(props: { steps: Pick<FlowStep, 'kindIds' | 'checkpoint'>[]; kinds: KindDef[] }) {
  if (props.steps.length === 0) {
    return (
      <View style={[styles.stepTile, { backgroundColor: TINT.gray, alignSelf: 'flex-start' }]}>
        <Text style={[txt.xsStrong, { color: TINT.grayText }]}>No reviews: done once recorded</Text>
      </View>
    );
  }
  const name = (id: string) => props.kinds.find((k) => k.id === id)?.name ?? id;
  return (
    <View style={styles.inline}>
      {props.steps.map((st, i) => (
        <View key={i} style={styles.inlineStep}>
          {i > 0 ? <Ico name="arrowR" size={14} color={C.muted} /> : null}
          <View style={[styles.stepTile, st.checkpoint ? { backgroundColor: TINT.amber, borderColor: `${C.amber}99` } : { backgroundColor: C.light }]}>
            {st.kindIds.map((id, j) => (
              <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {st.checkpoint && j === 0 ? <Ico name="lock" size={12} color={TINT.amberText} /> : null}
                <Text style={[txt.xsStrong, { color: st.checkpoint ? TINT.amberText : C.primary }]}>{name(id)}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

export function FlowsHome(ctx: Ctx) {
  const state = ctx.project.state;
  const fixedLane = ctx.params['laneId'];
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uses = useMemo(() => (state ? laneFlows(state) : []), [state]);
  const kinds = useMemo(() => (state ? deriveKinds(state) : []), [state]);
  const live = useLatest(ctx);
  const laneId = fixedLane ?? picked ?? (ctx.laneId && state?.lanes[ctx.laneId] ? ctx.laneId : uses[0]?.laneId) ?? null;
  const current = uses.find((u) => u.laneId === laneId) ?? null;
  const canManage = ctx.session.can('manage_flows');
  const byLanguage = ctx.details('flows:by-language');

  async function use(flowId: string) {
    if (!state || !current || busy) return;
    const lane = current.laneId;
    const previous = deriveFlow(state, lane);
    const flowName = FLOWS.find((f) => f.id === flowId)?.name ?? flowId;
    setBusy(true);
    // Undo selects the previous flow again; its steps were never removed.
    await actCommand(ctx, 'use flow', () => commands(state, indexesFor(state)).useFlow({ commandId: Crypto.randomUUID(), laneId: lane, flowId }),
      `${current.name} now uses ${flowName}.`,
      () => {
        const s = live.current.project.state;
        return s ? commands(s, indexesFor(s)).restoreFlow({ commandId: Crypto.randomUUID(), laneId: lane, previous }) : [];
      });
    setBusy(false);
  }

  return (
    <Screen header={<Header title="Review Flows" sub={fixedLane && state ? laneName(state, fixedLane) : projectName(ctx)} onBack={ctx.back} />}>
      <Intro>
        {fixedLane
          ? 'The flow is advice: it suggests what should happen next. Steps can be done in any order or set aside with a reason; only checkpoints are required.'
          : `Each language runs one review flow. This view covers the ${plural(uses.length, 'language')} in this project. Flows are advice; checkpoints are the only hard stops.`}
      </Intro>
      {!state ? <EmptyState icon="flow" title="Loading…" /> : uses.length === 0 ? (
        <EmptyState icon="globe" title="No languages yet" sub="Add a language, then choose how its passages get checked." />
      ) : (
        <>
          {!fixedLane && uses.length > 1 ? (
            <>
              <SectionLabel label="Choose for" />
              <ChipRow>
                {uses.map((u) => <Chip key={u.laneId} label={u.name} on={u.laneId === laneId} onPress={() => setPicked(u.laneId)} />)}
              </ChipRow>
            </>
          ) : null}
          {current ? (
            <Card>
              <Text style={txt.xsStrong}>{current.name} uses</Text>
              <Text style={txt.h3}>{flowLabel(current)}</Text>
              <FlowStepsInline steps={current.steps} kinds={kinds} />
              {canManage ? <SmallBtn label="Edit steps" icon="edit" onPress={() => ctx.go('flow_editor', { laneId: current.laneId })} /> : null}
            </Card>
          ) : null}
          <SectionLabel label="Flows" />
          {FLOWS.map((f) => {
            const on = current?.flowId === f.id;
            const others = uses.filter((u) => u.flowId === f.id && u.laneId !== laneId).map((u) => u.name);
            return (
              <Card key={f.id} style={on ? { borderColor: C.primary, borderWidth: 1.5 } : undefined}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
                  <View style={{ flex: 1 }}>
                    <Text style={txt.h3}>{f.name}</Text>
                    <Text style={[txt.smMuted, { marginTop: 2 }]}>{f.description}</Text>
                  </View>
                  {on
                    ? <SmallBtn label="In use" icon="check" tone="primary" onPress={() => {}} />
                    : <SmallBtn label="Use" onPress={() => void use(f.id)} disabled={!canManage || busy || !current} />}
                </View>
                <FlowStepsInline steps={f.steps.map((s) => ({ kindIds: s.kindIds, checkpoint: !!s.checkpoint }))} kinds={kinds} />
                {others.length ? <Text style={[txt.xsStrong, { color: C.primary }]}>{`${on ? 'Also used by' : 'Used by'} ${others.join(', ')}`}</Text> : null}
              </Card>
            );
          })}
          {uses.length > 1 ? (
            <Disclosure icon="globe" title="By language" summary={`${plural(uses.length, 'language')} · ${[...new Set(uses.map(flowLabel))].slice(0, 2).join(', ')}`}
              open={byLanguage.open} onToggle={byLanguage.onToggle}>
              {uses.map((u, i) => (
                <Row key={u.laneId} icon="globe" label={u.name} sub={flowLabel(u)} last={i === uses.length - 1}
                  onPress={fixedLane ? undefined : () => setPicked(u.laneId)} />
              ))}
            </Disclosure>
          ) : null}
        </>
      )}
    </Screen>
  );
}

export function FlowEditor(ctx: Ctx) {
  const state = ctx.project.state;
  const laneId = ctx.params['laneId'] ?? ctx.laneId ?? '';
  const [initial] = useState<DraftStep[]>(() => (state && laneId ? draftFromLane(state, laneId) : []));
  const [steps, setSteps] = useState<DraftStep[]>(initial);
  const [added, setAdded] = useState<KindDef[]>([]);
  const [pickFor, setPickFor] = useState<number | null>(null);
  const [newKind, setNewKind] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = useLatest(ctx);
  const known = useMemo(() => (state ? deriveKinds(state) : []), [state]);
  const kinds = useMemo(() => [...known, ...added.filter((k) => !known.some((x) => x.id === k.id))], [known, added]);
  const kindName = (id: string) => kinds.find((k) => k.id === id)?.name ?? id;
  const readOnly = !ctx.session.can('manage_flows');
  const dirty = !readOnly && (draftChanged(initial, steps) || added.length > 0);
  const lane = state && laneId ? laneName(state, laneId) : 'This language';
  const matched = catalogFlowOf(steps.filter((s) => s.kindIds.length), null);

  if (!state || !laneId || !state.lanes[laneId]) {
    return (
      <Screen header={<Header title="Review Flow" onBack={ctx.back} />}>
        <EmptyState icon="flow" title={state ? 'Choose a language first' : 'Loading…'} sub={state ? 'Each language runs its own review flow.' : undefined} />
      </Screen>
    );
  }

  const patch = (i: number, p: Partial<DraftStep>) => setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const addKind = (i: number, id: string) => { patch(i, { kindIds: [...(steps[i]?.kindIds ?? []), id] }); setPickFor(null); };
  const closePicker = () => {
    // A step added for this pick and left empty goes away again (demo KindPickerSheet onClose).
    setSteps((prev) => prev.filter((s, j) => j !== pickFor || s.kindIds.length > 0));
    setPickFor(null);
  };

  async function save() {
    const s = ctx.project.state;
    if (!s || readOnly || busy) return;
    const c = commands(s, indexesFor(s));
    const previous = deriveFlow(s, laneId);
    setBusy(true);
    const saved = await actCommand(ctx, 'save flow', () => [
      ...added.flatMap((k) => c.defineKind({ commandId: Crypto.randomUUID(), kindId: k.id, name: k.name, description: k.description, usualReviewer: k.usualReviewer })),
      ...c.saveFlowSteps({ commandId: Crypto.randomUUID(), laneId, steps: stepsToSave(s, laneId, steps) })
    ], `${lane}'s review flow saved.`, () => {
      const now = live.current.project.state;
      return now ? commands(now, indexesFor(now)).restoreFlow({ commandId: Crypto.randomUUID(), laneId, previous }) : [];
    });
    if (saved) ctx.back();
    else setBusy(false);
  }

  const picking = pickFor !== null ? steps[pickFor] : undefined;
  return (
    <Screen
      header={<Header title="Review Flow" sub={`${lane} · ${matched ? FLOWS.find((f) => f.id === matched)?.name : steps.length ? 'Its own steps' : 'Collect only'}`}
        onBack={() => (dirty ? setLeaving(true) : ctx.back())} />}
      footer={readOnly ? undefined : <PrimaryBtn label="Save Flow" onPress={() => void save()} disabled={!dirty} busy={busy} />}>
      <Banner icon="flow" title="Steps are a suggested order"
        body="Kinds in the same step can happen together. Anyone can set a step aside with a reason; a checkpoint is the only hard stop. Moving past one needs the Override Checkpoints permission, and the reason is recorded." />
      {steps.length === 0 ? (
        <Card style={{ borderStyle: 'dashed', borderWidth: 1.5, alignItems: 'center' }}>
          <Text style={txt.h3}>Collect only</Text>
          <Text style={[txt.smMuted, { textAlign: 'center' }]}>No reviews. A passage counts as done once it's recorded. Teams can still record reviews; they just aren't suggested.</Text>
        </Card>
      ) : steps.map((st, i) => (
        <View key={st.key} style={{ gap: space.sm }}>
          {i > 0 ? (
            <View style={styles.then}>
              <View style={styles.thenLine} />
              <Text style={txt.label}>{steps[i - 1]!.checkpoint ? 'then, once cleared' : 'then'}</Text>
            </View>
          ) : null}
          <Card style={st.checkpoint ? { borderColor: C.amber, borderWidth: 1.5 } : undefined}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={[styles.stepNo, { backgroundColor: st.checkpoint ? C.amber : C.primary }]}>
                <Text style={[txt.xsStrong, { color: C.white }]}>{i + 1}</Text>
              </View>
              <Text style={[txt.label, { flex: 1 }]}>{st.kindIds.length > 1 ? 'Together' : 'Step'}</Text>
              {!readOnly ? (
                <>
                  {i > 0 ? <IconBtn name="up" label="Move up" onPress={() => setSteps(moveStep(steps, i, -1))} bg="transparent" color={C.muted} /> : null}
                  {i < steps.length - 1 ? <IconBtn name="down" label="Move down" onPress={() => setSteps(moveStep(steps, i, 1))} bg="transparent" color={C.muted} /> : null}
                  <IconBtn name="trash" label="Remove step" onPress={() => setSteps(steps.filter((_, j) => j !== i))} bg="transparent" color={C.muted} />
                </>
              ) : null}
            </View>
            {st.kindIds.map((id) => (
              <View key={id} style={styles.kindLine}>
                <KindIcon kindId={id} size={40} />
                <Text style={[txt.body, { flex: 1, fontWeight: '600' }]}>{kindName(id)}</Text>
                {!readOnly ? <IconBtn name="close" label={`Remove ${kindName(id)}`} onPress={() => patch(i, { kindIds: st.kindIds.filter((k) => k !== id) })} bg={C.light} color={C.primary} /> : null}
              </View>
            ))}
            {!readOnly ? <SmallBtn label={st.kindIds.length ? 'Alongside' : 'Add kind'} icon="plus" onPress={() => setPickFor(i)} /> : null}
            <View style={styles.checkpoint}>
              <Ico name="lock" size={18} color={st.checkpoint ? TINT.amberText : C.muted} />
              <View style={{ flex: 1 }}>
                <Text style={[txt.sm, { fontWeight: '700', color: st.checkpoint ? TINT.amberText : C.dark }]}>Checkpoint</Text>
                <Text style={txt.xs}>{st.checkpoint ? 'Later steps wait for this one.' : 'Can be set aside with a reason.'}</Text>
              </View>
              <Toggle on={st.checkpoint} disabled={readOnly} label="Checkpoint" onToggle={() => patch(i, { checkpoint: !st.checkpoint })} />
            </View>
          </Card>
        </View>
      ))}
      {!readOnly ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <GhostBtn label="Add step" icon="plus" onPress={() => { setSteps([...steps, { key: Crypto.randomUUID(), kindIds: [], checkpoint: false }]); setPickFor(steps.length); }} />
          </View>
          {steps.length > 0 ? <SmallBtn label="Collect only" onPress={() => setSteps([])} /> : null}
        </View>
      ) : null}
      <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>
        Used by {lane}. Changes apply to its passages right away; nothing already recorded is lost.
      </Text>

      <Sheet visible={pickFor !== null} title="Add a kind of review" sub="Kinds are your organization's vocabulary. Add your own if these don't fit." onClose={closePicker}>
        <Group>
          {kinds.filter((k) => !(picking?.kindIds ?? []).includes(k.id)).map((k, i, a) => (
            <Row key={k.id} leading={<KindIcon kindId={k.id} size={40} />} label={k.name} sub={k.description || k.usualReviewer || undefined}
              onPress={() => pickFor !== null && addKind(pickFor, k.id)} last={i === a.length - 1} />
          ))}
        </Group>
        <Field label="A new kind" value={newKind} onChangeText={setNewKind} placeholder="New kind, e.g. Elder Review" autoCapitalize="words" />
        <SmallBtn label="Add this kind" icon="plus" tone="primary" disabled={!newKind.trim()} onPress={() => {
          if (pickFor === null || !newKind.trim()) return;
          const k: KindDef = { id: newKindId(newKind, kinds.map((x) => x.id)), name: newKind.trim(), description: 'Defined by your organization.', usualReviewer: 'Anyone the team chooses' };
          setAdded([...added, k]);
          setNewKind('');
          addKind(pickFor, k.id);
        }} />
      </Sheet>

      <Sheet visible={leaving} title="Leave without saving?" sub="Your changes to this flow haven't been saved." onClose={() => setLeaving(false)}
        footer={<>
          <PrimaryBtn label="Save Flow" onPress={() => { setLeaving(false); void save(); }} busy={busy} />
          <GhostBtn label="Discard changes" tone="red" onPress={() => { setLeaving(false); ctx.back(); }} />
        </>}>
        {null}
      </Sheet>
    </Screen>
  );
}

// ─── Reference library (ORG-8) ─────────────────────────────────────────────────────

const referenceKindName = (kind: string) => REFERENCE_KINDS.find((k) => k.id === kind)?.name ?? fieldLabel(kind);

function materialScopeName(state: ProjectState, m: Pick<MaterialView, 'scope'>): string {
  if (m.scope.unitId) return unitTitle(state, m.scope.unitId);
  if (m.scope.laneId) return `${laneName(state, m.scope.laneId)} team`;
  return 'Whole project';
}

/** The shipped question sets, which every reviewer of their kind sees (core `questionsForKind`). */
const SHIPPED_SETS = QUESTION_TEMPLATES.filter((t) => t.stageId).map((t) => ({ ...t, kindId: V1_STAGE_KINDS[t.stageId!] ?? t.stageId! }));

export function ReferenceHome(ctx: Ctx) {
  const state = ctx.project.state;
  const laneId = ctx.params['laneId'] ?? null;
  const view = useMemo(() => (state ? referenceView(state, laneId) : null), [state, laneId]);
  const kinds = useMemo(() => (state ? deriveKinds(state) : []), [state]);
  const canManage = ctx.session.can('manage_reference');
  const termLane = laneId ?? (ctx.laneId && state?.lanes[ctx.laneId] ? ctx.laneId : Object.keys(state?.lanes ?? {})[0]) ?? null;
  const termCount = useMemo(() => (state && termLane ? keyTermsFor(state, termLane).length : 0), [state, termLane]);
  const byLanguage = ctx.details('reference:by-language');
  const bibles = ctx.details('reference:source-bibles');
  if (!state || !view) return <Screen header={<Header title="Reference Material" onBack={ctx.back} />}><EmptyState title="Loading…" /></Screen>;

  const levelName = laneId ? laneName(state, laneId) : projectName(ctx);
  const open = (m: MaterialView) => (canManage ? () => ctx.go('material_editor', { materialId: m.materialId, ...(laneId ? { laneId } : {}) }) : undefined);
  const generalRow = (m: MaterialView, last: boolean) => (
    <Row key={m.materialId} icon="book" label={m.title} last={last} badge={m.locked ? 'Locked' : undefined}
      sub={`${referenceKindName(m.kind)} · ${materialScopeName(state, m)}${m.blanks > 0 ? ` · ${plural(m.blanks, 'blank')}` : ''}`} onPress={open(m)} />
  );
  const sets = [...view.questionSets].sort((a, b) => {
    const ia = kinds.findIndex((k) => k.id === a.scope.stepId), ib = kinds.findIndex((k) => k.id === b.scope.stepId);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  const shipped = SHIPPED_SETS.filter((t) => kinds.some((k) => k.id === t.kindId));
  const kindNameOf = (id: string) => kinds.find((k) => k.id === id)?.name ?? id;

  return (
    <Screen header={<Header title="Reference Material" sub={levelName} onBack={ctx.back} />}
      footer={canManage ? <PrimaryBtn label="Add material" icon="plus" onPress={() => ctx.go('material_editor', laneId ? { laneId } : {})} /> : undefined}>
      <Intro>
        Context lives at the level it holds and adds up; nothing is copied. Translators see it in the workspace tray; reviewers see the questions for their kind of review.
      </Intro>

      <SectionLabel label="Key terms" />
      <Group>
        <Row icon="book" label="Key Terms" last
          sub={termLane ? `${plural(termCount, 'concept')} · ${laneName(state, termLane)} renderings` : 'Add a language first'}
          onPress={termLane ? () => ctx.go('key_terms', { laneId: termLane }) : undefined} />
      </Group>

      <SectionLabel label={`Study material · ${view.study.length}`} />
      <Capped items={view.study} empty="No study material for this view." render={(m, last) => (
        <Row key={m.materialId} icon="sparkle" label={m.title} last={last} badge={m.locked ? 'Locked' : undefined}
          sub={`Study guide · ${materialScopeName(state, m)}${m.blanks > 0 ? ` · ${plural(m.blanks, 'blank')}` : ''}`} onPress={open(m)} />
      )} />

      <SectionLabel label={`Review questions · ${sets.length + shipped.length}`} />
      <Capped items={[...sets.map((m) => ({ m, t: null })), ...shipped.map((t) => ({ m: null, t }))]} render={(item, last) => item.m ? (
        <Row key={item.m.materialId} icon="chat" label={item.m.title} last={last} badge={item.m.locked ? 'Locked' : undefined}
          sub={`${setKindName(kinds, item.m) ?? 'Not tied to a kind of review'} · ${questionCountLabel(questionCount(item.m))} · ${materialScopeName(state, item.m)}`}
          onPress={open(item.m)} />
      ) : (
        <Row key={item.t!.id} icon="chat" label={item.t!.name} last={last}
          sub={`${kindNameOf(item.t!.kindId)} · ${questionCountLabel(item.t!.questions.length)} · Organization`} />
      )} />
      <Intro>Question sets for the same kind add up: a reviewer sees the organization's, the project's, and the language team's together, labelled by source.</Intro>

      <SectionLabel label={`General · ${levelName} · ${view.atLevel.length}`} />
      <Capped items={view.atLevel} empty="No general materials at this level yet." render={generalRow} />

      {view.higher.length > 0 ? (
        <>
          <SectionLabel label="From higher levels · available here" />
          <Capped items={view.higher} render={generalRow} />
        </>
      ) : null}

      {!laneId && view.byLanguage.length > 0 ? (
        <Disclosure icon="globe" title="By language" summary={view.byLanguage.map((g) => `${laneName(state, g.laneId)} · ${g.items.length}`).join(' · ')}
          open={byLanguage.open} onToggle={byLanguage.onToggle}>
          {view.byLanguage.flatMap((g, gi) => g.items.map((m, i) => generalRow(m, gi === view.byLanguage.length - 1 && i === g.items.length - 1)))}
        </Disclosure>
      ) : null}

      <SourceBibles ctx={ctx} open={bibles.open} onToggle={bibles.onToggle} />
    </Screen>
  );
}

/** Source Bibles the organization adds and a project may leave out (the settings the old library held). */
function SourceBibles(props: { ctx: Ctx; open: boolean; onToggle: () => void }) {
  const { ctx } = props;
  const org = ctx.org.state;
  const [busy, setBusy] = useState(false);
  if (!org) return null;
  const canOrg = privilegesFor(org, ctx.session.actorId, {}).has('manage_reference');
  const canProject = ctx.session.can('manage_reference');
  const added = SOURCE_BIBLES.filter((b) => sourceBibleEnabled(org, b.id));
  async function toggle(id: string, name: string, enabled: boolean, level: 'org' | 'project') {
    if (busy) return;
    const payload = { kind: 'reference' as const, itemId: id, level, ...(level === 'project' ? { projectId: ctx.project.projectId } : {}) };
    setBusy(true);
    try {
      await ctx.org.append('v1.CatalogItemToggled', { ...payload, enabled });
      ctx.toast(`${name} ${enabled ? 'added' : 'turned off'}${level === 'project' ? ' for this project' : ''}.`, async () => {
        try { await ctx.org.append('v1.CatalogItemToggled', { ...payload, enabled: !enabled }); ctx.toast('Undone.'); } catch (e) { ctx.toast(`Not undone. ${failure('undo source bible', e)}`); }
      });
    } catch (e) {
      ctx.toast(`Not saved. ${failure('toggle source bible', e)}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Disclosure icon="sound" title="Source Bibles" summary={added.length ? added.map((b) => b.code).join(' · ') : 'None added yet'} open={props.open} onToggle={props.onToggle}>
      {SOURCE_BIBLES.map((b, i) => (
        <ToggleRow key={b.id} label={b.name} desc={`For the organization · English · ${b.narrator} · chapter audio · CC0`}
          on={sourceBibleEnabled(org, b.id)} disabled={busy || !canOrg} onToggle={() => void toggle(b.id, b.name, !sourceBibleEnabled(org, b.id), 'org')}
          last={i === SOURCE_BIBLES.length - 1 && added.length === 0} />
      ))}
      {added.map((b, i) => {
        const on = org.catalog[catalogKey('reference', b.id, 'project', ctx.project.projectId)]?.value ?? true;
        return (
          <ToggleRow key={`p-${b.id}`} label={`${b.name} in this project`} desc="Turn off to leave it out of this project."
            on={on} disabled={busy || !canProject} onToggle={() => void toggle(b.id, b.name, !on, 'project')} last={i === added.length - 1} />
        );
      })}
    </Disclosure>
  );
}

const QUESTION_TYPES: { id: QuestionSpec['type']; label: string }[] = [
  { id: 'text', label: 'Text' }, { id: 'yesno', label: 'Yes / No' }, { id: 'rating', label: '1–5' }
];

/** A question field as stored: `[yesno!] Is it clear?`; an empty question clears the field. */
function storedQuestion(q: Pick<QuestionDraft, 'text' | 'type' | 'required'>): string {
  return q.text.trim() ? formatQuestionField({ text: q.text.trim(), type: q.type, required: q.required }) : '';
}
/** Legacy question text without a type prefix reads as the same question once formatted. */
function normalizedQuestion(raw: string): string {
  if (!raw.trim()) return '';
  const [type, required, text] = parseQuestionField(raw);
  return storedQuestion({ text, type, required });
}

export function MaterialEditor(ctx: Ctx) {
  const state = ctx.project.state;
  const materialId = ctx.params['materialId'];
  const laneParam = ctx.params['laneId'];
  const isNew = !materialId;
  const existing = useMemo(() => (state && materialId ? materialView(state, materialId) : null), [state, materialId]);
  const kinds = useMemo(() => (state ? deriveKinds(state) : []), [state]);
  const canManage = ctx.session.can('manage_reference');
  // A new material: what it is, where it applies, and which review its questions are for.
  const [kind, setKind] = useState(canManage ? 'tg' : 'questions');
  const [title, setTitle] = useState('');
  const [forLane, setForLane] = useState(!!laneParam);
  const [reviewKind, setReviewKind] = useState('peer');
  // Edits: only touched fields are written (each field is its own register, so two people filling different blanks both land).
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [extraFields, setExtraFields] = useState<string[]>([]);
  const [newField, setNewField] = useState('');
  const [questions, setQuestions] = useState<QuestionDraft[] | null>(isNew ? [{ fieldId: 'q1', text: '', type: 'text', required: false }] : null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(STEP);
  const baseQuestions = useMemo(() => questionDrafts(existing), [existing]);

  if (!state || (!isNew && !existing)) {
    return <Screen header={<Header title="Edit Material" onBack={ctx.back} />}><EmptyState icon="book" title={state ? 'This material is not here any more' : 'Loading…'} /></Screen>;
  }

  const materialKind = existing?.kind ?? kind;
  const isQuestions = materialKind === 'questions';
  const locked = !!existing?.locked;
  const canFill = canManage || (ctx.session.can('fill_reference') && !locked && (existing !== null || isQuestions));
  const qs = questions ?? baseQuestions;
  const before = (fieldId: string) => existing?.fields.find((f) => f.fieldId === fieldId)?.text ?? '';
  // A new FIA study follows its template (summary, key ideas, scenes, discussion); other new material starts with one section.
  const newTemplateRef = isNew && materialKind === 'fia_study' ? 'fia_study' : undefined;
  const fieldIds = [...new Set([
    ...templateFields(existing?.templateRef ?? newTemplateRef), ...(existing?.fields.map((f) => f.fieldId) ?? []),
    ...(isNew && !newTemplateRef ? ['body'] : []), ...extraFields
  ])];
  const valueOf = (fieldId: string) => texts[fieldId] ?? before(fieldId);

  // What saving would write.
  const changes: { fieldId: string; text: string; before: string }[] = [];
  if (isQuestions) {
    for (const q of qs) {
      const text = storedQuestion(q);
      if (text !== normalizedQuestion(before(q.fieldId))) changes.push({ fieldId: q.fieldId, text, before: before(q.fieldId) });
    }
    for (const q of baseQuestions) if (!qs.some((x) => x.fieldId === q.fieldId)) changes.push({ fieldId: q.fieldId, text: '', before: before(q.fieldId) });
  } else {
    for (const fieldId of fieldIds) {
      const draft = texts[fieldId];
      if (draft !== undefined && draft.trim() !== before(fieldId)) changes.push({ fieldId, text: draft.trim(), before: before(fieldId) });
    }
  }
  const ready = isNew ? title.trim() !== '' && (!isQuestions || changes.some((c) => c.text)) : changes.length > 0;

  async function save() {
    if (!canFill || busy || !ready) return;
    const s = state!;
    const id = existing?.materialId ?? `${materialKind}-${Crypto.randomUUID()}`;
    const c = commands(s, indexesFor(s));
    const fields = changes.map((f) => ({ fieldId: f.fieldId, text: f.text }));
    setBusy(true);
    const saved = await actCommand(ctx, 'save material', () => (isNew
      ? c.defineMaterial({
        commandId: Crypto.randomUUID(), materialId: id, kind: materialKind, title: title.trim(), fields,
        ...(newTemplateRef ? { templateRef: newTemplateRef } : {}),
        scope: { ...(forLane && laneParam ? { laneId: laneParam } : {}), ...(isQuestions ? { stepId: reviewKind } : {}) }
      })
      : c.setMaterialFields({ commandId: Crypto.randomUUID(), materialId: id, fields })),
    isNew ? `${title.trim()} added.` : 'Saved.',
    isNew ? undefined : () => c.setMaterialFields({ commandId: Crypto.randomUUID(), materialId: id, fields: changes.map((f) => ({ fieldId: f.fieldId, text: f.before })) }));
    if (saved) ctx.back();
    else setBusy(false);
  }

  function toggleLock() {
    if (!existing || !canManage) return;
    const to = !locked;
    const c = commands(state!, indexesFor(state!));
    void actCommand(ctx, 'lock material', () => c.lockMaterial({ commandId: Crypto.randomUUID(), materialId: existing.materialId, locked: to }),
      to ? 'Locked. Only people who manage reference material can edit it.' : 'Unlocked. Anyone who fills reference content can edit it.',
      () => c.lockMaterial({ commandId: Crypto.randomUUID(), materialId: existing.materialId, locked: !to }));
  }

  const setQuestion = (i: number, p: Partial<QuestionDraft>) => setQuestions(qs.map((q, j) => (j === i ? { ...q, ...p } : q)));
  const kindOfSet = existing ? setKindName(kinds, existing) : null;
  const fieldTitle = (fieldId: string) => (state.units[fieldId] ? unitTitle(state, fieldId) : fieldLabel(fieldId));

  return (
    <Screen
      header={<Header title={existing?.title ?? 'New material'} sub={existing ? materialScopeName(state, existing) : laneParam ? laneName(state, laneParam) : projectName(ctx)} onBack={ctx.back}
        action={existing && canManage ? <SmallBtn label={locked ? 'Locked' : 'Unlocked'} icon="lock" tone={locked ? 'dark' : undefined} onPress={toggleLock} />
          : existing && locked ? <Badge label="Locked" tone="red" /> : undefined} />}
      footer={canFill ? <PrimaryBtn label={isNew ? 'Add material' : 'Save Changes'} onPress={() => void save()} disabled={!ready} busy={busy} /> : undefined}>
      {existing ? (
        <Text style={txt.xs}>
          {referenceKindName(existing.kind)} · by {ctx.name(existing.createdBy)}{kindOfSet ? ` · questions for ${kindOfSet}` : ''}
        </Text>
      ) : null}
      {existing && existing.blanks > 0 ? <Banner icon="edit" tone="amber" title={`${plural(existing.blanks, 'unfilled blank')}`} /> : null}
      {existing && locked && !canFill ? <Banner icon="lock" title="Locked" body="Only people who manage reference material can edit it. You can still read it." /> : null}

      {isNew ? (
        <>
          <SectionLabel label="What kind" />
          <Group>
            {REFERENCE_KINDS.filter((k) => k.id !== 'key_terms' && (canManage || k.id === 'questions')).map((k, i, a) => (
              <Row key={k.id} label={k.name} sub={k.code} onPress={() => setKind(k.id)} last={i === a.length - 1}
                role="radio" selected={kind === k.id}
                right={kind === k.id ? <Ico name="check" size={22} color={C.primary} /> : <View style={{ width: 22 }} />} />
            ))}
          </Group>
          <Field label="Title" value={title} onChangeText={setTitle} placeholder={isQuestions ? 'e.g. Peer Review questions' : 'e.g. Dinka translation guidelines'} autoCapitalize="sentences" />
          {laneParam ? (
            <>
              <SectionLabel label="Where it applies" />
              <ChipRow>
                <Chip label={laneName(state, laneParam)} icon="globe" on={forLane} onPress={() => setForLane(true)} />
                <Chip label="Whole project" icon="folder" on={!forLane} onPress={() => setForLane(false)} />
              </ChipRow>
            </>
          ) : null}
          {isQuestions ? (
            <>
              <SectionLabel label="For which kind of review" />
              <Group>
                {kinds.map((k, i) => (
                  <Row key={k.id} leading={<KindIcon kindId={k.id} size={40} />} label={k.name} onPress={() => setReviewKind(k.id)} last={i === kinds.length - 1}
                    role="radio" selected={reviewKind === k.id}
                    right={reviewKind === k.id ? <Ico name="check" size={22} color={C.primary} /> : <View style={{ width: 22 }} />} />
                ))}
              </Group>
            </>
          ) : null}
        </>
      ) : null}

      {isQuestions ? (
        <>
          <SectionLabel label={`Questions · ${qs.filter((q) => q.text.trim()).length}`} />
          {qs.map((q, i) => (
            <Card key={q.fieldId}>
              {canFill ? (
                <>
                  <Field value={q.text} onChangeText={(v) => setQuestion(i, { text: v })} placeholder="The question" multiline />
                  <ChipRow>
                    {QUESTION_TYPES.map((t) => <Chip key={t.id} label={t.label} on={q.type === t.id} onPress={() => setQuestion(i, { type: t.id })} />)}
                  </ChipRow>
                  <View style={styles.checkpoint}>
                    <View style={{ flex: 1 }}>
                      <Text style={[txt.sm, { fontWeight: '700' }]}>{q.required ? 'Required' : 'Suggested'}</Text>
                      <Text style={txt.xs}>{q.required ? 'Reviewers answer it, or say why not.' : 'Reviewers may skip it.'}</Text>
                    </View>
                    <Toggle on={q.required} label="Required" onToggle={() => setQuestion(i, { required: !q.required })} />
                  </View>
                  <SmallBtn label="Remove question" icon="trash" onPress={() => setQuestions(qs.filter((_, j) => j !== i))} />
                </>
              ) : (
                <>
                  <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                    <Text style={txt.label}>{QUESTION_TYPES.find((t) => t.id === q.type)?.label}</Text>
                    {q.required ? <Badge label="Required" tone="brand" /> : null}
                  </View>
                  <Text style={txt.body}>{q.text}</Text>
                </>
              )}
            </Card>
          ))}
          {qs.length === 0 && !canFill ? <Card><Text style={txt.smMuted}>No questions yet.</Text></Card> : null}
          {canFill ? <GhostBtn label="Add question" icon="plus" onPress={() => setQuestions([...qs, { fieldId: nextFieldId([...qs.map((x) => x.fieldId), ...(existing?.fields.map((f) => f.fieldId) ?? [])]), text: '', type: 'text', required: false }])} /> : null}
        </>
      ) : (
        <>
          <SectionLabel label={`Sections · ${fieldIds.length}`} />
          {fieldIds.slice(0, shown).map((fieldId) => (
            <Card key={fieldId}>
              <Text style={txt.h3}>{fieldTitle(fieldId)}</Text>
              {canFill
                ? <Field value={valueOf(fieldId)} onChangeText={(v) => setTexts({ ...texts, [fieldId]: v })} placeholder={`Guidance for ${fieldTitle(fieldId)}…`} multiline />
                : <Text style={valueOf(fieldId) ? txt.body : txt.bodyMuted}>{valueOf(fieldId) || 'Not filled in yet.'}</Text>}
            </Card>
          ))}
          <ShowMore remaining={fieldIds.length - shown} step={STEP} onMore={() => setShown(shown + STEP)} />
          {canFill ? (
            <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
              <View style={{ flex: 1 }}>
                <Field label="Add a section" value={newField} onChangeText={setNewField} placeholder="e.g. Names" autoCapitalize="sentences" />
              </View>
              <SmallBtn label="Add" icon="plus" disabled={!newField.trim()} onPress={() => {
                const id = newKindId(newField, fieldIds);
                setExtraFields([...extraFields, id]);
                setNewField('');
              }} />
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

// ─── Key terms (TERM-1..6) ─────────────────────────────────────────────────────────

function TermRow(props: { t: KeyTermView; lane: string; onPress: () => void; last: boolean }) {
  const { t } = props;
  const has = t.renderings.length > 0;
  return (
    <Row icon="book" iconColor={has ? C.primary : TINT.amberText} iconBg={has ? undefined : TINT.amber}
      label={t.term} badge={isFiaTerm(t) ? 'FIA' : undefined}
      sub={has ? t.renderings.map((r) => r.rendering).join(' · ') : `No ${props.lane} rendering yet`}
      onPress={props.onPress} last={props.last} />
  );
}

export function KeyTerms(ctx: Ctx) {
  const state = ctx.project.state;
  const laneId = ctx.params['laneId'] ?? ctx.laneId ?? '';
  const unitId = ctx.params['unitId'];
  const takeId = ctx.params['takeId'];
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ term: '', gloss: '', rendering: '', context: '' });
  const [busy, setBusy] = useState(false);
  const terms = useMemo(() => (state && laneId ? keyTermsFor(state, laneId) : []), [state, laneId]);
  const here = useMemo(() => (state && unitId && state.units[unitId] ? termsInPassage(state, terms, unitId, sourceText(state, unitId)) : new Set<string>()), [state, terms, unitId]);
  const canAdd = ctx.session.can('fill_reference') || ctx.session.can('manage_reference');
  if (!state || !laneId || !state.lanes[laneId]) {
    return <Screen header={<Header title="Key Terms" onBack={ctx.back} />}><EmptyState icon="book" title={state ? 'Choose a language first' : 'Loading…'} /></Screen>;
  }
  const lane = laneName(state, laneId);
  const matching = terms.filter((t) => matchesTerm(t, q));
  const inPassage = matching.filter((t) => here.has(t.termId));
  const rest = matching.filter((t) => !here.has(t.termId));
  const open = (t: KeyTermView) => ctx.go('key_term_detail', { termId: t.termId, laneId, ...(unitId ? { unitId } : {}), ...(takeId ? { takeId } : {}) });

  async function add() {
    if (!state || busy || !draft.term.trim() || !draft.rendering.trim()) return;
    const termId = `kt-${Crypto.randomUUID()}`;
    const book = unitId ? state.units[unitId]?.parentUnitId ?? unitId : null;
    const during = unitId ? derivePassage(state, unitId, laneId, indexesFor(state)) : null;
    const duringTakeId = during?.draftTakeId ?? during?.latest?.takeId;
    setBusy(true);
    // TERM-6: the concept, its first rendering, and that as its first adjustment (who, when, which passage).
    const saved = await actCommand(ctx, 'add key term', () => commands(state, indexesFor(state)).defineKeyTerm({
      commandId: Crypto.randomUUID(), termId, laneId, term: draft.term, gloss: draft.gloss, unitScope: book ? [book] : [],
      rendering: draft.rendering, context: draft.context,
      note: draft.context.trim() || `First rendering: ${draft.rendering.trim()}.`, ...(duringTakeId ? { duringTakeId } : {})
    }), `${draft.term.trim()} added.`);
    if (saved) {
      setDraft({ term: '', gloss: '', rendering: '', context: '' });
      setAdding(false);
    }
    setBusy(false);
  }

  return (
    <Screen header={<Header title="Key Terms" sub={unitId && state.units[unitId] ? `${unitTitle(state, unitId)} · ${lane}` : `${lane} renderings`} onBack={ctx.back}
      action={canAdd ? <SmallBtn label="New term" icon="plus" onPress={() => setAdding(true)} /> : undefined} />}>
      <SearchField value={q} onChangeText={setQ} placeholder="Search terms" />
      {terms.length === 0 ? (
        <EmptyState icon="book" title="No key terms yet" sub={canAdd ? 'Add a term with how this language says it, and when to use it.' : 'Terms your team adds show here with their renderings.'} />
      ) : (
        <>
          {inPassage.length > 0 ? (
            <>
              <SectionLabel label={`In this passage · ${inPassage.length}`} />
              <Capped items={inPassage} render={(t, last) => <TermRow key={t.termId} t={t} lane={lane} onPress={() => open(t)} last={last} />} />
            </>
          ) : null}
          <SectionLabel label={`${inPassage.length ? 'Other terms' : 'All terms'} · ${rest.length}`} />
          <Capped items={rest} empty={q ? `Nothing matches “${q}”.` : 'No other terms.'} render={(t, last) => <TermRow key={t.termId} t={t} lane={lane} onPress={() => open(t)} last={last} />} />
        </>
      )}
      <Intro>Concepts come from your organization's list (like FIA key terms) or your project. Each language keeps its own renderings and the reasons behind them.</Intro>

      <Sheet visible={adding} title="New key term" sub="Added to your project's list. Other languages can add their own renderings." onClose={() => setAdding(false)}
        footer={<PrimaryBtn label="Add Term" onPress={() => void add()} disabled={!draft.term.trim() || !draft.rendering.trim()} busy={busy} />}>
        <Field value={draft.term} onChangeText={(v) => setDraft({ ...draft, term: v })} placeholder="Source term, e.g. grace (charis)" />
        <Field value={draft.gloss} onChangeText={(v) => setDraft({ ...draft, gloss: v })} placeholder="Meaning, briefly" autoCapitalize="sentences" />
        <Field value={draft.rendering} onChangeText={(v) => setDraft({ ...draft, rendering: v })} placeholder={`${lane} rendering`} />
        <Field value={draft.context} onChangeText={(v) => setDraft({ ...draft, context: v })} placeholder="When to use it, and why" multiline autoCapitalize="sentences" />
      </Sheet>
    </Screen>
  );
}

export function KeyTermDetail(ctx: Ctx) {
  const state = ctx.project.state;
  const termId = ctx.params['termId'] ?? '';
  const unitId = ctx.params['unitId'];
  const t = useMemo(() => (state ? keyTermView(state, termId) : null), [state, termId]);
  const laneId = t?.laneId || ctx.params['laneId'] || ctx.laneId || '';
  const passage = useMemo(() => (state && unitId && laneId && state.units[unitId] ? derivePassage(state, unitId, laneId, indexesFor(state)) : null), [state, unitId, laneId]);
  const usedIn = useMemo(() => {
    if (!state) return [];
    const idx = indexesFor(state);
    return takesLinkingTerm(state, termId).flatMap((l) => {
      const take = state.takes[l.takeId];
      if (!take) return [];
      const v = derivePassage(state, take.unitId, take.laneId, idx).versions.find((x) => x.takeId === l.takeId);
      return v ? [{ ...l, unitId: take.unitId, laneId: take.laneId, title: unitTitle(state, take.unitId), n: v.n, by: v.by, hlc: v.hlc }] : [];
    });
  }, [state, termId]);
  const others = useMemo(() => (state && t ? otherLanguageRenderings(state, t) : []), [state, t]);
  const [adjusting, setAdjusting] = useState(false);
  const [rendering, setRendering] = useState('');
  const [context, setContext] = useState('');
  const [note, setNote] = useState('');
  const [hash, setHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [usedShown, setUsedShown] = useState(STEP);
  const why = ctx.details(`term:${termId}:why`);
  const used = ctx.details(`term:${termId}:used`);
  const other = ctx.details(`term:${termId}:others`);

  if (!state || !t) {
    return <Screen header={<Header title="Key Term" onBack={ctx.back} />}><EmptyState icon="book" title={state ? 'This term is not here any more' : 'Loading…'} /></Screen>;
  }
  const lane = laneName(state, laneId);
  const canEdit = ctx.session.can('fill_reference') || ctx.session.can('manage_reference');
  const draftTakeId = passage?.draftTakeId;
  // TERM-4 is offered from the workspace, which passes the draft (or no take); a version's page passes that version.
  const fromDraft = !ctx.params['takeId'] || ctx.params['takeId'] === draftTakeId;
  const canTie = !!draftTakeId && fromDraft && ctx.session.can('translate') && canEdit;
  const isLinked = !!draftTakeId && !!state.keyTermLinks[draftTakeId]?.[termId];
  const passageLabel = passage ? unitTitle(state, passage.unitId) : null;
  const adjustments = [...t.adjustments].reverse();
  const versionOf = (takeId?: string) => {
    const take = takeId ? state.takes[takeId] : undefined;
    if (!take || !takeId) return null;
    const v = derivePassage(state, take.unitId, take.laneId, indexesFor(state)).versions.find((x) => x.takeId === takeId);
    return { unitId: take.unitId, laneId: take.laneId, takeId, title: unitTitle(state, take.unitId), n: v?.n ?? null };
  };
  const openVersion = (v: { unitId: string; laneId: string; takeId: string }) => ctx.go('version_detail', { unitId: v.unitId, laneId: v.laneId, takeId: v.takeId });

  async function tie() {
    if (!draftTakeId || isLinked || busy) return;
    setBusy(true);
    await actCommand(ctx, 'tie key term', () => commands(state!, indexesFor(state!)).linkKeyTerms({ commandId: Crypto.randomUUID(), takeId: draftTakeId, termIds: [termId] }),
      `Tied ${t!.term} to your draft.`);
    setBusy(false);
  }

  async function saveAdjustment() {
    if (!canEdit || busy || (!note.trim() && !hash)) return;
    const duringTakeId = draftTakeId ?? passage?.latest?.takeId;
    setBusy(true);
    const saved = await actCommand(ctx, 'adjust key term', () => commands(state!, indexesFor(state!)).adjustKeyTermRendering({
      commandId: Crypto.randomUUID(), termId, rendering, context, note,
      ...(hash ? { blobHash: hash } : {}), ...(duringTakeId ? { duringTakeId } : {}),
      // TERM-5: an adjustment made while drafting ties the term to the draft.
      ...(canTie && !isLinked && draftTakeId ? { tieToTakeId: draftTakeId } : {})
    }), rendering.trim() ? `Added “${rendering.trim()}”.` : 'Change recorded.');
    if (saved) { setAdjusting(false); setRendering(''); setContext(''); setNote(''); setHash(null); }
    setBusy(false);
  }

  const scopeTitles = t.unitScope.map((u) => unitTitle(state, u));
  return (
    <Screen header={<Header title={t.term} sub={isFiaTerm(t) ? 'FIA key term · shared across the organization' : `${lane} · project term`} onBack={ctx.back} />}>
      <Card style={{ backgroundColor: C.light }}>
        <Text style={txt.body}>{t.gloss || 'No meaning written yet.'}</Text>
        <Text style={[txt.xsStrong, { color: C.primary }]}>{scopeTitles.length ? `Appears in ${scopeTitles.join(', ')}` : 'Applies to every passage'}</Text>
      </Card>

      {canTie ? (
        <Card onPress={isLinked ? undefined : () => void tie()} accessibilityLabel={isLinked ? 'Tied to your draft' : 'Tie to your draft'}
          style={isLinked ? { backgroundColor: TINT.green } : { borderStyle: 'dashed', borderWidth: 1.5, borderColor: `${C.primary}99` }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={[styles.tieIcon, { backgroundColor: isLinked ? C.green : C.primary }]}>
              <Ico name={isLinked ? 'check' : 'link'} size={20} color={C.white} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[txt.body, { fontWeight: '700', color: isLinked ? TINT.greenText : C.dark }]}>{isLinked ? 'Tied to your draft' : 'Tie to your draft'}</Text>
              <Text style={[txt.sm, { color: isLinked ? TINT.greenText : C.muted }]}>
                {isLinked ? 'Reviewers will see this term and your reasoning.' : `So reviewers know this term shaped ${passageLabel}.`}
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      <SectionLabel label={`In ${lane}`} />
      {t.renderings.length === 0 ? (
        <Card onPress={canEdit ? () => setAdjusting(true) : undefined} style={{ backgroundColor: TINT.amber, borderStyle: 'dashed', borderWidth: 1.5, borderColor: `${C.amber}99` }}>
          <Text style={[txt.body, { fontWeight: '700', color: TINT.amberText }]}>No rendering yet</Text>
          <Text style={[txt.sm, { color: TINT.amberText }]}>Add how {lane} says this, and when to use it.</Text>
        </Card>
      ) : (
        <Group>
          {t.renderings.map((r, i) => (
            <View key={r.renderingId} style={[styles.rendering, i < t.renderings.length - 1 && styles.rowBorder]}>
              <Text style={[txt.h3, { color: C.primary }]}>{r.rendering}</Text>
              {r.context ? <Text style={txt.sm}>{r.context}</Text> : null}
            </View>
          ))}
        </Group>
      )}
      {canEdit ? <GhostBtn label={t.renderings.length ? 'Adjust or add a rendering' : 'Add a rendering'} icon="edit" onPress={() => setAdjusting(true)} /> : null}

      {adjustments.length || usedIn.length || others.length ? <SectionLabel label="Details" /> : null}
      {adjustments.length ? (
        <Disclosure icon="history" title="Why it's rendered this way" open={why.open} onToggle={why.onToggle}
          summary={`${plural(adjustments.length, 'change')} · latest by ${ctx.name(adjustments[0]!.actorId)}, ${when(adjustments[0]!.hlc)}`}>
          {adjustments.map((a, i) => {
            const v = versionOf(a.duringTakeId);
            return (
              <View key={a.adjustmentId} style={[styles.adjustment, i < adjustments.length - 1 && styles.rowBorder]}>
                <Text style={txt.xs}>{ctx.name(a.actorId)} · {when(a.hlc)}{v ? ` · ${v.title}` : ''}</Text>
                <Text style={txt.sm}>{a.note}</Text>
                {a.blobHash ? <AudioClip project={ctx.project} hashes={[a.blobHash]} label="Play the explanation" /> : null}
                {v && v.n !== null ? <SmallBtn label={`Open Version ${v.n}`} icon="mic" onPress={() => openVersion(v)} /> : null}
              </View>
            );
          })}
        </Disclosure>
      ) : null}
      {usedIn.length ? (
        <Disclosure icon="mic" title="Where it's used" open={used.open} onToggle={used.onToggle}
          summary={`${plural(usedIn.length, 'version')} · ${[...new Set(usedIn.map((u) => u.title))].slice(0, 2).join(', ')}${usedIn.length > 2 ? '…' : ''}`}>
          {usedIn.slice(0, usedShown).map((u, i, a) => (
            <Row key={u.takeId} icon="mic" label={`${u.title} · Version ${u.n}`} sub={u.note ?? `${ctx.name(u.by)} · ${when(u.hlc)}`}
              badge={u.adjustmentId ? 'Changed here' : undefined} onPress={() => openVersion(u)} last={i === a.length - 1} />
          ))}
          <ShowMore remaining={usedIn.length - usedShown} step={STEP} onMore={() => setUsedShown(usedShown + STEP)} />
        </Disclosure>
      ) : null}
      {others.length ? (
        <Disclosure icon="globe" title="Other languages" open={other.open} onToggle={other.onToggle}
          summary={others.slice(0, 3).map((r) => `${r.lane}: ${r.rendering}`).join(' · ')}>
          {others.map((r, i) => (
            <View key={`${r.laneId}-${i}`} style={[styles.rendering, i < others.length - 1 && styles.rowBorder]}>
              <Text style={txt.xsStrong}>{r.lane}</Text>
              <Text style={[txt.body, { fontWeight: '700' }]}>{r.rendering}</Text>
              {r.context ? <Text style={txt.xs}>{r.context}</Text> : null}
            </View>
          ))}
        </Disclosure>
      ) : null}

      <Sheet visible={adjusting} title={`${lane} · “${t.term}”`} onClose={() => setAdjusting(false)}
        sub={canTie ? `Recorded as part of ${passageLabel}, and tied to your draft.` : 'Every change is recorded with your reason.'}
        footer={<PrimaryBtn label="Save" onPress={() => void saveAdjustment()} disabled={!note.trim() && !hash} busy={busy} />}>
        <Field value={rendering} onChangeText={setRendering} placeholder="New rendering (optional)" />
        {rendering.trim() ? <Field value={context} onChangeText={setContext} placeholder="When to use it" multiline autoCapitalize="sentences" /> : null}
        {passage ? <VoiceNote ctx={ctx} unitId={passage.unitId} laneId={passage.laneId} label="Say why" hash={hash} onChange={setHash} /> : null}
        <Field value={note} onChangeText={setNote} placeholder={passage ? 'Or type what changed, and why' : 'What changed, and why'} multiline autoCapitalize="sentences" />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64, paddingHorizontal: space.lg, paddingVertical: space.md, backgroundColor: C.card },
  inline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  inlineStep: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepTile: { borderRadius: radius.md, paddingHorizontal: space.sm, paddingVertical: 6, gap: 2, borderWidth: 1, borderColor: 'transparent' },
  stepNo: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  then: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.xl },
  thenLine: { width: 1, height: 20, backgroundColor: C.border },
  kindLine: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  checkpoint: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  rendering: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: 4, backgroundColor: C.card },
  adjustment: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm },
  tieIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }
});

export const contracts = contractsFor('roles_home', 'role_editor', 'reference_home', 'material_editor', 'key_terms', 'key_term_detail', 'flows_home', 'flow_editor');
