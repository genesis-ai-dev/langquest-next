import { Pressable, StyleSheet } from 'react-native';
import { HelpBadge } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { t } from '../i18n';
import { Ico } from '../ui/kit';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { C, space } from '../ui/theme';
import { useLayout } from '../ui/useLayout';

/**
 * In every header of an organization a Global Viewer is looking in on
 * (decisions.md 158): where they are, and the way to another. An eye; the
 * eye and "Global Viewer" only where the header's own box is a tablet's
 * width or more, so never on a phone or in a split's narrow list pane,
 * whose title the words would leave a sliver.
 */
export function GlobalViewerLink(props: { orgName: string; onPress: () => void }) {
  const wide = useLayout().contentWidth >= 768;
  const label = props.orgName ? t('globalViewer.viewingOrg', { org: props.orgName }) : t('globalViewer.title');
  const spot = useHelpSpot(t('globalViewer.title'), t('globalViewer.linkHelp'), props.onPress);
  return (
    <Pressable testID="global-viewer-link" onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [wide ? styles.pill : styles.round, pressed && { opacity: 0.7 }]}>
      <Ico name="eye" size={20} color={C.primary} />
      {wide ? <Text style={[txt.sm, styles.words]} numberOfLines={1}>{t('globalViewer.title')}</Text> : null}
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  round: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  pill: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 48, paddingHorizontal: space.md, borderRadius: 24, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  words: { color: C.primary, fontWeight: '700' }
});
