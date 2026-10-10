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
  CommandError, commands, CUSTOM_FLOW, deriveFlow, derivePassage, formatQuestionField, keyTermsFor, keyTermView, languageName,
  materialView, parseQuestionField, PRIVILEGES, privilegesFor, recommendedFor, subscriptionItemId,
  takesLinkingTerm, templateFields, unitPrefixOf, unitTitle,
  type EventSpec, type FlowDoc, type FlowStep, type KeyTermView, type KindDef, type LibraryDoc, type LibraryItemView, type MaterialDoc,
  type MaterialView, type Privilege, type LanguageState, type QuestionSpec, type VersificationDoc
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../text';
import { AudioClip } from '../audioClip';
import { deriveKinds, localKind } from '../coreText';
import type { Ctx } from '../ctx';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { indexesFor } from '../indexes';
import {
  Badge, Banner, Card, Chip, ChipRow, Disclosure, EmptyState, Field, GhostBtn, Group, Header, Ico, IconBtn, KindIcon,
  PrimaryBtn, Row, Screen, SearchField, SectionLabel, Sheet, ShowMore, SmallBtn, Toggle, txt, useOpenDetail
} from '../kit';
import { sourceLine, usesItem, type SharedItem } from '../library/model';
import { useLibrary, useLibraryDocs, useLibraryUpdates, useSharedItems } from '../library/useLibrary';
import { when } from '../passageView';
import { failureMessage } from '../report';
import { LanguageField } from '../reference/LanguageField';
import { readerLanguage } from '../reference/languages';
import { contractsFor } from '../screenContracts';
import { sourceText } from '../scripture';
import { C, radius, space, TINT } from '../theme';
import { VoiceNote } from '../voiceNote';
import { CheckSteps } from '../simple/checks';
import { SwitchRow } from '../simple/admin';
import { flipSwitch, ROLE_SWITCHES, stepTitle, stepWho, switchState } from '../simple/adminModel';
import { teamMembers } from '../orgAdmin';
import {
  draftChanged, draftFromDoc, draftFromLanguage, fieldLabel, flowDocFrom, flowLabel, flowName, flowUndoFor, flowUse, holdersOf, isFiaTerm,
  levelLabel, libraryMaterialLine, libraryQuestions, matchesTerm, materialDocFrom, materialItemId, moveStep, newKindId,
  nextFieldId, parseRefLinks, PRIVILEGE_INFO, questionCount, questionCountLabel, questionDrafts, questionSetToReviews,
  referenceKinds, referenceKindName, referenceView, roleRows, scopeName, setKindName, termsInPassage, viewLevelFrom,
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

/** A section's name and how many it holds: "Questions · 3". */
function withCount(label: string, n: number): string {
  return `${label} · ${formatNumber(n)}`;
}

/** Names in a run ("Luke 15, Ruth 1"), with the separator of the language showing. */
function listOf(items: string[]): string {
  return items.join(t('config.listJoin'));
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

/** What a view without a language covers: the organization, which holds its languages directly (decision 63). */
function orgName(ctx: Ctx): string {
  return ctx.org.state?.org?.value.name ?? t('config.unnamedOrg');
}

/** The open language's name, or null when the organization has none yet. */
function openLanguageName(ctx: Ctx): string | null {
  const id = ctx.language.languageId;
  return id ? languageName(ctx.org.state, id) : null;
}

// ─── Roles (ORG-3, ORG-4) ──────────────────────────────────────────────────────────

export function RolesHome(ctx: Ctx) {
  const level = viewLevelFrom(ctx.params, ctx.session.adminScope);
  const beside = useOpenDetail();
  const org = ctx.org.state;
  const rows = useMemo(() => roleRows(org, level), [org, level]);
  const canManage = ctx.session.can('manage_roles') && level === 'org';
  return (
    <Screen header={<Header title={t('config.roles.title')} sub={levelLabel(level)} onBack={ctx.back}
      action={canManage ? <SmallBtn label={t('config.roles.addRole')} icon="plus" tone="primary" onPress={() => ctx.go('role_editor', { roleId: 'new', level })} /> : undefined} />}>
      <Intro>{level === 'org' ? t('config.roles.introOrg') : t('config.roles.introLanguage')}</Intro>
      {!org ? <EmptyState icon="people" title={t('config.roles.loading')} /> : rows.length === 0 ? (
        <EmptyState icon="people" title={t('config.roles.empty')} sub={canManage ? t('config.roles.emptySub') : undefined} />
      ) : (
        <>
          <SectionLabel label={t('config.roles.definedAtOrg')} />
          <Group>
            {rows.map((r, i) => (
              <Row key={r.roleId} icon={r.inherited ? 'lock' : r.builtIn ? 'people' : 'star'}
                iconColor={r.inherited ? TINT.grayText : C.primary} iconBg={r.inherited ? TINT.gray : undefined}
                label={r.name} muted={r.inherited}
                sub={r.inherited ? t('config.roles.inheritedSub')
                  : `${t('config.roles.members', { count: r.members })} · ${t('config.roles.privileges', { count: r.privileges.length })}`}
                badge={r.inherited ? t('common.viewOnly') : undefined}
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
  const holders = useMemo(() => (isNew ? [] : holdersOf(org, roleId)), [isNew, org, roleId]);
  const canAssign = ctx.session.can('assign_work');
  const dirty = isNew
    ? label.trim() !== ''
    : !!existing && (label.trim() !== existing.name.value
      || privileges.length !== existing.privileges.value.length || privileges.some((p) => !existing.privileges.value.includes(p)));

  if (!isNew && !existing) {
    return (
      <Screen header={<Header title={t('config.roleEditor.title')} onBack={ctx.back} />}>
        <EmptyState icon="people" title={org ? t('config.roleEditor.gone') : t('config.roleEditor.loading')} />
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
      ctx.toast(isNew ? t('config.roleEditor.created', { name: next.name }) : t('config.roleEditor.saved', { name: next.name }), prev ? async () => {
        try { await ctx.org.append('v1.RoleDefined', prev); ctx.toast(t('common.undone')); } catch (e) { ctx.toast(t('common.notUndone', { reason: failure('undo role', e) })); }
      } : undefined);
      ctx.back();
    } catch (e) {
      ctx.toast(t('common.notSaved', { reason: failure('save role', e) }));
      setBusy(false);
    }
  }

  const people = new Set(holders.map((h) => h.profileId)).size;
  // The role's permissions as three groups of switches in the admin's words (decision 71, demo ADR-039).
  return (
    <Screen
      header={<Header title={label || (isNew ? t('config.roleEditor.newRole') : t('config.roleEditor.title'))} sub={isNew ? t('config.roleEditor.aNewRole') : t('config.roleEditor.people', { count: people })} onBack={ctx.back} />}
      bodyStyle={{ gap: space.sm }}
      footer={readOnly ? undefined : <PrimaryBtn label={t('common.save')} icon="check" onPress={() => void save()} disabled={!label.trim() || !dirty} busy={busy} />}>
      {inherited ? <Banner icon="lock" title={t('common.viewOnly')} body={t('config.roleEditor.inheritedBody')} /> : null}
      {readOnly && !inherited ? <Banner icon="lock" title={t('common.viewOnly')} body={t('config.roleEditor.noPermission')} /> : null}
      {isNew && !readOnly ? <Field label={t('config.roleEditor.nameLabel')} value={label} onChangeText={setName} placeholder={t('config.roleEditor.namePlaceholder')} autoCapitalize="words" /> : null}
      {ROLE_SWITCHES.map((g) => (
        <View key={g.title} style={{ gap: space.sm }}>
          <SectionLabel label={g.title} />
          <Group>
            {g.rows.map((row, i) => {
              const state = switchState(privileges, row);
              return (
                <SwitchRow key={row.label} label={row.label} on={state !== 'off'} disabled={readOnly || busy} last={i === g.rows.length - 1}
                  {...(state === 'some' ? { sub: t('config.roleEditor.onlySome', { privileges: listOf(row.privileges.filter((p) => privileges.includes(p)).map((p) => PRIVILEGE_INFO[p].label)) }) } : {})}
                  onToggle={() => setPicked(flipSwitch(privileges, row))} />
              );
            })}
          </Group>
        </View>
      ))}
      {!isNew ? (
        <>
          <SectionLabel label={t('config.roleEditor.peopleSection')} />
          {canAssign ? <GhostBtn label={label ? t('config.roleEditor.inviteAs', { role: label }) : t('config.roleEditor.inviteAsThisRole')} icon="qr" onPress={() => ctx.go('invite_qr', { roleId })} /> : null}
          <Capped items={holders} empty={t('config.roleEditor.nobody')} render={(h, last) => (
            <Row key={`${h.profileId}-${JSON.stringify(h.scope)}`} icon="user"
              label={h.profileId === ctx.session.actorId ? t('common.you') : ctx.name(h.profileId)}
              sub={scopeName(h.scope, org)}
              onPress={canAssign ? () => ctx.go('edit_member', { memberId: h.profileId }) : undefined} last={last} />
          )} />
          {!readOnly ? <Field label={t('config.roleEditor.itsName')} value={label} onChangeText={setName} placeholder={t('config.roleEditor.itsNamePlaceholder')} autoCapitalize="words" /> : null}
        </>
      ) : null}
      <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>{t('config.roleEditor.scopeNote')}</Text>
    </Screen>
  );
}

// ─── The library (docs/library.md) ─────────────────────────────────────────────────

type Library = ReturnType<typeof useLibrary>;

/** A library action that needs the server says so plainly when offline, instead of reporting a fault. */
function libraryFailure(where: string, e: unknown): string {
  if (e instanceof Error && !(e instanceof CommandError) && /network|fetch|offline|timed? ?out/i.test(e.message)) {
    return t('common.notConnected');
  }
  return failure(where, e);
}

/** Run a library write, then say what changed, with Undo when it is a simple flip back. True when it was saved. */
async function libraryAct(ctx: Ctx, where: string, action: () => Promise<unknown>, message: string, undo?: () => Promise<unknown>): Promise<boolean> {
  try {
    await action();
  } catch (e) {
    ctx.toast(t('common.notSaved', { reason: libraryFailure(where, e) }));
    return false;
  }
  ctx.toast(message, undo ? async () => {
    try { await undo(); ctx.toast(t('common.undone')); } catch (e) { ctx.toast(t('common.notUndone', { reason: libraryFailure(`undo ${where}`, e) })); }
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
      autoUpdate ? t('config.library.followingAuto', { name: s.name }) : t('config.library.followingManual', { name: s.name }),
      () => live.current.follow(itemId, { active: false }));
    setBusy(false);
  }
  async function copy(s: SharedItem) {
    setBusy(true);
    await libraryAct(ctx, 'copy', () => lib.copy(s), t('config.library.copied', { name: s.name }));
    setBusy(false);
  }

  return (
    <>
      <SectionLabel label={withCount(t('config.library.fromOthers'), rows.length)} />
      {shared.error ? (
        <Card><Text style={txt.smMuted}>{shared.rows.length ? t('config.library.refreshFailed') : t('config.library.loadFailed')}</Text></Card>
      ) : null}
      {!shared.loaded ? <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('common.loading')}</Text>
        : rows.length === 0 && !shared.error ? <Card><Text style={txt.smMuted}>{t('config.library.nothingShared')}</Text></Card> : null}
      {rows.slice(0, n).map((s) => (
        <Card key={`${s.org_id}/${s.item_id}`}>
          <Text style={txt.h3}>{s.name}</Text>
          <Text style={txt.xsStrong}>{`${s.org_name} · ${t('config.library.versions', { count: s.version_count })}`}</Text>
          {s.description ? <Text style={txt.smMuted}>{s.description}</Text> : null}
          {props.detail?.(s)}
          {props.canManage ? (
            <View style={styles.actions}>
              {props.use ? <SmallBtn label={props.use.label} tone="primary" disabled={busy || props.use.disabled} onPress={() => props.use!.onUse(s)} /> : null}
              {s.subscribable ? <SmallBtn label={t('config.library.follow')} icon="link" disabled={busy} onPress={() => setFollowing(s)} /> : null}
              <SmallBtn label={t('common.copy')} icon="plus" disabled={busy} onPress={() => void copy(s)} />
            </View>
          ) : null}
        </Card>
      ))}
      <ShowMore remaining={rows.length - n} step={STEP} onMore={() => setN(n + STEP)} />

      <Sheet visible={following !== null} title={following ? t('config.library.followNamed', { name: following.name }) : t('config.library.follow')} onClose={() => setFollowing(null)}
        sub={following ? t('config.library.followSheetSub', { org: following.org_name }) : undefined}
        footer={<>
          <PrimaryBtn label={t('config.library.updateAutomatically')} onPress={() => following && void follow(following, true)} busy={busy} />
          <GhostBtn label={t('config.library.takeUpdatesMyself')} onPress={() => following && void follow(following, false)} />
        </>}>
        <Text style={txt.sm}>{t('config.library.followSheetBody')}</Text>
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
      <SectionLabel label={t('config.library.sectionTitle')} />
      <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>{sourceLine(it)}</Text>
      {sub ? (
        <>
          <Group>
            <ToggleRow label={t('config.library.updateAutomatically')} desc={t('config.library.takeEachVersion', { org: sub.sourceOrgName })} on={sub.autoUpdate}
              disabled={!canManage || busy || !sub.active} last
              onToggle={() => void run('follow updates', () => lib.follow(it.itemId, { autoUpdate: !sub.autoUpdate }), // i18n-ignore: log label
                sub.autoUpdate ? t('config.library.youChooseUpdates') : t('config.library.updatesAutomatically'),
                () => live.current.follow(it.itemId, { autoUpdate: sub.autoUpdate }))} />
          </Group>
          {props.update && canManage ? (
            <GhostBtn label={t('config.library.takeUpdate')} icon="download" disabled={busy}
              onPress={() => void run('take update', // i18n-ignore: log label
                () => lib.takeUpdate(it, props.update!), t('config.library.upToDate', { name: it.name }))} />
          ) : null}
          {canManage ? (
            <>
              <GhostBtn label={t('config.library.copyToChange')} icon="plus" disabled={busy}
                onPress={() => void run('copy', () => lib.copyFollowed(it), t('config.library.copied', { name: it.name })).then((ok) => ok && props.onCopied())} />
              {sub.active ? (
                <GhostBtn label={t('config.library.stopFollowing')} tone="red" disabled={busy}
                  onPress={() => void run('stop following', () => lib.follow(it.itemId, { active: false }), t('config.library.stoppedFollowing'), // i18n-ignore: log label
                    () => live.current.follow(it.itemId, { active: true }))} />
              ) : (
                <GhostBtn label={t('config.library.followAgain')} disabled={busy} onPress={() => void run('follow', () => lib.follow(it.itemId, { active: true }), t('config.library.followingAgain', { org: sub.sourceOrgName }))} />
              )}
            </>
          ) : null}
        </>
      ) : (
        <>
          <Group>
            <ToggleRow label={t('config.library.share')} desc={t('config.library.shareDesc')} on={it.shared} disabled={!canManage || busy} last={!it.shared}
              onToggle={() => void run('share', () => lib.setSharing(it, !it.shared, it.subscribable),
                it.shared ? t('config.library.unshared') : t('config.library.shared'),
                () => lib.setSharing(it, it.shared, it.subscribable))} />
            {it.shared ? (
              <ToggleRow label={t('config.library.letFollow')} desc={t('config.library.letFollowDesc')} on={it.subscribable}
                disabled={!canManage || busy} last
                onToggle={() => void run('share', () => lib.setSharing(it, true, !it.subscribable),
                  it.subscribable ? t('config.library.noLongerFollowable') : t('config.library.followableNow'),
                  () => lib.setSharing(it, true, it.subscribable))} />
            ) : null}
          </Group>
          {canManage ? (
            <GhostBtn label={it.archived ? t('config.library.unarchive') : t('config.library.archive')} icon="folder" disabled={busy}
              onPress={() => void run('archive', () => lib.archive(it, !it.archived),
                it.archived ? t('config.library.unarchived', { name: it.name }) : t('config.library.archived', { name: it.name }),
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
        <Text style={[txt.xsStrong, { color: TINT.grayText }]}>{t('config.flows.noReviews')}</Text>
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
  if (!props.doc) return <Text style={txt.smMuted}>{t('common.loading')}</Text>;
  // A shipped kind the document carries reads in the language showing.
  return <FlowStepsInline steps={props.doc.steps.map((s) => ({ kindIds: s.kindIds, checkpoint: !!s.checkpoint }))} kinds={[...props.doc.kinds.map(localKind), ...props.kinds]} />;
}

export function FlowsHome(ctx: Ctx) {
  const state = ctx.language.state;
  const lib = useLibrary(ctx);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(STEP);
  const current = useMemo(() => (state ? flowUse(state) : null), [state]);
  const kinds = useMemo(() => (state ? deriveKinds(state) : []), [state]);
  const live = useLatest(ctx);
  const canManage = ctx.session.can('manage_flows');
  const flows = lib.items('flow');
  const shared = useSharedItems('flow', lib.orgId);
  const { updates } = useLibraryUpdates(lib.orgId);
  const docs = useLibraryDocs(lib.orgId, [...flows.map((f) => f.current), ...shared.rows.map((s) => s.latest_hash)]);
  const language = openLanguageName(ctx);

  /**
   * Use a flow for the language: one of this organization's, or a shared
   * one, followed with automatic updates first (copied when its owner does
   * not allow following). Undo goes back to the flow it had, whose steps
   * were never removed (core `restoreFlow`).
   */
  async function use(target: { itemId: string } | { shared: SharedItem }) {
    if (!state || !language || busy) return;
    setBusy(true);
    let specs: EventSpec[];
    let name: string;
    let undo: (() => EventSpec[]) | undefined;
    try {
      const previous = flowUndoFor(state);
      if (previous) {
        undo = () => {
          const s = live.current.language.state;
          return s ? commands(s, indexesFor(s)).restoreFlow({ commandId: Crypto.randomUUID(), previous }) : [];
        };
      }
      if ('shared' in target) {
        const s = target.shared;
        const itemId = s.subscribable ? await lib.subscribe(s, true) : await lib.copy(s);
        name = s.name;
        specs = await lib.applySpecs(itemId, { docHash: s.latest_hash });
      } else {
        const it = lib.item(target.itemId);
        if (!it?.current) throw new CommandError(t('config.errors.flowHasNoVersion'));
        name = it.name;
        specs = await lib.applySpecs(it.itemId, { docHash: it.current });
      }
    } catch (e) {
      ctx.toast(t('common.notSaved', { reason: libraryFailure('use flow', e) })); // i18n-ignore: log label
      setBusy(false);
      return;
    }
    try {
      await ctx.act(specs, t('config.flows.nowUses', { language, flow: name }), undo);
    } catch {
      // ctx.act has already said "Not saved" and why.
    }
    setBusy(false);
  }

  const open = (itemId: string) => (canManage ? () => ctx.go('flow_editor', { itemId }) : undefined);
  const currentItem = current?.itemId ? lib.item(current.itemId) : null;
  const versionOf = currentItem?.versions.find((v) => v.docHash === current?.docHash)?.n;

  return (
    <Screen header={<Header title={t('config.flows.title')} sub={language ?? orgName(ctx)} onBack={ctx.back}
      action={canManage ? <SmallBtn label={t('config.flows.addFlow')} icon="plus" tone="primary" onPress={() => ctx.go('flow_editor', { itemId: 'new' })} /> : undefined} />}>
      <Intro>{t('config.flows.intro')}</Intro>
      {!state ? <EmptyState icon="flow" title={t('common.loading')} /> : (
        <>
          {!language ? <EmptyState icon="globe" title={t('config.flows.noLanguages')} sub={t('config.flows.noLanguagesSub')} /> : null}
          {language && current ? (
            <Card>
              <Text style={txt.xsStrong}>{t('config.flows.languageUses', { language })}</Text>
              <Text style={txt.h3}>{flowLabel(current)}</Text>
              {currentItem ? (
                <Text style={txt.xs}>
                  {[versionOf ? t('config.flows.version', { n: versionOf }) : '', currentItem.current && currentItem.current !== current.docHash ? t('config.flows.movingToNewest') : '', sourceLine(currentItem)].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
              <FlowStepsInline steps={current.steps} kinds={kinds} />
              {canManage && currentItem ? <SmallBtn label={t('config.flows.openFlow')} icon="edit" onPress={() => ctx.go('flow_editor', { itemId: currentItem.itemId })} /> : null}
              {canManage && !current.itemId && current.chosen && current.steps.length ? (
                <SmallBtn label={t('config.flows.saveAsFlow')} icon="plus" onPress={() => ctx.go('flow_editor', { itemId: 'new', languageId: ctx.language.languageId })} />
              ) : null}
            </Card>
          ) : null}

          <SectionLabel label={withCount(t('config.flows.yourOrganization'), flows.length)} />
          {flows.length === 0 ? (
            <Card><Text style={txt.smMuted}>{t('config.flows.noFlows')}</Text></Card>
          ) : null}
          {flows.slice(0, shown).map((f) => {
            const on = !!current && current.itemId === f.itemId;
            return (
              <Card key={f.itemId} onPress={open(f.itemId)} accessibilityLabel={t('config.flows.openNamed', { name: f.name })}
                style={on ? { borderColor: C.primary, borderWidth: 1.5 } : undefined}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
                  <View style={{ flex: 1 }}>
                    <Text style={txt.h3}>{f.name}</Text>
                    <Text style={txt.xs}>{sourceLine(f)}</Text>
                    {f.description ? <Text style={[txt.smMuted, { marginTop: 2 }]}>{f.description}</Text> : null}
                  </View>
                  {f.archived ? <Badge label={t('config.library.archivedBadge')} />
                    : updates[f.itemId] ? <Badge label={t('config.library.updateBadge')} tone="amber" /> : null}
                  {on
                    ? <SmallBtn label={t('config.flows.inUse')} icon="check" tone="primary" onPress={() => {}} />
                    : language && !f.archived ? <SmallBtn label={t('config.flows.use')} onPress={() => void use({ itemId: f.itemId })} disabled={!canManage || busy || !f.current} /> : null}
                </View>
                <DocSteps doc={docs.get<FlowDoc>(f.current)} kinds={kinds} />
              </Card>
            );
          })}
          <ShowMore remaining={flows.length - shown} step={STEP} onMore={() => setShown(shown + STEP)} />

          <SharedItems ctx={ctx} lib={lib} shared={shared} canManage={canManage}
            detail={(s) => <DocSteps doc={docs.get<FlowDoc>(s.latest_hash)} kinds={kinds} />}
            {...(language ? { use: { label: t('config.flows.use'), onUse: (s: SharedItem) => void use({ shared: s }), disabled: busy } } : {})} />
        </>
      )}
    </Screen>
  );
}

/**
 * Who usually does a step: the review group that usually takes its kind (by
 * name, or its one member's), else who usually does that kind.
 */
function usuallyFor(ctx: Ctx, state: LanguageState, kinds: KindDef[]) {
  return (kindIds: string[]) => {
    const who = kinds.find((k) => k.id === kindIds[0])?.usualReviewer || stepWho(kindIds, kinds);
    const team = Object.entries(state.teams).find(([, tm]) => tm.kindId?.value && kindIds.includes(tm.kindId.value));
    if (!team) return who || t('config.flowEditor.anyoneTeamAsks');
    const [teamId, tm] = team;
    const people = teamMembers(state, teamId);
    return people.length === 1 ? `${who} · ${ctx.name(people[0]!)}` : tm.name.value || who;
  };
}

/**
 * What else a step can do, from a tap on its card: the checks it holds (one
 * removed, one added alongside), and moving or removing it.
 */
function StepSheet(props: {
  step: DraftStep | null; i: number; count: number; kinds: KindDef[]; title: string;
  onClose: () => void; onChange: (s: DraftStep) => void; onAdd: () => void; onMove: (dir: -1 | 1) => void; onRemove: () => void;
}) {
  const st = props.step;
  const name = (id: string) => props.kinds.find((k) => k.id === id)?.name ?? id;
  return (
    <Sheet visible={!!st} title={props.title} sub={t('config.flowEditor.stepOf', { step: props.i + 1, total: props.count })} onClose={props.onClose}>
      {st ? (
        <>
          <Group>
            {st.kindIds.map((id, j) => (
              <Row key={id} leading={<KindIcon kindId={id} size={40} />} label={name(id)} last={j === st.kindIds.length - 1}
                right={st.kindIds.length > 1 ? <IconBtn name="close" label={t('config.flowEditor.removeCheck', { name: name(id) })} onPress={() => props.onChange({ ...st, kindIds: st.kindIds.filter((k) => k !== id) })} bg={C.light} color={C.primary} /> : undefined} />
            ))}
          </Group>
          <Group>
            <Row icon="plus" label={t('config.flowEditor.addAlongside')} sub={t('config.flowEditor.addAlongsideSub')} onPress={props.onAdd} />
            {props.i > 0 ? <Row icon="up" label={t('config.flowEditor.moveUp')} onPress={() => props.onMove(-1)} /> : null}
            {props.i < props.count - 1 ? <Row icon="down" label={t('config.flowEditor.moveDown')} onPress={() => props.onMove(1)} /> : null}
            <Row icon="trash" label={t('config.flowEditor.removeStep')} iconColor={TINT.redText} iconBg={TINT.red} onPress={props.onRemove} last />
          </Group>
        </>
      ) : null}
    </Sheet>
  );
}

/**
 * The flow editor (FLOW-1..3), in the admin's simple shape (decision 71,
 * demo ADR-039 "Who checks"): the steps top to bottom, each with who usually
 * does it and a lock for a step that must pass. With `steps: 'language'` it
 * edits the open language's own checks (core `saveFlowSteps`, Undo puts
 * back the flow it had); otherwise a library flow, whose Save publishes a
 * new version that the languages using it move to.
 */
export function FlowEditor(ctx: Ctx) {
  if (ctx.params['steps'] === 'language') return <LanguageChecks ctx={ctx} />;
  return <LibraryFlowEditor ctx={ctx} />;
}

function LanguageChecks({ ctx }: { ctx: Ctx }) {
  const state = ctx.language.state;
  const language = openLanguageName(ctx);
  const flow = useMemo(() => (state ? deriveFlow(state) : null), [state]);
  const known = useMemo(() => (state ? deriveKinds(state) : []), [state]);
  const base = useMemo<DraftStep[]>(() => (flow ? flow.steps.map((s, i) => ({ key: `${s.id}#${i}`, stepId: s.id, kindIds: [...s.kindIds], checkpoint: s.checkpoint })) : []), [flow]);
  const [edited, setEdited] = useState<DraftStep[] | null>(null);
  const [added, setAdded] = useState<KindDef[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [pickFor, setPickFor] = useState<number | 'new' | null>(null);
  const [newKind, setNewKind] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = useLatest(ctx);
  const canManage = ctx.session.can('manage_flows');
  if (!state || !flow) {
    return <Screen header={<Header title={t('config.flowEditor.whoChecks')} onBack={ctx.back} />}><EmptyState icon="flow" title={t('common.loading')} /></Screen>;
  }
  const kinds = [...known, ...added.filter((k) => !known.some((x) => x.id === k.id))];
  const steps = edited ?? base;
  const dirty = canManage && (draftChanged(base, steps) || added.length > 0);
  const change = (next: DraftStep[]) => setEdited(next);
  const title = (i: number) => stepTitle(steps[i]?.kindIds ?? [], kinds);

  async function save() {
    if (!state || !dirty || busy) return;
    if (steps.some((s) => s.kindIds.length === 0)) { ctx.toast(t('config.flowEditor.everyStepNeedsCheck')); return; }
    setBusy(true);
    const commandId = Crypto.randomUUID();
    const c = commands(state, indexesFor(state));
    let specs: EventSpec[];
    try {
      const used = new Set(steps.flatMap((s) => s.kindIds));
      specs = [
        ...added.filter((k) => used.has(k.id)).flatMap((k, i) => c.defineKind({ commandId: `${commandId}:kind${i}`, kindId: k.id, name: k.name, description: k.description, usualReviewer: k.usualReviewer })),
        ...c.saveFlowSteps({ commandId, steps: steps.map((s) => ({ ...(s.stepId ? { stepId: s.stepId } : {}), kindIds: s.kindIds, checkpoint: s.checkpoint })) })
      ];
    } catch (e) {
      ctx.toast(failure('save checks', e));
      setBusy(false);
      return;
    }
    const previous = flowUndoFor(state);
    const undo = previous ? () => {
      const s = live.current.language.state;
      return s ? commands(s, indexesFor(s)).restoreFlow({ commandId: Crypto.randomUUID(), previous }) : [];
    } : undefined;
    try {
      await ctx.act(specs, language ? t('config.flowEditor.checksSaved', { language }) : t('config.flowEditor.checksSavedUnnamed'), undo);
    } catch {
      setBusy(false);
      return;
    }
    ctx.back();
  }

  const picking = typeof pickFor === 'number' ? steps[pickFor] : undefined;
  const pick = (id: string) => {
    if (pickFor === 'new') change([...steps, { key: Crypto.randomUUID(), kindIds: [id], checkpoint: false }]);
    else if (typeof pickFor === 'number') change(steps.map((s, j) => (j === pickFor ? { ...s, kindIds: [...s.kindIds, id] } : s)));
    setPickFor(null);
  };
  return (
    <Screen
      header={<Header title={t('config.flowEditor.whoChecks')} sub={`${language ?? ''} · ${flow.flowId === CUSTOM_FLOW ? t('config.flowEditor.itsOwnSteps') : flowName(state)}`} onBack={() => (dirty ? setLeaving(true) : ctx.back())} />}
      footer={canManage ? <PrimaryBtn label={t('common.save')} icon="check" onPress={() => void save()} disabled={!dirty} busy={busy} /> : undefined}>
      {!canManage ? <Banner icon="lock" title={t('common.viewOnly')} body={t('config.flowEditor.viewOnlyBody')} /> : null}
      <CheckSteps steps={steps} kinds={kinds} readOnly={!canManage} usually={usuallyFor(ctx, state, kinds)} onChange={change}
        onAdd={() => setPickFor('new')} onOpen={(i) => setOpen(i)} />
      {dirty ? <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>{t('config.flowEditor.languageOnly', { language: language ?? '' })}</Text> : null}
      {canManage ? (
        <Group>
          <Row icon="people" label={t('config.flowEditor.groups')} sub={t('config.flowEditor.groupsSub')}
            onPress={() => ctx.go('review_teams', { languageId: ctx.language.languageId })} />
          <Row icon="flow" label={t('config.flowEditor.everyWay')} sub={t('config.flowEditor.everyWaySub')} last
            onPress={() => ctx.go('flows_home', { languageId: ctx.language.languageId })} />
        </Group>
      ) : null}
      <StepSheet step={open !== null ? steps[open] ?? null : null} i={open ?? 0} count={steps.length} kinds={kinds} title={open !== null ? title(open) : ''}
        onClose={() => setOpen(null)}
        onChange={(st) => open !== null && change(steps.map((s, j) => (j === open ? st : s)))}
        onAdd={() => { const i = open; setOpen(null); setPickFor(i); }}
        onMove={(dir) => { if (open === null) return; change(moveStep(steps, open, dir)); setOpen(open + dir); }}
        onRemove={() => { if (open === null) return; change(steps.filter((_, j) => j !== open)); setOpen(null); }} />
      <Sheet visible={pickFor !== null} title={pickFor === 'new' ? t('config.flowEditor.addStep') : t('config.flowEditor.addAlongside')} sub={t('config.flowEditor.pickSub')} onClose={() => setPickFor(null)}>
        <Group>
          {kinds.filter((k) => !(picking?.kindIds ?? []).includes(k.id)).map((k, i, a) => (
            <Row key={k.id} leading={<KindIcon kindId={k.id} size={40} />} label={stepTitle([k.id], kinds)} sub={k.usualReviewer || k.description || undefined}
              onPress={() => pick(k.id)} last={i === a.length - 1} />
          ))}
        </Group>
        <Field label={t('config.flowEditor.somethingElse')} value={newKind} onChangeText={setNewKind} placeholder={t('config.flowEditor.newCheckPlaceholder')} autoCapitalize="words" />
        <SmallBtn label={t('config.flowEditor.addThisCheck')} icon="plus" tone="primary" disabled={!newKind.trim()} onPress={() => {
          if (!newKind.trim()) return;
          const k: KindDef = { id: newKindId(newKind, kinds.map((x) => x.id)), name: newKind.trim(), description: t('config.flowEditor.newKindDescription'), usualReviewer: t('config.flowEditor.newKindReviewer') };
          setAdded([...added, k]);
          setNewKind('');
          pick(k.id);
        }} />
      </Sheet>
      <Sheet visible={leaving} title={t('config.flowEditor.leaveTitle')} sub={t('config.flowEditor.leaveSubChecks')} onClose={() => setLeaving(false)}
        footer={<>
          <PrimaryBtn label={t('common.save')} icon="check" onPress={() => { setLeaving(false); void save(); }} busy={busy} />
          <GhostBtn label={t('config.flowEditor.discard')} tone="red" onPress={() => { setLeaving(false); ctx.back(); }} />
        </>}>
        {null}
      </Sheet>
    </Screen>
  );
}

function LibraryFlowEditor({ ctx }: { ctx: Ctx }) {
  const state = ctx.language.state;
  const lib = useLibrary(ctx);
  const requested = ctx.params['itemId'] ?? 'new';
  const isNew = requested === 'new';
  const it = isNew ? null : lib.item(requested);
  const docs = useLibraryDocs(lib.orgId, [it?.current]);
  const doc = docs.get<FlowDoc>(it?.current);
  const { updates } = useLibraryUpdates(lib.orgId);
  // A new flow may start from the language's own steps (made a library flow).
  const [seed] = useState(() => (isNew && ctx.params['languageId'] && state?.flow
    ? { name: flowName(state), description: '', steps: draftFromLanguage(state) }
    : { name: '', description: '', steps: [] as DraftStep[] }));
  const base = useMemo(() => (isNew ? seed : doc ? { name: doc.name, description: doc.description, steps: draftFromDoc(doc) } : null), [isNew, seed, doc]);
  const [name, setName] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [edited, setEdited] = useState<DraftStep[] | null>(null);
  const [added, setAdded] = useState<KindDef[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [pickFor, setPickFor] = useState<number | 'new' | null>(null);
  const [newKind, setNewKind] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const known = useMemo(() => {
    const out = new Map<string, KindDef>();
    for (const k of [...(state ? deriveKinds(state) : []), ...(doc?.kinds ?? []).map(localKind)]) if (!out.has(k.id)) out.set(k.id, k);
    return [...out.values()];
  }, [state, doc]);
  const kinds = useMemo(() => [...known, ...added.filter((k) => !known.some((x) => x.id === k.id))], [known, added]);
  const canManage = ctx.session.can('manage_flows');
  const followed = it?.source === 'subscription';
  const readOnly = !canManage || followed;
  const steps = edited ?? base?.steps ?? [];
  const label = name ?? base?.name ?? '';
  const desc = description ?? base?.description ?? '';
  const dirty = !readOnly && base !== null
    && (label.trim() !== base.name || desc.trim() !== base.description || draftChanged(base.steps, steps) || added.length > 0);
  const language = openLanguageName(ctx);
  const usedHere = !!it && !!language && usesItem(state, it.itemId);

  if (!state || (!isNew && !it)) {
    return (
      <Screen header={<Header title={t('config.flowEditor.reviewFlow')} onBack={ctx.back} />}>
        <EmptyState icon="flow" title={state && ctx.org.state ? t('config.flowEditor.gone') : t('common.loading')} />
      </Screen>
    );
  }

  const change = (next: DraftStep[]) => setEdited(next);
  const title = (i: number) => stepTitle(steps[i]?.kindIds ?? [], kinds);
  const picking = typeof pickFor === 'number' ? steps[pickFor] : undefined;
  const pick = (id: string) => {
    if (pickFor === 'new') change([...steps, { key: Crypto.randomUUID(), kindIds: [id], checkpoint: false }]);
    else if (typeof pickFor === 'number') change(steps.map((s, j) => (j === pickFor ? { ...s, kindIds: [...s.kindIds, id] } : s)));
    setPickFor(null);
  };

  /** Save publishes a new version; languages using the flow move to it by themselves (follow.ts). */
  async function save() {
    if (readOnly || busy || !label.trim()) return;
    const flowDoc = flowDocFrom({ name: label, description: desc, steps, kinds });
    setBusy(true);
    const saved = await libraryAct(ctx, 'save flow', // i18n-ignore: log label
      () => lib.publish({ kind: 'flow', ...(it ? { itemId: it.itemId } : {}), name: flowDoc.name, description: flowDoc.description, doc: flowDoc }),
      usedHere ? t('config.flowEditor.savedMoves', { name: flowDoc.name, language }) : t('config.flowEditor.saved', { name: flowDoc.name }));
    if (saved) ctx.back();
    else setBusy(false);
  }

  return (
    <Screen
      header={<Header title={label || (isNew ? t('config.flowEditor.newWayToCheck') : t('config.flowEditor.whoChecks'))} sub={it ? sourceLine(it) : t('config.flowEditor.newSub')}
        onBack={() => (dirty ? setLeaving(true) : ctx.back())} />}
      footer={readOnly ? undefined : <PrimaryBtn label={t('common.save')} icon="check" onPress={() => void save()} disabled={!dirty || !label.trim()} busy={busy} />}>
      {followed ? (
        <Banner icon="link" title={t('config.library.follows', { org: it!.subscription!.sourceOrgName })} body={t('config.library.followsBody')} />
      ) : !canManage ? <Banner icon="lock" title={t('common.viewOnly')} body={t('config.flowEditor.noPermission')} /> : null}
      {!base ? <Card><Text style={txt.smMuted}>{t('common.loading')}</Text></Card> : (
        <>
          {readOnly ? (desc ? <Text style={[txt.sm, { paddingHorizontal: space.xs }]}>{desc}</Text> : null) : (
            <>
              <Field label={t('config.flowEditor.nameLabel')} value={label} onChangeText={setName} placeholder={t('config.flowEditor.namePlaceholder')} autoCapitalize="words" />
              <Field label={t('config.flowEditor.descriptionLabel')} value={desc} onChangeText={setDescription} placeholder={t('config.flowEditor.descriptionPlaceholder')} autoCapitalize="sentences" multiline />
            </>
          )}
          <CheckSteps steps={steps} kinds={kinds} readOnly={readOnly} usually={usuallyFor(ctx, state, kinds)} onChange={change}
            onAdd={() => setPickFor('new')} onOpen={(i) => { if (!readOnly) setOpen(i); }} />
          {!readOnly && steps.length > 0 ? (
            <SmallBtn label={t('config.flowEditor.noChecks')} onPress={() => change([])} />
          ) : null}
          <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>
            {usedHere ? t('config.flowEditor.usedHere', { language }) : t('config.flowEditor.usedNote')}
          </Text>
        </>
      )}
      {it ? (
        <LibraryItemSettings ctx={ctx} lib={lib} it={it} canManage={canManage} {...(updates[it.itemId] ? { update: updates[it.itemId] } : {})} onCopied={ctx.back} />
      ) : null}

      <StepSheet step={open !== null ? steps[open] ?? null : null} i={open ?? 0} count={steps.length} kinds={kinds} title={open !== null ? title(open) : ''}
        onClose={() => setOpen(null)}
        onChange={(st) => open !== null && change(steps.map((s, j) => (j === open ? st : s)))}
        onAdd={() => { const i = open; setOpen(null); setPickFor(i); }}
        onMove={(dir) => { if (open === null) return; change(moveStep(steps, open, dir)); setOpen(open + dir); }}
        onRemove={() => { if (open === null) return; change(steps.filter((_, j) => j !== open)); setOpen(null); }} />
      <Sheet visible={pickFor !== null} title={pickFor === 'new' ? t('config.flowEditor.addStep') : t('config.flowEditor.addAlongside')} sub={t('config.flowEditor.kindsSub')} onClose={() => setPickFor(null)}>
        <Group>
          {kinds.filter((k) => !(picking?.kindIds ?? []).includes(k.id)).map((k, i, a) => (
            <Row key={k.id} leading={<KindIcon kindId={k.id} size={40} />} label={k.name} sub={k.description || k.usualReviewer || undefined}
              onPress={() => pick(k.id)} last={i === a.length - 1} />
          ))}
        </Group>
        <Field label={t('config.flowEditor.newKindLabel')} value={newKind} onChangeText={setNewKind} placeholder={t('config.flowEditor.newKindPlaceholder')} autoCapitalize="words" />
        <SmallBtn label={t('config.flowEditor.addThisKind')} icon="plus" tone="primary" disabled={!newKind.trim()} onPress={() => {
          if (!newKind.trim()) return;
          const k: KindDef = { id: newKindId(newKind, kinds.map((x) => x.id)), name: newKind.trim(), description: t('config.flowEditor.newKindDescription'), usualReviewer: t('config.flowEditor.newKindReviewer') };
          setAdded([...added, k]);
          setNewKind('');
          pick(k.id);
        }} />
      </Sheet>

      <Sheet visible={leaving} title={t('config.flowEditor.leaveTitle')} sub={t('config.flowEditor.leaveSubFlow')} onClose={() => setLeaving(false)}
        footer={<>
          <PrimaryBtn label={t('common.save')} icon="check" onPress={() => { setLeaving(false); void save(); }} busy={busy} disabled={!label.trim()} />
          <GhostBtn label={t('config.flowEditor.discard')} tone="red" onPress={() => { setLeaving(false); ctx.back(); }} />
        </>}>
        {null}
      </Sheet>
    </Screen>
  );
}

// ─── Reference library (ORG-8) ─────────────────────────────────────────────────────

function materialScopeName(state: LanguageState, m: Pick<MaterialView, 'scope'>, language: string): string {
  return m.scope.unitId ? unitTitle(state, m.scope.unitId) : t('config.reference.languageTeam', { language });
}

/** The versification a study or material document names, by name, once loaded. */
function versificationNameOf(docs: ReturnType<typeof useLibraryDocs>, doc: LibraryDoc | null): string | null {
  const hash = doc && 'versification' in doc && typeof doc.versification === 'string' ? doc.versification : null;
  return hash ? docs.get<VersificationDoc>(hash)?.name ?? null : null;
}

export function ReferenceHome(ctx: Ctx) {
  const state = ctx.language.state;
  const beside = useOpenDetail();
  const lib = useLibrary(ctx);
  // From a language's Home it is that language's view; from Organization Home, the organization's: its library and recommendations.
  const languageView = !!ctx.params['languageId'];
  const languageId = ctx.language.languageId || null;
  const language = openLanguageName(ctx);
  const view = useMemo(() => (state ? referenceView(state) : null), [state]);
  const kinds = useMemo(() => (state ? deriveKinds(state) : []), [state]);
  const canManage = ctx.session.can('manage_reference');
  const materials = lib.items('material');
  const shared = useSharedItems('material', lib.orgId);
  const { updates } = useLibraryUpdates(lib.orgId);
  const docs = useLibraryDocs(lib.orgId, [...materials.map((m) => m.current), ...shared.rows.map((s) => s.latest_hash)]);
  const termCount = useMemo(() => (state && languageId ? keyTermsFor(state).length : 0), [state, languageId]);
  // What translators are offered at this level (screens/reference.tsx).
  const offered = useMemo(() => recommendedFor(ctx.org.state?.recommendations, languageView ? state : null), [ctx.org.state, state, languageView]);
  if (!state || !view) return <Screen header={<Header title={t('config.reference.title')} onBack={ctx.back} />}><EmptyState title={t('common.loading')} /></Screen>;

  const own = languageView && language ? language : null;
  const params: Record<string, string> = own && languageId ? { languageId } : {};
  const open = (m: MaterialView) => (canManage ? () => ctx.go('material_editor', { materialId: m.materialId, ...params }) : undefined);
  const generalRow = (m: MaterialView, last: boolean) => (
    <Row key={m.materialId} icon="book" label={m.title} last={last} badge={m.locked ? t('config.reference.locked') : undefined}
      current={beside?.screen === 'material_editor' && beside.params['materialId'] === m.materialId}
      sub={`${referenceKindName(m.kind)} · ${materialScopeName(state, m, own ?? '')}${m.blanks > 0 ? ` · ${t('config.reference.blanks', { count: m.blanks })}` : ''}`} onPress={open(m)} />
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
        sub={`${what?.line ?? t('common.loading')} · ${sourceLine(m)}`} muted={m.archived}
        current={beside?.screen === 'material_editor' && beside.params['itemId'] === m.itemId}
        badge={m.archived ? t('config.library.archivedBadge') : updates[m.itemId] ? t('config.library.updateBadge') : undefined} badgeTone={updates[m.itemId] && !m.archived ? 'amber' : undefined}
        onPress={canManage ? () => ctx.go('material_editor', { itemId: m.itemId, ...params }) : undefined} />
    );
  };

  return (
    <Screen header={<Header title={t('config.reference.title')} sub={own ?? orgName(ctx)} onBack={ctx.back} />}
      footer={canManage ? <PrimaryBtn label={t('config.reference.addMaterial')} icon="plus" onPress={() => ctx.go('material_editor', params)} /> : undefined}>
      <Intro>{own ? t('config.reference.introLanguage', { language: own }) : t('config.reference.introOrg')}</Intro>

      <SectionLabel label={t('config.reference.offered')} />
      <OfferedRows ctx={ctx} languageId={own ? languageId : null} offered={offered} materials={materials} get={docs.get} />

      <SectionLabel label={t('config.reference.keyTermsSection')} />
      <Group>
        <Row icon="book" label={t('config.reference.keyTermsRow')} last
          sub={languageId && language ? `${t('config.reference.concepts', { count: termCount })} · ${t('config.languageRenderings', { language })}` : t('config.reference.addLanguageFirst')}
          onPress={languageId ? () => ctx.go('key_terms', { languageId }) : undefined} />
      </Group>

      <SectionLabel label={withCount(t('config.reference.libraryOrg'), materials.length)}
        action={canManage ? <SmallBtn label={t('config.reference.new')} icon="plus" onPress={() => ctx.go('material_editor', { itemId: 'new', ...params })} /> : undefined} />
      <Capped items={materials} render={libraryRow}
        empty={t('config.reference.libraryEmpty')} />
      {canManage ? <Group><Row icon="sparkle" label={t('config.reference.writeGuide')} sub={t('config.reference.writeGuideSub')} last
        onPress={() => ctx.go('guide_editor', params)} /></Group> : null}
      <SharedItems ctx={ctx} lib={lib} shared={shared} canManage={canManage}
        detail={(s) => {
          const doc = docs.get(s.latest_hash);
          const what = libraryMaterialLine(doc, versificationNameOf(docs, doc), kinds);
          return <Text style={txt.xs}>{what?.line ?? t('common.loading')}</Text>;
        }} />

      {own ? (
        <>
          <SectionLabel label={withCount(t('config.reference.studyMaterial'), view.study.length)} />
          <Capped items={view.study} empty={t('config.reference.noStudy')} render={(m, last) => (
            <Row key={m.materialId} icon="sparkle" label={m.title} last={last} badge={m.locked ? t('config.reference.locked') : undefined}
              sub={`${t('config.libraryLine.studyGuide')} · ${materialScopeName(state, m, own)}${m.blanks > 0 ? ` · ${t('config.reference.blanks', { count: m.blanks })}` : ''}`} onPress={open(m)} />
          )} />

          <SectionLabel label={withCount(t('config.reference.reviewQuestions'), sets.length)} />
          <Capped items={sets} empty={t('config.reference.noSets')} render={(m, last) => (
            <Row key={m.materialId} icon="chat" label={m.title} last={last} badge={m.locked ? t('config.reference.locked') : undefined}
              sub={`${setKindName(kinds, m) ?? t('config.libraryLine.notTiedToKind')} · ${questionCountLabel(questionCount(m))} · ${materialScopeName(state, m, own)}`}
              onPress={open(m)} />
          )} />
          <Intro>{t('config.reference.setsAddUp')}</Intro>

          <SectionLabel label={withCount(`${t('config.reference.general')} · ${own}`, view.general.length)} />
          <Capped items={view.general} empty={t('config.reference.noGeneral')} render={generalRow} />
        </>
      ) : null}
    </Screen>
  );
}

/**
 * Bibles, guides and notes at this level, and coverage against a language's
 * passages, each one tap away (screens/reference.tsx).
 */
function OfferedRows(props: { ctx: Ctx; languageId: string | null; offered: Map<string, string>; materials: LibraryItemView[]; get: (h: string | null | undefined) => LibraryDoc | null }) {
  const { ctx, languageId, offered, materials, get } = props;
  const params: Record<string, string> = languageId ? { languageId } : {};
  const count = (formats: string[], kind?: string) => materials.filter((m) => {
    const doc = get(m.current);
    return offered.has(m.itemId) && !!doc && formats.includes(doc.format) && (!kind || (doc.format === 'material@1' && doc.kind === kind));
  }).length;
  const bibles = count(['source@1']);
  const guides = count(['study@1', 'study@2', 'collection@1']);
  const notes = count(['material@1'], 'note');
  const open = ctx.language.languageId || null;
  return (
    <Group>
      <Row icon="sound" label={t('config.reference.bibles')} sub={t('config.reference.biblesSub', { count: bibles })} onPress={() => ctx.go('reference_bibles', params)} />
      <Row icon="sparkle" label={t('config.reference.guidesNotes')} sub={`${t('config.reference.guidesRecommended', { count: guides })} · ${t('config.reference.notes', { count: notes })}`} onPress={() => ctx.go('reference_guides', params)} last={!open} />
      {open ? <Row icon="map" label={t('config.reference.coverage')} sub={t('config.reference.coverageSub', { language: languageName(ctx.org.state, open) })}
        onPress={() => ctx.go('reference_coverage', { languageId: open })} last /> : null}
    </Group>
  );
}

/** How a question is answered, by name in the language showing. */
function questionTypes(): { id: QuestionSpec['type']; label: string }[] {
  return [
    { id: 'text', label: t('config.questionTypes.text') },
    { id: 'yesno', label: t('config.questionTypes.yesNo') },
    { id: 'rating', label: t('config.questionTypes.rating', { low: formatNumber(1), high: formatNumber(5) }) }
  ];
}

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
  const state = ctx.language.state;
  const lib = useLibrary(ctx);
  const materialId = ctx.params['materialId'];
  const isNew = !materialId;
  const language = openLanguageName(ctx);
  // Material for every language is a library item the organization recommends, which needs manage_reference at org scope.
  const mayRecommend = !!ctx.org.state && privilegesFor(ctx.org.state, ctx.session.actorId).has('manage_reference');
  const existing = useMemo(() => (state && materialId ? materialView(state, materialId) : null), [state, materialId]);
  const kinds = useMemo(() => (state ? deriveKinds(state) : []), [state]);
  const canManage = ctx.session.can('manage_reference');
  // A new material: what it is, where it applies, and which review its questions are for.
  const [kind, setKind] = useState(canManage ? 'tg' : 'questions');
  const [title, setTitle] = useState('');
  const [forLanguage, setForLanguage] = useState(!!ctx.params['languageId'] || !mayRecommend);
  const [reviewKind, setReviewKind] = useState('peer');
  // What it goes to the library in (decision 84): the writer's own language unless they say another.
  const [libraryLanguage, setLibraryLanguage] = useState(readerLanguage);
  // Edits: only touched fields are written (each field is its own register, so two people filling different blanks both land).
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [extraFields, setExtraFields] = useState<string[]>([]);
  const [newField, setNewField] = useState('');
  const [questions, setQuestions] = useState<QuestionDraft[] | null>(isNew ? [{ fieldId: 'q1', text: '', type: 'text', required: false }] : null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(STEP);
  const baseQuestions = useMemo(() => questionDrafts(existing), [existing]);

  if (!state || (!isNew && !existing)) {
    return <Screen header={<Header title={t('config.material.editTitle')} onBack={ctx.back} />}><EmptyState icon="book" title={state ? t('config.material.gone') : t('common.loading')} /></Screen>;
  }

  const materialKind = existing?.kind ?? kind;
  const isQuestions = materialKind === 'questions';
  const locked = !!existing?.locked;
  const canFill = canManage || (ctx.session.can('fill_reference') && !locked && (existing !== null || isQuestions));
  // Question sets stay in the language: reviewers read the language's sets (core `questionsForKind`).
  const toLibrary = isNew && !isQuestions && mayRecommend && (!forLanguage || !language);
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
  const ready = isNew
    ? title.trim() !== '' && (!isQuestions || changes.some((c) => c.text)) && (toLibrary || !!language)
    : changes.length > 0;

  async function save() {
    if (!canFill || busy || !ready) return;
    if (toLibrary) return saveToLibrary();
    const s = state!;
    const id = existing?.materialId ?? `${materialKind}-${Crypto.randomUUID()}`;
    const c = commands(s, indexesFor(s));
    const fields = changes.map((f) => ({ fieldId: f.fieldId, text: f.text }));
    setBusy(true);
    const saved = await actCommand(ctx, 'save material', () => (isNew // i18n-ignore: log label
      ? c.defineMaterial({
        commandId: Crypto.randomUUID(), materialId: id, kind: materialKind, title: title.trim(), fields,
        ...(newTemplateRef ? { templateRef: newTemplateRef } : {}),
        scope: isQuestions ? { stepId: reviewKind } : {}
      })
      : c.setMaterialFields({ commandId: Crypto.randomUUID(), materialId: id, fields })),
    isNew ? t('config.material.added', { title: title.trim() }) : t('config.material.saved'),
    isNew ? undefined : () => c.setMaterialFields({ commandId: Crypto.randomUUID(), materialId: id, fields: changes.map((f) => ({ fieldId: f.fieldId, text: f.before })) }));
    if (saved) ctx.back();
    else setBusy(false);
  }

  /** New material for every language: a library item, recommended to every language (decision 63). */
  async function saveToLibrary() {
    const name = title.trim();
    const doc = { ...materialDocFrom({ kind: materialKind, title: name, scope: {}, fields: changes.map((f) => ({ fieldId: f.fieldId, text: f.text })) }, fieldTitle), language: libraryLanguage };
    setBusy(true);
    const saved = await libraryAct(ctx, 'save material', async () => { // i18n-ignore: log label
      const { itemId } = await lib.publish({ kind: 'material', name, description: referenceKindName(materialKind), doc });
      await ctx.org.append('v1.ReferenceRecommended', { itemId, recommended: true });
    }, t('config.material.inLibraryRecommended', { name }));
    if (saved) ctx.back();
    else setBusy(false);
  }

  function toggleLock() {
    if (!existing || !canManage) return;
    const to = !locked;
    const c = commands(state!, indexesFor(state!));
    void actCommand(ctx, 'lock material', () => c.lockMaterial({ commandId: Crypto.randomUUID(), materialId: existing.materialId, locked: to }), // i18n-ignore: log label
      to ? t('config.material.lockedToast') : t('config.material.unlockedToast'),
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
    await libraryAct(ctx, 'publish material', // i18n-ignore: log label
      () => lib.publish({
        kind: 'material', itemId: materialItemId(existing.materialId), name: existing.title,
        description: published?.description || referenceKindName(existing.kind), doc: { ...materialDocFrom(existing, fieldTitle), language: libraryLanguage }
      }),
      published ? t('config.material.publishedVersion', { title: existing.title }) : t('config.material.inLibraryShare', { title: existing.title }));
    setBusy(false);
  }

  return (
    <Screen
      header={<Header title={existing?.title ?? t('config.material.newMaterial')} sub={existing ? materialScopeName(state, existing, language ?? '') : toLibrary ? orgName(ctx) : language ?? orgName(ctx)} onBack={ctx.back}
        action={existing && canManage ? <SmallBtn label={locked ? t('config.material.locked') : t('config.material.unlocked')} icon="lock" tone={locked ? 'dark' : undefined} onPress={toggleLock} />
          : existing && locked ? <Badge label={t('config.material.locked')} tone="red" /> : undefined} />}
      footer={canFill ? <PrimaryBtn label={isNew ? t('config.reference.addMaterial') : t('config.material.saveChanges')} onPress={() => void save()} disabled={!ready} busy={busy} /> : undefined}>
      {existing ? (
        <Text style={txt.xs}>
          {[referenceKindName(existing.kind), t('config.material.byWhom', { name: ctx.name(existing.createdBy) }), ...(kindOfSet ? [t('config.material.questionsFor', { kind: kindOfSet })] : [])].join(' · ')}
        </Text>
      ) : null}
      {existing && existing.blanks > 0 ? <Banner icon="edit" tone="amber" title={t('config.material.unfilledBlanks', { count: existing.blanks })} /> : null}
      {existing && locked && !canFill ? <Banner icon="lock" title={t('config.material.locked')} body={t('config.material.lockedBody')} /> : null}

      {isNew ? (
        <>
          <SectionLabel label={t('config.material.whatKind')} />
          <Group>
            {referenceKinds().filter((k) => k.id !== 'key_terms' && (canManage || k.id === 'questions')).map((k, i, a) => (
              <Row key={k.id} label={k.name} sub={k.code} onPress={() => setKind(k.id)} last={i === a.length - 1}
                role="radio" selected={kind === k.id}
                right={kind === k.id ? <Ico name="check" size={22} color={C.primary} /> : <View style={{ width: 22 }} />} />
            ))}
          </Group>
          <Field label={t('config.material.titleLabel')} value={title} onChangeText={setTitle} placeholder={isQuestions ? t('config.material.questionsTitlePlaceholder') : t('config.material.titlePlaceholder')} autoCapitalize="sentences" />
          {language && mayRecommend && !isQuestions ? (
            <>
              <SectionLabel label={t('config.material.whereItApplies')} />
              <ChipRow>
                <Chip label={language} icon="globe" on={forLanguage} onPress={() => setForLanguage(true)} />
                <Chip label={t('config.material.allLanguages')} icon="folder" on={!forLanguage} onPress={() => setForLanguage(false)} />
              </ChipRow>
            </>
          ) : null}
          {toLibrary ? (
            <>
              <LanguageField label={t('reference.language.writtenIn')} value={libraryLanguage} onChange={setLibraryLanguage} />
              <Text style={txt.xs}>{t('config.material.toLibraryNote')}</Text>
            </>
          ) : null}
          {!language && !toLibrary ? <Text style={txt.smMuted}>{isQuestions ? t('config.material.setsNeedLanguage') : t('config.material.addLanguageFirst')}</Text> : null}
          {isQuestions ? (
            <>
              <SectionLabel label={t('config.material.forWhichKind')} />
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
          <SectionLabel label={withCount(t('config.material.questions'), qs.filter((q) => q.text.trim()).length)} />
          {qs.map((q, i) => (
            <Card key={q.fieldId}>
              {canFill ? (
                <>
                  <Field value={q.text} onChangeText={(v) => setQuestion(i, { text: v })} placeholder={t('config.material.questionPlaceholder')} multiline />
                  <ChipRow>
                    {questionTypes().map((type) => <Chip key={type.id} label={type.label} on={q.type === type.id} onPress={() => setQuestion(i, { type: type.id })} />)}
                  </ChipRow>
                  <View style={styles.checkpoint}>
                    <View style={{ flex: 1 }}>
                      <Text style={[txt.sm, { fontWeight: '700' }]}>{q.required ? t('common.required') : t('config.material.suggested')}</Text>
                      <Text style={txt.xs}>{q.required ? t('config.material.requiredHelp') : t('config.material.suggestedHelp')}</Text>
                    </View>
                    <Toggle on={q.required} label={t('common.required')} onToggle={() => setQuestion(i, { required: !q.required })} />
                  </View>
                  <SmallBtn label={t('config.material.removeQuestion')} icon="trash" onPress={() => setQuestions(qs.filter((_, j) => j !== i))} />
                </>
              ) : (
                <>
                  <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                    <Text style={txt.label}>{questionTypes().find((type) => type.id === q.type)?.label}</Text>
                    {q.required ? <Badge label={t('common.required')} tone="brand" /> : null}
                  </View>
                  <Text style={txt.body}>{q.text}</Text>
                </>
              )}
            </Card>
          ))}
          {qs.length === 0 && !canFill ? <Card><Text style={txt.smMuted}>{t('config.material.noQuestions')}</Text></Card> : null}
          {canFill ? <GhostBtn label={t('config.material.addQuestion')} icon="plus" onPress={() => setQuestions([...qs, { fieldId: nextFieldId([...qs.map((x) => x.fieldId), ...(existing?.fields.map((f) => f.fieldId) ?? [])]), text: '', type: 'text', required: false }])} /> : null}
        </>
      ) : (
        <>
          <SectionLabel label={withCount(t('config.material.sections'), fieldIds.length)} />
          {fieldIds.slice(0, shown).map((fieldId) => (
            <Card key={fieldId}>
              <Text style={txt.h3}>{fieldTitle(fieldId)}</Text>
              {canFill
                ? <Field value={valueOf(fieldId)} onChangeText={(v) => setTexts({ ...texts, [fieldId]: v })} placeholder={t('config.material.guidanceFor', { section: fieldTitle(fieldId) })} multiline />
                : <Text style={valueOf(fieldId) ? txt.body : txt.bodyMuted}>{valueOf(fieldId) || t('config.material.notFilled')}</Text>}
            </Card>
          ))}
          <ShowMore remaining={fieldIds.length - shown} step={STEP} onMore={() => setShown(shown + STEP)} />
          {canFill ? (
            <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
              <View style={{ flex: 1 }}>
                <Field label={t('config.material.addSection')} value={newField} onChangeText={setNewField} placeholder={t('config.material.addSectionPlaceholder')} autoCapitalize="sentences" />
              </View>
              <SmallBtn label={t('config.material.add')} icon="plus" disabled={!newField.trim()} onPress={() => {
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
          <SectionLabel label={t('config.library.sectionTitle')} />
          <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>
            {published ? t('config.material.inLibrary', { source: sourceLine(published) }) : t('config.material.notInLibrary')}
          </Text>
          <LanguageField label={t('reference.language.writtenIn')} value={libraryLanguage} onChange={setLibraryLanguage} disabled={busy} />
          <GhostBtn label={published ? t('config.material.publishNewVersion') : t('config.material.publishToLibrary')} icon="share" disabled={busy || changes.length > 0} onPress={() => void publishToLibrary()} />
          {changes.length > 0 ? <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>{t('config.material.saveFirst')}</Text> : null}
        </>
      ) : null}
    </Screen>
  );
}

/** Kinds of simple material the library editor makes; question sets and study guides come from elsewhere. */
const LIBRARY_MATERIAL_KINDS = ['note', 'tg', 'tmf', 'brief', 'document'];

/** A verse link as the parser reads it (USFM book codes), the same in every language: not words to translate. */
const REF_EXAMPLE = 'RUT 1:1-16';

/** A versification a verse link can be read in: one this organization has, or one another shares (followed or copied on Save). */
interface VersificationChoice { key: string; label: string; hash: string | null; shared?: SharedItem }

function LibraryMaterialEditor({ ctx }: { ctx: Ctx }) {
  const state = ctx.language.state;
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
  // The language it is written in (decision 84): a new one starts in the writer's own.
  const [language, setLanguage] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const baseLinks = material?.links ?? [];
  const baseRefs = baseLinks.flatMap((l) => ('ref' in l ? [l.ref] : [])).join('\n');
  const baseParts = baseLinks.flatMap((l) => ('node' in l ? [l] : []));
  const k = kind ?? material?.kind ?? ctx.params['kind'] ?? 'tg';
  const titleText = title ?? material?.title ?? '';
  const b = body ?? material?.body ?? '';
  const refs = parseRefLinks(refsText ?? baseRefs);
  const linked = parts ?? baseParts;
  const lang = language ?? material?.language ?? (isNew ? readerLanguage() : null);
  const own = lib.items('versification').filter((v) => v.current && !v.archived);
  const choices: VersificationChoice[] = [
    { key: 'none', label: t('config.libraryMaterial.eachLanguagesOwn'), hash: null },
    ...own.map((v) => ({ key: v.itemId, label: v.name, hash: v.current })),
    ...sharedV.rows.filter((s) => !lib.item(subscriptionItemId(s.org_id, s.item_id))?.subscription?.active)
      .map((s) => ({ key: `${s.org_id}/${s.item_id}`, label: `${s.name} · ${s.org_name}`, hash: s.latest_hash, shared: s }))
  ];
  const baseHash = material?.versification ?? null;
  const baseChoice: VersificationChoice = choices.find((c) => c.hash === baseHash && !c.shared)
    ?? { key: 'doc', label: versificationNameOf(docs, material) ?? t('common.loading'), hash: baseHash };
  const chosen = v11n ?? baseChoice;
  const units = useMemo(() => {
    if (!state || !picking) return [];
    const needle = q.trim().toLowerCase();
    return Object.keys(state.units)
      .filter((u) => unitPrefixOf(u) !== null)
      .map((u) => ({ unitId: u, label: unitTitle(state, u) }))
      .filter((u) => !needle || u.label.toLowerCase().includes(needle))
      .sort((x, y) => x.label.localeCompare(y.label));
  }, [state, picking, q]);
  const dirty = editable && (kind !== null || title !== null || body !== null || refsText !== null || parts !== null || v11n !== null || language !== null);
  const ready = editable && titleText.trim() !== '' && !!lang && refs.bad.length === 0 && (isNew || dirty);

  if (!state || (!isNew && !it)) {
    return <Screen header={<Header title={t('config.libraryMaterial.title')} onBack={ctx.back} />}><EmptyState icon="book" title={state && ctx.org.state ? t('config.material.gone') : t('common.loading')} /></Screen>;
  }
  const partLabel = (l: { template: string; node: string }) => {
    const unitId = `${l.template}/${l.node}`;
    return state.units[unitId] ? unitTitle(state, unitId) : l.node;
  };

  /** Save publishes a new version. A verse link's versification from another organization is followed (or copied) first, so it travels with it. */
  async function save() {
    if (!ready || busy) return;
    setBusy(true);
    const saved = await libraryAct(ctx, 'save material', async () => { // i18n-ignore: log label
      let hash = refs.refs.length ? chosen.hash : null;
      if (hash && chosen.shared) {
        const s = chosen.shared;
        await (s.subscribable ? lib.subscribe(s, true) : lib.copy(s));
        hash = s.latest_hash;
      }
      const { links: _links, versification: _v, body: _b, language: _l, ...rest } = material ?? { format: 'material@1' as const, kind: k, title: titleText, deps: [] };
      const links = [...refs.refs.map((ref) => ({ ref })), ...linked];
      const out: MaterialDoc = {
        ...rest, format: 'material@1', kind: k, title: titleText.trim(), deps: [], ...(lang ? { language: lang } : {}),
        ...(b.trim() ? { body: b.trim() } : {}), ...(links.length ? { links } : {}), ...(hash ? { versification: hash } : {})
      };
      await lib.publish({ kind: 'material', ...(it ? { itemId: it.itemId } : {}), name: out.title, description: it?.description || referenceKindName(k), doc: out });
    }, isNew ? t('config.libraryMaterial.inLibrary', { title: titleText.trim() }) : t('config.libraryMaterial.savedVersion', { title: titleText.trim() }));
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
    void ctx.act(plan.specs, t('config.libraryMaterial.reviewersSee', { kind: kindLabel }), () => plan.undo).catch(() => {
      // ctx.act has already said "Not saved" and why.
    });
  }

  const questions = material ? libraryQuestions(material) : [];
  const what = libraryMaterialLine(doc, versificationNameOf(docs, doc), kinds);
  return (
    <Screen
      header={<Header title={titleText || (isNew ? t('config.libraryMaterial.newTitle') : it?.name ?? t('config.libraryMaterial.title'))} sub={it ? sourceLine(it) : t('config.libraryMaterial.newSub')} onBack={ctx.back} />}
      footer={editable ? <PrimaryBtn label={isNew ? t('common.publish') : t('config.libraryMaterial.publishNewVersion')} onPress={() => void save()} disabled={!ready} busy={busy} /> : undefined}>
      {!isNew && !doc ? <Card><Text style={txt.smMuted}>{t('common.loading')}</Text></Card> : null}
      {it?.source === 'subscription' ? (
        <Banner icon="link" title={t('config.library.follows', { org: it.subscription!.sourceOrgName })} body={t('config.library.followsBody')} />
      ) : null}
      {what ? <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>{what.line}</Text> : null}

      {doc?.format === 'study@1' ? (
        <Card>
          <Text style={txt.h3}>{doc.title}</Text>
          <Text style={txt.xs}>{`${doc.ref} · ${doc.source} · ${t('config.libraryLine.steps', { count: doc.steps.length })}`}</Text>
          {doc.about ? <Text style={txt.sm}>{doc.about}</Text> : null}
        </Card>
      ) : null}
      {doc?.format === 'collection@1' ? (
        <>
          {doc.description ? <Text style={[txt.sm, { paddingHorizontal: space.xs }]}>{doc.description}</Text> : null}
          <SectionLabel label={withCount(t('config.libraryMaterial.passages'), doc.entries.length)} />
          <Capped items={doc.entries} render={(e, last) => <Row key={`${e.ref}-${e.doc}`} icon="sparkle" label={e.title} sub={e.ref} last={last} />} />
        </>
      ) : null}

      {isNew || material ? (
        editable ? (
          <>
            <SectionLabel label={t('config.material.whatKind')} />
            <ChipRow>
              {[...new Set([...LIBRARY_MATERIAL_KINDS, k])].map((id) => <Chip key={id} label={referenceKindName(id)} on={k === id} onPress={() => setKind(id)} />)}
            </ChipRow>
            <Field label={t('config.material.titleLabel')} value={titleText} onChangeText={setTitle} placeholder={t('config.libraryMaterial.titlePlaceholder')} autoCapitalize="sentences" />
            <LanguageField label={t('reference.language.writtenIn')} value={lang} onChange={setLanguage} />
            <Field label={t('config.libraryMaterial.textLabel')} value={b} onChangeText={setBody} placeholder={t('config.libraryMaterial.textPlaceholder')} autoCapitalize="sentences" multiline />
            <SectionLabel label={t('config.material.whereItApplies')} />
            <Field label={t('config.libraryMaterial.versesLabel')} value={refsText ?? baseRefs} onChangeText={setRefsText} placeholder={REF_EXAMPLE} autoCapitalize="none" multiline />
            {refs.bad.length ? <Text style={[txt.sm, { color: TINT.redText }]}>{t('config.libraryMaterial.couldNotRead', { refs: listOf(refs.bad.map((x) => t('config.quoted', { text: x }))), example: REF_EXAMPLE })}</Text> : null}
            {refs.refs.length ? (
              <>
                <Text style={txt.xsStrong}>{t('config.libraryMaterial.numberedAs')}</Text>
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
                  <Row key={`${l.template}/${l.node}`} icon="template" label={partLabel(l)} sub={t('config.libraryMaterial.templatePart')} last={i === linked.length - 1}
                    right={<IconBtn name="close" label={t('config.libraryMaterial.removePart', { name: partLabel(l) })} onPress={() => setParts(linked.filter((_, j) => j !== i))} bg={C.light} color={C.primary} />} />
                ))}
              </Group>
            ) : null}
            <SmallBtn label={t('config.libraryMaterial.linkPart')} icon="link" onPress={() => setPicking(true)} />
          </>
        ) : material ? (
          <>
            {material.body ? <Card><Text style={txt.body}>{material.body}</Text></Card> : null}
            {(material.fields ?? []).filter(() => material.kind !== 'questions').map((f) => (
              <Card key={f.id}><Text style={txt.h3}>{f.label ?? fieldLabel(f.id)}</Text><Text style={txt.body}>{f.text}</Text></Card>
            ))}
            {baseLinks.length ? (
              <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>
                {t('config.libraryMaterial.appliesTo', { places: listOf(baseLinks.map((l) => ('ref' in l ? l.ref : partLabel(l)))) })}
              </Text>
            ) : null}
          </>
        ) : null
      ) : null}

      {material?.kind === 'questions' ? (
        <>
          <SectionLabel label={withCount(t('config.material.questions'), questions.length)} />
          {questions.map((x) => (
            <Card key={x.id}>
              <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                <Text style={txt.label}>{questionTypes().find((qt) => qt.id === x.type)?.label}</Text>
                {x.required ? <Badge label={t('common.required')} tone="brand" /> : null}
              </View>
              <Text style={txt.body}>{x.text}</Text>
            </Card>
          ))}
          {canManage && material.reviewKindId && questions.length ? (
            <GhostBtn label={t('config.libraryMaterial.useInReviews')} icon="chat" onPress={useInReviews} />
          ) : null}
        </>
      ) : null}

      {it ? <LibraryItemSettings ctx={ctx} lib={lib} it={it} canManage={canManage} {...(updates[it.itemId] ? { update: updates[it.itemId] } : {})} onCopied={ctx.back} /> : null}

      <Sheet visible={picking} title={t('config.libraryMaterial.linkPartTitle')} sub={t('config.libraryMaterial.linkPartSub')} onClose={() => setPicking(false)}>
        <SearchField value={q} onChangeText={setQ} placeholder={t('config.libraryMaterial.searchParts')} />
        <Capped items={units} empty={q ? t('common.nothingMatches', { query: q }) : t('config.libraryMaterial.noTemplates')} render={(u, last) => (
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

/**
 * A new term's first adjustment, when nobody wrote why: written into the
 * event log in English (everyone reads the same log), and said in the
 * language showing wherever it is shown here (`adjustmentNote`).
 */
function firstRenderingNote(rendering: string): string {
  return `First rendering: ${rendering}.`; // i18n-ignore: stored in the event log; adjustmentNote shows it translated
}
const FIRST_RENDERING = /^First rendering: ([\s\S]*)\.$/;

/** An adjustment's note as written, or the app's own first-rendering note in the language showing. */
function adjustmentNote(note: string): string {
  const m = FIRST_RENDERING.exec(note);
  return m ? t('config.keyTerm.firstRendering', { rendering: m[1] }) : note;
}

function TermRow(props: { term: KeyTermView; language: string; onPress: () => void; last: boolean }) {
  const { term } = props;
  const has = term.renderings.length > 0;
  const beside = useOpenDetail();
  return (
    <Row icon="book" iconColor={has ? C.primary : TINT.amberText} iconBg={has ? undefined : TINT.amber}
      label={term.term} badge={isFiaTerm(term) ? 'FIA' : undefined}
      sub={has ? term.renderings.map((r) => r.rendering).join(' · ') : t('config.keyTerms.noLanguageRendering', { language: props.language })}
      onPress={props.onPress} last={props.last} current={beside?.screen === 'key_term_detail' && beside.params['termId'] === term.termId} />
  );
}

export function KeyTerms(ctx: Ctx) {
  const state = ctx.language.state;
  const languageId = ctx.language.languageId;
  const unitId = ctx.params['unitId'];
  const takeId = ctx.params['takeId'];
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ term: '', gloss: '', rendering: '', context: '' });
  const [busy, setBusy] = useState(false);
  const terms = useMemo(() => (state ? keyTermsFor(state) : []), [state]);
  const here = useMemo(() => (state && unitId && state.units[unitId] ? termsInPassage(state, terms, unitId, sourceText(state, unitId)) : new Set<string>()), [state, terms, unitId]);
  const canAdd = ctx.session.can('fill_reference') || ctx.session.can('manage_reference');
  if (!state || !languageId) {
    return <Screen header={<Header title={t('config.keyTerms.title')} onBack={ctx.back} />}><EmptyState icon="book" title={state ? t('config.keyTerms.chooseLanguage') : t('common.loading')} /></Screen>;
  }
  const language = languageName(ctx.org.state, languageId);
  const matching = terms.filter((term) => matchesTerm(term, q));
  const inPassage = matching.filter((term) => here.has(term.termId));
  const rest = matching.filter((term) => !here.has(term.termId));
  const open = (term: KeyTermView) => ctx.go('key_term_detail', { termId: term.termId, languageId, ...(unitId ? { unitId } : {}), ...(takeId ? { takeId } : {}) });

  async function add() {
    if (!state || busy || !draft.term.trim() || !draft.rendering.trim()) return;
    const termId = `kt-${Crypto.randomUUID()}`;
    const book = unitId ? state.units[unitId]?.parentUnitId ?? unitId : null;
    const during = unitId && state.units[unitId] ? derivePassage(state, unitId, indexesFor(state)) : null;
    const duringTakeId = during?.draftTakeId ?? during?.latest?.takeId;
    setBusy(true);
    // TERM-6: the concept, its first rendering, and that as its first adjustment (who, when, which passage).
    const saved = await actCommand(ctx, 'add key term', () => commands(state, indexesFor(state)).defineKeyTerm({ // i18n-ignore: log label
      commandId: Crypto.randomUUID(), termId, term: draft.term, gloss: draft.gloss, unitScope: book ? [book] : [],
      rendering: draft.rendering, context: draft.context,
      note: draft.context.trim() || firstRenderingNote(draft.rendering.trim()), ...(duringTakeId ? { duringTakeId } : {})
    }), t('config.keyTerms.added', { term: draft.term.trim() }));
    if (saved) {
      setDraft({ term: '', gloss: '', rendering: '', context: '' });
      setAdding(false);
    }
    setBusy(false);
  }

  return (
    <Screen header={<Header title={t('config.keyTerms.title')} sub={unitId && state.units[unitId] ? `${unitTitle(state, unitId)} · ${language}` : t('config.languageRenderings', { language })} onBack={ctx.back}
      action={canAdd ? <SmallBtn label={t('config.keyTerms.newTerm')} icon="plus" onPress={() => setAdding(true)} /> : undefined} />}>
      <SearchField value={q} onChangeText={setQ} placeholder={t('config.keyTerms.search')} />
      {terms.length === 0 ? (
        <EmptyState icon="book" title={t('config.keyTerms.empty')} sub={canAdd ? t('config.keyTerms.emptySubCanAdd') : t('config.keyTerms.emptySub')} />
      ) : (
        <>
          {inPassage.length > 0 ? (
            <>
              <SectionLabel label={withCount(t('config.keyTerms.inPassage'), inPassage.length)} />
              <Capped items={inPassage} render={(term, last) => <TermRow key={term.termId} term={term} language={language} onPress={() => open(term)} last={last} />} />
            </>
          ) : null}
          <SectionLabel label={withCount(inPassage.length ? t('config.keyTerms.otherTerms') : t('config.keyTerms.allTerms'), rest.length)} />
          <Capped items={rest} empty={q ? t('common.nothingMatches', { query: q }) : t('config.keyTerms.noOther')} render={(term, last) => <TermRow key={term.termId} term={term} language={language} onPress={() => open(term)} last={last} />} />
        </>
      )}
      <Intro>{t('config.keyTerms.intro', { language })}</Intro>

      <Sheet visible={adding} title={t('config.keyTerms.newKeyTerm')} sub={t('config.keyTerms.newSub', { language })} onClose={() => setAdding(false)}
        footer={<PrimaryBtn label={t('config.keyTerms.addTerm')} onPress={() => void add()} disabled={!draft.term.trim() || !draft.rendering.trim()} busy={busy} />}>
        <Field value={draft.term} onChangeText={(v) => setDraft({ ...draft, term: v })} placeholder={t('config.keyTerms.termPlaceholder')} />
        <Field value={draft.gloss} onChangeText={(v) => setDraft({ ...draft, gloss: v })} placeholder={t('config.keyTerms.meaningPlaceholder')} autoCapitalize="sentences" />
        <Field value={draft.rendering} onChangeText={(v) => setDraft({ ...draft, rendering: v })} placeholder={t('config.keyTerms.renderingPlaceholder', { language })} />
        <Field value={draft.context} onChangeText={(v) => setDraft({ ...draft, context: v })} placeholder={t('config.keyTerms.contextPlaceholder')} multiline autoCapitalize="sentences" />
      </Sheet>
    </Screen>
  );
}

export function KeyTermDetail(ctx: Ctx) {
  const state = ctx.language.state;
  const termId = ctx.params['termId'] ?? '';
  const unitId = ctx.params['unitId'];
  const term = useMemo(() => (state ? keyTermView(state, termId) : null), [state, termId]);
  const languageId = ctx.language.languageId;
  const passage = useMemo(() => (state && unitId && state.units[unitId] ? derivePassage(state, unitId, indexesFor(state)) : null), [state, unitId]);
  const usedIn = useMemo(() => {
    if (!state) return [];
    const idx = indexesFor(state);
    return takesLinkingTerm(state, termId).flatMap((l) => {
      const take = state.takes[l.takeId];
      if (!take) return [];
      const v = derivePassage(state, take.unitId, idx).versions.find((x) => x.takeId === l.takeId);
      return v ? [{ ...l, unitId: take.unitId, title: unitTitle(state, take.unitId), n: v.n, by: v.by, hlc: v.hlc }] : [];
    });
  }, [state, termId]);
  const [adjusting, setAdjusting] = useState(false);
  const [rendering, setRendering] = useState('');
  const [context, setContext] = useState('');
  const [note, setNote] = useState('');
  const [hash, setHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [usedShown, setUsedShown] = useState(STEP);
  const why = ctx.details(`term:${termId}:why`);
  const used = ctx.details(`term:${termId}:used`);

  if (!state || !term) {
    return <Screen header={<Header title={t('config.keyTerm.title')} onBack={ctx.back} />}><EmptyState icon="book" title={state ? t('config.keyTerm.gone') : t('common.loading')} /></Screen>;
  }
  const language = languageName(ctx.org.state, languageId);
  const canEdit = ctx.session.can('fill_reference') || ctx.session.can('manage_reference');
  const draftTakeId = passage?.draftTakeId;
  // TERM-4 is offered from the workspace, which passes the draft (or no take); a version's page passes that version.
  const fromDraft = !ctx.params['takeId'] || ctx.params['takeId'] === draftTakeId;
  const canTie = !!draftTakeId && fromDraft && ctx.session.can('translate') && canEdit;
  const isLinked = !!draftTakeId && !!state.keyTermLinks[draftTakeId]?.[termId];
  const passageLabel = passage ? unitTitle(state, passage.unitId) : null;
  const adjustments = [...term.adjustments].reverse();
  const versionOf = (takeId?: string) => {
    const take = takeId ? state.takes[takeId] : undefined;
    if (!take || !takeId) return null;
    const v = derivePassage(state, take.unitId, indexesFor(state)).versions.find((x) => x.takeId === takeId);
    return { unitId: take.unitId, takeId, title: unitTitle(state, take.unitId), n: v?.n ?? null };
  };
  const openVersion = (v: { unitId: string; takeId: string }) => ctx.go('version_detail', { unitId: v.unitId, languageId, takeId: v.takeId });

  async function tie() {
    if (!draftTakeId || isLinked || busy) return;
    setBusy(true);
    await actCommand(ctx, 'tie key term', () => commands(state!, indexesFor(state!)).linkKeyTerms({ commandId: Crypto.randomUUID(), takeId: draftTakeId, termIds: [termId] }), // i18n-ignore: log label
      t('config.keyTerm.tied', { term: term!.term }));
    setBusy(false);
  }

  async function saveAdjustment() {
    if (!canEdit || busy || (!note.trim() && !hash)) return;
    const duringTakeId = draftTakeId ?? passage?.latest?.takeId;
    setBusy(true);
    const saved = await actCommand(ctx, 'adjust key term', () => commands(state!, indexesFor(state!)).adjustKeyTermRendering({ // i18n-ignore: log label
      commandId: Crypto.randomUUID(), termId, rendering, context, note,
      ...(hash ? { blobHash: hash } : {}), ...(duringTakeId ? { duringTakeId } : {}),
      // TERM-5: an adjustment made while drafting ties the term to the draft.
      ...(canTie && !isLinked && draftTakeId ? { tieToTakeId: draftTakeId } : {})
    }), rendering.trim() ? t('config.keyTerm.added', { rendering: rendering.trim() }) : t('config.keyTerm.changeRecorded'));
    if (saved) { setAdjusting(false); setRendering(''); setContext(''); setNote(''); setHash(null); }
    setBusy(false);
  }

  const scopeTitles = term.unitScope.map((u) => unitTitle(state, u));
  return (
    <Screen header={<Header title={term.term} sub={isFiaTerm(term) ? t('config.keyTerm.fiaSub', { language }) : t('config.keyTerm.sub', { language })} onBack={ctx.back} />}>
      <Card style={{ backgroundColor: C.light }}>
        <Text style={txt.body}>{term.gloss || t('config.keyTerm.noMeaning')}</Text>
        <Text style={[txt.xsStrong, { color: C.primary }]}>{scopeTitles.length ? t('config.keyTerm.appearsIn', { places: listOf(scopeTitles) }) : t('config.keyTerm.everyPassage')}</Text>
      </Card>

      {canTie ? (
        <Card onPress={isLinked ? undefined : () => void tie()} accessibilityLabel={isLinked ? t('config.keyTerm.tiedToDraft') : t('config.keyTerm.tieToDraft')}
          style={isLinked ? { backgroundColor: TINT.green } : { borderStyle: 'dashed', borderWidth: 1.5, borderColor: `${C.primary}99` }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={[styles.tieIcon, { backgroundColor: isLinked ? C.green : C.primary }]}>
              <Ico name={isLinked ? 'check' : 'link'} size={20} color={C.white} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[txt.body, { fontWeight: '700', color: isLinked ? TINT.greenText : C.dark }]}>{isLinked ? t('config.keyTerm.tiedToDraft') : t('config.keyTerm.tieToDraft')}</Text>
              <Text style={[txt.sm, { color: isLinked ? TINT.greenText : C.muted }]}>
                {isLinked ? t('config.keyTerm.tiedBody') : t('config.keyTerm.tieBody', { passage: passageLabel ?? '' })}
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      <SectionLabel label={t('config.keyTerm.inLanguage', { language })} />
      {term.renderings.length === 0 ? (
        <Card onPress={canEdit ? () => setAdjusting(true) : undefined} style={{ backgroundColor: TINT.amber, borderStyle: 'dashed', borderWidth: 1.5, borderColor: `${C.amber}99` }}>
          <Text style={[txt.body, { fontWeight: '700', color: TINT.amberText }]}>{t('config.keyTerm.noRendering')}</Text>
          <Text style={[txt.sm, { color: TINT.amberText }]}>{t('config.keyTerm.addHow', { language })}</Text>
        </Card>
      ) : (
        <Group>
          {term.renderings.map((r, i) => (
            <View key={r.renderingId} style={[styles.rendering, i < term.renderings.length - 1 && styles.rowBorder]}>
              <Text style={[txt.h3, { color: C.primary }]}>{r.rendering}</Text>
              {r.context ? <Text style={txt.sm}>{r.context}</Text> : null}
            </View>
          ))}
        </Group>
      )}
      {canEdit ? <GhostBtn label={term.renderings.length ? t('config.keyTerm.adjustOrAdd') : t('config.keyTerm.addRendering')} icon="edit" onPress={() => setAdjusting(true)} /> : null}

      {adjustments.length || usedIn.length ? <SectionLabel label={t('config.keyTerm.details')} /> : null}
      {adjustments.length ? (
        <Disclosure icon="history" title={t('config.keyTerm.why')} open={why.open} onToggle={why.onToggle}
          summary={`${t('config.keyTerm.changes', { count: adjustments.length })} · ${t('config.keyTerm.latestBy', { name: ctx.name(adjustments[0]!.actorId), when: when(adjustments[0]!.hlc) })}`}>
          {adjustments.map((a, i) => {
            const v = versionOf(a.duringTakeId);
            return (
              <View key={a.adjustmentId} style={[styles.adjustment, i < adjustments.length - 1 && styles.rowBorder]}>
                <Text style={txt.xs}>{ctx.name(a.actorId)} · {when(a.hlc)}{v ? ` · ${v.title}` : ''}</Text>
                <Text style={txt.sm}>{adjustmentNote(a.note)}</Text>
                {a.blobHash ? <AudioClip language={ctx.language} hashes={[a.blobHash]} label={t('config.keyTerm.playExplanation')} /> : null}
                {v && v.n !== null ? <SmallBtn label={t('config.keyTerm.openVersion', { n: v.n })} icon="mic" onPress={() => openVersion(v)} /> : null}
              </View>
            );
          })}
        </Disclosure>
      ) : null}
      {usedIn.length ? (
        <Disclosure icon="mic" title={t('config.keyTerm.whereUsed')} open={used.open} onToggle={used.onToggle}
          summary={`${t('config.keyTerm.versions', { count: usedIn.length })} · ${listOf([...new Set(usedIn.map((u) => u.title))].slice(0, 2))}${usedIn.length > 2 ? '…' : ''}`}>
          {usedIn.slice(0, usedShown).map((u, i, a) => (
            <Row key={u.takeId} icon="mic" label={t('config.keyTerm.usedTitle', { title: u.title, n: u.n })} sub={u.note ?? `${ctx.name(u.by)} · ${when(u.hlc)}`}
              badge={u.adjustmentId ? t('config.keyTerm.changedHere') : undefined} onPress={() => openVersion(u)} last={i === a.length - 1} />
          ))}
          <ShowMore remaining={usedIn.length - usedShown} step={STEP} onMore={() => setUsedShown(usedShown + STEP)} />
        </Disclosure>
      ) : null}
      <Sheet visible={adjusting} title={t('config.keyTerm.adjustTitle', { language, term: term.term })} onClose={() => setAdjusting(false)}
        sub={canTie ? t('config.keyTerm.adjustSubTie', { passage: passageLabel ?? '' }) : t('config.keyTerm.adjustSub')}
        footer={<PrimaryBtn label={t('common.save')} onPress={() => void saveAdjustment()} disabled={!note.trim() && !hash} busy={busy} />}>
        <Field value={rendering} onChangeText={setRendering} placeholder={t('config.keyTerm.newRendering')} />
        {rendering.trim() ? <Field value={context} onChangeText={setContext} placeholder={t('config.keyTerm.whenToUse')} multiline autoCapitalize="sentences" /> : null}
        {passage ? <VoiceNote ctx={ctx} label={t('config.keyTerm.sayWhy')} hash={hash} onChange={setHash} /> : null}
        <Field value={note} onChangeText={setNote} placeholder={passage ? t('config.keyTerm.orTypeWhy') : t('config.keyTerm.typeWhy')} multiline autoCapitalize="sentences" />
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
