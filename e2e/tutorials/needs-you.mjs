#!/usr/bin/env node
// What only a person can fix (Gemini's prepaid credit used up, its key
// refused), said where the ops dashboard reads it: its Needs attention list
// (apps/admin/src/sources/github.ts, docs/admin.md). The scripts write each
// into e2e/results/tutorials/needs-you.jsonl as it happens; the workflow's
// last step says each once as a GitHub annotation titled "Needs you: ...",
// and the dashboard reads those from the latest failed run of each workflow
// on main. The next run that works takes the line away.
//
//   node e2e/tutorials/needs-you.mjs     the annotations, once each
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const NEEDS_YOU_FILE = process.env.TUTORIAL_NEEDS_YOU ?? path.join('e2e', 'results', 'tutorials', 'needs-you.jsonl');

/** Writes down a problem only a person can fix: its name, what to do, and the page to do it on. */
export function needsYou(problem) {
  mkdirSync(path.dirname(NEEDS_YOU_FILE), { recursive: true });
  appendFileSync(NEEDS_YOU_FILE, `${JSON.stringify(problem)}\n`);
}

/**
 * What Gemini's refusal needs a person for, from its status and body, or null
 * for one that waiting or trying again may get past (busy, a day's limit).
 * 402 "Your prepayment credits are depleted" stopped the first full filming
 * on 2026-10-29; a request without a key gets 403 "unregistered callers".
 */
export function geminiNeedsYou(status, body) {
  if (status === 402 || /prepayment credits are depleted/i.test(body)) {
    return { title: 'Gemini credit', text: "Google refused the tutorial videos' voice: the prepaid credit of the Gemini project behind GEMINI_API_KEY is used up. Add credit to that project (AI Studio, the project, Billing, Buy credits), or turn on auto-reload.", link: 'https://aistudio.google.com/projects' };
  }
  if (/API_KEY_INVALID|API key not valid|API key expired|unregistered callers/i.test(body) || status === 401) {
    return { title: 'Gemini key', text: 'Google refused GEMINI_API_KEY, or the workflow has none. Make a key in AI Studio, then npm run env:update -- production GEMINI_API_KEY and npm run secrets -- production.', link: 'https://aistudio.google.com/apikey' };
  }
  return null;
}

/** A GitHub workflow command's property and message, escaped as the runner reads them. */
const escapeData = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (s) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

/** The annotation for each problem written down, once each: its link last, where the dashboard finds it. */
export function annotations(lines) {
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const p = JSON.parse(line);
    if (seen.has(p.title)) continue;
    seen.add(p.title);
    out.push(`::error title=${escapeProperty(`Needs you: ${p.title}`)}::${escapeData(`${p.text} ${p.link}`)}`);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const lines = existsSync(NEEDS_YOU_FILE) ? readFileSync(NEEDS_YOU_FILE, 'utf8').split('\n').filter(Boolean) : [];
  for (const a of annotations(lines)) console.log(a);
}
