// The passage path as Ryder drew it (decision 71; demo a-path, a-pathFeedback,
// a-pathLesson): the recording's own steps numbered down a line, the lit
// one in a card, then the team's checks under "Then the team". The steps
// come from pathModel.ts; this only draws them.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useHelpSpot } from '../helpContext';
import { HelpBadge } from '../helpBadge';
import { Ico, txt, type IconName } from '../kit';
import { C, radius, space, target, TINT } from '../theme';
import type { PathStep, PathStepKind, TeamStep } from './pathModel';

const STEP_ICON: Record<PathStepKind, IconName> = { study: 'star', record: 'mic', publish: 'send', feedback: 'chat', fix: 'mic' };

/** What each step does, as help mode says it. */
const STEP_HELP: Record<PathStepKind, string> = {
  study: 'Go through the study guide together before you record. Nothing waits on it.',
  record: 'Record the passage in your language. As many tries as you like.',
  publish: 'Publishing saves your version for the team to hear, then you ask for a check.',
  feedback: 'Someone listened and asked for changes. Hear what they said.',
  fix: 'Record a new version with the change, or keep this one and say why.'
};

function Dot(props: { n: number; state: PathStep['state'] }) {
  const { state } = props;
  if (state === 'done') {
    return <View style={[styles.dot, { backgroundColor: C.green }]}><Ico name="check" size={22} color={C.white} strokeWidth={3} /></View>;
  }
  if (state === 'current') {
    return <View style={[styles.dot, { backgroundColor: C.primary }]}><Text style={[styles.dotNum, { color: C.white }]}>{props.n}</Text></View>;
  }
  if (state === 'passed') {
    return <View style={[styles.dot, styles.dotTodo]}><Text style={[styles.dotNum, { color: C.faint }]}>–</Text></View>;
  }
  return <View style={[styles.dot, styles.dotTodo]}><Text style={[styles.dotNum, { color: C.muted }]}>{props.n}</Text></View>;
}

function StepRow(props: {
  step: PathStep;
  n: number;
  last: boolean;
  lineDone: boolean;
  onPress?: (() => void) | undefined;
  /** Inside the lit step's card: a note to hear, the feedback. */
  extra?: ReactNode;
}) {
  const { step } = props;
  const lit = step.state === 'current';
  const spot = useHelpSpot(step.title, STEP_HELP[step.kind], props.onPress);
  const press = spot.onPress;
  const body = (
    <View style={lit ? styles.litCard : styles.plain}>
      <View style={styles.titleRow}>
        <Ico name={STEP_ICON[step.kind]} size={20} color={step.state === 'done' ? C.dark : lit ? C.primary : C.muted} />
        <Text style={[styles.stepTitle, step.state === 'todo' || step.state === 'passed' ? { color: C.muted } : null]}>{step.title}</Text>
      </View>
      <Text style={[txt.smMuted, { marginTop: 2 }]}>{step.sub}</Text>
      {props.extra ? <View style={{ marginTop: space.sm }}>{props.extra}</View> : null}
    </View>
  );
  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        <Dot n={props.n} state={step.state} />
        {!props.last ? <View style={[styles.line, { backgroundColor: props.lineDone ? C.green : C.border }]} /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingBottom: props.last ? 0 : space.lg }}>
        {press ? (
          <Pressable onPress={press} accessibilityRole="button" accessibilityLabel={`${props.n}. ${step.title}. ${step.sub}`}
            accessibilityState={{ selected: lit }} style={({ pressed }) => pressed && { opacity: 0.75 }}>
            {body}
            <HelpBadge n={spot.n} current={spot.current} />
          </Pressable>
        ) : body}
      </View>
    </View>
  );
}

function TeamRow(props: { step: TeamStep; onPress?: () => void }) {
  const { step } = props;
  const spot = useHelpSpot(step.name, `A check by the team: ${step.status}. Tap for who and the options.`, props.onPress);
  const press = spot.onPress;
  const icon: IconName = step.state === 'done' ? 'check' : step.state === 'locked' || step.checkpoint ? 'lock' : step.state === 'attention' ? 'chat' : step.state === 'waiting' ? 'clock' : 'people';
  const color = step.state === 'done' ? TINT.greenText : step.state === 'attention' ? TINT.amberText : step.state === 'waiting' ? C.primary : C.faint;
  return (
    <Pressable onPress={press} disabled={!press} accessibilityRole="button" accessibilityLabel={`${step.name}, ${step.status}`}
      style={({ pressed }) => [styles.teamRow, pressed && { opacity: 0.7 }]}>
      <Ico name={icon} size={20} color={color} strokeWidth={step.state === 'done' ? 3 : 2.2} />
      <HelpBadge n={spot.n} current={spot.current} />
      <Text style={[styles.teamName, { flex: 1 }]}>
        {step.name}{'  '}
        <Text style={[txt.smMuted, { fontWeight: '400' }, step.state === 'attention' ? { color: TINT.amberText } : null]}>{step.status}</Text>
      </Text>
    </Pressable>
  );
}

export function PassagePath(props: {
  steps: PathStep[];
  team: TeamStep[];
  onStep: (step: PathStep) => (() => void) | undefined;
  onTeamStep: (step: TeamStep) => (() => void) | undefined;
  /** Shown inside the lit step's card. */
  extraFor: (step: PathStep) => ReactNode;
}) {
  return (
    <View>
      {props.steps.map((s, i) => (
        <StepRow key={s.kind} step={s} n={i + 1} last={i === props.steps.length - 1}
          lineDone={s.state === 'done' && props.steps[i + 1]?.state !== undefined && props.steps[i + 1]!.state !== 'todo'}
          onPress={props.onStep(s)} extra={props.extraFor(s)} />
      ))}
      {props.team.length > 0 ? (
        <View style={styles.team}>
          <Text style={[txt.label, { marginBottom: space.xs }]}>Then the team</Text>
          {props.team.map((t) => <TeamRow key={t.stepId} step={t} {...(props.onTeamStep(t) ? { onPress: props.onTeamStep(t)! } : {})} />)}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md },
  rail: { width: 44, alignItems: 'center' },
  line: { flex: 1, width: 3, borderRadius: 2, marginTop: space.xs, minHeight: 12 },
  dot: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  dotTodo: { backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border },
  dotNum: { fontSize: 17, fontWeight: '800' },
  plain: { paddingTop: 10, minHeight: target.min },
  litCard: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: 2, borderColor: C.primary, padding: space.lg, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stepTitle: { fontSize: 19, fontWeight: '800', color: C.dark, flexShrink: 1 },
  team: { marginTop: space.xl, paddingTop: space.lg, borderTopWidth: 1.5, borderColor: C.border, borderStyle: 'dashed', gap: 2 },
  teamRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.min },
  teamName: { fontSize: 17, fontWeight: '700', color: C.dark }
});
