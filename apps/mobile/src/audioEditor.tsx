// Avatar U. Secondary recording editor; original recordings remain immutable.
import { commands, validTakeMetadata, type TakeMetadata } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { Check, ChevronDown, ChevronUp, Mic, Plus, RotateCcw, RotateCw, Square, Trash2, X } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Alert, Modal, ScrollView, Text, TextInput, View } from 'react-native';
import { AudioClip } from './audioClip';
import { cardInfo, renderAudio, ShareAudioButton } from './audioExport';
import { changeEdit, editDuration, redoEdit, replaceSegments, undoEdit, type AudioEdit, type AudioSegment, type EditHistory } from './audioEditModel';
import { indexesFor } from './indexes';
import { stopAudioPlayback } from './audioSession';
import { colors, space } from './theme';
import { ActionButton, Card, text } from './ui';
import type { ProjectHandle } from './useProject';
import { useRecorder } from './useRecorder';

export interface AudioEditTarget { unitId: string; laneId: string; onSaved?: () => void }
export function AudioEditor(props: {
  project: ProjectHandle; hashes: string[]; label?: string;
  target?: AudioEditTarget; locked?: boolean; onClose: () => void;
}) {
  const [history, setHistory] = useState<EditHistory>(() => {
    const take = Object.entries(props.project.state?.takes ?? {}).filter(([, value]) =>
      !value.archived && value.cardHashes.join(':') === props.hashes.join(':'))
      .sort(([, a], [, b]) => b.hlc.localeCompare(a.hlc))[0];
    const metadata = take ? props.project.state?.takeMetadata[take[0]]?.value : undefined;
    return { past: [], future: [], present: {
      segments: props.hashes.map(hash => ({ id: Crypto.randomUUID(), hash,
        startMs: 0, endMs: cardInfo(props.project, hash).durationMs })),
      metadata: metadata ?? { name: props.label ?? 'Recording', milestones: [] }
    } };
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<'insert' | 'replace'>('insert');
  const [verseStart, setVerseStart] = useState('1');
  const [verseEnd, setVerseEnd] = useState('1');
  const [start, setStart] = useState('0');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const edit = history.present;
  const duration = editDuration(edit);
  function change(next: AudioEdit) { setHistory(h => changeEdit(h, next)); }
  function audioChange(segments: AudioSegment[]) {
    change(replaceSegments(edit, segments)); setSelected([]);
  }
  function insert(segment: AudioSegment) {
    const index = edit.segments.findIndex(s => selected.includes(s.id));
    if (mode === 'replace' && index < 0) throw new Error('Select a part to replace.');
    const next = [...edit.segments];
    next.splice(index < 0 ? next.length : index + (mode === 'insert' ? 1 : 0), mode === 'replace' ? 1 : 0, segment);
    audioChange(next);
  }
  const rec = useRecorder(async card => {
    const state = props.project.state;
    if (!state || !props.target) throw new Error('Open the passage recording screen to record changes.');
    await props.project.run(commands(state, indexesFor(state)).addRecording({
      commandId: card.id, recordingId: card.id, ...props.target, kind: 'target',
      card: { hash: card.ref.hash, format: card.ref.format, durationMs: card.durationMs }
    }));
    insert({ id: card.id, hash: card.ref.hash, startMs: 0, endMs: card.durationMs });
    props.project.triggerUpload();
  }, props.target ? { orgId: props.project.orgId, projectId: props.project.projectId,
    unitId: props.target.unitId, laneId: props.target.laneId } : undefined);
  const blocked = busy || rec.busy || rec.manualOn || rec.failureCount > 0;
  const library = Object.values(props.project.state?.recordings ?? {}).filter(r =>
    props.target && r.unitId === props.target.unitId && r.laneId === props.target.laneId)
    .flatMap(r => r.cards).filter((card, index, all) => all.findIndex(c => c.hash === card.hash) === index);
  async function merge() {
    if (lock.current || blocked) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const parts = edit.segments.filter(s => selected.includes(s.id));
      if (parts.length < 2) throw new Error('Select two or more parts to merge.');
      const indices = parts.map(s => edit.segments.indexOf(s));
      if (indices.at(-1)! - indices[0]! + 1 !== indices.length) throw new Error('Select adjacent parts to merge.');
      const file = await renderAudio(props.project, parts, edit.metadata.name);
      const store = props.project.blobs.store;
      if (!store) throw new Error('Audio storage is not ready.');
      const { ref } = await store.ingest(file.uri, 'wav');
      const id = Crypto.randomUUID();
      const durationMs = parts.reduce((n, s) => n + s.endMs - s.startMs, 0);
      if (!props.target || !props.project.state) throw new Error('Open passage recording to merge.');
      await props.project.run(commands(props.project.state).addRecording({
        commandId: id, recordingId: id, ...props.target, kind: 'target', card: { ...ref, format: 'wav', durationMs }
      }));
      const next = [...edit.segments];
      next.splice(indices[0]!, parts.length, { id, hash: ref.hash, startMs: 0, endMs: durationMs });
      audioChange(next); props.project.triggerUpload();
    } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  async function save() {
    if (lock.current || blocked) return;
    lock.current = true; setBusy(true); setError(''); stopAudioPlayback();
    try {
      if (!edit.segments.length || !validTakeMetadata(edit.metadata, duration)) throw new Error('Check the name, audio parts, and verse times.');
      const file = await renderAudio(props.project, edit.segments, edit.metadata.name);
      const store = props.project.blobs.store;
      if (!store || !props.project.state || !props.target) throw new Error('Open passage recording to save changes.');
      const { ref } = await store.ingest(file.uri, 'wav');
      const id = Crypto.randomUUID();
      const cmd = commands(props.project.state);
      await props.project.run([
        ...cmd.addRecording({ commandId: `${id}:audio`, recordingId: id,
          ...props.target, kind: 'target', card: { ...ref, format: 'wav', durationMs: duration } }),
        ...cmd.discardCards({ commandId: `${id}:used`, ...props.target,
          cardHashes: [...new Set([...props.hashes, ...edit.segments.map(s => s.hash)])] }),
        ...cmd.keepTake({ commandId: id, ...props.target,
          cardHashes: [ref.hash], metadata: edit.metadata })
      ]);
      props.project.triggerUpload(); props.target.onSaved?.(); props.onClose();
    } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  function close() {
    if (blocked) return;
    if (!history.past.length) props.onClose();
    else Alert.alert('Discard unsaved edits?', 'Original audio stays available.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: props.onClose }
    ]);
  }
  if (!props.target) return <Modal visible={!props.locked} animationType="slide" onRequestClose={props.onClose}>
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 60, gap: space.md, backgroundColor: colors.background }}>
      <ActionButton icon={X} variant="outline" accessibilityLabel="Close recording details" onPress={props.onClose} />
      <Text style={text.h3}>{edit.metadata.name}</Text>
      <Text style={text.small}>{(duration / 1000).toFixed(1)} seconds · {edit.segments.length} parts</Text>
      <Text style={text.muted}>Open the passage recording screen to save an edited child take.</Text>
      {edit.segments.map((segment, index) => <Card key={segment.id}>
        <Text style={text.small}>Part {index + 1}</Text>
        <AudioClip project={props.project} hashes={[segment.hash]} hideActions label={`Play part ${index + 1}`} />
      </Card>)}
      {edit.metadata.milestones.map((m, index) => <Text key={index} style={text.body}>
        Verse {m.verseStart}–{m.verseEnd}: {m.startMs / 1000}s{m.endMs === undefined ? '' : `–${m.endMs / 1000}s`}
      </Text>)}
      <ShareAudioButton project={props.project} hashes={props.hashes} name={edit.metadata.name} />
    </ScrollView>
  </Modal>;
  const input = { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, color: colors.foreground };
  return <Modal visible={!props.locked} animationType="slide" onRequestClose={close}>
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 60, gap: space.md, backgroundColor: colors.background }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <ActionButton icon={X} variant="outline" accessibilityLabel="Close audio editor" disabled={blocked} onPress={close} />
        <ActionButton icon={RotateCcw} variant="outline" accessibilityLabel="Undo audio edit" disabled={blocked || !history.past.length} onPress={() => setHistory(undoEdit)} />
        <ActionButton icon={RotateCw} variant="outline" accessibilityLabel="Redo audio edit" disabled={blocked || !history.future.length} onPress={() => setHistory(redoEdit)} />
        {props.target ? <ActionButton icon={Check} accessibilityLabel="Save edited child take" disabled={blocked || !edit.segments.length} onPress={() => void save()} /> : null}
      </View>
      <Text style={text.h3}>Edit recording</Text>
      <TextInput accessibilityLabel="Recording name" style={input} value={edit.metadata.name} editable={!blocked}
        onChangeText={name => change({ ...edit, metadata: { ...edit.metadata, name } })} />
      <Text style={text.small}>{(duration / 1000).toFixed(1)} seconds. Audio edits clear verse times; add milestones after editing.</Text>
      {edit.segments.map((segment, index) => <Card key={segment.id}>
        <ActionButton icon={Check} variant="outline" label={`Part ${index + 1}${selected.includes(segment.id) ? ' · selected' : ''}`}
          accessibilityLabel={`Select part ${index + 1}`} disabled={blocked} onPress={() => setSelected(ids => ids.includes(segment.id) ? ids.filter(id => id !== segment.id) : [...ids, segment.id])} />
        <AudioClip project={props.project} hashes={[segment.hash]} startSeconds={segment.startMs / 1000} endSeconds={segment.endMs / 1000} disabled={blocked} hideActions />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput key={`start:${segment.startMs}`} style={[input, { flex: 1 }]} accessibilityLabel={`Part ${index + 1} start seconds`} keyboardType="decimal-pad"
            defaultValue={String(segment.startMs / 1000)} editable={!blocked} onEndEditing={e => {
              const value = Number(e.nativeEvent.text) * 1000;
              if (Number.isFinite(value) && value >= 0 && value < segment.endMs) audioChange(edit.segments.map(s => s.id === segment.id ? { ...s, startMs: value } : s));
              else setError('Start must be before the end of this part.');
            }} />
          <TextInput key={`end:${segment.endMs}`} style={[input, { flex: 1 }]} accessibilityLabel={`Part ${index + 1} end seconds`} keyboardType="decimal-pad"
            defaultValue={String(segment.endMs / 1000)} editable={!blocked} onEndEditing={e => {
              const value = Number(e.nativeEvent.text) * 1000;
              if (Number.isFinite(value) && value > segment.startMs && value <= cardInfo(props.project, segment.hash).durationMs) audioChange(edit.segments.map(s => s.id === segment.id ? { ...s, endMs: value } : s));
              else setError('End must be inside this part and after its start.');
            }} />
          {[[-1, ChevronUp], [1, ChevronDown]].map(([delta, Icon]) => <ActionButton key={String(delta)} icon={Icon as typeof ChevronUp} variant="outline"
            accessibilityLabel={`Move part ${index + 1} ${delta === -1 ? 'up' : 'down'}`} disabled={blocked || index + Number(delta) < 0 || index + Number(delta) >= edit.segments.length}
            onPress={() => { const next = [...edit.segments]; next.splice(index, 1); next.splice(index + Number(delta), 0, segment); audioChange(next); }} />)}
        </View>
      </Card>)}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <ActionButton icon={Trash2} variant="outline" accessibilityLabel="Delete selected parts" disabled={blocked || !selected.length}
          onPress={() => audioChange(edit.segments.filter(s => !selected.includes(s.id)))} />
        {props.target ? <ActionButton variant="outline" label="Merge" accessibilityLabel="Merge selected adjacent parts" disabled={blocked || selected.length < 2} onPress={() => void merge()} /> : null}
        <ActionButton variant="outline" label={mode === 'insert' ? 'Insert after' : 'Replace selected'} accessibilityLabel="Toggle insert or replace" disabled={blocked}
          onPress={() => setMode(mode === 'insert' ? 'replace' : 'insert')} />
        {props.target ? <ActionButton icon={rec.manualOn ? Square : Mic} variant="outline" accessibilityLabel={rec.manualOn ? 'Stop recording new part' : 'Record new part'}
          disabled={busy || rec.busy || (mode === 'replace' && !selected.length)} onPress={() => void (rec.manualOn ? rec.manualUp() : rec.manualDown())} /> : null}
      </View>
      {props.target ? <>
        <Text style={text.h3}>Insert or replace from recordings</Text>
        {library.map((card, index) => <ActionButton key={card.hash} icon={Plus} variant="outline" label={`Recording ${index + 1} · ${(card.durationMs / 1000).toFixed(1)}s`}
          accessibilityLabel={`Use recording ${index + 1}`} disabled={blocked || (mode === 'replace' && !selected.length)} onPress={() => insert({ id: Crypto.randomUUID(), hash: card.hash, startMs: 0, endMs: card.durationMs })} />)}
      </> : null}
      <Text style={text.h3}>Verse milestones</Text>
      {edit.metadata.milestones.map((m, index) => <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[text.body, { flex: 1 }]}>Verse {m.verseStart}–{m.verseEnd}: {m.startMs / 1000}s{m.endMs === undefined ? '' : `–${m.endMs / 1000}s`}</Text>
        <ActionButton icon={Trash2} variant="outline" accessibilityLabel={`Delete milestone ${index + 1}`} disabled={blocked}
          onPress={() => change({ ...edit, metadata: { ...edit.metadata, milestones: edit.metadata.milestones.filter((_, i) => i !== index) } })} />
      </View>)}
      {([['First verse', verseStart, setVerseStart], ['Last verse', verseEnd, setVerseEnd], ['Start seconds', start, setStart], ['End seconds (optional)', end, setEnd]] as const).map(([label, value, setter]) =>
        <TextInput key={label} placeholder={label} accessibilityLabel={label} style={input} value={value} onChangeText={setter} keyboardType="decimal-pad" editable={!blocked} />)}
      <ActionButton icon={Plus} variant="outline" accessibilityLabel="Add verse milestone or range" disabled={blocked} onPress={() => {
        const metadata: TakeMetadata = { ...edit.metadata, milestones: [...edit.metadata.milestones,
          { verseStart: Number(verseStart), verseEnd: Number(verseEnd), startMs: Number(start) * 1000, ...(end.trim() ? { endMs: Number(end) * 1000 } : {}) }
        ].sort((a, b) => a.startMs - b.startMs) };
        if (!validTakeMetadata(metadata, duration)) setError('Enter positive verse numbers and times inside the recording.');
        else { change({ ...edit, metadata }); setError(''); }
      }} />
      {error || rec.error ? <Text style={text.muted} accessibilityRole="alert">{error || rec.error}</Text> : null}
      {rec.failureCount ? <ActionButton icon={RotateCcw} variant="outline" accessibilityLabel="Retry saving new part" onPress={() => void rec.retryFailed()} /> : null}
      {!props.target ? <Text style={text.small}>Open this passage’s recording screen to save a new edited take.</Text> : null}
    </ScrollView>
  </Modal>;
}
