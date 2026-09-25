// Avatars P and U. Managers supply FIA study content; participants use one
// focused guided action at a time, with recorded instructions when supplied.
import {
  CATALOG_VERSION, defineFiaStudy, defineFiaProgress, FIA_STAGES,
  fiaPericopes, fiaProgressField, fiaStageContent, fiaStudiesFor,
  instantiateTemplate, fiaProgressId, materialView, type FiaStage
} from '@langquest-next/core';
import {
  ArrowRight, BookOpen, Check, ChevronLeft, Ear, HelpCircle,
  Layers, MapPin, Mic, Plus, RotateCcw, Users, X
} from 'lucide-react-native';
import { useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AudioClip } from './audioClip';
import type { Ctx } from './ctx';
import { Header, Note, Row, Screen, Section } from './pui';
import { PassageSourceAudio } from './passageSourceAudio';
import { colors, space } from './theme';
import { ActionButton, Card, text } from './ui';
import { useRecorder } from './useRecorder';
import { usePreferences } from './accountPreferences';

const icons = { hear: Ear, stage: MapPin, scenes: Layers,
  embody: Users, gaps: HelpCircle, speak: Mic };
const input = { borderWidth: 1, borderColor: colors.border,
  borderRadius: 12, padding: space.md, color: colors.foreground };

/** Reference selection installs real catalog units and blank study templates. */
export function FiaReferenceSetup({ ctx, laneId }: {
  ctx: Ctx; laneId: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const can = ctx.session.can('manage_reference') &&
    ctx.session.can('manage_templates') && Boolean(laneId);
  async function install(pericopeId?: string) {
    if (!can || busy) return;
    setBusy(true); setError('');
    try {
      const state = ctx.project.state;
      const definition = defineFiaStudy(laneId, pericopeId);
      const materialId = definition.payload.materialId;
      const events: Parameters<typeof ctx.project.appendMany>[0] = [];
      if (pericopeId) {
        events.push({ type: 'v1.LaneTemplateSelected', payload: {
          laneId, templateId: 'fia', catalogVersion: CATALOG_VERSION
        } });
        const all = instantiateTemplate('fia');
        const unit = all.find(u => u.unitId === definition.payload.scope.unitId)!;
        for (const u of all.filter(u => u.unitId === unit.unitId ||
          u.unitId === unit.parentUnitId)) {
          if (!state?.units[u.unitId]) events.push({
            type: 'v1.UnitAdded', payload: u
          });
        }
      }
      if (!state?.materials[materialId]) events.push(definition);
      if (!state?.materials[fiaProgressId(laneId)]) {
        events.push(defineFiaProgress(laneId));
      }
      await ctx.project.appendMany(events);
      ctx.go('material_editor', { materialId, laneId });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <Section label="FIA reference material">
    <Row icon={BookOpen} label="FIA study templates"
      sub="Hear · Stage · Scenes · Embody · Gaps · Speak"
      onPress={() => setOpen(!open)} last={!open} />
    {open ? <View style={{ padding: space.md, gap: space.md }}>
      <Note>Use the included passage catalog and add your team's study
        content. Templates contain empty fields, not licensed FIA lessons.</Note>
      <Note>Selecting a passage sets this language's content template to FIA.
        Existing recordings remain saved.</Note>
      <Row icon={Plus} label="Set up guidance for this language"
        onPress={can && !busy ? () => void install() : undefined} last />
      <TextInput style={input} value={query} onChangeText={setQuery}
        placeholder="Search a passage, e.g. Luke 1" accessibilityLabel="Search FIA passages" />
      {fiaPericopes(query).slice(0, 30).map(p => <Row key={p.itemId}
        label={p.label} icon={Plus}
        onPress={can && !busy ? () => void install(p.itemId) : undefined}
        last />)}
      <Note>{fiaPericopes(query).length} passages · Showing up to 30.
        Search to narrow the catalog.</Note>
      {!can ? <Note>A manager with template and reference permissions
        can add FIA study material.</Note> : null}
      {error ? <Note>{error}</Note> : null}
    </View> : null}
  </Section>;
}

/** Mount inside MaterialEditor for FIA material. The existing text editor
 * remains available; these controls add spoken guidance in the team's language.
 */
export function FiaGuidanceRecorder({ ctx, materialId, stage }: {
  ctx: Ctx; materialId: string; stage: FiaStage;
}) {
  const material = ctx.project.state?.materials[materialId];
  const can = ctx.session.can('manage_reference') ||
    (ctx.session.can('fill_reference') && !material?.locked.value);
  const value = material?.fields[stage]?.value;
  const rec = useRecorder(async card => {
    if (!can || !material) throw new Error('This material cannot be edited.');
    await ctx.project.append('v1.MaterialFieldSet', { materialId,
      fieldId: stage, ...(value?.text ? { text: value.text } : {}),
      blobHash: card.ref.hash });
    ctx.project.triggerUpload();
  });
  return <View style={{ gap: space.sm }}>
    {value?.blobHash ? <AudioClip project={ctx.project}
      hashes={[value.blobHash]} label={`Play ${stage} instructions`} /> : null}
    <Pressable accessibilityRole="button" disabled={!can || rec.busy}
      accessibilityLabel={`Hold to record ${stage} instructions`}
      onPressIn={() => { if (can && !rec.busy) void rec.manualDown(); }}
      onPressOut={() => void rec.manualUp()}
      style={{ padding: space.md, alignSelf: 'center', borderRadius: 32,
        backgroundColor: rec.manualOn ? '#A8120A' : colors.translate }}>
      <Mic color="white" />
    </Pressable>
    {rec.failureCount ? <ActionButton icon={RotateCcw} variant="outline"
      accessibilityLabel="Retry saving guidance"
      onPress={() => void rec.retryFailed()} /> : null}
    {rec.error ? <Note>{rec.error}</Note> : null}
  </View>;
}

export function FiaGuide({ ctx, laneId, unitId, onSpeak, canSpeak = true }: {
  ctx: Ctx; laneId: string; unitId: string; onSpeak: () => void;
  canSpeak?: boolean;
}) {
  const { locked } = usePreferences();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const state = ctx.project.state;
  const studies = state ? fiaStudiesFor(state, laneId, unitId) : [];
  if (!studies.length || state?.obt.workspace) return null;
  const stage = FIA_STAGES[index]!;
  const Icon = icons[stage.id];
  const fields = fiaStageContent(studies, stage.id);
  const dedicatedProgress = state ? materialView(state, fiaProgressId(laneId)) : null;
  const progress = dedicatedProgress ?? studies.find(m => !m.locked) ?? studies[0]!;
  const writable = ctx.session.can('manage_reference') ||
    (ctx.session.can('fill_reference') && !progress.locked);
  const complete = (id: FiaStage) => [...studies, ...(dedicatedProgress ? [dedicatedProgress] : [])].some(m => m.fields.some(f =>
    f.fieldId === fiaProgressField(ctx.session.actorId, unitId, id) &&
    f.text === 'complete'));
  function show() {
    const next = FIA_STAGES.findIndex(s => !complete(s.id));
    setIndex(next < 0 ? 0 : next); setError(''); setOpen(true);
  }
  async function next() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      // Speak hands over to the actual recorder; opening it is not completion.
      if (stage.id !== 'speak' && writable) {
        await ctx.project.append('v1.MaterialFieldSet', {
          materialId: progress.materialId,
          fieldId: fiaProgressField(ctx.session.actorId, unitId, stage.id),
          text: 'complete'
        });
      }
      if (stage.id === 'speak') { setOpen(false); onSpeak(); }
      else setIndex(index + 1);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <>
    <ActionButton icon={BookOpen} variant="outline"
      accessibilityLabel="Open FIA guided study" onPress={show} />
    <Modal visible={open && !locked} animationType="slide" presentationStyle="pageSheet"
      onRequestClose={() => { if (!busy) setOpen(false); }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <Screen footer={<ActionButton icon={stage.id === 'speak' ? Mic : ArrowRight}
          accessibilityLabel={stage.id === 'speak' ? 'Record the passage' : 'Complete this stage and continue'}
          disabled={busy || (stage.id === 'speak' && (!canSpeak || !ctx.session.can('translate')))}
          onPress={() => void next()} />}>
          <Header title={state?.units[unitId]?.label ?? unitId}
            onBack={busy ? undefined : () => setOpen(false)} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {FIA_STAGES.map((s, i) => <ActionButton key={s.id}
              icon={complete(s.id) ? Check : icons[s.id]} variant="outline"
              accessibilityLabel={`${s.label}${i === index ? ', current stage' : ''}`}
              disabled={busy} onPress={() => setIndex(i)} />)}
          </View>
          <View accessible accessibilityLabel={`${stage.label}. ${stage.prompt}`}
            style={{ alignItems: 'center', padding: space.xl }}>
            <Icon color={colors.reference} size={64} />
          </View>
          {stage.id === 'hear' ? <PassageSourceAudio ctx={ctx}
            unitId={unitId} laneId={laneId} disabled={busy} /> : null}
          {fields.map(f => <Card key={f.materialId}>
            {f.blobHash ? <AudioClip project={ctx.project} hashes={[f.blobHash]}
              label={`Hear ${stage.label} study guidance`} /> : null}
            {f.text ? <Text style={text.body}>{f.text}</Text> : null}
          </Card>)}
          {!fields.length ? <View accessible
            accessibilityLabel={`No ${stage.label} study guidance supplied yet`}>
            <HelpCircle size={24} color={colors.mutedForeground} />
          </View> : null}
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <ActionButton icon={ChevronLeft} variant="outline"
              accessibilityLabel="Previous FIA stage" disabled={busy || index === 0}
              onPress={() => setIndex(index - 1)} />
            <ActionButton icon={X} variant="outline" accessibilityLabel="Close FIA study"
              disabled={busy} onPress={() => setOpen(false)} />
          </View>
          {error ? <Note>{error}</Note> : null}
        </Screen>
      </SafeAreaView>
    </Modal>
  </>;
}
