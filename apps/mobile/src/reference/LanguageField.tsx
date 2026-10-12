// The language a note, guide or other material is written in (decision 84):
// the writer's app language, English and the languages already in use as
// one tap each, and any other language from the language list (online).
import { useState } from 'react';
import { View } from 'react-native';
import { Text } from '../text';
import { t } from '../i18n';
import { Chip, ChipRow, SearchField, txt } from '../kit';
import { LanguoidPicker, useLanguoidSearch } from '../languoidPicker';
import { languageLabel } from '../simple/adminModel';
import { space } from '../theme';
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
        {chips.map((c) => <Chip key={c} label={found[c] ?? languageLabel(c)} on={sameLanguage(c, props.value)} onPress={() => choose(c)} />)}
        {props.disabled ? null : <Chip label={t('reference.language.another')} icon="search" on={searching} onPress={() => setSearching(!searching)} />}
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
