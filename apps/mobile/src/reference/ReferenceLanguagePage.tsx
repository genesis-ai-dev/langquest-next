// The language a team's Bibles and study guides are in, on a page of its own
// (decision 84): New language asks it as a step, and What will help them
// asks it first. Each language says what is there to read in it (a guide
// set's passages, Bibles, other guides), so the admin sees the gaps before
// choosing; any other language can be found in the language list (online).
import {
  subscriptionItemId, type LibraryDoc
} from '@langquest-next/core';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../text';
import type { Ctx } from '../ctx';
import { t } from '../i18n';
import { useHelpPress } from '../helpContext';
import { Ico, SearchField, txt } from '../kit';
import { LanguoidPicker, useLanguoidSearch } from '../languoidPicker';
import { useLibrary, useLibraryDocs, useSharedItems } from '../library/useLibrary';
import { Question, QuietLink, RadioRow } from '../simple/admin';
import { guideShortName, languageLabel } from '../simple/adminModel';
import { C, radius, space, type as T } from '../theme';
import { guideSets, originOf, setKeyOf } from './guideSets';
import { languageChoices, type LanguageChoice } from './languageChoices';
import { readerLanguage, sameLanguage } from './languages';

/**
 * What the organization has and others share, as guide sets and the
 * languages to choose from; `keep` are listed even when nothing is in them.
 */
export function useReferenceLanguages(ctx: Ctx, keep: readonly string[]) {
  const lib = useLibrary(ctx);
  const shared = useSharedItems('material', lib.orgId);
  const own = lib.items('material').filter((it) => it.current && !it.archived);
  const others = shared.rows.filter((s) => s.latest_hash && !ctx.org.state?.library[subscriptionItemId(s.org_id, s.item_id)]);
  const docs = useLibraryDocs(lib.orgId, [...own.map((it) => it.current), ...others.map((s) => s.latest_hash)], { deps: false });
  const keepKey = keep.join(',');
  const sets = guideSets(own.map((it) => ({ it, doc: docs.get(it.current) })), others.map((s) => ({ s, doc: docs.get(s.latest_hash) })));
  const setKeys = new Set(sets.map((s) => s.key));
  const rest: (LibraryDoc | null)[] = [
    ...own.map((it) => docs.get(it.current)).filter((d, i) => !setKeys.has(setKeyOf(originOf(own[i]!), d) ?? '')),
    ...others.map((s) => docs.get(s.latest_hash)).filter((d, i) => !setKeys.has(setKeyOf(others[i]!.org_id, d) ?? ''))
  ];
  const signature = [sets.map((s) => `${s.key}:${s.members.length}`).join(), rest.length, keepKey].join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the signature says when they change
  const choices = useMemo(() => languageChoices(sets, rest, keep), [signature]);
  return { sets, choices, loading: !shared.loaded };
}

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
        <QuietLink icon="search" label={t('reference.language.another')} onPress={() => setSearching(true)} />
      )}
      {props.children}
    </View>
  );
}

/** Above What will help them: "Bibles and guides in French · Change", back to the language page. */
export function ReferenceLanguageChip(props: { language: string; onPress: () => void }) {
  const label = t('referenceLanguage.chip', { language: languageLabel(props.language) });
  const onPress = useHelpPress(label, t('referenceLanguage.chipHelp'), props.onPress);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}. ${t('referenceLanguage.change')}`}
      style={({ pressed }) => [styles.chip, pressed && { opacity: 0.75 }]}>
      <Ico name="globe" size={18} color={C.primary} />
      <Text style={styles.chipText} numberOfLines={1}>{label}</Text>
      <Text style={styles.chipChange}>{t('referenceLanguage.change')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, borderRadius: radius.full, backgroundColor: C.light, paddingHorizontal: space.md, alignSelf: 'flex-start' },
  chipText: { flexShrink: 1, fontSize: T.sm, fontWeight: '700', color: C.dark },
  chipChange: { fontSize: T.sm, fontWeight: '800', color: C.primary }
});
