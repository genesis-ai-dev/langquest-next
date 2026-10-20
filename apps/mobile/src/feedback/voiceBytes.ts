// A report's voice note as the server takes it (decisions.md 143): the
// phone's AAC file from its file store, as base64. The web resamples its WAV
// first (voiceBytes.web.ts).
import { getBlobStore } from '../sync/blobs';
import { noteExpected } from '../diagnostics/report';
import type { VoiceRef } from './feedbackModel';

export async function voiceForServer(voice: VoiceRef): Promise<{ base64: string; format: VoiceRef['format'] } | null> {
  try {
    const file = (await getBlobStore()).fileFor({ hash: voice.hash, format: voice.format });
    return file.exists ? { base64: await file.base64(), format: voice.format } : null;
  } catch (e) {
    // The report still goes, with its words, rather than not at all.
    noteExpected('feedback: read voice', e);
    return null;
  }
}

/** Once it has gone, the recording leaves the phone too. */
export async function dropVoice(voice: VoiceRef): Promise<void> {
  try { (await getBlobStore()).remove([{ hash: voice.hash, format: voice.format }]); } catch (e) { noteExpected('feedback: drop voice', e); }
}
