// Say it, or write it? (decisions.md 95; demo branch caleb-written-translations
// wBtHow): a making step that lets the person pick asks once, with a big
// picture each, and opens the recorder or the writing boxes.
import type { KindDef } from '@langquest-next/core';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../text';
import type { Ctx } from '../ctx';
import { useHelpSpot } from '../helpContext';
import { HelpBadge } from '../helpBadge';
import { t } from '../i18n';
import { Header, Ico, Screen, txt, type IconName } from '../kit';
import type { PassageView } from '../passageView';
import { languageLabel } from '../simple/adminModel';
import { C, radius, space, TINT } from '../theme';

export function MakeChoice({ ctx, v, kind, language, onPick }: { ctx: Ctx; v: PassageView; kind: KindDef; language?: string; onPick: (m: 'recording' | 'writing') => void }) {
  const into = language ? languageLabel(language) : v.language;
  return (
    <Screen header={<Header title={v.title} sub={t('writing.stepInto', { step: kind.name, language: into })} onBack={ctx.back} close />} bodyStyle={{ gap: space.md }}>
      <Text style={[txt.body, { fontSize: 24, fontWeight: '800' }]}>{t('writing.sayOrWrite')}</Text>
      <Option icon="mic" title={t('writing.sayIt')} sub={t('writing.sayItSub')} onPress={() => onPick('recording')} />
      <Option icon="edit" title={t('writing.writeIt')} sub={t('writing.writeItSub')} onPress={() => onPick('writing')} />
      <Text style={txt.smMuted}>{t('writing.sayOrWriteNote')}</Text>
    </Screen>
  );
}

function Option({ icon, title, sub, onPress }: { icon: IconName; title: string; sub: string; onPress: () => void }) {
  const spot = useHelpSpot(title, sub, onPress);
  const written = icon === 'edit';
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={`${title}. ${sub}`}
      style={({ pressed }) => [styles.option, pressed && { opacity: 0.7 }]}>
      <View style={[styles.circle, { backgroundColor: written ? TINT.green : C.light }]}>
        <Ico name={icon} size={30} color={written ? TINT.greenText : C.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[txt.body, { fontSize: 20, fontWeight: '800' }]}>{title}</Text>
        <Text style={txt.smMuted}>{sub}</Text>
      </View>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', gap: space.lg, padding: space.lg, borderRadius: radius.xl, backgroundColor: C.card, borderWidth: 2, borderColor: C.border },
  circle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' }
});
