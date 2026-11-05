// A report's voice note as the server takes it, on the web: a browser
// records at its own rate (often 48 kHz), so its WAV is written again at
// 16 kHz mono, a third of the size and still clear speech (voiceBytes.ts).
import { encodeWav } from '../../modules/microphone-energy/src/vadCore';
import { getBlobStore } from '../sync/blobs';
import { noteExpected } from '../diagnostics/report';
import type { VoiceRef } from './feedbackModel';

const RATE = 16_000;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function resampled(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(bytes.slice().buffer);
    if (audio.sampleRate <= RATE && audio.numberOfChannels === 1) return bytes;
    const offline = new OfflineAudioContext(1, Math.ceil(audio.duration * RATE), RATE);
    const source = offline.createBufferSource();
    source.buffer = audio;
    source.connect(offline.destination);
    source.start();
    const out = await offline.startRendering();
    const mono = out.getChannelData(0);
    const pcm = new Int16Array(mono.length);
    for (let i = 0; i < mono.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(mono[i]! * 32767)));
    return encodeWav(pcm, RATE);
  } finally {
    void context.close();
  }
}

export async function voiceForServer(voice: VoiceRef): Promise<{ base64: string; format: VoiceRef['format'] } | null> {
  try {
    const bytes = await (await getBlobStore()).readBytes({ hash: voice.hash, format: voice.format });
    if (!bytes) return null;
    return { base64: toBase64(voice.format === 'wav' ? await resampled(bytes) : bytes), format: voice.format };
  } catch (e) {
    noteExpected('feedback: read voice', e);
    return null;
  }
}

export async function dropVoice(voice: VoiceRef): Promise<void> {
  try { (await getBlobStore()).remove([{ hash: voice.hash, format: voice.format }]); } catch (e) { noteExpected('feedback: drop voice', e); }
}
