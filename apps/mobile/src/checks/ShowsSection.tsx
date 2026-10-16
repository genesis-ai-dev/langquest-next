// What a step shows whoever does it (decisions.md 110), on the step's page:
// a row per help, as the person's screen has them. Each row's switch turns
// the whole help on or off and its line says how much of it is on; the row
// opens the help's own page, where each part has its switch (the Bible and
// the guide as audio and text, notes and earlier versions by the step they
// were added during; ShowsPage in screens/checks.tsx). Key words has no
// parts. The same on the recording and on every check.
import { checkShows, type ShownWhat } from '@langquest-next/core';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { Group, Row, SectionLabel, Toggle, type IconName } from '../ui/kit';
import { partsOf, partsLine, type ShowPart } from './showsModel';
import { setParts } from './showActions';

export function ShowsSection(props: { ctx: Ctx; kindId: string; name: string; canEdit: boolean }) {
  const { ctx, kindId, name } = props;
  const state = ctx.language.state;
  if (!state) return null;
  const shows = checkShows(state, kindId);
  const open = (part: string) => ctx.go('check_editor', { languageId: ctx.language.languageId, kindId, part });
  const rows: { key: 'bible' | 'guide' | 'terms' | 'notes' | 'earlier'; icon: IconName; label: string }[] = [
    { key: 'bible', icon: 'book', label: t('checks.shows.bible') },
    { key: 'guide', icon: 'star', label: t('checks.shows.guide') },
    { key: 'terms', icon: 'key', label: t('checks.shows.terms') },
    { key: 'notes', icon: 'chat', label: t('checks.shows.notes') },
    { key: 'earlier', icon: 'clock', label: t('checks.shows.earlier') }
  ];
  const toggle = (parts: ShowPart[], on: boolean, label: string) => {
    if (!props.canEdit) return;
    void setParts(ctx, kindId, parts, !on, on ? t('checks.shows.hiddenToast', { what: label, check: name }) : t('checks.shows.shownToast', { what: label, check: name }));
  };
  return (
    <>
      <SectionLabel label={t('checks.shows.title')} />
      <Group>
        {rows.map((r, j) => {
          const parts: ShowPart[] = r.key === 'terms' ? [{ key: 'terms', what: 'terms' as ShownWhat, on: shows.terms }] : partsOf(state, kindId, r.key);
          const on = parts.some((p) => p.on);
          const switchEl = (
            <Toggle testID={`toggle-shows-${r.key}`} on={on} label={r.label} disabled={!props.canEdit}
              help={on ? t('checks.shows.allOnHelp') : t('checks.shows.allOffHelp')} onToggle={() => toggle(parts, on, r.label)} />
          );
          return r.key === 'terms' ? (
            <Row key={r.key} icon={r.icon} label={r.label} role="switch" checked={on} muted={!on} right={switchEl} last={j === rows.length - 1} />
          ) : (
            <Row key={r.key} icon={r.icon} label={r.label} sub={partsLine(parts, r.key)} muted={!on} right={switchEl}
              help={t('checks.shows.openHelp')} onPress={() => open(r.key)} last={j === rows.length - 1} />
          );
        })}
      </Group>
    </>
  );
}
