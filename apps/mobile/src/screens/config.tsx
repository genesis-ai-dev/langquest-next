// Avatar P. Configuration: roles, reference material, key terms, review flows.
// Ports the demo's src/screens/config.tsx (RolesHomeScreen, RoleEditorScreen,
// AppliedCatalogScreen for review flows, FlowStepsInline, FlowEditorScreen,
// KindPickerSheet, ReferenceLibraryScreen, KeyTermsScreen, AddKeyTermSheet,
// KeyTermDetailScreen, AdjustKeyTermSheet) and review.tsx MaterialEditorScreen,
// with the working material editor from main (fields as registers, lock,
// new material) in the new look. Review flows and reference material are
// library items (docs/library.md): the organization's own, copies and
// followed ones, plus what other organizations share; the in-app catalog is
// no longer offered.
// Requirements ORG-3, ORG-4, ORG-8, TERM-1..6, FLOW-1..4.
// ADR-002 (one model for reference), ADR-004 (done is read from the record),
// ADR-005 (kinds arranged by the flow designer), ADR-016 (parallel kinds).
// Pure reading lives in configModel.ts.
import {
  CommandError, commands, deriveFlow, deriveKinds, derivePassage, formatQuestionField, keyTermsFor, keyTermView, laneName,
  materialView, parseQuestionField, privilegesFor, PRIVILEGES, REFERENCE_KINDS, SOURCE_BIBLES, sourceBibleEnabled, subscriptionItemId,
  takesLinkingTerm, templateFields, templateOfUnit, unitTitle,
  type EventSpec, type FlowDoc, type FlowStep, type KeyTermView, type KindDef, type LibraryDoc, type LibraryItemView, type MaterialDoc,
  type MaterialView, type Privilege, type ProjectState, type QuestionSpec, type VersificationDoc
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AudioClip } from '../audioClip';
import type { Ctx } from '../ctx';
import { indexesFor } from '../indexes';
import {
  Badge, Banner, Card, Chip, ChipRow, Disclosure, EmptyState, Field, GhostBtn, Group, Header, Ico, IconBtn, KindIcon,
  PrimaryBtn, Row, Screen, SearchField, SectionLabel, Sheet, ShowMore, SmallBtn, Toggle, txt, useOpenDetail
} from '../kit';
import { lanesUsing, sourceLine, type SharedItem } from '../library/model';
import { useLibrary, useLibraryDocs, useLibraryUpdates, useSharedItems } from '../library/useLibrary';
import { when } from '../passageView';
import { reportError, failureMessage } from '../report';
import { contractsFor } from '../screenContracts';
import { sourceText } from '../scripture';
import { C, radius, space, TINT } from '../theme';
import { VoiceNote } from '../voiceNote';
import {
  draftChanged, draftFromDoc, draftFromLane, fieldLabel, flowDocFrom, flowLabel, flowUndoFor, holdersOf, isFiaTerm, LEVEL_LABEL,
  laneFlows, libraryMaterialLine, libraryQuestions, listNames, matchesTerm, materialDocFrom, materialItemId, moveStep, newKindId,
  nextFieldId, otherLanguageRenderings, parseRefLinks, plural, PRIVILEGE_INFO, questionCount, questionCountLabel, questionDrafts,
  questionSetToReviews, referenceKindName, referenceView, roleRows, scopeName, setKindName, termsInPassage, viewLevelFrom,
  type DraftStep, type QuestionDraft
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

/** What a view without a language covers: the organization, which holds its languages directly (decision 34). */
function orgName(ctx: Ctx): string {
  return ctx.org.state?.org?.value.name ?? 'Organization';
}

// ─── Roles (ORG-3, ORG-4) ──────────────────────────────────────────────────────────

export function RolesHome(ctx: Ctx) {
  const level = viewLevelFrom(ctx.params, ctx.session.adminScope);
  const beside = useOpenDetail();
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
                onPress={() => ctx.go('role_editor', { roleId: r.roleId, level })} last={i === rows.length - 1}
                current={beside?.screen === 'role_editor' && beside.params['roleId'] === r.roleId} />
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
            <Row key={`${h.profileId}-${h.scope ? JSON.stringify(h.scope) : 'legacy'}`} icon="user"
              label={h.profileId === ctx.session.actorId ? 'You' : h.displayName ?? ctx.name(h.profileId)}
              sub={scopeName(h.scope, org, state, ctx.project.projectId)}
              onPress={canAssign ? () => ctx.go('edit_member', { memberId: h.profileId }) : undefined} last={last} />
          )} />
        </>
      ) : null}
      <Card style={{ backgroundColor: C.light }}>
        <Text style={txt.sm}>
          {isNew
            ? 'Scope is not set here: choose the organization or a language when inviting or editing a member.'
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

// ─── The library (docs/library.md) ─────────────────────────────────────────────────

type Library = ReturnType<typeof useLibrary>;

/** A library action that needs the server says so plainly when offline, instead of reporting a fault. */
function libraryFailure(where: string, e: unknown): string {
  if (e instanceof Error && !(e instanceof CommandError) && /network|fetch|offline|timed? ?out/i.test(e.message)) {
    return 'Not connected. Try again when you are online.';
  }
  return failure(where, e);
}

/** Run a library write, then say what changed, with Undo when it is a simple flip back. True when it was saved. */
async function libraryAct(ctx: Ctx, where: string, action: () => Promise<unknown>, message: string, undo?: () => Promise<unknown>): Promise<boolean> {
  try {
    await action();
  } catch (e) {
    ctx.toast(`Not saved. ${libraryFailure(where, e)}`);
    return false;
  }
  ctx.toast(message, undo ? async () => {
    try { await undo(); ctx.toast('Undone.'); } catch (e) { ctx.toast(`Not undone. ${libraryFailure(`undo ${where}`, e)}`); }
  } : undefined);
  return true;
}

/**
 * "From other organizations": what they share of one kind, with Follow
 * (when the owner allows it; a Sheet asks how) and Copy. Items this
 * organization already follows are listed with its own. Offline, the list
 * this phone saw last.
 */
function SharedItems(props: {
  ctx: Ctx; lib: Library; shared: ReturnType<typeof useSharedItems>; canManage: boolean;
  detail?: (s: SharedItem) => ReactNode; use?: { label: string; onUse: (s: SharedItem) => void; disabled?: boolean };
}) {
  const { ctx, lib, shared } = props;
  const [following, setFollowing] = useState<SharedItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(STEP);
  // Undo runs later, once the new subscription is in the library.
  const live = useLatest(lib);
  const rows = shared.rows.filter((s) => !lib.item(subscriptionItemId(s.org_id, s.item_id))?.subscription?.active);

  async function follow(s: SharedItem, autoUpdate: boolean) {
    setFollowing(null);
    setBusy(true);
    let itemId = '';
    await libraryAct(ctx, 'follow', async () => { itemId = await lib.subscribe(s, autoUpdate); },
      `Following ${s.name}${autoUpdate ? '. It updates automatically.' : '. You choose when to take updates.'}`,
      () => live.current.follow(itemId, { active: false }));
    setBusy(false);
  }
  async function copy(s: SharedItem) {
    setBusy(true);
    await libraryAct(ctx, 'copy', () => lib.copy(s), `${s.name} copied. It is yours to change.`);
    setBusy(false);
  }

  return (
    <>
      <SectionLabel label={`From other organizations · ${rows.length}`} />
      {shared.error ? (
        <Card><Text style={txt.smMuted}>{shared.rows.length ? 'Could not refresh this list. Showing the one saved on this phone.' : 'Could not load what other organizations share. Try again when you are online.'}</Text></Card>
      ) : null}
      {!shared.loaded ? <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>Loading…</Text>
        : rows.length === 0 && !shared.error ? <Card><Text style={txt.smMuted}>Nothing shared by other organizations yet.</Text></Card> : null}
      {rows.slice(0, n).map((s) => (
        <Card key={`${s.org_id}/${s.item_id}`}>
          <Text style={txt.h3}>{s.name}</Text>
          <Text style={txt.xsStrong}>{`${s.org_name} · ${plural(s.version_count, 'version')}`}</Text>
          {s.description ? <Text style={txt.smMuted}>{s.description}</Text> : null}
          {props.detail?.(s)}
          {props.canManage ? (
            <View style={styles.actions}>
              {props.use ? <SmallBtn label={props.use.label} tone="primary" disabled={busy || props.use.disabled} onPress={() => props.use!.onUse(s)} /> : null}
              {s.subscribable ? <SmallBtn label="Follow" icon="link" disabled={busy} onPress={() => setFollowing(s)} /> : null}
              <SmallBtn label="Copy" icon="plus" disabled={busy} onPress={() => void copy(s)} />
            </View>
          ) : null}
        </Card>
      ))}
      <ShowMore remaining={rows.length - n} step={STEP} onMore={() => setN(n + STEP)} />

      <Sheet visible={following !== null} title={following ? `Follow ${following.name}` : 'Follow'} onClose={() => setFollowing(null)}
        sub={`It stays ${following?.org_name ?? 'theirs'}'s: you use their versions, and can copy it any time to make it yours to change.`}
        footer={<>
          <PrimaryBtn label="Update automatically" onPress={() => following && void follow(following, true)} busy={busy} />
          <GhostBtn label="I'll take updates" onPress={() => following && void follow(following, false)} />
        </>}>
        <Text style={txt.sm}>Automatically: languages using it move to each new version they publish. Otherwise you see when an update is ready and take it.</Text>
      </Sheet>
    </>
  );
}

/**
 * An item's library settings, on its own screen: sharing and archiving for
 * one this organization controls; following, updates and copying for one
 * it follows (docs/library.md).
 */
function LibraryItemSettings(props: { ctx: Ctx; lib: Library; it: LibraryItemView; canManage: boolean; update?: string; onCopied: () => void }) {
  const { ctx, lib, it, canManage } = props;
  const [busy, setBusy] = useState(false);
  const live = useLatest(lib);
  const run = async (where: string, action: () => Promise<unknown>, message: string, undo?: () => Promise<unknown>) => {
    if (busy) return false;
    setBusy(true);
    const ok = await libraryAct(ctx, where, action, message, undo);
    setBusy(false);
    return ok;
  };
  const sub = it.subscription;
  return (
    <>
      <SectionLabel label="Library" />
      <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>{sourceLine(it)}</Text>
      {sub ? (
        <>
          <Group>
            <ToggleRow label="Update automatically" desc={`Take each new version ${sub.sourceOrgName} publishes.`} on={sub.autoUpdate}
              disabled={!canManage || busy || !sub.active} last
              onToggle={() => void run('follow updates', () => lib.follow(it.itemId, { autoUpdate: !sub.autoUpdate }),
                sub.autoUpdate ? 'You choose when to take updates.' : 'It updates automatically.',
                () => live.current.follow(it.itemId, { autoUpdate: sub.autoUpdate }))} />
          </Group>
          {props.update && canManage ? (
            <GhostBtn label="Take update" icon="download" disabled={busy}
              onPress={() => void run('take update', () => lib.takeUpdate(it, props.update!), `${it.name} is up to date. Languages using it move to the new version.`)} />
          ) : null}
          {canManage ? (
            <>
              <GhostBtn label="Copy to change it" icon="plus" disabled={busy}
                onPress={() => void run('copy', () => lib.copyFollowed(it), `${it.name} copied. It is yours to change.`).then((ok) => ok && props.onCopied())} />
              {sub.active ? (
                <GhostBtn label="Stop following" tone="red" disabled={busy}
                  onPress={() => void run('stop following', () => lib.follow(it.itemId, { active: false }), `Stopped following. The version in use stays.`,
                    () => live.current.follow(it.itemId, { active: true }))} />
              ) : (
                <GhostBtn label="Follow again" disabled={busy} onPress={() => void run('follow', () => lib.follow(it.itemId, { active: true }), `Following ${sub.sourceOrgName} again.`)} />
              )}
            </>
          ) : null}
        </>
      ) : (
        <>
          <Group>
            <ToggleRow label="Share with other organizations" desc="They can see it and copy it." on={it.shared} disabled={!canManage || busy} last={!it.shared}
              onToggle={() => void run('share', () => lib.setSharing(it, !it.shared, it.subscribable),
                it.shared ? 'No longer shared. Copies and followers keep what they have.' : 'Shared with other organizations.',
                () => lib.setSharing(it, it.shared, it.subscribable))} />
            {it.shared ? (
              <ToggleRow label="Let them follow updates" desc="They can follow it and get each new version you publish." on={it.subscribable}
                disabled={!canManage || busy} last
                onToggle={() => void run('share', () => lib.setSharing(it, true, !it.subscribable),
                  it.subscribable ? 'Others can no longer follow it.' : 'Others can follow it now.',
                  () => lib.setSharing(it, true, it.subscribable))} />
            ) : null}
          </Group>
          {canManage ? (
            <GhostBtn label={it.archived ? 'Unarchive' : 'Archive'} icon="folder" disabled={busy}
              onPress={() => void run('archive', () => lib.archive(it, !it.archived),
                it.archived ? `${it.name} is back in the lists.` : `${it.name} archived. Languages using it keep it.`,
                () => lib.archive(it, it.archived))} />
          ) : null}
        </>
      )}
    </>
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

/** A flow document's steps inline, or a light line while it loads. */
function DocSteps(props: { doc: FlowDoc | null; kinds: KindDef[] }) {
  if (!props.doc) return <Text style={txt.smMuted}>Loading…</Text>;
  return <FlowStepsInline steps={props.doc.steps.map((s) => ({ kindIds: s.kindIds, checkpoint: !!s.checkpoint }))} kinds={[...props.doc.kinds, ...props.kinds]} />;
}

export function FlowsHome(ctx: Ctx) {
  const state = ctx.project.state;
  const lib = useLibrary(ctx);
  const fixedLane = ctx.params['laneId'];
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(STEP);
  const uses = useMemo(() => (state ? laneFlows(state) : []), [state]);
  const kinds = useMemo(() => (state ? deriveKinds(state) : []), [state]);
  const live = useLatest(ctx);
  const canManage = ctx.session.can('manage_flows');
  const flows = lib.items('flow');
  const shared = useSharedItems('flow', lib.orgId);
  const { updates } = useLibraryUpdates(lib.orgId);
  const docs = useLibraryDocs(lib.orgId, [...flows.map((f) => f.current), ...shared.rows.map((s) => s.latest_hash)]);
  const laneId = fixedLane ?? picked ?? (ctx.laneId && state?.lanes[ctx.laneId] ? ctx.laneId : uses[0]?.laneId) ?? null;
  const current = uses.find((u) => u.laneId === laneId) ?? null;
  const byLanguage = ctx.details('flows:by-language');

  /**
   * Use a flow for the language: one of this organization's, or a shared
   * one, followed with automatic updates first (copied when its owner does
   * not allow following). Undo goes back to the flow it had.
   */
  async function use(target: { itemId: string } | { shared: SharedItem }) {
    if (!state || !current || busy) return;
    const lane = current.laneId;
    setBusy(true);
    let specs: EventSpec[];
    let name: string;
    let undo: (() => EventSpec[]) | undefined;
    try {
      const plan = flowUndoFor(state, lane);
      if (plan?.kind === 'library') {
        // Computed now, from the version it was on; the steps under that version's prefix are never removed.
        // Without its document on this phone there is simply no Undo.
        const back = await lib.applySpecs(lane, plan.itemId, { docHash: plan.docHash }).catch(() => null);
        if (back) undo = () => back;
      } else if (plan?.kind === 'legacy') {
        undo = () => {
          const s = live.current.project.state;
          return s ? commands(s, indexesFor(s)).restoreFlow({ commandId: Crypto.randomUUID(), laneId: lane, previous: plan.previous }) : [];
        };
      }
      if ('shared' in target) {
        const s = target.shared;
        const itemId = s.subscribable ? await lib.subscribe(s, true) : await lib.copy(s);
        name = s.name;
        specs = await lib.applySpecs(lane, itemId, { docHash: s.latest_hash });
      } else {
        const it = lib.item(target.itemId);
        if (!it?.current) throw new CommandError('That flow has no version to use yet.');
        name = it.name;
        specs = await lib.applySpecs(lane, it.itemId, { docHash: it.current });
      }
    } catch (e) {
      ctx.toast(`Not saved. ${libraryFailure('use flow', e)}`);
      setBusy(false);
      return;
    }
    try {
      await ctx.act(specs, `${current.name} now uses ${name}.`, undo);
    } catch {
      // ctx.act has already said "Not saved" and why.
    }
    setBusy(false);
  }

  const open = (itemId: string) => (canManage ? () => ctx.go('flow_editor', { itemId }) : undefined);
  const currentItem = current?.itemId ? lib.item(current.itemId) : null;
  const versionOf = currentItem?.versions.find((v) => v.docHash === current?.docHash)?.n;

  return (
    <Screen header={<Header title="Review Flows" sub={fixedLane && state ? laneName(state, fixedLane) : orgName(ctx)} onBack={ctx.back}
      action={canManage ? <SmallBtn label="Flow" icon="plus" tone="primary" onPress={() => ctx.go('flow_editor', { itemId: 'new' })} /> : undefined} />}>
      <Intro>
        {fixedLane
          ? 'The flow is advice: it suggests what should happen next. Steps can be done in any order or set aside with a reason; only checkpoints are required.'
          : `Each language runs one review flow. This view covers the ${plural(uses.length, 'language')} in ${orgName(ctx)}. Flows are advice; checkpoints are the only hard stops.`}
      </Intro>
      {!state ? <EmptyState icon="flow" title="Loading…" /> : (
        <>
          {uses.length === 0 ? <EmptyState icon="globe" title="No languages yet" sub="Add a language, then choose how its passages get checked." /> : null}
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
              {currentItem ? (
                <Text style={txt.xs}>
                  {[versionOf ? `Version ${versionOf}` : '', currentItem.current && currentItem.current !== current.docHash ? 'moving to the newest' : '', sourceLine(currentItem)].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
              <FlowStepsInline steps={current.steps} kinds={kinds} />
              {canManage && currentItem ? <SmallBtn label="Open flow" icon="edit" onPress={() => ctx.go('flow_editor', { itemId: currentItem.itemId })} /> : null}
              {canManage && !current.itemId && current.chosen && current.steps.length ? (
                <SmallBtn label="Save as a flow" icon="plus" onPress={() => ctx.go('flow_editor', { itemId: 'new', laneId: current.laneId })} />
              ) : null}
            </Card>
          ) : null}

          <SectionLabel label={`Your organization · ${flows.length}`} />
          {flows.length === 0 ? (
            <Card><Text style={txt.smMuted}>No flows here yet. Follow or copy one another organization shares, or make your own.</Text></Card>
          ) : null}
          {flows.slice(0, shown).map((f) => {
            const on = !!current && current.itemId === f.itemId;
            const users = lanesUsing(state, f.itemId).filter((l) => l !== laneId).map((l) => laneName(state, l));
            return (
              <Card key={f.itemId} onPress={open(f.itemId)} accessibilityLabel={`Open ${f.name}`}
                style={on ? { borderColor: C.primary, borderWidth: 1.5 } : undefined}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
                  <View style={{ flex: 1 }}>
                    <Text style={txt.h3}>{f.name}</Text>
                    <Text style={txt.xs}>{sourceLine(f)}</Text>
                    {f.description ? <Text style={[txt.smMuted, { marginTop: 2 }]}>{f.description}</Text> : null}
                  </View>
                  {f.archived ? <Badge label="Archived" />
                    : updates[f.itemId] ? <Badge label="Update" tone="amber" /> : null}
                  {on
                    ? <SmallBtn label="In use" icon="check" tone="primary" onPress={() => {}} />
                    : current && !f.archived ? <SmallBtn label="Use" onPress={() => void use({ itemId: f.itemId })} disabled={!canManage || busy || !f.current} /> : null}
                </View>
                <DocSteps doc={docs.get<FlowDoc>(f.current)} kinds={kinds} />
                {users.length ? <Text style={[txt.xsStrong, { color: C.primary }]}>{`${on ? 'Also used by' : 'Used by'} ${listNames(users)}`}</Text> : null}
              </Card>
            );
          })}
          <ShowMore remaining={flows.length - shown} step={STEP} onMore={() => setShown(shown + STEP)} />

          <SharedItems ctx={ctx} lib={lib} shared={shared} canManage={canManage}
            detail={(s) => <DocSteps doc={docs.get<FlowDoc>(s.latest_hash)} kinds={kinds} />}
            {...(current ? { use: { label: 'Use', onUse: (s: SharedItem) => void use({ shared: s }), disabled: busy } } : {})} />

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
  const lib = useLibrary(ctx);
  const requested = ctx.params['itemId'] ?? 'new';
  const isNew = requested === 'new';
  const it = isNew ? null : lib.item(requested);
  const docs = useLibraryDocs(lib.orgId, [it?.current]);
  const doc = docs.get<FlowDoc>(it?.current);
  const { updates } = useLibraryUpdates(lib.orgId);
  // A new flow may start from a language's steps (a legacy flow made a library one).
  const [seed] = useState(() => {
    const lane = isNew ? ctx.params['laneId'] : undefined;
    return lane && state?.lanes[lane] ? { name: deriveFlow(state, lane).name, description: '', steps: draftFromLane(state, lane) } : { name: '', description: '', steps: [] as DraftStep[] };
  });
  const base = useMemo(() => (isNew ? seed : doc ? { name: doc.name, description: doc.description, steps: draftFromDoc(doc) } : null), [isNew, seed, doc]);
  const [name, setName] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [edited, setEdited] = useState<DraftStep[] | null>(null);
  const [added, setAdded] = useState<KindDef[]>([]);
  const [pickFor, setPickFor] = useState<number | null>(null);
  const [newKind, setNewKind] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const known = useMemo(() => {
    const out = new Map<string, KindDef>();
    for (const k of [...(state ? deriveKinds(state) : []), ...(doc?.kinds ?? [])]) if (!out.has(k.id)) out.set(k.id, k);
    return [...out.values()];
  }, [state, doc]);
  const kinds = useMemo(() => [...known, ...added.filter((k) => !known.some((x) => x.id === k.id))], [known, added]);
  const kindName = (id: string) => kinds.find((k) => k.id === id)?.name ?? id;
  const canManage = ctx.session.can('manage_flows');
  const followed = it?.source === 'subscription';
  const readOnly = !canManage || followed;
  const steps = edited ?? base?.steps ?? [];
  const label = name ?? base?.name ?? '';
  const desc = description ?? base?.description ?? '';
  const dirty = !readOnly && base !== null
    && (label.trim() !== base.name || desc.trim() !== base.description || draftChanged(base.steps, steps) || added.length > 0);
  const users = state && it ? lanesUsing(state, it.itemId).map((l) => laneName(state, l)) : [];

  if (!state || (!isNew && !it)) {
    return (
      <Screen header={<Header title="Review Flow" onBack={ctx.back} />}>
        <EmptyState icon="flow" title={state && ctx.org.state ? 'This flow is not here any more' : 'Loading…'} />
      </Screen>
    );
  }

  const change = (f: (prev: DraftStep[]) => DraftStep[]) => setEdited((prev) => f(prev ?? base?.steps ?? []));
  const patch = (i: number, p: Partial<DraftStep>) => change((prev) => prev.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const addKind = (i: number, id: string) => { patch(i, { kindIds: [...(steps[i]?.kindIds ?? []), id] }); setPickFor(null); };
  const closePicker = () => {
    // A step added for this pick and left empty goes away again (demo KindPickerSheet onClose).
    change((prev) => prev.filter((s, j) => j !== pickFor || s.kindIds.length > 0));
    setPickFor(null);
  };

  /** Save publishes a new version; languages using the flow move to it by themselves (follow.ts). */
  async function save() {
    if (readOnly || busy || !label.trim()) return;
    const flowDoc = flowDocFrom({ name: label, description: desc, steps, kinds });
    setBusy(true);
    const saved = await libraryAct(ctx, 'save flow',
      () => lib.publish({ kind: 'flow', ...(it ? { itemId: it.itemId } : {}), name: flowDoc.name, description: flowDoc.description, doc: flowDoc }),
      users.length ? `${flowDoc.name} saved. ${listNames(users)} ${users.length === 1 ? 'moves' : 'move'} to it.` : `${flowDoc.name} saved.`);
    if (saved) ctx.back();
    else setBusy(false);
  }

  const picking = pickFor !== null ? steps[pickFor] : undefined;
  return (
    <Screen
      header={<Header title={label || (isNew ? 'New flow' : 'Review Flow')} sub={it ? sourceLine(it) : 'New flow · your organization'}
        onBack={() => (dirty ? setLeaving(true) : ctx.back())} />}
      footer={readOnly ? undefined : <PrimaryBtn label="Save Flow" onPress={() => void save()} disabled={!dirty || !label.trim()} busy={busy} />}>
      {followed ? (
        <Banner icon="link" title={`Follows ${it!.subscription!.sourceOrgName}`} body="It changes only when they publish a new version. Copy it to make your own changes." />
      ) : !canManage ? <Banner icon="lock" title="View only" body="You do not have permission to change review flows." /> : null}
      {!base ? <Card><Text style={txt.smMuted}>Loading…</Text></Card> : (
        <>
          {readOnly ? (desc ? <Text style={[txt.sm, { paddingHorizontal: space.xs }]}>{desc}</Text> : null) : (
            <>
              <Field label="Name" value={label} onChangeText={setName} placeholder="e.g. Community first" autoCapitalize="words" />
              <Field label="Description" value={desc} onChangeText={setDescription} placeholder="What it is for, in a line" autoCapitalize="sentences" multiline />
              <Banner icon="flow" title="Steps are a suggested order"
                body="Kinds in the same step can happen together. Anyone can set a step aside with a reason; a checkpoint is the only hard stop. Moving past one needs the Override Checkpoints permission, and the reason is recorded." />
            </>
          )}
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
                      {i > 0 ? <IconBtn name="up" label="Move up" onPress={() => change((prev) => moveStep(prev, i, -1))} bg="transparent" color={C.muted} /> : null}
                      {i < steps.length - 1 ? <IconBtn name="down" label="Move down" onPress={() => change((prev) => moveStep(prev, i, 1))} bg="transparent" color={C.muted} /> : null}
                      <IconBtn name="trash" label="Remove step" onPress={() => change((prev) => prev.filter((_, j) => j !== i))} bg="transparent" color={C.muted} />
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
                <GhostBtn label="Add step" icon="plus" onPress={() => { change((prev) => [...prev, { key: Crypto.randomUUID(), kindIds: [], checkpoint: false }]); setPickFor(steps.length); }} />
              </View>
              {steps.length > 0 ? <SmallBtn label="Collect only" onPress={() => change(() => [])} /> : null}
            </View>
          ) : null}
          <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>
            {users.length
              ? `Used by ${listNames(users)}. Changes apply to their passages right away; nothing already recorded is lost.`
              : 'No language uses it yet. Choose it for a language from Review Flows.'}
          </Text>
        </>
      )}
      {it ? (
        <LibraryItemSettings ctx={ctx} lib={lib} it={it} canManage={canManage} {...(updates[it.itemId] ? { update: updates[it.itemId] } : {})} onCopied={ctx.back} />
      ) : null}

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
          <PrimaryBtn label="Save Flow" onPress={() => { setLeaving(false); void save(); }} busy={busy} disabled={!label.trim()} />
          <GhostBtn label="Discard changes" tone="red" onPress={() => { setLeaving(false); ctx.back(); }} />
        </>}>
        {null}
      </Sheet>
    </Screen>
  );
}

// ─── Reference library (ORG-8) ─────────────────────────────────────────────────────

function materialScopeName(state: ProjectState, m: Pick<MaterialView, 'scope'>): string {
  if (m.scope.unitId) return unitTitle(state, m.scope.unitId);
  if (m.scope.laneId) return `${laneName(state, m.scope.laneId)} team`;
  return 'All languages';
}

/** The versification a study or material document names, by name, once loaded. */
function versificationNameOf(docs: ReturnType<typeof useLibraryDocs>, doc: LibraryDoc | null): string | null {
  const hash = doc && 'versification' in doc && typeof doc.versification === 'string' ? doc.versification : null;
  return hash ? docs.get<VersificationDoc>(hash)?.name ?? null : null;
}

export function ReferenceHome(ctx: Ctx) {
  const state = ctx.project.state;
  const beside = useOpenDetail();
  const lib = useLibrary(ctx);
  const laneId = ctx.params['laneId'] ?? null;
  const view = useMemo(() => (state ? referenceView(state, laneId) : null), [state, laneId]);
  const kinds = useMemo(() => (state ? deriveKinds(state) : []), [state]);
  const canManage = ctx.session.can('manage_reference');
  const materials = lib.items('material');
  const shared = useSharedItems('material', lib.orgId);
  const { updates } = useLibraryUpdates(lib.orgId);
  const docs = useLibraryDocs(lib.orgId, [...materials.map((m) => m.current), ...shared.rows.map((s) => s.latest_hash)]);
  const termLane = laneId ?? (ctx.laneId && state?.lanes[ctx.laneId] ? ctx.laneId : Object.keys(state?.lanes ?? {})[0]) ?? null;
  const termCount = useMemo(() => (state && termLane ? keyTermsFor(state, termLane).length : 0), [state, termLane]);
  const byLanguage = ctx.details('reference:by-language');
  const bibles = ctx.details('reference:source-bibles');
  if (!state || !view) return <Screen header={<Header title="Reference Material" onBack={ctx.back} />}><EmptyState title="Loading…" /></Screen>;

  const levelName = laneId ? laneName(state, laneId) : orgName(ctx);
  const open = (m: MaterialView) => (canManage ? () => ctx.go('material_editor', { materialId: m.materialId, ...(laneId ? { laneId } : {}) }) : undefined);
  const generalRow = (m: MaterialView, last: boolean) => (
    <Row key={m.materialId} icon="book" label={m.title} last={last} badge={m.locked ? 'Locked' : undefined}
      current={beside?.screen === 'material_editor' && beside.params['materialId'] === m.materialId}
      sub={`${referenceKindName(m.kind)} · ${materialScopeName(state, m)}${m.blanks > 0 ? ` · ${plural(m.blanks, 'blank')}` : ''}`} onPress={open(m)} />
  );
  const sets = [...view.questionSets].sort((a, b) => {
    const ia = kinds.findIndex((k) => k.id === a.scope.stepId), ib = kinds.findIndex((k) => k.id === b.scope.stepId);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  const libraryRow = (m: LibraryItemView, last: boolean) => {
    const doc = docs.get(m.current);
    const what = libraryMaterialLine(doc, versificationNameOf(docs, doc), kinds);
    return (
      <Row key={m.itemId} icon={what?.type === 'study' ? 'sparkle' : what?.type === 'questions' ? 'chat' : 'book'} label={m.name} last={last}
        sub={`${what?.line ?? 'Loading…'} · ${sourceLine(m)}`} muted={m.archived}
        current={beside?.screen === 'material_editor' && beside.params['itemId'] === m.itemId}
        badge={m.archived ? 'Archived' : updates[m.itemId] ? 'Update' : undefined} badgeTone={updates[m.itemId] && !m.archived ? 'amber' : undefined}
        onPress={canManage ? () => ctx.go('material_editor', { itemId: m.itemId, ...(laneId ? { laneId } : {}) }) : undefined} />
    );
  };

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

      <SectionLabel label={`Library · your organization · ${materials.length}`}
        action={canManage ? <SmallBtn label="New" icon="plus" onPress={() => ctx.go('material_editor', { itemId: 'new', ...(laneId ? { laneId } : {}) })} /> : undefined} />
      <Capped items={materials} render={libraryRow}
        empty="Nothing in your library yet. Follow or copy what other organizations share, or publish your own." />
      {canManage ? <Group><Row icon="sparkle" label="Write a guide" sub="Steps with text and audio, pictures, maps and key terms" last
        onPress={() => ctx.go('guide_editor', laneId ? { laneId } : {})} /></Group> : null}
      <SharedItems ctx={ctx} lib={lib} shared={shared} canManage={canManage}
        detail={(s) => {
          const doc = docs.get(s.latest_hash);
          const what = libraryMaterialLine(doc, versificationNameOf(docs, doc), kinds);
          return <Text style={txt.xs}>{what?.line ?? 'Loading…'}</Text>;
        }} />

      <SectionLabel label={`Study material · ${view.study.length}`} />
      <Capped items={view.study} empty="No study material written in the app for this view." render={(m, last) => (
        <Row key={m.materialId} icon="sparkle" label={m.title} last={last} badge={m.locked ? 'Locked' : undefined}
          sub={`Study guide · ${materialScopeName(state, m)}${m.blanks > 0 ? ` · ${plural(m.blanks, 'blank')}` : ''}`} onPress={open(m)} />
      )} />

      <SectionLabel label={`Review questions · ${sets.length}`} />
      <Capped items={sets} empty="No question sets yet. Use one from the library, or add your own." render={(m, last) => (
        <Row key={m.materialId} icon="chat" label={m.title} last={last} badge={m.locked ? 'Locked' : undefined}
          sub={`${setKindName(kinds, m) ?? 'Not tied to a kind of review'} · ${questionCountLabel(questionCount(m))} · ${materialScopeName(state, m)}`}
          onPress={open(m)} />
      )} />
      <Intro>Question sets for the same kind add up: a reviewer sees the organization's and the language team's together, labelled by source.</Intro>

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

/** Source Bibles the organization adds (the settings the old library held). */
function SourceBibles(props: { ctx: Ctx; open: boolean; onToggle: () => void }) {
  const { ctx } = props;
  const org = ctx.org.state;
  const [busy, setBusy] = useState(false);
  if (!org) return null;
  const canOrg = privilegesFor(org, ctx.session.actorId, {}).has('manage_reference');
  const added = SOURCE_BIBLES.filter((b) => sourceBibleEnabled(org, b.id));
  async function toggle(id: string, name: string, enabled: boolean) {
    if (busy) return;
    const payload = { kind: 'reference' as const, itemId: id, level: 'org' as const };
    setBusy(true);
    try {
      await ctx.org.append('v1.CatalogItemToggled', { ...payload, enabled });
      ctx.toast(`${name} ${enabled ? 'added' : 'turned off'}.`, async () => {
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
          on={sourceBibleEnabled(org, b.id)} disabled={busy || !canOrg} onToggle={() => void toggle(b.id, b.name, !sourceBibleEnabled(org, b.id))}
          last={i === SOURCE_BIBLES.length - 1} />
      ))}
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

/** One screen, two kinds of material: the library's (`itemId`) and the organization's own in the app (`materialId`, or new). */
export function MaterialEditor(ctx: Ctx) {
  return ctx.params['itemId'] ? <LibraryMaterialEditor ctx={ctx} /> : <AppMaterialEditor ctx={ctx} />;
}

function AppMaterialEditor({ ctx }: { ctx: Ctx }) {
  const state = ctx.project.state;
  const lib = useLibrary(ctx);
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
  const published = existing ? lib.item(materialItemId(existing.materialId)) : null;

  /** Publish to library: its saved fields become a new version of the item made from it (the same item every time). */
  async function publishToLibrary() {
    if (!existing || !canManage || busy) return;
    setBusy(true);
    await libraryAct(ctx, 'publish material',
      () => lib.publish({
        kind: 'material', itemId: materialItemId(existing.materialId), name: existing.title,
        description: published?.description || referenceKindName(existing.kind), doc: materialDocFrom(existing, fieldTitle)
      }),
      published ? `${existing.title} published as a new version.` : `${existing.title} is in your library. Share it from there.`);
    setBusy(false);
  }

  return (
    <Screen
      header={<Header title={existing?.title ?? 'New material'} sub={existing ? materialScopeName(state, existing) : laneParam ? laneName(state, laneParam) : orgName(ctx)} onBack={ctx.back}
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
                <Chip label="All languages" icon="folder" on={!forLane} onPress={() => setForLane(false)} />
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

      {existing && canManage ? (
        <>
          <SectionLabel label="Library" />
          <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>
            {published
              ? `In your library · ${sourceLine(published)}. Publishing again adds a version from what is saved here.`
              : 'Publish it to your library to share it with other organizations or keep versions of it.'}
          </Text>
          <GhostBtn label={published ? 'Publish a new version' : 'Publish to library'} icon="share" disabled={busy || changes.length > 0} onPress={() => void publishToLibrary()} />
          {changes.length > 0 ? <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>Save your changes first.</Text> : null}
        </>
      ) : null}
    </Screen>
  );
}

/** Kinds of simple material the library editor makes; question sets and study guides come from elsewhere. */
const LIBRARY_MATERIAL_KINDS = ['tg', 'tmf', 'brief', 'document'];

/** A versification a verse link can be read in: one this organization has, or one another shares (followed or copied on Save). */
interface VersificationChoice { key: string; label: string; hash: string | null; shared?: SharedItem }

function LibraryMaterialEditor({ ctx }: { ctx: Ctx }) {
  const state = ctx.project.state;
  const lib = useLibrary(ctx);
  const requested = ctx.params['itemId'] ?? 'new';
  const isNew = requested === 'new';
  const it = isNew ? null : lib.item(requested);
  const docs = useLibraryDocs(lib.orgId, [it?.current]);
  const doc = docs.get(it?.current);
  const material = doc?.format === 'material@1' ? doc : null;
  const { updates } = useLibraryUpdates(lib.orgId);
  const kinds = useMemo(() => (state ? deriveKinds(state) : []), [state]);
  const canManage = ctx.session.can('manage_reference');
  const editable = canManage && it?.source !== 'subscription' && (isNew || material !== null);
  const sharedV = useSharedItems('versification', lib.orgId, editable);
  const [kind, setKind] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [refsText, setRefsText] = useState<string | null>(null);
  const [parts, setParts] = useState<{ template: string; node: string }[] | null>(null);
  const [v11n, setV11n] = useState<VersificationChoice | null>(null);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const baseLinks = material?.links ?? [];
  const baseRefs = baseLinks.flatMap((l) => ('ref' in l ? [l.ref] : [])).join('\n');
  const baseParts = baseLinks.flatMap((l) => ('node' in l ? [l] : []));
  const k = kind ?? material?.kind ?? 'tg';
  const t = title ?? material?.title ?? '';
  const b = body ?? material?.body ?? '';
  const refs = parseRefLinks(refsText ?? baseRefs);
  const linked = parts ?? baseParts;
  const own = lib.items('versification').filter((v) => v.current && !v.archived);
  const choices: VersificationChoice[] = [
    { key: 'none', label: "Each language's own", hash: null },
    ...own.map((v) => ({ key: v.itemId, label: v.name, hash: v.current })),
    ...sharedV.rows.filter((s) => !lib.item(subscriptionItemId(s.org_id, s.item_id))?.subscription?.active)
      .map((s) => ({ key: `${s.org_id}/${s.item_id}`, label: `${s.name} · ${s.org_name}`, hash: s.latest_hash, shared: s }))
  ];
  const baseHash = material?.versification ?? null;
  const baseChoice: VersificationChoice = choices.find((c) => c.hash === baseHash && !c.shared)
    ?? { key: 'doc', label: versificationNameOf(docs, material) ?? 'Loading…', hash: baseHash };
  const chosen = v11n ?? baseChoice;
  const units = useMemo(() => {
    if (!state || !picking) return [];
    const needle = q.trim().toLowerCase();
    return Object.keys(state.units)
      .filter((u) => templateOfUnit(u)?.catalogVersion === 0)
      .map((u) => ({ unitId: u, label: unitTitle(state, u) }))
      .filter((u) => !needle || u.label.toLowerCase().includes(needle))
      .sort((x, y) => x.label.localeCompare(y.label));
  }, [state, picking, q]);
  const dirty = editable && (kind !== null || title !== null || body !== null || refsText !== null || parts !== null || v11n !== null);
  const ready = editable && t.trim() !== '' && refs.bad.length === 0 && (isNew || dirty);

  if (!state || (!isNew && !it)) {
    return <Screen header={<Header title="Library material" onBack={ctx.back} />}><EmptyState icon="book" title={state && ctx.org.state ? 'This material is not here any more' : 'Loading…'} /></Screen>;
  }
  const partLabel = (l: { template: string; node: string }) => {
    const unitId = `${l.template}/${l.node}`;
    return state.units[unitId] ? unitTitle(state, unitId) : l.node;
  };

  /** Save publishes a new version. A verse link's versification from another organization is followed (or copied) first, so it travels with it. */
  async function save() {
    if (!ready || busy) return;
    setBusy(true);
    const saved = await libraryAct(ctx, 'save material', async () => {
      let hash = refs.refs.length ? chosen.hash : null;
      if (hash && chosen.shared) {
        const s = chosen.shared;
        await (s.subscribable ? lib.subscribe(s, true) : lib.copy(s));
        hash = s.latest_hash;
      }
      const { links: _links, versification: _v, body: _b, ...rest } = material ?? { format: 'material@1' as const, kind: k, title: t, deps: [] };
      const links = [...refs.refs.map((ref) => ({ ref })), ...linked];
      const out: MaterialDoc = {
        ...rest, format: 'material@1', kind: k, title: t.trim(), deps: [],
        ...(b.trim() ? { body: b.trim() } : {}), ...(links.length ? { links } : {}), ...(hash ? { versification: hash } : {})
      };
      await lib.publish({ kind: 'material', ...(it ? { itemId: it.itemId } : {}), name: out.title, description: it?.description || referenceKindName(k), doc: out });
    }, isNew ? `${t.trim()} is in your library.` : `${t.trim()} saved as a new version.`);
    if (saved) ctx.back();
    else setBusy(false);
  }

  function useInReviews() {
    if (!it || !material || busy) return;
    let plan: ReturnType<typeof questionSetToReviews>;
    try {
      plan = questionSetToReviews(state!, { commandId: Crypto.randomUUID(), itemId: it.itemId, doc: material });
    } catch (e) {
      ctx.toast(failure('use question set', e));
      return;
    }
    const kindLabel = kinds.find((x) => x.id === material.reviewKindId)?.name ?? material.reviewKindId;
    void ctx.act(plan.specs, `Reviewers doing ${kindLabel} now see these questions.`, () => plan.undo).catch(() => {
      // ctx.act has already said "Not saved" and why.
    });
  }

  const questions = material ? libraryQuestions(material) : [];
  const what = libraryMaterialLine(doc, versificationNameOf(docs, doc), kinds);
  return (
    <Screen
      header={<Header title={t || (isNew ? 'New library material' : it?.name ?? 'Library material')} sub={it ? sourceLine(it) : 'Library · your organization'} onBack={ctx.back} />}
      footer={editable ? <PrimaryBtn label={isNew ? 'Publish' : 'Publish new version'} onPress={() => void save()} disabled={!ready} busy={busy} /> : undefined}>
      {!isNew && !doc ? <Card><Text style={txt.smMuted}>Loading…</Text></Card> : null}
      {it?.source === 'subscription' ? (
        <Banner icon="link" title={`Follows ${it.subscription!.sourceOrgName}`} body="It changes only when they publish a new version. Copy it to make your own changes." />
      ) : null}
      {what ? <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>{what.line}</Text> : null}

      {doc?.format === 'study@1' ? (
        <Card>
          <Text style={txt.h3}>{doc.title}</Text>
          <Text style={txt.xs}>{`${doc.ref} · ${doc.source} · ${plural(doc.steps.length, 'step')}`}</Text>
          {doc.about ? <Text style={txt.sm}>{doc.about}</Text> : null}
        </Card>
      ) : null}
      {doc?.format === 'collection@1' ? (
        <>
          {doc.description ? <Text style={[txt.sm, { paddingHorizontal: space.xs }]}>{doc.description}</Text> : null}
          <SectionLabel label={`Passages · ${doc.entries.length}`} />
          <Capped items={doc.entries} render={(e, last) => <Row key={`${e.ref}-${e.doc}`} icon="sparkle" label={e.title} sub={e.ref} last={last} />} />
        </>
      ) : null}

      {isNew || material ? (
        editable ? (
          <>
            <SectionLabel label="What kind" />
            <ChipRow>
              {[...new Set([...LIBRARY_MATERIAL_KINDS, k])].map((id) => <Chip key={id} label={referenceKindName(id)} on={k === id} onPress={() => setKind(id)} />)}
            </ChipRow>
            <Field label="Title" value={t} onChangeText={setTitle} placeholder="e.g. Names in Ruth" autoCapitalize="sentences" />
            <Field label="Text" value={b} onChangeText={setBody} placeholder="What translators should know" autoCapitalize="sentences" multiline />
            <SectionLabel label="Where it applies" />
            <Field label="Verses, one per line" value={refsText ?? baseRefs} onChangeText={setRefsText} placeholder="RUT 1:1-16" autoCapitalize="none" multiline />
            {refs.bad.length ? <Text style={[txt.sm, { color: TINT.redText }]}>{`Could not read ${refs.bad.map((x) => `“${x}”`).join(', ')}. Write them like RUT 1:1-16.`}</Text> : null}
            {refs.refs.length ? (
              <>
                <Text style={txt.xsStrong}>Numbered as in</Text>
                <ChipRow>
                  {[...choices, ...(choices.some((c) => c.key === chosen.key) ? [] : [chosen])].map((c) => (
                    <Chip key={c.key} label={c.label} on={c.key === chosen.key} onPress={() => setV11n(c)} />
                  ))}
                </ChipRow>
              </>
            ) : null}
            {linked.length ? (
              <Group>
                {linked.map((l, i) => (
                  <Row key={`${l.template}/${l.node}`} icon="template" label={partLabel(l)} sub="A part of a content template" last={i === linked.length - 1}
                    right={<IconBtn name="close" label={`Remove ${partLabel(l)}`} onPress={() => setParts(linked.filter((_, j) => j !== i))} bg={C.light} color={C.primary} />} />
                ))}
              </Group>
            ) : null}
            <SmallBtn label="Link a part of a template" icon="link" onPress={() => setPicking(true)} />
          </>
        ) : material ? (
          <>
            {material.body ? <Card><Text style={txt.body}>{material.body}</Text></Card> : null}
            {(material.fields ?? []).filter(() => material.kind !== 'questions').map((f) => (
              <Card key={f.id}><Text style={txt.h3}>{f.label ?? fieldLabel(f.id)}</Text><Text style={txt.body}>{f.text}</Text></Card>
            ))}
            {baseLinks.length ? (
              <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>
                {`Applies to ${baseLinks.map((l) => ('ref' in l ? l.ref : partLabel(l))).join(', ')}`}
              </Text>
            ) : null}
          </>
        ) : null
      ) : null}

      {material?.kind === 'questions' ? (
        <>
          <SectionLabel label={`Questions · ${questions.length}`} />
          {questions.map((x) => (
            <Card key={x.id}>
              <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                <Text style={txt.label}>{QUESTION_TYPES.find((qt) => qt.id === x.type)?.label}</Text>
                {x.required ? <Badge label="Required" tone="brand" /> : null}
              </View>
              <Text style={txt.body}>{x.text}</Text>
            </Card>
          ))}
          {canManage && material.reviewKindId && questions.length ? (
            <GhostBtn label="Use in reviews" icon="chat" onPress={useInReviews} />
          ) : null}
        </>
      ) : null}

      {it ? <LibraryItemSettings ctx={ctx} lib={lib} it={it} canManage={canManage} {...(updates[it.itemId] ? { update: updates[it.itemId] } : {})} onCopied={ctx.back} /> : null}

      <Sheet visible={picking} title="Link a part" sub="Parts of the content templates your languages use." onClose={() => setPicking(false)}>
        <SearchField value={q} onChangeText={setQ} placeholder="Search parts" />
        <Capped items={units} empty={q ? `Nothing matches “${q}”.` : 'No language uses a library template yet.'} render={(u, last) => (
          <Row key={u.unitId} icon="template" label={u.label} last={last} onPress={() => {
            const slash = u.unitId.indexOf('/');
            const link = { template: u.unitId.slice(0, slash), node: u.unitId.slice(slash + 1) };
            if (!linked.some((l) => l.template === link.template && l.node === link.node)) setParts([...linked, link]);
            setPicking(false);
          }} />
        )} />
      </Sheet>
    </Screen>
  );
}

// ─── Key terms (TERM-1..6) ─────────────────────────────────────────────────────────

function TermRow(props: { t: KeyTermView; lane: string; onPress: () => void; last: boolean }) {
  const { t } = props;
  const has = t.renderings.length > 0;
  const beside = useOpenDetail();
  return (
    <Row icon="book" iconColor={has ? C.primary : TINT.amberText} iconBg={has ? undefined : TINT.amber}
      label={t.term} badge={isFiaTerm(t) ? 'FIA' : undefined}
      sub={has ? t.renderings.map((r) => r.rendering).join(' · ') : `No ${props.lane} rendering yet`}
      onPress={props.onPress} last={props.last} current={beside?.screen === 'key_term_detail' && beside.params['termId'] === t.termId} />
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
      <Intro>Concepts come from your organization's list (like FIA key terms) or your own. Each language keeps its own renderings and the reasons behind them.</Intro>

      <Sheet visible={adding} title="New key term" sub="Added to your organization's list. Other languages can add their own renderings." onClose={() => setAdding(false)}
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
    <Screen header={<Header title={t.term} sub={isFiaTerm(t) ? 'FIA key term · shared across the organization' : `${lane} · organization term`} onBack={ctx.back} />}>
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
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tieIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }
});

export const contracts = contractsFor('roles_home', 'role_editor', 'reference_home', 'material_editor', 'key_terms', 'key_term_detail', 'flows_home', 'flow_editor');
