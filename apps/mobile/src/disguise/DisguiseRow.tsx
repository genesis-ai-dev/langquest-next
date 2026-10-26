// More settings › App icon (decisions.md 169): LangQuest's own icon, or one
// of five calculators or five notepads with a code. Choosing one asks for the
// code, then has it typed on the calculator or notepad itself, which is how
// the app will open from then on: the try teaches it, and nothing changes
// until it has worked. LangQuest's own tile takes the disguise off.
import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, View, useWindowDimensions, type ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { failureMessage } from '../diagnostics/report';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { Field, GhostBtn, IconBtn, Ico, PrimaryBtn, Row, Sheet } from '../ui/kit';
import { ModalCover } from '../ui/ModalCover';
import { Text } from '../ui/text';
import { C, measure, radius, space } from '../ui/theme';
import { txt } from '../ui/textStyles';
import { dropDisguise, ICONS_HERE, wearDisguise } from './disguise';
import { codeAllowed, digitsOnly, lookName, LOOKS, tileLabel, type Look } from './disguiseModel';
import { DisguiseFace } from './faces';
import { useDisguise } from './useDisguise';

/** Metro needs each picture named outright. */
const PREVIEWS: Record<string, ImageSourcePropType> = {
  calculator1: require('../../assets/disguise/calculator1/preview.png') as ImageSourcePropType,
  calculator2: require('../../assets/disguise/calculator2/preview.png') as ImageSourcePropType,
  calculator3: require('../../assets/disguise/calculator3/preview.png') as ImageSourcePropType,
  calculator4: require('../../assets/disguise/calculator4/preview.png') as ImageSourcePropType,
  calculator5: require('../../assets/disguise/calculator5/preview.png') as ImageSourcePropType,
  notes1: require('../../assets/disguise/notes1/preview.png') as ImageSourcePropType,
  notes2: require('../../assets/disguise/notes2/preview.png') as ImageSourcePropType,
  notes3: require('../../assets/disguise/notes3/preview.png') as ImageSourcePropType,
  notes4: require('../../assets/disguise/notes4/preview.png') as ImageSourcePropType,
  notes5: require('../../assets/disguise/notes5/preview.png') as ImageSourcePropType
};
const OWN_ICON = require('../../assets/icon.png') as ImageSourcePropType;

const TILE = 64;
const GAP = space.sm;
/** The ring round a chosen tile, and the room it takes. */
const FRAME = 6;

type Step = { at: 'look' } | { at: 'code'; look: Look } | { at: 'try'; look: Look; code: string };

export function DisguiseRow(props: { ctx: Ctx; last?: boolean }) {
  const { look } = useDisguise();
  const [step, setStep] = useState<Step | null>(null);
  if (!ICONS_HERE) return null;
  return (
    <>
      <Row icon="phone" label={t('disguise.row')} sub={lookName(look)} help={t('disguise.rowHelp')} onPress={() => setStep({ at: 'look' })} last={props.last} />
      {step ? <DisguiseSheet ctx={props.ctx} step={step} setStep={setStep} /> : null}
    </>
  );
}

function DisguiseSheet(props: { ctx: Ctx; step: Step; setStep: (s: Step | null) => void }) {
  const { ctx, step, setStep } = props;
  const { look: worn } = useDisguise();
  const [code, setCode] = useState('');
  // Five across, as wide as the sheet allows.
  const { width } = useWindowDimensions();
  const size = Math.min(TILE, (Math.min(width, measure.sheet) - space.xl * 2 - GAP * 4) / 5 - FRAME * 2);
  const close = () => setStep(null);
  async function takeOff() {
    if (!worn) return close();
    try {
      await dropDisguise();
      ctx.toast(t('disguise.off'));
    } catch (e) {
      // i18n-ignore: log label
      ctx.toast(failureMessage('drop disguise', e));
    }
    close();
  }
  async function wear(look: Look, chosen: string) {
    try {
      await wearDisguise(look, chosen);
      ctx.toast(t('disguise.on', { name: lookName(look) }));
    } catch (e) {
      // i18n-ignore: log label
      ctx.toast(failureMessage('wear disguise', e));
    }
    close();
  }
  if (step.at === 'look') {
    return (
      <Sheet visible title={t('disguise.title')} onClose={close}>
        {/* LangQuest's own on a row of its own, then the calculators, then the notepads. */}
        <LookTile source={OWN_ICON} label={t('disguise.langquest')} help={t('disguise.ownHelp')} chosen={!worn} size={size} onPress={() => void takeOff()} />
        {(['calculator', 'notes'] as const).map((kind) => (
          <View key={kind} style={styles.row}>
            {LOOKS.filter((l) => l.kind === kind).map((l) => (
              <HelpRow key={l.id} of="disguise.look">
                <LookTile source={PREVIEWS[l.id]!} label={tileLabel(l)} help={t('disguise.lookHelp')} chosen={worn?.id === l.id} size={size}
                  onPress={() => { setCode(''); setStep({ at: 'code', look: l }); }} />
              </HelpRow>
            ))}
          </View>
        ))}
      </Sheet>
    );
  }
  const ready = codeAllowed(code);
  const next = () => { if (ready) setStep({ at: 'try', look: step.look, code }); };
  return (
    <Sheet visible title={t('disguise.codeTitle')} onClose={close} onBack={() => setStep({ at: 'look' })}
      footer={(
        <>
          <PrimaryBtn label={t('common.next')} help={t('disguise.nextHelp')} disabled={!ready} onPress={next} />
          <GhostBtn label={t('common.back')} help={t('disguise.backHelp')} onPress={() => setStep({ at: 'look' })} />
        </>
      )}>
      <View style={styles.chosen}>
        <Image source={PREVIEWS[step.look.id]!} style={styles.chosenIcon} accessibilityIgnoresInvertColors />
        <Text style={txt.title}>{lookName(step.look)}</Text>
      </View>
      <Field label={t('disguise.code')} value={code} onChangeText={(v) => setCode(digitsOnly(v))} secure keyboardType="number-pad"
        help={t('disguise.codeHelp')} onSubmit={next} testID="disguise-code" />
      {step.at === 'try' ? (
        <TryCode look={step.look} code={step.code} onBack={() => setStep({ at: 'code', look: step.look })} onDone={() => void wear(step.look, step.code)} />
      ) : null}
    </Sheet>
  );
}

function LookTile(props: { source: ImageSourcePropType; label: string; help: string; chosen: boolean; size: number; onPress: () => void }) {
  const spot = useHelpSpot(props.label, props.help, props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="radio" accessibilityLabel={props.label} accessibilityState={{ selected: props.chosen }}
      style={({ pressed }) => [styles.tile, props.chosen && styles.tileChosen, pressed && { opacity: 0.7 }]}>
      <Image source={props.source} style={[styles.icon, { width: props.size, height: props.size, borderRadius: props.size * 0.23 }]} accessibilityIgnoresInvertColors />
      {props.chosen ? <View style={styles.check}><Ico name="check" size={14} color={C.white} strokeWidth={3} /></View> : null}
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/**
 * The new code typed on the calculator or notepad itself, full screen, as
 * the app will open from now on. Typing it puts the disguise on.
 */
function TryCode(props: { look: Look; code: string; onBack: () => void; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const top = (tone: string) => (
    <View style={[styles.tryTop, { paddingTop: insets.top > 0 ? 0 : space.sm }]}>
      <IconBtn name="close" label={t('common.back')} help={t('disguise.backHelp')} onPress={props.onBack} bg="transparent" color={tone} />
      <Text style={[txt.title, { color: tone, flex: 1 }]}>{t('disguise.tryTitle')}</Text>
    </View>
  );
  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={props.onBack} statusBarTranslucent navigationBarTranslucent>
      <DisguiseFace kind={props.look.kind} length={props.code.length} top={top}
        onCandidate={(candidate) => { if (candidate !== props.code) return false; props.onDone(); return true; }} />
      <ModalCover />
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: GAP },
  tile: { alignSelf: 'flex-start', padding: 3, borderRadius: radius.lg + 3, borderWidth: 3, borderColor: 'transparent' },
  tileChosen: { borderColor: C.primary },
  icon: { borderRadius: radius.lg },
  check: { position: 'absolute', top: -6, right: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: C.primary, borderWidth: 2, borderColor: C.white, alignItems: 'center', justifyContent: 'center' },
  chosen: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  chosenIcon: { width: 48, height: 48, borderRadius: radius.md },
  tryTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.sm }
});
