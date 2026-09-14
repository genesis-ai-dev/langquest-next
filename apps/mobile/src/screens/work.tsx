// Avatar U for My Work and Open Work; Avatar P for Give Assignment and progress detail.
import { deriveProgress, derivePieces, deriveTasks, type Task, type TaskStatus } from '@langquest-next/core';
import { ArrowRight, BookOpen, Check, Circle, CircleDot, CloudCheck, CloudUpload, Inbox, Menu, Search } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Ctx } from '../ctx';
import { Footer, Header, Note, Row, Screen, Section } from '../pui';
import { colors, radius, space, tint } from '../theme';
import { Card, DualProgressBar, IconCircleButton, RoleBadge, TASK_META, text } from '../ui';

const STATUS_META: Record<TaskStatus, { icon: typeof Circle; color: string }> = {
  todo: { icon: Circle, color: colors.mutedForeground },
  doing: { icon: CircleDot, color: colors.translate },
  done: { icon: Check, color: colors.done }
};

export function AssignmentsHome(ctx: Ctx) {
  const { state, pending } = ctx.project;
  const [filters, setFilters] = useState<TaskStatus[]>(['todo', 'doing']);
  if (!state) return <Text style={[text.muted, styles.pad]}>Opening local log…</Text>;

  const role = ctx.session.role;
  const roleType = role === 'reviewer' ? 'review' : 'translate';
  const laneId = Object.keys(state.lanes)[0] ?? null;
  const progress = laneId ? deriveProgress(state, laneId) : null;
  const tasks = deriveTasks(state, ctx.session.actorId);
  const counts: Record<TaskStatus, number> = { todo: 0, doing: 0, done: 0 };
  for (const t of tasks) counts[t.status] += 1;
  const shown = tasks.filter((t) => filters.includes(t.status));
  const toggle = (s: TaskStatus) => setFilters((f) => (f.includes(s) ? f.filter((x) => x !== s) : [...f, s]));

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.statusRow}>
          <View style={styles.statusChip} accessibilityLabel={ctx.project.lastSync}>
            {pending > 0 ? (
              <>
                <CloudUpload size={16} color={colors.mutedForeground} />
                <Text style={text.small}>{pending}</Text>
              </>
            ) : (
              <CloudCheck size={16} color={colors.done} />
            )}
          </View>
          <View style={{ flexDirection: 'row', gap: space.lg }}>
            <Pressable onPress={() => ctx.go('inbox_home')} hitSlop={8} accessibilityLabel="Inbox">
              <Inbox size={18} color={colors.mutedForeground} />
            </Pressable>
            <Pressable onPress={() => ctx.go('settings_home')} hitSlop={8} accessibilityLabel="Menu">
              <Menu size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>
        </View>

        {state.project ? (
          <Card style={{ backgroundColor: TASK_META[roleType].tint }}>
            <View style={styles.cardHeader}>
              <View style={{ flex: 1, gap: space.xs }}>
                <Text style={text.h4} numberOfLines={1}>
                  {state.project.value.name}
                </Text>
                <Text style={text.muted}>{laneId ? state.lanes[laneId]?.languoidId : 'no lane'}</Text>
              </View>
              <View style={styles.cardActions}>
                <RoleBadge type={roleType} accessibilityLabel={role ?? ''} />
                <IconCircleButton icon={ArrowRight} onPress={() => ctx.go('status_home')} accessibilityLabel="Open status" />
              </View>
            </View>
            {progress ? <DualProgressBar translatedPct={progress.translatedPct} approvedPct={progress.approvedPct} type={roleType} /> : null}
          </Card>
        ) : null}

        <View style={styles.filters}>
          {(['todo', 'doing', 'done'] as TaskStatus[]).map((s) => {
            const on = filters.includes(s);
            const Icon = STATUS_META[s].icon;
            const color = STATUS_META[s].color;
            return (
              <Pressable
                key={s}
                onPress={() => toggle(s)}
                accessibilityRole="button"
                accessibilityLabel={`${s}: ${counts[s]}`}
                accessibilityState={{ selected: on }}
                style={[styles.filter, on && { borderColor: color, backgroundColor: colors.card }]}
              >
                <Icon size={20} color={on ? color : colors.mutedForeground} />
                <Text style={[styles.filterCount, { color: on ? color : colors.mutedForeground }]}>{counts[s]}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.todo}>
          {shown.length === 0 ? (
            <View style={[styles.pad, { alignItems: 'center' }]}>
              <Check size={28} color={colors.done} />
            </View>
          ) : (
            shown.map((task, i) => (
              <TodoRow
                key={task.id}
                task={task}
                label={state.units[task.unitId]?.label ?? task.unitId}
                isLast={i === shown.length - 1}
                onOpen={() => ctx.go(task.type === 'review' ? 'review_passage' : 'translate_passage', { taskId: task.id })}
                onLong={() => ctx.go('assignment_progress_detail', { taskId: task.id })}
              />
            ))
          )}
        </View>

        {role !== 'reviewer' ? (
          <Pressable onPress={() => ctx.go('pickup_home')} accessibilityRole="button" accessibilityLabel="Browse open work">
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Search size={20} color={colors.translate} />
              <Text style={[text.body, { flex: 1 }]}>{openCount(ctx)}</Text>
              <ArrowRight size={16} color={colors.mutedForeground} />
            </Card>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

function openCount(ctx: Ctx): string {
  const { state } = ctx.project;
  if (!state) return '';
  const laneId = Object.keys(state.lanes)[0];
  if (!laneId) return '0';
  return String(derivePieces(state, laneId).filter((p) => p.status === 'unassigned').length);
}

function TodoRow(props: { task: Task; label: string; isLast: boolean; onOpen: () => void; onLong: () => void }) {
  const meta = TASK_META[props.task.type];
  const TypeIcon = meta.icon;
  const StatusIcon = STATUS_META[props.task.status].icon;
  const done = props.task.done;
  return (
    <Pressable
      onPress={props.onOpen}
      onLongPress={props.onLong}
      accessibilityRole="button"
      accessibilityLabel={`${props.task.type} ${props.label}, ${props.task.status}`}
      style={[styles.row, !done && { backgroundColor: meta.tint }, !props.isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border }]}
    >
      <StatusIcon size={22} color={STATUS_META[props.task.status].color} />
      <BookOpen size={16} color={colors.mutedForeground} />
      <Text style={[text.body, { flex: 1 }, done && { color: colors.mutedForeground, textDecorationLine: 'line-through' }]} numberOfLines={1}>
        {props.label}
      </Text>
      {props.task.dueDate && !done ? <Text style={text.small}>{props.task.dueDate}</Text> : null}
      <TypeIcon size={16} color={meta.color} />
    </Pressable>
  );
}

/** Avatar U. Passages nobody is assigned to; claiming assigns yourself. */
export function PickupHome(ctx: Ctx) {
  const { state, append } = ctx.project;
  const laneId = state ? Object.keys(state.lanes)[0] : undefined;
  const open = state && laneId ? derivePieces(state, laneId).filter((p) => p.status === 'unassigned') : [];
  async function claim(unitId: string) {
    await append('v1.AssignmentMade', { unitId, laneId: laneId!, profileId: ctx.session.actorId, role: 'translator' });
    ctx.go('translate_passage', { taskId: `translate:${unitId}:${laneId}` });
  }
  return (
    <Screen>
      <Header title="Open work" onBack={ctx.back} />
      <Section label={`Passages · ${open.length}`}>
        {open.length === 0 ? <Row label="Nothing open" last /> : null}
        {open.map((p, i) => (
          <Row key={p.unitId} icon={BookOpen} label={p.label} sub={p.stage} onPress={() => void claim(p.unitId)} last={i === open.length - 1} />
        ))}
      </Section>
    </Screen>
  );
}

/** Avatar P. Five-step wizard: type, assignee, passage, due date, send. */
export function GiveAssignment(ctx: Ctx) {
  const { state, append } = ctx.project;
  const [step, setStep] = useState(0);
  const [type, setType] = useState<'translator' | 'reviewer'>('translator');
  const [who, setWho] = useState(ctx.params['assignee'] ?? '');
  const [unitId, setUnitId] = useState(ctx.params['unitId'] ?? '');
  const [due, setDue] = useState('Sep 30');
  const laneId = state ? Object.keys(state.lanes)[0] : undefined;
  const members = state ? Object.entries(state.members).filter(([, m]) => !m.removed.value) : [];
  const pieces = state && laneId ? derivePieces(state, laneId) : [];
  const steps = ['Type', 'Assignee', 'Passage', 'Due date'];
  const can = [true, !!who, !!unitId, true][step];

  async function send() {
    await append('v1.AssignmentMade', { unitId, laneId: laneId!, profileId: who, role: type, dueDate: due });
    ctx.back();
  }

  return (
    <Screen
      footer={
        <Footer
          label={step === steps.length - 1 ? 'Send assignment' : 'Next'}
          onPress={() => (step === steps.length - 1 ? void send() : setStep(step + 1))}
          disabled={!can}
          secondary={step > 0 ? { label: 'Back', onPress: () => setStep(step - 1) } : undefined}
        />
      }
    >
      <Header title="Give assignment" sub={`Step ${step + 1} of ${steps.length} — ${steps[step]}`} onBack={ctx.back} />
      {step === 0 ? (
        <Section label="Type">
          <Row label="Translation" sub="Assign a passage to translate" onPress={() => setType('translator')} right={type === 'translator' ? <Check size={18} color={colors.translate} /> : <View />} />
          <Row label="Review" sub="Assign a passage to review" onPress={() => setType('reviewer')} right={type === 'reviewer' ? <Check size={18} color={colors.translate} /> : <View />} last />
        </Section>
      ) : null}
      {step === 1 ? (
        <Section label="Assignee">
          {members.map(([id, m], i) => (
            <Row key={id} label={id.slice(0, 8)} sub={m.role.value} onPress={() => setWho(id)} right={who === id ? <Check size={18} color={colors.translate} /> : <View />} last={i === members.length - 1} />
          ))}
        </Section>
      ) : null}
      {step === 2 ? (
        <Section label="Passage">
          {pieces.map((p, i) => (
            <Row key={p.unitId} label={p.label} sub={`${p.stage} · ${p.status}`} onPress={() => setUnitId(p.unitId)} right={unitId === p.unitId ? <Check size={18} color={colors.translate} /> : <View />} last={i === pieces.length - 1} />
          ))}
        </Section>
      ) : null}
      {step === 3 ? (
        <Section label="Due date">
          {['Sep 15', 'Sep 30', 'Oct 15', 'Oct 31'].map((d, i, a) => (
            <Row key={d} label={d} onPress={() => setDue(d)} right={due === d ? <Check size={18} color={colors.translate} /> : <View />} last={i === a.length - 1} />
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}

/** Avatar P. One task's history, derived from the events that touched its unit. */
export function AssignmentProgressDetail(ctx: Ctx) {
  const { state } = ctx.project;
  const taskId = ctx.params['taskId'] ?? '';
  const [, unitId = '', laneId = ''] = taskId.split(':');
  const label = state?.units[unitId]?.label ?? unitId;
  const piece = state && laneId ? derivePieces(state, laneId).find((p) => p.unitId === unitId) : undefined;
  return (
    <Screen>
      <Header title="Assignment progress" sub={label} onBack={ctx.back} />
      {piece ? (
        <Section label="Now">
          <Row label={piece.stage} sub={piece.status} badge={piece.assignee ? piece.assignee.slice(0, 8) : undefined} last />
        </Section>
      ) : (
        <Note>No piece found for this task.</Note>
      )}
      <Section label="More">
        <Row label="Open progress overview" onPress={() => ctx.go('progress_home')} last />
      </Section>
    </Screen>
  );
}

/** Legacy redirect to Status (spec progress_home). */
export function ProgressHome(ctx: Ctx) {
  return (
    <Screen footer={<Footer label="Open status" onPress={() => ctx.go('status_home')} />}>
      <Header title="Progress" />
      <Note>Progress now lives on the Status map.</Note>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { gap: space.lg, padding: space.lg },
  pad: { padding: space.lg },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  filters: { flexDirection: 'row', gap: space.sm },
  filter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: space.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: colors.muted },
  filterCount: { fontSize: 18, fontWeight: '700' },
  todo: { borderRadius: radius.xl, backgroundColor: tint.mutedContainer, paddingHorizontal: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.md, paddingHorizontal: space.sm, paddingVertical: space.md }
});
