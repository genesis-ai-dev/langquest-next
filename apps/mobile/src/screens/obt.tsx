import { TranslationOptions } from '../translationOptions';
import { OBT_GUIDANCE, type ObtGuidanceKey } from '../obtGuidance';
import { FiaGuide } from '../fia';
import { contractsFor } from '../screenContracts';
// Avatar U. Six-stage passage hub and focused slides; one yellow action.
import {
  assertObtStep, currentTake, deriveObt, deriveTasksFor, isObtLane, materialsFor, tgMaterialId, unitAncestry,
  OBT_LABELS, obtCanAct, type ObtStep, type ObtStage
} from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { ArrowLeft, ArrowRight, Check, Clock, Headphones, History, KeyRound, MessageSquare, Mic, Plus, Send, ShieldCheck, Users, X } from 'lucide-react-native';
import { useState } from 'react';
import { Image, Text, TextInput, View } from 'react-native';
import type { Ctx } from '../ctx';
import { AudioClip } from '../audioClip';
import { PassageSourceAudio } from '../passageSourceAudio';
import { Header, Note, Screen } from '../pui';
import { ActionButton, Card, text } from '../ui';
import { Byline } from '../UserChip';
import { colors, space } from '../theme';
import { useTask } from './translate';

export const STAGE_ICONS = {
  first_draft: Mic, community: Users, revision: Mic,
  back_translation: Headphones, consultant: ShieldCheck,
  final_recording: Mic, final_approval: ShieldCheck, complete: Check
};
export function ObtPrompt({ ctx, stage, laneId }: { ctx: Ctx; stage: ObtGuidanceKey; laneId: string }) {
  const fields = ctx.project.state?.materials[`obt-prompts:${laneId}`]?.fields;
  const hash = fields?.[stage]?.value.blobHash ?? (stage.startsWith('community_') ? fields?.community?.value.blobHash : undefined);
  return hash ? <AudioClip project={ctx.project} hashes={[hash]} label={`Hear ${OBT_GUIDANCE[stage]} instructions`} /> : null;
}
export function ObtPassage(ctx: Ctx) {
  const { task: assignedTask, ready } = useTask(ctx);
  const task = assignedTask ?? (ctx.params.unitId && ctx.params.laneId ? {
    id:ctx.params.taskId ?? '',unitId:ctx.params.unitId,laneId:ctx.params.laneId
  } : undefined);
  const [mode, setMode] = useState<'hub' | 'select' | 'review' | 'history'>(ctx.session.isViewer ? 'history' : 'hub');
  const [choice, setChoice] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const state = ctx.project.state;
  if (!state || !task) return <Note>{ready ? 'Task not found.' : 'Opening passage…'}</Note>;
  const { unitId, laneId } = task;
  const j = deriveObt(state, unitId, laneId);
  const can = obtCanAct(state, ctx.session.actorId, laneId, j.stage);
  const params = { taskId: task.id, unitId, laneId };
  const title = state.units[unitId]?.label ?? unitId;
  const btIds = new Set(Object.values(state.obt.steps).filter(r => r.value.step === 'back_translation').map(r => r.value.takeId));
  const takes = Object.entries(state.takes).filter(([id, t]) => t.unitId === unitId && t.laneId === laneId &&
    !t.archived && t.cardHashes.length && !btIds.has(id)).sort((a, b) => b[1].hlc.localeCompare(a[1].hlc) || b[0].localeCompare(a[0]));
  const fallback = currentTake(state, unitId, laneId);
  const selected = takes.find(([id]) => id === choice) ?? takes.find(([id]) => id === fallback) ?? takes[0];
  const icon = STAGE_ICONS[j.stage];
  async function save(decision: 'complete' | 'approve' | 'changes_requested' = 'complete') {
    if (!can || busy) return;
    setBusy(true); setError('');
    try {
      if (j.stage === 'first_draft') {
        if (!selected) throw new Error('Keep a recording first.');
        await ctx.project.append('v1.ObtRoundStarted', { unitId, laneId,
          roundId: Crypto.randomUUID(), firstDraftId: selected[0], previousRoundId: null });
      } else {
        if (!j.round || !j.inputId || j.stage === 'complete') return;
        const clipIds = Object.keys(state!.obt.audio).filter(id => id.startsWith(`${j.inputId}:`));
        const payload = { unitId, laneId, clipIds, roundId: j.round.value.roundId,
          step: j.stage as ObtStep, inputId: j.inputId, decision,
          ...(['revision', 'final_recording'].includes(j.stage) && selected ? { takeId: selected[0] } : {}),
          ...(note.trim() ? { note: note.trim() } : {}) };
        assertObtStep(state!, ctx.session.actorId, payload);
        await ctx.project.append('v1.ObtStepRecorded', payload);
      }
      setMode('hub'); setNote(''); setChoice(null);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  function next() {
    if (j.stage === 'back_translation') ctx.go('obt_manage', params);
    else if (['consultant', 'final_approval'].includes(j.stage)) setMode('review');
    else if (['first_draft', 'revision', 'final_recording'].includes(j.stage)) {
      if (!takes.length) ctx.go('quest_assets', params); else setMode('select');
    } else if (j.stage === 'community') void save();
    else setMode('history');
  }
  async function repeatCommunity() {
    if (!selected || busy || !['owner','coordinator','translator'].includes(ctx.session.role ?? '')) return;
    setBusy(true); setError('');
    try {
      await ctx.project.append('v1.ObtRoundStarted',{ unitId,laneId,roundId:Crypto.randomUUID(),
        firstDraftId:selected[0],previousRoundId:j.round?.value.roundId ?? null });
      setMode('hub');
    } catch(e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const minimum = state.obt.policies[laneId]?.value.minimumInteractions ?? 1;
  const footer = mode === 'select' ? <ActionButton icon={Send} accessibilityLabel="Select this recording and hand off"
    onPress={() => void save()} disabled={busy || !selected} /> :
    mode === 'review' ? <ActionButton icon={Check} accessibilityLabel="Approve this version"
      onPress={() => void save('approve')} disabled={busy || !can} /> :
    mode === 'history' ? <ActionButton icon={ArrowLeft} accessibilityLabel="Return to passage" onPress={() => setMode('hub')} /> :
    <ActionButton icon={j.stage === 'complete' ? Check : can ? ArrowRight : Clock}
      accessibilityLabel={can ? OBT_LABELS[j.stage] : 'Waiting for the next participant'} onPress={next}
      disabled={busy || (j.stage !== 'complete' && !can) || (j.stage === 'community' && j.interactions.length < minimum)} />;
  return <Screen footer={footer}>
    <Header title={title} onBack={busy ? undefined : mode === 'hub' ? ctx.back : () => setMode('hub')} />
    {mode === 'hub' ? <TranslationOptions ctx={ctx} unitId={unitId} laneId={laneId} /> : null}
    <View accessible accessibilityLabel={OBT_LABELS[j.stage]} style={{ alignItems: 'center' }}>
      {(() => { const Icon = icon; return <Icon size={42} color={colors.review} />; })()}
    </View>
    <ObtPrompt ctx={ctx} laneId={laneId} stage={j.stage} />
    {mode === 'hub' ? <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        <FiaGuide ctx={ctx} laneId={laneId} unitId={unitId}
          canSpeak={can && ['first_draft', 'revision', 'final_recording'].includes(j.stage)}
          onSpeak={() => ctx.go('quest_assets', params)} />
        <ActionButton icon={Headphones} variant="outline" accessibilityLabel="Source references" onPress={() => ctx.go('passage_references', params)} />
        <ActionButton icon={KeyRound} variant="outline" accessibilityLabel="Record key terms" disabled={!ctx.session.can('translate')} onPress={() => ctx.go('passage_terms', params)} />
        <ActionButton icon={MessageSquare} variant="outline" accessibilityLabel="Record translation notes" disabled={!ctx.session.can('fill_reference')} onPress={() => ctx.go('add_to_tg', params)} />
        <ActionButton icon={History} variant="outline" accessibilityLabel="Draft and review history" onPress={() => setMode('history')} />
        <ActionButton icon={Mic} variant="outline" accessibilityLabel="Record another attempt"
          disabled={!can || !['first_draft','revision','final_recording'].includes(j.stage)} onPress={() => ctx.go('quest_assets', params)} />
        <ActionButton icon={Users} variant="outline" accessibilityLabel="Capture community interaction"
          disabled={j.stage !== 'community' || !can} onPress={() => ctx.go('obt_interaction', { ...params, roundId: j.round!.value.roundId })} />
      </View>
      {j.draftId ? <AudioClip project={ctx.project} hashes={state.takes[j.draftId]?.cardHashes ?? []} label="Listen to the selected draft"
        editTarget={can && ['first_draft', 'revision', 'final_recording'].includes(j.stage) ? { unitId, laneId } : undefined} /> : null}
      {j.stage === 'community' ? <Text style={text.small}>{j.interactions.length} / {minimum}</Text> : null}
      {j.reason ? <Note>{j.reason}</Note> : null}
      {j.stage === 'complete' && j.finalTakeId ? <>
        <AudioClip project={ctx.project} hashes={state.takes[j.finalTakeId]?.cardHashes ?? []} label="Play approved final audio" />

      </> : null}
    </> : null}
    {mode === 'select' ? <>
      <PassageSourceAudio ctx={ctx} unitId={unitId} laneId={laneId} disabled={busy} />
      {selected ? <>
        <Text style={text.small}>{takes.indexOf(selected) + 1} / {takes.length}</Text>
        <AudioClip project={ctx.project} hashes={selected[1].cardHashes} label="Listen to this kept attempt" />
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <ActionButton icon={ArrowLeft} variant="outline" accessibilityLabel="Previous attempt" disabled={takes.indexOf(selected) === 0}
            onPress={() => setChoice(takes[takes.indexOf(selected) - 1]![0])} />
          <ActionButton icon={ArrowRight} variant="outline" accessibilityLabel="Next attempt" disabled={takes.indexOf(selected) === takes.length - 1}
            onPress={() => setChoice(takes[takes.indexOf(selected) + 1]![0])} />
        </View>
      </> : null}
      {j.stage === 'revision' ? <ActionButton icon={Users} variant="outline" accessibilityLabel="Send this recording through a new community-checking round" disabled={busy} onPress={() => void repeatCommunity()} /> : null}
      {j.stage === 'revision' && j.draftId ? <ActionButton icon={Check} variant="outline" accessibilityLabel="Continue with the first draft unchanged" onPress={() => setChoice(j.draftId)} /> : null}
      <ActionButton icon={Plus} variant="outline" accessibilityLabel="Record another attempt" onPress={() => ctx.go('quest_assets', params)} />
    </> : null}
    {mode === 'history' || mode === 'review' ? <ObtHistory ctx={ctx} unitId={unitId} laneId={laneId} /> : null}
    {mode === 'review' ? <>
      <TextInput accessibilityLabel="Optional consultant comments or final corrections" value={note} onChangeText={setNote}
        multiline style={{ borderWidth: 1, borderColor: colors.border, padding: space.md }} />
      <ActionButton icon={MessageSquare} variant="outline" accessibilityLabel="Record spoken review comments" onPress={() => ctx.go('obt_interaction', { ...params, noteOnly: 'true', roundId: j.round!.value.roundId, inputId: j.inputId! })} />
      <ActionButton icon={X} variant="outline" accessibilityLabel="Request changes" disabled={busy || !can} onPress={() => void save('changes_requested')} />
    </> : null}
    {error ? <Note>{error}</Note> : null}
    {ctx.project.refused ? <Note>{ctx.project.refused}</Note> : null}
    <Text accessibilityLabel={ctx.project.pending ? 'Hand-off queued on this phone' : 'Events synced; audio may still be uploading'} style={text.small}>
      {ctx.project.pending ? '◷' : '✓'} {ctx.project.blobs.pendingUp || ''}
    </Text>
  </Screen>;
}

export function ObtHistory({ ctx, unitId, laneId }: { ctx: Ctx; unitId: string; laneId: string }) {
  const [page,setPage] = useState(0);
  const state = ctx.project.state!;
  const j = deriveObt(state, unitId, laneId);
  const recordings = Object.entries(state.takes).filter(([,t]) => t.unitId === unitId && t.laneId === laneId);
  const interactions = Object.values(state.obt.interactions).filter(r => r.value.unitId === unitId && r.value.laneId === laneId);
  const steps = Object.values(state.obt.steps).filter(r => r.value.unitId === unitId && r.value.laneId === laneId).sort((a,b) => a.hlc.localeCompare(b.hlc));
  const ancestors = unitAncestry(state,unitId);
  const notes = materialsFor(state, { unitId, laneId }).filter(m => m.kind !== 'questions' && m.materialId !== `obt-prompts:${laneId}`); 
  const items = [
    ...recordings.map(([id,t]) => <Card key={id}>
      <View accessible accessibilityLabel={id === j.finalTakeId ? 'Final recording' : id === j.backTranslationId ? 'Back translation' : id === j.draftId ? 'Selected draft' : 'Earlier recording'}>
        {id === j.finalTakeId ? <ShieldCheck color={colors.done} /> : id === j.backTranslationId ? <Headphones color={colors.reference} /> : <Mic color={colors.translate} />}
      </View>
      <AudioClip project={ctx.project} hashes={t.cardHashes} label="Play version" />
    </Card>),
    ...interactions.map(r => <Card key={r.eventId}>
      <Users color={colors.review} />
      <Text style={text.body}>{r.value.participantName}</Text>
      <AudioClip project={ctx.project} hashes={state.takes[r.value.draftId]?.cardHashes ?? []} label="Play the draft used in this interaction" />
      {r.value.photoHash && ctx.project.blobs.uriFor({ hash: r.value.photoHash, format: 'jpg' }) ?
        <Image source={{ uri: ctx.project.blobs.uriFor({ hash: r.value.photoHash, format: 'jpg' })! }} style={{ width: 120, height: 120 }} accessibilityLabel="Participant photo" /> : null}
      <Text style={text.body}>{r.value.comments}</Text>
      {r.value.clipIds.map(id => <AudioClip key={id} project={ctx.project} hashes={state.obt.audio[id]?.value.cards.map(c => c.hash) ?? []} label="Play community conversation" />)}
    </Card>),
    ...steps.map(r => <Card key={r.eventId}>
      <View accessible accessibilityLabel={`${r.value.decision}; ${j.steps[r.value.step]?.eventId === r.eventId ? 'current' : 'earlier'} decision`}>
        {r.value.decision === 'changes_requested' ? <X color={colors.reference} /> : <Check color={colors.done} />}
        {j.steps[r.value.step]?.eventId !== r.eventId ? <Clock color={colors.mutedForeground} /> : null}
      </View>
      <Byline before={`${OBT_LABELS[r.value.step]} ·`} id={r.actorId} />
      {r.value.takeId ? <AudioClip project={ctx.project} hashes={state.takes[r.value.takeId]?.cardHashes ?? []} label="Play the recording linked to this decision" /> : null}
      {r.value.note ? <Text style={text.body}>{r.value.note}</Text> : null}
      {(r.value.clipIds ?? []).map(id => <AudioClip key={id} project={ctx.project} hashes={state.obt.audio[id]?.value.cards.map(c => c.hash) ?? []} label="Play review comment" />)}
    </Card>),
    ...notes.map(m => <Card key={m.materialId}>{m.fields.filter(f => m.materialId !== tgMaterialId(laneId) || ancestors.has(f.fieldId)).map(f => <View key={f.fieldId}>
      {f.text ? <Text style={text.body}>{f.text}</Text> : null}
      {f.blobHash ? <AudioClip project={ctx.project} hashes={[f.blobHash]} label="Play translation note" /> : null}
    </View>)}</Card>),
    ...Object.values(state.keyTerms).filter(t => t.laneId===laneId && (!t.unitScope.length || t.unitScope.some(id => ancestors.has(id)))).map(t => <Card key={`term:${t.term}`}>
      <KeyRound color={colors.reference} /><Text style={text.body}>{t.term}</Text>
      {Object.entries(t.adjustments).map(([id,a]) => <View key={id}>
        {a.note ? <Text style={text.body}>{a.note}</Text> : null}
        {a.blobHash ? <AudioClip project={ctx.project} hashes={[a.blobHash]} label="Play key term note" /> : null}
      </View>)}
    </Card>)
  ];
  const at = Math.min(page,Math.max(0,items.length-1));
  return <>
    <Text style={text.small}>{items.length ? at+1 : 0} / {items.length}</Text>
    {items[at]}
    <View style={{flexDirection:'row',gap:space.md}}>
      <ActionButton icon={ArrowLeft} variant="outline" accessibilityLabel="Previous review resource" disabled={at===0} onPress={() => setPage(at-1)} />
      <ActionButton icon={ArrowRight} variant="outline" accessibilityLabel="Next review resource" disabled={at>=items.length-1} onPress={() => setPage(at+1)} />
    </View>
  </>;
}

export function BackTranslation(ctx: Ctx) {
  const { task: assignedTask } = useTask(ctx);
  const workspace = ctx.project.state?.obt.workspace?.value;
  const task = assignedTask ?? (workspace && ctx.project.state ? deriveTasksFor(ctx.project.state,ctx.session.actorId,workspace.unitId,workspace.laneId)[0] : undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const state = ctx.project.state;
  if (!state || !task || !state.obt.workspace) return <Note>Opening back translation…</Note>;
  const w = state.obt.workspace.value;
  const takeId = currentTake(state, task.unitId, task.laneId);
  const output = takeId && takeId !== w.inputTakeId ? state.takes[takeId] : null;
  return <Screen footer={<ActionButton icon={output ? Send : Mic} accessibilityLabel={output ? 'Submit back translation' : 'Record back translation'}
    disabled={busy || !!(takeId && state.submissions[takeId])} onPress={() => {
      if (!output) { ctx.go('quest_assets', { taskId: task.id }); return; }
      setBusy(true); void ctx.project.append('v1.TakeSubmitted', { takeId: takeId! })
        .catch(e => setError(e.message)).finally(() => setBusy(false));
    }} />}>
    <Header title={state.units[task.unitId]?.label ?? ''} onBack={ctx.back} />
    <Text style={text.body}>{w.language}</Text>
    <AudioClip project={ctx.project} hashes={state.takes[w.inputTakeId]?.cardHashes ?? []} label="Listen to the assigned draft" seekControls />
    {output ? <AudioClip project={ctx.project} hashes={output.cardHashes} label="Listen to your back translation" /> : null}
    <ActionButton icon={Mic} variant="outline" accessibilityLabel="Record another back translation" onPress={() => ctx.go('quest_assets', { taskId: task.id })} />
    {takeId && state.submissions[takeId] ? <Clock color={colors.review} accessibilityLabel="Back translation queued; return to My Work" /> : null}
    {error ? <Note>{error}</Note> : null}
  </Screen>;
}

export function WorkflowPassage(ctx: Ctx) {
  const state = ctx.project.state;
  const laneId = ctx.params.laneId ?? ctx.params.taskId?.split(':')[2] ?? '';
  if (state?.obt.workspace) return <BackTranslation {...ctx} />;
  if (state && isObtLane(state,laneId)) return <ObtPassage {...ctx} />;
  return null;
}

export const contracts = contractsFor('obt_passage');
