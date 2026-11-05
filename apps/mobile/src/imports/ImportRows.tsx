// The organization's importers on its Reference Material page (decisions.md
// 174): one row each, saying where its latest run stands, opening the
// import sheet. Nothing shows for an organization LangQuest turned none on.
import { useState } from 'react';
import type { Ctx } from '../shell/ctx';
import { HelpRow } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { Group, Row } from '../ui/kit';
import { ImportSheet } from './ImportSheet';
import { importerLine, importerName, isOpen, latestRun, sourceNews } from './model';
import { useImports } from './useImports';

export function ImportRows(props: { ctx: Ctx; canManage: boolean; orgName: string }) {
  const imp = useImports(props.ctx, props.canManage);
  const [open, setOpen] = useState<string | null>(null);
  if (!props.canManage || !imp.importers.length) return null;
  const opened = imp.importers.find((i) => i.importer === open) ?? null;
  return (
    <>
      <Group>
        {imp.importers.map((importer, i) => {
          const run = latestRun(imp.runs, importer.importer);
          // Something new at the source, while no import is under way or waiting to be published.
          const news = run?.state !== 'ready' && !isOpen(run) && sourceNews(importer).count > 0;
          return (
            <HelpRow key={importer.importer} of="imports.importer">
              <Row icon="download" label={t('imports.row.label', { name: importerName(importer.importer) })} last={i === imp.importers.length - 1}
                sub={importerLine(importer, run)} testID={`import-${importer.importer}`}
                badge={run?.state === 'ready' ? t('imports.row.readyBadge') : news ? t('imports.row.newBadge') : undefined} badgeTone={news ? 'green' : 'amber'}
                help={t('imports.row.help')} onPress={() => setOpen(importer.importer)} />
            </HelpRow>
          );
        })}
      </Group>
      {opened ? (
        <ImportSheet visible onClose={() => setOpen(null)} orgName={props.orgName} importer={opened} run={latestRun(imp.runs, opened.importer)}
          actions={{ start: imp.start, stop: imp.stop, publish: imp.publish, has: (itemId) => !!imp.item(itemId) }} />
      ) : null}
    </>
  );
}
