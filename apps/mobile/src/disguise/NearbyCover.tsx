import { View } from 'react-native';
import { t } from '../i18n';
import type { NearbyActions, NearbyView } from '../nearby/nearbyRunModel';
import { Card, PrimaryBtn } from '../ui/kit';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { space, TINT } from '../ui/theme';
import './disguiseWords';

/**
 * Share nearby on a phone that wears a cover (docs/nearby-sync-plan.md 5.8, Carl's answer 15;
 * decisions.md 171 as amended). Opening the screen does nothing: this line and a 56 pt "Start
 * sharing" wait for a press, whose words never name the cover. The first press, and any later one
 * that would bring Android's questions, shows one warning first. A stop says why: ten minutes, up
 * to date, or leaving the app, after which only a new press starts it again. The screen hands in
 * the line for a stop every phone can have (`stopLine`).
 */
export function NearbyCover(props: { view: NearbyView; actions: NearbyActions; stopLine: string | null }) {
  const { view, actions } = props;
  if (!view.worn) return null;
  if (!view.needsPress && view.permissions.step.t === 'warn') {
    return (
      <Card>
        <Text style={[txt.body, { color: TINT.amberText, fontWeight: '700' }]}>{t('disguise.nearby.warning')}</Text>
        <PrimaryBtn label={t('disguise.nearby.warned')} help={t('disguise.nearby.warnedHelp')} icon="arrowR" onPress={actions.warned} />
      </Card>
    );
  }
  const why = view.stopped === 'left' ? t('disguise.nearby.left') : view.stopped === 'run' ? t('disguise.nearby.run')
    : view.stopped === 'level' ? t('disguise.nearby.level') : props.stopLine;
  return (
    <Card>
      <View style={{ gap: space.sm }}>
        {why ? <Text style={[txt.body, { fontWeight: '700' }]}>{why}</Text> : null}
        <Text style={txt.sm}>{t('disguise.nearby.startLine')}</Text>
      </View>
      <PrimaryBtn label={t('disguise.nearby.start')} help={t('disguise.nearby.startHelp')} icon="swap" onPress={actions.press} />
    </Card>
  );
}
