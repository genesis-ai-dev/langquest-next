// New language's six stages as pictures (decisions.md 144): the overview
// before the first question, each stage revealed in turn down one path with
// a small picture of what it sets, and the bar of stages every page after it
// carries, its own stage lit. No sentences: help mode says what each is.
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { HelpInfo, Ico, type IconName } from '../ui/kit';
import { C, radius, space, TINT } from '../ui/theme';
import { STAGES, stageHelp, stageIcon, stageLabel, type Stage } from './stagesModel';

/** The reduce-motion setting: the path is drawn at once when it is on. */
function useStill(): boolean | null {
  const [still, setStill] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => { if (live) setStill(on); }, () => { if (live) setStill(false); });
    return () => { live = false; };
  }, []);
  return still;
}

const NATIVE = Platform.OS !== 'web';

/** The six stages down one path, each coming in after the one before. */
export function StagesPath() {
  const still = useStill();
  const shown = useRef(STAGES.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (still === null) return;
    if (still) { shown.forEach((v) => v.setValue(1)); return; }
    const run = Animated.stagger(260, shown.map((v) => Animated.timing(v, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE })));
    run.start();
    return () => run.stop();
  }, [still, shown]);
  return (
    <View style={styles.path} accessibilityRole="list">
      {/* help-each: each stage is a different step of adding a language */}
      {STAGES.map((s, i) => (
        <Animated.View key={s} style={{ opacity: shown[i], transform: [{ translateY: shown[i]!.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
          <StageStop stage={s} n={i + 1} last={i === STAGES.length - 1} />
        </Animated.View>
      ))}
    </View>
  );
}

function StageStop(props: { stage: Stage; n: number; last: boolean }) {
  const label = stageLabel(props.stage);
  return (
    <HelpInfo label={label} detail={stageHelp(props.stage)} style={styles.stop}>
      <View style={styles.rail} accessible accessibilityLabel={t('org.newLanguage.stageOf', { n: formatNumber(props.n), total: formatNumber(STAGES.length), name: label })}>
        <View style={styles.dot}>
          <Ico name={stageIcon(props.stage)} size={24} color={C.primary} />
          <View style={styles.n}><Text style={styles.nText}>{formatNumber(props.n)}</Text></View>
        </View>
        {props.last ? null : <View style={styles.line} />}
      </View>
      <View style={styles.what}>
        <Text style={styles.label}>{label}</Text>
        <StagePicture stage={props.stage} />
      </View>
    </HelpInfo>
  );
}

/** A small picture of what a stage sets. */
function StagePicture(props: { stage: Stage }) {
  switch (props.stage) {
    case 'language':
      return <View style={styles.row}><Tag icon="link" label={t('org.newLanguage.stages.linkLater')} /></View>;
    case 'content':
      return <View style={styles.row}><Tag icon="book" label={t('org.newLanguage.stages.bible')} /><Tag icon="note" label={t('org.newLanguage.stages.stories')} /></View>;
    case 'pieces':
      return (
        <View style={styles.row}>
          {[34, 22, 40, 28, 18, 30].map((w, i) => <View key={i} style={[styles.piece, { width: w, opacity: 1 - i * 0.09 }]} />)}
        </View>
      );
    case 'material':
      return <View style={styles.row}>{(['book', 'listen', 'star', 'key'] as const).map((n) => <Mini key={n} icon={n} />)}</View>;
    case 'flow':
      return (
        <View style={styles.row}>
          <Mini icon="mic" solid />
          <View style={styles.join} /><Mini icon="check" />
          <View style={styles.join} /><Mini icon="check" />
          <View style={styles.join} /><Mini icon="lock" />
        </View>
      );
    case 'people':
      return (
        <View style={styles.row}>
          {[TINT.green, TINT.amber, C.light].map((bg, i) => (
            <View key={i} style={[styles.face, { backgroundColor: bg, marginLeft: i ? -8 : 0 }]}><Ico name="user" size={15} color={C.dark} /></View>
          ))}
          <View style={[styles.face, styles.plus]}><Ico name="plus" size={15} color={C.white} /></View>
        </View>
      );
  }
}

function Tag(props: { icon: IconName; label: string }) {
  return (
    <View style={styles.tag}>
      <Ico name={props.icon} size={14} color={C.primary} />
      <Text style={styles.tagText}>{props.label}</Text>
    </View>
  );
}

function Mini(props: { icon: IconName; solid?: boolean }) {
  return (
    <View style={[styles.mini, props.solid && { backgroundColor: C.primary }]}>
      <Ico name={props.icon} size={14} color={props.solid ? C.white : C.primary} />
    </View>
  );
}

/**
 * The stages under a page's header: those done ticked, this page's lit and
 * named, those to come faint.
 */
export function StageBar(props: { stage: Stage }) {
  const at = STAGES.indexOf(props.stage);
  const label = stageLabel(props.stage);
  const said = t('org.newLanguage.stageOf', { n: formatNumber(at + 1), total: formatNumber(STAGES.length), name: label });
  return (
    <HelpInfo label={said} detail={t('org.newLanguage.stagesHelp')} style={styles.bar}>
      <View style={styles.barRow} accessible accessibilityRole="progressbar" accessibilityLabel={said}>
        {STAGES.map((s, i) => (
          <View key={s} style={i === 0 ? styles.barFirst : styles.barCell}>
            {i > 0 ? <View style={[styles.barLine, i <= at && { backgroundColor: C.green }]} /> : null}
            <View style={[styles.barDot, i < at ? styles.barDone : i === at ? styles.barNow : null]}>
              <Ico name={i < at ? 'check' : stageIcon(s)} size={15} color={i <= at ? C.white : C.faint} strokeWidth={i < at ? 3 : 2} />
            </View>
          </View>
        ))}
      </View>
      <Text style={styles.barLabel} numberOfLines={2}>{said}</Text>
    </HelpInfo>
  );
}

const DOT = 52;

const styles = StyleSheet.create({
  path: { paddingTop: space.sm },
  stop: { flexDirection: 'row', gap: space.lg, minHeight: 92 },
  rail: { width: DOT, alignItems: 'center' },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  n: { position: 'absolute', top: -4, right: -4, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5, backgroundColor: C.primary,
    borderWidth: 2, borderColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  nText: { color: C.white, fontSize: 12, fontWeight: '800' },
  line: { flex: 1, width: 3, borderRadius: 2, backgroundColor: C.border, marginVertical: 4 },
  what: { flex: 1, minWidth: 0, paddingTop: 4, paddingBottom: space.lg, gap: space.sm },
  label: { fontSize: 19, fontWeight: '800', color: C.dark },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 28, borderRadius: radius.full, backgroundColor: C.card,
    borderWidth: 1, borderColor: C.border },
  tagText: { fontSize: 13, fontWeight: '700', color: C.primary },
  piece: { height: 14, borderRadius: 4, backgroundColor: C.soft },
  mini: { width: 30, height: 30, borderRadius: 9, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  join: { width: 10, height: 2, backgroundColor: C.faint },
  face: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  plus: { backgroundColor: C.primary, marginLeft: 4 },
  bar: { gap: 6 },
  barRow: { flexDirection: 'row', alignItems: 'center' },
  barFirst: { flexDirection: 'row', alignItems: 'center' },
  barCell: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  barLine: { flex: 1, height: 3, borderRadius: 2, backgroundColor: C.border, marginHorizontal: 3 },
  barDot: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  barDone: { backgroundColor: C.green, borderColor: C.green },
  barNow: { backgroundColor: C.primary, borderColor: C.primary },
  barLabel: { fontSize: 14, fontWeight: '700', color: C.primary }
});
