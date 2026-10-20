// A language's content template (decision 138): the one it uses on top, with
// its books, version and edit; the organization's others to choose from under
// it; and, last, the organization's whole shelf (Content templates). Opened
// from the language's page as get_ready `step: 'template'`.
import { languageName, progressOf, type TemplateDoc, type VersificationDoc } from '@langquest-next/core';
import { useMemo, useState } from 'react';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { indexesFor } from '../sync/indexes';
import { Banner, Group, Header, PrimaryBtn, Row, Screen, ShowMore, SmallBtn } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { C, TINT } from '../ui/theme';
import { HelpRow } from '../helpMode/helpBadge';
import { sourceLine } from '../library/model';
import { useLibrary, useLibraryDocs, useLibraryUpdates, useSharedItems } from '../library/useLibrary';
import { PickCard, RadioRow } from '../admin/admin';
import { bookRows, choiceLine, libraryChoices, partWords, recordedCount, setAsideCount, STARTER_TEMPLATE, templateOf, withWaitingBooks, type LibraryChoice } from './contentTemplates';
import { choiceInUse, languageSummary, languageVersionView, lower, pickerLists, pickerNote } from './model';
import { usePickTemplate } from './usePickTemplate';
import { useRunner } from './useRunner';

const PAD = { paddingHorizontal: 20, gap: 14 } as const;

export function ContentTemplatePage({ ctx }: { ctx: Ctx }) {
  const state = ctx.language.state!;
  const languageId = ctx.language.languageId;
  const language = languageName(ctx.org.state, languageId);
  const lib = useLibrary(ctx);
  const libItems = lib.items;
  const library = ctx.org.state?.library;
  const shared = useSharedItems('template', lib.orgId);
  const choices = useMemo(() => libraryChoices(library ?? {}, libItems('template'), shared.rows, STARTER_TEMPLATE.name), [library, libItems, shared.rows]);
  const sel = templateOf(state);
  const [picked, setPicked] = useState<string | null>(null);
  const [limit, setLimit] = useState(8);
  const pick = choices.find((c) => c.key === picked) ?? null;
  const docs = useLibraryDocs(lib.orgId, [sel?.docHash, pick?.hash]);
  const doc = sel ? docs.get<TemplateDoc>(sel.docHash) : null;
  const v11n = doc?.bible ? docs.get<VersificationDoc>(doc.bible.versification) : null;
  const { updates } = useLibraryUpdates(lib.orgId);
  const { busy: running, run } = useRunner(ctx);
  // Picking another stays here, on what the language uses now.
  const { busy, use } = usePickTemplate(ctx, lib, state, languageId, () => setPicked(null));
  const lines = ctx.language.lines;
  // Progress, set-aside and recorded counts are read off each passage's line (decisions.md 143).
  const data = useMemo(() => {
    const idx = indexesFor(state);
    return {
      books: withWaitingBooks(bookRows(state, idx), state, idx), progress: progressOf(lines, idx.passages, state),
      setAside: setAsideCount(state, lines), recorded: recordedCount(lines)
    };
  }, [state, lines]);
  const canManage = ctx.session.can('manage_templates');
  const canWrite = lib.canWrite('template');
  const canShape = ctx.session.can('shape_templates') || canManage;
  // LangQuest's ways in the numbering the language uses now (decision 107); another organization's only for whoever may follow it.
  const { ours, others } = pickerLists(choices, canWrite, v11n?.code ?? 'eng');
  const options = [...ours, ...others].filter((c) => !choiceInUse(c, sel));
  const item = sel ? lib.item(sel.itemId) : null;
  const words = partWords(doc);
  const { versionLine, newer, update } = languageVersionView(item, sel, updates);
  const { bibleLine, countsLine } = languageSummary({
    doc, chosenBooks: sel?.books ? sel.books.length : null, v11n, bookRows: data.books.length, progress: data.progress, words
  });
  const editable = !!item && item.source !== 'subscription' && canWrite;
  const links = [
    ...(canShape && data.books.length ? [{ label: t('getReady.template.eachBook'), help: t('getReady.template.eachBookHelp'),
      onPress: () => ctx.go('templates_home', { level: 'language', languageId }) }] : []),
    ...(canManage && doc?.bible ? [{ label: t('getReady.template.whichBooks'), help: t('getReady.template.whichBooksHelp'),
      onPress: () => ctx.go('get_ready', { languageId, step: '1', only: '1' }) }] : []),
    ...(canManage && sel ? [{ label: editable ? t('common.edit') : t('content.library.view'), help: editable ? t('content.language.editTemplateHelp') : t('content.library.viewHelp'),
      onPress: () => ctx.go('template_editor', { itemId: sel.itemId }) }] : [])
  ];
  const changing = !!pick && !choiceInUse(pick, sel);
  const option = (c: LibraryChoice) => (
    <HelpRow key={c.key} of="getReady.template.option">
      <RadioRow icon={c.source === 'ours' ? 'template' : 'globe'} label={c.name} sub={choiceLine(c, sourceLine)} on={picked === c.key}
        help={canManage ? t('content.picker.cardHelp') : t('getReady.template.optionViewHelp')} onPress={() => { if (canManage) setPicked(picked === c.key ? null : c.key); }} />
    </HelpRow>
  );
  return (
    <Screen header={<Header title={t('org.language.contentTemplate')} sub={language} onBack={ctx.back} />} bodyStyle={PAD}
      footer={changing && pick ? (
        <>
          <Text style={txt.smMuted}>{pickerNote({ hasCurrent: !!sel, recorded: data.recorded, language, currentParts: lower(words.many), pick })}</Text>
          <PrimaryBtn label={t('content.picker.use', { name: pick.name })} icon="check" busy={busy} disabled={!canManage} onPress={() => void use(pick)} />
        </>
      ) : undefined}>
      {sel ? (
        <PickCard title={item?.name ?? doc?.name ?? t('content.language.itsTemplate')} sub={bibleLine ?? countsLine} links={links}>
          {bibleLine ? <Text style={txt.sm}>{countsLine}</Text> : null}
          {versionLine ? <Text style={txt.smMuted}>{versionLine}</Text> : null}
          {newer ? (
            <Text style={[txt.sm, { color: C.primary, fontWeight: '600' }]}>{t('content.language.newerOut', { n: newer, language })}</Text>
          ) : update ? (
            <>
              <Text style={[txt.sm, { color: TINT.amberText }]}>{t('content.newerVersion', { org: item!.subscription!.sourceOrgName })}</Text>
              {canWrite ? (
                <SmallBtn label={t('content.options.takeUpdate')} icon="download" disabled={running} help={t('content.options.takeUpdateHelp')}
                  onPress={() => void run('take template update', async () => { // i18n-ignore: log label
                    await lib.takeUpdate(item!, update);
                    ctx.toast(t('content.language.movesToNew', { language, name: item!.name }));
                  })} />
              ) : null}
            </>
          ) : null}
        </PickCard>
      ) : <Banner icon="template" title={t('content.noTemplate')} body={canManage ? t('getReady.template.chooseOne') : t('content.language.whoeverChooses', { language })} />}
      {data.setAside > 0 ? (
        <Banner icon="history" title={t('content.language.setAsideTitle', { count: data.setAside })}
          body={t('content.language.setAsideBody', { count: data.setAside, language })} />
      ) : null}
      {options.slice(0, limit).map(option)}
      <ShowMore remaining={options.length - limit} step={8} onMore={() => setLimit((l) => l + 8)} />
      {canManage ? (
        <Group>
          <Row icon="template" label={t('getReady.template.all')} help={t('getReady.template.allHelp')} last onPress={() => ctx.go('templates_home', { level: 'org' })} />
        </Group>
      ) : null}
    </Screen>
  );
}
