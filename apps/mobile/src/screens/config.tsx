// Avatar P. Configuration: roles, reference material, key terms, review flows.
// Ports the demo's src/screens/config.tsx (RolesHomeScreen, RoleEditorScreen,
// AppliedCatalogScreen for review flows, FlowStepsInline, FlowEditorScreen,
// KindPickerSheet, ReferenceLibraryScreen, KeyTermsScreen, AddKeyTermSheet,
// KeyTermDetailScreen, AdjustKeyTermSheet) and review.tsx MaterialEditorScreen,
// with ADR-042's key word on a passage (its verses, how other languages say
// it) and note for translators on verses (simple/helps.tsx),
// with the working material editor from main (fields as registers, lock,
// new material) in the new look. Review flows and reference material are
// library items (docs/library.md): the organization's own, copies and
// followed ones, plus what other organizations share; the in-app catalog is
// no longer offered.
// Requirements ORG-3, ORG-4, ORG-8, TERM-1..6, FLOW-1..4.
// ADR-002 (one model for reference), ADR-004 (done is read from the record),
// ADR-005 (kinds arranged by the flow designer), ADR-016 (parallel kinds).
// Pure reading lives in config/model.ts and the feature models (roles/, flows/,
// keyTerms/, reference/materialModel.ts); the screens here lay it out.
import {
  CommandError, commands, CUSTOM_FLOW, deriveFlow, derivePassage, keyTermsFor, keyTermView, languageName,
  materialView, privilegesFor, recommendedFor, subscriptionItemId,
  unitTitle,
  type EventSpec, type FlowDoc, type FlowStep, type KeyTermView, type KindDef, type LanguageState, type LibraryDoc, type LibraryItemView, type MaterialView, type Privilege, type VersificationDoc
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { ConfirmDelete } from '../ui/ConfirmDelete';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { AudioClip } from '../audio/audioClip';
import { deriveKinds, localKind } from '../i18n/coreText';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { indexesFor } from '../sync/indexes';
import { Badge, Banner, Card, Chip, ChipRow, ChipWrap, Disclosure, EmptyState, Field, GhostBtn, Group, Header, HelpInfo, Ico, IconBtn, KindIcon, PrimaryBtn, Row, Screen, SearchField, SectionLabel, Sheet, ShowMore, SmallBtn, Toggle } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { useOpenDetail } from '../ui/useLayout';
import { cachedDoc } from '../library/docStore';
import { sourceLine, usesItem, type SharedItem } from '../library/model';
import { useLibrary, useLibraryDocs, useLibraryUpdates, useSharedItems } from '../library/useLibrary';
import { when } from '../passage/passageView';
import { failureMessage } from '../diagnostics/report';
import { LanguageField } from '../reference/LanguageField';
import { readerLanguage } from '../reference/languages';
import { contractsFor } from '../shell/screenContracts';
import { draftToTie } from '../study/keyTermDraft';
import { draftKey } from '../drafts/draftModel';
import {
  draftBehind, editorDraft, EMPTY_RENDERING, isFlowDraft, isLibraryMaterialDraft, isMaterialDraft, isRenderingDraft, isTermDraft,
  NO_FLOW_EDITS, NO_LIBRARY_MATERIAL_EDITS, NO_MATERIAL_EDITS,
  type FlowDraft, type FlowEdits, type LibraryMaterialDraft, type LibraryMaterialEdits, type MaterialDraft, type MaterialEdits, type RenderingDraft
} from '../drafts/editorDrafts';
import { useDraft } from '../drafts/useDraft';
import { sourceText } from '../passage/scripture';
import { C, radius, space, TINT } from '../ui/theme';
import { SavedMark } from '../ui/SavedMark';
import { useSaver } from '../ui/useSaveStatus';
import { VoiceNote } from '../audio/voiceNote';
import { CheckSteps } from '../checks/checkSteps';
import { BibleChip, OthersSay, OwnWord, PassageNoteEditor, WhereItIs } from '../helps/helps';
import { othersSay, bibleMissing } from '../helps/helpsModel';
import { bookOf } from '../recording/model';
import { useBible } from '../helps/useBible';
import { useOtherLanguageTerms } from '../reference/useOtherLanguageTerms';
import { LanguageChecks } from '../checks/LanguageChecks';
import { HelpRow } from '../helpMode/helpBadge';
import { addPickedKind, copyFlowSpecs, currentFlowLine, flowEditorBase, flowEditorSeed, flowEditorStatus, knownKinds, newKindDef, usuallyFor, withAddedKinds } from '../flows/model';
import {
  adjustDuringTake, adjustmentNote, adjustmentReady, defineTermInput, EMPTY_TERM_DRAFT, groupTerms, termDraftReady, termUsedIn, tieState,
  versionOfTake, type TermDraft
} from '../keyTerms/model';
import {
  addPart, baseVersificationChoice, defineMaterialInput, fieldWrites, libraryMaterialDoc, LIBRARY_MATERIAL_KINDS,
  materialChanges, materialFieldIds, materialReady, materialScopeName, partOfUnit, questionTypes, sortQuestionSets, templatePartChoices,
  versificationChoices, type VersificationChoice
} from '../reference/materialModel';
import { privilegesOn, roleDefinition, roleDirty } from '../roles/model';
import { SwitchRow } from '../admin/admin';
import { flipSwitch, languageLabel, ROLE_SWITCHES, sameChecks, stepTitle, switchState } from '../admin/adminModel';
import {
  fieldLabel, flowDocFrom, flowLabel, flowUse, holdersOf, isFiaTerm,
  levelLabel, libraryMaterialLine, libraryQuestions, materialDocFrom, materialItemId, moveStep, newKindId,
  nextFieldId, parseRefLinks, PRIVILEGE_INFO, questionCount, questionCountLabel, questionDrafts, questionSetToReviews,
  referenceKinds, referenceKindName, referenceView, roleRows, scopeName, setKindName, termsInPassage, viewLevelFrom,
  type DraftStep, type QuestionDraft
} from '../config/model';

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
async function actCommand(ctx: Ctx, where: string, build: () => EventSpec[], message: string): Promise<boolean> {
  let specs: EventSpec[];
  try {
    specs = build();
  } catch (e) {
    ctx.toast(failure(where, e));
    return false;
  }
  try {
    await ctx.act(specs, message);
    return true;
  } catch {
    // ctx.act has already said "Not saved" and why.
    return false;
  }
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

/** How reviewers answer a question of this type, as help mode says it. */
function questionTypeHelp(type: string): string {
  return type === 'yesno' ? t('config.material.typeYesNoHelp') : type === 'rating' ? t('config.material.typeRatingHelp') : t('config.material.typeTextHelp');
}

/** What a role's switch lets its people do, as help mode says it, by the first privilege it covers (adminModel ROLE_SWITCHES). */
function roleSwitchHelp(privileges: readonly Privilege[]): string | undefined {
  switch (privileges[0]) {
    case 'translate': return t('config.roleEditor.recordHelp');
    case 'fill_reference': return t('config.roleEditor.addNotesHelp');
    case 'send_to_reviewers': return t('config.roleEditor.askForChecksHelp');
    case 'review': return t('config.roleEditor.checkRecordingsHelp');
    case 'view_status': return t('config.roleEditor.seeEveryonesWorkHelp');
    case 'invite_members': return t('config.roleEditor.invitePeopleHelp');
    case 'manage_structure': return t('config.roleEditor.setUpLanguagesHelp');
    case 'manage_reference': return t('config.roleEditor.chooseBiblesHelp');
    case 'manage_flows': return t('config.roleEditor.chooseWhoChecksHelp');
    case 'assign_work': return t('config.roleEditor.assignWorkHelp');
    case 'override_checkpoints': return t('config.roleEditor.overrideChecksHelp');
    case 'manage_roles': return t('config.roleEditor.manageRolesHelp');
    default: return undefined;
  }
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
      <Toggle on={props.on} disabled={props.disabled} label={props.label} onToggle={props.onToggle} help={props.desc} />
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
      action={canManage ? <SmallBtn label={t('config.roles.addRole')} icon="plus" tone="primary" help={t('config.roles.addRoleHelp')} onPress={() => ctx.go('role_editor', { roleId: 'new', level })} /> : undefined} />}>
      <Intro>{level === 'org' ? t('config.roles.introOrg') : t('config.roles.introLanguage')}</Intro>
      {!org ? <EmptyState icon="people" title={t('config.roles.loading')} /> : rows.length === 0 ? (
        <EmptyState icon="people" title={t('config.roles.empty')} sub={canManage ? t('config.roles.emptySub') : undefined} />
      ) : (
        <>
          <SectionLabel label={t('config.roles.definedAtOrg')} />
          <Group>
            {rows.map((r, i) => (
              <HelpRow key={r.roleId} of="config.role">
                <Row icon={r.inherited ? 'lock' : r.builtIn ? 'people' : 'star'}
                  iconColor={r.inherited ? TINT.grayText : C.primary} iconBg={r.inherited ? TINT.gray : undefined}
                  label={r.name} muted={r.inherited}
                  sub={r.inherited ? t('config.roles.inheritedSub')
                    : `${t('config.roles.members', { count: r.members })} · ${t('config.roles.privileges', { count: r.privileges.length })}`}
                  badge={r.inherited ? t('common.viewOnly') : undefined}
                  help={r.inherited ? t('config.roles.inheritedRoleHelp') : r.builtIn ? t('config.roles.builtInRoleHelp') : t('config.roles.ownRoleHelp')}
                  onPress={() => ctx.go('role_editor', { roleId: r.roleId, level })} last={i === rows.length - 1}
                  current={beside?.screen === 'role_editor' && beside.params['roleId'] === r.roleId} />
              </HelpRow>
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
  const dirty = roleDirty(isNew, existing, label, privileges);

  if (!isNew && !existing) {
    return (
      <Screen header={<Header title={t('config.roleEditor.title')} onBack={ctx.back} />}>
        <EmptyState icon="people" title={org ? t('config.roleEditor.gone') : t('config.roleEditor.loading')} />
      </Screen>
    );
  }

  async function save() {
    if (readOnly || busy || !label.trim()) return;
    const next = roleDefinition(roleId, label, privileges);
    setBusy(true);
    try {
      await ctx.org.append('v1.RoleDefined', next);
      ctx.toast(isNew ? t('config.roleEditor.created', { name: next.name }) : t('config.roleEditor.saved', { name: next.name }));
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
      footer={readOnly ? undefined : <PrimaryBtn label={t('common.save')} icon="check" help={t('config.roleEditor.saveHelp')} onPress={() => void save()} disabled={!label.trim() || !dirty} busy={busy} />}>
      {inherited ? <Banner icon="lock" title={t('common.viewOnly')} body={t('config.roleEditor.inheritedBody')} /> : null}
      {readOnly && !inherited ? <Banner icon="lock" title={t('common.viewOnly')} body={t('config.roleEditor.noPermission')} /> : null}
      {isNew && !readOnly ? <Field label={t('config.roleEditor.nameLabel')} value={label} onChangeText={setName} placeholder={t('config.roleEditor.namePlaceholder')} autoCapitalize="words" /> : null}
      {ROLE_SWITCHES.map((g) => (
        <View key={g.title} style={{ gap: space.sm }}>
          <SectionLabel label={g.title} />
          <Group>
            {/* help-each: each switch allows different work */}
            {g.rows.map((row, i) => {
              const state = switchState(privileges, row);
              return (
                <SwitchRow key={row.label} label={row.label} on={state !== 'off'} disabled={readOnly || busy} last={i === g.rows.length - 1} help={roleSwitchHelp(row.privileges)}
                  {...(state === 'some' ? { sub: t('config.roleEditor.onlySome', { privileges: listOf(privilegesOn(row.privileges, privileges).map((p) => PRIVILEGE_INFO[p].label)) }) } : {})}
                  onToggle={() => setPicked(flipSwitch(privileges, row))} />
              );
            })}
          </Group>
        </View>
      ))}
      {!isNew ? (
        <>
          <SectionLabel label={t('config.roleEditor.peopleSection')} />
          {canAssign ? <GhostBtn label={label ? t('config.roleEditor.inviteAs', { role: label }) : t('config.roleEditor.inviteAsThisRole')} icon="qr" help={t('config.roleEditor.inviteHelp')} onPress={() => ctx.go('invite_qr', { roleId })} /> : null}
          <Capped items={holders} empty={t('config.roleEditor.nobody')} render={(h, last) => (
            <Row key={`${h.profileId}-${JSON.stringify(h.scope)}`} icon="user"
              label={h.profileId === ctx.session.actorId ? t('common.you') : ctx.name(h.profileId)}
              sub={scopeName(h.scope, org)} help={t('config.roleEditor.personHelp')}
              onPress={canAssign ? () => ctx.go('edit_member', { memberId: h.profileId }) : undefined} last={last} />
          )} />
          {!readOnly ? <Field label={t('config.roleEditor.itsName')} value={label} onChangeText={setName} placeholder={t('config.roleEditor.itsNamePlaceholder')} autoCapitalize="words"
            help={t('config.roleEditor.renameHelp')} /> : null}
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

/** Run a library write, then say what changed; the same control changes it back. True when it was saved. */
async function libraryAct(ctx: Ctx, where: string, action: () => Promise<unknown>, message: string): Promise<boolean> {
  try {
    await action();
  } catch (e) {
    ctx.toast(t('common.notSaved', { reason: libraryFailure(where, e) }));
    return false;
  }
  ctx.toast(message);
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
  detail?: (s: SharedItem) => ReactNode; use?: { label: string; onUse: (s: SharedItem) => void; disabled?: boolean; help?: string };
}) {
  const { ctx, lib, shared } = props;
  const [following, setFollowing] = useState<SharedItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(STEP);
  const rows = shared.rows.filter((s) => !lib.item(subscriptionItemId(s.org_id, s.item_id))?.subscription?.active);

  async function follow(s: SharedItem, autoUpdate: boolean) {
    setFollowing(null);
    setBusy(true);
    await libraryAct(ctx, 'follow', () => lib.subscribe(s, autoUpdate),
      autoUpdate ? t('config.library.followingAuto', { name: s.name }) : t('config.library.followingManual', { name: s.name }));
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
        <HelpRow key={`${s.org_id}/${s.item_id}`} of="library.sharedItem">
          <Card>
            <Text style={txt.h3}>{s.name}</Text>
            <Text style={txt.xsStrong}>{`${s.org_name} · ${t('config.library.versions', { count: s.version_count })}`}</Text>
            {s.description ? <Text style={txt.smMuted}>{s.description}</Text> : null}
            {props.detail?.(s)}
            {props.canManage || props.use ? (
              <View style={styles.actions}>
                {props.use ? <SmallBtn label={props.use.label} tone="primary" disabled={busy || props.use.disabled} help={props.use.help} onPress={() => props.use!.onUse(s)} /> : null}
                {props.canManage && s.subscribable ? <SmallBtn label={t('config.library.follow')} icon="link" disabled={busy} help={t('config.library.followHelp')} onPress={() => setFollowing(s)} /> : null}
                {props.canManage ? <SmallBtn label={t('common.copy')} icon="plus" disabled={busy} help={t('config.library.copyHelp')} onPress={() => void copy(s)} /> : null}
              </View>
            ) : null}
          </Card>
        </HelpRow>
      ))}
      <ShowMore remaining={rows.length - n} step={STEP} onMore={() => setN(n + STEP)} />

      <Sheet visible={following !== null} title={following ? t('config.library.followNamed', { name: following.name }) : t('config.library.follow')} onClose={() => setFollowing(null)}
        sub={following ? t('config.library.followSheetSub', { org: following.org_name }) : undefined}
        footer={<>
          <PrimaryBtn label={t('config.library.updateAutomatically')} help={t('config.library.updateAutomaticallyHelp')} onPress={() => following && void follow(following, true)} busy={busy} />
          <GhostBtn label={t('config.library.takeUpdatesMyself')} help={t('config.library.takeUpdatesMyselfHelp')} onPress={() => following && void follow(following, false)} />
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
  const run = async (where: string, action: () => Promise<unknown>, message: string) => {
    if (busy) return false;
    setBusy(true);
    const ok = await libraryAct(ctx, where, action, message);
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
                sub.autoUpdate ? t('config.library.youChooseUpdates') : t('config.library.updatesAutomatically'))} />
          </Group>
          {props.update && canManage ? (
            <GhostBtn label={t('config.library.takeUpdate')} icon="download" disabled={busy} help={t('config.library.takeUpdateHelp')}
              onPress={() => void run('take update', // i18n-ignore: log label
                () => lib.takeUpdate(it, props.update!), t('config.library.upToDate', { name: it.name }))} />
          ) : null}
          {canManage ? (
            <>
              <GhostBtn label={t('config.library.copyToChange')} icon="plus" disabled={busy} help={t('config.library.copyToChangeHelp')}
                onPress={() => void run('copy', () => lib.copyFollowed(it), t('config.library.copied', { name: it.name })).then((ok) => ok && props.onCopied())} />
              {sub.active ? (
                <GhostBtn label={t('config.library.stopFollowing')} tone="red" disabled={busy} help={t('config.library.stopFollowingHelp')}
                  onPress={() => void run('stop following', // i18n-ignore: log label
                    () => lib.follow(it.itemId, { active: false }), t('config.library.stoppedFollowing'))} />
              ) : (
                <GhostBtn label={t('config.library.followAgain')} disabled={busy} help={t('config.library.followAgainHelp')} onPress={() => void run('follow', () => lib.follow(it.itemId, { active: true }), t('config.library.followingAgain', { org: sub.sourceOrgName }))} />
              )}
            </>
          ) : null}
        </>
      ) : (
        <>
          <Group>
            <ToggleRow label={t('config.library.share')} desc={t('config.library.shareDesc')} on={it.shared} disabled={!canManage || busy} last={!it.shared}
              onToggle={() => void run('share', () => lib.setSharing(it, !it.shared, it.subscribable),
                it.shared ? t('config.library.unshared') : t('config.library.shared'))} />
            {it.shared ? (
              <ToggleRow label={t('config.library.letFollow')} desc={t('config.library.letFollowDesc')} on={it.subscribable}
                disabled={!canManage || busy} last
                onToggle={() => void run('share', () => lib.setSharing(it, true, !it.subscribable),
                  it.subscribable ? t('config.library.noLongerFollowable') : t('config.library.followableNow'))} />
            ) : null}
          </Group>
          {canManage ? (
            <GhostBtn label={it.archived ? t('config.library.unarchive') : t('config.library.archive')} icon="folder" disabled={busy}
              help={it.archived ? t('config.library.unarchiveHelp') : t('config.library.archiveHelp')}
              onPress={() => void run('archive', () => lib.archive(it, !it.archived),
                it.archived ? t('config.library.unarchived', { name: it.name }) : t('config.library.archived', { name: it.name }))} />
          ) : null}
        </>
      )}
    </>
  );
}

// ─── Review flows (FLOW-1..4) ───────────────────────────────────────────────────────

/**
 * A flow at a glance: steps left to right, parallel kinds stacked, checkpoints locked.
 * `explain`: in help mode it says what the arrows, stacks and locks mean; off where it
 * sits inside a part that says so itself (a flow card that opens).
 */
function FlowStepsInline(props: { steps: Pick<FlowStep, 'kindIds' | 'checkpoint'>[]; kinds: KindDef[]; explain?: boolean }) {
  if (props.steps.length === 0) {
    return (
      <View style={[styles.stepTile, { backgroundColor: TINT.gray, alignSelf: 'flex-start' }]}>
        <Text style={[txt.xsStrong, { color: TINT.grayText }]}>{t('config.flows.noReviews')}</Text>
      </View>
    );
  }
  const name = (id: string) => props.kinds.find((k) => k.id === id)?.name ?? id;
  const steps = (
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
  return props.explain ? <HelpInfo label={t('config.flows.stepsLabel')} detail={t('config.flows.stepsHelp')}>{steps}</HelpInfo> : steps;
}

/** A flow document's steps inline, or a light line while it loads. */
function DocSteps(props: { doc: FlowDoc | null; kinds: KindDef[]; explain?: boolean }) {
  if (!props.doc) return <Text style={txt.smMuted}>{t('common.loading')}</Text>;
  // A shipped kind the document carries reads in the language showing.
  return <FlowStepsInline steps={props.doc.steps.map((s) => ({ kindIds: s.kindIds, checkpoint: !!s.checkpoint }))} kinds={[...props.doc.kinds.map(localKind), ...props.kinds]}
    explain={props.explain} />;
}

export function FlowsHome(ctx: Ctx) {
  const state = ctx.language.state;
  const lib = useLibrary(ctx);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(STEP);
  const current = useMemo(() => (state ? flowUse(state) : null), [state]);
  const kinds = useMemo(() => (state ? deriveKinds(state) : []), [state]);
  // Using a flow copies its checks into the language, the language's own (decision 91); making, following or
  // copying a flow writes the organization's library, at organization scope (library/model.ts `mayWriteLibrary`).
  const canManage = ctx.session.can('manage_flows');
  const canWrite = lib.canWrite('flow');
  const flows = lib.items('flow');
  const shared = useSharedItems('flow', lib.orgId);
  const { updates } = useLibraryUpdates(lib.orgId);
  const docs = useLibraryDocs(lib.orgId, [...flows.map((f) => f.current), ...shared.rows.map((s) => s.latest_hash)]);
  const language = openLanguageName(ctx);

  /**
   * Use a flow for the language: its checks are copied into the language
   * and are the language's own from then on (decision 91). When the
   * language's checks are already its own, it asks first (decision 134):
   * they could not be chosen again afterwards.
   */
  const [replacing, setReplacing] = useState<{ target: { itemId: string } | { shared: SharedItem }; name: string } | null>(null);
  function chooseFlow(target: { itemId: string } | { shared: SharedItem }) {
    if (!state || !language || busy) return;
    const name = 'shared' in target ? target.shared.name : lib.item(target.itemId)?.name ?? '';
    const steps = deriveFlow(state).steps;
    // Checks still as a ready-made set made them can be chosen again: only the language's own are asked about.
    const known = [...flows.map((f) => docs.get<FlowDoc>(f.current)), ...shared.rows.map((s) => docs.get<FlowDoc>(s.latest_hash))];
    const own = state.flow?.value?.flowId === CUSTOM_FLOW && steps.length > 0 && !known.some((d) => !!d && sameChecks(steps, d.steps));
    if (own) setReplacing({ target, name });
    else void adopt(target);
  }
  async function adopt(target: { itemId: string } | { shared: SharedItem }) {
    if (!state || !language || busy) return;
    setBusy(true);
    let specs: EventSpec[];
    let name: string;
    try {
      const hash = 'shared' in target ? target.shared.latest_hash : lib.item(target.itemId)?.current;
      const doc = docs.get<FlowDoc>(hash);
      if (!doc) throw new CommandError(t('config.errors.flowHasNoVersion'));
      name = 'shared' in target ? target.shared.name : lib.item(target.itemId)?.name ?? doc.name;
      specs = copyFlowSpecs(state, { commandId: Crypto.randomUUID(), name, doc, kinds });
    } catch (e) {
      ctx.toast(t('common.notSaved', { reason: libraryFailure('use flow', e) })); // i18n-ignore: log label
      setBusy(false);
      return;
    }
    try {
      await ctx.act(specs, t('config.flows.nowUses', { language, flow: name }));
    } catch {
      // ctx.act has already said "Not saved" and why.
    }
    setBusy(false);
  }

  const open = (itemId: string) => (canManage ? () => ctx.go('flow_editor', { itemId }) : undefined);
  const currentItem = current?.itemId ? lib.item(current.itemId) : null;

  return (
    <Screen header={<Header title={t('config.flows.title')} sub={language ?? orgName(ctx)} onBack={ctx.back}
      action={canWrite ? <SmallBtn label={t('config.flows.addFlow')} icon="plus" tone="primary" help={t('config.flows.addFlowHelp')} onPress={() => ctx.go('flow_editor', { itemId: 'new' })} /> : undefined} />}>
      {!state ? <EmptyState icon="flow" title={t('common.loading')} /> : (
        <>
          {!language ? <EmptyState icon="globe" title={t('config.flows.noLanguages')} sub={t('config.flows.noLanguagesSub')} /> : null}
          {language && current ? (
            <Card>
              <Text style={txt.xsStrong}>{t('config.flows.languageUses', { language })}</Text>
              <Text style={txt.h3}>{flowLabel(current)}</Text>
              {currentItem ? (
                <Text style={txt.xs}>
                  {currentFlowLine(currentItem, current)}
                </Text>
              ) : null}
              <FlowStepsInline steps={current.steps} kinds={kinds} explain />
              {canManage && currentItem ? <SmallBtn label={t('config.flows.openFlow')} icon="edit" help={t('config.flows.openFlowHelp')} onPress={() => ctx.go('flow_editor', { itemId: currentItem.itemId })} /> : null}
              {canWrite && !current.itemId && current.chosen && current.steps.length ? (
                <SmallBtn label={t('config.flows.addToFlows')} icon="plus" help={t('config.flows.saveAsFlowHelp')} onPress={() => ctx.go('flow_editor', { itemId: 'new', languageId: ctx.language.languageId })} />
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
              <HelpRow key={f.itemId} of="flows.flow">
                <Card onPress={open(f.itemId)} accessibilityLabel={t('config.flows.openNamed', { name: f.name })}
                  help={updates[f.itemId] && !f.archived ? t('config.library.openUpdateHelp') : t('config.flows.flowCardHelp')}
                  style={on ? { borderColor: C.primary, borderWidth: 1.5 } : undefined}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
                    <View style={{ flex: 1 }}>
                      <Text style={txt.h3}>{f.name}</Text>
                      <Text style={txt.xs}>{[sourceLine(f), flowLanguage(docs.get<FlowDoc>(f.current))].filter(Boolean).join(' · ')}</Text>
                      {f.description ? <Text style={[txt.smMuted, { marginTop: 2 }]}>{f.description}</Text> : null}
                    </View>
                    {f.archived ? <Badge label={t('config.library.archivedBadge')} />
                      : updates[f.itemId] ? <Badge label={t('config.library.updateBadge')} tone="amber" /> : null}
                    {on
                      ? <SmallBtn label={t('config.flows.inUse')} icon="check" tone="primary" help={t('config.flows.inUseHelp')} onPress={() => {}} />
                      : language && !f.archived ? <SmallBtn label={t('config.flows.use')} help={t('config.flows.useHelp', { language })} onPress={() => chooseFlow({ itemId: f.itemId })} disabled={!canManage || busy || !f.current} /> : null}
                  </View>
                  {/* Inside a card that opens, the card says what the steps mean. */}
                  <DocSteps doc={docs.get<FlowDoc>(f.current)} kinds={kinds} explain={!canManage} />
                </Card>
              </HelpRow>
            );
          })}
          <ShowMore remaining={flows.length - shown} step={STEP} onMore={() => setShown(shown + STEP)} />

          <SharedItems ctx={ctx} lib={lib} shared={shared} canManage={canWrite}
            detail={(s) => (
              <>
                {flowLanguage(docs.get<FlowDoc>(s.latest_hash)) ? <Text style={txt.xs}>{flowLanguage(docs.get<FlowDoc>(s.latest_hash))}</Text> : null}
                <DocSteps doc={docs.get<FlowDoc>(s.latest_hash)} kinds={kinds} explain />
              </>
            )}
            {...(language && canManage ? { use: { label: t('config.flows.use'), onUse: (s: SharedItem) => chooseFlow({ shared: s }), disabled: busy,
              help: t('config.flows.useHelp', { language }) } } : {})} />
        </>
      )}
      <ConfirmDelete visible={!!replacing} name={replacing?.name ?? ''} replaces
        title={t('checks.flows.replaceAsk', { language: language ?? '', name: replacing?.name ?? '' })} confirmLabel={t('checks.flows.use', { name: replacing?.name ?? '' })}
        onClose={() => setReplacing(null)} onConfirm={() => { const r = replacing; setReplacing(null); if (r) void adopt(r.target); }} />
    </Screen>
  );
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
              <HelpRow key={id} of="flowEditor.stepCheck">
                <Row leading={<KindIcon kindId={id} size={40} />} label={name(id)} last={j === st.kindIds.length - 1}
                  right={st.kindIds.length > 1 ? <IconBtn name="close" label={t('config.flowEditor.removeCheck', { name: name(id) })} help={t('config.flowEditor.removeCheckHelp')} onPress={() => props.onChange({ ...st, kindIds: st.kindIds.filter((k) => k !== id) })} bg={C.light} color={C.primary} /> : undefined} />
              </HelpRow>
            ))}
          </Group>
          <Group>
            <Row icon="plus" label={t('config.flowEditor.addAlongside')} sub={t('config.flowEditor.addAlongsideSub')} onPress={props.onAdd} />
            {props.i > 0 ? <Row icon="up" label={t('config.flowEditor.moveUp')} help={t('config.flowEditor.moveUpHelp')} onPress={() => props.onMove(-1)} /> : null}
            {props.i < props.count - 1 ? <Row icon="down" label={t('config.flowEditor.moveDown')} help={t('config.flowEditor.moveDownHelp')} onPress={() => props.onMove(1)} /> : null}
            <Row icon="trash" label={t('config.flowEditor.removeStep')} iconColor={TINT.redText} iconBg={TINT.red} help={t('config.flowEditor.removeStepHelp')} onPress={props.onRemove} last />
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
 * back the flow it had); otherwise a library flow, kept on this phone as it
 * changes, whose Done publishes a new version that the languages using it
 * move to.
 */
/** The language a flow's words are in, when it says (decision 84). */
const flowLanguage = (doc: FlowDoc | null | undefined) => (doc?.language ? languageLabel(doc.language) : null);

export function FlowEditor(ctx: Ctx) {
  // A language's own checks, or New language's before it exists (screens/checks.tsx, decision 91).
  if (ctx.params['steps'] === 'language' || ctx.params['draft'] === '1') return <LanguageChecks ctx={ctx} />;
  return <LibraryFlowEditor ctx={ctx} />;
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
  // A new flow may start from the language's own steps (made a library flow), or from another
  // flow's steps under a name given (New language's "I'll choose the steps", `from` and `name`).
  const [seed] = useState(() => flowEditorSeed(state, isNew, { languageId: ctx.params['languageId'], name: ctx.params['name'] }, isNew ? cachedDoc(ctx.params['from']) : null));
  const base = useMemo(() => flowEditorBase(isNew, seed, doc), [isNew, seed, doc]);
  // What is changed is kept on this phone as it changes, there when the editor opens again (decision 127); Done publishes it.
  // A new flow's draft is the one begun from the same start (`languageId`, `from`).
  const draft = useDraft<FlowDraft | null>(
    draftKey('editor', ctx.session.actorId, lib.orgId, 'flow', requested, ...(isNew ? [ctx.params['languageId'], ctx.params['from']] : [])), null, isFlowDraft);
  const { name, description, steps: edited, added, language: editedLanguage } = draft.value?.form ?? NO_FLOW_EDITS;
  const edit = (patch: Partial<FlowEdits>) => draft.set((prev) => editorDraft({ ...(prev?.form ?? NO_FLOW_EDITS), ...patch }, NO_FLOW_EDITS, prev?.basis ?? it?.current ?? null));
  const [open, setOpen] = useState<number | null>(null);
  const [pickFor, setPickFor] = useState<number | 'new' | null>(null);
  const [newKind, setNewKind] = useState('');
  const [busy, setBusy] = useState(false);
  const known = useMemo(() => knownKinds(state ? deriveKinds(state) : [], doc?.kinds ?? [], seed.kinds), [state, doc, seed]);
  const kinds = useMemo(() => withAddedKinds(known, added), [known, added]);
  // A library flow is the organization's: saving publishes a version (organization scope, `mayWriteLibrary`).
  const canManage = lib.canWrite('flow');
  const followed = it?.source === 'subscription';
  const readOnly = !canManage || followed;
  const steps = edited ?? base?.steps ?? [];
  const label = name ?? base?.name ?? '';
  const desc = description ?? base?.description ?? '';
  // What its words are in (decision 84): a new flow starts in the writer's app language.
  const writtenIn = editedLanguage ?? base?.language ?? (isNew ? readerLanguage() : null);
  const { canSave } = flowEditorStatus({ readOnly, isNew, base, label, desc, steps, added, language: writtenIn });
  // Done publishes what changed, or with nothing changed just closes.
  const canFinish = !readOnly && base !== null && draft.loaded && !!label.trim();
  const newer = draftBehind(draft.value, it?.current);
  const language = openLanguageName(ctx);
  const usedHere = !!it && !!language && usesItem(state, it.itemId);

  if (!state || (!isNew && !it)) {
    return (
      <Screen header={<Header title={t('config.flowEditor.reviewFlow')} onBack={ctx.back} />}>
        <EmptyState icon="flow" title={state && ctx.org.state ? t('config.flowEditor.gone') : t('common.loading')} />
      </Screen>
    );
  }

  const change = (next: DraftStep[]) => edit({ steps: next });
  const title = (i: number) => stepTitle(steps[i]?.kindIds ?? [], kinds);
  const picking = typeof pickFor === 'number' ? steps[pickFor] : undefined;
  const pick = (id: string) => {
    if (pickFor !== null) change(addPickedKind(steps, pickFor, id, Crypto.randomUUID()));
    setPickFor(null);
  };

  /** Done publishes a new version; languages using the flow move to it by themselves (follow.ts). */
  async function done() {
    if (!canFinish || busy) return;
    if (!canSave) {
      void draft.clear();
      ctx.back();
      return;
    }
    const flowDoc = flowDocFrom({ name: label, description: desc, language: writtenIn, steps, kinds });
    setBusy(true);
    const saved = await libraryAct(ctx, 'save flow', // i18n-ignore: log label
      () => lib.publish({ kind: 'flow', ...(it ? { itemId: it.itemId } : {}), name: flowDoc.name, description: flowDoc.description, doc: flowDoc }),
      usedHere ? t('config.flowEditor.savedMoves', { name: flowDoc.name, language }) : t('config.flowEditor.saved', { name: flowDoc.name }));
    if (!saved) { setBusy(false); return; }
    await draft.clear();
    ctx.back();
  }

  return (
    <Screen
      header={<Header title={label || (isNew ? t('config.flowEditor.newWayToCheck') : t('config.flowEditor.whoChecks'))} sub={it ? sourceLine(it) : t('config.flowEditor.newSub')}
        onBack={ctx.back} action={readOnly ? undefined : <SavedMark status={draft.status} help={t('saved.draftHelp')} />} />}
      footer={readOnly ? undefined : <PrimaryBtn label={t('common.done')} icon="check" help={t('config.flowEditor.saveHelp')} onPress={() => void done()} disabled={!canFinish} busy={busy} />}>
      {/* Only what was changed here replaces theirs: the rest is the newer version's. */}
      {newer && !readOnly && !busy ? <Banner icon="history" tone="amber" title={t('guides.editor.newer')} /> : null}
      {followed ? (
        <Banner icon="link" title={t('config.library.follows', { org: it!.subscription!.sourceOrgName })} body={t('config.library.followsBody')} />
      ) : !canManage ? <Banner icon="lock" title={t('common.viewOnly')} body={t('config.flowEditor.noPermission')} /> : null}
      {!base || !draft.loaded ? <Card><Text style={txt.smMuted}>{t('common.loading')}</Text></Card> : (
        <>
          {readOnly ? (desc ? <Text style={[txt.sm, { paddingHorizontal: space.xs }]}>{desc}</Text> : null) : (
            <>
              <Field label={t('config.flowEditor.nameLabel')} value={label} onChangeText={(v) => edit({ name: v })} placeholder={t('config.flowEditor.namePlaceholder')} autoCapitalize="words" />
              <Field label={t('config.flowEditor.descriptionLabel')} value={desc} onChangeText={(v) => edit({ description: v })} placeholder={t('config.flowEditor.descriptionPlaceholder')} autoCapitalize="sentences" multiline />
              <LanguageField label={t('reference.language.writtenIn')} value={writtenIn} onChange={(code) => edit({ language: code })} />
            </>
          )}
          <CheckSteps steps={steps} kinds={kinds} readOnly={readOnly} usually={usuallyFor(state, kinds, ctx.name)} onChange={change}
            onAdd={() => setPickFor('new')} onOpen={(i) => { if (!readOnly) setOpen(i); }} />
          {!readOnly && steps.length > 0 ? (
            <SmallBtn label={t('config.flowEditor.noChecks')} help={t('config.flowEditor.noChecksHelp')} onPress={() => change([])} />
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
            <HelpRow key={k.id} of="flowEditor.kind">
              <Row leading={<KindIcon kindId={k.id} size={40} />} label={k.name} sub={k.description || k.usualReviewer || undefined}
                help={pickFor === 'new' ? t('config.flowEditor.pickNewHelp') : t('config.flowEditor.pickAlongsideHelp')}
                onPress={() => pick(k.id)} last={i === a.length - 1} />
            </HelpRow>
          ))}
        </Group>
        <Field label={t('config.flowEditor.newKindLabel')} value={newKind} onChangeText={setNewKind} placeholder={t('config.flowEditor.newKindPlaceholder')} autoCapitalize="words"
          help={t('config.flowEditor.newKindHelp')} />
        <SmallBtn label={t('config.flowEditor.addThisKind')} icon="plus" tone="primary" disabled={!newKind.trim()} help={t('config.flowEditor.addThisKindHelp')} onPress={() => {
          if (!newKind.trim()) return;
          const k = newKindDef(newKind, kinds);
          edit({ added: [...added, k] });
          setNewKind('');
          pick(k.id);
        }} />
      </Sheet>

    </Screen>
  );
}

// ─── Reference library (ORG-8) ─────────────────────────────────────────────────────

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
  // In help mode: it opens; a Locked badge says who may change it.
  const openHelp = (m: MaterialView) => (m.locked ? t('config.reference.openLockedHelp') : t('config.reference.openMaterialHelp'));
  const generalRow = (m: MaterialView, last: boolean) => (
    <Row key={m.materialId} icon="book" label={m.title} last={last} badge={m.locked ? t('config.reference.locked') : undefined}
      current={beside?.screen === 'material_editor' && beside.params['materialId'] === m.materialId}
      sub={`${referenceKindName(m.kind)} · ${materialScopeName(state, m, own ?? '')}${m.blanks > 0 ? ` · ${t('config.reference.blanks', { count: m.blanks })}` : ''}`} onPress={open(m)}
      help={openHelp(m)} />
  );
  const sets = sortQuestionSets(view.questionSets, kinds);
  const libraryRow = (m: LibraryItemView, last: boolean) => {
    const doc = docs.get(m.current);
    const what = libraryMaterialLine(doc, versificationNameOf(docs, doc), kinds);
    return (
      <Row key={m.itemId} icon={what?.type === 'study' ? 'sparkle' : what?.type === 'questions' ? 'chat' : 'book'} label={m.name} last={last}
        sub={`${what?.line ?? t('common.loading')} · ${sourceLine(m)}`} muted={m.archived}
        current={beside?.screen === 'material_editor' && beside.params['itemId'] === m.itemId}
        badge={m.archived ? t('config.library.archivedBadge') : updates[m.itemId] ? t('config.library.updateBadge') : undefined} badgeTone={updates[m.itemId] && !m.archived ? 'amber' : undefined}
        help={updates[m.itemId] && !m.archived ? t('config.library.openUpdateHelp') : t('config.reference.libraryItemHelp')}
        onPress={canManage ? () => ctx.go('material_editor', { itemId: m.itemId, ...params }) : undefined} />
    );
  };

  return (
    <Screen header={<Header title={t('config.reference.title')} sub={own ?? orgName(ctx)} onBack={ctx.back} />}
      footer={canManage ? <PrimaryBtn label={t('config.reference.addMaterial')} icon="plus" help={t('config.reference.addMaterialHelp')} onPress={() => ctx.go('material_editor', params)} /> : undefined}>
      <Intro>{own ? t('config.reference.introLanguage', { language: own }) : t('config.reference.introOrg')}</Intro>

      <SectionLabel label={t('config.reference.offered')} />
      <OfferedRows ctx={ctx} languageId={own ? languageId : null} offered={offered} materials={materials} get={docs.get} />

      <SectionLabel label={t('config.reference.keyTermsSection')} />
      <Group>
        <Row icon="book" label={t('config.reference.keyTermsRow')} last
          sub={languageId && language ? `${t('config.reference.concepts', { count: termCount })} · ${t('config.languageRenderings', { language })}` : t('config.reference.addLanguageFirst')}
          help={t('config.reference.keyTermsHelp')}
          onPress={languageId ? () => ctx.go('key_terms', { languageId }) : undefined} />
      </Group>

      <SectionLabel label={withCount(t('config.reference.libraryOrg'), materials.length)}
        action={canManage && lib.canWrite('material') ? <SmallBtn label={t('config.reference.new')} icon="plus" help={t('config.reference.newHelp')} onPress={() => ctx.go('material_editor', { itemId: 'new', ...params })} /> : undefined} />
      <Capped items={materials} render={libraryRow}
        empty={t('config.reference.libraryEmpty')} />
      {canManage && lib.canWrite('material') ? <Group><Row icon="sparkle" label={t('config.reference.writeGuide')} sub={t('config.reference.writeGuideSub')} last
        onPress={() => ctx.go('guide_editor', params)} /></Group> : null}
      <SharedItems ctx={ctx} lib={lib} shared={shared} canManage={canManage && lib.canWrite('material')}
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
              sub={`${t('config.libraryLine.studyGuide')} · ${materialScopeName(state, m, own)}${m.blanks > 0 ? ` · ${t('config.reference.blanks', { count: m.blanks })}` : ''}`} onPress={open(m)}
              help={openHelp(m)} />
          )} />

          <SectionLabel label={withCount(t('config.reference.reviewQuestions'), sets.length)} />
          <Capped items={sets} empty={t('config.reference.noSets')} render={(m, last) => (
            <Row key={m.materialId} icon="chat" label={m.title} last={last} badge={m.locked ? t('config.reference.locked') : undefined}
              sub={`${setKindName(kinds, m) ?? t('config.libraryLine.notTiedToKind')} · ${questionCountLabel(questionCount(m))} · ${materialScopeName(state, m, own)}`}
              onPress={open(m)} help={openHelp(m)} />
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
      <Row icon="sound" label={t('config.reference.bibles')} sub={t('config.reference.biblesSub', { count: bibles })} help={t('config.reference.biblesHelp')} onPress={() => ctx.go('reference_bibles', params)} />
      <Row icon="sparkle" label={t('config.reference.guidesNotes')} sub={`${t('config.reference.guidesRecommended', { count: guides })} · ${t('config.reference.notes', { count: notes })}`}
        help={t('config.reference.guidesNotesHelp')} onPress={() => ctx.go('reference_guides', params)} last={!open} />
      {open ? <Row icon="map" label={t('config.reference.coverage')} sub={t('config.reference.coverageSub', { language: languageName(ctx.org.state, open) })}
        onPress={() => ctx.go('reference_coverage', { languageId: open })} last /> : null}
    </Group>
  );
}

/**
 * One screen, three kinds of material: the library's (`itemId`), the
 * organization's own in the app (`materialId`, or new), and a note for
 * translators on one passage's verses, written under its text (`unitId`
 * with `note`, from What helps here; demo ADR-042).
 */
export function MaterialEditor(ctx: Ctx) {
  if (ctx.params['note'] && ctx.params['unitId']) return <PassageNoteEditor ctx={ctx} />;
  return ctx.params['itemId'] ? <LibraryMaterialEditor ctx={ctx} /> : <AppMaterialEditor ctx={ctx} />;
}

/** A material's fields with the changes made in the editor, as they will be once written. */
function withFieldChanges(fields: MaterialView['fields'], changes: { fieldId: string; text: string }[]): MaterialView['fields'] {
  const changed = new Map(changes.map((c) => [c.fieldId, c.text]));
  return [
    ...fields.map((f) => (changed.has(f.fieldId) ? { ...f, text: changed.get(f.fieldId)! } : f)),
    ...changes.filter((c) => !fields.some((f) => f.fieldId === c.fieldId)).map((c) => ({ fieldId: c.fieldId, text: c.text }))
  ];
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
  // What is changed is kept on this phone as it changes, there when the editor opens again (decision 127); Done writes it.
  const draft = useDraft<MaterialDraft | null>(
    draftKey('editor', ctx.session.actorId, lib.orgId, 'material', ctx.language.languageId, materialId ?? 'new', ...(isNew ? [ctx.params['languageId'] ? 'language' : 'org'] : [])),
    null, isMaterialDraft);
  const edits = draft.value?.form ?? NO_MATERIAL_EDITS;
  const edit = (patch: Partial<MaterialEdits>) => draft.set((prev) => editorDraft({ ...(prev?.form ?? NO_MATERIAL_EDITS), ...patch }, NO_MATERIAL_EDITS, null));
  // A new material: what it is, where it applies, and which review its questions are for.
  const kind = edits.kind ?? (canManage ? 'tg' : 'questions');
  const title = edits.title;
  const forLanguage = edits.forLanguage ?? (!!ctx.params['languageId'] || !mayRecommend);
  const reviewKind = edits.reviewKind ?? 'peer';
  // What it goes to the library in (decision 84): the writer's own language unless they say another.
  const libraryLanguage = edits.libraryLanguage ?? readerLanguage();
  // Edits: only touched fields are written (each field is its own register, so two people filling different blanks both land).
  const { texts, extraFields, questions } = edits;
  const [newField, setNewField] = useState('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(STEP);
  const baseQuestions = useMemo(() => questionDrafts(existing), [existing]);

  if (!state || !draft.loaded || (!isNew && !existing)) {
    return <Screen header={<Header title={t('config.material.editTitle')} onBack={ctx.back} />}><EmptyState icon="book" title={state && draft.loaded ? t('config.material.gone') : t('common.loading')} /></Screen>;
  }

  const materialKind = existing?.kind ?? kind;
  const isQuestions = materialKind === 'questions';
  const locked = !!existing?.locked;
  const canFill = canManage || (ctx.session.can('fill_reference') && !locked && (existing !== null || isQuestions));
  // Question sets stay in the language: reviewers read the language's sets (core `questionsForKind`).
  const toLibrary = isNew && !isQuestions && mayRecommend && (!forLanguage || !language);
  const qs = questions ?? (isNew ? [{ fieldId: 'q1', text: '', type: 'text' as const, required: false }] : baseQuestions);
  const before = (fieldId: string) => existing?.fields.find((f) => f.fieldId === fieldId)?.text ?? '';
  // A new FIA study follows its template (summary, key ideas, scenes, discussion); other new material starts with one section.
  const fieldIds = materialFieldIds({ existing, isNew, materialKind, extraFields });
  const valueOf = (fieldId: string) => texts[fieldId] ?? before(fieldId);

  // What Done would write.
  const changes = materialChanges({ isQuestions, questions: qs, baseQuestions, fieldIds, texts, before });
  const ready = materialReady({ isNew, title, isQuestions, changes, toLibrary, hasLanguage: !!language });

  /** Done: new material is added; changes to material there are written (with Undo); with none, it just closes. */
  async function done() {
    if (!canFill || busy) return;
    if (!isNew && changes.length === 0) {
      void draft.clear();
      ctx.back();
      return;
    }
    if (!ready) return;
    if (toLibrary) return saveToLibrary();
    const s = state!;
    const id = existing?.materialId ?? `${materialKind}-${Crypto.randomUUID()}`;
    const c = commands(s, indexesFor(s));
    const fields = fieldWrites(changes);
    setBusy(true);
    const saved = await actCommand(ctx, 'save material', () => (isNew // i18n-ignore: log label
      ? c.defineMaterial(defineMaterialInput({ commandId: Crypto.randomUUID(), materialId: id, materialKind, title, changes, isQuestions, reviewKind }))
      : c.setMaterialFields({ commandId: Crypto.randomUUID(), materialId: id, fields })),
    isNew ? t('config.material.added', { title: title.trim() }) : t('config.material.saved'));
    if (!saved) { setBusy(false); return; }
    await draft.clear();
    ctx.back();
  }

  /** New material for every language: a library item, recommended to every language (decision 63). */
  async function saveToLibrary() {
    const name = title.trim();
    const doc = { ...materialDocFrom({ kind: materialKind, title: name, scope: {}, fields: fieldWrites(changes) }, fieldTitle), language: libraryLanguage };
    setBusy(true);
    const saved = await libraryAct(ctx, 'save material', async () => { // i18n-ignore: log label
      const { itemId } = await lib.publish({ kind: 'material', name, description: referenceKindName(materialKind), doc });
      await ctx.org.append('v1.ReferenceRecommended', { itemId, recommended: true });
    }, t('config.material.inLibraryRecommended', { name }));
    if (!saved) { setBusy(false); return; }
    await draft.clear();
    ctx.back();
  }

  function toggleLock() {
    if (!existing || !canManage) return;
    const to = !locked;
    const c = commands(state!, indexesFor(state!));
    void actCommand(ctx, 'lock material', () => c.lockMaterial({ commandId: Crypto.randomUUID(), materialId: existing.materialId, locked: to }), // i18n-ignore: log label
      to ? t('config.material.lockedToast') : t('config.material.unlockedToast'));
  }

  const setQuestions = (next: QuestionDraft[]) => edit({ questions: next });
  const setQuestion = (i: number, p: Partial<QuestionDraft>) => setQuestions(qs.map((q, j) => (j === i ? { ...q, ...p } : q)));
  const kindOfSet = existing ? setKindName(kinds, existing) : null;
  const fieldTitle = (fieldId: string) => (state.units[fieldId] ? unitTitle(state, fieldId) : fieldLabel(fieldId));
  const published = existing ? lib.item(materialItemId(existing.materialId)) : null;

  /**
   * Publish to library: the material as it is on the screen becomes a new
   * version of the item made from it (the same item every time). Changes
   * not yet in the material are written to it first, as Done writes them.
   */
  async function publishToLibrary() {
    if (!existing || !canManage || busy) return;
    setBusy(true);
    if (changes.length) {
      const c = commands(state!, indexesFor(state!));
      const written = await actCommand(ctx, 'save material', // i18n-ignore: log label
        () => c.setMaterialFields({ commandId: Crypto.randomUUID(), materialId: existing.materialId, fields: fieldWrites(changes) }), t('config.material.saved'));
      if (!written) { setBusy(false); return; }
      draft.set(null);
      await draft.clear();
    }
    const fields = withFieldChanges(existing.fields, changes);
    await libraryAct(ctx, 'publish material', // i18n-ignore: log label
      () => lib.publish({
        kind: 'material', itemId: materialItemId(existing.materialId), name: existing.title,
        description: published?.description || referenceKindName(existing.kind), doc: { ...materialDocFrom({ ...existing, fields }, fieldTitle), language: libraryLanguage }
      }),
      published ? t('config.material.publishedVersion', { title: existing.title }) : t('config.material.inLibraryShare', { title: existing.title }));
    setBusy(false);
  }

  return (
    <Screen
      header={<Header title={existing?.title ?? t('config.material.newMaterial')} sub={existing ? materialScopeName(state, existing, language ?? '') : toLibrary ? orgName(ctx) : language ?? orgName(ctx)} onBack={ctx.back}
        action={<>
          {canFill ? <SavedMark status={draft.status} help={t('saved.draftHelp')} /> : null}
          {existing && canManage ? <SmallBtn label={locked ? t('config.material.locked') : t('config.material.unlocked')} icon="lock" tone={locked ? 'dark' : undefined}
            help={locked ? t('config.material.lockedHelp') : t('config.material.unlockedHelp')} onPress={toggleLock} />
            : existing && locked ? <Badge label={t('config.material.locked')} tone="red" /> : null}
        </>} />}
      footer={canFill ? <PrimaryBtn label={isNew ? t('config.reference.addMaterial') : t('common.done')}
        help={isNew ? t('config.material.saveNewHelp') : t('config.material.doneHelp')} onPress={() => void done()} disabled={isNew && !ready} busy={busy} /> : undefined}>
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
              <HelpRow key={k.id} of="material.kind">
                <Row label={k.name} sub={k.code} help={t('config.material.kindHelp')} onPress={() => edit({ kind: k.id })} last={i === a.length - 1}
                  role="radio" selected={kind === k.id}
                  right={kind === k.id ? <Ico name="check" size={22} color={C.primary} /> : <View style={{ width: 22 }} />} />
              </HelpRow>
            ))}
          </Group>
          <Field label={t('config.material.titleLabel')} value={title} onChangeText={(v) => edit({ title: v })} placeholder={isQuestions ? t('config.material.questionsTitlePlaceholder') : t('config.material.titlePlaceholder')} autoCapitalize="sentences" />
          {language && mayRecommend && !isQuestions ? (
            <>
              <SectionLabel label={t('config.material.whereItApplies')} />
              <ChipRow>
                <Chip label={language} icon="globe" on={forLanguage} help={t('config.material.forLanguageHelp')} onPress={() => edit({ forLanguage: true })} />
                <Chip label={t('config.material.allLanguages')} icon="folder" on={!forLanguage} help={t('config.material.allLanguagesHelp')} onPress={() => edit({ forLanguage: false })} />
              </ChipRow>
            </>
          ) : null}
          {toLibrary ? (
            <>
              <LanguageField label={t('reference.language.writtenIn')} value={libraryLanguage} onChange={(code) => edit({ libraryLanguage: code })} />
              <Text style={txt.xs}>{t('config.material.toLibraryNote')}</Text>
            </>
          ) : null}
          {!language && !toLibrary ? <Text style={txt.smMuted}>{isQuestions ? t('config.material.setsNeedLanguage') : t('config.material.addLanguageFirst')}</Text> : null}
          {isQuestions ? (
            <>
              <SectionLabel label={t('config.material.forWhichKind')} />
              <Group>
                {kinds.map((k, i) => (
                  <HelpRow key={k.id} of="material.reviewKind">
                    <Row leading={<KindIcon kindId={k.id} size={40} />} label={k.name} help={t('config.material.reviewKindHelp')} onPress={() => edit({ reviewKind: k.id })} last={i === kinds.length - 1}
                      role="radio" selected={reviewKind === k.id}
                      right={reviewKind === k.id ? <Ico name="check" size={22} color={C.primary} /> : <View style={{ width: 22 }} />} />
                  </HelpRow>
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
            <HelpRow key={q.fieldId} of="material.question">
              <Card>
                {canFill ? (
                  <>
                    <Field value={q.text} onChangeText={(v) => setQuestion(i, { text: v })} placeholder={t('config.material.questionPlaceholder')} multiline
                      help={t('config.material.questionHelp')} />
                    <ChipWrap>
                      {/* help-each: each type asks in a different way */}
                      {questionTypes().map((type) => <Chip key={type.id} label={type.label} on={q.type === type.id} help={questionTypeHelp(type.id)} onPress={() => setQuestion(i, { type: type.id })} />)}
                    </ChipWrap>
                    <View style={styles.checkpoint}>
                      <View style={{ flex: 1 }}>
                        <Text style={[txt.sm, { fontWeight: '700' }]}>{q.required ? t('common.required') : t('config.material.suggested')}</Text>
                        <Text style={txt.xs}>{q.required ? t('config.material.requiredHelp') : t('config.material.suggestedHelp')}</Text>
                      </View>
                      <Toggle testID="toggle-required" on={q.required} label={t('common.required')} help={t('config.material.requiredSwitchHelp')} onToggle={() => setQuestion(i, { required: !q.required })} />
                    </View>
                    <SmallBtn label={t('config.material.removeQuestion')} icon="trash" help={t('config.material.removeQuestionHelp')} onPress={() => setQuestions(qs.filter((_, j) => j !== i))} />
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
            </HelpRow>
          ))}
          {qs.length === 0 && !canFill ? <Card><Text style={txt.smMuted}>{t('config.material.noQuestions')}</Text></Card> : null}
          {canFill ? <GhostBtn label={t('config.material.addQuestion')} icon="plus" help={t('config.material.addQuestionHelp')} onPress={() => setQuestions([...qs, { fieldId: nextFieldId([...qs.map((x) => x.fieldId), ...(existing?.fields.map((f) => f.fieldId) ?? [])]), text: '', type: 'text', required: false }])} /> : null}
        </>
      ) : (
        <>
          <SectionLabel label={withCount(t('config.material.sections'), fieldIds.length)} />
          {fieldIds.slice(0, shown).map((fieldId) => (
            <HelpRow key={fieldId} of="material.section">
              <Card>
                <Text style={txt.h3}>{fieldTitle(fieldId)}</Text>
                {canFill
                  ? <Field value={valueOf(fieldId)} onChangeText={(v) => edit({ texts: { ...texts, [fieldId]: v } })} placeholder={t('config.material.guidanceFor', { section: fieldTitle(fieldId) })} multiline
                    help={t('config.material.sectionHelp')} />
                  : <Text style={valueOf(fieldId) ? txt.body : txt.bodyMuted}>{valueOf(fieldId) || t('config.material.notFilled')}</Text>}
              </Card>
            </HelpRow>
          ))}
          <ShowMore remaining={fieldIds.length - shown} step={STEP} onMore={() => setShown(shown + STEP)} />
          {canFill ? (
            <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
              <View style={{ flex: 1 }}>
                <Field label={t('config.material.addSection')} value={newField} onChangeText={setNewField} placeholder={t('config.material.addSectionPlaceholder')} autoCapitalize="sentences"
                  help={t('config.material.sectionNameHelp')} />
              </View>
              <SmallBtn label={t('config.material.add')} icon="plus" disabled={!newField.trim()} help={t('config.material.addSectionHelp')} onPress={() => {
                const id = newKindId(newField, fieldIds);
                edit({ extraFields: [...extraFields, id] });
                setNewField('');
              }} />
            </View>
          ) : null}
        </>
      )}

      {existing && canManage && lib.canWrite('material') ? (
        <>
          <SectionLabel label={t('config.library.sectionTitle')} />
          <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>
            {published ? t('config.material.inLibrary', { source: sourceLine(published) }) : t('config.material.notInLibrary')}
          </Text>
          <LanguageField label={t('reference.language.writtenIn')} value={libraryLanguage} onChange={(code) => edit({ libraryLanguage: code })} disabled={busy} />
          <GhostBtn label={published ? t('config.material.publishNewVersion') : t('config.material.publishToLibrary')} icon="share" disabled={busy}
            help={published ? t('config.material.publishVersionHelp') : t('config.material.publishHelp')} onPress={() => void publishToLibrary()} />
        </>
      ) : null}
    </Screen>
  );
}

/** A verse link as the parser reads it (USFM book codes), the same in every language: not words to translate. */
const REF_EXAMPLE = 'RUT 1:1-16';

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
  // Library material is the organization's: publishing, sharing and following need organization scope (`mayWriteLibrary`).
  const canManage = lib.canWrite('material');
  const editable = canManage && it?.source !== 'subscription' && (isNew || material !== null);
  const sharedV = useSharedItems('versification', lib.orgId, editable);
  // What is changed is kept on this phone as it changes, there when the editor opens again (decision 127); Done publishes it.
  const draft = useDraft<LibraryMaterialDraft | null>(draftKey('editor', ctx.session.actorId, lib.orgId, 'library-material', requested), null, isLibraryMaterialDraft);
  // Null is "as the library has it". The language it is written in (decision 84): a new one starts in the writer's own.
  const { kind, title, body, refsText, parts, v11n, language } = draft.value?.form ?? NO_LIBRARY_MATERIAL_EDITS;
  const edit = (patch: Partial<LibraryMaterialEdits>) =>
    draft.set((prev) => editorDraft({ ...(prev?.form ?? NO_LIBRARY_MATERIAL_EDITS), ...patch }, NO_LIBRARY_MATERIAL_EDITS, prev?.basis ?? it?.current ?? null));
  const setKind = (v: string) => edit({ kind: v });
  const setTitle = (v: string) => edit({ title: v });
  const setBody = (v: string) => edit({ body: v });
  const setRefsText = (v: string) => edit({ refsText: v });
  const setParts = (v: { template: string; node: string }[]) => edit({ parts: v });
  const setV11n = (v: VersificationChoice) => edit({ v11n: v });
  const setLanguage = (v: string) => edit({ language: v });
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
  const choices = versificationChoices(own, sharedV.rows, (id) => !!lib.item(id)?.subscription?.active);
  const baseChoice = baseVersificationChoice(choices, material?.versification ?? null, versificationNameOf(docs, material));
  const chosen = v11n ?? baseChoice;
  const units = useMemo(() => (state && picking ? templatePartChoices(state, q) : []), [state, picking, q]);
  const dirty = editable && (kind !== null || title !== null || body !== null || refsText !== null || parts !== null || v11n !== null || language !== null);
  // Done publishes what changed (a new one as its first version), or with nothing changed just closes.
  const ready = editable && draft.loaded && titleText.trim() !== '' && !!lang && refs.bad.length === 0;
  const newer = draftBehind(draft.value, it?.current);

  if (!state || (!isNew && !it)) {
    return <Screen header={<Header title={t('config.libraryMaterial.title')} onBack={ctx.back} />}><EmptyState icon="book" title={state && ctx.org.state ? t('config.material.gone') : t('common.loading')} /></Screen>;
  }
  const partLabel = (l: { template: string; node: string }) => {
    const unitId = `${l.template}/${l.node}`;
    return state.units[unitId] ? unitTitle(state, unitId) : l.node;
  };

  /** Done publishes a new version. A verse link's versification from another organization is followed (or copied) first, so it travels with it. */
  async function done() {
    if (!ready || busy) return;
    if (!isNew && !dirty) {
      void draft.clear();
      ctx.back();
      return;
    }
    setBusy(true);
    const saved = await libraryAct(ctx, 'save material', async () => { // i18n-ignore: log label
      let hash = refs.refs.length ? chosen.hash : null;
      if (hash && chosen.shared) {
        const s = chosen.shared;
        await (s.subscribable ? lib.subscribe(s, true) : lib.copy(s));
        hash = s.latest_hash;
      }
      const out = libraryMaterialDoc({ material, kind: k, title: titleText, language: lang, body: b, refs: refs.refs, linked, versification: hash });
      await lib.publish({ kind: 'material', ...(it ? { itemId: it.itemId } : {}), name: out.title, description: it?.description || referenceKindName(k), doc: out });
    }, isNew ? t('config.libraryMaterial.inLibrary', { title: titleText.trim() }) : t('config.libraryMaterial.savedVersion', { title: titleText.trim() }));
    if (!saved) { setBusy(false); return; }
    await draft.clear();
    ctx.back();
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
    void ctx.act(plan.specs, t('config.libraryMaterial.reviewersSee', { kind: kindLabel })).catch(() => {
      // ctx.act has already said "Not saved" and why.
    });
  }

  const questions = material ? libraryQuestions(material) : [];
  const what = libraryMaterialLine(doc, versificationNameOf(docs, doc), kinds);
  return (
    <Screen
      header={<Header title={titleText || (isNew ? t('config.libraryMaterial.newTitle') : it?.name ?? t('config.libraryMaterial.title'))} sub={it ? sourceLine(it) : t('config.libraryMaterial.newSub')} onBack={ctx.back}
        action={editable ? <SavedMark status={draft.status} help={t('saved.draftHelp')} /> : undefined} />}
      footer={editable ? <PrimaryBtn label={t('common.done')}
        help={isNew ? t('config.libraryMaterial.publishHelp') : t('config.libraryMaterial.publishVersionHelp')} onPress={() => void done()} disabled={!ready} busy={busy} /> : undefined}>
      {(!isNew && !doc) || !draft.loaded ? <Card><Text style={txt.smMuted}>{t('common.loading')}</Text></Card> : null}
      {/* Only what was changed here replaces theirs: the rest is the newer version's. */}
      {newer && editable && !busy ? <Banner icon="history" tone="amber" title={t('guides.editor.newer')} /> : null}
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
        editable ? (!draft.loaded ? null : (
          <>
            <SectionLabel label={t('config.material.whatKind')} />
            <ChipRow>
              {[...new Set([...LIBRARY_MATERIAL_KINDS, k])].map((id) => (
                <HelpRow key={id} of="libraryMaterial.kind">
                  <Chip label={referenceKindName(id)} on={k === id} help={t('config.libraryMaterial.kindHelp')} onPress={() => setKind(id)} />
                </HelpRow>
              ))}
            </ChipRow>
            <Field label={t('config.material.titleLabel')} value={titleText} onChangeText={setTitle} placeholder={t('config.libraryMaterial.titlePlaceholder')} autoCapitalize="sentences" />
            <LanguageField label={t('reference.language.writtenIn')} value={lang} onChange={setLanguage} />
            <Field label={t('config.libraryMaterial.textLabel')} value={b} onChangeText={setBody} placeholder={t('config.libraryMaterial.textPlaceholder')} autoCapitalize="sentences" multiline
              help={t('config.libraryMaterial.textHelp')} />
            <SectionLabel label={t('config.material.whereItApplies')} />
            <Field label={t('config.libraryMaterial.versesLabel')} value={refsText ?? baseRefs} onChangeText={setRefsText} placeholder={REF_EXAMPLE} autoCapitalize="none" multiline
              help={t('config.libraryMaterial.versesHelp', { example: REF_EXAMPLE })} />
            {refs.bad.length ? <Text style={[txt.sm, { color: TINT.redText }]}>{t('config.libraryMaterial.couldNotRead', { refs: listOf(refs.bad.map((x) => t('config.quoted', { text: x }))), example: REF_EXAMPLE })}</Text> : null}
            {refs.refs.length ? (
              <>
                <Text style={txt.xsStrong}>{t('config.libraryMaterial.numberedAs')}</Text>
                <ChipRow>
                  {[...choices, ...(choices.some((c) => c.key === chosen.key) ? [] : [chosen])].map((c) => (
                    <HelpRow key={c.key} of="libraryMaterial.numbering">
                      <Chip label={c.label} on={c.key === chosen.key} help={t('config.libraryMaterial.numberingHelp')} onPress={() => setV11n(c)} />
                    </HelpRow>
                  ))}
                </ChipRow>
              </>
            ) : null}
            {linked.length ? (
              <Group>
                {linked.map((l, i) => (
                  <HelpRow key={`${l.template}/${l.node}`} of="libraryMaterial.linkedPart">
                    <Row icon="template" label={partLabel(l)} sub={t('config.libraryMaterial.templatePart')} last={i === linked.length - 1}
                      right={<IconBtn name="close" label={t('config.libraryMaterial.removePart', { name: partLabel(l) })} help={t('config.libraryMaterial.removePartHelp')}
                        onPress={() => setParts(linked.filter((_, j) => j !== i))} bg={C.light} color={C.primary} />} />
                  </HelpRow>
                ))}
              </Group>
            ) : null}
            <SmallBtn label={t('config.libraryMaterial.linkPart')} icon="link" help={t('config.libraryMaterial.linkPartHelp')} onPress={() => setPicking(true)} />
          </>
        )) : material ? (
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
            <GhostBtn label={t('config.libraryMaterial.useInReviews')} icon="chat" onPress={useInReviews}
              help={t('config.libraryMaterial.useInReviewsHelp', { kind: kinds.find((x) => x.id === material.reviewKindId)?.name ?? material.reviewKindId })} />
          ) : null}
        </>
      ) : null}

      {it ? <LibraryItemSettings ctx={ctx} lib={lib} it={it} canManage={canManage} {...(updates[it.itemId] ? { update: updates[it.itemId] } : {})} onCopied={ctx.back} /> : null}

      <Sheet visible={picking} title={t('config.libraryMaterial.linkPartTitle')} sub={t('config.libraryMaterial.linkPartSub')} onClose={() => setPicking(false)}>
        <SearchField value={q} onChangeText={setQ} placeholder={t('config.libraryMaterial.searchParts')} />
        <Capped items={units} empty={q ? t('common.nothingMatches', { query: q }) : t('config.libraryMaterial.noTemplates')} render={(u, last) => (
          <Row key={u.unitId} icon="template" label={u.label} last={last} help={t('config.libraryMaterial.pickPartHelp')} onPress={() => {
            const next = addPart(linked, partOfUnit(u.unitId));
            if (next !== linked) setParts(next);
            setPicking(false);
          }} />
        )} />
      </Sheet>
    </Screen>
  );
}

// ─── Key terms (TERM-1..6) ─────────────────────────────────────────────────────────

function TermRow(props: { term: KeyTermView; language: string; onPress: () => void; last: boolean }) {
  const { term } = props;
  const has = term.renderings.length > 0;
  const beside = useOpenDetail();
  return (
    <Row icon="book" iconColor={has ? C.primary : TINT.amberText} iconBg={has ? undefined : TINT.amber}
      label={term.term} badge={isFiaTerm(term) ? 'FIA' : undefined}
      sub={has ? term.renderings.map((r) => r.rendering).join(' · ') : t('config.keyTerms.noLanguageRendering', { language: props.language })}
      help={isFiaTerm(term) ? t('config.keyTerms.openFiaTermHelp') : t('config.keyTerms.openTermHelp')}
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
  // A new term is kept on this phone as it is typed, there when the sheet opens again (decision 127); Add Term adds it.
  const termDraft = useDraft<TermDraft>(languageId ? draftKey('word', ctx.session.actorId, languageId, 'new-term', unitId) : null, EMPTY_TERM_DRAFT, isTermDraft);
  const draft = termDraft.value;
  const setDraft = termDraft.set;
  const [busy, setBusy] = useState(false);
  const terms = useMemo(() => (state ? keyTermsFor(state) : []), [state]);
  const here = useMemo(() => (state && unitId && state.units[unitId] ? termsInPassage(state, terms, unitId, sourceText(state, unitId)) : new Set<string>()), [state, terms, unitId]);
  const canAdd = ctx.session.can('fill_reference') || ctx.session.can('manage_reference');
  if (!state || !languageId) {
    return <Screen header={<Header title={t('config.keyTerms.title')} onBack={ctx.back} />}><EmptyState icon="book" title={state ? t('config.keyTerms.chooseLanguage') : t('common.loading')} /></Screen>;
  }
  const language = languageName(ctx.org.state, languageId);
  const { inPassage, rest } = groupTerms(terms, here, q);
  const open = (term: KeyTermView) => ctx.go('key_term_detail', { termId: term.termId, languageId, ...(unitId ? { unitId } : {}), ...(takeId ? { takeId } : {}) });

  async function add() {
    if (!state || busy || !termDraftReady(draft)) return;
    const termId = `kt-${Crypto.randomUUID()}`;
    setBusy(true);
    // TERM-6: the concept, its first rendering, and that as its first adjustment (who, when, which passage).
    const saved = await actCommand(ctx, 'add key term', () => commands(state, indexesFor(state)).defineKeyTerm( // i18n-ignore: log label
      defineTermInput(state, draft, unitId, { commandId: Crypto.randomUUID(), termId })
    ), t('config.keyTerms.added', { term: draft.term.trim() }));
    if (saved) {
      setDraft(EMPTY_TERM_DRAFT);
      await termDraft.clear();
      setAdding(false);
    }
    setBusy(false);
  }

  return (
    <Screen header={<Header title={t('config.keyTerms.title')} sub={unitId && state.units[unitId] ? `${unitTitle(state, unitId)} · ${language}` : t('config.languageRenderings', { language })} onBack={ctx.back}
      action={canAdd ? <SmallBtn label={t('config.keyTerms.newTerm')} icon="plus" help={t('config.keyTerms.newTermHelp', { language })} onPress={() => setAdding(true)} /> : undefined} />}>
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
        action={<SavedMark status={termDraft.status} help={t('saved.draftHelp')} />}
        footer={<PrimaryBtn label={t('config.keyTerms.addTerm')} onPress={() => void add()} disabled={!termDraftReady(draft)} busy={busy} />}>
        <Field value={draft.term} onChangeText={(v) => setDraft({ ...draft, term: v })} placeholder={t('config.keyTerms.termPlaceholder')} />
        <Field value={draft.gloss} onChangeText={(v) => setDraft({ ...draft, gloss: v })} placeholder={t('config.keyTerms.meaningPlaceholder')} autoCapitalize="sentences" />
        <Field value={draft.rendering} onChangeText={(v) => setDraft({ ...draft, rendering: v })} placeholder={t('config.keyTerms.renderingPlaceholder', { language })}
          help={t('config.keyTerms.renderingHelp', { language })} />
        <Field value={draft.context} onChangeText={(v) => setDraft({ ...draft, context: v })} placeholder={t('config.keyTerms.contextPlaceholder')} multiline autoCapitalize="sentences" />
      </Sheet>
    </Screen>
  );
}

/** The language with every passage a key term was tied in or changed during read in, for its uses; null until read. */
function useTermPassages(ctx: Ctx, termId: string, term: KeyTermView | null): LanguageState | null {
  const [view, setView] = useState<LanguageState | null>(null);
  const { state, passagesLinkingTerm, passageOfTake, withPassages } = ctx.language;
  useEffect(() => {
    if (!state || !term) return;
    let current = true;
    void (async () => {
      const units = new Set(await passagesLinkingTerm(termId));
      for (const a of term.adjustments) {
        const u = a.duringTakeId ? await passageOfTake(a.duringTakeId) : null;
        if (u) units.add(u);
      }
      const read = await withPassages([...units]);
      if (current) setView(read);
    })().catch(() => { /* read again on the next change */ });
    return () => { current = false; };
  }, [state, term, termId, passagesLinkingTerm, passageOfTake, withPassages]);
  return view;
}

export function KeyTermDetail(ctx: Ctx) {
  const state = ctx.language.state;
  const termId = ctx.params['termId'] ?? '';
  const unitId = ctx.params['unitId'];
  const term = useMemo(() => (state ? keyTermView(state, termId) : null), [state, termId]);
  const languageId = ctx.language.languageId;
  const passage = useMemo(() => (state && unitId && state.units[unitId] ? derivePassage(state, unitId, indexesFor(state)) : null), [state, unitId]);
  // The versions that tied the term in, and those its changes were made during, may be in passages not in memory (decisions.md 143).
  const uses = useTermPassages(ctx, termId, term);
  const usedIn = useMemo(() => (uses ? termUsedIn(uses, termId) : []), [uses, termId]);
  const [adjusting, setAdjusting] = useState(false);
  // A new rendering, or a change and why, is kept on this phone as it is made, there when the sheet opens again (decision 127).
  const adjust = useDraft<RenderingDraft>(languageId ? draftKey('word', ctx.session.actorId, languageId, 'adjust', termId) : null, EMPTY_RENDERING, isRenderingDraft);
  const { rendering, context, note, hash } = adjust.value;
  const change = (patch: Partial<RenderingDraft>) => adjust.set((d) => ({ ...d, ...patch }));
  const [busy, setBusy] = useState(false);
  const [usedShown, setUsedShown] = useState(STEP);
  const why = ctx.details(`term:${termId}:why`);
  const used = ctx.details(`term:${termId}:used`);
  // Opened on a passage: the word in its verses, in a Bible you choose, and how the
  // organization's other languages say it, before this language's own (demo ADR-042).
  const bible = useBible(ctx, passage ? passage.unitId : null, languageId, {});
  const others = useOtherLanguageTerms(ctx, !!term);
  const say = useMemo(() => (term ? othersSay(others.languages, term) : []), [others.languages, term]);

  if (!state || !term) {
    return <Screen header={<Header title={t('config.keyTerm.title')} onBack={ctx.back} />}><EmptyState icon="book" title={state ? t('config.keyTerm.gone') : t('common.loading')} /></Screen>;
  }
  const language = languageName(ctx.org.state, languageId);
  const canEdit = ctx.session.can('fill_reference') || ctx.session.can('manage_reference');
  // The draft this person has open, never the passage's first draft by anyone (STUDY-025, decision 83).
  const draftTakeId = draftToTie(passage, ctx.session.actorId, ctx.params['draftId']);
  const { canTie, isLinked } = tieState(state, termId, draftTakeId, ctx.params['takeId'], { translate: ctx.session.can('translate'), edit: canEdit });
  const passageLabel = passage ? unitTitle(state, passage.unitId) : null;
  const adjustments = [...term.adjustments].reverse();
  const versionOf = (takeId?: string) => versionOfTake(uses ?? state, takeId);
  const openVersion = (v: { unitId: string; takeId: string }) => ctx.go('version_detail', { unitId: v.unitId, languageId, takeId: v.takeId });

  async function tie() {
    if (!draftTakeId || isLinked || busy) return;
    setBusy(true);
    await actCommand(ctx, 'tie key term', () => commands(state!, indexesFor(state!)).linkKeyTerms({ commandId: Crypto.randomUUID(), takeId: draftTakeId, termIds: [termId] }), // i18n-ignore: log label
      t('config.keyTerm.tied', { term: term!.term }));
    setBusy(false);
  }

  async function addAdjustment() {
    if (!canEdit || busy || !adjustmentReady(note, hash)) return;
    const duringTakeId = adjustDuringTake(draftTakeId, passage);
    setBusy(true);
    const saved = await actCommand(ctx, 'adjust key term', () => commands(state!, indexesFor(state!)).adjustKeyTermRendering({ // i18n-ignore: log label
      commandId: Crypto.randomUUID(), termId, rendering, context, note,
      ...(hash ? { blobHash: hash } : {}), ...(duringTakeId ? { duringTakeId } : {}),
      // TERM-5: an adjustment made while drafting ties the term to the draft.
      ...(canTie && !isLinked && draftTakeId ? { tieToTakeId: draftTakeId } : {})
    }), rendering.trim() ? t('config.keyTerm.added', { rendering: rendering.trim() }) : t('config.keyTerm.changeRecorded'));
    if (saved) {
      adjust.set(EMPTY_RENDERING);
      await adjust.clear();
      setAdjusting(false);
    }
    setBusy(false);
  }

  const scopeTitles = term.unitScope.map((u) => unitTitle(state, u));
  const voice = [...term.adjustments].reverse().find((a) => a.blobHash)?.blobHash;
  return (
    <Screen header={<Header title={term.term} sub={isFiaTerm(term) ? t('config.keyTerm.fiaSub', { language }) : t('config.keyTerm.sub', { language })} onBack={ctx.back} />}>
      <Card style={{ backgroundColor: C.light }}>
        <Text style={txt.body}>{term.gloss || t('config.keyTerm.noMeaning')}</Text>
        <Text style={[txt.xsStrong, { color: C.primary }]}>{scopeTitles.length ? t('config.keyTerm.appearsIn', { places: listOf(scopeTitles) }) : t('config.keyTerm.everyPassage')}</Text>
      </Card>

      {passageLabel ? (
        <WhereItIs rows={bible.rows} book={bookOf(passageLabel)} word={term.term} bibleName={bible.option?.abbreviation ?? ''} missing={bibleMissing(bible)}
          chip={<BibleChip ctx={ctx} bible={bible} />} />
      ) : null}
      <OthersSay ctx={ctx} items={say} loading={others.loading} word={term.term} />

      {canTie ? (
        <Card onPress={isLinked ? undefined : () => void tie()} accessibilityLabel={isLinked ? t('config.keyTerm.tiedToDraft') : t('config.keyTerm.tieToDraft')}
          help={t('config.keyTerm.tieHelp')}
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
      {term.renderings.length === 0 && !voice ? (
        <Card onPress={canEdit ? () => setAdjusting(true) : undefined} accessibilityLabel={t('config.keyTerm.noRendering')}
          help={t('config.keyTerm.addRenderingHelp', { language })} style={{ backgroundColor: TINT.amber, borderStyle: 'dashed', borderWidth: 1.5, borderColor: `${C.amber}99` }}>
          <Text style={[txt.body, { fontWeight: '700', color: TINT.amberText }]}>{t('config.keyTerm.noRendering')}</Text>
          <Text style={[txt.sm, { color: TINT.amberText }]}>{t('config.keyTerm.addHow', { language })}</Text>
        </Card>
      ) : (
        <Group>
          {/* The word as the team said it (the recorder's Say yours), when it was said. */}
          {voice ? <View style={term.renderings.length > 0 ? styles.rowBorder : null}><OwnWord ctx={ctx} hash={voice} term={term.term} /></View> : null}
          {term.renderings.map((r, i) => (
            <View key={r.renderingId} style={[styles.rendering, i < term.renderings.length - 1 && styles.rowBorder]}>
              <Text style={[txt.h3, { color: C.primary }]}>{r.rendering}</Text>
              {r.context ? <Text style={txt.sm}>{r.context}</Text> : null}
            </View>
          ))}
        </Group>
      )}
      {canEdit ? <GhostBtn label={term.renderings.length ? t('config.keyTerm.adjustOrAdd') : t('config.keyTerm.addRendering')} icon="edit"
        help={t('config.keyTerm.adjustHelp', { language })} onPress={() => setAdjusting(true)} /> : null}

      {adjustments.length || usedIn.length ? <SectionLabel label={t('config.keyTerm.details')} /> : null}
      {adjustments.length ? (
        <Disclosure icon="history" title={t('config.keyTerm.why')} open={why.open} onToggle={why.onToggle}
          summary={`${t('config.keyTerm.changes', { count: adjustments.length })} · ${t('config.keyTerm.latestBy', { name: ctx.name(adjustments[0]!.actorId), when: when(adjustments[0]!.hlc) })}`}>
          {adjustments.map((a, i) => {
            const v = versionOf(a.duringTakeId);
            return (
              <HelpRow key={a.adjustmentId} of="keyTerm.adjustment">
                <View style={[styles.adjustment, i < adjustments.length - 1 && styles.rowBorder]}>
                  <Text style={txt.xs}>{ctx.name(a.actorId)} · {when(a.hlc)}{v ? ` · ${v.title}` : ''}</Text>
                  <Text style={txt.sm}>{adjustmentNote(a.note)}</Text>
                  {a.blobHash ? <AudioClip language={ctx.language} hashes={[a.blobHash]} label={t('config.keyTerm.playExplanation')} /> : null}
                  {v && v.n !== null ? <SmallBtn label={t('config.keyTerm.openVersion', { n: v.n })} icon="mic" help={t('config.keyTerm.openVersionHelp')} onPress={() => openVersion(v)} /> : null}
                </View>
              </HelpRow>
            );
          })}
        </Disclosure>
      ) : null}
      {usedIn.length ? (
        <Disclosure icon="mic" title={t('config.keyTerm.whereUsed')} open={used.open} onToggle={used.onToggle}
          summary={`${t('config.keyTerm.versions', { count: usedIn.length })} · ${listOf([...new Set(usedIn.map((u) => u.title))].slice(0, 2))}${usedIn.length > 2 ? '…' : ''}`}>
          {usedIn.slice(0, usedShown).map((u, i, a) => (
            <HelpRow key={u.takeId} of="keyTerm.usedIn">
              <Row icon="mic" label={t('config.keyTerm.usedTitle', { title: u.title, n: u.n })} sub={u.note ?? `${ctx.name(u.by)} · ${when(u.hlc)}`}
                badge={u.adjustmentId ? t('config.keyTerm.changedHere') : undefined} onPress={() => openVersion(u)} last={i === a.length - 1}
                help={u.adjustmentId ? t('config.keyTerm.usedChangedHelp') : t('config.keyTerm.usedHelp')} />
            </HelpRow>
          ))}
          <ShowMore remaining={usedIn.length - usedShown} step={STEP} onMore={() => setUsedShown(usedShown + STEP)} />
        </Disclosure>
      ) : null}
      <Sheet visible={adjusting} title={t('config.keyTerm.adjustTitle', { language, term: term.term })} onClose={() => setAdjusting(false)}
        sub={canTie ? t('config.keyTerm.adjustSubTie', { passage: passageLabel ?? '' }) : t('config.keyTerm.adjustSub')}
        action={<SavedMark status={adjust.status} help={t('saved.draftHelp')} />}
        footer={<PrimaryBtn label={t('reference.keyWords.addYourWord')} help={t('config.keyTerm.saveHelp')} onPress={() => void addAdjustment()} disabled={!adjustmentReady(note, hash)} busy={busy} />}>
        <Field value={rendering} onChangeText={(v) => change({ rendering: v })} placeholder={t('config.keyTerm.newRendering')} />
        {rendering.trim() ? <Field value={context} onChangeText={(v) => change({ context: v })} placeholder={t('config.keyTerm.whenToUse')} multiline autoCapitalize="sentences" /> : null}
        {passage ? <VoiceNote ctx={ctx} label={t('config.keyTerm.sayWhy')} hash={hash} onChange={(h) => change({ hash: h })} /> : null}
        <Field value={note} onChangeText={(v) => change({ note: v })} placeholder={passage ? t('config.keyTerm.orTypeWhy') : t('config.keyTerm.typeWhy')} multiline autoCapitalize="sentences" />
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
