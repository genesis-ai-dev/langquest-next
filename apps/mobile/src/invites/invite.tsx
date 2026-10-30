// Invite someone (decision 71, demo ADR-039; decision 146, amended for
// LAN-195): one page. The roles are tiles at the top, the first already
// picked, and that role's code is right under them; tapping another role
// changes the code on the same page. A role that does checks shows the
// language's checks to tick above its code, and ticking one makes the code
// that puts people on it. Share as a link, by email and one person by name
// use the role picked at the top. One group code (the invite RPC Invite by
// QR uses) works for a whole workshop table and needs no password. Used by
// Invite Member and by New language's last step, which opens it with "Time
// to invite people".
import { checkTeamSpecs, deriveFlow, type Privilege, type Scope } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { deriveKinds } from '../i18n/coreText';
import { Chip, ChipWrap, Ico, PrimaryBtn, QuietLinks, Screen, SectionLabel, type IconName } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { C, radius, space, target } from '../ui/theme';
import { DashedRow, InviteCode, Pills, Question, QuietLink } from '../admin/admin';
import { checkName, ROLE_SWITCHES, switchState } from '../admin/adminModel';
import { useGroupInvite } from '../admin/useGroupInvite';
import { usePlainRoles } from '../admin/useReadySummary';
import { shareInvite } from './shareInvite';
import { plainRoleHelp } from '../admin/readyText';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { rowsOf } from '../checks/model';
import { a11yState } from '../ui/a11yModel';

export interface InviteScope {
  key: string;
  label: string;
  scope: Scope;
}

/** A role on offer: a plain choice ("Translators") or one of the organization's other roles, by its name. */
interface RoleOffer { key: string; roleId: string; title: string; sub?: string; icon: IconName }

/** Ticking checks one after another makes one code, not one for each tick. */
const CHECKS_SETTLE_MS = 700;
const NO_CHECKS: readonly string[] = [];

export function InviteSomeone(props: {
  ctx: Ctx;
  header: (back: () => void, scope: InviteScope | null) => ReactNode;
  scopes: InviteScope[];
  initialScope: string;
  /** What the group code is called for those who scan it ("Hadiyya team"). */
  label: (scope: InviteScope) => string;
  onDone: () => void;
  onNewRole?: () => void;
  /** Quieter ways to invite, for the role picked (by email, one person by name). */
  links?: (roleId: string, scope: InviteScope) => { label: string; icon: IconName; onPress: () => void; help?: string }[];
  disabled?: string;
  /** New language's first look at inviting (decision 146): "Time to invite people" over the roles. */
  welcome?: boolean;
  /** What Done says it does in help mode: New language's way out of its last step (LAN-196). */
  done?: { help: string; onPress: () => void };
  /** Under the header: New language's stages. */
  top?: ReactNode;
}) {
  const { ctx } = props;
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const [others, setOthers] = useState(false);
  const [mayOpen, setMayOpen] = useState(false);
  const [checks, setChecks] = useState<readonly string[]>(NO_CHECKS);
  const [settled, setSettled] = useState<readonly string[]>(NO_CHECKS);
  const [scopeKey, setScopeKey] = useState(props.initialScope);
  const scope = props.scopes.find((s) => s.key === scopeKey) ?? props.scopes[0] ?? null;
  const roles = usePlainRoles(ctx, scope?.scope ?? null);
  const offers: RoleOffer[] = roles.choices.map((c) => ({ key: c.id, roleId: c.roleId, title: peopleWord(c.id), sub: plainRoleHelp(c.id), icon: c.icon as IconName }));
  const more: RoleOffer[] = roles.others.map((r) => ({ key: r.id, roleId: r.id, title: r.name, icon: 'star' }));
  // The first role is picked until another is: its code shows as the page opens.
  const chosen = [...offers, ...more].find((o) => o.key === pickedKey) ?? offers[0] ?? more[0] ?? null;

  // The checks a code can put people on: the open language's, when the code is for it, for a role that does checks,
  // by someone who may choose who does them (decision 146).
  const state = ctx.language.state;
  const forOpen = scope?.scope.level === 'language' && scope.scope.languageId === ctx.language.languageId && !!state;
  const kinds = useMemo(() => (state ? deriveKinds(state) : []), [state]);
  const rows = useMemo(() => (state && forOpen ? rowsOf(deriveFlow(state).steps) : []), [state, forOpen]);
  const reviews = (roleId: string) => (ctx.org.state?.roles[roleId]?.privileges.value ?? []).includes('review');
  const offersChecks = (o: RoleOffer) => forOpen && rows.length > 0 && reviews(o.roleId) && ctx.session.can('manage_teams');
  const withChecks = !!chosen && offersChecks(chosen);
  // A code for the language being opened (New language opens the one it just added) waits until it is read from
  // this phone: before that its checks are unknown, and the code would skip them.
  const opening = scope?.scope.level === 'language' && scope.scope.languageId === ctx.languageId
    && (ctx.language.languageId !== ctx.languageId || !state);

  useEffect(() => {
    if (sameChecks(checks, settled)) return;
    const timer = setTimeout(() => setSettled(checks), CHECKS_SETTLE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new tick starts the wait
  }, [checks]);

  // Before a code names them, a role made a moment ago must be on the server, and each check ticked must have its
  // team named (core checkTeamSpecs): the organization's own writes go first, once for each role, place and checks.
  const want = chosen && scope && !props.disabled && !opening ? `${chosen.roleId}|${scope.key}|${[...settled].sort().join(',')}` : null;
  const [ready, setReady] = useState<Record<string, true>>({});
  useEffect(() => {
    if (!want || ready[want]) return;
    let live = true;
    const s = ctx.language.state;
    const commandId = Crypto.randomUUID();
    const named = s && withChecks ? settled.flatMap((k, i) => checkTeamSpecs(s, { commandId: `${commandId}:${i}`, kindId: k, name: checkName(k, kinds) })) : [];
    const first = named.length ? ctx.language.run(named) : Promise.resolve();
    const done = () => { if (live) setReady((r) => ({ ...r, [want]: true })); };
    void first.catch(() => {}).then(() => ctx.org.sync()).then(done, done);
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `want` names the role, place and checks the work is for
  }, [want]);
  const making = !!want && !!ready[want];
  const made = useGroupInvite(ctx.language.orgId, making ? chosen?.roleId ?? null : null, making && scope ? scope.scope : null,
    scope ? props.label(scope) : '', settled);
  // While a tick waits to settle, the code on screen would not put them on it: it shows as being made.
  const invite = sameChecks(checks, settled) ? made : null;
  const uri = invite && 'uri' in invite ? invite.uri : null;

  // A role made from here ("Something else: make a new role") comes back picked, with what it lets them do (design principle 12).
  const rolesBefore = useRef<Set<string> | null>(null);
  const otherIds = roles.others.map((r) => r.id).join('|');
  useEffect(() => {
    const before = rolesBefore.current;
    const added = before ? roles.others.find((r) => !before.has(r.id)) : undefined;
    if (added) { rolesBefore.current = null; setOthers(true); pick(added.id); setMayOpen(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `otherIds` names what changes in `roles.others`
  }, [otherIds]);
  const newRole = props.onNewRole ? () => { rolesBefore.current = new Set(roles.others.map((r) => r.id)); props.onNewRole!(); } : undefined;

  function pick(key: string) {
    setPickedKey(key);
    setChecks(NO_CHECKS);
    setSettled(NO_CHECKS);
  }

  const off = !!props.disabled || !scope;
  // help-each: each role does different work
  const tiles = (list: RoleOffer[]) => list.map((o) => (
    <RoleTile key={o.key} offer={o} on={chosen?.key === o.key} disabled={off} onPress={() => pick(o.key)} />
  ));
  const links = chosen && scope && !off ? [
    ...(uri ? [{ label: t('admin.invite.shareLink'), icon: 'send' as const, help: t('admin.invite.shareLinkHelp'), onPress: () => shareInvite(ctx, uri) }] : []),
    ...(props.links ? props.links(chosen.roleId, scope) : [])
  ] : [];

  return (
    <Screen header={props.header(ctx.back, scope)} bodyStyle={styles.body}
      footer={<>
        <PrimaryBtn label={t('common.done')} icon="check" help={props.done?.help ?? t('help.details.done')} onPress={props.done?.onPress ?? props.onDone} />
        {links.length ? <QuietLinks items={links} /> : null}
      </>}>
      {props.top}
      <Question>{props.welcome ? t('admin.invite.timeToInvite') : t('admin.invite.whoInviting')}</Question>
      {/* Where first, in view: the roles offered depend on it (UI audit, finding 93). */}
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
      {/* Making a new role comes first, set apart from the roles there are (design principle 12). */}
      {newRole ? <DashedRow icon="plus" label={t('admin.invite.newRole')} detail={t('admin.invite.newRoleHelp')} onPress={newRole} /> : null}
      <View style={styles.tiles} accessibilityRole="radiogroup">
        {tiles(offers)}
        {others ? tiles(more) : null}
      </View>
      {more.length && !others ? (
        <QuietLink icon="down" label={t('admin.invite.otherRoles', { total: formatNumber(more.length) })} detail={t('admin.invite.otherRolesHelp')}
          onPress={() => setOthers(true)} />
      ) : null}
      {chosen ? (
        <MayDo offer={chosen} scope={scope} open={mayOpen} onToggle={() => setMayOpen((v) => !v)}
          privileges={ctx.org.state?.roles[chosen.roleId]?.privileges.value ?? []} />
      ) : null}
      {withChecks && !off ? (
        <>
          <SectionLabel label={t('admin.invite.whichChecks')} />
          <ChipWrap>
            {/* help-each: each check is a different one to be put on */}
            {rows.map((r) => {
              const on = checks.includes(r.kindId);
              return (
                <Chip key={r.kindId} label={checkName(r.kindId, kinds)} icon={on ? 'check' : undefined} on={on}
                  help={on ? t('admin.invite.checkOnHelp') : t('admin.invite.checkOffHelp')}
                  onPress={() => setChecks((cur) => (cur.includes(r.kindId) ? cur.filter((k) => k !== r.kindId) : [...cur, r.kindId]))} />
              );
            })}
          </ChipWrap>
        </>
      ) : null}
      {chosen && scope && !off ? (
        <View style={styles.code}>
          <Question>{chosen.title}{props.scopes.length > 1 ? ` · ${scope.label}` : ''}</Question>
          <InviteCode state={invite} />
        </View>
      ) : null}
      {props.disabled ? <Text style={[txt.sm, { color: C.muted, paddingHorizontal: space.xs }]}>{props.disabled}</Text> : null}
    </Screen>
  );
}

function sameChecks(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((k) => b.includes(k));
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

/** A role as a tile, picked or not: picking it shows its code. */
function RoleTile(props: { offer: RoleOffer; on: boolean; disabled: boolean; onPress: () => void }) {
  const { offer } = props;
  const what = t('admin.invite.inviteHelp', { people: offer.title });
  const spot = useHelpSpot(offer.title, offer.sub ? t('help.lineAfterSentence', { label: offer.sub, detail: what }) : what, props.onPress);
  return (
    <Pressable testID={`invite-role-${offer.title}`} onPress={spot.onPress} disabled={props.disabled && !spot.id}
      accessibilityRole="radio" accessibilityLabel={offer.title} {...a11yState({ selected: props.on, disabled: props.disabled }, 'radio')}
      style={({ pressed }) => [styles.tile, props.on && styles.tileOn, props.disabled && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}>
      <View style={[styles.tileIcon, props.on && styles.tileIconOn]}>
        <Ico name={offer.icon} size={18} color={props.on ? C.white : C.primary} />
      </View>
      <Text style={[styles.tileText, props.on && { color: C.white }]}>{offer.title}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** What the role picked lets them do (its role's switches that are on) and where, one tap open. */
function MayDo(props: { offer: RoleOffer; scope: InviteScope | null; privileges: readonly Privilege[]; open: boolean; onToggle: () => void }) {
  const { offer } = props;
  const what = t('admin.invite.whatTheyMayDo');
  const spot = useHelpSpot(what, props.open ? t('admin.invite.hideMayDoHelp') : t('admin.invite.showMayDoHelp', { people: offer.title }), props.onToggle);
  const may = ROLE_SWITCHES.flatMap((g) => g.rows.filter((r) => switchState(props.privileges, r) !== 'off').map((r) => r.label));
  const where = !props.scope ? '' : props.scope.scope.level === 'org' ? t('admin.invite.everyLanguage') : t('admin.invite.onlyIn', { language: props.scope.label });
  return (
    <View>
      <Pressable onPress={spot.onPress} accessibilityRole="button" {...a11yState({ expanded: props.open }, 'button')} accessibilityLabel={`${what}: ${offer.title}`}
        style={({ pressed }) => [styles.more, pressed && { opacity: 0.7 }]}>
        <Text style={styles.moreText}>{what}</Text>
        <Ico name={props.open ? 'up' : 'down'} size={18} color={C.primary} />
        <HelpBadge spot={spot} />
      </Pressable>
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
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    flexBasis: '45%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: target.primary, paddingHorizontal: space.md,
    paddingVertical: space.sm, borderRadius: radius.lg, backgroundColor: C.card, borderWidth: 2, borderColor: C.border
  },
  tileOn: { backgroundColor: C.primary, borderColor: C.primary },
  tileIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  tileIconOn: { backgroundColor: 'rgba(255,255,255,0.18)' },
  tileText: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '800', color: C.dark },
  code: { gap: space.sm, padding: space.md, borderRadius: radius.xl, backgroundColor: C.card, borderWidth: 2, borderColor: C.border },
  more: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: target.min, paddingHorizontal: space.xs, alignSelf: 'flex-start' },
  moreText: { fontSize: 15, fontWeight: '700', color: C.primary },
  may: { gap: 6, paddingTop: space.xs, paddingHorizontal: space.xs },
  mayRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 2 }
});
