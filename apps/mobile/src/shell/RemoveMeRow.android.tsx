// More settings › Remove me from this phone (docs/nearby-sync-plan.md 14.1, 5 "Me"): someone let
// in offline has no Sign out and no Delete account until first contact, so this takes their
// place. It asks first, naming the work not yet sent from this phone, then forgets the person,
// the install key and the nearby records it signed (removeLocalPerson.android.ts), and the app
// is back at Sign In. A refusal at first contact that lasts (taken, deleted, chain, proof, a lost
// key) would otherwise leave the phone theirs for good.
import { useState } from 'react';
import { View } from 'react-native';
import { useUnsent } from '../account/useUnsent';
import { failureMessage } from '../diagnostics/report';
import { t } from '../i18n';
import { removeLocalPerson } from '../nearby/removeLocalPerson';
import { ConfirmDelete } from '../ui/ConfirmDelete';
import { Group, Row } from '../ui/kit';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { space, TINT } from '../ui/theme';
import type { Ctx } from './ctx';

export function RemoveMeRow(props: { ctx: Ctx; name: string }) {
  const { ctx } = props;
  const waiting = useUnsent(ctx);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      // Once the record goes, nobody holds the phone and the app routes to Sign In by itself.
      await removeLocalPerson(ctx.session.actorId);
    } catch (e) {
      setBusy(false);
      ctx.toast(failureMessage('remove me from this phone', e), 'problem');
    }
  }
  return (
    <>
      <Group>
        <Row icon="trash" iconColor={TINT.redText} iconBg={TINT.red} label={t('account.more.removeMe')} sub={t('account.more.removeMeSub')}
          help={t('account.more.removeMeHelp')} onPress={() => setAsking(true)} last />
      </Group>
      <ConfirmDelete visible={asking} name={props.name} title={t('account.more.removeMeTitle', { name: props.name })}
        confirmLabel={busy ? t('account.more.removing') : t('account.more.removeMeButton')} busy={busy}
        onConfirm={() => void remove()} onClose={() => { if (!busy) setAsking(false); }}>
        <View style={{ gap: space.sm }}>
          {waiting.length > 0 ? (
            <Text style={[txt.body, { color: TINT.amberText }]}>{t('account.more.removeMeUnsent', { things: waiting.join(', ') })}</Text>
          ) : null}
          <Text style={txt.bodyMuted}>{t('account.more.removeMeBody')}</Text>
        </View>
      </ConfirmDelete>
    </>
  );
}
