import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import { Badge, Card, Ico, type IconName } from '../ui/kit';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { C, space } from '../ui/theme';

/**
 * The card at the top of each nearby screen: what the screen is for, in one line beside its icon,
 * with the Experimental badge (docs/nearby-sync-plan.md 5.10). It does not repeat the screen's
 * title, which the header above it already says (Carl, 2026-11-19). `children` are the lines
 * that belong with it: a link, a size, a cover's note.
 */
export function NearbyIntro(props: { icon: IconName; text: string; children?: ReactNode }) {
  return (
    <Card>
      <View style={styles.head}>
        <Ico name={props.icon} size={22} color={C.primary} />
        <Text style={[txt.sm, { flex: 1 }]}>{props.text}</Text>
        <Badge label={t('nearby.experimental')} tone="amber" />
      </View>
      {props.children}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md }
});
