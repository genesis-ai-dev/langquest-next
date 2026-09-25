import { ObtPrompt } from './obt';
import { COMMUNITY_GUIDANCE } from '../obtGuidance';
import { contractsFor } from '../screenContracts';
// Avatar U. One community interaction or spoken review comment at a time.
import { deriveObt, obtCanAct } from '@langquest-next/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ArrowRight, Camera, Check, Mic, RotateCcw, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, TextInput, View } from 'react-native';
import type { Ctx } from '../ctx';
import { AudioClip } from '../audioClip';
import { Header, Note, Screen } from '../pui';
import { ActionButton } from '../ui';
import { colors, space } from '../theme';
import { useRecorder } from '../useRecorder';

interface CaptureDraft { id: string; name: string; comments: string; photoHash?: string }
export function ObtCapture(ctx: Ctx) {
  const { unitId = '', laneId = '', roundId = '', inputId = '' } = ctx.params;
  const noteOnly = ctx.params.noteOnly === 'true';
  const key = `obt-capture:${ctx.project.orgId}:${ctx.project.projectId}:${ctx.session.actorId}:${roundId}:${noteOnly ? inputId : 'community'}`;
  const [draft, setDraft] = useState<CaptureDraft>({ id: noteOnly ? inputId : Crypto.randomUUID(), name: '', comments: '' });
  const [slide,setSlide] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const current = useRef(ctx); current.current = ctx;
  const latestDraft = useRef(draft); latestDraft.current = draft;
  const writes = useRef(Promise.resolve());
  const held = useRef(false);
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(key).then(raw => {
      if (!active) return;
      if (raw) setDraft(JSON.parse(raw));
      setLoaded(true);
    }).catch(e => setError(e.message));
    return () => { active = false; };
  }, [key]);
  function update(patch: Partial<CaptureDraft>) {
    const value = { ...latestDraft.current, ...patch };
    latestDraft.current = value; setDraft(value);
    const write = writes.current.catch(() => {}).then(() => AsyncStorage.setItem(key, JSON.stringify(value)));
    writes.current = write;
    void write.catch(e => setError(e.message));
    return write;
  }
  const rec = useRecorder(async card => {
    await current.current.project.append('v1.ObtAudioAdded', {
      clipId: `${latestDraft.current.id}:${card.id}`, unitId, laneId,
      cards: [{ hash: card.ref.hash, durationMs: card.durationMs, format: card.ref.format === 'wav' ? 'wav' : 'm4a' }]
    });
    current.current.project.triggerUpload();
  }, { orgId: ctx.project.orgId, projectId: ctx.project.projectId, unitId, laneId, obtClipPrefix: draft.id });
  const state = ctx.project.state;
  if (!state) return <Note>Opening passage…</Note>;
  const j = deriveObt(state,unitId,laneId);
  const authorized = j.round?.value.roundId === roundId && obtCanAct(state,ctx.session.actorId,laneId,j.stage) &&
    (noteOnly ? ['consultant','final_approval'].includes(j.stage) && j.inputId === inputId : j.stage === 'community');
  const clips = Object.entries(state.obt.audio).filter(([id]) => id.startsWith(`${draft.id}:`));
  const blocked = !loaded || !authorized || busy || rec.busy || rec.manualOn || rec.vadOn || rec.failureCount > 0;
  async function save() {
    if (blocked) return;
    setBusy(true); setError('');
    try {
      await update({});
      if (!noteOnly) {
        if (!draft.name.trim() && !clips.length) throw new Error('Record or enter the participant name.');
        await ctx.project.append('v1.ObtInteractionSet', {
          unitId,laneId,roundId,interactionId:draft.id,draftId:j.round!.value.firstDraftId,
          participantName:draft.name.trim() || 'Spoken participant name',comments:draft.comments,
          clipIds:clips.map(([id]) => id),...(draft.photoHash ? { photoHash:draft.photoHash } : {})
        });
      }
      await AsyncStorage.removeItem(key); ctx.back();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function photo() {
    if (!camera.current || busy) return;
    setBusy(true); setError('');
    try {
      const picture = await camera.current.takePictureAsync({ quality:0.65 });
      if (!picture?.uri || !ctx.project.blobs.store) throw new Error('Photo capture failed.');
      const { ref } = await ctx.project.blobs.store.ingest(picture.uri,'jpg');
      update({ photoHash:ref.hash }); setCameraOpen(false);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const last = noteOnly ? 0 : 4;
  function advance() {
    if (!noteOnly && slide===0 && !draft.name.trim() && !clips.length) { setError('Record or enter the participant name.'); return; }
    setError('');
    if (cameraOpen) void photo();
    else if (slide<last) setSlide(slide+1);
    else void save();
  }
  return <Screen footer={<ActionButton icon={cameraOpen || slide===last ? Check : ArrowRight}
    accessibilityLabel={cameraOpen ? 'Take participant photo' : slide===last ? 'Save interaction' : 'Next interaction step'}
    disabled={blocked} onPress={advance} />}>
    <Header title={state.units[unitId]?.label ?? ''} onBack={busy || rec.manualOn ? undefined : slide>0 ? () => setSlide(slide-1) : ctx.back} />
    <ObtPrompt ctx={ctx} laneId={laneId} stage={noteOnly ? j.stage : COMMUNITY_GUIDANCE[slide]!} />
    {!authorized ? <Note>This task has moved to another stage.</Note> : null}
    {!noteOnly && slide===1 ? <AudioClip project={ctx.project} hashes={state.takes[j.round?.value.firstDraftId ?? '']?.cardHashes ?? []} label="Play the draft for this interaction" /> : null}
    {!noteOnly && slide===0 ? <TextInput accessibilityLabel="Participant name" placeholder="Participant name" value={draft.name}
      onChangeText={name => update({ name })} editable={loaded && authorized} style={{ padding:space.md,borderColor:colors.border,borderWidth:1 }} /> : null}
    {noteOnly || slide===0 || slide===2 ? <Pressable accessibilityRole="button" accessibilityLabel="Hold to record conversation or spoken comment"
      disabled={!loaded || !authorized || busy || rec.failureCount > 0} onPressIn={() => {
        if (blocked) return;
        held.current = true;
        void update({}).then(() => { if (held.current) return rec.manualDown(); }).catch(e => setError(e.message));
      }} onPressOut={() => { held.current = false; void rec.manualUp(); }}
      style={{ alignSelf:'center',padding:24,borderRadius:48,backgroundColor:rec.manualOn ? '#A8120A' : colors.translate }}>
      <Mic color="white" size={32} />
    </Pressable> : null}
    {clips.map(([id,r]) => <AudioClip key={id} project={ctx.project} hashes={r.value.cards.map(c => c.hash)} label="Play saved conversation" />)}
    {!noteOnly && slide===3 ? <TextInput accessibilityLabel="Optional comments, questions, observations or testimony" multiline value={draft.comments}
      onChangeText={comments => update({ comments })} editable={loaded && authorized} style={{ padding:space.md,borderColor:colors.border,borderWidth:1 }} /> : null}
    {!noteOnly && slide===4 ? <ActionButton icon={Camera} variant="outline" accessibilityLabel="Optional participant photo" disabled={blocked}
      onPress={() => { void (async () => {
        const granted = permission?.granted || (await requestPermission()).granted;
        if (granted) setCameraOpen(true); else setError('Camera access is unavailable. You can continue without a photo.');
      })(); }} /> : null}
    {cameraOpen ? <View><CameraView ref={camera} style={{ height:280 }} facing="back" />
      <ActionButton icon={X} variant="outline" accessibilityLabel="Cancel photo" onPress={() => setCameraOpen(false)} /></View> : null}
    {draft.photoHash && ctx.project.blobs.uriFor({ hash:draft.photoHash,format:'jpg' }) ? <Image source={{ uri:ctx.project.blobs.uriFor({ hash:draft.photoHash,format:'jpg' })! }} style={{ width:120,height:120 }} /> : null}
    {rec.failureCount ? <ActionButton icon={RotateCcw} variant="outline" accessibilityLabel="Retry saving audio" onPress={() => void rec.retryFailed()} /> : null}
    {error || rec.error ? <Note>{error || rec.error}</Note> : null}
  </Screen>;
}

export const contracts = contractsFor('obt_interaction');
