import { Pressable, StyleSheet } from 'react-native';
import { HelpBadge } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { t } from '../i18n';
import { Ico } from '../ui/kit';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { C, space } from '../ui/theme';
import { useLayout } from '../ui/useLayout';

/** Narrower than this, a header has no room for the words beside its title, Back and its own buttons. */
const WORDED_MIN = 600;

/**
 * In every header of an organization a Global Viewer is looking in on
 * (decisions.md 158): where they are, and the way to another. An eye; the
 * eye and "Global Viewer" where the header's own box is wide, never in a
 * split's narrow list pane, whose title would be left a sliver.
 */
export function GlobalViewerLink(props: { orgName: string; onPress: () => void }) {
  const layout = useLayout();
  const wide = layout.kind !== 'phone' && layout.role !== 'list' && layout.contentWidth >= WORDED_MIN;
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
