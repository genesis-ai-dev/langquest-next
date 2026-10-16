// Steps that make something (decisions.md 126; demo branch
// caleb-written-translations wStepPick, wStepOwn, wStepFinal): in a
// language's checks, a step can turn recording or writing into recording or
// writing, in the team's language or another. What it makes stays beside
// the version, is added to it, or becomes the next version (demo wJoinStep,
// wJoinRules). Ready-made ones come first, each drawn as what it turns and
// what it makes (a microphone or a pen) and the language; "Make your own"
// sets the choices. A shared flow never names a language: "another" is the
// team's reference language unless the language's own copy of the step
// says which.
import {
  defaultResult, MAKING_PRESETS, resultAllowed,
  type KindDef, type MakesResult, type MakesSpec, type Medium
} from '@langquest-next/core';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { Chip, ChipRow, Field, Group, Ico, PrimaryBtn, Row, SectionLabel, Sheet, type IconName } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { languageLabel } from '../admin/adminModel';
import { C, radius, space, TINT } from '../ui/theme';
import { presetName } from './namesModel';

type Side = Medium | 'either';

/** Recording into writing, drawn: a microphone or a pen, an arrow, and the language. */
export function MakesLine({ makes, language }: { makes: Pick<MakesSpec, 'from' | 'to' | 'language'>; language: string }) {
  const dot = (side: Side) => {
    const written = side === 'writing';
    return (
      <View style={[styles.dot, { backgroundColor: written ? TINT.green : side === 'either' ? TINT.gray : C.light }]}>
        {side === 'either' ? <Text style={styles.either}>…</Text> : <Ico name={written ? 'edit' : 'mic'} size={16} color={written ? TINT.greenText : C.primary} />}
      </View>
    );
  };
  return (
    <View style={styles.line} accessibilityLabel={t('writing.step.readsLine', { from: sideName(makes.from), to: sideName(makes.to), language })}>
      {dot(makes.from)}
      <Ico name="arrowR" size={14} color={C.muted} />
      {dot(makes.to)}
      <View style={styles.lang}><Text style={styles.langText} numberOfLines={1}>{language}</Text></View>
    </View>
  );
}

function sideName(side: Side): string {
  return side === 'recording' ? t('writing.step.recording') : side === 'writing' ? t('writing.step.writing') : t('writing.step.either');
}

/** The ready-made making steps, for Add a step. */
export function MakingPresets(props: { taken: string[]; own: string; reference: string; onPick: (k: KindDef, makes: MakesSpec) => void; onOwn: () => void }) {
  const left = MAKING_PRESETS.filter((p) => !props.taken.includes(p.id));
  return (
    <>
      <SectionLabel label={t('writing.step.makeSomething')} />
      <Group>
        {left.map((p, i) => (
          <Row key={p.id} leading={<MakesLine makes={p.makes} language={p.makes.language === 'same' ? props.own : languageLabel(props.reference)} />}
            label={presetName(p.id)} sub={p.makes.language === 'same' ? t('writing.step.ownLanguage') : t('writing.step.referenceLanguage')}
            onPress={() => props.onPick({ id: p.id, name: presetName(p.id), description: '', usualReviewer: '' }, { ...p.makes })} last={i === left.length - 1} />
        ))}
      </Group>
      <OwnButton onPress={props.onOwn} />
    </>
  );
}

function OwnButton({ onPress }: { onPress: () => void }) {
  const spot = useHelpSpot(t('writing.step.makeYourOwn'), t('writing.step.makeYourOwnHint'), onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" style={({ pressed }) => [styles.dashed, pressed && { opacity: 0.7 }]}>
      <Ico name="plus" size={20} color={C.primary} />
      <Text style={[txt.body, { color: C.primary, fontWeight: '700' }]}>{t('writing.step.makeYourOwn')}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/**
 * The choices, for Make your own and for a making step's editor: what it
 * turns, into what, in which language, and what happens to what it makes.
 * `warning`: why the result may not do what the admin expects here (words
 * added before a step that makes the new version stay with the older one).
 */
export function MakesFields(props: { makes: MakesSpec; own: string; reference: string; onChange: (m: MakesSpec) => void; disabled?: boolean; warning?: string }) {
  const { makes } = props;
  const set = (patch: Partial<MakesSpec>) => {
    const next = { ...makes, ...patch };
    if (next.language === 'same') delete next.otherLanguage;
    // The result follows the choices until someone picks it (decisions.md 126); it never stays where it cannot be.
    const result: MakesResult = 'result' in patch ? patch.result! : ('from' in patch || 'to' in patch || 'language' in patch) ? defaultResult(next) : next.result;
    props.onChange({ ...next, result: resultAllowed(next, result) ? result : 'beside' });
  };
  const sides = (value: Side, onPick: (s: Side) => void, last: string, help: string) => (
    <ChipRow>
      <Chip label={t('writing.step.recording')} icon="mic" on={value === 'recording'} help={help} onPress={() => !props.disabled && onPick('recording')} />
      <Chip label={t('writing.step.writing')} icon="edit" on={value === 'writing'} help={help} onPress={() => !props.disabled && onPick('writing')} />
      <Chip label={last} on={value === 'either'} help={help} onPress={() => !props.disabled && onPick('either')} />
    </ChipRow>
  );
  const option = (result: MakesResult, icon: IconName, title: string, sub: string, off: string) => {
    const allowed = resultAllowed(makes, result);
    return (
      <ResultOption key={result} icon={icon} title={title} sub={allowed ? sub : off} on={makes.result === result} allowed={allowed && !props.disabled}
        onPress={() => set({ result })} />
    );
  };
  return (
    <View style={{ gap: space.sm }}>
      <SectionLabel label={t('writing.step.turn')} />
      {sides(makes.from, (from) => set({ from }), t('writing.step.either'), t('writing.help.turn'))}
      <SectionLabel label={t('writing.step.into')} />
      {sides(makes.to, (to) => set({ to }), t('writing.step.theyPick'), t('writing.help.into'))}
      <SectionLabel label={t('writing.step.in')} />
      <ChipRow>
        <Chip label={props.own} on={makes.language === 'same'} help={t('writing.help.inOwn')} onPress={() => !props.disabled && set({ language: 'same' })} />
        <Chip label={languageLabel(makes.otherLanguage ?? props.reference)} icon="globe" on={makes.language === 'other'} help={t('writing.help.inOther')} onPress={() => !props.disabled && set({ language: 'other' })} />
      </ChipRow>
      <SectionLabel label={t('writing.step.result.title')} />
      <View style={{ gap: space.sm }} accessibilityRole="radiogroup">
        {option('beside', 'layers', t('writing.step.result.beside'), t('writing.step.result.besideSub'), '')}
        {option('added', 'link', t('writing.step.result.added'), t('writing.step.result.addedSub'), t('writing.step.result.addedOff'))}
        {option('version', 'swap', t('writing.step.result.version'), t('writing.step.becomesVersionSub'), t('writing.step.becomesVersionOff'))}
      </View>
      {props.warning ? (
        <View style={styles.warning}>
          <Ico name="warning" size={18} color={TINT.amberText} />
          <Text style={[txt.sm, { flex: 1, color: TINT.amberText }]}>{props.warning}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** One of what can happen to what a step makes: a card with a radio, greyed with the reason when it cannot apply. */
function ResultOption(props: { icon: IconName; title: string; sub: string; on: boolean; allowed: boolean; onPress: () => void }) {
  const spot = useHelpSpot(props.title, props.sub, props.onPress);
  return (
    <Pressable onPress={props.allowed ? spot.onPress : undefined} accessibilityRole="radio" accessibilityState={{ checked: props.on, disabled: !props.allowed }}
      accessibilityLabel={`${props.title}. ${props.sub}`}
      style={({ pressed }) => [styles.option, props.on && styles.optionOn, !props.allowed && styles.optionOff, pressed && props.allowed && { opacity: 0.7 }]}>
      <View style={[styles.optionIcon, !props.allowed && { backgroundColor: TINT.gray }]}>
        <Ico name={props.icon} size={20} color={props.allowed ? C.primary : C.faint} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[txt.body, { fontWeight: '800', color: props.allowed ? C.dark : C.muted }]}>{props.title}</Text>
        {props.sub ? <Text style={txt.smMuted}>{props.sub}</Text> : null}
      </View>
      <View style={[styles.radio, props.on && styles.radioOn]} />
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** Make your own: the choices, a name to call it, then Add. */
export function MakeStepSheet(props: { visible: boolean; own: string; reference: string; onClose: () => void; onAdd: (name: string, makes: MakesSpec) => void }) {
  const [makes, setMakes] = useState<MakesSpec>({ from: 'recording', to: 'writing', language: 'other', result: 'beside' });
  const [name, setName] = useState('');
  return (
    <Sheet visible={props.visible} title={t('writing.step.makeYourOwn')} onClose={props.onClose}
      footer={<PrimaryBtn label={t('writing.step.add')} icon="plus" disabled={!name.trim()} onPress={() => { props.onAdd(name.trim(), makes); setName(''); }} />}>
      <MakesFields makes={makes} own={props.own} reference={props.reference} onChange={setMakes} />
      <Field label={t('writing.step.name')} value={name} onChangeText={setName} placeholder={t('writing.step.namePlaceholder')} autoCapitalize="sentences" />
      <View style={styles.preview}>
        <MakesLine makes={makes} language={makes.language === 'same' ? props.own : languageLabel(props.reference)} />
        <Text style={[txt.smMuted, { flex: 1 }]}>{makes.result === 'version' ? t('writing.step.previewVersion') : makes.result === 'added' ? t('writing.step.previewAdded') : t('writing.step.previewBeside')}</Text>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  either: { fontSize: 16, fontWeight: '800', color: C.muted },
  lang: { marginLeft: 4, maxWidth: 88, paddingHorizontal: 7, height: 24, borderRadius: radius.sm, backgroundColor: TINT.gray, justifyContent: 'center' },
  langText: { fontSize: 12, fontWeight: '800', color: C.dark },
  dashed: { minHeight: 52, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.faint, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  preview: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border },
  option: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.xl, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  optionOn: { borderWidth: 2, borderColor: C.primary },
  optionOff: { backgroundColor: 'transparent', borderStyle: 'dashed', borderColor: C.faint },
  optionIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: C.faint, backgroundColor: C.card },
  radioOn: { borderWidth: 7, borderColor: C.primary },
  warning: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: TINT.amber }
});
