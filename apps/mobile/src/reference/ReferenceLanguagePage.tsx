// The language a team's Bibles and study guides are in, on a page of its own
// (decision 84): New language asks it as a step, and What will help them
// asks it first. Each language says what is there to read in it (a guide
// set's passages, Bibles, other guides), so the admin sees the gaps before
// choosing; any other language with Bibles or guides can be found by typing
// it (online), in the language list's dropdown narrowed to those
// (useOfferedLanguageSearch). Its Bibles are every one the team could add:
// the library's and Bible Brain's (`biblesFor`), as Add a Bible lists them.
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { t } from '../i18n';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { Ico, SearchField } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { LanguoidPicker } from '../org/languoidPicker';
import { Question, QuietLink, RadioRow } from '../admin/admin';
import { guideShortName, joinAnd, languageLabel } from '../admin/adminModel';
import { C, radius, space, type as T } from '../ui/theme';
import { useBibleBrainBibles } from '../sources/useBibleBrainBibles';
import { useBibleBrainLanguages } from '../sources/useBibleBrainLanguages';
import { offeredBibleLanguages } from './biblesModel';
import { namesOf, withoutEmpty } from './offeredLanguagesModel';
import { useOfferedLanguageSearch } from './useOfferedLanguageSearch';
import { biblesFor, type LanguageChoice } from './languageChoices';
import { readerLanguage, sameCodes, sameLanguage } from './languages';

/** "FIA guides for 294 passages · 21 Bibles", or that nothing is in it yet. */
function whatIsThere(c: LanguageChoice, bibles: number): string {
  const parts = [
    ...c.sets.map((s) => t('referenceLanguage.setPassages', { name: guideShortName(s.name), count: s.passages })),
    ...(bibles ? [t('referenceLanguage.bibles', { count: bibles })] : []),
    ...(c.other ? [t('referenceLanguage.otherGuides', { count: c.other })] : [])
  ];
  return parts.length ? parts.join(' · ') : t('referenceLanguage.nothing');
}

export function ReferenceLanguagePage(props: {
  /** The language whose team it is for, by name. */
  team: string;
  choices: readonly LanguageChoice[];
  /** The languages chosen, the main one first (decision 130). */
  value: readonly string[];
  /** Listed first, so the languages chosen when the page opened show without scrolling. */
  first?: readonly string[];
  onChange: (codes: string[]) => void;
  loading?: boolean;
  /** Under the list: what will be offered, in New language. */
  children?: ReactNode;
}) {
  const reader = readerLanguage();
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  // A language found by search keeps the list's name for it, for codes the app has no name for.
  const [found, setFound] = useState<Record<string, string>>({});
  const label = (code: string) => found[code] ?? languageLabel(code);
  // Typing offers the languages listed here and every one Bible Brain has Bibles in, nothing else.
  const bibleLanguages = useBibleBrainLanguages(searching);
  const offered = useMemo(() => [
    ...props.choices.map((c) => ({ code: c.language, names: namesOf(label(c.language)) })),
    ...(bibleLanguages ? offeredBibleLanguages(bibleLanguages).filter((l) => !props.choices.some((c) => sameLanguage(c.language, l.code))) : [])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the choices' languages and Bible Brain's list say when it changes
  ], [props.choices.map((c) => c.language).join(), bibleLanguages]);
  const typed = useOfferedLanguageSearch(q, offered, searching);
  const bibleBrain = useBibleBrainBibles([...props.choices.flatMap((c) => sameCodes(c.language)), ...typed.hits.slice(0, 12).map((h) => h.code)]);
  // A language found by typing that turns out to have no Bible that opens, and nothing else, goes.
  const search = withoutEmpty(typed, (code) => !props.choices.some((c) => sameLanguage(c.language, code)) && bibleBrain.get(code)?.length === 0);
  /** What a language found by typing has: a listed one's line, else its Bibles once Bible Brain says. */
  const has = (code: string) => {
    const c = props.choices.find((x) => sameLanguage(x.language, code));
    if (c) return whatIsThere(c, biblesFor(c, bibleBrain));
    const n = bibleBrain.get(code)?.length;
    return n === undefined ? null : t('referenceLanguage.bibles', { count: n });
  };
  const lead = props.first ? props.choices.filter((c) => props.first!.some((f) => sameLanguage(c.language, f))) : [];
  const ordered = [...lead, ...props.choices.filter((c) => !lead.includes(c))];
  const on = (code: string) => props.value.some((v) => sameLanguage(v, code));
  // Tick as many as the team reads; the last one cannot go.
  const toggle = (code: string) => {
    if (!on(code)) props.onChange([...props.value, code]);
    else if (props.value.length > 1) props.onChange(props.value.filter((v) => !sameLanguage(v, code)));
  };
  return (
    <View style={{ gap: 14 }}>
      <Question>{t('referenceLanguage.question', { language: props.team })}</Question>
      {ordered.map((c) => (
        <HelpRow key={c.language} of="referenceLanguage.language">
          <RadioRow icon="globe" label={label(c.language)} on={on(c.language)} onPress={() => toggle(c.language)} subLines={4} many
            help={t('referenceLanguage.rowHelp')}
            sub={[whatIsThere(c, biblesFor(c, bibleBrain)), sameLanguage(c.language, reader) ? t('reference.setLanguage.yours') : ''].filter(Boolean).join(' · ')} />
        </HelpRow>
      ))}
      {props.loading ? <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>{t('common.loading')}</Text> : null}
      {searching ? (
        <>
          <SearchField value={q} onChangeText={setQ} placeholder={t('reference.language.searchPlaceholder')} />
          <LanguoidPicker search={search} picked={null} detail={(h) => has(h.code)}
            unlisted={t('referenceLanguage.listed')} noMatch={t('referenceLanguage.noMatch')} unreachable={t('reference.language.unreachable')}
            onPick={(h) => {
              if (!h) return;
              setFound({ ...found, [h.code]: h.name });
              if (!on(h.code)) props.onChange([...props.value, h.code]);
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

/** Above What will help them: "Bibles and guides in English and Greek · Change", back to the language page. */
export function ReferenceLanguageChip(props: { languages: readonly string[]; onPress: () => void }) {
  const label = t('referenceLanguage.chip', { language: joinAnd(props.languages.map(languageLabel)) });
  const spot = useHelpSpot(label, t('referenceLanguage.chipHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={`${label}. ${t('referenceLanguage.change')}`}
      style={({ pressed }) => [styles.chip, pressed && { opacity: 0.75 }]}>
      <Ico name="globe" size={18} color={C.primary} />
      <Text style={styles.chipText}>{label}</Text>
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
