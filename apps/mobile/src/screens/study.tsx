// Study guides (ng-langquest-ux src/screens/study.tsx): the Study guide
// (`study_guide`) and a Study step (`study_step`). Requirements STUDY-1..7,
// ADR-018 (guides are reference material with steps; FIA is the first) and
// ADR-019 (the material keeps its own format; the passage is one tap away).
// A guide walks the team through a passage before anyone drafts. Each step
// is one document with its own audio, shown the way the material is
// written, broken into sections anyone who adds to passages can note
// (STUDY-7). Finishing a step is the drafting team's (Translate), recorded
// with who and when, and undoable (STUDY-4). The study is advice: nothing
// waits on it (STUDY-6).
import { commands, keyTermsFor, type EventSpec } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Ctx } from '../ctx';
import { TITLES } from '../flow';
import { indexesFor } from '../indexes';
import {
  Badge, EmptyState, GhostBtn, Group, Header, Ico, PrimaryBtn, ProgressBar, Row, Screen, SectionLabel, Segments, SmallBtn, txt
} from '../kit';
import { AudioClip } from '../audioClip';
import { plural, usePassage, when, type PassageView } from '../passageView';
import { noteExpected } from '../report';
import { readingsFor } from '../scripture';
import { contractsFor } from '../screenContracts';
import { type StudyGuide as Guide, type StudyResource } from '../study/guides';
import { glossaryEntryOf, useStudyGuide } from '../study/libraryGuides';
import { studyProgress, type StudyProgress, type StudyStepStatus } from '../study/progress';
import { useStudyFileUri } from '../study/media';
import { clock, inlineParts, isQuestion, secondsOf, sectionLabel, studySections, type StudySection } from '../study/text';
import {
  AudioBar, ContributeSheet, GlossarySheet, MediaSheet, PassageReader, resourceIcon, saveNote, SectionBody, StepMark, stepLine, StudyNote,
  styles as su, useStudyAudio, ViewSwitch
} from '../study/ui';
import { C, radius, space, TINT } from '../theme';

/** A step's state in a word or two, beside its title; the full line is read to screen readers. */
function stepBadge(st: StudyStepStatus, isNext: boolean): string | undefined {
  if (st.done) return 'Done';
  if (st.notes.length) return plural(st.notes.length, 'note');
  return isNext ? 'Next' : undefined;
}

/** The passage, its guide and the team's progress, derived from the record. */
function useStudy(ctx: Ctx): { v: PassageView; guide: Guide; sp: StudyProgress } | { v: PassageView | null; guide: null; sp: null } {
  const v = usePassage(ctx);
  const state = ctx.project.state;
  const guide = useStudyGuide(ctx, v?.unitId, v?.laneId);
  const sp = useMemo(() => (state && v && guide ? studyProgress(state, v.p, guide) : null), [state, v?.p, guide]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v || !guide || !sp) return { v, guide: null, sp: null };
  return { v, guide, sp };
}

function Missing(props: { ctx: Ctx; title: string; v: PassageView | null }) {
  return (
    <Screen header={<Header title={props.title} onBack={props.ctx.back}
      {...(props.v ? { crumbs: [{ label: props.v.title, onPress: () => props.ctx.go('passage_record', { unitId: props.v!.unitId, laneId: props.v!.laneId }) }] } : {})} />}>
      <EmptyState icon="sparkle" title={props.v ? "There's no study guide for this passage." : 'This passage is not in the project.'}
        {...(props.v ? { sub: 'Study guides come with the reference material your organization uses. FIA covers more passages as its material grows.' } : {})} />
    </Screen>
  );
}

/** The passage view mounts the first time it is opened and then stays, so its translation and place survive switching. */
function useOpened(now: boolean): boolean {
  const [opened, setOpened] = useState(now);
  if (now && !opened) setOpened(true);
  return opened || now;
}

function peopleLine(ctx: Ctx, people: string[]): string {
  const names = people.map((p) => ctx.name(p));
  if (names.length === 0) return 'Nobody has started yet';
  if (names.length <= 2) return `By ${names.join(' and ')}`;
  return `By ${names.slice(0, 2).join(', ')} and ${plural(names.length - 2, 'other')}`;
}

// ---- Study guide: the steps and how far the team has got (STUDY-2) ---------------------

export function StudyGuide(ctx: Ctx) {
  const { v, guide, sp } = useStudy(ctx);
  const [view, setView] = useState<'steps' | 'passage'>('steps');
  const opened = useOpened(view === 'passage');
  const readings = useMemo(() => (ctx.project.state && v ? readingsFor(ctx.project.state, v.unitId) : []), [ctx.project.state, v?.unitId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v || !guide || !sp) return <Missing ctx={ctx} title={TITLES.study_guide} v={v} />;

  const canStudy = ctx.session.can('translate');
  const canContribute = canStudy || ctx.session.can('review') || ctx.session.can('fill_reference');
  const phases = [...new Set(guide.steps.map((s) => s.phase ?? ''))];
  const allDone = !sp.next;
  const recorded = v.p.versions.length > 0;
  const openStep = (stepId: string) => ctx.go('study_step', { unitId: v.unitId, laneId: v.laneId, stepId });
  const footer = view === 'steps' && canStudy && (sp.next || !recorded) ? (
    sp.next ? (
      <PrimaryBtn label={`${sp.doneCount || sp.next.notes.length ? 'Continue' : 'Start'}: ${sp.next.step.title}`} onPress={() => openStep(sp.next!.step.id)} />
    ) : (
      <PrimaryBtn label="Record the first draft" icon="mic" onPress={() => ctx.go('workspace', { unitId: v.unitId, laneId: v.laneId })} />
    )
  ) : undefined;

  return (
    <Screen fixed footer={footer}
      header={<Header title={`${guide.pattern} study`} sub={v.lane} onBack={ctx.back}
        crumbs={[{ label: v.title, onPress: () => ctx.go('passage_record', { unitId: v.unitId, laneId: v.laneId }) }]} />}>
      <ViewSwitch views={[{ id: 'steps', label: `${guide.pattern} steps`, icon: 'sparkle' }, { id: 'passage', label: 'Passage', icon: 'book' }]}
        active={view} onChange={setView} />
      {opened ? (
        <View style={[s.pane, view !== 'passage' && s.hidden]}>
          <PassageReader ctx={ctx} v={v} readings={readings} canContribute={canContribute} hidden={view !== 'passage'} />
        </View>
      ) : null}
      <ScrollView style={[s.pane, view !== 'steps' && s.hidden]} contentContainerStyle={su.body}>
        <View style={s.summary}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Badge label={guide.pattern} tone="brand" />
            <Text style={[txt.xsStrong, { flex: 1 }]} numberOfLines={1}>{guide.source}</Text>
          </View>
          <Text style={txt.sm}>{guide.about}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {allDone ? <Ico name="check" size={16} color={TINT.greenText} /> : null}
              <Text style={[txt.sm, { fontWeight: '700', color: allDone ? TINT.greenText : C.dark }]}>
                {allDone ? 'Every step done' : `${sp.doneCount} of ${sp.steps.length} steps done`}
              </Text>
            </View>
            <Text style={txt.xs}>{plural(sp.noteCount, 'note')}</Text>
          </View>
          <ProgressBar value={Math.round((sp.doneCount / Math.max(1, sp.steps.length)) * 100)} color={allDone ? C.green : C.primary} />
          <Text style={txt.xs}>{peopleLine(ctx, sp.people)}</Text>
        </View>

        {phases.map((phase) => (
          <View key={phase} style={{ gap: space.sm }}>
            {phase ? <SectionLabel label={phase} /> : null}
            <Group>
              {sp.steps.filter((st) => (st.step.phase ?? '') === phase).map((st, i, list) => {
                const isNext = canStudy && sp.next?.step.id === st.step.id;
                const badge = stepBadge(st, isNext);
                return (
                  <Row key={st.step.id} leading={<StepMark status={st} size={36} />} label={st.step.title} sub={st.step.purpose}
                    {...(badge ? { badge, badgeTone: st.done ? 'green' as const : isNext ? 'brand' as const : 'default' as const } : {})} last={i === list.length - 1} onPress={() => openStep(st.step.id)}
                    accessibilityLabel={`${st.step.title}. ${isNext && !st.notes.length ? 'Next' : stepLine(ctx, st)}. ${st.step.purpose}`} />
                );
              })}
            </Group>
          </View>
        ))}
        <Text style={[txt.xs, { paddingHorizontal: space.xs }]}>
          What you add while studying stays with this passage. Reviewers see it next to the draft, so they know the study was done.
        </Text>
      </ScrollView>
    </Screen>
  );
}

// ---- Study step: the step's text and audio, and the passage beside it (STUDY-3, STUDY-4) ----

export function StudyStep(ctx: Ctx) {
  const { v, guide, sp } = useStudy(ctx);
  // Moving on changes the step, not the screen (STUDY-4).
  const [stepId, setStepId] = useState(ctx.params['stepId'] ?? '');
  const [view, setView] = useState<'step' | 'passage'>('step');
  const opened = useOpened(view === 'passage');
  const readings = useMemo(() => (ctx.project.state && v ? readingsFor(ctx.project.state, v.unitId) : []), [ctx.project.state, v?.unitId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v || !guide || !sp) return <Missing ctx={ctx} title={TITLES.study_step} v={v} />;

  const status = sp.steps.find((st) => st.step.id === stepId) ?? sp.steps[0]!;
  const canStudy = ctx.session.can('translate');
  const canContribute = canStudy || ctx.session.can('review') || ctx.session.can('fill_reference');
  const nextStep = sp.steps[status.index + 1];
  const toGuide = () => ctx.go('study_guide', { unitId: v.unitId, laneId: v.laneId });

  async function done() {
    const state = ctx.project.state;
    if (!state || !guide || !sp || status.done) return;
    const mark = (isDone: boolean): EventSpec[] => {
      const now = ctx.project.state ?? state;
      return commands(now, indexesFor(now)).markStudyStep({
        commandId: Crypto.randomUUID(), unitId: v!.unitId, laneId: v!.laneId, guideId: guide.id, stepId: status.step.id, done: isDone
      });
    };
    const left = sp.steps.filter((st) => !st.done && st.step.id !== status.step.id);
    const next = left.find((st) => st.index > status.index) ?? left[0];
    try {
      await ctx.act(mark(true),
        next ? `${status.step.title} done · ${sp.doneCount + 1} of ${sp.steps.length}` : `Every ${guide.pattern} step is done`,
        () => mark(false));
    } catch (e) {
      // ctx.act already said "Not saved"; stay on this step.
      noteExpected('study: mark step', e);
      return;
    }
    if (next) setStepId(next.step.id);
    else toGuide();
  }

  const footer = (
    <>
      {status.done ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Ico name="check" size={16} color={TINT.greenText} />
          <Text style={[txt.xsStrong, { color: TINT.greenText }]}>{stepLine(ctx, status)}</Text>
        </View>
      ) : null}
      {canStudy && !status.done ? (
        <PrimaryBtn label="Done with this step" icon="check" onPress={() => void done()} />
      ) : nextStep ? (
        <GhostBtn label={`Next: ${nextStep.step.title}`} onPress={() => setStepId(nextStep.step.id)} />
      ) : (
        <GhostBtn label="All steps" onPress={toGuide} />
      )}
    </>
  );

  return (
    <Screen fixed footer={footer}
      header={<Header title={status.step.title} onBack={ctx.back}
        crumbs={[
          { label: v.title, onPress: () => ctx.go('passage_record', { unitId: v.unitId, laneId: v.laneId }) },
          { label: `${guide.pattern} study`, onPress: toGuide }
        ]} />}>
      {/* Where this step sits in the study, in both views. */}
      <View style={s.strip}>
        <Text style={[txt.xsStrong, { color: C.dark }]}>
          Step {status.index + 1} of {sp.steps.length}<Text style={{ color: C.muted, fontWeight: '500' }}> · {sp.doneCount} done</Text>
        </Text>
        <View style={{ flex: 1 }}>
          <Segments total={sp.steps.length} done={(i) => !!sp.steps[i]?.done} current={status.index} />
        </View>
      </View>
      <ViewSwitch views={[{ id: 'step', label: `${guide.pattern} step`, icon: 'sparkle' }, { id: 'passage', label: 'Passage', icon: 'book' }]}
        active={view} onChange={setView} />
      {opened ? (
        <View style={[s.pane, view !== 'passage' && s.hidden]}>
          <PassageReader ctx={ctx} v={v} readings={readings} canContribute={canContribute} hidden={view !== 'passage'} />
        </View>
      ) : null}
      <View style={[s.pane, view !== 'step' && s.hidden]}>
        <StepBody key={status.step.id} ctx={ctx} v={v} guide={guide} status={status} canStudy={canStudy} canContribute={canContribute}
          isLast={status.index === sp.steps.length - 1} hidden={view !== 'step'} />
      </View>
    </Screen>
  );
}

/** One step's audio, timed notes and text. Keyed by step, so moving on starts the next step's audio fresh. */
function StepBody(props: { ctx: Ctx; v: PassageView; guide: Guide; status: StudyStepStatus; canStudy: boolean; canContribute: boolean; isLast: boolean; hidden: boolean }) {
  const { ctx, v, guide, status } = props;
  const step = status.step;
  const sections = useMemo(() => studySections(step.text), [step.text]);
  const { uri: audioUri } = useStudyFileUri(ctx.project.orgId, step.audio.file, step.audio.url);
  const audio = useStudyAudio(audioUri, step.audio.seconds);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ sectionId?: string; at?: string; quote: string; answer: boolean } | null>(null);
  const [resource, setResource] = useState<StudyResource | null>(null);
  useEffect(() => () => audio.pause(), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (props.hidden) audio.pause(); }, [props.hidden]); // eslint-disable-line react-hooks/exhaustive-deps

  const momentOf = (n: StudyStepStatus['notes'][number]) => (n.anchor.kind === 'study' && n.anchor.at ? secondsOf(n.anchor.at) : -1);
  const atMoment = status.notes.filter((n) => momentOf(n) >= 0).sort((a, b) => momentOf(a) - momentOf(b));
  const onSection = (id: string) => status.notes.filter((n) => n.anchor.kind === 'study' && n.anchor.sectionId === id);
  const onStep = status.notes.filter((n) => n.anchor.kind === 'study' && !n.anchor.sectionId && momentOf(n) < 0);

  const openRef = (ref: string) => {
    const r = guide.resources.find((x) => x.ref === ref);
    if (r) { audio.pause(); setResource(r); }
  };
  const keyTerm = (r: StudyResource | null) => {
    const state = ctx.project.state;
    if (!state || r?.kind !== 'term') return null;
    const t = r.title.trim().toLowerCase();
    return keyTermsFor(state, v.laneId).find((k) => k.term.trim().toLowerCase() === t) ?? null;
  };
  const term = keyTerm(resource);
  const entry = resource?.kind === 'term' ? glossaryEntryOf(guide, resource.ref) : null;
  const audioSub = audio.failed ? "Couldn't load the audio — playing a stand-in"
    : !audioUri ? (step.audio.file ? 'Getting the recording of this step…' : 'No recording of this step yet · the clock follows reading pace') : undefined;

  return (
    <ScrollView stickyHeaderIndices={[0]} contentContainerStyle={su.body} keyboardShouldPersistTaps="handled">
      <View style={su.sticky}>
        <AudioBar audio={audio} label={audio.playing ? 'Playing this step' : audio.time > 0 ? 'Paused' : 'Listen to this step'} {...(audioSub ? { sub: audioSub } : {})} />
        {props.canContribute && !audio.playing && audio.time > 0 ? (
          <Pressable onPress={() => setAdding({ at: clock(audio.time), quote: `Audio at ${clock(audio.time)}`, answer: false })} accessibilityRole="button"
            style={({ pressed }) => [su.momentBtn, pressed && su.pressed]}>
            <Ico name="note" size={16} color={TINT.amberText} />
            <Text style={[txt.sm, { fontWeight: '700', color: TINT.amberText }]}>Add a note at {clock(audio.time)}</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={[txt.sm, { color: C.muted, paddingHorizontal: space.xs }]}>
        {step.phase ? <Text style={{ fontWeight: '700', color: C.dark }}>{step.phase}. </Text> : null}
        {step.purpose}{props.canContribute ? ' Tap any part to add a note.' : ''}
      </Text>

      {atMoment.length > 0 ? (
        <Group>
          <Text style={[txt.label, { paddingHorizontal: space.lg, paddingTop: space.md }]}>Notes on the audio</Text>
          {atMoment.map((n) => (
            <View key={n.id}>
              <Pressable onPress={() => audio.seek(momentOf(n))} accessibilityRole="button" accessibilityLabel={`Go to ${clock(momentOf(n))}`}
                style={({ pressed }) => [s.momentRow, pressed && su.pressed]}>
                <View style={s.timeTag}><Text style={[txt.xsStrong, { color: C.white }]}>{clock(momentOf(n))}</Text></View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  {n.text ? <Text style={txt.sm}>{n.text}</Text> : null}
                  <Text style={txt.xs}>{ctx.name(n.by)} · {when(n.hlc)}{n.blobHash ? ' · voice note' : ''}</Text>
                </View>
              </Pressable>
              {n.blobHash ? (
                <View style={{ paddingLeft: 72, paddingRight: space.lg, paddingBottom: space.sm }}>
                  <AudioClip project={ctx.project} hashes={[n.blobHash]} label="Play voice note" />
                </View>
              ) : null}
            </View>
          ))}
        </Group>
      ) : null}

      <View style={su.textCard}>
        {sections.map((sec) => (
          <SectionView key={sec.id} ctx={ctx} section={sec} resources={guide.resources} notes={onSection(sec.id)}
            selected={selected === sec.id} canContribute={props.canContribute}
            onSelect={() => setSelected((cur) => (cur === sec.id ? null : sec.id))}
            onAdd={() => setAdding({ sectionId: sec.id, quote: sectionLabel(sec, 120), answer: isQuestion(sec) })}
            onOpenRef={openRef} />
        ))}
      </View>

      {onStep.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <SectionLabel label="Notes on this step" />
          {onStep.map((n) => <StudyNote key={n.id} ctx={ctx} note={n} />)}
        </View>
      ) : null}

      {props.isLast && props.canStudy ? (
        <View style={s.handoff}>
          <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
            <Ico name="mic" size={20} color={C.primary} />
            <Text style={[txt.sm, { flex: 1 }]}>When the group agrees on its version, record it as the first draft.</Text>
          </View>
          <GhostBtn label={v.p.versions.length ? 'Open the recording workspace' : 'Record the first draft'} icon="mic"
            onPress={() => ctx.go('workspace', { unitId: v.unitId, laneId: v.laneId })} />
        </View>
      ) : null}

      {adding ? (
        <ContributeSheet ctx={ctx} unitId={v.unitId} laneId={v.laneId} title={adding.answer ? 'Your answer' : 'Add a note'}
          where={`${step.title} · ${adding.quote}`}
          onClose={() => { setAdding(null); setSelected(null); }}
          onSave={(c) => saveNote(ctx, v, {
            kind: 'study', guideId: guide.id, stepId: step.id,
            ...(adding.sectionId ? { sectionId: adding.sectionId } : {}), ...(adding.at ? { at: adding.at } : {})
          }, c, adding.at ? `Note added at ${adding.at} — it stays with the study` : 'Added to the study — reviewers will see it with the passage')} />
      ) : null}
      {resource && resource.kind !== 'term' ? (
        <MediaSheet resource={resource} source={`${guide.pattern} media`} orgId={ctx.project.orgId} onClose={() => setResource(null)} />
      ) : null}
      {resource && entry ? (
        <GlossarySheet entry={entry} source={guide.source} orgId={ctx.project.orgId} hasKeyTerm={!!term} onClose={() => setResource(null)}
          onOpenTerm={() => {
            if (!term) return;
            setResource(null);
            ctx.go('key_term_detail', { termId: term.termId, unitId: v.unitId, laneId: v.laneId });
          }} />
      ) : null}
    </ScrollView>
  );
}

/** One section of the step's text: tap it to select, then note it. Its notes stay underneath. */
function SectionView(props: {
  ctx: Ctx;
  section: StudySection;
  resources: StudyResource[];
  notes: StudyStepStatus['notes'];
  selected: boolean;
  canContribute: boolean;
  onSelect: () => void;
  onAdd: () => void;
  onOpenRef: (ref: string) => void;
}) {
  const sec = props.section;
  const question = isQuestion(sec);
  const links = inlineParts(sec.text).flatMap((p) => (p.type === 'link' ? [p] : []));
  // Anyone can select a section to reach its pictures, maps and glossary terms; only contributors can note it.
  const selectable = props.canContribute || links.length > 0;
  const body = <SectionBody section={sec} onOpenRef={props.onOpenRef} />;
  return (
    <View style={{ paddingHorizontal: space.sm }}>
      <Pressable disabled={!selectable} onPress={props.onSelect} accessibilityRole={selectable ? 'button' : undefined}
        accessibilityState={{ selected: props.selected }} style={[s.section, props.selected && su.selected]}>
        {body}
        {props.notes.length > 0 && !props.selected ? (
          <View style={[su.count, s.sectionCount]} accessibilityLabel={plural(props.notes.length, 'note')}>
            <Text style={su.countText}>{props.notes.length}</Text>
          </View>
        ) : null}
      </Pressable>
      {props.selected ? (
        <View style={s.sectionActions}>
          {props.canContribute ? (
            <Pressable onPress={props.onAdd} accessibilityRole="button"
              style={({ pressed }) => [su.addBtn, { marginTop: 0, marginBottom: 0 }, question && { backgroundColor: C.primary }, pressed && su.pressed]}>
              <Ico name={question ? 'mic' : 'note'} size={16} color={C.white} />
              <Text style={[txt.sm, { fontWeight: '700', color: C.white }]}>{question ? 'Answer' : 'Add a note'}</Text>
            </Pressable>
          ) : null}
          {links.map((l, i) => (
            <SmallBtn key={`${l.ref}-${i}`} label={l.text} icon={resourceIcon(props.resources.find((r) => r.ref === l.ref))} onPress={() => props.onOpenRef(l.ref)} />
          ))}
        </View>
      ) : null}
      {props.notes.length > 0 ? (
        <View style={{ paddingHorizontal: space.sm, paddingBottom: space.sm, paddingTop: space.xs, gap: space.sm }}>
          {props.notes.map((n) => <StudyNote key={n.id} ctx={props.ctx} note={n} label={isQuestion(sec) ? 'Answer' : undefined} />)}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  summary: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, padding: space.lg, gap: space.md },
  strip: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm, backgroundColor: C.card,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  momentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, minHeight: 48, paddingHorizontal: space.lg, paddingVertical: space.sm },
  timeTag: { backgroundColor: C.dark, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2, marginTop: 2 },
  section: { borderRadius: radius.md, paddingHorizontal: space.sm, paddingVertical: 6, minHeight: 48, justifyContent: 'center' },
  sectionCount: { position: 'absolute', right: -2, top: -2, marginTop: 0 },
  sectionActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.xs },
  pane: { flex: 1 },
  hidden: { display: 'none' },
  handoff: { backgroundColor: C.light, borderRadius: radius.xl, padding: space.lg, gap: space.md }
});

export const contracts = contractsFor('study_guide', 'study_step');
