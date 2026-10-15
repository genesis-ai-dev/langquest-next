// The language a team's Bibles and study guides are in, on a page of its own
// (decision 84): New language asks it as a step, and What will help them
// asks it first. Each language says what is there to read in it (a guide
// set's passages, Bibles, other guides), so the admin sees the gaps before
// choosing; any other language can be found in the language list (online).
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { t } from '../i18n';
import { HelpBadge } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { Ico, SearchField } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { LanguoidPicker } from '../org/languoidPicker';
import { useLanguoidSearch } from '../org/useLanguoids';
import { Question, QuietLink, RadioRow } from '../admin/admin';
import { guideShortName, languageLabel } from '../admin/adminModel';
import { C, radius, space, type as T } from '../ui/theme';
import { type LanguageChoice } from './languageChoices';
import { readerLanguage, sameLanguage } from './languages';

/** "FIA guides for 294 passages · 2 Bibles", or that nothing is in it yet. */
function whatIsThere(c: LanguageChoice): string {
  const parts = [
    ...c.sets.map((s) => t('referenceLanguage.setPassages', { name: guideShortName(s.name), count: s.passages })),
    ...(c.bibles ? [t('referenceLanguage.bibles', { count: c.bibles })] : []),
    ...(c.other ? [t('referenceLanguage.otherGuides', { count: c.other })] : [])
  ];
  return parts.length ? parts.join(' · ') : t('referenceLanguage.nothing');
}

export function ReferenceLanguagePage(props: {
  /** The language whose team it is for, by name. */
  team: string;
  choices: readonly LanguageChoice[];
  value: string;
  /** Listed first, so the language chosen when the page opened shows without scrolling. */
  first?: string;
  onChange: (code: string) => void;
  loading?: boolean;
  /** Under the list: what will be offered, in New language. */
  children?: ReactNode;
}) {
  const reader = readerLanguage();
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  // A language found by search keeps the list's name for it, for codes the app has no name for.
  const [found, setFound] = useState<Record<string, string>>({});
  const search = useLanguoidSearch(q, searching);
  const label = (code: string) => found[code] ?? languageLabel(code);
  const lead = props.first ? props.choices.filter((c) => sameLanguage(c.language, props.first)) : [];
  const ordered = [...lead, ...props.choices.filter((c) => !lead.includes(c))];
  return (
    <View style={{ gap: 14 }}>
      <Question>{t('referenceLanguage.question', { language: props.team })}</Question>
      <Text style={[txt.sm, { paddingHorizontal: space.xs }]}>{t('referenceLanguage.sub', { language: props.team })}</Text>
      {ordered.map((c) => (
        <RadioRow key={c.language} icon="globe" label={label(c.language)} on={sameLanguage(c.language, props.value)} onPress={() => props.onChange(c.language)} subLines={4}
          help={t('referenceLanguage.rowHelp')}
          sub={[whatIsThere(c), sameLanguage(c.language, reader) ? t('reference.setLanguage.yours') : ''].filter(Boolean).join(' · ')} />
      ))}
      {props.loading ? <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('common.loading')}</Text> : null}
      {searching ? (
        <>
          <SearchField value={q} onChangeText={setQ} placeholder={t('reference.language.searchPlaceholder')} />
          <LanguoidPicker search={search} picked={null} unlisted={t('reference.language.unlisted')} unreachable={t('reference.language.unreachable')}
            onPick={(h) => {
              if (!h) return;
              setFound({ ...found, [h.code]: h.name });
              props.onChange(h.code);
              setSearching(false);
              setQ('');
            }} />
        </>
      ) : (
        <QuietLink icon="search" label={t('reference.language.another')} detail={t('reference.language.anotherHelp')} onPress={() => setSearching(true)} />
      )}
      {props.children}
    </View>
  );
}

/** Above What will help them: "Bibles and guides in French · Change", back to the language page. */
export function ReferenceLanguageChip(props: { language: string; onPress: () => void }) {
  const label = t('referenceLanguage.chip', { language: languageLabel(props.language) });
  const spot = useHelpSpot(label, t('referenceLanguage.chipHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={`${label}. ${t('referenceLanguage.change')}`}
      style={({ pressed }) => [styles.chip, pressed && { opacity: 0.75 }]}>
      <Ico name="globe" size={18} color={C.primary} />
      <Text style={styles.chipText} numberOfLines={1}>{label}</Text>
      <Text style={styles.chipChange}>{t('referenceLanguage.change')}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, borderRadius: radius.full, backgroundColor: C.light, paddingHorizontal: space.md, alignSelf: 'flex-start' },
  chipText: { flexShrink: 1, fontSize: T.sm, fontWeight: '700', color: C.dark },
  chipChange: { fontSize: T.sm, fontWeight: '800', color: C.primary }
});
