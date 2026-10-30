// A language's book names (decision 193): the set it uses on top, with a few
// of its names; the sets in the team's languages under it, then every other
// language's. Opened from the content template page as get_ready
// `step: 'names'`. One book's own name stays where it is set, on the book's
// page (Each book's passages).
import { languageName, templateBooks, type TemplateDoc } from '@langquest-next/core';
import { useState } from 'react';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { Header, PrimaryBtn, Screen, SectionLabel, ShowMore, SmallBtn } from '../ui/kit';
import { HelpRow } from '../helpMode/helpBadge';
import { PickCard, RadioRow } from '../admin/admin';
import { languageLabel } from '../admin/adminModel';
import { useLibraryDocs } from '../library/useLibrary';
import { teamLanguages } from '../reference/languages';
import { namesInOrder, namesInUse, sampleNames, type NameSet } from './bookNamesModel';
import { useBookNameSets, useUseBookNames } from './useBookNames';

const PAD = { paddingHorizontal: 20, gap: 14 } as const;

export function BookNamesPage({ ctx }: { ctx: Ctx }) {
  const state = ctx.language.state!;
  const languageId = ctx.language.languageId;
  const language = languageName(ctx.org.state, languageId);
  const { lib, sets } = useBookNameSets(ctx);
  const [picked, setPicked] = useState<string | null>(null);
  const [limit, setLimit] = useState(20);
  const { busy, use } = useUseBookNames(ctx, lib, () => setPicked(null));
  const canManage = ctx.session.can('manage_templates');
  const sep = t('admin.list.separator');
  const used = state.bookNamesFrom?.value ?? null;
  const current = sets.find((s) => namesInUse(s, state)) ?? null;
  // Without a set, the template's own names for the Gospels (or its first books) show what the passages say.
  const sel = state.template?.value;
  const docs = useLibraryDocs(lib.orgId, [sel?.docHash]);
  const doc = docs.get<TemplateDoc>(sel?.docHash);
  const templateSample = doc ? sampleNames({ format: 'names@1', name: '', description: '', language: '', books: templateBooks(doc), deps: [] }, sep) : '';
  const usedSample = used ? sampleNames({ format: 'names@1', name: '', description: '', language: used.language,
    books: Object.entries(used.names).map(([book, name]) => ({ book, name })), deps: [] }, sep) : '';
  // A newer version of the set in use: its names, once someone here takes them.
  const newer = current && used && current.docHash !== used.docHash ? current : null;
  const { team, rest } = namesInOrder(sets.filter((s) => s !== current), teamLanguages(ctx.org.state, state, languageId));
  const pick = sets.find((s) => s.key === picked) ?? null;
  const option = (s: NameSet) => (
    <HelpRow key={s.key} of="bookNames.option">
      <RadioRow icon={s.itemId ? 'book' : 'globe'} label={s.name} sub={[sampleNames(s.doc, sep), ...(s.from ? [s.from] : [])].join(' · ')} on={picked === s.key}
        help={canManage ? t('bookNames.optionHelp') : t('bookNames.optionViewHelp')} onPress={() => { if (canManage) setPicked(picked === s.key ? null : s.key); }} />
    </HelpRow>
  );
  const others = rest.slice(0, limit);
  return (
    <Screen header={<Header title={t('bookNames.title')} sub={language} onBack={ctx.back} />} bodyStyle={PAD}
      footer={pick ? (
        <PrimaryBtn label={t('bookNames.use', { name: pick.name })} icon="check" busy={busy} disabled={!canManage}
          onPress={() => void use(pick, t('bookNames.nowUses', { language, name: pick.name }))} />
      ) : undefined}>
      {used ? (
        <PickCard title={current?.name ?? languageLabel(used.language)} sub={usedSample}>
          {newer && canManage ? (
            <SmallBtn label={t('bookNames.newer')} icon="download" disabled={busy} help={t('bookNames.newerHelp')}
              onPress={() => void use(newer, t('bookNames.nowUses', { language, name: newer.name }))} />
          ) : null}
        </PickCard>
      ) : (
        <PickCard title={t('bookNames.templates')} sub={templateSample} />
      )}
      {team.map(option)}
      {rest.length ? <SectionLabel label={t('bookNames.otherLanguages')} /> : null}
      {others.map(option)}
      <ShowMore remaining={rest.length - others.length} step={20} onMore={() => setLimit((l) => l + 20)} />
    </Screen>
  );
}
