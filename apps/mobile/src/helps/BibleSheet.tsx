import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { Ico, Sheet } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { chipLabel } from '../sources/sourceText';
import { useChipMarks } from '../sources/useSources';
import { C, radius, space, target } from '../ui/theme';
import { languageLabel } from '../admin/adminModel';
import { styles as ps } from '../recording/blockStyles';
import { a11yState } from '../ui/a11yModel';
import type { useBible } from './useBible';

export type Bible = ReturnType<typeof useBible>;

/** Choose a Bible for the passage: the ones offered here, with what each has. */
export function BibleSheet(props: { ctx: Ctx; bible: Bible; onClose: () => void; onMoreBibles?: () => void }) {
  const { bible } = props;
  const marks = useChipMarks(props.ctx, bible.passage);
  return (
    <Sheet visible title={t('reference.bible.choose')} sub={t('reference.bible.chooseSub')} onClose={props.onClose}>
      <View style={styles.card}>
        {bible.passage.options.map((o, i, all) => (
          <HelpRow key={o.itemId} of="reference.bible">
            <BibleRow label={chipLabel(o, all)} sub={[o.name, languageLabel(o.language), ...(marks[o.itemId] ?? [])].filter(Boolean).join(' · ')} on={o.itemId === bible.option?.itemId}
              help={o.itemId === bible.option?.itemId ? t('reference.bible.rowOnHelp') : t('reference.bible.rowHelp')}
              last={i === all.length - 1 && !props.onMoreBibles} onPress={() => { bible.choose(o); props.onClose(); }} />
          </HelpRow>
        ))}
        {props.onMoreBibles ? <BibleRow label={t('sources.reader.moreBibles')} sub={t('reference.bible.moreBiblesSub')} more last onPress={props.onMoreBibles} /> : null}
      </View>
    </Sheet>
  );
}

function BibleRow(props: { label: string; sub: string; on?: boolean; more?: boolean; last?: boolean; onPress: () => void;
  /** What help mode says picking it does, where `sub` is what it has. */ help?: string }) {
  const spot = useHelpSpot(props.label, props.help ?? props.sub, props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole={props.more ? 'button' : 'radio'} {...a11yState(props.more ? undefined : { selected: !!props.on }, props.more ? 'button' : 'radio')}
      style={({ pressed }) => [styles.bibleRow, !props.last && ps.rowBorder, pressed && ps.pressed]}>
      <Ico name={props.more ? 'plus' : 'book'} size={20} color={C.primary} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[txt.body, { fontWeight: '700', color: props.more ? C.primary : C.dark }]}>{props.label}</Text>
        <Text style={txt.xs}>{props.sub}</Text>
      </View>
      {props.on ? <Ico name="check" size={20} color={C.primary} strokeWidth={3} /> : null}
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  bibleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.row, paddingHorizontal: space.lg, paddingVertical: space.sm },
});
