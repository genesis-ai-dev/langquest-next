// Me → Language, and the same choice on the sign-in screen (LAN-42): the
// language LangQuest speaks to you in. Each language is named in itself, so
// someone who reads only that language finds it, with its name in the
// language showing under it. A draft (not yet approved, i18n/languages.ts)
// says so. Picking one restarts the app in it.
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './text';
import { languageInfo, t, UI_LANGUAGES, currentLanguage, type UiLanguage } from './i18n';
import { chooseLanguage, chosenLanguage, phoneLanguage } from './i18n/start';
import { Ico, Row, Sheet, txt } from './kit';
import { C, radius, space, target } from './theme';

/** The language's name in the language showing: "Arabic", "Árabe", "阿拉伯语". */
function nameHere(code: UiLanguage): string {
  switch (code) {
    case 'en': return t('uiLanguage.names.en');
    case 'es': return t('uiLanguage.names.es');
    case 'pt': return t('uiLanguage.names.pt');
    case 'fr': return t('uiLanguage.names.fr');
    case 'ar': return t('uiLanguage.names.ar');
    case 'sw': return t('uiLanguage.names.sw');
    case 'ha': return t('uiLanguage.names.ha');
    case 'am': return t('uiLanguage.names.am');
    case 'hi': return t('uiLanguage.names.hi');
    case 'bn': return t('uiLanguage.names.bn');
    case 'ne': return t('uiLanguage.names.ne');
    case 'id': return t('uiLanguage.names.id');
    case 'zh-Hans': return t('uiLanguage.names.zhHans');
    case 'th': return t('uiLanguage.names.th');
    case 'my': return t('uiLanguage.names.my');
  }
}

export function LanguageSheet(props: { visible: boolean; onClose: () => void }) {
  const [changing, setChanging] = useState(false);
  const chosen = chosenLanguage();
  const phone = phoneLanguage();
  const pick = (code: UiLanguage | null) => {
    setChanging(true);
    // Let the sheet say so before the app restarts.
    setTimeout(() => chooseLanguage(code), 50);
  };
  const follow = Platform.OS === 'web' ? t('uiLanguage.browserLanguage') : t('uiLanguage.phoneLanguage');
  return (
    <Sheet visible={props.visible} title={t('uiLanguage.title')} sub={t('uiLanguage.help')} onClose={props.onClose}>
      {changing ? <Text style={txt.body} accessibilityRole="alert">{t('uiLanguage.restarting')}</Text> : (
        <View style={styles.list}>
          <Row label={follow} sub={t('uiLanguage.phoneLanguageSub', { language: languageInfo(phone ?? 'en').name })}
            role="radio" selected={!chosen} onPress={() => pick(null)}
            right={!chosen ? <Ico name="check" size={22} color={C.primary} /> : <View style={styles.noMark} />} />
          {UI_LANGUAGES.map((l, i) => (
            <Row key={l.code} label={l.name} sub={l.code === currentLanguage() ? undefined : nameHere(l.code)}
              role="radio" selected={chosen === l.code} onPress={() => pick(l.code)}
              {...(l.approved ? {} : { badge: t('uiLanguage.draftBadge'), badgeTone: 'amber' as const })}
              right={chosen === l.code ? <Ico name="check" size={22} color={C.primary} /> : <View style={styles.noMark} />}
              last={i === UI_LANGUAGES.length - 1} />
          ))}
        </View>
      )}
      {UI_LANGUAGES.some((l) => !l.approved) ? <Text style={txt.xs}>{t('uiLanguage.draftNote')}</Text> : null}
    </Sheet>
  );
}

/** Me's row: the language showing, by its own name. */
export function LanguageRow(props: { last?: boolean }) {
  const [open, setOpen] = useState(false);
  const info = languageInfo(currentLanguage());
  return (
    <>
      <Row icon="globe" label={t('uiLanguage.row')} sub={info.approved ? info.name : t('uiLanguage.draftSub', { language: info.name })}
        onPress={() => setOpen(true)} {...(props.last ? { last: true } : {})} />
      <LanguageSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** A small globe and the language's name, for screens before sign-in. */
export function LanguageChip() {
  const [open, setOpen] = useState(false);
  const info = languageInfo(currentLanguage());
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={t('uiLanguage.chipLabel', { language: info.name })}
        style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}>
        <Ico name="globe" size={18} color={C.primary} />
        <Text style={styles.chipText}>{info.name}</Text>
        <Ico name="down" size={16} color={C.muted} />
      </Pressable>
      <LanguageSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  list: { backgroundColor: C.card, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  chip: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: target.min, paddingHorizontal: space.md, borderRadius: radius.full },
  chipText: { fontSize: 15, fontWeight: '700', color: C.primary },
  // A choice, not a way somewhere: no chevron, the same width as the check.
  noMark: { width: 22 }
});
