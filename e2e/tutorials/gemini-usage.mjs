#!/usr/bin/env node
// Adds up what Gemini counted in a job (gemini-voice.mjs and
// translate-lines.ts write a line of JSON for each batch job), as Markdown
// for the job's summary, to set against the bill in AI Studio.
//
//   node e2e/tutorials/gemini-usage.mjs [<gemini-usage.jsonl>] | tee -a "$GITHUB_STEP_SUMMARY"
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const file = process.argv[2] ?? process.env.TUTORIAL_GEMINI_USAGE ?? path.join('e2e', 'results', 'tutorials', 'gemini-usage.jsonl');
const jobs = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
const byModel = new Map();
for (const job of jobs) {
  const m = byModel.get(job.model) ?? { jobs: 0, requests: 0, in: 0, out: 0, thinking: 0 };
  m.jobs++;
  for (const k of ['requests', 'in', 'out', 'thinking']) m[k] += job[k] ?? 0;
  byModel.set(job.model, m);
}
const n = (x) => x.toLocaleString('en-US');
console.log('### What Gemini counted\n');
if (!byModel.size) console.log('Nothing was sent to Gemini.');
for (const [model, m] of byModel) {
  // A voice's answer is audio, 25 tokens a second.
  const speech = /tts/.test(model) ? ` (about ${(m.out / 25 / 60).toFixed(1)} minutes of speech)` : '';
  console.log(`- ${model}: ${n(m.requests)} requests in ${n(m.jobs)} batch jobs; ${n(m.in)} tokens in, ${n(m.out)} out${speech}, ${n(m.thinking)} thinking`);
}
