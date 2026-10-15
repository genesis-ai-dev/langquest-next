// The language a note, guide or other material is written in (decision 84):
// the writer's app language, English and the languages already in use as
// one tap each, and any other language from the language list (online).
import { useState } from 'react';
import { View } from 'react-native';
import { Text } from '../ui/text';
import { t } from '../i18n';
import { Chip, ChipRow, SearchField } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { LanguoidPicker } from '../org/languoidPicker';
import { useLanguoidSearch } from '../org/useLanguoids';
import { languageLabel } from '../admin/adminModel';
import { space } from '../ui/theme';
import { readerLanguage, sameLanguage } from './languages';

export function LanguageField(props: { label: string; value: string | null; onChange: (code: string) => void; suggestions?: readonly string[]; disabled?: boolean }) {
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  // A language found by search keeps the name the list gave it, for codes the app has no name for.
  const [found, setFound] = useState<Record<string, string>>({});
  const search = useLanguoidSearch(q, searching);
  const chips: string[] = [];
  for (const c of [props.value, readerLanguage(), 'eng', ...(props.suggestions ?? [])]) {
    if (c && !chips.some((x) => sameLanguage(x, c))) chips.push(c);
  }
  const choose = (code: string) => { if (!props.disabled) props.onChange(code); };
  return (
    <View style={{ gap: space.xs }}>
      <Text style={txt.xsStrong}>{props.label}</Text>
      <ChipRow>
        {chips.map((c) => <Chip key={c} label={found[c] ?? languageLabel(c)} on={sameLanguage(c, props.value)} help={t('reference.language.chipHelp')} onPress={() => choose(c)} />)}
        {props.disabled ? null : <Chip label={t('reference.language.another')} icon="search" on={searching} help={t('reference.language.anotherHelp')} onPress={() => setSearching(!searching)} />}
      </ChipRow>
      {searching ? (
        <>
          <SearchField value={q} onChangeText={setQ} placeholder={t('reference.language.searchPlaceholder')} />
          <LanguoidPicker search={search} picked={null} unlisted={t('reference.language.unlisted')} unreachable={t('reference.language.unreachable')}
            onPick={(h) => {
              if (!h) return;
              setFound({ ...found, [h.code]: h.name });
              choose(h.code);
              setSearching(false);
              setQ('');
            }} />
        </>
      ) : null}
    </View>
  );
}
