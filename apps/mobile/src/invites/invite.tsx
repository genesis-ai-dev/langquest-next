// Invite someone (decision 71, demo ADR-039; decision 143): the roles as
// cards, each with what it lets them do one tap open and its own Invite, so
// it reads as inviting several kinds of people, not choosing one. A role that
// does checks can be put on some of the language's checks first (skippable),
// then the code to scan. One group code (the invite RPC Invite by QR uses)
// works for a whole workshop table and needs no password. Used by Invite
// Member and by New language's last step, which opens it with "Time to
// invite people".
import { checkTeamSpecs, deriveFlow, type Privilege, type Scope } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { deriveKinds } from '../i18n/coreText';
import { Chip, Ico, PrimaryBtn, QuietLinks, Screen, SectionLabel, SmallBtn, type IconName } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { C, radius, space, target } from '../ui/theme';
import { DashedRow, IconTile, InviteCode, Pills, Question, QuietLink, RadioRow } from '../admin/admin';
import { checkName, ROLE_SWITCHES, switchState } from '../admin/adminModel';
import { useGroupInvite } from '../admin/useGroupInvite';
import { usePlainRoles } from '../admin/useReadySummary';
import { shareInvite } from './shareInvite';
import { plainRoleHelp } from '../admin/readyText';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { useHardwareBack } from '../ui/useHardwareBack';
import { rowsOf } from '../checks/model';

export interface InviteScope {
  key: string;
  label: string;
  scope: Scope;
}

/** A role on offer: a plain choice ("Translators") or one of the organization's other roles, by its name. */
interface RoleOffer { key: string; roleId: string; title: string; sub?: string; icon: IconName }

export function InviteSomeone(props: {
  ctx: Ctx;
  header: (back: () => void, scope: InviteScope | null) => ReactNode;
  scopes: InviteScope[];
  initialScope: string;
  /** What the group code is called for those who scan it ("Hadiyya team"). */
  label: (scope: InviteScope) => string;
  onDone: () => void;
  onNewRole?: () => void;
  /** Quieter ways to invite, under a role's code (by email, one person by name). */
  links?: (roleId: string, scope: InviteScope) => { label: string; icon: IconName; onPress: () => void; help?: string }[];
  disabled?: string;
  /** New language's first look at inviting (decision 143): "Time to invite people" over the roles. */
  welcome?: boolean;
  /** Under the roles: New language's Later. */
  later?: { label: string; help: string; onPress: () => void };
  /** Under the header on every page: New language's stages. */
  top?: ReactNode;
}) {
  const { ctx } = props;
  const [page, setPage] = useState<'roles' | 'checks' | 'code'>('roles');
  const [chosen, setChosen] = useState<RoleOffer | null>(null);
  const [others, setOthers] = useState(false);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [checks, setChecks] = useState<string[]>([]);
  const [scopeKey, setScopeKey] = useState(props.initialScope);
  // The organization's own writes go first: a role made a moment ago must be on the server before a code names it.
  const [sent, setSent] = useState(false);
  const scope = props.scopes.find((s) => s.key === scopeKey) ?? props.scopes[0] ?? null;
  const roles = usePlainRoles(ctx, scope?.scope ?? null);
  const offers: RoleOffer[] = roles.choices.map((c) => ({ key: c.id, roleId: c.roleId, title: peopleWord(c.id), sub: plainRoleHelp(c.id), icon: c.icon as IconName }));
  const more: RoleOffer[] = roles.others.map((r) => ({ key: r.id, roleId: r.id, title: r.name, icon: 'star' }));
  const making = page === 'code' && sent;
  const invite = useGroupInvite(ctx.language.orgId, making ? chosen?.roleId ?? null : null, making && scope ? scope.scope : null, scope ? props.label(scope) : '', checks);
  const uri = invite && 'uri' in invite ? invite.uri : null;

  // The checks a code can put people on: the open language's, when the code is for it, for a role that does checks,
  // by someone who may choose who does them (decision 143).
  const state = ctx.language.state;
  const forOpen = scope?.scope.level === 'language' && scope.scope.languageId === ctx.language.languageId && !!state;
  const kinds = useMemo(() => (state ? deriveKinds(state) : []), [state]);
  const rows = useMemo(() => (state && forOpen ? rowsOf(deriveFlow(state).steps) : []), [state, forOpen]);
  const reviews = (roleId: string) => (ctx.org.state?.roles[roleId]?.privileges.value ?? []).includes('review');
  const offersChecks = (o: RoleOffer) => forOpen && rows.length > 0 && reviews(o.roleId) && ctx.session.can('manage_teams');

  // A phone's Back goes back a page, as the header's arrow does (decision 137).
  useHardwareBack(page !== 'roles', () => back());
  function back() {
    if (page === 'code' && chosen && offersChecks(chosen)) setPage('checks');
    else setPage('roles');
  }

  // A role made from here ("Something else: make a new role") comes back opened (design principle 12).
  const rolesBefore = useRef<Set<string> | null>(null);
  const otherIds = roles.others.map((r) => r.id).join('|');
  useEffect(() => {
    const before = rolesBefore.current;
    const made = before ? roles.others.find((r) => !before.has(r.id)) : undefined;
    if (made) { rolesBefore.current = null; setOthers(true); setOpenCard(made.id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `otherIds` names what changes in `roles.others`
  }, [otherIds]);
  const newRole = props.onNewRole ? () => { rolesBefore.current = new Set(roles.others.map((r) => r.id)); props.onNewRole!(); } : undefined;

  function pick(o: RoleOffer) {
    setChosen(o);
    setChecks([]);
    if (offersChecks(o)) setPage('checks');
    else showCode([]);
  }

  function showCode(picked: string[]) {
    setPage('code');
    setSent(false);
    // A check's team is named before a code puts anyone on it (core checkTeamSpecs).
    const s = ctx.language.state;
    const commandId = Crypto.randomUUID();
    const named = s ? picked.flatMap((k, i) => checkTeamSpecs(s, { commandId: `${commandId}:${i}`, kindId: k, name: checkName(k, kinds) })) : [];
    const first = named.length ? ctx.language.run(named) : Promise.resolve();
    void first.catch(() => {}).then(() => ctx.org.sync()).then(() => setSent(true), () => setSent(true));
  }

  if (page === 'checks' && chosen) {
    return (
      <Screen header={props.header(back, scope)} bodyStyle={styles.body}
        footer={<>
          <PrimaryBtn label={t('admin.invite.showCode')} icon="qr" help={checks.length ? t('admin.invite.showCodeChecksHelp') : t('admin.invite.showCodeNoChecksHelp')}
            onPress={() => showCode(checks)} />
          <QuietLinks items={[{ label: t('common.back'), icon: 'arrowL', help: t('admin.invite.backToRolesHelp'), onPress: back }]} />
        </>}>
        {props.top}
        <Question>{t('admin.invite.whichChecks')}</Question>
        <View style={{ gap: 10 }}>
          {rows.map((r) => {
            const on = checks.includes(r.kindId);
            return (
              <HelpRow key={r.kindId} of="invite.check">
                <RadioRow tile many icon="check" label={checkName(r.kindId, kinds)} on={on}
                  help={on ? t('admin.invite.checkOnHelp') : t('admin.invite.checkOffHelp')}
                  onPress={() => setChecks((cur) => (cur.includes(r.kindId) ? cur.filter((k) => k !== r.kindId) : [...cur, r.kindId]))} />
              </HelpRow>
            );
          })}
        </View>
      </Screen>
    );
  }

  if (page === 'code' && chosen && scope) {
    return (
      <Screen header={props.header(back, scope)} bodyStyle={styles.body}
        footer={<>
          <PrimaryBtn label={t('common.done')} icon="check" help={t('help.details.done')} onPress={props.onDone} />
          <QuietLinks items={[
            ...(uri ? [{ label: t('admin.invite.shareLink'), icon: 'send' as const, help: t('admin.invite.shareLinkHelp'), onPress: () => shareInvite(ctx, uri) }] : []),
            ...(props.links ? props.links(chosen.roleId, scope) : []),
            { label: t('admin.invite.someoneElse'), icon: 'arrowL' as const, help: t('admin.invite.someoneElseHelp'), onPress: () => setPage('roles') }
          ]} />
        </>}>
        {props.top}
        <Question>{chosen.title}{props.scopes.length > 1 ? ` · ${scope.label}` : ''}</Question>
        {checks.length ? (
          <View style={styles.tags}>
            {checks.map((k) => (
              <View key={k} style={styles.tag}><Ico name="check" size={14} color={C.primary} /><Text style={styles.tagText}>{checkName(k, kinds)}</Text></View>
            ))}
          </View>
        ) : null}
        <InviteCode state={invite} />
      </Screen>
    );
  }

  return (
    <Screen header={props.header(ctx.back, scope)} bodyStyle={styles.body}
      footer={props.later ? <QuietLinks items={[{ label: props.later.label, icon: 'clock', help: props.later.help, onPress: props.later.onPress }]} /> : undefined}>
      {props.top}
      {props.welcome ? (
        <View style={styles.welcome}>
          <View style={styles.welcomeIcons}>
            {(['mic', 'check', 'globe', 'people'] as const).map((n) => <IconTile key={n} icon={n} size={44} />)}
          </View>
          <Question>{t('admin.invite.timeToInvite')}</Question>
        </View>
      ) : <Question>{t('admin.invite.whoInviting')}</Question>}
      {/* Making a new role comes first, set apart from the roles there are (design principle 12). */}
      {newRole ? <DashedRow icon="plus" label={t('admin.invite.newRole')} detail={t('admin.invite.newRoleHelp')} onPress={newRole} /> : null}
      {/* help-each: each role does different work */}
      {offers.map((o) => (
        <RoleCard key={o.key} offer={o} scope={scope} open={openCard === o.key} disabled={!!props.disabled || !scope}
          onOpen={() => setOpenCard(openCard === o.key ? null : o.key)} onInvite={() => pick(o)}
          privileges={ctx.org.state?.roles[o.roleId]?.privileges.value ?? []} />
      ))}
      {more.length ? (others ? more.map((o) => (
        <HelpRow key={o.key} of="invite.otherRole">
          <RoleCard offer={o} scope={scope} open={openCard === o.key} disabled={!!props.disabled || !scope}
            onOpen={() => setOpenCard(openCard === o.key ? null : o.key)} onInvite={() => pick(o)}
            privileges={ctx.org.state?.roles[o.roleId]?.privileges.value ?? []} />
        </HelpRow>
      )) : <QuietLink icon="down" label={t('admin.invite.otherRoles', { total: formatNumber(more.length) })} detail={t('admin.invite.otherRolesHelp')}
        onPress={() => setOthers(true)} />) : null}
      {props.scopes.length > 1 ? (
        <>
          <SectionLabel label={t('admin.invite.whichLanguage')} />
          <Pills>{props.scopes.map((s) => (
            <HelpRow key={s.key} of={s.scope.level === 'org' ? 'invite.scopeOrg' : 'invite.scopeLanguage'}>
              <Chip label={s.label} on={scopeKey === s.key} onPress={() => setScopeKey(s.key)}
                help={s.scope.level === 'org' ? t('admin.invite.scopeOrgHelp') : t('admin.invite.scopeLanguageHelp')} />
            </HelpRow>
          ))}</Pills>
        </>
      ) : null}
      {props.disabled ? <Text style={[txt.sm, { color: C.muted, paddingHorizontal: space.xs }]}>{props.disabled}</Text> : null}
    </Screen>
  );
}

/** A plain choice as the people it brings: "Translators". */
function peopleWord(id: string): string {
  switch (id) {
    case 'translate': return t('admin.roles.translatePeople');
    case 'check': return t('admin.roles.checkPeople');
    case 'backtranslate': return t('admin.roles.backtranslatePeople');
    default: return t('admin.roles.leadPeople');
  }
}

/**
 * A role as a card: what it brings, its own Invite, and one tap open, what
 * it lets them do (its role's switches that are on) and where.
 */
function RoleCard(props: {
  offer: RoleOffer; scope: InviteScope | null; privileges: readonly Privilege[]; open: boolean; disabled: boolean;
  onOpen: () => void; onInvite: () => void;
}) {
  const { offer } = props;
  const what = t('admin.invite.whatTheyMayDo');
  const spot = useHelpSpot(what, props.open ? t('admin.invite.hideMayDoHelp') : t('admin.invite.showMayDoHelp', { people: offer.title }), props.onOpen);
  const may = ROLE_SWITCHES.flatMap((g) => g.rows.filter((r) => switchState(props.privileges, r) !== 'off').map((r) => r.label));
  const where = !props.scope ? '' : props.scope.scope.level === 'org' ? t('admin.invite.everyLanguage') : t('admin.invite.onlyIn', { language: props.scope.label });
  return (
    <View testID={`invite-role-${offer.title}`} style={[styles.card, props.open && styles.cardOpen]}>
      <View style={styles.cardHead}>
        <IconTile icon={offer.icon} size={44} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.cardTitle}>{offer.title}</Text>
          {offer.sub ? <Text style={[txt.sm, { color: C.muted }]}>{offer.sub}</Text> : null}
        </View>
      </View>
      <View style={styles.cardFoot}>
        <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityState={{ expanded: props.open }} accessibilityLabel={`${what}: ${offer.title}`}
          style={({ pressed }) => [styles.more, pressed && { opacity: 0.7 }]}>
          <Text style={styles.moreText}>{what}</Text>
          <Ico name={props.open ? 'up' : 'down'} size={18} color={C.primary} />
          <HelpBadge spot={spot} />
        </Pressable>
        <SmallBtn label={t('admin.invite.invite')} icon="qr" tone="primary" disabled={props.disabled}
          help={t('admin.invite.inviteHelp', { people: offer.title })} onPress={props.onInvite} />
      </View>
      {props.open ? (
        <View style={styles.may}>
          {may.map((label) => (
            <View key={label} style={styles.mayRow}><Ico name="check" size={16} color={C.green} strokeWidth={3} /><Text style={[txt.sm, { flex: 1 }]}>{label}</Text></View>
          ))}
          {where ? <View style={styles.mayRow}><Ico name="globe" size={16} color={C.muted} /><Text style={[txt.sm, { flex: 1, color: C.muted }]}>{where}</Text></View> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, gap: 14 },
  welcome: { gap: space.sm, alignItems: 'flex-start' },
  welcomeIcons: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.xs },
  card: { padding: 14, borderRadius: radius.xl, backgroundColor: C.card, borderWidth: 2, borderColor: C.border, gap: space.sm },
  cardOpen: { borderColor: C.soft },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  cardTitle: { fontSize: 17, fontWeight: '800', color: C.dark },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' },
  more: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: target.min, paddingHorizontal: space.xs },
  moreText: { fontSize: 15, fontWeight: '700', color: C.primary },
  may: { gap: 6, paddingTop: space.xs, borderTopWidth: 1, borderTopColor: C.border },
  mayRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 2 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: space.xs },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, minHeight: 30, borderRadius: radius.full, backgroundColor: C.light },
  tagText: { fontSize: 14, fontWeight: '700', color: C.primary }
});
