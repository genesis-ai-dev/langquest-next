// Who checks, top to bottom (decision 71, demo ADR-039; the prototype's
// FlowEdit): one card per step with a grip to move it, its number, what it
// is, who usually does it, and a lock for a step that must pass before the
// next ones. Used by the flow editor for a language's own steps and for a
// library flow alike (screens/config.tsx FlowEditor). Dragging the grip
// moves a step; a screen reader gets Move up and Move down instead, and a
// tap on a card opens what else can be done with the step.
import type { KindDef } from '@langquest-next/core';
import { useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../text';
import { useHelpSpot } from '../helpContext';
import { HelpBadge } from '../helpBadge';
import { t } from '../i18n';
import { Ico, txt } from '../kit';
import { C, space } from '../theme';
import { DashedRow, LockToggle } from './admin';
import { dropIndex, moveTo, stepTitle } from './adminModel';

export interface CheckStep {
  key: string;
  kindIds: string[];
  checkpoint: boolean;
}

function StepCard(props: {
  step: CheckStep; i: number; count: number; kinds: KindDef[]; usually: string; readOnly: boolean; height: number;
  onLayout: (h: number) => void; onMove: (to: number) => void; onLock: () => void; onOpen: () => void;
}) {
  const { step, i } = props;
  const title = stepTitle(step.kindIds, props.kinds) || t('review.checkSteps.aStep');
  const [dy, setDy] = useState(0);
  const latest = useRef(props);
  latest.current = props;
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !latest.current.readOnly,
    onMoveShouldSetPanResponder: () => !latest.current.readOnly,
    onPanResponderMove: (_e, g) => setDy(g.dy),
    onPanResponderRelease: (_e, g) => {
      const p = latest.current;
      setDy(0);
      const to = dropIndex(p.i, g.dy, p.height, p.count);
      if (to !== p.i) p.onMove(to);
    },
    onPanResponderTerminate: () => setDy(0)
  })).current;
  const open = useHelpSpot(title, t('review.checkSteps.openHelp', { who: props.usually }), props.onOpen);
  return (
    <View onLayout={(e) => props.onLayout(e.nativeEvent.layout.height)}
      style={[styles.card, dy !== 0 && { transform: [{ translateY: dy }], zIndex: 2, borderColor: C.primary }]}>
      <View {...pan.panHandlers} style={styles.grip} accessibilityRole="adjustable" accessibilityLabel={t('review.checkSteps.move', { title })}
        accessibilityActions={props.readOnly ? [] : [{ name: 'increment', label: t('review.checkSteps.moveDown') }, { name: 'decrement', label: t('review.checkSteps.moveUp') }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'decrement' && i > 0) props.onMove(i - 1);
          if (e.nativeEvent.actionName === 'increment' && i < props.count - 1) props.onMove(i + 1);
        }}>
        <Ico name="grip" size={22} color={C.faint} />
      </View>
      <Pressable onPress={open.onPress} disabled={props.readOnly && !props.onOpen} accessibilityRole="button" accessibilityLabel={t('review.checkSteps.cardA11y', { n: i + 1, title, who: props.usually })}
        style={({ pressed }) => [styles.body, pressed && { opacity: 0.7 }]}>
        <View style={styles.num}><Text style={styles.numText}>{i + 1}</Text></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={[txt.xs, { fontSize: 14 }]} numberOfLines={2}>{t('review.checkSteps.usually', { who: props.usually })}</Text>
        </View>
        <HelpBadge spot={open} />
      </Pressable>
      <LockToggle on={step.checkpoint} onToggle={props.onLock} disabled={props.readOnly}
        label={step.checkpoint ? t('review.checkSteps.mustPass', { title }) : t('review.checkSteps.canSetAside', { title })} />
    </View>
  );
}

/** The steps, "A translator records a version" above them, Add a step and the lock's meaning below. */
export function CheckSteps(props: {
  steps: CheckStep[];
  kinds: KindDef[];
  readOnly: boolean;
  usually: (kindIds: string[]) => string;
  onChange: (steps: CheckStep[]) => void;
  onAdd: () => void;
  onOpen: (i: number) => void;
}) {
  const [height, setHeight] = useState(0);
  const { steps } = props;
  return (
    <View style={{ gap: space.sm + 2 }}>
      <View style={styles.start}>
        <View style={styles.mic}><Ico name="mic" size={18} color={C.white} /></View>
        <Text style={[txt.sm, { color: C.muted, fontWeight: '700' }]}>{t('review.checkSteps.translatorRecords')}</Text>
      </View>
      {steps.length === 0 ? (
        <View style={[styles.card, { justifyContent: 'center' }]}>
          <Text style={[txt.sm, { color: C.muted, flex: 1, textAlign: 'center' }]}>{t('review.checkSteps.noChecks')}</Text>
        </View>
      ) : steps.map((st, i) => (
        <StepCard key={st.key} step={st} i={i} count={steps.length} kinds={props.kinds} usually={props.usually(st.kindIds)} readOnly={props.readOnly}
          height={height + space.sm + 2} onLayout={(h) => { if (Math.abs(h - height) > 1) setHeight(h); }}
          onMove={(to) => props.onChange(moveTo(steps, i, to))}
          onLock={() => props.onChange(steps.map((s, j) => (j === i ? { ...s, checkpoint: !s.checkpoint } : s)))}
          onOpen={() => props.onOpen(i)} />
      ))}
      {props.readOnly ? null : <DashedRow icon="plus" label={t('review.checkSteps.addStep')} centred onPress={props.onAdd} detail={t('review.checkSteps.addStepDetail')} />}
      <View style={styles.legend}>
        <Ico name="lock" size={15} color={C.muted} />
        <Text style={[txt.sm, { color: C.muted }]}>{t('review.checkSteps.legend')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  start: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.xs },
  mic: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 68, paddingVertical: space.md, paddingRight: space.md, borderRadius: 18, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border },
  grip: { width: 40, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  num: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  numText: { fontSize: 15, fontWeight: '800', color: C.primary },
  title: { fontSize: 17, fontWeight: '800', color: C.dark, lineHeight: 23 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.xs, flexWrap: 'wrap' }
});
