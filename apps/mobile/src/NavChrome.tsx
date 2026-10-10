// The tabs (NAV-1) in the shape the window calls for (decisions.md 55): the
// demo's bottom bar on a phone, an icon rail down the left on a tablet-wide
// window, and a labelled sidebar with the organization on a desktop-wide one.
// The same tabs, badges and lit tab in each; only the layout changes.
// The simple redesign's tabs (decision 71, demo ADR-032): Work (a list), Map
// (a book), Manage (the gear), Me (a person).
import { Book } from 'lucide-react-native';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from './i18n';
import { formatNumber } from './i18n/format';
import { Badge, Ico, txt, type IconName } from './kit';
import type { Tab, TabId } from './session';
import { C, measure, radius, space, target } from './theme';
import { UserChip } from './UserChip';

const TAB_ICONS: Record<TabId, IconName | 'bookClosed'> = { work: 'list', map: 'bookClosed', reports: 'progress', manage: 'settings', inbox: 'notif', me: 'user' };

/** A tab's badge: its count, or 99+ past that. */
function badgeText(n: number): string {
  return n > 99 ? t('shell.nav.badgeMax', { max: 99 }) : formatNumber(n);
}

/** A tab as a screen reader says it: its name, and its count when it has one. */
function tabLabel(tab: Tab): string {
  return tab.badge ? t('shell.nav.tabBadge', { tab: tab.label, badge: tab.badge }) : tab.label;
}

/** A tab's icon: the kit's, or the closed book the Map tab reads by. */
function TabIcon(props: { id: TabId; size: number; color: string }) {
  const name = TAB_ICONS[props.id];
  if (name === 'bookClosed') return <Book size={props.size} color={props.color} strokeWidth={2.2} />;
  return <Ico name={name} size={props.size} color={props.color} />;
}

export function NavChrome(props: {
  variant: 'bar' | 'rail' | 'sidebar';
  tabs: Tab[];
  active: TabId;
  onSelect: (tab: Tab) => void;
  orgName?: string;
  actorId?: string;
}) {
  if (props.variant === 'sidebar') {
    return (
      <View style={styles.sidebar}>
        <View style={styles.sidebarHead}>
          {props.orgName ? <Text style={txt.h3} numberOfLines={2}>{props.orgName}</Text> : null}
          {props.actorId ? <View style={{ alignSelf: 'flex-start' }}><UserChip id={props.actorId} /></View> : null}
        </View>
        {/* Only the tabs are in the tab list; the account chip beside them is a button of its own. */}
        <View accessibilityRole="tablist" style={{ gap: 2 }}>
        {props.tabs.map((tab) => {
          const active = tab.id === props.active;
          const color = active ? C.primary : C.dark;
          return (
            <Pressable key={tab.id} onPress={() => props.onSelect(tab)} accessibilityRole="tab"
              accessibilityLabel={tabLabel(tab)} accessibilityState={{ selected: active }}
              style={({ pressed }) => [styles.sideItem, active && { backgroundColor: C.light }, pressed && { opacity: 0.6 }]}>
              <TabIcon id={tab.id} size={22} color={active ? C.primary : C.muted} />
              <Text style={[txt.body, { flex: 1, fontWeight: active ? '700' : '600', color }]} numberOfLines={1}>{tab.label}</Text>
              {tab.badge ? <Badge label={badgeText(tab.badge)} tone={tab.id === 'inbox' ? 'red' : 'brand'} /> : null}
            </Pressable>
          );
        })}
        </View>
        {/* The web app only: the language explorer, a page of its own (docs/languoids.md). */}
        {Platform.OS === 'web' ? (
          <Pressable onPress={() => window.open('/languages', '_blank', 'noopener')} accessibilityRole="link"
            accessibilityLabel={t('shell.nav.languageExplorerNewTab')}
            style={({ pressed }) => [styles.sideItem, { marginTop: space.md }, pressed && { opacity: 0.6 }]}>
            <Ico name="globe" size={22} color={C.muted} />
            <Text style={[txt.body, { flex: 1, fontWeight: '600', color: C.dark }]} numberOfLines={1}>{t('shell.nav.languageExplorer')}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  const rail = props.variant === 'rail';
  return (
    <View style={rail ? styles.rail : styles.tabs} accessibilityRole="tablist">
      {props.tabs.map((tab) => {
        const active = tab.id === props.active;
        const color = active ? C.primary : C.muted;
        return (
          <Pressable
            key={tab.id}
            onPress={() => props.onSelect(tab)}
            accessibilityRole="tab"
            accessibilityLabel={tabLabel(tab)}
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [rail ? styles.railItem : styles.tab, pressed && { opacity: 0.6 }]}
          >
            {/* The lit tab is its colour, with no pill behind it (demo ADR-032); the rail keeps the pill. */}
            <View style={[styles.tabPill, rail && active && { backgroundColor: C.light }]}>
              <TabIcon id={tab.id} size={26} color={color} />
              {tab.badge ? (
                <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{badgeText(tab.badge)}</Text></View>
              ) : null}
            </View>
            <Text style={[styles.tabLabel, { color }]} numberOfLines={1}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border, backgroundColor: C.card, paddingHorizontal: space.sm, paddingBottom: space.xs },
  tab: { flex: 1, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 4, paddingTop: space.sm },
  tabPill: { paddingHorizontal: 18, paddingVertical: 4, borderRadius: 99 },
  tabLabel: { fontSize: 13, fontWeight: '600' },
  tabBadge: { position: 'absolute', top: -4, right: 6, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 4, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' },
  tabBadgeText: { color: C.white, fontSize: 13, fontWeight: '800' },
  rail: { width: measure.rail, backgroundColor: C.card, borderRightWidth: StyleSheet.hairlineWidth, borderColor: C.border, paddingTop: space.md, gap: space.xs },
  railItem: { minHeight: target.row, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: space.xs },
  sidebar: { width: measure.sidebar, backgroundColor: C.card, borderRightWidth: StyleSheet.hairlineWidth, borderColor: C.border, paddingHorizontal: space.md, paddingTop: space.lg, gap: space.xs },
  sidebarHead: { gap: space.sm, paddingHorizontal: space.sm, paddingBottom: space.lg, marginBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  sideItem: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.min, paddingHorizontal: space.md, borderRadius: radius.md }
});
