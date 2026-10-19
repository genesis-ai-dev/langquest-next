// The language a step that makes something (back translation) makes it in
// (decisions.md 141): the team's reference languages first, the one it has
// now among them, any other found in the language list or typed.
import { useState } from 'react';
import { View } from 'react-native';
import { PrimaryBtn, SearchField, Sheet } from '../ui/kit';
import { t } from '../i18n';
import { HelpRow } from '../helpMode/helpBadge';
import { QuietLink, RadioRow } from '../admin/admin';
import { languageLabel } from '../admin/adminModel';
import { LanguoidPicker } from '../org/languoidPicker';
import { useLanguoidSearch } from '../org/useLanguoids';

export function IntoSheet(props: {
  visible: boolean;
  /** The check, as its sheet's line names it. */
  check: string;
  /** The language it is made in now, by name ("English"). */
  current: string;
  /** The team's reference languages, by code: the likely answers. */
  languages: readonly string[];
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const search = useLanguoidSearch(q, searching);
  const names = [...new Set([...props.languages.map(languageLabel), props.current].filter(Boolean))];
  const close = () => { setSearching(false); setQ(''); props.onClose(); };
  const pick = (name: string) => { setSearching(false); setQ(''); props.onPick(name); };
  const typed = q.trim();
  return (
    <Sheet visible={props.visible} title={t('checks.into.title')} sub={props.check} onClose={close}
      footer={searching && typed && (search.status === 'none' || search.status === 'unreachable')
        ? <PrimaryBtn label={t('checks.into.useTyped', { name: typed })} icon="check" help={t('checks.into.useTypedHelp')} onPress={() => pick(typed)} /> : undefined}>
      <View style={{ gap: 10 }}>
        {names.map((n) => (
          <HelpRow key={n} of="checks.into">
            <RadioRow icon="globe" label={n} on={n === props.current} help={t('checks.into.pickHelp')} onPress={() => pick(n)} />
          </HelpRow>
        ))}
      </View>
      {searching ? (
        <>
          <SearchField value={q} onChangeText={setQ} placeholder={t('reference.language.searchPlaceholder')} />
          <LanguoidPicker search={search} picked={null} unlisted={t('checks.into.unlisted')} unreachable={t('reference.language.unreachable')}
            onPick={(h) => { if (h) pick(h.name); }} />
        </>
      ) : (
        <QuietLink icon="search" label={t('reference.language.another')} detail={t('checks.into.anotherHelp')} onPress={() => setSearching(true)} />
      )}
    </Sheet>
  );
}
