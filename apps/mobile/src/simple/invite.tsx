// Invite someone (decision 71, demo ADR-039; the prototype's Invite): what
// will they do, in plain words, then the code to scan. One group code (the
// invite RPC Invite by QR uses) works for a whole workshop table and needs no
// password. Used by Invite Member and by a new language's last step.
import type { Scope } from '@langquest-next/core';
import { useState, type ReactNode } from 'react';
import { Text } from 'react-native';
import type { Ctx } from '../ctx';
import { Chip, PrimaryBtn, QuietLinks, Screen, SectionLabel, txt, type IconName } from '../kit';
import { shareText } from '../share';
import { C, space } from '../theme';
import { DashedRow, InviteCode, Pills, Question, QuietLink, RadioRow, useGroupInvite } from './admin';
import { usePlainRoles } from './ready';

export interface InviteScope {
  key: string;
  label: string;
  scope: Scope;
}

/** Share a code's link: the share sheet, or copied where there is none. */
export function shareInvite(ctx: Ctx, uri: string) {
  void shareText(uri).then((r) => {
    if (r === 'copied') ctx.toast('Invite link copied. Paste it into a message.');
    else if (r === 'failed') ctx.toast('Could not share it. Show the code instead.');
  });
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
  const roles = usePlainRoles(ctx);
  const [choice, setChoice] = useState<string>('translate');
  const [others, setOthers] = useState(false);
  const [scopeKey, setScopeKey] = useState(props.initialScope);
  const [shown, setShown] = useState(false);
  const scope = props.scopes.find((s) => s.key === scopeKey) ?? props.scopes[0] ?? null;
  const roleId = roles.choices.find((c) => c.id === choice)?.roleId ?? roles.others.find((r) => r.id === choice)?.id ?? null;
  const invite = useGroupInvite(ctx.language.orgId, shown ? roleId : null, shown && scope ? scope.scope : null, scope ? props.label(scope) : '');
  const uri = invite && 'uri' in invite ? invite.uri : null;
  const what = roles.choices.find((c) => c.id === choice)?.label ?? roles.others.find((r) => r.id === choice)?.name ?? '';

  if (shown) {
    return (
      <Screen header={props.header(true, () => setShown(false), scope)} bodyStyle={{ paddingHorizontal: 20, gap: 14 }}
        footer={<>
          <PrimaryBtn label="Done" icon="check" onPress={props.onDone} />
          <QuietLinks items={[
            ...(uri ? [{ label: 'Share as a link', icon: 'send' as const, onPress: () => shareInvite(ctx, uri) }] : []),
            { label: 'Someone else', icon: 'arrowL' as const, onPress: () => setShown(false) }
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
        <PrimaryBtn label="Show the code to scan" icon="qr" disabled={!roleId || !scope || !!props.disabled} onPress={() => setShown(true)} />
        {props.links ? <QuietLinks items={props.links(roleId, scope)} /> : null}
      </>}>
      <Question>What will they do?</Question>
      {roles.choices.map((c) => (
        <RadioRow key={c.id} tile icon={c.icon as IconName} label={c.label} on={choice === c.id} onPress={() => setChoice(c.id)} />
      ))}
      {roles.others.length ? (others ? roles.others.map((r) => (
        <RadioRow key={r.id} tile icon="star" label={r.name} on={choice === r.id} onPress={() => setChoice(r.id)} />
      )) : <QuietLink icon="down" label={`Other roles · ${roles.others.length}`} onPress={() => setOthers(true)} />) : null}
      {props.onNewRole ? <DashedRow icon="plus" label="Something else: make a new role" onPress={props.onNewRole} /> : null}
      {props.scopes.length > 1 ? (
        <>
          <SectionLabel label="In which language?" />
          <Pills>{props.scopes.map((s) => <Chip key={s.key} label={s.label} on={scopeKey === s.key} onPress={() => setScopeKey(s.key)} />)}</Pills>
        </>
      ) : null}
      {props.disabled ? <Text style={[txt.sm, { color: C.muted, paddingHorizontal: space.xs }]}>{props.disabled}</Text> : null}
    </Screen>
  );
}
