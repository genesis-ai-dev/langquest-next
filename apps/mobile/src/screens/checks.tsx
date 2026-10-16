// A language's checks (decisions.md 91): one list, in order, each check with
// its own people, questions and helps. `LanguageChecks` (src/checks) is the list (the
// flow editor for a language's own steps, `flow_editor` with `steps:
// 'language'`, or New language's draft with `draft: '1'`); `CheckEditor` is
// one check. Every change saves as it is made; the list's header Undo takes a
// save back, one made here too, and removing a check asks first (decision 134).
import { checkHelps, checkHelpSpecs, checkPeople, checkPeopleSpecs, checkShows, checkShowsSpecs, commands, deriveFlow, formatQuestionField, kindOf, languageName, languagePeople, materialsFor, membershipsOf, questionsForKind, RECORD_STEP, scopeCovers, shownFrom, type CheckHelp, type EventSpec, type KindDef, type LanguageState, type MakesSpec, type OrgState, type QuestionSpec, type ShownWhat } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '../ui/text';
import { deriveKinds } from '../i18n/coreText';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { indexesFor } from '../sync/indexes';
import { Banner, Chip, ChipRow, EmptyState, Field, Group, Header, Ico, IconBtn, KindIcon, PrimaryBtn, Row, Screen, SectionLabel, Sheet, Toggle } from '../ui/kit';
import { useLibrary, useLibraryDocs } from '../library/useLibrary';
import { refKindOf } from '../reference/model';
import { failureMessage } from '../diagnostics/report';
import { ConfirmDelete } from '../ui/ConfirmDelete';
import { contractsFor } from '../shell/screenContracts';
import { C, TINT } from '../ui/theme';
import { PersonAvatar } from '../ui/UserChip';
import { usePerson } from '../ui/usePerson';
import { checkName } from '../admin/adminModel';
import { groupOf, removeRow, rowNumbers, rowsOf, sameTimeOf, setCheckpoint, setSameTime } from '../checks/model';
import { newKindId, nextFieldId, referenceKindName } from '../config/model';
import { docLanguage, inLanguages, teamLanguage, teamLanguages } from '../reference/languages';
import { saveRows } from '../checks/checkActions';
import { styles } from '../checks/checkStyles';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { ShowsSection } from '../checks/ShowsSection';
import { setParts } from '../checks/showActions';
import { isAudio, partsOf, type ShowPart } from '../checks/showsModel';
import { MakesFields } from '../writing/StepMaking';

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

// ---- the list ----------------------------------------------------------------------------

// ---- one check -------------------------------------------------------------------------------

interface QuestionDraft { materialId: string | null; fieldId: string | null; text: string; type: QuestionSpec['type']; required: boolean }

function questionTypes(): { id: QuestionSpec['type']; label: string; help: string }[] {
  return [
    { id: 'text', label: t('checks.questionType.text'), help: t('checks.questionType.textHelp') },
    { id: 'yesno', label: t('checks.questionType.yesno'), help: t('checks.questionType.yesnoHelp') },
    { id: 'rating', label: t('checks.questionType.rating'), help: t('checks.questionType.ratingHelp') }
  ];
}

/** Under a question being changed: take it off the check. */
function RemoveQuestion(props: { onPress: () => void }) {
  const spot = useHelpSpot(t('checks.removeQuestion'), t('checks.removeQuestionHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" style={styles.quiet}>
      <Ico name="trash" size={18} color={TINT.redText} />
      <Text style={[styles.quietText, { color: TINT.redText }]}>{t('checks.removeQuestion')}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** A tick for a pick-many row. */
function Tick(props: { on: boolean }) {
  return <View style={[styles.tick, props.on && styles.tickOn]}>{props.on ? <Ico name="check" size={18} color={C.white} strokeWidth={3} /> : null}</View>;
}

/** Recording a version, as a step: what the recorder shows (decisions.md 130). */
function RecordEditor({ ctx }: { ctx: Ctx }) {
  const language = languageName(ctx.org.state, ctx.language.languageId);
  const name = t('checks.recording');
  return (
    <Screen header={<Header title={name} sub={language} onBack={ctx.back} />}>
      <ShowsSection ctx={ctx} kindId={RECORD_STEP} name={name} canEdit={ctx.session.can('manage_flows')} />
    </Screen>
  );
}

/**
 * One check, or one of its parts as a page of its own (`part`): its people,
 * its questions, and each help with parts inside it (decisions.md 130).
 */
export function CheckEditor(ctx: Ctx) {
  const part = ctx.params['part'];
  if (part === 'people') return <PeoplePage ctx={ctx} />;
  if (part === 'questions') return <QuestionsPage ctx={ctx} />;
  if (part === 'bible' || part === 'guide' || part === 'notes' || part === 'earlier') return <ShowsPage ctx={ctx} part={part} />;
  if (ctx.params['kindId'] === RECORD_STEP) return <RecordEditor ctx={ctx} />;
  return <OneCheck ctx={ctx} />;
}

/** The check's name, its place and the language, for every page of it; null while the language loads or when it is gone. */
function useCheck(ctx: Ctx) {
  const state = ctx.language.state;
  const kindId = ctx.params['kindId'] ?? '';
  const known = useMemo(() => (state ? deriveKinds(state) : []), [state]);
  const rows = useMemo(() => (state ? rowsOf(deriveFlow(state).steps) : []), [state]);
  const i = rows.findIndex((r) => r.kindId === kindId);
  const name = kindId === RECORD_STEP ? t('checks.recording') : checkName(kindId, known);
  const language = languageName(ctx.org.state, ctx.language.languageId);
  return { state, kindId, known, rows, i, name, language };
}

function Gone(props: { ctx: Ctx; name: string; loading: boolean }) {
  return (
    <Screen header={<Header title={props.name} onBack={props.ctx.back} />}>
      <EmptyState icon="flow" title={props.loading ? t('common.loading') : t('checks.gone')} />
    </Screen>
  );
}

function OneCheck({ ctx }: { ctx: Ctx }) {
  const { state, kindId, known, rows, i, name, language } = useCheck(ctx);
  const languageId = ctx.language.languageId;
  const lib = useLibrary(ctx);
  const [helping, setHelping] = useState(false);
  const [writing, setWriting] = useState<{ title: string; text: string } | null>(null);
  const [together, setTogether] = useState<string[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const items = lib.items('material').filter((it) => it.current && !it.archived);
  const docs = useLibraryDocs(lib.orgId, items.map((it) => it.current), { deps: false });
  if (!state || i < 0) return <Gone ctx={ctx} name={name} loading={!state} />;
  const row = rows[i]!;
  const number = rowNumbers(rows)[i]!;
  const people = checkPeople(state, kindId);
  const helps = checkHelps(state, kindId);
  const questions = questionsForKind(state, kindId);
  const mayFlows = ctx.session.can('manage_flows');
  const mayWrite = ctx.session.can('manage_reference');
  const kind = kindOf(state, kindId);
  const others = sameTimeOf(rows, i);
  const open = (part: string) => ctx.go('check_editor', { languageId, kindId, part });

  async function setHelp(help: CheckHelp, linked: boolean, before: EventSpec[] = []) {
    const s = ctx.language.state;
    if (!s) return;
    const commandId = Crypto.randomUUID();
    const specs = [...before, ...checkHelpSpecs(s, { commandId, kindId, help, linked })];
    if (!specs.length) return;
    // No Undo: the help is put back from Add a help (no timed undo toasts, Caleb 2026-10-16).
    await ctx.act(specs, linked ? t('checks.helpAdded', { check: name }) : t('checks.helpRemoved', { check: name })).catch(() => {});
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

  /** Who listens to what this check makes: another check, or a new check of its own right after it. */
  function setCheckedBy(target: string | 'own') {
    const s = ctx.language.state;
    if (!s || !kind.produces) return;
    const c = commands(s, indexesFor(s));
    const own = target === 'own'
      ? { id: newKindId(t('checks.ownCheckName', { name }), known.map((k) => k.id)), name: t('checks.ownCheckName', { name }) }
      : null;
    const checkedBy = own ? own.id : target;
    const before = [
      ...(own ? c.defineKind({ commandId: Crypto.randomUUID(), kindId: own.id, name: own.name, description: '', usualReviewer: '' }) : []),
      ...c.defineKind({
        commandId: Crypto.randomUUID(), kindId, name: kind.name, description: kind.description, usualReviewer: kind.usualReviewer,
        ...(kind.withholdsContext ? { withholdsContext: true } : {}), produces: { ...kind.produces, checkedBy }
      })
    ];
    // A check of its own goes right after this check's step.
    const group = groupOf(rows, i);
    const next = own ? [...rows.slice(0, group.at(-1)! + 1), { kindId: own.id, together: false, checkpoint: false }, ...rows.slice(group.at(-1)! + 1)] : rows;
    void saveRows(ctx, next, t('checks.saved', { language }), before);
  }
  const checkers = rows.filter((r, j) => j !== i && !kindOf(state, r.kindId).produces);
  const checkedByName = kind.produces ? checkName(kind.produces.checkedBy, known) : '';

  // A step that makes something (decisions.md 137): what it turns, into what, in which language, and what happens to it.
  const makes = kind.makes;
  const reference = teamLanguage(ctx.org.state, state, languageId);
  const setMakes = (next: MakesSpec) => {
    const s = ctx.language.state;
    if (!s) return;
    // No Undo: the same choices change it back (decision 134).
    void ctx.act(commands(s, indexesFor(s)).setStepMakes({ commandId: Crypto.randomUUID(), kindId, makes: next }), t('checks.saved', { language })).catch(() => {});
  };
  // Words added here, before a step that makes the next version, stay with the older version (decision 137).
  const laterVersion = makes?.result === 'added' ? rows.slice(i + 1).map((r) => known.find((k) => k.id === r.kindId)).find((k) => k?.makes?.result === 'version') : undefined;
  // A check may read what an earlier step made instead of the version (a spelling check of what was written down).
  const makersBefore = rows.slice(0, i).map((r) => known.find((k) => k.id === r.kindId)).filter((k): k is KindDef => !!k?.makes);
  const looksAt = kind.looksAt ?? null;
  const setLooksAt = (maker: string | null) => {
    const s = ctx.language.state;
    if (!s || maker === looksAt) return;
    void ctx.act(commands(s, indexesFor(s)).setCheckLooksAt({ commandId: Crypto.randomUUID(), kindId, makerKindId: maker }), t('checks.saved', { language })).catch(() => {});
  };

  // What can be linked: the language's own notes, and the organization's notes, guides and Bibles.
  const ownNotes = materialsFor(state).filter((m) => !['questions', 'key_terms', 'fia_study'].includes(m.kind));
  const all = items.map((it) => ({ it, kind: refKindOf(docs.get(it.current)), language: docLanguage(docs.get(it.current)) }))
    .filter((x) => x.kind === 'note' || x.kind === 'other' || x.kind === 'guide' || x.kind === 'source');
  // Helps are offered in the language the team's material is in, set once for the language (Caleb, 2026-10-16).
  const team = teamLanguages(ctx.org.state, state, languageId);
  const library = all.filter((x) => inLanguages(x.language, team));
  const linked = new Set(helps.map((h) => ('itemId' in h ? `item:${h.itemId}` : `material:${h.materialId}`)));
  const linkedHelp = (on: boolean) => (on ? t('checks.helpOnHelp') : t('checks.helpOffHelp'));
  const tick = (on: boolean) => <Tick on={on} />;

  return (
    <Screen header={<Header title={name} sub={t('checks.checkOf', { n: formatNumber(number), language })} onBack={ctx.back} />}>
      {makes ? (
        <>
          <SectionLabel label={t('writing.step.whatItMakes')} />
          <MakesFields makes={makes} own={language} reference={reference} onChange={setMakes} disabled={!mayFlows}
            {...(laterVersion ? { warning: t('writing.step.addedBeforeVersion', { step: laterVersion.name }) } : {})} />
        </>
      ) : makersBefore.length > 0 ? (
        <>
          <SectionLabel label={t('writing.step.reads')} />
          <ChipRow>
            <Chip label={t('writing.step.theVersion')} on={!looksAt} help={t('writing.help.readsVersion')} onPress={() => mayFlows && setLooksAt(null)} />
            {/* help-each: each chip is a different thing for the check to read */}
            {makersBefore.map((m) => <Chip key={m.id} label={t('writing.step.whatMade', { step: m.name })} icon={m.makes!.to === 'writing' ? 'edit' : 'mic'}
              help={t('writing.help.readsMade', { step: m.name })} on={looksAt === m.id} onPress={() => mayFlows && setLooksAt(m.id)} />)}
          </ChipRow>
        </>
      ) : null}
      <Group>
        <Row icon="people" label={t('checks.people')} sub={people.length ? people.map((id) => ctx.name(id)).join(', ') : t('checks.anyone')}
          help={t('checks.peopleOpenHelp')} onPress={() => open('people')} />
        <Row icon="chat" label={t('checks.questions')} sub={questions.length ? t('checks.questionsCount', { count: questions.length }) : t('checks.noQuestions')}
          help={t('checks.questionsOpenHelp')} onPress={() => open('questions')} last />
      </Group>

      <ShowsSection ctx={ctx} kindId={kindId} name={name} canEdit={mayFlows} />

      <SectionLabel label={t('checks.helps')} />
      <Group>
        {helps.map((h) => {
          const l = helpLabel(state, lib, h);
          return (
            <HelpRow key={'itemId' in h ? h.itemId : h.materialId} of="checks.help">
              <Row icon={l.icon} label={l.name} sub={l.kind || undefined}
                right={mayFlows ? <IconBtn name="close" label={t('checks.removeHelp', { name: l.name })} help={t('checks.unlinkHelp')} onPress={() => void setHelp(h, false)} bg="transparent" color={C.muted} /> : undefined} />
            </HelpRow>
          );
        })}
        {helps.length === 0 && !mayFlows ? <Row label={t('checks.noHelps')} last /> : null}
        {mayFlows ? <Row icon="plus" label={t('checks.addHelp')} help={t('checks.addHelpHelp')} onPress={() => setHelping(true)} last /> : null}
      </Group>

      {mayFlows ? (
        <Group>
          <Row icon="lock" label={t('checks.mustPass')} role="switch" checked={row.checkpoint}
            right={<Toggle testID="toggle-must-pass" on={row.checkpoint} label={t('checks.mustPass')} help={row.checkpoint ? t('admin.lock.on') : t('admin.lock.off')}
              onToggle={() => void saveRows(ctx, setCheckpoint(rows, i, !row.checkpoint), t('checks.saved', { language }))} />} />
          {rows.length > 1 ? (
            <Row icon="swap" label={t('checks.sameTimeRow')} sub={others.length ? others.map((k) => checkName(k, known)).join(', ') : t('checks.sameTimeNone')}
              help={t('checks.sameTimeHelp')} onPress={() => setTogether(others)} />
          ) : null}
          {kind.produces ? (
            <Row icon="arrowR" label={t('checks.checkedAt')} sub={checkedByName} help={t('checks.checkedAtHelp')} onPress={() => setChecking(true)} />
          ) : null}
          <Row icon="trash" iconColor={TINT.redText} iconBg={TINT.red} label={t('checks.remove')} help={t('checks.removeCheckHelp')} last
            onPress={() => setRemoving(true)} />
        </Group>
      ) : null}
      {/* A whole check goes: it asks first, and back on the list its Undo puts it back. */}
      <ConfirmDelete visible={removing} name={name} title={t('checks.removeAsk', { check: name })} sub={t('checks.checkOf', { n: formatNumber(number), language })}
        confirmLabel={t('checks.remove')} onClose={() => setRemoving(false)}
        onConfirm={() => { setRemoving(false); void saveRows(ctx, removeRow(rows, i), t('checks.removed', { check: name })).then((was) => { if (was) ctx.back(); }); }} />

      <Sheet visible={together !== null} title={t('checks.sameTimeRow')} sub={name} onClose={() => setTogether(null)}
        footer={<PrimaryBtn label={t('common.done')} help={t('checks.sameTimeDoneHelp')} onPress={() => {
          const next = together ?? others;
          setTogether(null);
          void saveRows(ctx, setSameTime(rows, i, next), t('checks.saved', { language }));
        }} />}>
        <Group>
          {rows.filter((_, j) => j !== i).map((r, j, a) => {
            const on = (together ?? []).includes(r.kindId);
            return (
              <HelpRow key={r.kindId} of="checks.sameTime">
                <Row leading={<KindIcon kindId={r.kindId} size={40} />} label={checkName(r.kindId, known)} role="checkbox" checked={on} right={tick(on)}
                  help={on ? t('checks.sameTimeOnHelp2') : t('checks.sameTimeOffHelp2')} last={j === a.length - 1}
                  onPress={() => setTogether((cur) => (cur ?? []).includes(r.kindId) ? (cur ?? []).filter((x) => x !== r.kindId) : [...(cur ?? []), r.kindId])} />
              </HelpRow>
            );
          })}
        </Group>
      </Sheet>

      <Sheet visible={checking} title={t('checks.checkedAt')} sub={name} onClose={() => setChecking(false)}>
        <Group>
          {checkers.map((r) => {
            const on = kind.produces?.checkedBy === r.kindId;
            return (
              <HelpRow key={r.kindId} of="checks.checker">
                <Row leading={<KindIcon kindId={r.kindId} size={40} />} label={checkName(r.kindId, known)} role="radio" selected={on}
                  right={on ? <Ico name="check" size={20} color={C.primary} strokeWidth={3} /> : undefined} help={t('checks.checkedAtPickHelp')}
                  onPress={() => { setChecking(false); if (!on) setCheckedBy(r.kindId); }} />
              </HelpRow>
            );
          })}
          <Row icon="plus" label={t('checks.ownCheck')} help={t('checks.ownCheckHelp')} last onPress={() => { setChecking(false); setCheckedBy('own'); }} />
        </Group>
      </Sheet>

      <Sheet visible={helping} title={t('checks.addHelp')} sub={name} onClose={() => setHelping(false)}
        footer={<PrimaryBtn label={t('common.done')} help={t('checks.helpsDoneHelp')} onPress={() => setHelping(false)} />}>
        <SectionLabel label={t('checks.notes')} />
        <Group>
          {ownNotes.map((m) => {
            const on = linked.has(`material:${m.materialId}`);
            return (
              <HelpRow key={m.materialId} of="checks.linkHelp">
                <Row icon="note" label={m.title} sub={referenceKindName(m.kind)} role="checkbox" checked={on} right={tick(on)} help={linkedHelp(on)} onPress={() => void setHelp({ materialId: m.materialId }, !on)} />
              </HelpRow>
            );
          })}
          {library.filter((x) => x.kind === 'note' || x.kind === 'other').map(({ it }) => {
            const on = linked.has(`item:${it.itemId}`);
            return (
              <HelpRow key={it.itemId} of="checks.linkHelp">
                <Row icon="note" label={it.name} sub={it.description || undefined} role="checkbox" checked={on} right={tick(on)} help={linkedHelp(on)} onPress={() => void setHelp({ itemId: it.itemId }, !on)} />
              </HelpRow>
            );
          })}
          {mayWrite ? <Row icon="plus" label={t('checks.writeNote')} help={t('checks.writeNoteHelp')} onPress={() => { setHelping(false); setWriting({ title: '', text: '' }); }} last /> : null}
        </Group>
        {library.some((x) => x.kind === 'guide' || x.kind === 'source') ? (
          <>
            <SectionLabel label={t('checks.guidesAndBibles')} />
            <Group>
              {library.filter((x) => x.kind === 'guide' || x.kind === 'source').map(({ it, kind: k }, j, a) => {
                const on = linked.has(`item:${it.itemId}`);
                return (
                  <HelpRow key={it.itemId} of="checks.linkHelp">
                    <Row icon={k === 'source' ? 'book' : 'sparkle'} label={it.name} role="checkbox" checked={on} right={tick(on)} last={j === a.length - 1} help={linkedHelp(on)}
                      onPress={() => void setHelp({ itemId: it.itemId }, !on)} />
                  </HelpRow>
                );
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

/** A check's people, on a page of their own. */
function PeoplePage({ ctx }: { ctx: Ctx }) {
  const { state, kindId, known, rows, i, name } = useCheck(ctx);
  const org = ctx.org.state;
  const languageId = ctx.language.languageId;
  const look = usePerson();
  const [picking, setPicking] = useState<string[] | null>(null);
  if (!state || i < 0) return <Gone ctx={ctx} name={name} loading={!state} />;
  const people = checkPeople(state, kindId);
  const mayTeams = ctx.session.can('manage_teams');
  const eligible = [...new Set([...[...languagePeople(org, languageId).values()].filter((p) => p.privileges.has('review')).map((p) => p.profileId), ...people])]
    .sort((a, b) => ctx.name(a).localeCompare(ctx.name(b)));
  async function setPeople(next: string[]) {
    const s = ctx.language.state;
    if (!s) return;
    const plan = checkPeopleSpecs(s, { commandId: Crypto.randomUUID(), kindId, people: next, kinds: rows.map((r) => r.kindId), nameOf: (k) => checkName(k, known) });
    if (!plan.specs.length) return;
    // No Undo: whoever was taken off is added back from Add people (no timed undo toasts).
    await ctx.act(plan.specs, t('checks.peopleSaved', { check: name, count: next.length })).catch(() => {});
  }
  return (
    <Screen header={<Header title={t('checks.people')} sub={name} onBack={ctx.back} />}>
      <Group>
        {people.map((id, j) => (
          <HelpRow key={id} of="checks.person">
            <Row leading={<PersonAvatar look={look(id)} size={36} />} label={ctx.name(id)} sub={roleIn(org, id, languageId) || undefined}
              right={mayTeams ? <IconBtn name="close" label={t('checks.removePerson', { name: ctx.name(id) })} help={t('checks.removePersonHelp')} onPress={() => void setPeople(people.filter((p) => p !== id))} bg="transparent" color={C.muted} /> : undefined}
              last={!mayTeams && j === people.length - 1} />
          </HelpRow>
        ))}
        {people.length === 0 && !mayTeams ? <Row label={t('checks.anyone')} last /> : null}
        {mayTeams ? <Row icon="plus" label={t('checks.addPeople')} help={t('checks.addPeopleHelp')} onPress={() => setPicking(people)} last /> : null}
      </Group>
      <Sheet visible={picking !== null} title={t('checks.addPeople')} sub={name} onClose={() => setPicking(null)}
        footer={<PrimaryBtn label={t('common.done')} help={t('checks.peopleDoneHelp')} onPress={() => { const next = picking ?? people; setPicking(null); void setPeople(next); }} />}>
        {eligible.length === 0 ? <Banner icon="people" title={t('checks.nobodyYet')} body={t('checks.nobodyYetBody')} /> : (
          <Group>
            {eligible.map((id, j) => {
              const on = (picking ?? []).includes(id);
              return (
                <HelpRow key={id} of="checks.pickPerson">
                  <Row leading={<PersonAvatar look={look(id)} size={36} />} label={id === ctx.session.actorId ? t('checks.you') : ctx.name(id)}
                    sub={roleIn(org, id, languageId) || undefined} role="checkbox" checked={on} right={<Tick on={on} />} last={j === eligible.length - 1}
                    help={on ? t('checks.personOnHelp') : t('checks.personOffHelp')}
                    onPress={() => setPicking((cur) => (cur ?? []).includes(id) ? (cur ?? []).filter((x) => x !== id) : [...(cur ?? []), id])} />
                </HelpRow>
              );
            })}
          </Group>
        )}
      </Sheet>
    </Screen>
  );
}

/** A check's questions, on a page of their own. */
function QuestionsPage({ ctx }: { ctx: Ctx }) {
  const { state, kindId, i, name } = useCheck(ctx);
  const [question, setQuestion] = useState<QuestionDraft | null>(null);
  if (!state || i < 0) return <Gone ctx={ctx} name={name} loading={!state} />;
  const questions = questionsForKind(state, kindId);
  const mayQuestions = ctx.session.can('fill_reference');

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

  return (
    <Screen header={<Header title={t('checks.questions')} sub={name} onBack={ctx.back} />}>
      <Group>
        {questions.map((sq) => {
          const [materialId, fieldId] = sq.q.id.split('#');
          const editable = sq.source === 'language' && mayQuestions && !!materialId && !!fieldId && !state.materials[materialId]?.locked.value;
          const type = questionTypes().find((x) => x.id === sq.q.type)?.label ?? '';
          return (
            <HelpRow key={sq.q.id} of="checks.question">
              <Row icon="chat" label={sq.q.text}
                sub={[type, sq.required ? t('common.required') : ''].filter(Boolean).join(' · ')} help={t('checks.editQuestionHelp')}
                {...(editable ? { onPress: () => setQuestion({ materialId: materialId!, fieldId: fieldId!, text: sq.q.text, type: sq.q.type, required: sq.required }) } : {})} />
            </HelpRow>
          );
        })}
        {questions.length === 0 && !mayQuestions ? <Row label={t('checks.noQuestions')} last /> : null}
        {mayQuestions ? <Row icon="plus" label={t('checks.addQuestion')} help={t('checks.addQuestionHelp')} onPress={() => setQuestion({ materialId: null, fieldId: null, text: '', type: 'yesno', required: false })} last /> : null}
      </Group>
      <Sheet visible={question !== null} title={question?.fieldId ? t('checks.editQuestion') : t('checks.addQuestion')} sub={name} onClose={() => setQuestion(null)}
        footer={question ? (
          <>
            <PrimaryBtn label={t('common.save')} icon="check" disabled={!question.text.trim()} onPress={() => { const q = question; setQuestion(null); void saveQuestion(q); }} />
            {question.fieldId ? (
              <RemoveQuestion onPress={() => { const q = question; setQuestion(null); void saveQuestion(q, true); }} />
            ) : null}
          </>
        ) : undefined}>
        {question ? (
          <>
            <Field value={question.text} onChangeText={(text) => setQuestion({ ...question, text })} placeholder={t('checks.questionPlaceholder')} multiline
              help={t('checks.questionFieldHelp')} />
            <ChipRow>
              {/* help-each: each type asks for a different kind of answer */}
              {questionTypes().map((x) => <Chip key={x.id} label={x.label} on={question.type === x.id} help={x.help} onPress={() => setQuestion({ ...question, type: x.id })} />)}
            </ChipRow>
            <Group>
              <Row icon="lock" label={t('common.required')} role="switch" checked={question.required} last
                right={<Toggle testID="toggle-required" on={question.required} label={t('common.required')}
                  help={question.required ? t('config.material.requiredHelp') : t('config.material.suggestedHelp')} onToggle={() => setQuestion({ ...question, required: !question.required })} />} />
            </Group>
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}

/**
 * One help a step shows, on a page of its own (decisions.md 130): a switch
 * for each of its parts, the Bible and the guide as audio and text, notes and
 * earlier versions by the step they were added during.
 */
function ShowsPage({ ctx, part }: { ctx: Ctx; part: 'bible' | 'guide' | 'notes' | 'earlier' }) {
  const { state, kindId, known, i, name } = useCheck(ctx);
  if (!state || (i < 0 && kindId !== RECORD_STEP)) return <Gone ctx={ctx} name={name} loading={!state} />;
  const canEdit = ctx.session.can('manage_flows');
  const title = part === 'bible' ? t('checks.shows.bible') : part === 'guide' ? t('checks.shows.guide') : part === 'notes' ? t('checks.shows.notes') : t('checks.shows.earlier');
  const parts = partsOf(state, kindId, part);
  const labelOf = (p: ShowPart) => (p.from !== undefined ? (p.from === RECORD_STEP ? t('checks.recording') : checkName(p.from, known)) : isAudio(p.what) ? t('checks.shows.audio') : t('checks.shows.text'));
  const iconOf = (p: ShowPart) => (p.from !== undefined ? (p.from === RECORD_STEP ? <View style={styles.mic}><Ico name="mic" size={18} color={C.white} /></View> : <KindIcon kindId={p.from} size={40} />) : null);
  const set = (p: ShowPart) => {
    if (!canEdit) return;
    const what = t('checks.shows.partLabel', { help: title, part: labelOf(p) });
    void setParts(ctx, kindId, [p], !p.on, p.on ? t('checks.shows.hiddenToast', { what, check: name }) : t('checks.shows.shownToast', { what, check: name }));
  };
  return (
    <Screen header={<Header title={title} sub={name} onBack={ctx.back} />}>
      {part === 'notes' || part === 'earlier' ? <SectionLabel label={part === 'notes' ? t('checks.shows.notesFrom') : t('checks.shows.earlierFrom')} /> : null}
      <Group>
        {/* help-each: each switch shows or hides a different part */}
        {parts.map((p, j) => {
          const leading = iconOf(p);
          return (
            <Row key={p.key} {...(leading ? { leading } : { icon: isAudio(p.what) ? 'listen' as const : 'book' as const })} label={labelOf(p)}
              role="switch" checked={p.on} muted={!p.on} last={j === parts.length - 1}
              right={<Toggle testID={`toggle-part-${p.key}`} on={p.on} label={labelOf(p)} disabled={!canEdit}
                help={p.on ? t('checks.shows.onHelp') : t('checks.shows.offHelp')} onToggle={() => set(p)} />} />
          );
        })}
      </Group>
    </Screen>
  );
}

export const contracts = contractsFor('check_editor');

