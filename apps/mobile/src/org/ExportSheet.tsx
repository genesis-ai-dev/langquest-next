// Export all data (decisions.md 205, docs/org-export.md): an organization admin chooses the whole organization or
// some languages, and gets one zip made on the server: recordings in folders, a list of every recording, progress
// sheets and the full record. It shows how far the zip is and a Download when it is ready.
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { t } from '../i18n';
import { formatBytes, formatDay } from '../i18n/format';
import { Banner, PrimaryBtn, ProgressBar, Row, Sheet, SmallBtn } from '../ui/kit';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { C, space } from '../ui/theme';
import { fraction, isOpen, lineOf, type ExportItem } from './exportModel';
import { exportLink, listExports, startExport } from './orgExports';

const POLL_MS = 4000;

function say(e: ExportItem): string {
  const line = lineOf(e);
  switch (line.key) {
    case 'orgExport.audio': return t('orgExport.audio', { done: line.done, total: line.total });
    case 'orgExport.waiting': return t('orgExport.waiting');
    case 'orgExport.reading': return t('orgExport.reading');
    case 'orgExport.log': return t('orgExport.log');
    case 'orgExport.ready': return t('orgExport.ready');
    case 'orgExport.failed': return t('orgExport.failed');
    case 'orgExport.expired': return t('orgExport.expired');
  }
}

export function ExportSheet(props: {
  visible: boolean;
  onClose: () => void;
  orgId: string;
  languages: { id: string; name: string }[];
  toast: (message: string, tone?: 'problem') => void;
}) {
  const { visible, orgId } = props;
  const [items, setItems] = useState<ExportItem[]>([]);
  const [all, setAll] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try { setItems(await listExports(orgId)); } catch { /* the next look tries again */ }
  }, [orgId]);
  const open = isOpen(items[0]);
  useEffect(() => {
    if (!visible) return undefined;
    void refresh();
    if (!open) return undefined;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [visible, open, refresh]);
  const ids = all ? null : props.languages.filter((l) => picked.has(l.id)).map((l) => l.id);
  async function start() {
    setBusy(true);
    try {
      await startExport(orgId, ids);
      props.toast(t('orgExport.started'));
      await refresh();
    } catch {
      props.toast(t('orgExport.problem'), 'problem');
    } finally {
      setBusy(false);
    }
  }
  async function download(id: string) {
    try {
      window.open(await exportLink(orgId, id), '_self');
    } catch {
      props.toast(t('orgExport.problem'), 'problem');
    }
  }
  const footer = <PrimaryBtn label={t('orgExport.start')} disabled={busy || open || (ids !== null && ids.length === 0)} onPress={() => void start()} />;
  return (
    <Sheet visible={visible} title={t('orgExport.title')} sub={t('orgExport.sub')} onClose={props.onClose} footer={footer}>
      <View style={{ gap: space.sm }}>
        <Row testID="export-whole" role="radio" selected={all} icon="globe" label={t('orgExport.whole')} help={t('orgExport.wholeHelp')} onPress={() => setAll(true)} />
        <Row testID="export-some" role="radio" selected={!all} icon="folder" label={t('orgExport.some')} help={t('orgExport.someHelp')} onPress={() => setAll(false)} last={all} />
        {/* help-each: each row is one language to include */}
        {all ? null : props.languages.map((l, i) => (
          <Row key={l.id} testID={`export-language-${l.id}`} role="checkbox" checked={picked.has(l.id)} label={l.name} help={t('orgExport.languageHelp')} last={i === props.languages.length - 1}
            onPress={() => setPicked((p) => { const n = new Set(p); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })} />
        ))}
        {/* help-each: each row is one export, with its own Download */}
        {items.slice(0, 3).map((e) => {
          const f = fraction(e);
          return (
            <View key={e.id} testID={`export-${e.status}`} style={{ gap: 4 }}>
              <Row icon="download" label={say(e)} sub={`${formatDay(e.createdAt)}${e.sizeBytes ? ` · ${formatBytes(e.sizeBytes)}` : ''}`}
                right={e.status === 'ready' ? <SmallBtn label={t('orgExport.download')} icon="download" help={t('orgExport.downloadHelp')} onPress={() => void download(e.id)} /> : undefined}
                below={f === null ? undefined : <ProgressBar value={f} />} last />
            </View>
          );
        })}
        <Banner icon="flag" tone="brand" title={t('orgExport.keep')} />
      </View>
    </Sheet>
  );
}
