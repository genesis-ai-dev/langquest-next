// A language's own checks (decision 91): the list, with who is on each and its
// helps, as the flow editor and New language show it (screens/config.tsx).
// screens/checks.tsx edits one check.
import { checkHelps, checkPeople, checkShows, commands, deriveFlow, kindOf, languageName, questionsForKind, RECORD_STEP, type EventSpec, type KindDef, type LanguageState } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { deriveKinds } from '../i18n/coreText';
import type { Ctx } from '../shell/ctx';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { indexesFor } from '../sync/indexes';
import { Banner, EmptyState, Field, Group, Header, Ico, KindIcon, PrimaryBtn, Row, Screen, Sheet, Toggle } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { failureMessage } from '../diagnostics/report';
import { C, space, TINT } from '../ui/theme';
import { ChoiceCard, DashedRow, LockToggle } from '../admin/admin';
import { checkName, checksLine, dropIndex } from '../admin/adminModel';
import { useCheckChoices, type FlowEntry } from '../admin/useChoices';
import { addRow, moveRow, removeRow, rowNumbers, rowsOf, setCheckpoint, setTogether, type CheckRow } from './model';
import { setChecksDraft } from './draft';
import { useChecksDraft } from './useChecksDraft';
import { restoreChecks } from './undo';
import { PeopleLine } from './parts';
import { newKindId } from '../config/model';
import { saveRows } from './checkActions';
import { styles } from './checkStyles';
import { anyFrom, shownLine } from './showsModel';

/** The grip's press while help is on: it explains itself; dragging waits until help is off. */
const DRAG_HERE = () => undefined;

function CheckCard(props: {
  ctx: Ctx; row: CheckRow; i: number; n: number; count: number; kinds: KindDef[]; people: string[] | null;
  questions: number; helps: number; readOnly: boolean; height: number;
  /** What the check hides (decisions.md 130), as a line: "Bible text · Guide text". */ hidden?: ShownLine | null;
  /** The check that listens to what this step makes (decisions.md 130). */ checkedAt?: string;
  onLayout: (h: number) => void; onMove: (to: number) => void; onLock: () => void; onOpen?: () => void;
  /** What help mode says opening the card shows. */ openHelp?: string;
}) {
  const { row, i } = props;
  const title = checkName(row.kindId, props.kinds);
  const [dy, setDy] = useState(0);
  const latest = useRef(props);
  latest.current = props;
  // While help is on the grip explains itself instead of dragging.
  const grip = useHelpSpot(t('review.checkSteps.move', { title }), t('checks.dragHelp'), props.readOnly ? undefined : DRAG_HERE);
  const explaining = useRef(false);
  explaining.current = !!grip.id;
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !latest.current.readOnly && !explaining.current,
    onMoveShouldSetPanResponder: () => !latest.current.readOnly && !explaining.current,
    onPanResponderMove: (_e, g) => setDy(g.dy),
    onPanResponderRelease: (_e, g) => {
      const p = latest.current;
      setDy(0);
      const to = dropIndex(p.i, g.dy, p.height, p.count);
      if (to !== p.i) p.onMove(to);
    },
    onPanResponderTerminate: () => setDy(0)
  })).current;
  const open = useHelpSpot(title, props.openHelp ?? t('checks.openHelp'), props.onOpen ?? (() => {}));
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
        {grip.id ? (
          <Pressable onPress={grip.onPress} accessibilityRole="button" accessibilityLabel={t('review.checkSteps.move', { title })} style={StyleSheet.absoluteFill}>
            <HelpBadge spot={grip} />
          </Pressable>
        ) : null}
      </View>
      <Pressable onPress={open.onPress} disabled={!props.onOpen} accessibilityRole="button"
        accessibilityLabel={t('checks.cardA11y', { n: props.n, title })}
        style={({ pressed }) => [styles.body, pressed && { opacity: 0.7 }]}>
        <View style={styles.num}><Text style={styles.numText}>{formatNumber(props.n)}</Text></View>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text style={styles.title}>{title}</Text>
          {props.people ? <PeopleLine ctx={props.ctx} people={props.people} /> : null}
          {props.questions || props.helps ? (
            <View style={styles.meta}>
              {props.questions ? <View style={styles.metaPart}><Ico name="chat" size={15} color={C.muted} /><Text style={styles.metaText}>{t('checks.questionsCount', { count: props.questions })}</Text></View> : null}
              {props.helps ? <View style={styles.metaPart}><Ico name="book" size={15} color={C.muted} /><Text style={styles.metaText}>{t('checks.helpsCount', { count: props.helps })}</Text></View> : null}
            </View>
          ) : null}
          {props.checkedAt ? (
            <View style={styles.metaPart}><Ico name="arrowR" size={15} color={C.muted} /><Text style={styles.metaText} numberOfLines={1}>{props.checkedAt}</Text></View>
          ) : null}
          {props.hidden ? <HiddenLine {...props.hidden} /> : null}
        </View>
        <HelpBadge spot={open} />
      </Pressable>
      <LockToggle on={row.checkpoint} onToggle={props.onLock} disabled={props.readOnly}
        label={row.checkpoint ? t('review.checkSteps.mustPass', { title }) : t('review.checkSteps.canSetAside', { title })} />
    </View>
  );
}

type ShownLine = ReturnType<typeof shownLine>;

/** What a step hides, by a struck eye, or what it still shows, by an open one (decisions.md 130). */
function HiddenLine(props: NonNullable<ShownLine>) {
  return (
    <View style={styles.metaPart}>
      <Ico name={props.icon} size={15} color={TINT.amberText} />
      <Text style={[styles.metaText, { color: TINT.amberText, flexShrink: 1 }]} numberOfLines={2}>{props.line}</Text>
    </View>
  );
}

/** What a step hides, from its switches. */
function hiddenOf(state: LanguageState, kindId: string): ShownLine {
  return shownLine({ ...checkShows(state, kindId), notes: anyFrom(state, kindId, 'notes'), earlier: anyFrom(state, kindId, 'earlier') });
}

/** A translator's recording, first in the list: a step too, opened to say what the recorder shows. */
function RecordCard(props: { hidden: ShownLine; onOpen: () => void }) {
  const open = useHelpSpot(t('review.checkSteps.translatorRecords'), t('checks.openRecordHelp'), props.onOpen);
  return (
    <Pressable onPress={open.onPress} accessibilityRole="button" accessibilityLabel={t('review.checkSteps.translatorRecords')}
      style={({ pressed }) => [styles.card, styles.recordCard, pressed && { opacity: 0.7 }]}>
      <View style={styles.mic}><Ico name="mic" size={18} color={C.white} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={styles.title}>{t('review.checkSteps.translatorRecords')}</Text>
        {props.hidden ? <HiddenLine {...props.hidden} /> : null}
      </View>
      <Ico name="right" size={20} color={C.faint} />
      <HelpBadge spot={open} />
    </Pressable>
  );
}

/** The rows as cards, a translator's recording above them, checks that happen together joined by a bar. */
function CheckList(props: {
  ctx: Ctx; rows: CheckRow[]; kinds: KindDef[]; readOnly: boolean;
  peopleOf?: (kindId: string) => string[]; questionsOf?: (kindId: string) => number; helpsOf?: (kindId: string) => number;
  /** What each step hides (`record` for the recording), when the list opens them. */ hiddenOf?: (kindId: string) => ShownLine;
  /** The check that listens to what a step makes. */ checkedAtOf?: (kindId: string) => string | undefined;
  onChange: (rows: CheckRow[]) => void; onOpen?: (i: number) => void; onOpenRecord?: () => void;
  /** What help mode says opening a check shows, where it is not its people, questions and helps. */ openHelp?: string;
}) {
  const [height, setHeight] = useState(0);
  const { rows } = props;
  const numbers = rowNumbers(rows);
  // Runs of rows in one step, so a bar can join them.
  const groups: number[][] = [];
  rows.forEach((r, i) => { if (r.together && groups.length) groups.at(-1)!.push(i); else groups.push([i]); });
  const card = (i: number) => {
    const r = rows[i]!;
    return (
      <CheckCard key={`${r.kindId}#${i}`} ctx={props.ctx} row={r} i={i} n={numbers[i]!} count={rows.length} kinds={props.kinds}
        people={props.peopleOf ? props.peopleOf(r.kindId) : null} questions={props.questionsOf?.(r.kindId) ?? 0} helps={props.helpsOf?.(r.kindId) ?? 0}
        readOnly={props.readOnly} height={height + space.sm + 2} onLayout={(h) => { if (Math.abs(h - height) > 1) setHeight(h); }}
        {...(props.hiddenOf ? { hidden: props.hiddenOf(r.kindId) } : {})}
        {...(props.checkedAtOf?.(r.kindId) ? { checkedAt: props.checkedAtOf(r.kindId)! } : {})}
        onMove={(to) => props.onChange(moveRow(rows, i, to))}
        onLock={() => props.onChange(setCheckpoint(rows, i, !r.checkpoint))}
        {...(props.onOpen ? { onOpen: () => props.onOpen!(i) } : {})} {...(props.openHelp ? { openHelp: props.openHelp } : {})} />
    );
  };
  return (
    <View style={{ gap: space.sm + 2 }}>
      {props.onOpenRecord ? <RecordCard hidden={props.hiddenOf?.(RECORD_STEP) ?? null} onOpen={props.onOpenRecord} /> : (
        <View style={styles.start}>
          <View style={styles.mic}><Ico name="mic" size={18} color={C.white} /></View>
          <Text style={[txt.sm, { color: C.muted, fontWeight: '700' }]}>{t('review.checkSteps.translatorRecords')}</Text>
        </View>
      )}
      {rows.length === 0 ? (
        <View style={[styles.card, { justifyContent: 'center' }]}>
          <Text style={[txt.sm, { color: C.muted, flex: 1, textAlign: 'center' }]}>{t('review.checkSteps.noChecks')}</Text>
        </View>
      ) : groups.map((g) => (g.length === 1 ? card(g[0]!) : (
        <View key={`group#${g[0]}`} style={styles.together}>
          <View style={styles.bar} />
          <View style={{ flex: 1, gap: space.xs }}>
            {g.map((i, j) => (
              <View key={i} style={{ gap: space.xs }}>
                {j > 0 ? <Text style={styles.sameTime}>{t('checks.sameTime')}</Text> : null}
                {card(i)}
              </View>
            ))}
          </View>
        </View>
      )))}
    </View>
  );
}

/** Add a check: one the organization knows, or a new one by name. */
function AddCheckSheet(props: { visible: boolean; kinds: KindDef[]; taken: string[]; onClose: () => void; onPick: (k: KindDef, isNew: boolean) => void }) {
  const [name, setName] = useState('');
  const left = props.kinds.filter((k) => !props.taken.includes(k.id));
  return (
    <Sheet visible={props.visible} title={t('checks.addCheck')} onClose={props.onClose}>
      {left.length ? (
        <Group>
          {left.map((k, i) => (
            <Row key={k.id} leading={<KindIcon kindId={k.id} size={40} />} label={checkName(k.id, props.kinds)} help={t('checks.addThisHelp')} onPress={() => props.onPick(k, false)} last={i === left.length - 1} />
          ))}
        </Group>
      ) : null}
      <Field label={t('config.flowEditor.somethingElse')} value={name} onChangeText={setName} placeholder={t('config.flowEditor.newCheckPlaceholder')} autoCapitalize="words"
        help={t('checks.newCheckHelp')} />
      <PrimaryBtn label={t('config.flowEditor.addThisCheck')} icon="plus" disabled={!name.trim()} onPress={() => {
        const k: KindDef = { id: newKindId(name, props.kinds.map((x) => x.id)), name: name.trim(), description: '', usualReviewer: '' };
        setName('');
        props.onPick(k, true);
      }} />
    </Sheet>
  );
}

/** Start from a ready-made flow: its checks replace the language's. */
function FlowsSheet(props: { ctx: Ctx; visible: boolean; kinds: KindDef[]; language: string; onClose: () => void; onUse: (e: FlowEntry, kinds: KindDef[]) => void }) {
  const chk = useCheckChoices(props.ctx, null, props.kinds);
  const [picked, setPicked] = useState<string | null>(null);
  const on = chk.entries.find((e) => e.c.key === picked) ?? null;
  return (
    <Sheet visible={props.visible} title={t('checks.flows.title')} sub={t('checks.flows.sub', { language: props.language })} onClose={props.onClose}
      footer={on ? <PrimaryBtn label={t('checks.flows.use', { name: on.c.name })} help={t('checks.flows.useHelp', { language: props.language })} onPress={() => props.onUse(on, chk.kindsOf(on.doc))} /> : undefined}>
      {chk.entries.length === 0 ? <Text style={txt.smMuted}>{chk.loaded ? t('getReady.checks.noWays') : t('common.loading')}</Text> : null}
      {chk.entries.map((e) => (
        <ChoiceCard key={e.c.key} on={picked === e.c.key} icon="route" title={e.c.name} sub={checksLine(e.doc.steps, chk.kindsOf(e.doc))} help={t('checks.flows.pickHelp')} onPress={() => setPicked(e.c.key)} />
      ))}
    </Sheet>
  );
}

export function LanguageChecks({ ctx }: { ctx: Ctx }) {
  if (ctx.params['draft'] === '1') return <DraftChecks ctx={ctx} />;
  return <OwnChecks ctx={ctx} />;
}

function OwnChecks({ ctx }: { ctx: Ctx }) {
  const state = ctx.language.state;
  const languageId = ctx.language.languageId;
  const language = languageName(ctx.org.state, languageId);
  const known = useMemo(() => (state ? deriveKinds(state) : []), [state]);
  const rows = useMemo(() => (state ? rowsOf(deriveFlow(state).steps) : []), [state]);
  const [adding, setAdding] = useState(false);
  const [flows, setFlows] = useState(false);
  const canManage = ctx.session.can('manage_flows');
  const startFlow = useHelpSpot(t('checks.flows.start'), t('checks.flows.startHelp'), canManage ? () => setFlows(true) : undefined);
  if (!state) {
    return <Screen header={<Header title={t('checks.title')} onBack={ctx.back} />}><EmptyState icon="flow" title={t('common.loading')} /></Screen>;
  }
  const save = (next: CheckRow[], before: EventSpec[] = []) => void saveRows(ctx, next, t('checks.saved', { language }), before);
  return (
    <Screen header={<Header title={t('checks.title')} sub={language} onBack={ctx.back} />}>
      {!canManage ? <Banner icon="lock" title={t('common.viewOnly')} body={t('config.flowEditor.viewOnlyBody')} /> : null}
      <CheckList ctx={ctx} rows={rows} kinds={known} readOnly={!canManage}
        peopleOf={(k) => checkPeople(state, k)}
        questionsOf={(k) => questionsForKind(state, k).length}
        helpsOf={(k) => checkHelps(state, k).length}
        hiddenOf={(k) => hiddenOf(state, k)}
        checkedAtOf={(k) => { const by = kindOf(state, k).produces?.checkedBy; return by ? checkName(by, known) : undefined; }}
        onChange={save} onOpen={(i) => ctx.go('check_editor', { languageId, kindId: rows[i]!.kindId })}
        onOpenRecord={() => ctx.go('check_editor', { languageId, kindId: RECORD_STEP })} />
      {canManage ? <DashedRow icon="plus" label={t('checks.addCheck')} detail={t('checks.addCheckHelp')} centred onPress={() => setAdding(true)} /> : null}
      {canManage ? (
        <Pressable onPress={startFlow.onPress} accessibilityRole="button" style={({ pressed }) => [styles.quiet, pressed && { opacity: 0.7 }]}>
          <Ico name="flow" size={20} color={C.muted} />
          <Text style={styles.quietText}>{t('checks.flows.start')}</Text>
          <HelpBadge spot={startFlow} />
        </Pressable>
      ) : null}
      <AddCheckSheet visible={adding} kinds={known} taken={rows.map((r) => r.kindId)} onClose={() => setAdding(false)} onPick={(k, isNew) => {
        setAdding(false);
        const c = commands(state, indexesFor(state));
        const define = isNew ? c.defineKind({ commandId: Crypto.randomUUID(), kindId: k.id, name: k.name, description: k.description, usualReviewer: k.usualReviewer }) : [];
        save(addRow(rows, k.id), define);
      }} />
      <FlowsSheet ctx={ctx} visible={flows} kinds={known} language={language} onClose={() => setFlows(false)} onUse={(e, kinds) => {
        setFlows(false);
        const previous = { flow: state.flow?.value ?? null, steps: deriveFlow(state).steps };
        let specs: EventSpec[];
        try {
          specs = commands(state, indexesFor(state)).copyFlow({ commandId: Crypto.randomUUID(), name: e.c.name, kinds, steps: e.doc.steps });
        } catch (err) {
          ctx.toast(t('common.notSaved', { reason: failureMessage('use flow', err) })); // i18n-ignore: log label
          return;
        }
        const undo = () => {
          const s = ctx.language.state;
          return s ? restoreChecks(s, previous, Crypto.randomUUID()) : [];
        };
        void ctx.act(specs, t('checks.flows.used', { name: e.c.name, language }), undo).catch(() => {});
      }} />
    </Screen>
  );
}

/** New language's own checks, before the language exists: the same list, kept in the draft until Continue. */
function DraftChecks({ ctx }: { ctx: Ctx }) {
  const draft = useChecksDraft();
  const [adding, setAdding] = useState(false);
  // A check of the draft, opened: what one check's page offers before the language exists (no people,
  // questions or helps yet, since those are the language's own records).
  const [open, setOpen] = useState<number | null>(null);
  const title = ctx.params['name'] ?? '';
  if (!draft) return <Screen header={<Header title={t('checks.title')} onBack={ctx.back} />}><EmptyState icon="flow" title={t('common.loading')} /></Screen>;
  const set = (rows: CheckRow[]) => setChecksDraft({ ...draft, rows });
  const row = open !== null ? draft.rows[open] ?? null : null;
  const name = row ? checkName(row.kindId, draft.kinds) : '';
  const previous = open !== null && open > 0 ? checkName(draft.rows[open - 1]!.kindId, draft.kinds) : '';
  return (
    <Screen header={<Header title={t('checks.title')} sub={title} onBack={ctx.back} />}
      footer={<PrimaryBtn label={t('common.done')} icon="check" help={t('checks.draftDoneHelp')} onPress={ctx.back} />}>
      <CheckList ctx={ctx} rows={draft.rows} kinds={draft.kinds} readOnly={false} onChange={set} onOpen={setOpen} openHelp={t('checks.openDraftHelp')} />
      <DashedRow icon="plus" label={t('checks.addCheck')} detail={t('checks.addCheckHelp')} centred onPress={() => setAdding(true)} />
      <AddCheckSheet visible={adding} kinds={draft.kinds} taken={draft.rows.map((r) => r.kindId)} onClose={() => setAdding(false)} onPick={(k) => {
        setAdding(false);
        setChecksDraft({ kinds: draft.kinds.some((x) => x.id === k.id) ? draft.kinds : [...draft.kinds, k], rows: addRow(draft.rows, k.id) });
      }} />
      <Sheet visible={row !== null} title={name} sub={open !== null ? t('checks.checkOf', { n: formatNumber(rowNumbers(draft.rows)[open]!), language: title }) : undefined}
        onClose={() => setOpen(null)}>
        {row && open !== null ? (
          <Group>
            <Row icon="lock" label={t('checks.mustPass')} role="switch" checked={row.checkpoint}
              right={<Toggle testID="toggle-must-pass" on={row.checkpoint} label={t('checks.mustPass')} help={row.checkpoint ? t('admin.lock.on') : t('admin.lock.off')}
                onToggle={() => set(setCheckpoint(draft.rows, open, !row.checkpoint))} />} />
            {open > 0 ? (
              <Row icon="swap" label={t('checks.sameTimeAs', { check: previous })} role="switch" checked={row.together}
                right={<Toggle testID="toggle-same-time" on={row.together} label={t('checks.sameTimeAs', { check: previous })}
                  help={row.together ? t('checks.sameTimeOnHelp', { check: previous }) : t('checks.sameTimeOffHelp', { check: previous })}
                  onToggle={() => set(setTogether(draft.rows, open, !row.together))} />} />
            ) : null}
            <Row icon="trash" iconColor={TINT.redText} iconBg={TINT.red} label={t('checks.remove')} help={t('checks.removeCheckHelp')} last
              onPress={() => { set(removeRow(draft.rows, open)); setOpen(null); }} />
          </Group>
        ) : null}
      </Sheet>
    </Screen>
  );
}
