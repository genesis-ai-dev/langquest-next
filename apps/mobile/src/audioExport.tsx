// Avatar U. Complete audio files use the native Android/iOS share sheet.
import { currentTake, deriveObt, deriveTakeStatus, isObtLane } from '@langquest-next/core';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Crypto from 'expo-crypto';
import { Share2 } from 'lucide-react-native';
import { useState } from 'react';
import { Text, View } from 'react-native';
import MicrophoneEnergy from '../modules/microphone-energy';
import type { ProjectHandle } from './useProject';
import { ActionButton, text } from './ui';

export function cardInfo(project: ProjectHandle, hash: string) {
  for (const r of Object.values(project.state?.recordings ?? {})) {
    const card = r.cards.find(c => c.hash === hash);
    if (card) return { ...card, format: card.format ?? 'wav' as const };
  }
  for (const r of Object.values(project.state?.obt.audio ?? {})) {
    const card = r.value.cards.find(c => c.hash === hash);
    if (card) return { ...card, format: card.format ?? 'm4a' as const };
  }
  throw new Error('This audio is not available in the project.');
}

export async function renderAudio(project: ProjectHandle,
  clips: { hash: string; startMs?: number; endMs?: number }[], name = 'recording') {
  if (!clips.length) throw new Error('Choose audio to export.');
  const sources = clips.map(clip => {
    const card = cardInfo(project, clip.hash);
    const uri = project.blobs.uriFor(card);
    if (!uri) throw new Error('Download all audio before editing or sharing.');
    return { uri, startMs: clip.startMs ?? 0, endMs: clip.endMs ?? card.durationMs };
  });
  const safeName = name.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 70) || 'recording';
  const directory = new Directory(Paths.cache, 'audio-exports');
  directory.create({ intermediates: true, idempotent: true });
  // Android recipients can read the granted URI after the chooser closes.
  // Keep recent exports and reclaim abandoned files on the next export.
  for (const entry of directory.list()) {
    if (entry instanceof File && (entry.modificationTime ?? Date.now()) < Date.now() - 86400000) {
      try { entry.delete(); } catch { /* A recipient may still hold the file. */ }
    }
  }
  const file = new File(directory, `${safeName}-${Crypto.randomUUID()}.wav`);
  try { await MicrophoneEnergy.renderAudio(sources, file.uri); return file; }
  catch (error) { if (file.exists) file.delete(); throw error; }
}

export async function shareAudio(project: ProjectHandle, hashes: string[], name: string) {
  if (!await Sharing.isAvailableAsync()) throw new Error('File sharing is unavailable on this device.');
  const file = await renderAudio(project, hashes.map(hash => ({ hash })), name);
  await Sharing.shareAsync(file.uri, { mimeType: 'audio/wav', UTI: 'com.microsoft.waveform-audio', dialogTitle: name });
}

export function ShareAudioButton(props: { project: ProjectHandle; hashes: string[]; name?: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <View style={{ gap: 4 }}>
    <ActionButton icon={Share2} variant="outline" accessibilityLabel="Share complete audio file"
      disabled={props.disabled || busy || !props.hashes.length} onPress={() => {
        setBusy(true); setError('');
        void shareAudio(props.project, props.hashes, props.name ?? 'Recording')
          .catch(e => setError((e as Error).message)).finally(() => setBusy(false));
      }} />
    {busy ? <Text style={text.small}>Preparing audio…</Text> : null}
    {error ? <Text accessibilityRole="alert" style={text.muted}>{error}</Text> : null}
  </View>;
}

/** Ordered descendants; only approved final takes leave a delivery collection. */
export function collectionAudio(project: ProjectHandle, unitId: string, laneId: string): string[] {
  const state = project.state;
  if (!state) return [];
  const seen = new Set<string>();
  const hashes: string[] = [];
  function visit(id: string) {
    if (seen.has(id)) return;
    seen.add(id);
    const children = Object.entries(state!.units).filter(([, u]) => u.parentUnitId === id)
      .sort(([a, x], [b, y]) => x.order.localeCompare(y.order) || a.localeCompare(b));
    if (children.length) { children.forEach(([child]) => visit(child)); return; }
    const obt = isObtLane(state!, laneId) ? deriveObt(state!, id, laneId) : null;
    const takeId = obt ? (obt.stage === 'complete' ? obt.finalTakeId : null) : currentTake(state!, id, laneId);
    if (takeId && (obt || deriveTakeStatus(state!, takeId).outcome === 'approved')) {
      hashes.push(...(state!.takes[takeId]?.cardHashes ?? []));
    }
  }
  visit(unitId);
  return hashes;
}
