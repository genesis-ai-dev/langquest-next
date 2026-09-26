import { StyleSheet } from '../theme';
// Avatar U. Study guide (FIA) and one study step, before drafting
// (do-work J-STUDY-1/3/5/6). Content comes from the FIA study materials a
// manager filled (fiaStudiesFor / fiaStageContent); progress is the existing
// per-person "fia-progress" register, read team-wide (fiaStudyStatus). The
// passage is one tap away on both screens (PassageReader: BSB text with real
// Hays timings). Step text and Bible text are reference material, so they
// show; everything else is an icon with its reference copy as a label.
// Anchored study notes and answers need a new fact (Phase 2) and are absent.
import {
  derivePassageRecord, FIA_STAGES, fiaProgressField, fiaStudyStatus, inlineParts, passageReading,
  SOURCE_BIBLES, sourceAudioUrl, sourceBibleEnabled, studySections, type FiaStage, type FiaStudyStatus,
  type StudySection
} from '@langquest-next/core';
import {
  ArrowRight, BookOpen, Check, CheckCircle2, Circle, Ear, HelpCircle, Layers, LayoutGrid, MapPin, Mic,
  Pause, Sparkles, Users
} from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Ctx } from '../ctx';
import { AudioClip } from '../audioClip';
import { indexesFor } from '../indexes';
import { PassageSourceAudio } from '../passageSourceAudio';
import { Header, Note, Screen } from '../pui';
import { colors, radius, space, tint } from '../theme';
import { ActionButton, Card, text } from '../ui';
import { Byline } from '../UserChip';
import { passageOf } from './translate';

const ICONS: Record<FiaStage, typeof Ear> = {
  hear: Ear, stage: MapPin, scenes: Layers, embody: Users, gaps: HelpCircle, speak: Mic
};

/** Study is team work: finishing steps and recording the draft belong to translators who can write progress. */
function canStudy(ctx: Ctx, status: FiaStudyStatus): boolean {
  const progress = ctx.project.state?.materials[status.progressMaterialId];
  return ctx.session.can('translate') && (ctx.session.can('manage_reference') ||
    (ctx.session.can('fill_reference') && !progress?.locked.value));
}

function useStudy(ctx: Ctx) {
  const { unitId, laneId } = passageOf(ctx);
  const state = ctx.project.state;
  const status = state && unitId && laneId ? fiaStudyStatus(state, laneId, unitId) : null;
  const recorded = !!state && !!unitId && !!laneId &&
    derivePassageRecord(state, unitId, laneId, ctx.session.actorId, indexesFor(state)).recorded;
  return { unitId, laneId, state, status, recorded, title: state?.units[unitId]?.label ?? unitId };
}

/** Steps or the passage: two views of one screen, so switching never loses your place. */
function ViewSwitch(props: { passage: boolean; onChange: (passage: boolean) => void }) {
  return <View style={styles.switch} accessibilityRole="tablist">
    {[{ passage: false, icon: Sparkles, label: 'FIA steps' }, { passage: true, icon: BookOpen, label: 'Passage' }].map((v) =>
      <Pressable key={v.label} accessibilityRole="tab" accessibilityLabel={v.label}
        accessibilityState={{ selected: props.passage === v.passage }} onPress={() => props.onChange(v.passage)}
        style={[styles.tab, props.passage === v.passage && styles.tabOn]}>
        <v.icon size={20} color={props.passage === v.passage ? colors.reference : colors.mutedForeground} />
      </Pressable>)}
  </View>;
}

function NoStudy(props: { ctx: Ctx; title: string }) {
  return <Screen><Header title={props.title} onBack={props.ctx.back} />
    <View accessible accessibilityLabel="This passage has no FIA study." style={styles.row}>
      <Sparkles size={28} color={colors.mutedForeground} /><HelpCircle size={20} color={colors.mutedForeground} />
    </View>
  </Screen>;
}

export function StudyGuide(ctx: Ctx) {
  const { unitId, laneId, status, recorded, title } = useStudy(ctx);
  const [passage, setPassage] = useState(false);
  if (!status) return <NoStudy ctx={ctx} title={title} />;
  const study = canStudy(ctx, status);
  const next = status.next;
  const phases = [...new Set(FIA_STAGES.map((s) => s.phase))];
  const footer = passage || !study ? undefined
    : next ? <ActionButton icon={ArrowRight} accessibilityLabel={`${status.doneCount ? 'Continue' : 'Start'}: ${next.stage.label}`}
        onPress={() => ctx.go('study_step', { unitId, laneId, stage: next.stage.id })} />
    : !recorded ? <ActionButton icon={Mic} accessibilityLabel="Record the first draft"
        onPress={() => ctx.go('workspace', { unitId, laneId })} />
    : undefined;
  return <Screen footer={footer}>
    <Header title={title} onBack={ctx.back} />
    <ViewSwitch passage={passage} onChange={setPassage} />
    {passage ? <PassageReader ctx={ctx} unitId={unitId} laneId={laneId} /> : <>
      <Card>
        <View accessible style={styles.row}
          accessibilityLabel={`FIA study. ${next ? `${status.doneCount} of ${status.steps.length} steps done` : 'Every step done'}. What you add while studying stays with this passage.`}>
          <Sparkles size={22} color={colors.reference} />
          <Text style={[text.small, { flex: 1 }]}>{status.studies[0]?.title}</Text>
        </View>
        <Beads steps={status.steps.map((s) => !!s.done)} />
        {status.people.length ? <View style={styles.people}>
          {status.people.map((p) => <Byline key={p} id={p} />)}
        </View> : <View accessible accessibilityLabel="Nobody has started yet" style={styles.row}>
          <Users size={16} color={colors.mutedForeground} /><Text style={text.small}>0</Text>
        </View>}
      </Card>
      {phases.map((phase) => <View key={phase} style={{ gap: space.xs }}>
        <Text style={styles.phase}>{phase.toUpperCase()}</Text>
        <Card style={{ padding: 0, gap: 0 }}>
          {status.steps.filter((s) => s.stage.phase === phase).map((s, i) => {
            const isNext = next?.stage.id === s.stage.id;
            const Icon = ICONS[s.stage.id];
            return <Pressable key={s.stage.id} accessibilityRole="button"
              accessibilityLabel={`${s.index + 1}. ${s.stage.label}. ${s.stage.prompt} ${s.done ? 'Done' : isNext ? 'Next' : 'Not started'}`}
              onPress={() => ctx.go('study_step', { unitId, laneId, stage: s.stage.id })}
              style={[styles.stepRow, i > 0 && styles.rowBorder, isNext && study && { backgroundColor: tint.reference }]}>
              <View style={[styles.mark, s.done && { backgroundColor: tint.done, borderColor: colors.done }]}>
                <Icon size={20} color={s.done ? colors.done : colors.reference} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={text.body}>{s.index + 1} · {s.stage.label}</Text>
                {s.done ? <Byline before="✓" id={s.done.by} /> : null}
              </View>
              {s.done ? <CheckCircle2 size={20} color={colors.done} /> : isNext ? <ArrowRight size={18} color={colors.reference} /> : <Circle size={18} color={colors.border} />}
            </Pressable>;
          })}
        </Card>
      </View>)}
    </>}
  </Screen>;
}

export function StudyStep(ctx: Ctx) {
  const { unitId, laneId, status, recorded, title } = useStudy(ctx);
  const first = FIA_STAGES.findIndex((s) => s.id === ctx.params['stage']);
  const [index, setIndex] = useState(first < 0 ? 0 : first);
  const [passage, setPassage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  if (!status) return <NoStudy ctx={ctx} title={title} />;
  const step = status.steps[index] ?? status.steps[0]!;
  const study = canStudy(ctx, status);
  const nextStep = status.steps[step.index + 1];
  const isLast = step.index === status.steps.length - 1;
  const Icon = ICONS[step.stage.id];

  async function setDone(stage: FiaStage, done: boolean) {
    await ctx.project.append('v1.MaterialFieldSet', {
      materialId: status!.progressMaterialId,
      fieldId: fiaProgressField(ctx.session.actorId, unitId, stage),
      text: done ? 'complete' : ''
    });
  }
  async function finish() {
    if (lock.current || !study) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const stage = step.stage;
      await setDone(stage.id, true);
      const doneCount = status!.doneCount + 1;
      ctx.toast(`${stage.label} done · ${doneCount} of ${status!.steps.length}`, () => { void setDone(stage.id, false); });
      const after = status!.steps.find((s) => !s.done && s.stage.id !== stage.id && s.index > step.index)
        ?? status!.steps.find((s) => !s.done && s.stage.id !== stage.id);
      if (after) setIndex(after.index);
      else ctx.go('study_guide', { unitId, laneId });
    } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }

  const footer = passage ? undefined : <View style={{ gap: space.sm }}>
    {step.done ? <View style={[styles.row, { justifyContent: 'center' }]}><Byline before="✓" id={step.done.by} /></View> : null}
    {study && !step.done
      ? <ActionButton icon={Check} accessibilityLabel="Done with this step" disabled={busy} onPress={() => void finish()} />
      : nextStep
        ? <ActionButton icon={ArrowRight} variant="outline" accessibilityLabel={`Next: ${nextStep.stage.label}`} onPress={() => setIndex(nextStep.index)} />
        : <ActionButton icon={LayoutGrid} variant="outline" accessibilityLabel="All steps" onPress={() => ctx.go('study_guide', { unitId, laneId })} />}
  </View>;

  return <Screen footer={footer}>
    <Header title={title} sub={`FIA · ${step.index + 1} / ${status.steps.length}`} onBack={ctx.back} />
    <ViewSwitch passage={passage} onChange={setPassage} />
    {passage ? <PassageReader ctx={ctx} unitId={unitId} laneId={laneId} /> : <>
      <Beads steps={status.steps.map((s) => !!s.done)} current={step.index} />
      <View accessible style={styles.row} accessibilityLabel={`${step.stage.label}. ${step.stage.phase}. ${step.stage.prompt}`}>
        <View style={styles.mark}><Icon size={24} color={colors.reference} /></View>
        <Text style={text.h4}>{step.stage.label}</Text>
      </View>
      {step.content.map((c) => <Card key={c.materialId}>
        {c.blobHash ? <AudioClip project={ctx.project} hashes={[c.blobHash]} label="Listen to this step" seekControls /> : null}
        {c.text ? studySections(c.text).map((s) => <SectionView key={s.id} section={s} />) : null}
      </Card>)}
      {!step.content.length ? <View accessible accessibilityLabel={`No ${step.stage.label} study guidance supplied yet`} style={styles.row}>
        <HelpCircle size={24} color={colors.mutedForeground} />
      </View> : null}
      {isLast && study ? <Card style={{ backgroundColor: tint.translate }}>
        <View accessible accessibilityLabel="When the group agrees on its version, record it as the first draft." style={styles.row}>
          <Users size={20} color={colors.translate} /><Mic size={20} color={colors.translate} />
        </View>
        <ActionButton icon={Mic} variant="outline"
          accessibilityLabel={recorded ? 'Open the recording workspace' : 'Record the first draft'}
          onPress={() => ctx.go('workspace', { unitId, laneId })} />
      </Card> : null}
      {error ? <Note>{error}</Note> : null}
    </>}
  </Screen>;
}

/** One section of a step's text: headings, list items, "Stop here" boxes, paragraphs. */
function SectionView({ section }: { section: StudySection }) {
  const body = <Text style={section.kind === 'heading' ? text.h4 : text.body}>
    {section.kind === 'item' ? `${section.n !== undefined ? `${section.n}.` : '•'} ` : ''}
    {inlineParts(section.text).map((p, i) => p.type === 'bold' ? <Text key={i} style={{ fontWeight: '700' }}>{p.text}</Text>
      : p.type === 'link' ? <Text key={i} style={styles.link}>{p.text}</Text> : <Text key={i}>{p.text}</Text>)}
  </Text>;
  if (section.kind !== 'action') return <View style={section.kind === 'item' ? { paddingLeft: space.sm } : undefined}>{body}</View>;
  return <View style={styles.action} accessibilityLabel="Stop here">
    <Pause size={18} color={colors.reference} />
    <View style={{ flex: 1 }}>{body}</View>
  </View>;
}

/** Progress as beads; the current step is ringed, never yellow. */
function Beads(props: { steps: boolean[]; current?: number }) {
  const done = props.steps.filter(Boolean).length;
  return <View style={styles.beads} accessible accessibilityRole="progressbar"
    accessibilityLabel={`${done} of ${props.steps.length} steps done`}>
    {props.steps.map((d, i) => <View key={i} style={[styles.bead, d && { backgroundColor: colors.done, borderColor: colors.done },
      props.current === i && { borderColor: colors.reference, borderWidth: 2 }]} />)}
  </View>;
}

/**
 * The passage beside the study: BSB verses with each verse playable from the
 * real Hays timings (passageReading). The verse being played is tinted.
 */
export function PassageReader(props: { ctx: Ctx; unitId: string; laneId: string }) {
  const { ctx } = props;
  const [playing, setPlaying] = useState<string | null>(null);
  const reading = passageReading(props.unitId);
  const hays = SOURCE_BIBLES.find((b) => b.id === 'berean-bsb-hays')!;
  const timed = !!ctx.org.state && sourceBibleEnabled(ctx.org.state, hays.id, ctx.project.projectId);
  const base = process.env.EXPO_PUBLIC_SOURCE_AUDIO_BASE_URL ?? 'https://pub-e5e8108b319c42069acd1ebf4fd0fb02.r2.dev';
  return <View style={{ gap: space.md }}>
    <PassageSourceAudio ctx={ctx} unitId={props.unitId} laneId={props.laneId} disabled={false} />
    {!reading ? <View accessible accessibilityLabel="The Bible text for this passage isn't available." style={styles.row}>
      <BookOpen size={24} color={colors.mutedForeground} /><HelpCircle size={18} color={colors.mutedForeground} />
    </View> : <Card>
      <Text style={text.small}>BSB</Text>
      {reading.verses.map((v) => {
        const id = `${v.chapter}:${v.verse}`;
        return <View key={id} style={[styles.verse, playing === id && { backgroundColor: tint.reference }]}>
          <View style={{ flex: 1 }}>
            <Text style={text.body}><Text style={text.small}>{v.verse} </Text>{v.text}</Text>
          </View>
          {timed && v.startSeconds !== undefined && v.endSeconds !== undefined ? <AudioClip project={ctx.project} hashes={[]} hideActions
            uri={sourceAudioUrl(hays, { book: reading.book, chapter: v.chapter, label: '' }, base)}
            startSeconds={v.startSeconds} endSeconds={v.endSeconds} onPlay={() => setPlaying(id)}
            label={`Play verse ${v.chapter}:${v.verse}`} /> : null}
        </View>;
      })}
    </Card>}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  people: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  switch: { flexDirection: 'row', gap: space.xs, padding: space.xs, borderRadius: radius.lg, backgroundColor: colors.muted },
  tab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  tabOn: { backgroundColor: colors.card },
  phase: { fontSize: 11, fontWeight: '700', letterSpacing: 1, color: colors.mutedForeground, paddingHorizontal: space.xs },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, minHeight: 64 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  mark: { width: 40, height: 40, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: tint.reference, alignItems: 'center', justifyContent: 'center' },
  beads: { flexDirection: 'row', gap: 6, justifyContent: 'center', paddingVertical: space.xs },
  bead: { width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  action: { flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: tint.reference },
  link: { color: colors.translate, textDecorationLine: 'underline' },
  verse: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.md, padding: space.xs }
});

import { contractsFor } from '../screenContracts';
export const contracts = contractsFor('study_guide', 'study_step');
