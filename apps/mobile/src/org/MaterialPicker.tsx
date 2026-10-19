// New language's Reference material (decisions.md 141): what its team will
// have, ticked, in the languages chosen on the page before. It comes before
// the review flow, so each check can then say what of it its people see.
import { View } from 'react-native';
import { Text } from '../ui/text';
import { t } from '../i18n';
import { Group, SectionLabel } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { space } from '../ui/theme';
import { HelpRow } from '../helpMode/helpBadge';
import { CheckRow, Question } from '../admin/admin';
import { joinAnd, languageLabel } from '../admin/adminModel';
import { ReferenceLanguageChip } from '../reference/ReferenceLanguagePage';
import type { MaterialChoice } from './newLanguage';

export function MaterialPicker(props: {
  /** The language whose team it is for, by name. */
  team: string;
  /** The languages its material is in, the main one first. */
  languages: readonly string[];
  items: readonly MaterialChoice[];
  on: (key: string) => boolean;
  onToggle: (key: string) => void;
  onLanguages: () => void;
  loading: boolean;
}) {
  const section = (kind: MaterialChoice['kind'], label: string) => {
    const rows = props.items.filter((x) => x.kind === kind);
    if (rows.length === 0) return null;
    return (
      <View key={kind} style={{ gap: space.xs }}>
        <SectionLabel label={label} />
        <Group>
          {rows.map((x, i) => (
            <HelpRow key={x.key} of={`newLanguage.material.${kind}`}>
              <CheckRow label={x.label} sub={x.sub} checked={props.on(x.key)} last={i === rows.length - 1}
                detail={props.on(x.key) ? t('org.newLanguage.material.onHelp', { language: props.team }) : t('org.newLanguage.material.offHelp', { language: props.team })}
                onToggle={() => props.onToggle(x.key)} />
            </HelpRow>
          ))}
        </Group>
      </View>
    );
  };
  return (
    <>
      <ReferenceLanguageChip languages={props.languages} onPress={props.onLanguages} />
      <Question>{t('org.newLanguage.material.question', { language: props.team })}</Question>
      {section('source', t('getReady.page.bibles'))}
      {section('guide', t('getReady.helps.studyGuides'))}
      {section('note', t('getReady.helps.notesForTranslators'))}
      {props.items.length === 0 ? (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>
          {props.loading ? t('common.loading') : t('org.newLanguage.material.nothing', { languages: joinAnd(props.languages.map(languageLabel)) })}
        </Text>
      ) : null}
    </>
  );
}
