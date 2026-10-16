// What a step shows whoever does it (decisions.md 110): one row per help, as
// the person's screen has them. The Bible and the guide open to Audio and
// Text, notes and earlier versions to the steps they come from; key words is
// a switch. The same on the recording and on every check (screens/checks.tsx).
import { checkShows, checkShowsSpecs } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { Group, Row, SectionLabel, Toggle } from '../ui/kit';
import { checkName } from '../admin/adminModel';
import { deriveKinds } from '../i18n/coreText';
import { anyFrom, mediaLine, stepsLine } from './showsModel';

export function ShowsSection(props: { ctx: Ctx; kindId: string; name: string; canEdit: boolean }) {
  const { ctx, kindId, name } = props;
  const state = ctx.language.state;
  if (!state) return null;
  const shows = checkShows(state, kindId);
  const known = deriveKinds(state);
  const open = (part: string) => ctx.go('check_editor', { languageId: ctx.language.languageId, kindId, part });
  async function setTerms(shown: boolean) {
    const s = ctx.language.state;
    if (!s) return;
    const commandId = Crypto.randomUUID();
    const specs = checkShowsSpecs(s, { commandId, kindId, what: 'terms', shown });
    if (!specs.length) return;
    const undo = () => {
      const now = ctx.language.state;
      return now ? checkShowsSpecs(now, { commandId: `${commandId}:undo`, kindId, what: 'terms', shown: !shown }) : [];
    };
    const what = t('checks.shows.short.terms');
    await ctx.act(specs, shown ? t('checks.shows.shownToast', { what, check: name }) : t('checks.shows.hiddenToast', { what, check: name }), undo).catch(() => {});
  }
  const nameOf = (step: string) => checkName(step, known);
  return (
    <>
      <SectionLabel label={t('checks.shows.title')} />
      <Group>
        <Row icon="listen" label={t('checks.shows.bible')} sub={mediaLine(shows.bibleAudio, shows.bibleText)} muted={!shows.bibleAudio && !shows.bibleText}
          help={t('checks.shows.openHelp')} onPress={() => open('bible')} />
        <Row icon="star" label={t('checks.shows.guide')} sub={mediaLine(shows.guideAudio, shows.guideText)} muted={!shows.guideAudio && !shows.guideText}
          help={t('checks.shows.openHelp')} onPress={() => open('guide')} />
        <Row icon="key" label={t('checks.shows.terms')} role="switch" checked={shows.terms} muted={!shows.terms}
          right={<Toggle testID="toggle-shows-terms" on={shows.terms} label={t('checks.shows.terms')} disabled={!props.canEdit}
            help={shows.terms ? t('checks.shows.onHelp') : t('checks.shows.offHelp')} onToggle={() => void setTerms(!shows.terms)} />} />
        <Row icon="chat" label={t('checks.shows.notes')} sub={stepsLine(state, kindId, 'notes', nameOf)} muted={!anyFrom(state, kindId, 'notes')}
          help={t('checks.shows.openHelp')} onPress={() => open('notes')} />
        <Row icon="clock" label={t('checks.shows.earlier')} sub={stepsLine(state, kindId, 'earlier', nameOf)} muted={!anyFrom(state, kindId, 'earlier')}
          help={t('checks.shows.openHelp')} onPress={() => open('earlier')} last />
      </Group>
    </>
  );
}
