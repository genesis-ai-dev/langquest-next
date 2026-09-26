// Avatar P. Managers supply FIA study content and its spoken guidance.
// Participants study on the study_guide / study_step screens (screens/study.tsx).
import {
  CATALOG_VERSION, defineFiaStudy, defineFiaProgress,
  fiaPericopes, instantiateTemplate, fiaProgressId, type FiaStage
} from '@langquest-next/core';
import { BookOpen, Mic, Plus, RotateCcw } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { AudioClip } from './audioClip';
import type { Ctx } from './ctx';
import { Note, Row, Section } from './pui';
import { colors, space } from './theme';
import { ActionButton } from './ui';
import { useRecorder } from './useRecorder';

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
