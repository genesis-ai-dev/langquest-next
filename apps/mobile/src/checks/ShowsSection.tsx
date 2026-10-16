// What a step shows whoever does it (decisions.md 110), all on the step's
// page: a card per help, as the person's screen has them. Each card's switch
// turns the whole help on or off; its parts sit inside it and turn on and
// off one by one: the Bible and the guide as audio and text, notes and
// earlier versions by the step they come from. Key words is one switch.
// The same on the recording and on every check (screens/checks.tsx).
import { checkShows, checkShowsSpecs, RECORD_STEP, shownFrom, type EventSpec, type ShownWhat } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { StyleSheet, View } from 'react-native';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { Chip, Group, Row, SectionLabel, Toggle, type IconName } from '../ui/kit';
import { kindIcon } from '../ui/kindIcon';
import { space } from '../ui/theme';
import { checkName } from '../admin/adminModel';
import { deriveKinds } from '../i18n/coreText';
import { stepKeys } from './showsModel';

/** One switch a card holds: a thing, or notes or earlier versions from one step. */
interface Part { key: string; label: string; icon: IconName; what: ShownWhat; from?: string; on: boolean }

export function ShowsSection(props: { ctx: Ctx; kindId: string; name: string; canEdit: boolean }) {
  const { ctx, kindId, name } = props;
  const state = ctx.language.state;
  if (!state) return null;
  const shows = checkShows(state, kindId);
  const known = deriveKinds(state);
  const steps = stepKeys(state);

  /** Set several parts at once, with one Undo that puts each back. */
  async function set(parts: readonly Part[], shown: boolean, label: string) {
    const s = ctx.language.state;
    if (!s || !props.canEdit) return;
    const commandId = Crypto.randomUUID();
    const changing = parts.filter((p) => p.on !== shown);
    const specs: EventSpec[] = changing.flatMap((p, i) => checkShowsSpecs(s, { commandId: `${commandId}:${i}`, kindId, what: p.what, shown, ...(p.from !== undefined ? { from: p.from } : {}) }));
    if (!specs.length) return;
    const undo = () => {
      const now = ctx.language.state;
      return now ? changing.flatMap((p, i) => checkShowsSpecs(now, { commandId: `${commandId}:undo:${i}`, kindId, what: p.what, shown: !shown, ...(p.from !== undefined ? { from: p.from } : {}) })) : [];
    };
    await ctx.act(specs, shown ? t('checks.shows.shownToast', { what: label, check: name }) : t('checks.shows.hiddenToast', { what: label, check: name }), undo).catch(() => {});
  }

  const media = (audio: ShownWhat, text: ShownWhat, textIcon: IconName): Part[] => [
    { key: audio, label: t('checks.shows.audio'), icon: 'listen', what: audio, on: shows[audio] },
    { key: text, label: t('checks.shows.text'), icon: textIcon, what: text, on: shows[text] }
  ];
  const bySteps = (what: 'notes' | 'earlier'): Part[] => steps.map((step) => ({
    key: `${what}@${step}`, label: step === RECORD_STEP ? t('checks.recording') : checkName(step, known),
    icon: step === RECORD_STEP ? 'mic' : kindIcon(step), what, from: step, on: shownFrom(state, kindId, what, step)
  }));
  const cards: { key: string; icon: IconName; label: string; parts: Part[] }[] = [
    { key: 'bible', icon: 'book', label: t('checks.shows.bible'), parts: media('bibleAudio', 'bibleText', 'book') },
    { key: 'guide', icon: 'star', label: t('checks.shows.guide'), parts: media('guideAudio', 'guideText', 'file') },
    { key: 'terms', icon: 'key', label: t('checks.shows.terms'), parts: [{ key: 'terms', label: t('checks.shows.terms'), icon: 'key', what: 'terms', on: shows.terms }] },
    { key: 'notes', icon: 'chat', label: t('checks.shows.notes'), parts: bySteps('notes') },
    { key: 'earlier', icon: 'clock', label: t('checks.shows.earlier'), parts: bySteps('earlier') }
  ];

  return (
    <>
      <SectionLabel label={t('checks.shows.title')} />
      <View style={styles.cards}>
        {cards.map((c) => {
          const on = c.parts.some((p) => p.on);
          const inside = c.parts.length > 1;
          return (
            <Group key={c.key}>
              <Row icon={c.icon} label={c.label} role="switch" checked={on} muted={!on} last={!inside}
                right={<Toggle testID={`toggle-shows-${c.key}`} on={on} label={c.label} disabled={!props.canEdit}
                  help={on ? t('checks.shows.allOnHelp') : t('checks.shows.allOffHelp')} onToggle={() => void set(c.parts, !on, c.label)} />} />
              {inside ? (
                <View style={styles.parts}>
                  {c.parts.map((p) => (
                    <Chip key={p.key} label={p.label} icon={p.icon} on={p.on} help={p.on ? t('checks.shows.onHelp') : t('checks.shows.offHelp')}
                      onPress={() => void set([p], !p.on, t('checks.shows.partLabel', { help: c.label, part: p.label }))} />
                  ))}
                </View>
              ) : null}
            </Group>
          );
        })}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  cards: { gap: space.md },
  parts: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.lg }
});
