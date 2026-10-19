// Earlier sections (decision 80, docs/breaking-up-the-bible.md): when a way
// of dividing changes, a book is divided again or the numbering changes,
// the old sections expire but their work is kept. A current section that
// overlaps an expired one holding recordings shows a warning mark, and its
// page lists the expired sections, closed by default.
import { unitTitle } from '@langquest-next/core';
import { useState } from 'react';
import { View } from 'react-native';
import { currentLocale, t } from '../i18n';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { Disclosure, Group, Ico, Row } from '../ui/kit';
import { HelpRow } from '../helpMode/helpBadge';
import { txt } from '../ui/textStyles';
import { C, space, TINT } from '../ui/theme';
import { isEarlierSection, numberedLike } from './earlierSections';
import { useEarlierSections } from './useEarlierSections';

/** At the top of an earlier section's page: what it is, and the sections its verses are in now. */
export function EarlierNote(props: { ctx: Ctx; unitId: string; languageId: string }) {
  const { ctx } = props;
  const state = ctx.language.state;
  const found = useEarlierSections(ctx, state);
  if (!state || !isEarlierSection(state, props.unitId)) return null;
  const now = [...found.over].filter(([, olds]) => olds.includes(props.unitId)).map(([u]) => u);
  const how = found.numbered.get(props.unitId);
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
        <Ico name="flag" size={18} color={TINT.amberText} />
        <Text style={[txt.sm, { flex: 1, color: TINT.amberText }]}>
          {how
            ? t('breakup.earlier.noteHow', { how: `${how.charAt(0).toLocaleLowerCase(currentLocale())}${how.slice(1)}`, count: now.length })
            : t('breakup.earlier.note', { count: now.length })}
        </Text>
      </View>
      {now.length ? (
        <Group>
          {now.map((u, i) => (
            <HelpRow key={u} of="breakup.sectionNow">
              <Row icon="right" label={unitTitle(state, u)} sub={t('breakup.earlier.whereNow')} last={i === now.length - 1} onPress={() => ctx.openPassage(u, props.languageId)} />
            </HelpRow>
          ))}
        </Group>
      ) : null}
    </View>
  );
}

/** The warning mark on a section whose divisions changed since work was recorded on it. */
export function ChangedMark() {
  return (
    <View accessibilityLabel={t('breakup.earlier.changedMark')} style={{ position: 'absolute', bottom: -4, left: -4 }}>
      <Ico name="flag" size={14} color={TINT.amberText} />
    </View>
  );
}

/** On a section's page: what was recorded on sections that have since expired, closed by default. */
export function EarlierSections(props: { ctx: Ctx; unitId: string; languageId: string }) {
  const { ctx } = props;
  const state = ctx.language.state;
  const found = useEarlierSections(ctx, state);
  const earlier = found.over.get(props.unitId) ?? [];
  const [open, setOpen] = useState(false);
  if (!state || earlier.length === 0) return null;
  const versions = (u: string) => Object.values(state.takes).filter((take) => take.unitId === u && !take.archived).length;
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
        <Ico name="flag" size={18} color={TINT.amberText} />
        <Text style={[txt.sm, { flex: 1, color: TINT.amberText }]}>
          {t('breakup.earlier.changedHere')}
        </Text>
      </View>
      <Disclosure icon="history" title={t('breakup.earlier.title')} summary={earlier.map((u) => unitTitle(state, u)).join(t('admin.list.separator'))} open={open} onToggle={() => setOpen((o) => !o)}
        help={open ? t('help.details.disclosureOpen') : t('breakup.earlier.disclosureHelp')}>
        {earlier.map((u, i) => {
          const n = versions(u);
          return (
            <HelpRow key={u} of="breakup.earlierSection">
              <Row icon="history" label={unitTitle(state, u)} sub={t('breakup.earlier.row', { how: found.numbered.get(u) ?? t('breakup.earlier.anEarlier'), versions: t('breakup.earlier.versions', { count: n }) })} last={i === earlier.length - 1}
                help={t('breakup.earlier.openHelp')}
                onPress={() => ctx.openPassage(u, props.languageId)} />
            </HelpRow>
          );
        })}
        <Text style={[txt.xs, { color: C.muted }]}>{t('breakup.earlier.openOne')}</Text>
      </Disclosure>
    </View>
  );
}
