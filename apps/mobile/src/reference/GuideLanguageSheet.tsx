// Choosing a guide set's language (decision 84): FIA comes in several
// languages, so turning it on for a team asks which one, with the reader's
// own language picked when the set has it, else English. Each language says
// how many passages it covers, so the gaps show before anyone chooses. FIA's
// key words are chosen the same way, each language saying how many words it
// has (decision 149).
import { useState } from 'react';
import { Text } from '../ui/text';
import { t } from '../i18n';
import { HelpRow } from '../helpMode/helpBadge';
import { GhostBtn, PrimaryBtn, Sheet } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { RadioRow } from '../admin/admin';
import { guideShortName, languageLabel } from '../admin/adminModel';
import { space } from '../ui/theme';
import { isWordSet, suggestedMember, type GuideSet, type SetMember } from './guideSets';
import { readerLanguage, sameLanguage } from './languages';

export function GuideLanguageSheet(props: {
  set: GuideSet;
  /** The members the team has now (none when it is off). */
  chosen: readonly SetMember[];
  /** The language whose team it is for, by name. */
  team: string;
  /** The language to suggest when the set has it: the team's reference language; else the reader's. */
  prefer?: string;
  busy?: boolean;
  onUse: (m: SetMember) => void;
  /** Offered when the set is on: stop offering it to the team. */
  onOff?: () => void;
  onClose: () => void;
}) {
  const { set } = props;
  const reader = readerLanguage();
  const [language, setLanguage] = useState(() => suggestedMember(set, props.prefer ?? reader, props.chosen).language);
  const picked = set.members.find((m) => m.language === language) ?? set.members[0]!;
  const short = guideShortName(set.name);
  const now = props.chosen.length === 1 && props.chosen[0]!.language === picked.language;
  // A set of key-word lists counts words, not passages.
  const words = isWordSet(set);
  return (
    <Sheet visible title={t('reference.setLanguage.title', { name: short })} sub={t('reference.setLanguage.sub', { count: set.members.length, team: props.team })} onClose={props.onClose}
      footer={<>
        <PrimaryBtn label={now ? t('reference.setLanguage.keep', { language: languageLabel(picked.language) }) : t('reference.setLanguage.use', { language: languageLabel(picked.language) })}
          busy={props.busy} help={now ? t('reference.setLanguage.keepHelp') : words ? t('reference.setLanguage.wordsUseHelp') : t('reference.setLanguage.useHelp')} onPress={() => (now ? props.onClose() : props.onUse(picked))} />
        {props.onOff ? <GhostBtn label={t('reference.setLanguage.off', { name: short })} disabled={props.busy} help={words ? t('reference.setLanguage.wordsOffHelp') : t('reference.setLanguage.offHelp')} onPress={props.onOff} /> : null}
      </>}>
      {set.members.map((m) => (
        <HelpRow key={m.language} of="reference.setLanguage">
          <RadioRow icon="globe" label={languageLabel(m.language)} on={m.language === picked.language} onPress={() => setLanguage(m.language)}
            help={words ? t('reference.setLanguage.wordsRowHelp') : t('reference.setLanguage.rowHelp')}
            sub={[words ? t('reference.words', { count: m.passages }) : t('reference.setLanguage.passages', { count: m.passages }), sameLanguage(m.language, reader) ? t('reference.setLanguage.yours') : ''].filter(Boolean).join(' · ')} />
        </HelpRow>
      ))}
      <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>
        {words
          ? t('reference.setLanguage.wordsGaps', { name: short, language: languageLabel(picked.language), count: picked.passages })
          : t('reference.setLanguage.gaps', { name: short, language: languageLabel(picked.language), count: picked.passages })}
      </Text>
    </Sheet>
  );
}
