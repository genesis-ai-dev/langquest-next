#!/usr/bin/env node
// Adds up what Gemini and Claude counted in a job (gemini-voice.mjs and
// translate-lines.ts write a line of JSON for each Gemini batch job,
// frame-check.ts one for each film Claude looked at), as Markdown for the
// job's summary, with what Gemini bills for it at the list price, to set
// against the bill in AI Studio. Claude's looks are on the Claude plan, not
// billed; the price beside them is what they would cost on the API.
//
//   node e2e/tutorials/gemini-usage.mjs [<gemini-usage.jsonl>] | tee -a "$GITHUB_STEP_SUMMARY"
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * US$ a million tokens in a batch, in and out (thinking is billed as out), from
 * ai.google.dev/gemini-api/docs/pricing on 2026-11-01. The 3.8 models' prices
 * double on 2027-01-01.
 */
const BATCH = {
  'gemini-3.8-flash-tts': { in: 0.25, out: 4.5, doubles: '2027-01-01' },
  'gemini-flash-latest': { in: 0.375, out: 1.875, doubles: '2027-01-01' },
  'gemini-pro-latest': { in: 1, out: 6 }
};

/** What Gemini bills for a model's batch jobs, or null for a model without a price here. */
export function geminiDollars(model, m, now = new Date()) {
  const price = BATCH[model];
  if (!price) return null;
  const times = price.doubles && now >= new Date(price.doubles) ? 2 : 1;
  return ((m.in * price.in + (m.out + m.thinking) * price.out) * times) / 1e6;
}

/** The summary's lines for a job's usage lines. */
export function summary(jobs, now = new Date()) {
  const byModel = new Map();
  for (const job of jobs) {
    const m = byModel.get(job.model) ?? { plan: Boolean(job.plan), jobs: 0, requests: 0, in: 0, out: 0, thinking: 0, usd: 0 };
    m.jobs++;
    for (const k of ['requests', 'in', 'out', 'thinking', 'usd']) m[k] += job[k] ?? 0;
    byModel.set(job.model, m);
  }
  const n = (x) => x.toLocaleString('en-US');
  const usd = (x) => `US$${x < 10 ? x.toFixed(2) : x.toFixed(0)}`;
  const lines = ['### What Gemini and Claude counted', ''];
  if (!byModel.size) lines.push('Nothing was sent to Gemini or Claude.');
  let bill = 0;
  let unpriced = false;
  for (const [model, m] of byModel) {
    const tokens = `${n(m.in)} tokens in, ${n(m.out)} out`;
    if (m.plan) {
      // Claude counts its thinking in what it sends back.
      lines.push(`- ${model} (the frame check, on the Claude plan, not billed): ${n(m.requests)} films; ${tokens} (${n(m.thinking)} of them thinking); ${usd(m.usd)} at the API's list price`);
      continue;
    }
    // A voice's answer is audio, 25 tokens a second.
    const speech = /tts/.test(model) ? ` (about ${(m.out / 25 / 60).toFixed(1)} minutes of speech)` : '';
    const dollars = geminiDollars(model, m, now);
    if (dollars === null) unpriced = true;
    else bill += dollars;
    lines.push(`- ${model}: ${n(m.requests)} requests in ${n(m.jobs)} batch jobs; ${tokens}${speech}, ${n(m.thinking)} thinking${dollars === null ? '' : `: about ${usd(dollars)}`}`);
  }
  if ([...byModel.values()].some((m) => !m.plan)) lines.push('', `Gemini bills about ${usd(bill)} for this job, at its batch list price${unpriced ? ', not counting the models without a price in gemini-usage.mjs' : ''}.`);
  return lines;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const file = process.argv[2] ?? process.env.TUTORIAL_GEMINI_USAGE ?? path.join('e2e', 'results', 'tutorials', 'gemini-usage.jsonl');
  const jobs = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  console.log(summary(jobs).join('\n'));
}
