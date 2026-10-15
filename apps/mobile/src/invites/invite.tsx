// Invite someone (decision 71, demo ADR-039; the prototype's Invite): what
// will they do, in plain words, then the code to scan. One group code (the
// invite RPC Invite by QR uses) works for a whole workshop table and needs no
// password. Used by Invite Member and by a new language's last step.
import type { Scope } from '@langquest-next/core';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { Chip, PrimaryBtn, QuietLinks, Screen, SectionLabel, type IconName } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { C, space } from '../ui/theme';
import { DashedRow, InviteCode, Pills, Question, QuietLink, RadioRow } from '../admin/admin';
import { useGroupInvite } from '../admin/useGroupInvite';
import { usePlainRoles } from '../admin/useReadySummary';
import { shareInvite } from './shareInvite';

export interface InviteScope {
  key: string;
  label: string;
  scope: Scope;
}

export function InviteSomeone(props: {
  ctx: Ctx;
  header: (shown: boolean, back: () => void, scope: InviteScope | null) => ReactNode;
  scopes: InviteScope[];
  initialScope: string;
  /** What the group code is called for those who scan it ("Hadiyya team"). */
  label: (scope: InviteScope) => string;
  onDone: () => void;
  onNewRole?: () => void;
  /** Quieter ways to invite, under the main button (by email, one person by name). */
  links?: (roleId: string | null, scope: InviteScope | null) => { label: string; icon: IconName; onPress: () => void }[];
  disabled?: string;
}) {
  const { ctx } = props;
  const [choice, setChoice] = useState<string>('translate');
  const [others, setOthers] = useState(false);
  const [scopeKey, setScopeKey] = useState(props.initialScope);
  const [shown, setShown] = useState(false);
  // The organization's own writes go first: a role made a moment ago must be on the server before a code names it.
  const [sent, setSent] = useState(false);
  const scope = props.scopes.find((s) => s.key === scopeKey) ?? props.scopes[0] ?? null;
  const roles = usePlainRoles(ctx, scope?.scope ?? null);
  const roleId = roles.choices.find((c) => c.id === choice)?.roleId ?? roles.others.find((r) => r.id === choice)?.id ?? null;
  const making = shown && sent;
  const invite = useGroupInvite(ctx.language.orgId, making ? roleId : null, making && scope ? scope.scope : null, scope ? props.label(scope) : '');
  function show() {
    setShown(true);
    setSent(false);
    void ctx.org.sync().then(() => setSent(true));
  }
  const uri = invite && 'uri' in invite ? invite.uri : null;
  const what = roles.choices.find((c) => c.id === choice)?.label ?? roles.others.find((r) => r.id === choice)?.name ?? '';
  // A role made from here ("Something else: make a new role") comes back chosen (design principle 12).
  const rolesBefore = useRef<Set<string> | null>(null);
  const otherIds = roles.others.map((r) => r.id).join('|');
  useEffect(() => {
    const before = rolesBefore.current;
    const made = before ? roles.others.find((r) => !before.has(r.id)) : undefined;
    if (made) { rolesBefore.current = null; setChoice(made.id); setOthers(true); }
    // `otherIds` names what changes in `roles.others`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otherIds]);
  const newRole = props.onNewRole ? () => { rolesBefore.current = new Set(roles.others.map((r) => r.id)); props.onNewRole!(); } : undefined;

  if (shown) {
    return (
      <Screen header={props.header(true, () => setShown(false), scope)} bodyStyle={{ paddingHorizontal: 20, gap: 14 }}
        footer={<>
          <PrimaryBtn label={t('common.done')} icon="check" onPress={props.onDone} />
          <QuietLinks items={[
            ...(uri ? [{ label: t('admin.invite.shareLink'), icon: 'send' as const, onPress: () => shareInvite(ctx, uri) }] : []),
            { label: t('admin.invite.someoneElse'), icon: 'arrowL' as const, onPress: () => setShown(false) }
          ]} />
        </>}>
        <Question>{what}{scope && props.scopes.length > 1 ? ` · ${scope.label}` : ''}</Question>
        <InviteCode state={invite} />
      </Screen>
    );
  }
  return (
    <Screen header={props.header(false, ctx.back, scope)} bodyStyle={{ paddingHorizontal: 20, gap: 14 }}
      footer={<>
        <PrimaryBtn label={t('admin.invite.showCode')} icon="qr" disabled={!roleId || !scope || !!props.disabled} onPress={show} />
        {props.links ? <QuietLinks items={props.links(roleId, scope)} /> : null}
      </>}>
      <Question>{t('admin.invite.whatWillTheyDo')}</Question>
      {/* Making a new role comes first, set apart from the roles there are (design principle 12). */}
      {newRole ? <DashedRow icon="plus" label={t('admin.invite.newRole')} onPress={newRole} /> : null}
      {roles.choices.map((c) => (
        <RadioRow key={c.id} tile icon={c.icon as IconName} label={c.label} on={choice === c.id} onPress={() => setChoice(c.id)} />
      ))}
      {roles.others.length ? (others ? roles.others.map((r) => (
        <RadioRow key={r.id} tile icon="star" label={r.name} on={choice === r.id} onPress={() => setChoice(r.id)} />
      )) : <QuietLink icon="down" label={t('admin.invite.otherRoles', { total: formatNumber(roles.others.length) })} onPress={() => setOthers(true)} />) : null}
      {props.scopes.length > 1 ? (
        <>
          <SectionLabel label={t('admin.invite.whichLanguage')} />
          <Pills>{props.scopes.map((s) => <Chip key={s.key} label={s.label} on={scopeKey === s.key} onPress={() => setScopeKey(s.key)} />)}</Pills>
        </>
      ) : null}
      {props.disabled ? <Text style={[txt.sm, { color: C.muted, paddingHorizontal: space.xs }]}>{props.disabled}</Text> : null}
    </Screen>
  );
}
