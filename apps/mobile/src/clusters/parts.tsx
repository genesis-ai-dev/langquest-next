// Clusters on screen (decision 108, demo ADR-045): the groups the
// organization's home lists its languages in, a cluster's tile (amber, so it
// never reads as a language), and a language's cluster chip under its page's
// title, which opens the clusters it is in to change them. The model is
// clusters/model.ts; the cluster's own page is ClusterHome (screens/org.tsx).
import { clustersOf, mayManageClusters, orgClusters } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { Field, Group, Ico, PrimaryBtn, Sheet } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { failureMessage } from '../diagnostics/report';
import { CheckRow, IconTile } from '../admin/admin';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { Text } from '../ui/text';
import { C, radius, space, target, TINT, type as T } from '../ui/theme';
import { clusterEvents, clusterNamed, newClusterId, type ClusterEvent, type LanguageGroup } from './model';
import { appendClusterEvents } from './clusterActions';

/** A cluster's tile: layers, in amber. */
export function ClusterTile(props: { size?: number }) {
  return <IconTile icon="layers" size={props.size ?? 44} bg={TINT.amber} color={TINT.amberText} />;
}

/**
 * One group of the organization's languages on its home (decision 108,
 * amended 2026-10-20): a heading in the group's colour (amber for a
 * cluster, grey for the languages in none) with its name and count, which
 * folds its rows away and back, and, for a cluster, a ⋯ that opens the
 * cluster's page. Its rows are the children.
 */
export function LanguageGroupCard(props: { group: LanguageGroup; open: boolean; onToggle: () => void; onOpenCluster?: () => void; current?: boolean; children: ReactNode }) {
  const { group } = props;
  const cluster = group.kind === 'cluster';
  const title = cluster ? group.name : t('clusters.status.none');
  const count = group.languageIds.length;
  const toggle = useHelpSpot(title, cluster ? t('org.home.clusterGroupHelp') : t('org.home.looseGroupHelp'), props.onToggle);
  const open = useHelpSpot(t('org.home.openCluster', { cluster: title }), t('org.home.openClusterHelp'), props.onOpenCluster);
  const [bg, fg] = cluster ? [TINT.amber, TINT.amberText] : [TINT.gray, TINT.grayText];
  return (
    <Group style={props.current ? styles.groupCurrent : undefined}>
      <View style={[styles.head, { backgroundColor: bg }, props.open && styles.headOpen]}>
        <Pressable testID={`language-group-${group.key}`} onPress={toggle.onPress} accessibilityRole="button" accessibilityState={{ expanded: props.open }}
          // The web reads only aria-*: whether its languages show.
          aria-expanded={props.open}
          accessibilityLabel={t('shell.a11y.labelDetail', { label: title, detail: t('clusters.language.count', { count }) })}
          accessibilityHint={props.open ? t('shell.kit.hidesDetails') : t('shell.kit.showsDetails')}
          style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}>
          <Ico name={props.open ? 'down' : 'right'} size={22} color={fg} />
          <Text style={styles.title}>{title}</Text>
          <View style={styles.count}><Text style={[txt.xsStrong, { color: fg }]}>{formatNumber(count)}</Text></View>
          <HelpBadge spot={toggle} inset />
        </Pressable>
        {props.onOpenCluster ? (
          <Pressable testID={`language-group-open-${group.key}`} onPress={open.onPress} accessibilityRole="button" accessibilityLabel={t('org.home.openCluster', { cluster: title })}
            style={({ pressed }) => [styles.more, pressed && styles.pressed]}>
            <Ico name="more" size={24} color={fg} />
            <HelpBadge spot={open} />
          </Pressable>
        ) : null}
      </View>
      {props.open ? props.children : null}
    </Group>
  );
}

/**
 * The clusters a language is in, under its page's title: a chip that
 * whoever may group the organization's languages opens into the clusters
 * as checkboxes, with a new one by name. Someone who may not sees the chip
 * only when the language is in one.
 */
export function LanguageClustersChip(props: { ctx: Ctx; languageId: string; language: string }) {
  const { ctx, languageId } = props;
  const org = ctx.org.state;
  const may = mayManageClusters(org, ctx.session.actorId);
  const mine = clustersOf(org, languageId);
  const all = orgClusters(org);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [fresh, setFresh] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const start = () => { setPicked(new Set(mine.map((c) => c.clusterId))); setFresh(''); setError(''); setOpen(true); };
  const label = mine.length ? mine.map((c) => c.name).join(t('admin.list.separator')) : t('clusters.language.add');
  const spot = useHelpSpot(label, may ? t('clusters.language.rowHelp') : t('clusters.language.chipHelp'), may ? start : undefined);
  if (!may && mine.length === 0) return null;
  async function save() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const events: ClusterEvent[] = [];
      for (const c of all) {
        const on = picked.has(c.clusterId);
        events.push(...clusterEvents(org, { clusterId: c.clusterId, ...(on ? { add: [languageId] } : { remove: [languageId] }) }));
      }
      const name = fresh.trim();
      if (name) {
        // A name the organization already uses joins that cluster rather than making a second one.
        const same = clusterNamed(org, name);
        const clusterId = same?.clusterId ?? newClusterId(name, Crypto.randomUUID());
        events.push(...clusterEvents(org, { clusterId, ...(same ? {} : { name }), add: [languageId] }));
      }
      await appendClusterEvents(ctx, events);
      setOpen(false);
      if (events.length) ctx.toast(t('clusters.language.saved', { language: props.language }));
    } catch (e) {
      setError(failureMessage('language clusters', e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {/* The pill is drawn small; the tap target around it is 48 high (A11Y-009). */}
      <Pressable testID="language-clusters" onPress={spot.onPress} disabled={!spot.onPress} accessibilityRole="button" accessibilityLabel={label}
        style={({ pressed }) => [styles.chipTarget, pressed && { opacity: 0.75 }]}>
        <View style={styles.chip}>
          <Ico name={mine.length ? 'layers' : 'plus'} size={16} color={TINT.amberText} />
          <Text style={styles.chipText} numberOfLines={2}>{label}</Text>
        </View>
        <HelpBadge spot={spot} />
      </Pressable>
      <Sheet visible={open} title={t('clusters.language.sheetTitle')} sub={props.language} onClose={() => setOpen(false)}
        footer={<PrimaryBtn label={t('clusters.language.done')} icon="check" busy={busy} help={t('clusters.language.doneHelp')} onPress={() => void save()} />}>
        {all.length ? (
          <View>
            {all.map((c, i) => (
              <HelpRow key={c.clusterId} of="clusters.cluster">
                <CheckRow label={c.name} sub={t('clusters.language.count', { count: c.languageIds.length })} checked={picked.has(c.clusterId)}
                  last={i === all.length - 1} detail={picked.has(c.clusterId) ? t('clusters.language.inHelp') : t('clusters.language.outHelp')}
                  onToggle={() => setPicked((cur) => { const next = new Set(cur); if (next.has(c.clusterId)) next.delete(c.clusterId); else next.add(c.clusterId); return next; })} />
              </HelpRow>
            ))}
          </View>
        ) : null}
        <Field label={all.length ? t('clusters.language.newLabel') : t('clusters.language.firstLabel')} value={fresh} onChangeText={setFresh}
          placeholder={t('clusters.newLanguage.clusterPlaceholder')} autoCapitalize="words" help={t('clusters.language.newHelp')} />
        {error ? <Text style={[txt.sm, { color: TINT.amberText }]}>{error}</Text> : null}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', minHeight: target.primary, paddingEnd: space.xs },
  headOpen: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  toggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: target.primary, paddingVertical: space.sm, paddingStart: space.lg, paddingEnd: space.sm },
  title: { flexShrink: 1, fontSize: T.base, fontWeight: '700', color: C.dark },
  count: { minWidth: 28, paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.full, backgroundColor: C.card, alignItems: 'center' },
  more: { width: target.min, height: target.min, alignItems: 'center', justifyContent: 'center', borderRadius: radius.full },
  pressed: { opacity: 0.7 },
  groupCurrent: { borderColor: C.primary, borderWidth: 2 },
  chipTarget: { alignSelf: 'flex-start', minHeight: target.min, justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 32, paddingHorizontal: space.md, borderRadius: radius.full, backgroundColor: TINT.amber },
  chipText: { flexShrink: 1, fontSize: T.sm, fontWeight: '700', color: TINT.amberText }
});
