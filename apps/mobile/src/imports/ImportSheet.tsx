// Importing the organization's own material (decisions.md 173), from
// Reference Material: an admin chooses what to bring in from where the
// organization keeps it, LangQuest builds it on its server, and the admin
// publishes what it made, shared for other organizations to follow.
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { CheckRow } from '../admin/admin';
import { HelpRow } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { Banner, Group, LinkBtn, PrimaryBtn, ProgressBar, Row, SectionLabel, Sheet } from '../ui/kit';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { C, space } from '../ui/theme';
import { fiaLanguageChoices, importerName, importLanguageName, isOpen, type Importer, type ImportRun } from './model';
import type { PublishAnswer, StartAnswer } from './useImports';

export interface ImportActions {
  start: (importer: string, languages: string[]) => Promise<StartAnswer>;
  stop: (runId: string) => Promise<boolean>;
  publish: (run: ImportRun, share: boolean) => Promise<PublishAnswer>;
  /** Whether the organization already has an item, so a run's item reads as an update. */
  has: (itemId: string) => boolean;
}

function problemText(answer: StartAnswer | PublishAnswer | 'stop'): string {
  switch (answer) {
    case 'running': return t('imports.problem.running');
    case 'no_importer': return t('imports.problem.noImporter');
    case 'not_allowed': return t('imports.problem.notAllowed');
    case 'not_ready': return t('imports.problem.notReady');
    default: return t('imports.problem.offline');
  }
}

export function ImportSheet(props: { visible: boolean; onClose: () => void; orgName: string; importer: Importer; run: ImportRun | null; actions: ImportActions }) {
  const { importer, run, actions } = props;
  const name = importerName(importer.importer);
  const choices = useMemo(() => fiaLanguageChoices(), []);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(['eng']));
  const [share, setShare] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [published, setPublished] = useState<number | null>(null);

  useEffect(() => { if (props.visible) { setProblem(null); setPublished(null); } }, [props.visible]);

  const stage = run?.state === 'ready' ? 'ready' : isOpen(run) ? 'building' : 'choose';

  async function start() {
    setBusy(true); setProblem(null); setPublished(null);
    try {
      const answer = await actions.start(importer.importer, [...picked]);
      if (answer !== 'started') setProblem(problemText(answer));
    } finally { setBusy(false); }
  }

  async function stop() {
    if (!run) return;
    setBusy(true); setProblem(null);
    try { if (!await actions.stop(run.id)) setProblem(problemText('stop')); } finally { setBusy(false); }
  }

  async function publish() {
    if (!run) return;
    setBusy(true); setProblem(null);
    try {
      const count = run.manifest.length;
      const answer = await actions.publish(run, share);
      if (answer === 'published') setPublished(count); else setProblem(problemText(answer));
    } finally { setBusy(false); }
  }

  const toggle = (code: string) => setPicked((p) => {
    const next = new Set(p);
    if (next.has(code)) next.delete(code); else next.add(code);
    return next;
  });

  const footer = stage === 'choose'
    ? <PrimaryBtn label={picked.size ? t('imports.choose.start', { count: picked.size }) : t('imports.choose.pickOne')} icon="download" busy={busy}
        disabled={!picked.size} help={t('imports.choose.startHelp')} onPress={() => void start()} />
    : stage === 'ready'
      ? <PrimaryBtn label={t('imports.ready.publish', { count: run!.manifest.length })} icon="check" busy={busy} help={t('imports.ready.publishHelp')} onPress={() => void publish()} />
      : undefined;

  return (
    <Sheet visible={props.visible} title={t('imports.title', { name })} sub={props.orgName} onClose={props.onClose} footer={footer}>
      {published !== null ? <Banner icon="check" tone="green" title={t('imports.done.title', { count: published })} body={t('imports.done.body')} /> : null}

      {stage === 'choose' ? (
        <View style={{ gap: space.md }}>
          {run?.state === 'failed' ? <Banner icon="flag" tone="amber" title={t('imports.failed.title')} body={t('imports.failed.body')} /> : null}
          {run?.state === 'failed' && run.failure ? <Text style={txt.smMuted}>{run.failure}</Text> : null}
          <Text style={txt.body}>{t('imports.fia.intro', { org: props.orgName })}</Text>
          <Text style={txt.smMuted}>{t('imports.fia.from', { source: `github.com/${importer.source}` })}</Text>
          <SectionLabel label={t('imports.choose.languages', { count: picked.size })} />
          <Group>
            {choices.map((c, i) => (
              <HelpRow key={c.code} of="imports.language">
                <CheckRow label={c.name} checked={picked.has(c.code)} last={i === choices.length - 1}
                  {...(actions.has(`fia.${c.code}`) ? { sub: t('imports.choose.inLibrary') } : {})}
                  detail={actions.has(`fia.${c.code}`) ? t('imports.choose.updateHelp') : t('imports.choose.languageHelp')} onToggle={() => toggle(c.code)} />
              </HelpRow>
            ))}
          </Group>
        </View>
      ) : null}

      {stage === 'building' && run ? (
        <View style={{ gap: space.md }}>
          <Banner icon="clock" tone="brand" title={run.state === 'waiting' ? t('imports.building.waiting') : t('imports.building.importing')}
            body={t('imports.building.body')} />
          <View style={{ gap: space.xs }}>
            <Text style={txt.sm}>{t('imports.building.progress', { done: run.done, total: run.total ?? run.options.languages?.length ?? 1 })}</Text>
            <ProgressBar value={(run.total ?? run.options.languages?.length ?? 1) ? run.done / (run.total ?? run.options.languages?.length ?? 1) : 0} />
          </View>
          <Text style={txt.smMuted}>{(run.options.languages ?? []).map(importLanguageName).join(', ')}</Text>
          <LinkBtn label={t('imports.building.stop')} help={t('imports.building.stopHelp')} onPress={() => void stop()} />
        </View>
      ) : null}

      {stage === 'ready' && run ? (
        <View style={{ gap: space.md }}>
          <Text style={txt.body}>{t('imports.ready.intro')}</Text>
          <Group>
            {run.manifest.map((it, i) => (
              <Row key={it.itemId} icon="sparkle" label={it.name} last={i === run.manifest.length - 1}
                sub={t('imports.ready.guides', { count: it.count })}
                badge={actions.has(it.itemId) ? t('imports.ready.update') : t('imports.ready.new')} badgeTone={actions.has(it.itemId) ? 'amber' : 'green'} />
            ))}
          </Group>
          <Group>
            <Row label={t('imports.ready.share')} sub={t('imports.ready.shareSub')} role="switch" checked={share} onPress={() => setShare(!share)} last />
          </Group>
          <LinkBtn label={t('imports.ready.setAside')} help={t('imports.ready.setAsideHelp')} color={C.muted} onPress={() => void stop()} />
        </View>
      ) : null}

      {problem ? <Text accessibilityRole="alert" style={[txt.sm, { color: C.red, fontWeight: '700' }]}>{problem}</Text> : null}
    </Sheet>
  );
}
