import { View } from 'react-native';
import { t } from '../i18n';
import { useNearbyOffered } from '../nearby/useNearby';
import { WHY_NOT_WORDS } from '../nearby/shareNearbyModel';
import { Card, Group, Ico, Row } from '../ui/kit';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { space, TINT } from '../ui/theme';
import type { Ctx } from './ctx';

/**
 * Share nearby on the Sync screen (docs/nearby-sync-plan.md 5.8, 5.10): shown once this phone
 * holds a certificate for the organization and a discovery key for the language, labelled
 * experimental. Below Android 10, or without Bluetooth LE or Wi-Fi Direct, it is disabled with a
 * line saying why, and keeps its `onPress` so help mode can explain it (Carl's answer 7). A
 * batch stamped far ahead names its author here too (5.4), whether or not the row shows.
 */
export function NearbyRow(props: { ctx: Ctx }) {
  const { ctx } = props;
  const { offered, whyNot } = useNearbyOffered(ctx);
  const farAhead = farAheadOf(ctx);
  return (
    <>
      {offered ? (
        <Group>
          <Row icon="swap" label={t('nearby.row')} sub={whyNot ? t(WHY_NOT_WORDS[whyNot]) : t('nearby.rowSub')} help={t('nearby.rowHelp')}
            badge={t('nearby.experimental')} badgeTone="amber" disabled={whyNot !== null} muted={whyNot !== null}
            onPress={() => ctx.go('share_nearby')} last />
        </Group>
      ) : null}
      {farAhead.length > 0 ? (
        <Card>
          {farAhead.map((actorId) => (
            <View key={actorId} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Ico name="warning" size={20} color={TINT.amberText} />
              <Text style={[txt.sm, { flex: 1 }]}>{t('nearby.farAhead', { name: ctx.name(actorId) })}</Text>
            </View>
          ))}
        </Card>
      ) : null}
    </>
  );
}

/** Authors of batches stamped far ahead, once each, from the open language's client. */
function farAheadOf(ctx: Ctx): string[] {
  try {
    return [...new Set((ctx.language.nearby()?.client.nearbyFarAhead ?? []).map((f) => f.actorId))];
  } catch {
    return [];
  }
}
