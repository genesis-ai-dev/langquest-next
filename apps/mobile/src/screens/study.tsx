// Study (ng-langquest-ux src/screens/study.tsx; the simple redesign's
// reader, decision 71, demo ADR-035, simple/translator.tsx Study,
// StudySteps, StudyDoc, StudyLesson): one reader for whatever reference
// material is attached to the passage, for both flow nodes (`study_guide`
// opens at the next step, `study_step` at the one named). Requirements
// STUDY-1..7; ADR-018 (guides are reference material with steps) and
// ADR-019 (the material keeps its own format; the passage is one tap away).
//
// Chips switch between what is attached, in the recording workspace's
// order (Guide, Bible, Key words, Notes). A guide with steps has the step
// bar (‹ 2/6 Setting the stage ▾ ›; ▾ lists every step, grouped, with done
// marks); a step with audio has its player (Back 10 s, Note at a moment);
// its text shows glossary words to tap, pictures as cards and its callouts.
// The passage is docked at the bottom when it has source audio; a guide on
// an outline item (no verses) has no Bible chip and no dock. Nothing here
// names the method a guide follows. Finishing a step is the drafting
// team's (Translate), recorded with who and when, and undoable (STUDY-4);
// the study is advice: nothing waits on it (STUDY-6). App only: Write a
// guide (`guide_editor`), from the steps sheet, for whoever manages
// reference material; the editor itself is in src/guides/.
import { commands, isLicense, keyTermsForUnit, type EventSpec, type PassageNote } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../text';
import { licenseText } from '../coreText';
import type { Ctx } from '../ctx';
import { screenTitle } from '../flow';
import { t } from '../i18n';
import { indexesFor } from '../indexes';
import { EmptyState, GhostBtn, Header, Ico, PrimaryBtn, Screen, SmallBtn, txt } from '../kit';
import { usePassage, type PassageView } from '../passageView';
import { termsInText } from '../recording/workspaceModel';
import { noteExpected } from '../report';
import { contractsFor } from '../screenContracts';
import { GuideNav, GuideStep } from '../simple/guide';
import { refChips, stepAfterDone, type RefChip } from '../simple/model';
import { Dock, RefChips, type ChipItem } from '../simple/parts';
import { BiblePane, KeyWordsPane, NotesPane, useBible } from '../simple/reference';
import { type StudyGuide as Guide } from '../study/guides';
import { useStudyGuide } from '../study/libraryGuides';
import { studyProgress, type StudyProgress } from '../study/progress';
import { stepLine } from '../study/ui';
import { GuideEditorScreen } from '../guides/GuideEditor';
import { space, TINT } from '../theme';

/** The passage, its guide and the team's progress, derived from the record. */
function useStudy(ctx: Ctx): { v: PassageView; guide: Guide; sp: StudyProgress } | { v: PassageView | null; guide: null; sp: null } {
  const v = usePassage(ctx);
  const state = ctx.language.state;
  const guide = useStudyGuide(ctx, v?.unitId);
  const sp = useMemo(() => (state && v && guide ? studyProgress(state, v.p, guide) : null), [state, v?.p, guide]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v || !guide || !sp) return { v, guide: null, sp: null };
  return { v, guide, sp };
}

function Missing(props: { ctx: Ctx; title: string; v: PassageView | null }) {
  return (
    <Screen header={<Header title={props.v?.title ?? props.title} sub={t('study.screen.study')} onBack={props.ctx.back} close />}>
      <EmptyState icon="star" title={props.v ? t('study.screen.noGuide') : t('study.screen.notInLanguage')}
        {...(props.v ? { sub: t('study.screen.noGuideSub') } : {})} />
    </Screen>
  );
}

// ---- the reader (STUDY-2..5, STUDY-7) ------------------------------------------------------

export function StudyGuide(ctx: Ctx) {
  return <StudyReader ctx={ctx} title={screenTitle('study_guide')} />;
}

export function StudyStep(ctx: Ctx) {
  return <StudyReader ctx={ctx} title={screenTitle('study_step')} stepId={ctx.params['stepId']} />;
}

function StudyReader(props: { ctx: Ctx; title: string; stepId?: string }) {
  const { ctx } = props;
  const { v, guide, sp } = useStudy(ctx);
  const bible = useBible(ctx, v?.unitId ?? null, v?.languageId ?? null, {});
  const [chipState, setChip] = useState<RefChip>('guide');
  // Moving on changes the step, not the screen (STUDY-4).
  const [indexState, setIndex] = useState<number | null>(null);
  const [verse, setVerse] = useState<string | null>(null);
  const state = ctx.language.state;
  const sourceWords = useMemo(() => (bible.rows ? bible.rows.map((r) => r.text).join(' ') : null), [bible.rows]);
  const terms = useMemo(() => {
    if (!state || !v) return [];
    const all = keyTermsForUnit(state, v.unitId);
    return sourceWords ? termsInText(sourceWords, all) : all;
  }, [state, v?.unitId, sourceWords]); // eslint-disable-line react-hooks/exhaustive-deps
  const notes = useMemo<PassageNote[]>(() => (v ? v.p.notes.filter((n) => n.anchor.kind !== 'study') : []), [v?.p.notes]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v || !guide || !sp) return <Missing ctx={ctx} title={props.title} v={v} />;

  const scope = { unitId: v.unitId, languageId: v.languageId };
  const canStudy = ctx.session.can('translate');
  const canContribute = canStudy || ctx.session.can('review') || ctx.session.can('fill_reference');
  const named = props.stepId ? sp.steps.findIndex((st) => st.step.id === props.stepId) : -1;
  const index = Math.min(sp.steps.length - 1, Math.max(0, indexState ?? (named >= 0 ? named : sp.next?.index ?? 0)));
  const status = sp.steps[index]!;
  const chipIds = refChips('study', { guide: true, bible: bible.hasVerses, terms: terms.length > 0, notes: notes.length > 0, earlier: false });
  const chip = chipIds.includes(chipState) ? chipState : 'guide';
  const chips: ChipItem<RefChip>[] = chipIds.map((c) => ({
    guide: { id: 'guide' as const, label: t('study.screen.chips.guide'), icon: 'star' as const, hint: t('study.screen.chips.guideHint') },
    bible: { id: 'bible' as const, label: t('study.screen.chips.bible'), icon: 'listen' as const, hint: t('study.screen.chips.bibleHint') },
    terms: { id: 'terms' as const, label: t('study.screen.chips.terms'), icon: 'key' as const, hint: t('study.screen.chips.termsHint') },
    notes: { id: 'notes' as const, label: t('study.screen.chips.notes'), icon: 'chat' as const, count: notes.length, hint: t('study.screen.chips.notesHint') },
    earlier: { id: 'earlier' as const, label: t('study.screen.chips.earlier'), icon: 'clock' as const }
  })[c]);
  const openTerm = (termId: string) => ctx.go('key_term_detail', { ...scope, termId });

  async function done() {
    if (!state || !guide || !sp || status.done) return;
    const mark = (isDone: boolean): EventSpec[] => {
      const now = ctx.language.state ?? state;
      return commands(now, indexesFor(now)).markStudyStep({
        commandId: Crypto.randomUUID(), unitId: v!.unitId, guideId: guide.id, stepId: status.step.id, done: isDone
      });
    };
    const next = stepAfterDone(sp.steps.map((st) => ({ done: !!st.done })), index);
    try {
      const said = next !== null ? t('study.screen.stepDone', { step: status.step.title, done: sp.doneCount + 1, total: sp.steps.length }) : t('study.screen.allDone');
      await ctx.act(mark(true), said, () => mark(false));
    } catch (e) {
      // ctx.act already said "Not saved"; stay on this step.
      noteExpected('study: mark step', e);
      return;
    }
    if (next !== null) setIndex(next);
  }

  const allDone = !sp.next;
  const recorded = v.p.versions.length > 0;
  const footer = chip !== 'guide' ? (
    <PrimaryBtn label={t('study.screen.backToGuide')} icon="arrowL" onPress={() => setChip('guide')} />
  ) : canStudy && !status.done ? (
    <PrimaryBtn label={t('study.screen.doneWithStep')} icon="check" onPress={() => void done()} />
  ) : (
    <>
      {status.done ? (
        <View style={s.doneLine}>
          <Ico name="check" size={16} color={TINT.greenText} />
          <Text style={[txt.xsStrong, { color: TINT.greenText }]}>{stepLine(ctx, status)}</Text>
        </View>
      ) : null}
      {allDone && canStudy ? (
        <PrimaryBtn label={recorded ? t('study.screen.openWorkspace') : t('study.screen.recordFirstDraft')} icon="mic" onPress={() => ctx.go('workspace', scope)} />
      ) : sp.steps[index + 1] ? (
        <GhostBtn label={t('study.screen.nextStep', { step: sp.steps[index + 1]!.step.title })} onPress={() => setIndex(index + 1)} />
      ) : null}
    </>
  );

  // Whoever manages reference material edits the organization's own guide, or adapts anyone else's (guides/GuideEditor.tsx).
  const origin = guide.origin;
  // Who made the material and its license, as its license asks (a study@1 guide carries both in its source line).
  const credit = [guide.credit, guide.license && isLicense(guide.license) ? licenseText(guide.license).name : guide.license].filter(Boolean).join(' · ')
    || (guide.source ? t('study.screen.source', { source: guide.source }) : '');
  const sheetFooter = (
    <View style={{ gap: space.sm, paddingTop: space.sm }}>
      {credit ? <Text style={txt.xs}>{credit}</Text> : null}
      {ctx.session.can('manage_reference') && origin ? (
        origin.itemId
          ? <SmallBtn label={t('study.screen.editGuide')} icon="edit" onPress={() => ctx.go('guide_editor', { itemId: origin.itemId!, languageId: v.languageId })} />
          : <SmallBtn label={t('study.screen.adaptGuide')} icon="edit" onPress={() => ctx.go('guide_editor', { from: origin.docHash, languageId: v.languageId })} />
      ) : null}
      <Text style={txt.xs}>{sp.noteCount ? t('study.screen.addedStaysNotes', { count: sp.noteCount }) : t('study.screen.addedStays')}</Text>
    </View>
  );

  const dock = bible.hasAudio && chip !== 'bible';
  return (
    <Screen fixed footer={footer}
      header={<Header title={v.title} sub={t('study.screen.study')} onBack={ctx.back} close />}>
      <RefChips items={chips} value={chip} onChange={setChip} />
      {chip === 'guide' ? <GuideNav ctx={ctx} sp={sp} index={index} onIndex={setIndex} sheetFooter={sheetFooter} /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        {chip === 'guide' ? (
          <GuideStep key={status.step.id} ctx={ctx} v={v} guide={guide} status={status} spoken canContribute={canContribute} onTerm={openTerm} />
        ) : chip === 'bible' ? (
          <BiblePane ctx={ctx} v={v} bible={bible} terms={terms} canNote={canContribute} selected={verse} onSelect={setVerse}
            onTerm={openTerm} onMoreBibles={() => ctx.go('bible_explore', scope)} />
        ) : chip === 'terms' ? (
          <KeyWordsPane ctx={ctx} v={v} terms={terms} rows={bible.rows} draftTakeId={v.p.draftTakeId} canTie={false}
            onHear={(key) => { setChip('bible'); if (key) { setVerse(key); bible.playVerse(key); } }} />
        ) : (
          <NotesPane ctx={ctx} v={v} notes={notes} />
        )}
      </ScrollView>
      {dock ? (
        <Dock title={t('study.screen.passageDock', { title: v.title })} sub={bible.line()} playing={bible.player.playing} available={!bible.player.loading}
          onToggle={bible.player.toggle} onBack10={() => bible.player.skip(-10)} backDisabled={!bible.player.started} />
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  body: { paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.xl, gap: space.md },
  doneLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }
});

// ---- Write a guide (app only): the guide editor, guides/GuideEditor.tsx -------------------

export function GuideEditor(ctx: Ctx) {
  return <GuideEditorScreen ctx={ctx} />;
}

export const contracts = contractsFor('study_guide', 'study_step', 'guide_editor');
