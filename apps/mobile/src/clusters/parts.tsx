// Clusters on screen (decision 108, demo ADR-045): a cluster's tile and row
// (amber, so it never reads as a language), and a language's cluster chip
// under its page's title, which opens the clusters it is in to change them. The model is
// clusters/model.ts; the cluster's own page is ClusterHome (screens/org.tsx).
import { clustersOf, mayManageClusters, orgClusters, type ClusterInfo } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { Field, Ico, PrimaryBtn, Row, Sheet } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { failureMessage } from '../diagnostics/report';
import { CheckRow, IconTile } from '../admin/admin';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { Text } from '../ui/text';
import { radius, space, TINT, type as T } from '../ui/theme';
import { clusterEvents, clusterNamed, newClusterId, type ClusterEvent } from './model';
import { clusterSub, appendClusterEvents } from './clusterActions';

/** A cluster's tile: layers, in amber. */
export function ClusterTile(props: { size?: number }) {
  return <IconTile icon="layers" size={props.size ?? 44} bg={TINT.amber} color={TINT.amberText} />;
}

/** A cluster as a row of the organization's languages: tapping it opens its page. */
export function ClusterRow(props: { ctx: Ctx; c: ClusterInfo; current?: boolean; last?: boolean }) {
  const { ctx, c } = props;
  return (
    <Row leading={<ClusterTile />} label={c.name} sub={clusterSub(ctx.org.state, c)} current={!!props.current} last={!!props.last}
      testID={`cluster-${c.clusterId}`} help={t('clusters.row.openHelp')} onPress={() => ctx.go('cluster_home', { clusterId: c.clusterId })} />
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
      <Pressable testID="language-clusters" onPress={spot.onPress} disabled={!spot.onPress} accessibilityRole="button" accessibilityLabel={label}
        style={({ pressed }) => [styles.chip, pressed && { opacity: 0.75 }]}>
        <Ico name={mine.length ? 'layers' : 'plus'} size={16} color={TINT.amberText} />
        <Text style={styles.chipText} numberOfLines={2}>{label}</Text>
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
  chip: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', minHeight: 32, marginTop: space.xs,
    paddingHorizontal: space.md, borderRadius: radius.full, backgroundColor: TINT.amber },
  chipText: { flexShrink: 1, fontSize: T.sm, fontWeight: '700', color: TINT.amberText }
});
