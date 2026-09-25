// Avatar P. Record spoken guidance in the participants' language.
import { OBT_GUIDANCE, type ObtGuidanceKey } from './obtGuidance';
import { Mic, RotateCcw } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import type { Ctx } from './ctx';
import { AudioClip } from './audioClip';
import { ActionButton } from './ui';
import { Note } from './pui';
import { useRecorder } from './useRecorder';
import { colors, space } from './theme';

export function ObtPromptRecorder({ ctx, laneId, stage }: { ctx: Ctx; laneId: string; stage: ObtGuidanceKey }) {
  const can = ['owner','coordinator'].includes(ctx.session.role ?? '');
  const materialId = `obt-prompts:${laneId}`;
  const rec = useRecorder(async card => {
    if (!can) throw new Error('Coordinator required.');
    const material = ctx.project.state?.materials[materialId];
    if (!material) await ctx.project.append('v1.MaterialDefined', {
      materialId,kind:'custom',title:'Spoken workflow instructions',scope:{laneId}
    });
    await ctx.project.append('v1.ObtAudioAdded', { unitId:'instructions',laneId,
      clipId:card.id,cards:[{hash:card.ref.hash,format:card.ref.format,durationMs:card.durationMs}] });
    await ctx.project.append('v1.MaterialFieldSet', { materialId,fieldId:stage,blobHash:card.ref.hash });
    ctx.project.triggerUpload();
  });
  const hash = ctx.project.state?.materials[materialId]?.fields[stage]?.value.blobHash;
  return <View style={{gap:space.md}}>
    {hash ? <AudioClip project={ctx.project} hashes={[hash]} label={`Play ${OBT_GUIDANCE[stage]} guidance`} /> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={`Hold to record ${OBT_GUIDANCE[stage]} guidance`}
      disabled={!can} onPressIn={() => { if (can && !rec.busy && !rec.failureCount) void rec.manualDown(); }} onPressOut={() => void rec.manualUp()}
      style={{padding:space.md,alignSelf:'center',borderRadius:32,backgroundColor:rec.manualOn ? '#A8120A' : colors.translate}}>
      <Mic color="white" />
    </Pressable>
    {rec.failureCount ? <ActionButton icon={RotateCcw} variant="outline" accessibilityLabel="Retry saving guidance" onPress={() => void rec.retryFailed()} /> : null}
    {rec.error ? <Note>{rec.error}</Note> : null}
  </View>;
}
