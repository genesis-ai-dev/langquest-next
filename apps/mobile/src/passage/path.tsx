// The passage path as Ryder drew it (decision 71; demo a-path, a-pathFeedback,
// a-pathLesson): the recording's own steps numbered down a line, the lit
// one in a card, then the team's checks under "Then the team". The steps
// come from pathModel.ts; this only draws them.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { Ico, type IconName } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { C, radius, space, target, TINT } from '../ui/theme';
import type { PathStep, PathStepKind, TeamStep } from './pathModel';
import type { Ctx } from '../shell/ctx';
import { PeopleLine } from '../checks/parts';

const STEP_ICON: Record<PathStepKind, IconName> = { study: 'star', record: 'mic', publish: 'send', feedback: 'chat', fix: 'mic' };

/** What each step does, as help mode says it. */
function stepHelp(kind: PathStepKind): string {
  switch (kind) {
    case 'study': return t('passage.path.help.study');
    case 'record': return t('passage.path.help.record');
    case 'publish': return t('passage.path.help.publish');
    case 'feedback': return t('passage.path.help.feedback');
    case 'fix': return t('passage.path.help.fix');
  }
}

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
  const spot = useHelpSpot(step.title, stepHelp(step.kind), props.onPress);
  const press = spot.onPress;
  // The card's own words are the step's button; what sits inside the lit card (a note or the feedback to
  // play) has buttons of its own, so it stays outside that button (a button in a button breaks the web).
  const head = (
    <>
      <View style={styles.titleRow}>
        <Ico name={STEP_ICON[step.kind]} size={20} color={step.state === 'done' ? C.dark : lit ? C.primary : C.muted} />
        <Text style={[styles.stepTitle, step.state === 'todo' || step.state === 'passed' ? { color: C.muted } : null]}>{step.title}</Text>
      </View>
      <Text style={[txt.smMuted, { marginTop: 2 }]}>{step.sub}</Text>
    </>
  );
  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        <Dot n={props.n} state={step.state} />
        {!props.last ? <View style={[styles.line, { backgroundColor: props.lineDone ? C.green : C.border }]} /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingBottom: props.last ? 0 : space.lg }}>
        <View style={lit ? styles.litCard : styles.plain}>
          {press ? (
            <Pressable testID={`path-step-${step.kind}`} onPress={press} accessibilityRole="button" accessibilityLabel={`${props.n}. ${step.title}. ${step.sub}`}
              accessibilityState={{ selected: lit }} style={({ pressed }) => pressed && { opacity: 0.75 }}>
              {head}
              <HelpBadge spot={spot} />
            </Pressable>
          ) : head}
          {props.extra ? <View style={{ marginTop: space.sm }}>{props.extra}</View> : null}
        </View>
      </View>
    </View>
  );
}

function TeamRow(props: { ctx: Ctx; step: TeamStep; people: string[] | null; onPress?: () => void }) {
  const { step } = props;
  const spot = useHelpSpot(step.name, t('passage.path.help.team', { status: step.status }), props.onPress);
  const press = spot.onPress;
  const icon: IconName = step.state === 'done' ? 'check' : step.state === 'locked' || step.checkpoint ? 'lock' : step.state === 'attention' ? 'chat' : step.state === 'waiting' ? 'clock' : 'people';
  const color = step.state === 'done' ? TINT.greenText : step.state === 'attention' ? TINT.amberText : step.state === 'waiting' ? C.primary : C.faint;
  return (
    <Pressable testID={`team-row-${step.kindId}`} onPress={press} disabled={!press} accessibilityRole="button" accessibilityLabel={`${step.name}, ${step.status}`}
      style={({ pressed }) => [styles.teamRow, pressed && { opacity: 0.7 }]}>
      <Ico name={icon} size={20} color={color} strokeWidth={step.state === 'done' ? 3 : 2.2} />
      <HelpBadge spot={spot} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={styles.teamName}>
          {step.name}{'  '}
          <Text style={[txt.smMuted, { fontWeight: '400' }, step.state === 'attention' ? { color: TINT.amberText } : null]}>{step.status}</Text>
        </Text>
        {props.people && props.people.length ? <PeopleLine ctx={props.ctx} people={props.people} size={22} /> : null}
      </View>
    </Pressable>
  );
}

export function PassagePath(props: {
  ctx: Ctx;
  steps: PathStep[];
  /** Who is on each check (decision 91). */
  peopleOf?: (kindId: string) => string[];
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
          <Text style={[txt.label, { marginBottom: space.xs }]}>{t('passage.path.thenTheTeam')}</Text>
          {props.team.map((step) => (
            <TeamRow key={`${step.stepId}:${step.kindId}`} ctx={props.ctx} step={step} people={props.peopleOf ? props.peopleOf(step.kindId) : null}
              {...(props.onTeamStep(step) ? { onPress: props.onTeamStep(step)! } : {})} />
          ))}
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
