// Clusters on screen (decision 108, demo ADR-045): a cluster's tile and row
// (amber, so it never reads as a language), and a language's Cluster row,
// which opens the clusters it is in to change them. The model is
// clusters/model.ts; the cluster's own page is ClusterHome (screens/org.tsx).
import { clustersOf, mayManageClusters, orgClusters, type ClusterInfo } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useRef, useState } from 'react';
import { View } from 'react-native';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { Field, PrimaryBtn, Row, Sheet } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { failureMessage } from '../diagnostics/report';
import { CheckRow, IconTile } from '../admin/admin';
import { Text } from '../ui/text';
import { TINT } from '../ui/theme';
import { clusterEvents, clusterNamed, newClusterId, type ClusterEvent } from './model';
import { clusterSub, appendClusterEvents } from './clusterActions';
import { SavedMark } from '../ui/SavedMark';
import { useSaver } from '../ui/useSaveStatus';

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
 * The clusters a language is in, on its page (More): a row that whoever may
 * group the organization's languages opens into the clusters as
 * checkboxes, with a new one by name. Someone who may not sees the row only
 * when the language is in one. A tick applies at once and a new name when
 * the person leaves the field or closes the sheet, with the saved mark
 * (decision 111).
 */
export function LanguageClustersRow(props: { ctx: Ctx; languageId: string; language: string; last?: boolean }) {
  const { ctx, languageId } = props;
  const org = ctx.org.state;
  const may = mayManageClusters(org, ctx.session.actorId);
  const mine = clustersOf(org, languageId);
  const all = orgClusters(org);
  const [open, setOpen] = useState(false);
  // What was ticked while its write is on its way, so the tick shows at once.
  const [ticked, setTicked] = useState<Map<string, boolean>>(new Map());
  const [fresh, setFresh] = useState('');
  const [error, setError] = useState('');
  const saver = useSaver();
  // The mark is about this opening: what was kept since the sheet opened.
  const [marked, setMarked] = useState(false);
  const writing = useRef<Promise<boolean>>(Promise.resolve(true));
  const latest = useRef(new Map<string, number>());
  // The new name last sent: leaving the field and closing the sheet make it once.
  const sentFresh = useRef('');
  if (!may && mine.length === 0) return null;
  const sub = mine.length ? mine.map((c) => c.name).join(t('admin.list.separator')) : t('clusters.language.none');
  const isIn = (clusterId: string) => ticked.get(clusterId) ?? mine.some((c) => c.clusterId === clusterId);
  const start = () => { setTicked(new Map()); setFresh(''); setError(''); setMarked(false); sentFresh.current = ''; setOpen(true); };
  /** Writes one change after the one before it, so ticks land in the order they were made. */
  function write(events: () => ClusterEvent[]): Promise<boolean> {
    setMarked(true);
    const next = writing.current.then(() => saver.run(async () => {
      try { await appendClusterEvents(ctx, events()); } catch (e) { setError(failureMessage('language clusters', e)); throw e; }
      return true;
    })).then((ok) => ok === true);
    writing.current = next;
    return next;
  }
  function tick(clusterId: string) {
    const on = !isIn(clusterId);
    const n = (latest.current.get(clusterId) ?? 0) + 1;
    latest.current.set(clusterId, n);
    setTicked((cur) => new Map(cur).set(clusterId, on));
    setError('');
    // Written whatever the record says now, so a quick second tap is never lost behind the first.
    void write(() => [{ type: 'v1.LanguageClusterSet', payload: { languageId, clusterId, inCluster: on } }]).then(() => {
      // Then shown as the record has it (ticked once kept, as it was if not), unless it was tapped again since.
      if (latest.current.get(clusterId) === n) setTicked((cur) => { const next = new Map(cur); next.delete(clusterId); return next; });
    });
  }
  /** The name typed below: a new cluster by that name with this language in it, or the one the organization already calls that. */
  function addFresh(): Promise<boolean> {
    const name = fresh.trim();
    if (!name || name === sentFresh.current) return Promise.resolve(true);
    sentFresh.current = name;
    setFresh('');
    setError('');
    return write(() => {
      const now = ctx.org.state;
      const same = clusterNamed(now, name);
      const clusterId = same?.clusterId ?? newClusterId(name, Crypto.randomUUID());
      return clusterEvents(now, { clusterId, ...(same ? {} : { name }), add: [languageId] });
    }).then((ok) => { if (!ok) { sentFresh.current = ''; setFresh(name); } return ok; });
  }
  const close = () => { void addFresh().then((ok) => { if (ok) setOpen(false); }); };
  return (
    <>
      <Row leading={<ClusterTile size={40} />} label={t('clusters.language.label')} sub={sub} last={!!props.last} testID="language-clusters"
        help={t('clusters.language.rowHelp')} {...(may ? { onPress: start } : {})} />
      <Sheet visible={open} title={t('clusters.language.sheetTitle')} sub={props.language} onClose={close} action={<SavedMark status={marked ? saver.status : 'idle'} />}
        footer={<PrimaryBtn label={t('clusters.language.done')} icon="check" help={t('clusters.language.doneHelp')} onPress={close} />}>
        {all.length ? (
          <View>
            {all.map((c, i) => (
              <CheckRow key={c.clusterId} label={c.name} sub={t('clusters.language.count', { count: c.languageIds.length })} checked={isIn(c.clusterId)}
                last={i === all.length - 1} detail={isIn(c.clusterId) ? t('clusters.language.inHelp') : t('clusters.language.outHelp')}
                onToggle={() => tick(c.clusterId)} />
            ))}
          </View>
        ) : null}
        <Field label={all.length ? t('clusters.language.newLabel') : t('clusters.language.firstLabel')} value={fresh} onChangeText={setFresh}
          placeholder={t('clusters.newLanguage.clusterPlaceholder')} autoCapitalize="words" help={t('clusters.language.newHelp')} onSubmit={() => void addFresh()}
          onBlur={() => void addFresh()} />
        <Text style={txt.smMuted}>{t('clusters.language.note')}</Text>
        {error ? <Text style={[txt.sm, { color: TINT.amberText }]}>{error}</Text> : null}
      </Sheet>
    </>
  );
}
