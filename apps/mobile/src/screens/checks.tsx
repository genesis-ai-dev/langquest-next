// A language's checks (decisions.md 91): one list, in order, each check with
// its own people, questions and helps. `LanguageChecks` (src/checks) is the list (the
// flow editor for a language's own steps, `flow_editor` with `steps:
// 'language'`, or New language's draft with `draft: '1'`); `CheckEditor` is
// one check. Every change saves as it is made, with Undo, like the rest of
// the app's lists.
import { checkHelps, checkHelpSpecs, checkPeople, checkPeopleSpecs, commands, deriveFlow, formatQuestionField, languageName, languagePeople, materialsFor, membershipsOf, questionsForKind, scopeCovers, type CheckHelp, type EventSpec, type LanguageState, type OrgState, type QuestionSpec } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '../ui/text';
import { deriveKinds } from '../i18n/coreText';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { indexesFor } from '../sync/indexes';
import { Banner, Chip, ChipRow, EmptyState, Field, Group, Header, Ico, IconBtn, PrimaryBtn, Row, Screen, SectionLabel, Sheet, Toggle } from '../ui/kit';
import { useLibrary, useLibraryDocs } from '../library/useLibrary';
import { refKindOf } from '../reference/model';
import { failureMessage } from '../diagnostics/report';
import { contractsFor } from '../shell/screenContracts';
import { C, TINT } from '../ui/theme';
import { PersonAvatar } from '../ui/UserChip';
import { usePerson } from '../ui/usePerson';
import { checkName } from '../admin/adminModel';
import { removeRow, rowNumbers, rowsOf, setCheckpoint, setTogether } from '../checks/model';
import { nextFieldId, referenceKindName } from '../config/model';
import { saveRows } from '../checks/checkActions';
import { styles } from '../checks/checkStyles';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge } from '../helpMode/helpBadge';

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
  const linkedHelp = (on: boolean) => (on ? t('checks.helpOnHelp') : t('checks.helpOffHelp'));
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
            right={mayTeams ? <IconBtn name="close" label={t('checks.removePerson', { name: ctx.name(id) })} help={t('checks.removePersonHelp')} onPress={() => void setPeople(people.filter((p) => p !== id))} bg="transparent" color={C.muted} /> : undefined}
            last={!mayTeams && j === people.length - 1} />
        ))}
        {people.length === 0 && !mayTeams ? <Row label={t('checks.anyone')} last /> : null}
        {mayTeams ? <Row icon="plus" label={t('checks.addPeople')} help={t('checks.addPeopleHelp')} onPress={() => setPicking(people)} last /> : null}
      </Group>

      <SectionLabel label={t('checks.questions')} />
      <Group>
        {questions.map((sq) => {
          const [materialId, fieldId] = sq.q.id.split('#');
          const editable = sq.source === 'language' && mayQuestions && !!materialId && !!fieldId && !state.materials[materialId]?.locked.value;
          const type = questionTypes().find((x) => x.id === sq.q.type)?.label ?? '';
          return (
            <Row key={sq.q.id} icon="chat" label={sq.q.text}
              sub={[type, sq.required ? t('common.required') : ''].filter(Boolean).join(' · ')} help={t('checks.editQuestionHelp')}
              {...(editable ? { onPress: () => setQuestion({ materialId: materialId!, fieldId: fieldId!, text: sq.q.text, type: sq.q.type, required: sq.required }) } : {})} />
          );
        })}
        {questions.length === 0 && !mayQuestions ? <Row label={t('checks.noQuestions')} last /> : null}
        {mayQuestions ? <Row icon="plus" label={t('checks.addQuestion')} help={t('checks.addQuestionHelp')} onPress={() => setQuestion({ materialId: null, fieldId: null, text: '', type: 'yesno', required: false })} last /> : null}
      </Group>

      <SectionLabel label={t('checks.helps')} />
      <Group>
        {helps.map((h) => {
          const l = helpLabel(state, lib, h);
          return (
            <Row key={'itemId' in h ? h.itemId : h.materialId} icon={l.icon} label={l.name} sub={l.kind || undefined}
              right={mayFlows ? <IconBtn name="close" label={t('checks.removeHelp', { name: l.name })} help={t('checks.unlinkHelp')} onPress={() => void setHelp(h, false)} bg="transparent" color={C.muted} /> : undefined} />
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
          {i > 0 ? (
            <Row icon="swap" label={t('checks.sameTimeAs', { check: previous })} role="switch" checked={row.together}
              right={<Toggle testID="toggle-same-time" on={row.together} label={t('checks.sameTimeAs', { check: previous })}
                help={row.together ? t('checks.sameTimeOnHelp', { check: previous }) : t('checks.sameTimeOffHelp', { check: previous })}
                onToggle={() => void saveRows(ctx, setTogether(rows, i, !row.together), t('checks.saved', { language }))} />} />
          ) : null}
          <Row icon="trash" iconColor={TINT.redText} iconBg={TINT.red} label={t('checks.remove')} help={t('checks.removeCheckHelp')} last
            onPress={() => { void saveRows(ctx, removeRow(rows, i), t('checks.removed', { check: name })).then((ok) => { if (ok) ctx.back(); }); }} />
        </Group>
      ) : null}

      <Sheet visible={picking !== null} title={t('checks.addPeople')} sub={name} onClose={() => setPicking(null)}
        footer={<PrimaryBtn label={t('common.done')} help={t('checks.peopleDoneHelp')} onPress={() => { const next = picking ?? people; setPicking(null); void setPeople(next); }} />}>
        {eligible.length === 0 ? <Banner icon="people" title={t('checks.nobodyYet')} body={t('checks.nobodyYetBody')} /> : (
          <Group>
            {eligible.map((id, j) => {
              const on = (picking ?? []).includes(id);
              return (
                <Row key={id} leading={<PersonAvatar look={look(id)} size={36} />} label={id === ctx.session.actorId ? t('checks.you') : ctx.name(id)}
                  sub={roleIn(org, id, languageId) || undefined} role="checkbox" checked={on} right={tick(on)} last={j === eligible.length - 1}
                  help={on ? t('checks.personOnHelp') : t('checks.personOffHelp')}
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
              <RemoveQuestion onPress={() => { const q = question; setQuestion(null); void saveQuestion(q, true); }} />
            ) : null}
          </>
        ) : undefined}>
        {question ? (
          <>
            <Field value={question.text} onChangeText={(text) => setQuestion({ ...question, text })} placeholder={t('checks.questionPlaceholder')} multiline
              help={t('checks.questionFieldHelp')} />
            <ChipRow>
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

      <Sheet visible={helping} title={t('checks.addHelp')} sub={name} onClose={() => setHelping(false)}
        footer={<PrimaryBtn label={t('common.done')} help={t('checks.helpsDoneHelp')} onPress={() => setHelping(false)} />}>
        <SectionLabel label={t('checks.notes')} />
        <Group>
          {ownNotes.map((m) => {
            const on = linked.has(`material:${m.materialId}`);
            return <Row key={m.materialId} icon="note" label={m.title} sub={referenceKindName(m.kind)} role="checkbox" checked={on} right={tick(on)} help={linkedHelp(on)} onPress={() => void setHelp({ materialId: m.materialId }, !on)} />;
          })}
          {library.filter((x) => x.kind === 'note' || x.kind === 'other').map(({ it }) => {
            const on = linked.has(`item:${it.itemId}`);
            return <Row key={it.itemId} icon="note" label={it.name} sub={it.description || undefined} role="checkbox" checked={on} right={tick(on)} help={linkedHelp(on)} onPress={() => void setHelp({ itemId: it.itemId }, !on)} />;
          })}
          {mayWrite ? <Row icon="plus" label={t('checks.writeNote')} help={t('checks.writeNoteHelp')} onPress={() => { setHelping(false); setWriting({ title: '', text: '' }); }} last /> : null}
        </Group>
        {library.some((x) => x.kind === 'guide' || x.kind === 'source') ? (
          <>
            <SectionLabel label={t('checks.guidesAndBibles')} />
            <Group>
              {library.filter((x) => x.kind === 'guide' || x.kind === 'source').map(({ it, kind }, j, a) => {
                const on = linked.has(`item:${it.itemId}`);
                return <Row key={it.itemId} icon={kind === 'source' ? 'book' : 'sparkle'} label={it.name} role="checkbox" checked={on} right={tick(on)} last={j === a.length - 1} help={linkedHelp(on)}
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

