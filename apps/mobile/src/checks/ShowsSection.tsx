// What a step shows whoever does it (decisions.md 110): the Bible and the
// guide, each heard and read on its own switch, then key words, notes and
// earlier work. One section, the same on the recording and on every check
// (screens/checks.tsx); each switch saves as it is flipped, with Undo.
import { checkShows, checkShowsSpecs, type ShownWhat } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { Group, Row, SectionLabel, Toggle } from '../ui/kit';
import { shortName, shownRows } from './showsModel';

export function ShowsSection(props: { ctx: Ctx; kindId: string; name: string; canEdit: boolean }) {
  const { ctx, kindId, name } = props;
  const state = ctx.language.state;
  if (!state) return null;
  const shows = checkShows(state, kindId);
  async function set(what: ShownWhat, shown: boolean) {
    const s = ctx.language.state;
    if (!s) return;
    const commandId = Crypto.randomUUID();
    const specs = checkShowsSpecs(s, { commandId, kindId, what, shown });
    if (!specs.length) return;
    const undo = () => {
      const now = ctx.language.state;
      return now ? checkShowsSpecs(now, { commandId: `${commandId}:undo`, kindId, what, shown: !shown }) : [];
    };
    await ctx.act(specs, shown ? t('checks.shows.shownToast', { what: shortName(what), check: name }) : t('checks.shows.hiddenToast', { what: shortName(what), check: name }), undo).catch(() => {});
  }
  const rows = shownRows();
  return (
    <>
      <SectionLabel label={t('checks.shows.title')} />
      <Group>
        {rows.map((r, i) => (
          <Row key={r.what} icon={r.icon} label={r.label} role="switch" checked={shows[r.what]} muted={!shows[r.what]} last={i === rows.length - 1}
            right={<Toggle testID={`toggle-shows-${r.what}`} on={shows[r.what]} label={r.label} disabled={!props.canEdit}
              help={shows[r.what] ? t('checks.shows.onHelp') : t('checks.shows.offHelp')}
              onToggle={() => void set(r.what, !shows[r.what])} />} />
        ))}
      </Group>
    </>
  );
}
