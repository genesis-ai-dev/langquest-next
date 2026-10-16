// The passage path as Ryder drew it (decision 71; demo a-path, a-pathFeedback,
// a-pathLesson): the recording's own steps numbered down a line, the lit
// one in a card, then the team's checks under "Then the team". The steps
// come from pathModel.ts; this only draws them.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { HelpInfo, Ico, type IconName } from '../ui/kit';
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

/** What a step's round mark says (its tick, number or dash), as help mode says it. */
function stateHelp(state: PathStep['state']): string {
  switch (state) {
    case 'done': return t('passage.path.help.state.done');
    case 'current': return t('passage.path.help.state.current');
    case 'todo': return t('passage.path.help.state.todo');
    case 'passed': return t('passage.path.help.state.passed');
  }
}

/** A team row with nothing to tap still explains itself while help is on (its icon and status). */
const INFO = () => undefined;

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
  const detail = t('passage.path.help.withMark', { help: stepHelp(step.kind), mark: stateHelp(step.state) });
  const spot = useHelpSpot(step.title, detail, props.onPress);
  const press = spot.onPress;
  // The card's own words are the step's button; what sits inside the lit card (a note or the feedback to
  // play) has buttons of its own, so it stays outside that button (a button in a button breaks the web).
  const head = (
    <>
      <View style={styles.titleRow}>
        <Ico name={(step.written ? 'edit' : STEP_ICON[step.kind])} size={20} color={step.state === 'done' ? C.dark : lit ? C.primary : C.muted} />
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
          ) : <HelpInfo label={step.title} detail={detail}>{head}</HelpInfo>}
          {props.extra ? <View style={{ marginTop: space.sm }}>{props.extra}</View> : null}
        </View>
      </View>
    </View>
  );
}

/**
 * One check by the team, as its own card with space around it: the state's
 * icon in a round tile, the check's name, what is happening with it, and who
 * does it. Tapping opens the step's sheet when there is something to do there.
 */
function TeamRow(props: { ctx: Ctx; step: TeamStep; people: string[] | null; onPress?: () => void }) {
  const { step } = props;
  const status = props.onPress ? t('passage.path.help.team', { status: step.status }) : t('passage.path.help.teamView', { status: step.status });
  // The lock on a check that must pass says so; the other icons say what the status beside them says.
  const locked = step.checkpoint && step.state !== 'done';
  const spot = useHelpSpot(step.name, locked ? t('passage.path.help.withMark', { help: status, mark: t('passage.path.help.checkpoint') }) : status,
    props.onPress ?? INFO);
  const press = props.onPress || spot.id ? spot.onPress : undefined;
  const icon: IconName = step.state === 'done' ? 'check' : step.state === 'locked' || step.checkpoint ? 'lock' : step.state === 'attention' ? 'chat' : step.state === 'waiting' ? 'clock' : 'people';
  const color = step.state === 'done' ? TINT.greenText : step.state === 'attention' ? TINT.amberText : step.state === 'waiting' ? C.primary : C.faint;
  const tile = step.state === 'done' ? TINT.green : step.state === 'attention' ? TINT.amber : step.state === 'waiting' ? C.light : C.bg;
  return (
    <Pressable testID={`team-row-${step.kindId}`} onPress={press} disabled={!press} accessibilityRole="button" accessibilityLabel={`${step.name}, ${step.status}`}
      style={({ pressed }) => [styles.teamCard, pressed && { opacity: 0.7 }]}>
      <View style={[styles.teamTile, { backgroundColor: tile }]}>
        <Ico name={icon} size={20} color={color} strokeWidth={step.state === 'done' ? 3 : 2.2} />
      </View>
      <HelpBadge spot={spot} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={styles.teamName}>{step.name}</Text>
        <Text style={[txt.smMuted, step.state === 'attention' ? { color: TINT.amberText } : null]}>{step.status}</Text>
        {props.people && props.people.length ? <PeopleLine ctx={props.ctx} people={props.people} size={22} /> : null}
      </View>
      {props.onPress ? <Ico name="right" size={20} color={C.muted} /> : null}
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
      {/* help-each: each step does something different (study, record, publish, feedback) */}
      {props.steps.map((s, i) => (
        <StepRow key={s.kind} step={s} n={i + 1} last={i === props.steps.length - 1}
          lineDone={s.state === 'done' && props.steps[i + 1]?.state !== undefined && props.steps[i + 1]!.state !== 'todo'}
          onPress={props.onStep(s)} extra={props.extraFor(s)} />
      ))}
      {props.team.length > 0 ? (
        <View style={styles.team}>
          <Text style={[txt.label, { marginBottom: space.xs }]}>{t('passage.path.thenTheTeam')}</Text>
          {props.team.map((step) => (
            <HelpRow key={`${step.stepId}:${step.kindId}`} of="path.teamCheck">
              <TeamRow ctx={props.ctx} step={step} people={props.peopleOf ? props.peopleOf(step.kindId) : null}
                {...(props.onTeamStep(step) ? { onPress: props.onTeamStep(step)! } : {})} />
            </HelpRow>
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
  team: { marginTop: space.xl, paddingTop: space.lg, borderTopWidth: 1.5, borderColor: C.border, borderStyle: 'dashed', gap: space.sm + 2 },
  teamCard: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.row, paddingVertical: space.md, paddingHorizontal: space.md + 2,
    borderRadius: radius.lg, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  teamTile: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  teamName: { fontSize: 17, fontWeight: '800', color: C.dark }
});
