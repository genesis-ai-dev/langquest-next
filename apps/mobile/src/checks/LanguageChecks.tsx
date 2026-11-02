// A language's own checks (decision 91): the list, with who is on each and its
// helps, as the flow editor and New language show it (screens/config.tsx).
// screens/checks.tsx edits one check.
import { checkHelps, checkPeople, checkShows, commands, deriveFlow, kindOf, languageName, questionsForKind, RECORD_STEP, type EventSpec, type KindDef, type LanguageState } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useContext, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, type PanResponderInstance } from 'react-native';
import { Text } from '../ui/text';
import { deriveKinds } from '../i18n/coreText';
import type { Ctx } from '../shell/ctx';
import { useHelpOn, useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { choiceName } from '../templates/contentTemplatesModel';
import { formatNumber } from '../i18n/format';
import { indexesFor } from '../sync/indexes';
import { Banner, EmptyState, Field, Group, Header, Ico, KindIcon, PrimaryBtn, Row, Screen, Sheet } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { failureMessage } from '../diagnostics/report';
import { C, space, TINT } from '../ui/theme';
import { ChoiceCard, DashedRow, LockToggle } from '../admin/admin';
import { checkName, checksLine } from '../admin/adminModel';
import { useCheckChoices, type FlowEntry } from '../admin/useChoices';
import { teamLanguages } from '../reference/languages';
import { addRow, moveRow, rowNumbers, rowsOf, setCheckpoint, type CheckRow } from './model';
import { useDraftAware } from './useDraftAware';
import { useChecksUndo } from './useChecksUndo';
import { UndoRedo } from '../ui/undoRedo';
import { PeopleLine } from './parts';
import { newKindId } from '../config/model';
import { saveRows } from './checkActions';
import { styles } from './checkStyles';
import { anyFrom, shownLine } from './showsModel';
import { DragScrollContext, useDragRows, type DragScroll } from '../recording/useDragRows';
import { ScrollHoldContext } from '../ui/scrollHoldContext';

/** The grip's press while help is on: it explains itself; dragging waits until help is off. */
const DRAG_HERE = () => undefined;

function CheckCard(props: {
  ctx: Ctx; row: CheckRow; i: number; n: number; count: number; kinds: KindDef[]; people: string[] | null;
  questions: number; helps: number; readOnly: boolean;
  /** What the check hides (decisions.md 130), as a line: "Bible text · Guide text". */ hidden?: ShownLine | null;
  /** The check that listens to what this step makes (decisions.md 130). */ checkedAt?: string;
  /** The grip's touch handlers (useDragRows), and whether this card is the one being dragged. */
  gripHandlers: PanResponderInstance['panHandlers']; lifted: boolean;
  onMove: (to: number) => void; onLock: () => void; onOpen?: () => void;
  /** What help mode says opening the card shows. */ openHelp?: string;
}) {
  const { row, i } = props;
  const title = checkName(row.kindId, props.kinds);
  // While help is on the grip explains itself instead of dragging.
  const grip = useHelpSpot(t('review.checkSteps.move', { title }), t('checks.dragHelp'), props.readOnly ? undefined : DRAG_HERE);
  const open = useHelpSpot(title, props.openHelp ?? t('checks.openHelp'), props.onOpen ?? (() => {}));
  return (
    <View style={[styles.card, props.lifted && { borderColor: C.primary }]}>
      <View {...(grip.id ? {} : props.gripHandlers)} style={styles.grip} accessibilityRole="adjustable" accessibilityLabel={t('review.checkSteps.move', { title })}
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
            <View style={styles.metaPart}><Ico name="arrowR" size={15} color={C.muted} /><Text style={[styles.metaText, { flexShrink: 1 }]}>{props.checkedAt}</Text></View>
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

/**
 * The rows as cards, a translator's recording above them, checks that happen
 * together joined by a bar. A card is dragged by its grip as a recording's
 * parts are (useDragRows, UI audit finding 101): the cards it passes move
 * aside, each by its own height, and the screen holds still meanwhile. Each
 * check's page has Move up and Move down too.
 */
function CheckList(props: {
  ctx: Ctx; rows: CheckRow[]; kinds: KindDef[]; readOnly: boolean;
  peopleOf?: (kindId: string) => string[]; questionsOf?: (kindId: string) => number; helpsOf?: (kindId: string) => number;
  /** What each step hides (`record` for the recording), when the list opens them. */ hiddenOf?: (kindId: string) => ShownLine;
  /** The check that listens to what a step makes. */ checkedAtOf?: (kindId: string) => string | undefined;
  onChange: (rows: CheckRow[]) => void; onOpen?: (i: number) => void; onOpenRecord?: () => void;
  /** What help mode says opening a check shows, where it is not its people, questions and helps. */ openHelp?: string;
}) {
  const { rows } = props;
  const numbers = rowNumbers(rows);
  const helpOn = useHelpOn();
  const keys = useMemo(() => rowKeys(rows), [rows]);
  // The screen's scroll stops while a card is dragged.
  const hold = useContext(ScrollHoldContext);
  const scroll = useMemo<DragScroll>(() => ({ by: () => 0, edges: () => null, hold: (on) => hold?.(on), reveal: () => {} }), [hold]);
  return (
    <DragScrollContext.Provider value={scroll}>
      <Cards {...props} keys={keys} numbers={numbers} dragging={!props.readOnly && !helpOn} />
    </DragScrollContext.Provider>
  );
}

/** A key for each row that stays with it when rows move: its kind, and which of that kind it is. */
function rowKeys(rows: CheckRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const n = seen.get(r.kindId) ?? 0;
    seen.set(r.kindId, n + 1);
    return n ? `${r.kindId}#${n}` : r.kindId;
  });
}

function Cards(props: Parameters<typeof CheckList>[0] & { keys: string[]; numbers: number[]; dragging: boolean }) {
  const { rows, keys } = props;
  const drag = useDragRows(keys, props.dragging, (from, to) => props.onChange(moveRow(rows, from, to)));
  return (
    <View>
      {props.onOpenRecord ? <RecordCard hidden={props.hiddenOf?.(RECORD_STEP) ?? null} onOpen={props.onOpenRecord} /> : (
        <View style={styles.start}>
          <View style={styles.mic}><Ico name="mic" size={18} color={C.white} /></View>
          <Text style={[txt.sm, { color: C.muted, fontWeight: '700' }]}>{t('review.checkSteps.translatorRecords')}</Text>
        </View>
      )}
      {rows.length === 0 ? (
        <View style={[styles.card, { justifyContent: 'center', marginTop: GAP }]}>
          <Text style={[txt.sm, { color: C.muted, flex: 1, textAlign: 'center' }]}>{t('review.checkSteps.noChecks')}</Text>
        </View>
      ) : rows.map((r, i) => {
        const key = keys[i]!;
        // Checks in one step are joined by a bar down their left, drawn a piece beside each card.
        const joined = r.together && i > 0;
        const group = joined || (rows[i + 1]?.together ?? false);
        const lastInGroup = group && !(rows[i + 1]?.together ?? false);
        const moved = drag.offset(key);
        const lifted = drag.dragging === key;
        const card = (
          <HelpRow of="checks.check">
            <CheckCard ctx={props.ctx} row={r} i={i} n={props.numbers[i]!} count={rows.length} kinds={props.kinds}
              people={props.peopleOf ? props.peopleOf(r.kindId) : null} questions={props.questionsOf?.(r.kindId) ?? 0} helps={props.helpsOf?.(r.kindId) ?? 0}
              readOnly={props.readOnly} gripHandlers={drag.grip(key)} lifted={lifted}
              {...(props.hiddenOf ? { hidden: props.hiddenOf(r.kindId) } : {})}
              {...(props.checkedAtOf?.(r.kindId) ? { checkedAt: props.checkedAtOf(r.kindId)! } : {})}
              onMove={(to) => props.onChange(moveRow(rows, i, to))}
              onLock={() => props.onChange(setCheckpoint(rows, i, !r.checkpoint))}
              {...(props.onOpen ? { onOpen: () => props.onOpen!(i) } : {})} {...(props.openHelp ? { openHelp: props.openHelp } : {})} />
          </HelpRow>
        );
        return (
          <View key={key} ref={drag.ref(key)} onLayout={drag.onLayout(key)}
            style={[{ paddingTop: joined ? space.xs : GAP }, moved !== 0 && { transform: [{ translateY: moved }] }, lifted && { zIndex: 2 }]}>
            {group ? (
              <View style={styles.together}>
                <View style={[styles.bar, { marginTop: joined ? -space.xs : space.lg, marginBottom: lastInGroup ? space.lg : 0 }]} />
                <View style={{ flex: 1, gap: space.xs }}>
                  {joined ? <Text style={styles.sameTime}>{t('checks.sameTime')}</Text> : null}
                  {card}
                </View>
              </View>
            ) : card}
          </View>
        );
      })}
      {/* What the lock on each card means, as the library's flow editor says it (UI audit, finding 105). */}
      {rows.length ? (
        <View style={[styles.legend, { marginTop: GAP }]}>
          <Ico name="lock" size={15} color={C.muted} />
          <Text style={[txt.sm, { color: C.muted, flex: 1 }]}>{t('review.checkSteps.legend')}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** The space between cards. */
const GAP = space.sm + 2;

/** Add a check: one the organization knows, or a new one by name. */
function AddCheckSheet(props: { visible: boolean; kinds: KindDef[]; taken: string[]; onClose: () => void; onPick: (k: KindDef, isNew: boolean) => void }) {
  const [name, setName] = useState('');
  const left = props.kinds.filter((k) => !props.taken.includes(k.id));
  return (
    <Sheet visible={props.visible} title={t('checks.addCheck')} onClose={props.onClose}>
      {left.length ? (
        <Group>
          {left.map((k, i) => (
            <HelpRow key={k.id} of="checks.addKind">
              <Row leading={<KindIcon kindId={k.id} size={40} />} label={checkName(k.id, props.kinds)} help={t('checks.addThisHelp')} onPress={() => props.onPick(k, false)} last={i === left.length - 1} />
            </HelpRow>
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
  const chk = useCheckChoices(props.ctx, null, props.kinds, teamLanguages(props.ctx.org.state, props.ctx.language.state, props.ctx.language.languageId));
  const [picked, setPicked] = useState<string | null>(null);
  const on = chk.entries.find((e) => e.c.key === picked) ?? null;
  return (
    <Sheet visible={props.visible} title={t('checks.flows.title')} sub={t('checks.flows.sub', { language: props.language })} onClose={props.onClose}
      footer={on ? <PrimaryBtn label={t('checks.flows.use', { name: choiceName(on.c) })} help={t('checks.flows.useHelp', { language: props.language })} onPress={() => props.onUse(on, chk.kindsOf(on.doc))} /> : undefined}>
      {chk.entries.length === 0 ? <Text style={txt.smMuted}>{chk.loaded ? t('getReady.checks.noWays') : t('common.loading')}</Text> : null}
      {chk.entries.map((e) => (
        <HelpRow key={e.c.key} of="checks.flow">
          <ChoiceCard on={picked === e.c.key} icon="flow" title={choiceName(e.c)} sub={checksLine(e.doc.steps, chk.kindsOf(e.doc))} help={t('checks.flows.pickHelp')} onPress={() => setPicked(e.c.key)} />
        </HelpRow>
      ))}
    </Sheet>
  );
}

export function LanguageChecks({ ctx }: { ctx: Ctx }) {
  // New language's checks before it exists are its draft's (decisions.md 146).
  const c = useDraftAware(ctx);
  return <OwnChecks ctx={c} />;
}

function OwnChecks({ ctx }: { ctx: Ctx }) {
  const state = ctx.language.state;
  const language = languageName(ctx.org.state, ctx.language.languageId);
  const canManage = ctx.session.can('manage_flows');
  const undo = useChecksUndo(ctx);
  const draft = ctx.params['draft'] === '1';
  // Opened from a question (New language's draft, Get ready's "I'll choose the checks"), Done goes back to it (finding 100).
  const done = draft || ctx.params['done'] === '1';
  return (
    <Screen header={<Header title={t('checks.title')} sub={state ? language : undefined} onBack={ctx.back} action={canManage && state ? <UndoRedo {...undo.props} help={{ undo: t('checks.undoHelp'), redo: t('common.redoHelp') }} /> : undefined} />}
      {...(done && state ? { footer: <PrimaryBtn label={t('common.done')} icon="check" help={draft ? t('checks.draftDoneHelp') : t('help.details.done')} onPress={ctx.back} /> } : {})}>
      {state ? <ChecksContent ctx={ctx} undo={undo} /> : <EmptyState icon="flow" title={t('common.loading')} />}
    </Screen>
  );
}

/**
 * A language's checks, as cards in order, with Add a check and a ready-made
 * flow to start from (`startFrom`): on its Checks screen, and on New
 * language's page of them, where the draft is the language (decisions.md 146).
 */
export function ChecksContent({ ctx, undo, startFrom = true }: { ctx: Ctx; undo: ReturnType<typeof useChecksUndo>; startFrom?: boolean }) {
  const state = ctx.language.state;
  const languageId = ctx.language.languageId;
  const language = languageName(ctx.org.state, languageId);
  const known = useMemo(() => (state ? deriveKinds(state) : []), [state]);
  const rows = useMemo(() => (state ? rowsOf(deriveFlow(state).steps) : []), [state]);
  const [adding, setAdding] = useState(false);
  const [flows, setFlows] = useState(false);
  const canManage = ctx.session.can('manage_flows');
  const startFlow = useHelpSpot(t('checks.flows.start'), t('checks.flows.startHelp'), canManage ? () => setFlows(true) : undefined);
  if (!state) return null;
  // A save is a step on the header's Undo (useChecksUndo hears it).
  const save = (next: CheckRow[], before: EventSpec[] = []) => void saveRows(ctx, next, t('checks.saved', { language }), before);
  return (
    <>
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
      {canManage && startFrom ? (
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
          ctx.toast(t('common.notSaved', { reason: failureMessage('use flow', err) }), 'problem'); // i18n-ignore: log label
          return;
        }
        const said = t('checks.flows.used', { name: choiceName(e.c), language });
        void ctx.act(specs, said).then(() => undo.did(previous, said), () => {});
      }} />
    </>
  );
}
