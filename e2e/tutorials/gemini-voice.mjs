#!/usr/bin/env node
// Says one tutorial line with Gemini's text-to-speech and writes it as a WAV
// file: the TUTORIAL_TTS command for film.ts.
//
//   TUTORIAL_TTS="node e2e/tutorials/gemini-voice.mjs" npx tsx e2e/tutorials/film.ts <tutorial>
//   node e2e/tutorials/gemini-voice.mjs out.wav "Tap the red button and speak."
//
// GEMINI_API_KEY is sent when it is set; without it the request goes out bare,
// for an environment whose network adds the key on its way out. The voice and
// how it sounds are the same in every language: the model hears the language
// from the words.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const MODEL = process.env.TUTORIAL_TTS_MODEL ?? 'gemini-3.8-flash-tts';
const VOICE = process.env.TUTORIAL_TTS_VOICE ?? 'Sulafat';
const STYLE = 'a warm, friendly, unhurried teacher showing a friend how to use an app';

const [file, ...rest] = process.argv.slice(2);
const words = rest.join(' ').trim();
if (!file || !words) {
  console.error('usage: node e2e/tutorials/gemini-voice.mjs <out.wav> <words>');
  process.exit(2);
}

const headers = { 'content-type': 'application/json' };
if (process.env.GEMINI_API_KEY) headers['x-goog-api-key'] = process.env.GEMINI_API_KEY;
const body = {
  model: MODEL,
  input: [{ type: 'user_input', content: [{ type: 'text', text: words, annotations: [{ type: 'speech_metadata', style: STYLE }] }] }],
  response_format: { type: 'audio' },
  generation_config: { speech_config: [{ voice: VOICE }] }
};

let lastError = '';
for (let attempt = 1; attempt <= 5; attempt++) {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', { method: 'POST', headers, body: JSON.stringify(body) });
  if (res.ok) {
    const reply = await res.json();
    const audio = (reply.steps ?? [])
      .filter((s) => s.type === 'model_output')
      .flatMap((s) => s.content ?? [])
      .filter((c) => c.type === 'audio')
      .at(-1);
    if (!audio?.data) throw new Error(`Gemini returned no audio for "${words}"`);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(audio.data, 'base64'));
    process.exit(0);
  }
  lastError = `${res.status} ${(await res.text()).slice(0, 300)}`;
  if (res.status !== 429 && res.status < 500) break;
  await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
}
console.error(`Gemini could not say "${words}": ${lastError}`);
process.exit(1);
