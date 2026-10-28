#!/usr/bin/env node
// Says tutorial lines with Gemini's text-to-speech and writes each as a WAV
// file: the TUTORIAL_TTS command for film.ts.
//
//   TUTORIAL_TTS="node e2e/tutorials/gemini-voice.mjs" npx tsx e2e/tutorials/film.ts <tutorial>
//   node e2e/tutorials/gemini-voice.mjs out.wav "Tap the red button and speak." [out2.wav "Then tap it again." ...]
//
// GEMINI_API_KEY is sent when it is set; without it the request goes out bare,
// for an environment whose network adds the key on its way out. The voice and
// how it sounds are the same in every language: the model hears the language
// from the words.
//
// The lines go to Gemini's Batch API, one request each in one job, and the
// job is waited for (a few minutes): a project may make only 100 speech
// requests a day on Tier 1, and the 47 videos have over 400 lines, while a
// batch job's requests are not counted against that and cost half as much.
// A batch request has no place for a delivery style ("unhurried", which the
// Interactions API takes), so the voice speaks at its own pace, a little
// quicker; words put before the line to ask for one are read aloud.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const MODEL = process.env.TUTORIAL_TTS_MODEL ?? 'gemini-3.8-flash-tts';
const VOICE = process.env.TUTORIAL_TTS_VOICE ?? 'Sulafat';
const API = 'https://generativelanguage.googleapis.com/v1beta';

const args = process.argv.slice(2);
const lines = [];
for (let i = 0; i < args.length; i += 2) lines.push({ file: args[i], words: (args[i + 1] ?? '').trim() });
if (!lines.length || lines.some((l) => !l.file || !l.words)) {
  console.error('usage: node e2e/tutorials/gemini-voice.mjs <out.wav> <words> [<out.wav> <words> ...]');
  process.exit(2);
}

const headers = { 'content-type': 'application/json' };
if (process.env.GEMINI_API_KEY) headers['x-goog-api-key'] = process.env.GEMINI_API_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The JSON reply to a request, tried again while Gemini is busy. */
async function call(url, init) {
  let lastError = '';
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(url, { headers, ...init });
    if (res.ok) return res.json();
    lastError = `${res.status} ${(await res.text()).slice(0, 300)}`;
    if (res.status !== 429 && res.status < 500) break;
    await sleep(2000 * 2 ** attempt);
  }
  throw new Error(lastError);
}

/** 16-bit mono PCM in a WAV file, for a reply that comes as bare samples. */
function wavOf(pcm, rate) {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

try {
  const requests = lines.map((line, i) => ({
    request: {
      contents: [{ parts: [{ text: line.words }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } }
    },
    metadata: { key: String(i) }
  }));
  let job = await call(`${API}/models/${MODEL}:batchGenerateContent`, {
    method: 'POST',
    body: JSON.stringify({ batch: { display_name: `tutorial lines (${lines.length})`, input_config: { requests: { requests } } } })
  });
  const name = job.name;
  for (const until = Date.now() + 3 * 3600_000; ; ) {
    const state = (job.metadata ?? job).state;
    if (state === 'BATCH_STATE_SUCCEEDED') break;
    if (state !== 'BATCH_STATE_PENDING' && state !== 'BATCH_STATE_RUNNING') throw new Error(`Gemini's batch ${name} ended ${state}`);
    if (Date.now() > until) throw new Error(`Gemini's batch ${name} is still ${state} after 3 hours`);
    await sleep(15_000);
    job = await call(`${API}/${name}`);
  }
  const replies = (job.response ?? job.metadata?.output)?.inlinedResponses?.inlinedResponses ?? [];
  for (const reply of replies) {
    const line = lines[Number(reply.metadata?.key)];
    if (!line) continue;
    const audio = reply.response?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
    if (!audio?.data) { line.error = JSON.stringify(reply.error ?? reply.response?.candidates?.[0]?.finishReason ?? 'no audio'); continue; }
    const bytes = Buffer.from(audio.data, 'base64');
    const rate = Number(/rate=(\d+)/.exec(audio.mimeType)?.[1] ?? 24000);
    mkdirSync(path.dirname(line.file), { recursive: true });
    writeFileSync(line.file, bytes.toString('ascii', 0, 4) === 'RIFF' ? bytes : wavOf(bytes, rate));
    line.said = true;
  }
  const unsaid = lines.filter((l) => !l.said);
  if (unsaid.length) throw new Error(`Gemini could not say ${unsaid.map((l) => `"${l.words}" (${l.error ?? 'no reply'})`).join(', ')}`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
