#!/usr/bin/env node
// The words on an ops dashboard card (docs/card-words.md,
// docs/decisions/2026-11-24-every-dashboard-card-follows-one-word-standard.md).
// Plain Node, no packages and no imports but Node's own, so a workflow can copy this file next
// to its script and run it before `npm ci`.
//
//   node scripts/card-words.mjs <file.json> [field ...]
//       Reads the JSON file, finds each string under one of the fields (by default
//       CARD_FIELDS), and prints each line that breaks the standard, with where it
//       is. Exits 1 when one does. Claude runs it on what it wrote for a card, and
//       mends its words until it passes.
//
// The dashboard, the scripts that check what Claude wrote, and the tests import
// the same rules from here, so a card's text is checked in one way everywhere.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The most words in one sentence, and in the main text of one card line. */
export const LIMITS = { sentence: 25, line: 70 };

/**
 * Words a person who does not write code does not know. A card names the thing by what it does instead
 * ("the key that lets Claude read the database", not "the OIDC token"). Matched as whole words, any case.
 */
export const JARGON = ['oidc', 'sql', 'rpc', 'regex', 'payload', 'json', 'yaml', 'cron', 'endpoint', 'stdout', 'stderr', 'null', 'undefined',
  'boolean', 'enum', 'async', 'webhook', 'repo', 'typecheck', 'lint', 'schema', 'hyperdrive', 'tuple', 'tuples', 'autovacuum', 'dotenvx',
  'wrangler', 'token', 'patch', 'diff', 'stack trace', 'env var', 'refactor', 'mutex', 'fixture', 'regexp', 'stub', 'mock'];

/** The fields of what Claude writes that a person reads on a card, which the command line checks by default. */
export const CARD_FIELDS = ['title', 'context', 'problem', 'known', 'solution', 'plain', 'answer', 'caption'];

/** Words that are the names of things and look like code: allowed. */
const NAMES = /^(iPhone|iPad|iOS|iPadOS|macOS|eSIM|YouTube|LangQuest|GitHub|TestFlight|WhatsApp|PowerPoint|JavaScript|OpenAI)$/;

/** The sentences of a text: split after . ! ? and at line ends. */
export function sentencesOf(text) {
  return String(text ?? '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => /[A-Za-z0-9]/.test(s));
}
const wordsOf = (s) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));

/**
 * What in a text breaks the standard, each as a line that says what to do instead. Empty when the text keeps it.
 * `max`: the most words in the whole text (LIMITS.line by default; a title has fewer).
 */
export function cardWordProblems(text, { max = LIMITS.line } = {}) {
  const t = String(text ?? '').trim();
  if (!t) return [];
  const out = [];
  const found = (re) => { const m = re.exec(t); return m ? m[0].trim() : null; };
  const path = found(/(?:[\w.-]+\/){2,}[\w.-]+|\b[\w.-]+\/[\w-]+\.[a-z]{1,4}\b|\b[\w-]+\.(?:tsx?|mjs|cjs|jsx?|json|sql|ya?ml|sh|md|toml|lock)\b/);
  if (path) out.push(`Names a file ("${path}"). Say what the thing does for a person; put the file under Details.`);
  if (/`/.test(t)) out.push('Has code marks (`). Write plain words; put code under Details.');
  const code = t.match(/\b[A-Za-z]+_[A-Za-z0-9_]+\b|\b[a-z]+[A-Z][A-Za-z0-9]*\b|\b\w+\(\)/g)?.find((w) => !NAMES.test(w));
  if (code) out.push(`Has a code word ("${code}"). Name the thing by what it does.`);
  const jargon = JARGON.find((w) => new RegExp(`\\b${w}\\b`, 'i').test(t));
  if (jargon) out.push(`Uses "${jargon}", which only developers know. Say what it does in common words.`);
  const id = found(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*[0-9])[0-9a-f]{7,40}\b/);
  if (id) out.push(`Has an id or a commit ("${id}"). Put it under Details.`);
  const minute = found(/(?:^|[\s(]):[0-5]\d\b/);
  if (minute) out.push(`Says a time as minutes only ("${minute}"). Say when in words ("within 30 minutes", "at 10:00 UTC").`);
  const passive = found(/\b(?:is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?\w+(?:ed|en|wn|lt|ne|ng)\s+by\b/i);
  if (passive) out.push(`Uses the passive voice ("${passive}"). Say who does the action first ("The filming draws the light").`);
  const first = /^(it|this|that|these|those|they)\b/i.exec(t);
  if (first) out.push(`Starts with "${first[1]}". Start with the name of the thing, so a person who reads only this line knows what it is about.`);
  for (const [n, s] of sentencesOf(t).entries()) {
    const w = wordsOf(s).length;
    if (w > LIMITS.sentence) out.push(`Sentence ${n + 1} has ${w} words. Use ${LIMITS.sentence} or fewer: one fact in each sentence.`);
  }
  const all = wordsOf(t).length;
  if (all > max) out.push(`Has ${all} words. Use ${max} or fewer here; put the rest under Details.`);
  return out;
}

/** Whether a text keeps the standard. */
export const plainEnough = (text, opts) => cardWordProblems(text, opts).length === 0;

/**
 * Why Claude stopped before it made a change, as a person reads it on a card: a short label, what happened in
 * plain words, what the person can do, and the one action the card recommends (its main button):
 * `tell` (tell Claude what to do), `retry` (Try again) or `app` (Fix it in the app).
 * A card that says Claude could not act always says one of these, never only "Claude could not make the change"
 * (Caleb Koster, 2026-11-24).
 */
export const WHY_STOPPED = {
  needsChoice: { label: 'A person must choose', says: 'There is more than one good way to make this change. Claude does not choose for you.',
    youCan: 'Tell Claude which way to take.', act: 'tell' },
  needsApp: { label: 'The cause is in the app', says: 'The problem comes from the app, not from the video. A video change can change only the steps and the words of a video.',
    youCan: 'Press "Fix it in the app". Claude then changes the app and films the video again.', act: 'app' },
  needsSetup: { label: 'The video needs new test data', says: 'The change needs new test data or a new tool for the filming. A video change cannot add those.',
    youCan: 'Ask Claude in a project thread to add what the video needs. Then press "Try again".', act: 'retry' },
  notSeen: { label: 'Claude did not see the problem', says: 'Claude looked at the newest film and did not see the problem.',
    youCan: 'Watch the film. Then tell Claude the time where you see the problem.', act: 'tell' },
  unclear: { label: 'Claude did not understand the request', says: 'Claude did not understand what to change.',
    youCan: 'Tell Claude again in other words. Say what a viewer must see.', act: 'tell' },
  checksFailed: { label: 'The tests failed', says: 'Claude made the change, but the tests on the change failed. Claude closed the change.',
    youCan: 'Press "Try again". Claude then writes the change again.', act: 'retry' },
  tooSlow: { label: 'The change did not merge in time', says: 'Claude made the change, but the change did not merge within a day. Claude closed the change.',
    youCan: 'Press "Try again".', act: 'retry' },
  safety: { label: 'A safety check stopped it', says: 'Claude made the change, but a safety check stopped the change before the merge.',
    youCan: 'Read Details. Then press "Try again", or tell Claude what to do instead.', act: 'retry' },
  noAccess: { label: 'Claude did not have access', says: 'Claude made the change, but GitHub did not let Claude open the pull request. A key or a permission is missing.',
    youCan: 'Ask Claude in a project thread to repair the access. Then press "Try again".', act: 'retry' },
  broke: { label: 'The job stopped with an error', says: 'The job that writes the change stopped with an error before the end.',
    youCan: 'Press "Try again". If it stops again, ask Claude in a project thread to look at the job.', act: 'retry' },
  unknown: { label: 'No reason recorded', says: 'Claude did not record why it stopped. Its last note is under Details.',
    youCan: 'Read Details. Then press "Try again", or tell Claude what to do instead.', act: 'retry' }
};
/** The reasons Claude itself may give for no change (fix.json `why`); the rest come from the workflow. */
export const CLAUDE_WHY = ['needsChoice', 'needsApp', 'needsSetup', 'notSeen', 'unclear'];

/**
 * A fix's note as the database keeps it (one text, at most 1000 characters): the reason, Claude's plain words for
 * the card, then the technical part for Details. `why=<reason>` on the first line marks the new form.
 */
export function fixNote(why, plain, technical) {
  const p = String(plain ?? '').trim(), x = String(technical ?? '').trim();
  return `why=${why in WHY_STOPPED ? why : 'unknown'}\n${p}\n\n${x}`.slice(0, 1000).trim();
}

/**
 * A fix's note in its parts. A note written before the new form has no reason and no plain words: its reason is
 * read from its words (`whyOfNote`), and all of it goes under Details.
 */
export function fixNoteParts(note, app = false) {
  const t = String(note ?? '').trim();
  const m = /^why=(\w+)\n([^\n]*)\n?\n?([\s\S]*)$/.exec(t);
  if (m && m[1] in WHY_STOPPED) return { why: m[1], plain: m[2].trim(), technical: m[3].trim() };
  return { why: whyOfNote(t, app), plain: '', technical: t };
}

/** The reason in a note written before the reason was kept: what its words say, else `unknown`. */
export function whyOfNote(note, app = false) {
  const t = String(note ?? '');
  if (app) return 'needsApp';
  if (/checks? failed/i.test(t)) return 'checksFailed';
  if (/did not merge within/i.test(t)) return 'tooSlow';
  if (/second check stopped|refused the fix|disguise/i.test(t)) return 'safety';
  if (/GitHub did not let|No token|permission|not allowed/i.test(t)) return 'noAccess';
  if (/wrote no fix\.json|is not JSON|job that writes it failed|patch is missing|changed no file|wrote no summary|branch \S+ is there already/i.test(t)) return 'broke';
  if (/person must (decide|choose)|a person's choice|decide whether|needs a person|a person makes/i.test(t)) return 'needsChoice';
  if (/new setup|fixture|seeded|test data/i.test(t)) return 'needsSetup';
  if (/could not (see|find|reproduce)|did not see|no problem (was )?found/i.test(t)) return 'notSeen';
  if (/not clear|unclear|did not understand/i.test(t)) return 'unclear';
  return 'unknown';
}

/** Every string in a JSON value under one of the fields, with its place ("file[0].problem"). */
export function cardTexts(value, fields = CARD_FIELDS, at = '') {
  if (Array.isArray(value)) return value.flatMap((v, i) => cardTexts(v, fields, `${at}[${i}]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => {
    const where = at ? `${at}.${k}` : k;
    if (typeof v === 'string' && fields.includes(k)) return [{ where, text: v, max: k === 'title' ? 20 : LIMITS.line }];
    return cardTexts(v, fields, where);
  });
}

/** The problems in a JSON value's card texts, each as one line: where, then what to do. */
export function fileProblems(value, fields = CARD_FIELDS) {
  return cardTexts(value, fields).flatMap(({ where, text, max }) => cardWordProblems(text, { max }).map((p) => `${where}: ${p}`));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [file, ...fields] = process.argv.slice(2);
  if (!file) {
    console.error('usage: node scripts/card-words.mjs <file.json> [field ...]');
    process.exit(2);
  }
  let problems;
  try {
    problems = fileProblems(JSON.parse(readFileSync(file, 'utf8')), fields.length ? fields : CARD_FIELDS);
  } catch (e) {
    console.error(`${file} could not be read: ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }
  for (const p of problems) console.log(p);
  console.log(problems.length ? `${problems.length} line${problems.length === 1 ? '' : 's'} to mend (docs/card-words.md)` : 'the words keep the standard');
  process.exit(problems.length ? 1 : 0);
}
