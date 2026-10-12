// A language's checks (decisions.md 88): one list, in order, each check with
// its own people, questions and helps. `LanguageChecks` is the list (the
// flow editor for a language's own steps, `flow_editor` with `steps:
// 'language'`, or New language's draft with `draft: '1'`); `CheckEditor` is
// one check. Every change saves as it is made, with Undo, like the rest of
// the app's lists.
import {
  checkHelps, checkHelpSpecs, checkPeople, checkPeopleSpecs, commands, deriveFlow, formatQuestionField, languageName, languagePeople, materialsFor,
  membershipsOf, questionsForKind, scopeCovers,
  type CheckHelp, type EventSpec, type KindDef, type LanguageState, type OrgState, type QuestionSpec
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../text';
import { deriveKinds } from '../coreText';
import type { Ctx } from '../ctx';
import { useHelpSpot } from '../helpContext';
import { HelpBadge } from '../helpBadge';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { indexesFor } from '../indexes';
import {
  Banner, Chip, ChipRow, EmptyState, Field, Group, Header, Ico, IconBtn, KindIcon, PrimaryBtn, Row, Screen, SectionLabel, Sheet, Toggle, txt
} from '../kit';
import { useLibrary, useLibraryDocs } from '../library/useLibrary';
import { refKindOf } from '../reference/model';
import { failureMessage } from '../report';
import { contractsFor } from '../screenContracts';
import { C, radius, space, TINT } from '../theme';
import { usePerson, PersonAvatar } from '../UserChip';
import { ChoiceCard, DashedRow, LockToggle } from '../simple/admin';
import { checkName, checksLine, dropIndex } from '../simple/adminModel';
import { useCheckChoices, type FlowEntry } from '../simple/choices';
import { addRow, moveRow, removeRow, rowNumbers, rowsOf, setCheckpoint, setTogether, stepsOf, type CheckRow } from '../checks/model';
import { setChecksDraft, useChecksDraft } from '../checks/draft';
import { PeopleLine } from '../checks/parts';
import { newKindId, nextFieldId, referenceKindName } from './configModel';

// ---- shared parts ------------------------------------------------------------------------

/** A person's role where they work on this language, as their organization names it. */
function roleIn(org: OrgState | null, profileId: string, languageId: string): string {
  if (!org) return '';
  const m = membershipsOf(org, profileId).find((x) => scopeCovers(x.scope, languageId) && org.roles[x.roleId.value] && !org.roles[x.roleId.value]!.retired);
  return m ? org.roles[m.roleId.value]!.name.value : '';
}

/** A help as a row: its name and what it is. */
function helpLabel(state: LanguageState, lib: ReturnType<typeof useLibrary>, h: CheckHelp): { name: string; kind: string; icon: 'note' | 'book' | 'sparkle' } {
  if ('materialId' in h) {
    const m = state.materials[h.materialId];
    return { name: m?.title ?? t('checks.helpGone'), kind: m ? referenceKindName(m.kind) : '', icon: 'note' };
  }
  const it = lib.item(h.itemId);
  return { name: it?.name ?? t('checks.helpGone'), kind: it?.description ?? '', icon: 'book' };
}

/** Save the language's checks as `rows`, with Undo back to the steps it had. */
async function saveRows(ctx: Ctx, rows: CheckRow[], message: string, before: EventSpec[] = []): Promise<boolean> {
  const state = ctx.language.state;
  if (!state) return false;
  const c = commands(state, indexesFor(state));
  const flow = deriveFlow(state);
  const previous = { flow: state.flow?.value ?? null, steps: flow.steps };
  let specs: EventSpec[];
  try {
    specs = [...before, ...c.saveFlowSteps({ commandId: Crypto.randomUUID(), steps: stepsOf(rows) })];
  } catch (e) {
    ctx.toast(t('common.notSaved', { reason: failureMessage('save checks', e) })); // i18n-ignore: log label
    return false;
  }
  const undo = () => {
    const s = ctx.language.state;
    return s ? commands(s, indexesFor(s)).restoreFlow({ commandId: Crypto.randomUUID(), previous }) : [];
  };
  try {
    await ctx.act(specs, message, undo);
    return true;
  } catch {
    return false;
  }
}

// ---- the list ----------------------------------------------------------------------------

function CheckCard(props: {
  ctx: Ctx; row: CheckRow; i: number; n: number; count: number; kinds: KindDef[]; people: string[] | null;
  questions: number; helps: number; readOnly: boolean; height: number;
  onLayout: (h: number) => void; onMove: (to: number) => void; onLock: () => void; onOpen?: () => void;
}) {
  const { row, i } = props;
  const title = checkName(row.kindId, props.kinds);
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
  const open = useHelpSpot(title, t('checks.openHelp'), props.onOpen ?? (() => {}));
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
        </View>
        <HelpBadge spot={open} />
      </Pressable>
      <LockToggle on={row.checkpoint} onToggle={props.onLock} disabled={props.readOnly}
        label={row.checkpoint ? t('review.checkSteps.mustPass', { title }) : t('review.checkSteps.canSetAside', { title })} />
    </View>
  );
}

/** The rows as cards, a translator's recording above them, checks that happen together joined by a bar. */
function CheckList(props: {
  ctx: Ctx; rows: CheckRow[]; kinds: KindDef[]; readOnly: boolean;
  peopleOf?: (kindId: string) => string[]; questionsOf?: (kindId: string) => number; helpsOf?: (kindId: string) => number;
  onChange: (rows: CheckRow[]) => void; onOpen?: (i: number) => void;
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
        onMove={(to) => props.onChange(moveRow(rows, i, to))}
        onLock={() => props.onChange(setCheckpoint(rows, i, !r.checkpoint))}
        {...(props.onOpen ? { onOpen: () => props.onOpen!(i) } : {})} />
    );
  };
  return (
    <View style={{ gap: space.sm + 2 }}>
      <View style={styles.start}>
        <View style={styles.mic}><Ico name="mic" size={18} color={C.white} /></View>
        <Text style={[txt.sm, { color: C.muted, fontWeight: '700' }]}>{t('review.checkSteps.translatorRecords')}</Text>
      </View>
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
            <Row key={k.id} leading={<KindIcon kindId={k.id} size={40} />} label={checkName(k.id, props.kinds)} onPress={() => props.onPick(k, false)} last={i === left.length - 1} />
          ))}
        </Group>
      ) : null}
      <Field label={t('config.flowEditor.somethingElse')} value={name} onChangeText={setName} placeholder={t('config.flowEditor.newCheckPlaceholder')} autoCapitalize="words" />
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
      footer={on ? <PrimaryBtn label={t('checks.flows.use', { name: on.c.name })} onPress={() => props.onUse(on, chk.kindsOf(on.doc))} /> : undefined}>
      {chk.entries.length === 0 ? <Text style={txt.smMuted}>{chk.loaded ? t('getReady.checks.noWays') : t('common.loading')}</Text> : null}
      {chk.entries.map((e) => (
        <ChoiceCard key={e.c.key} on={picked === e.c.key} icon="route" title={e.c.name} sub={checksLine(e.doc.steps, chk.kindsOf(e.doc))} onPress={() => setPicked(e.c.key)} />
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
        onChange={save} onOpen={(i) => ctx.go('check_editor', { languageId, kindId: rows[i]!.kindId })} />
      {canManage ? <DashedRow icon="plus" label={t('checks.addCheck')} centred onPress={() => setAdding(true)} /> : null}
      {canManage ? (
        <Pressable onPress={() => setFlows(true)} accessibilityRole="button" style={({ pressed }) => [styles.quiet, pressed && { opacity: 0.7 }]}>
          <Ico name="flow" size={20} color={C.muted} />
          <Text style={styles.quietText}>{t('checks.flows.start')}</Text>
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
          return s ? commands(s, indexesFor(s)).restoreFlow({ commandId: Crypto.randomUUID(), previous }) : [];
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
  const title = ctx.params['name'] ?? '';
  if (!draft) return <Screen header={<Header title={t('checks.title')} onBack={ctx.back} />}><EmptyState icon="flow" title={t('common.loading')} /></Screen>;
  const set = (rows: CheckRow[]) => setChecksDraft({ ...draft, rows });
  return (
    <Screen header={<Header title={t('checks.title')} sub={title} onBack={ctx.back} />}
      footer={<PrimaryBtn label={t('common.done')} icon="check" onPress={ctx.back} />}>
      <CheckList ctx={ctx} rows={draft.rows} kinds={draft.kinds} readOnly={false} onChange={set} />
      <DashedRow icon="plus" label={t('checks.addCheck')} centred onPress={() => setAdding(true)} />
      <AddCheckSheet visible={adding} kinds={draft.kinds} taken={draft.rows.map((r) => r.kindId)} onClose={() => setAdding(false)} onPick={(k) => {
        setAdding(false);
        setChecksDraft({ kinds: draft.kinds.some((x) => x.id === k.id) ? draft.kinds : [...draft.kinds, k], rows: addRow(draft.rows, k.id) });
      }} />
    </Screen>
  );
}

// ---- one check -------------------------------------------------------------------------------

interface QuestionDraft { materialId: string | null; fieldId: string | null; text: string; type: QuestionSpec['type']; required: boolean }

function questionTypes(): { id: QuestionSpec['type']; label: string }[] {
  return [
    { id: 'text', label: t('checks.questionType.text') },
    { id: 'yesno', label: t('checks.questionType.yesno') },
    { id: 'rating', label: t('checks.questionType.rating') }
  ];
}

export function CheckEditor(ctx: Ctx) {
  const state = ctx.language.state;
  const org = ctx.org.state;
  const languageId = ctx.language.languageId;
  const kindId = ctx.params['kindId'] ?? '';
  const language = languageName(org, languageId);
  const lib = useLibrary(ctx);
  const known = useMemo(() => (state ? deriveKinds(state) : []), [state]);
  const rows = useMemo(() => (state ? rowsOf(deriveFlow(state).steps) : []), [state]);
  const [picking, setPicking] = useState<string[] | null>(null);
  const [question, setQuestion] = useState<QuestionDraft | null>(null);
  const [helping, setHelping] = useState(false);
  const [writing, setWriting] = useState<{ title: string; text: string } | null>(null);
  const look = usePerson();
  const items = lib.items('material').filter((it) => it.current && !it.archived);
  const docs = useLibraryDocs(lib.orgId, items.map((it) => it.current), { deps: false });
  const i = rows.findIndex((r) => r.kindId === kindId);
  const name = checkName(kindId, known);
  if (!state || i < 0) {
    return (
      <Screen header={<Header title={name} onBack={ctx.back} />}>
        <EmptyState icon="flow" title={state ? t('checks.gone') : t('common.loading')} />
      </Screen>
    );
  }
  const row = rows[i]!;
  const number = rowNumbers(rows)[i]!;
  const people = checkPeople(state, kindId);
  const helps = checkHelps(state, kindId);
  const questions = questionsForKind(state, kindId);
  const mayTeams = ctx.session.can('manage_teams');
  const mayFlows = ctx.session.can('manage_flows');
  const mayQuestions = ctx.session.can('fill_reference');
  const mayWrite = ctx.session.can('manage_reference');

  async function setPeople(next: string[]) {
    const s = ctx.language.state;
    if (!s) return;
    const plan = checkPeopleSpecs(s, { commandId: Crypto.randomUUID(), kindId, people: next, kinds: rows.map((r) => r.kindId), nameOf: (k) => checkName(k, known) });
    if (!plan.specs.length) return;
    await ctx.act(plan.specs, t('checks.peopleSaved', { check: name, count: next.length }), plan.undo).catch(() => {});
  }

  async function setHelp(help: CheckHelp, linked: boolean, before: EventSpec[] = []) {
    const s = ctx.language.state;
    if (!s) return;
    const commandId = Crypto.randomUUID();
    const specs = [...before, ...checkHelpSpecs(s, { commandId, kindId, help, linked })];
    if (!specs.length) return;
    const undo = () => {
      const now = ctx.language.state;
      return now ? checkHelpSpecs(now, { commandId: `${commandId}:undo`, kindId, help, linked: !linked }) : [];
    };
    await ctx.act(specs, linked ? t('checks.helpAdded', { check: name }) : t('checks.helpRemoved', { check: name }), undo).catch(() => {});
  }

  async function saveQuestion(q: QuestionDraft, remove = false) {
    const s = ctx.language.state;
    if (!s) return;
    const c = commands(s, indexesFor(s));
    const text = remove ? '' : formatQuestionField({ text: q.text.trim(), type: q.type, ...(q.required ? { required: true } : {}) });
    let specs: EventSpec[];
    try {
      if (q.materialId && q.fieldId) {
        specs = c.setMaterialFields({ commandId: Crypto.randomUUID(), materialId: q.materialId, fields: [{ fieldId: q.fieldId, text }] });
      } else {
        // The language's set for this check, or a new one made for it.
        const set = Object.entries(s.materials).find(([, m]) => m.kind === 'questions' && m.scope.stepId === kindId && !m.scope.unitId && !m.locked.value);
        if (set) {
          const fieldId = nextFieldId(Object.keys(set[1].fields));
          specs = c.setMaterialFields({ commandId: Crypto.randomUUID(), materialId: set[0], fields: [{ fieldId, text }] });
        } else {
          specs = c.defineMaterial({
            commandId: Crypto.randomUUID(), materialId: `questions-${Crypto.randomUUID()}`, kind: 'questions',
            title: t('checks.questionsTitle', { check: name }), scope: { stepId: kindId }, fields: [{ fieldId: 'q1', text }]
          });
        }
      }
    } catch (e) {
      ctx.toast(t('common.notSaved', { reason: failureMessage('save question', e) })); // i18n-ignore: log label
      return;
    }
    await ctx.act(specs, remove ? t('checks.questionRemoved') : t('checks.questionSaved')).catch(() => {});
  }

  async function writeNote(w: { title: string; text: string }) {
    const s = ctx.language.state;
    if (!s) return;
    const materialId = `note-${Crypto.randomUUID()}`;
    let define: EventSpec[];
    try {
      define = commands(s, indexesFor(s)).defineMaterial({ commandId: Crypto.randomUUID(), materialId, kind: 'note', title: w.title, scope: {}, fields: [{ fieldId: 'body', text: w.text }] });
    } catch (e) {
      ctx.toast(t('common.notSaved', { reason: failureMessage('write note', e) })); // i18n-ignore: log label
      return;
    }
    await setHelp({ materialId }, true, define);
  }

  // What can be linked: the language's own notes, and the organization's notes, guides and Bibles.
  const ownNotes = materialsFor(state).filter((m) => !['questions', 'key_terms', 'fia_study'].includes(m.kind));
  const library = items.map((it) => ({ it, kind: refKindOf(docs.get(it.current)) })).filter((x) => x.kind === 'note' || x.kind === 'other' || x.kind === 'guide' || x.kind === 'source');
  const linked = new Set(helps.map((h) => ('itemId' in h ? `item:${h.itemId}` : `material:${h.materialId}`)));
  const tick = (on: boolean) => (
    <View style={[styles.tick, on && styles.tickOn]}>{on ? <Ico name="check" size={18} color={C.white} strokeWidth={3} /> : null}</View>
  );
  const eligible = [...new Set([...[...languagePeople(org, languageId).values()].filter((p) => p.privileges.has('review')).map((p) => p.profileId), ...people])]
    .sort((a, b) => ctx.name(a).localeCompare(ctx.name(b)));
  const previous = i > 0 ? checkName(rows[i - 1]!.kindId, known) : '';

  return (
    <Screen header={<Header title={name} sub={t('checks.checkOf', { n: formatNumber(number), language })} onBack={ctx.back} />}>
      <SectionLabel label={t('checks.people')} />
      <Group>
        {people.map((id, j) => (
          <Row key={id} leading={<PersonAvatar look={look(id)} size={36} />} label={ctx.name(id)} sub={roleIn(org, id, languageId) || undefined}
            right={mayTeams ? <IconBtn name="close" label={t('checks.removePerson', { name: ctx.name(id) })} onPress={() => void setPeople(people.filter((p) => p !== id))} bg="transparent" color={C.muted} /> : undefined}
            last={!mayTeams && j === people.length - 1} />
        ))}
        {people.length === 0 && !mayTeams ? <Row label={t('checks.anyone')} last /> : null}
        {mayTeams ? <Row icon="plus" label={t('checks.addPeople')} onPress={() => setPicking(people)} last /> : null}
      </Group>

      <SectionLabel label={t('checks.questions')} />
      <Group>
        {questions.map((sq) => {
          const [materialId, fieldId] = sq.q.id.split('#');
          const editable = sq.source === 'language' && mayQuestions && !!materialId && !!fieldId && !state.materials[materialId]?.locked.value;
          const type = questionTypes().find((x) => x.id === sq.q.type)?.label ?? '';
          return (
            <Row key={sq.q.id} icon="chat" label={sq.q.text}
              sub={[type, sq.required ? t('common.required') : '', sq.source === 'org' ? t('checks.fromLangQuest') : ''].filter(Boolean).join(' · ')}
              {...(editable ? { onPress: () => setQuestion({ materialId: materialId!, fieldId: fieldId!, text: sq.q.text, type: sq.q.type, required: sq.required }) } : {})} />
          );
        })}
        {questions.length === 0 && !mayQuestions ? <Row label={t('checks.noQuestions')} last /> : null}
        {mayQuestions ? <Row icon="plus" label={t('checks.addQuestion')} onPress={() => setQuestion({ materialId: null, fieldId: null, text: '', type: 'yesno', required: false })} last /> : null}
      </Group>

      <SectionLabel label={t('checks.helps')} />
      <Group>
        {helps.map((h) => {
          const l = helpLabel(state, lib, h);
          return (
            <Row key={'itemId' in h ? h.itemId : h.materialId} icon={l.icon} label={l.name} sub={l.kind || undefined}
              right={mayFlows ? <IconBtn name="close" label={t('checks.removeHelp', { name: l.name })} onPress={() => void setHelp(h, false)} bg="transparent" color={C.muted} /> : undefined} />
          );
        })}
        {helps.length === 0 && !mayFlows ? <Row label={t('checks.noHelps')} last /> : null}
        {mayFlows ? <Row icon="plus" label={t('checks.addHelp')} onPress={() => setHelping(true)} last /> : null}
      </Group>

      {mayFlows ? (
        <Group>
          <Row icon="lock" label={t('checks.mustPass')} role="switch" checked={row.checkpoint}
            right={<Toggle on={row.checkpoint} label={t('checks.mustPass')} onToggle={() => void saveRows(ctx, setCheckpoint(rows, i, !row.checkpoint), t('checks.saved', { language }))} />} />
          {i > 0 ? (
            <Row icon="swap" label={t('checks.sameTimeAs', { check: previous })} role="switch" checked={row.together}
              right={<Toggle on={row.together} label={t('checks.sameTimeAs', { check: previous })} onToggle={() => void saveRows(ctx, setTogether(rows, i, !row.together), t('checks.saved', { language }))} />} />
          ) : null}
          <Row icon="trash" iconColor={TINT.redText} iconBg={TINT.red} label={t('checks.remove')} last
            onPress={() => { void saveRows(ctx, removeRow(rows, i), t('checks.removed', { check: name })).then((ok) => { if (ok) ctx.back(); }); }} />
        </Group>
      ) : null}

      <Sheet visible={picking !== null} title={t('checks.addPeople')} sub={name} onClose={() => setPicking(null)}
        footer={<PrimaryBtn label={t('common.done')} onPress={() => { const next = picking ?? people; setPicking(null); void setPeople(next); }} />}>
        {eligible.length === 0 ? <Banner icon="people" title={t('checks.nobodyYet')} body={t('checks.nobodyYetBody')} /> : (
          <Group>
            {eligible.map((id, j) => {
              const on = (picking ?? []).includes(id);
              return (
                <Row key={id} leading={<PersonAvatar look={look(id)} size={36} />} label={id === ctx.session.actorId ? t('checks.you') : ctx.name(id)}
                  sub={roleIn(org, id, languageId) || undefined} role="checkbox" checked={on} right={tick(on)} last={j === eligible.length - 1}
                  onPress={() => setPicking((cur) => (cur ?? []).includes(id) ? (cur ?? []).filter((x) => x !== id) : [...(cur ?? []), id])} />
              );
            })}
          </Group>
        )}
      </Sheet>

      <Sheet visible={question !== null} title={question?.fieldId ? t('checks.editQuestion') : t('checks.addQuestion')} sub={name} onClose={() => setQuestion(null)}
        footer={question ? (
          <>
            <PrimaryBtn label={t('common.save')} icon="check" disabled={!question.text.trim()} onPress={() => { const q = question; setQuestion(null); void saveQuestion(q); }} />
            {question.fieldId ? (
              <Pressable onPress={() => { const q = question; setQuestion(null); void saveQuestion(q, true); }} accessibilityRole="button" style={styles.quiet}>
                <Ico name="trash" size={18} color={TINT.redText} />
                <Text style={[styles.quietText, { color: TINT.redText }]}>{t('checks.removeQuestion')}</Text>
              </Pressable>
            ) : null}
          </>
        ) : undefined}>
        {question ? (
          <>
            <Field value={question.text} onChangeText={(text) => setQuestion({ ...question, text })} placeholder={t('checks.questionPlaceholder')} multiline />
            <ChipRow>
              {questionTypes().map((x) => <Chip key={x.id} label={x.label} on={question.type === x.id} onPress={() => setQuestion({ ...question, type: x.id })} />)}
            </ChipRow>
            <Group>
              <Row icon="lock" label={t('common.required')} role="switch" checked={question.required} last
                right={<Toggle on={question.required} label={t('common.required')} onToggle={() => setQuestion({ ...question, required: !question.required })} />} />
            </Group>
          </>
        ) : null}
      </Sheet>

      <Sheet visible={helping} title={t('checks.addHelp')} sub={name} onClose={() => setHelping(false)}
        footer={<PrimaryBtn label={t('common.done')} onPress={() => setHelping(false)} />}>
        <SectionLabel label={t('checks.notes')} />
        <Group>
          {ownNotes.map((m) => {
            const on = linked.has(`material:${m.materialId}`);
            return <Row key={m.materialId} icon="note" label={m.title} sub={referenceKindName(m.kind)} role="checkbox" checked={on} right={tick(on)} onPress={() => void setHelp({ materialId: m.materialId }, !on)} />;
          })}
          {library.filter((x) => x.kind === 'note' || x.kind === 'other').map(({ it }) => {
            const on = linked.has(`item:${it.itemId}`);
            return <Row key={it.itemId} icon="note" label={it.name} sub={it.description || undefined} role="checkbox" checked={on} right={tick(on)} onPress={() => void setHelp({ itemId: it.itemId }, !on)} />;
          })}
          {mayWrite ? <Row icon="plus" label={t('checks.writeNote')} onPress={() => { setHelping(false); setWriting({ title: '', text: '' }); }} last /> : null}
        </Group>
        {library.some((x) => x.kind === 'guide' || x.kind === 'source') ? (
          <>
            <SectionLabel label={t('checks.guidesAndBibles')} />
            <Group>
              {library.filter((x) => x.kind === 'guide' || x.kind === 'source').map(({ it, kind }, j, a) => {
                const on = linked.has(`item:${it.itemId}`);
                return <Row key={it.itemId} icon={kind === 'source' ? 'book' : 'sparkle'} label={it.name} role="checkbox" checked={on} right={tick(on)} last={j === a.length - 1}
                  onPress={() => void setHelp({ itemId: it.itemId }, !on)} />;
              })}
            </Group>
          </>
        ) : null}
      </Sheet>

      <Sheet visible={writing !== null} title={t('checks.writeNote')} sub={name} onClose={() => setWriting(null)}
        footer={writing ? <PrimaryBtn label={t('common.save')} icon="check" disabled={!writing.title.trim() || !writing.text.trim()} onPress={() => { const w = writing; setWriting(null); void writeNote(w); }} /> : undefined}>
        {writing ? (
          <>
            <Field label={t('checks.noteTitle')} value={writing.title} onChangeText={(title) => setWriting({ ...writing, title })} autoCapitalize="sentences" />
            <Field label={t('checks.noteText')} value={writing.text} onChangeText={(text) => setWriting({ ...writing, text })} multiline autoCapitalize="sentences" />
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}

export const contracts = contractsFor('check_editor');

const styles = StyleSheet.create({
  start: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.xs },
  mic: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 68, paddingVertical: space.md, paddingRight: space.md, borderRadius: 18, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border },
  grip: { width: 40, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  num: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  numText: { fontSize: 15, fontWeight: '800', color: C.primary },
  title: { fontSize: 17, fontWeight: '800', color: C.dark, lineHeight: 23 },
  meta: { flexDirection: 'row', gap: space.md, flexWrap: 'wrap' },
  metaPart: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, fontWeight: '700', color: C.muted },
  together: { flexDirection: 'row', gap: space.sm },
  bar: { width: 3, borderRadius: 2, backgroundColor: C.soft, marginVertical: space.lg },
  sameTime: { fontSize: 13, fontWeight: '800', color: C.soft, paddingHorizontal: space.xs },
  quiet: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, minHeight: 48 },
  quietText: { fontSize: 17, fontWeight: '700', color: C.muted },
  tick: { width: 28, height: 28, borderRadius: radius.sm, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  tickOn: { backgroundColor: C.primary, borderColor: C.primary }
});
