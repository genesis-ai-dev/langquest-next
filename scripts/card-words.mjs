#!/usr/bin/env node
// The words on an ops dashboard card (docs/card-words.md,
// docs/decisions/2026-11-24-every-dashboard-card-follows-one-word-standard.md).
// Plain Node, no packages and no imports but Node's own, so a workflow can copy this file next
// to its script and run it before `npm ci`.
//
//   node scripts/card-words.mjs --naive <file.json>
//       Prints the prompt for a naive reader of each issue's card in the file (fix.json `card`, decisions.json's or
//       cards.json's): Claude gives each to a new worker, and mends each line the worker got wrong
//       (docs/card-words.md, "A naive reader").
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
export const CARD_FIELDS = ['title', 'context', 'problem', 'known', 'solution', 'plain', 'answer', 'caption', 'about', 'happened', 'ask', 'then', 'option'];

/**
 * The parts of an issue's card that the issue manager writes in fix.json `card` (docs/card-words.md, "An issue's
 * card"), and the most characters of each. `events`: 2 to 6 { at, until, about, happened, bug } in time order, what
 * happened (Caleb Koster, 2026-11-25: a numbered list of events reads more easily than a paragraph). `options`:
 * 2 to 4 { option, then }, the recommended one first.
 */
export const ISSUE_CARD = { title: 80, about: 300, happened: 200, known: 300, ask: 300, option: 80, then: 200, events: { min: 2, max: 6 }, options: { min: 2, max: 4 } };

/** A time as fix.json gives it: an ISO time in UTC, or '' when the event has none. */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/;

/**
 * An issue's card, checked and cut: { title, about, events, known, ask, options }, or null when it has no about
 * or fewer than 2 events. With no question or fewer than 2 options it has no choice (ask '' and no options): the
 * watch writes such a card before anyone proved the cause. Words only; a person's address is the caller's to take out.
 */
export function issueCardOf(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const line = (v, max) => {
    const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  };
  const time = (v) => (typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v)) ? v : '');
  const events = (Array.isArray(raw.events) ? raw.events : []).slice(0, ISSUE_CARD.events.max)
    .map((e) => ({ at: time(e?.at), until: time(e?.until), about: e?.about === true, happened: line(e?.happened, ISSUE_CARD.happened), bug: e?.bug === true }))
    .filter((e) => e.happened).map((e) => (e.at ? e : { ...e, until: '', about: false }));
  const options = (Array.isArray(raw.options) ? raw.options : []).slice(0, ISSUE_CARD.options.max)
    .map((o) => ({ option: line(o?.option, ISSUE_CARD.option), then: line(o?.then, ISSUE_CARD.then) })).filter((o) => o.option && o.then);
  const card = { title: line(raw.title, ISSUE_CARD.title), about: line(raw.about, ISSUE_CARD.about), events,
    known: line(raw.known, ISSUE_CARD.known), ask: line(raw.ask, ISSUE_CARD.ask), options };
  if (!card.about || events.length < ISSUE_CARD.events.min) return null;
  // A card with no choice yet (the watch's first card, before the cause is proven): no question and no options.
  return card.ask && options.length >= ISSUE_CARD.options.min ? card : { ...card, ask: '', options: [] };
}

/** The one line of context a naive reader gets: no more than a person who never saw the code knows. */
export const NAIVE_CONTEXT = 'LangQuest is a phone app for recording Bible translation.';

/**
 * When an event happened, as a card says it in one time zone: "About 10:05 AM", "10:05 to 11:30 AM"; the day
 * ("Nov 25, ") before the first time of each day. `day` holds the day said last, so a list says it once.
 */
export function eventTime(e, timeZone = 'UTC', day = { last: '' }) {
  if (!e.at) return '';
  const part = (iso, o) => new Date(iso).toLocaleString('en-US', { timeZone, ...o });
  const utc = timeZone === 'UTC';
  const hm = (iso) => part(iso, { hour: 'numeric', minute: '2-digit', hour12: !utc });
  const d = part(e.at, { month: 'short', day: 'numeric' });
  const lead = d !== day.last ? `${d}, ` : '';
  day.last = d;
  let from = hm(e.at);
  const to = e.until ? hm(e.until) : '';
  // "10:05 to 11:30 AM": the AM or PM once when both times have it.
  if (to && !utc && from.slice(-2) === to.slice(-2)) from = from.slice(0, -3);
  const span = (to ? `${from} to ${to}` : from) + (utc ? ' UTC' : '');
  const t = lead + (e.about ? 'about ' : '') + span;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** An issue's card as plain text, in the order the dashboard shows it: what a naive reader reads. */
export function cardText(card, timeZone = 'UTC') {
  const c = issueCardOf(card);
  if (!c) return '';
  const day = { last: '' };
  return [c.title, '', `About: ${c.about}`, 'What happened:',
    ...c.events.map((e, i) => `  ${i + 1}. ${e.at ? eventTime(e, timeZone, day) + '. ' : ''}${e.happened}${e.bug ? ' (This is the bug.)' : ''}`),
    c.known ? `Known: ${c.known}` : '', c.ask ? `Decide: ${c.ask}` : '',
    ...c.options.map((o, i) => `  ${i + 1}. ${o.option}${i === 0 ? ' (recommended)' : ''}: ${o.then}`)].filter((l, i) => l || i === 1).join('\n');
}

/**
 * The prompt for a naive reader (Caleb Koster, 2026-11-25: "assume I am dropping into the card fresh"): a new
 * worker with no tools gets only the card's text and NAIVE_CONTEXT, and says what it understood. The issue manager
 * compares the answer with what it knows, and mends each line the reader got wrong or was not sure of.
 */
export function naivePrompt(card) {
  return [
    'You are a newcomer. Use no tools. Read no files. Answer only from the text below.',
    `You know one thing: "${NAIVE_CONTEXT}"`,
    'An admin of the app sees this card on a web dashboard. It is the whole card.',
    '', '----- CARD -----', cardText(card), '----- END -----', '',
    'Answer in at most 250 words:',
    '1. What is the problem, in your own words? Who has it, and how bad is it? Is any work lost?',
    '2. What is the cause?',
    '3. What must the admin decide? What happens after each option?',
    '4. Each word or sentence that is not clear to you, and why.',
    '5. What you need to know to decide, that the card does not say.',
    '6. From 1 to 5: how sure are you that you can act on the card? (1 = no idea, 5 = fully clear)'
  ].join('\n');
}

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
    if (typeof v === 'string' && fields.includes(k)) return [{ where, text: v, max: k === 'title' ? 20 : k === 'option' ? 12 : k === 'happened' ? 40 : LIMITS.line }];
    return cardTexts(v, fields, where);
  });
}

/** The problems in a JSON value's card texts, each as one line: where, then what to do. */
export function fileProblems(value, fields = CARD_FIELDS) {
  return cardTexts(value, fields).flatMap(({ where, text, max }) => cardWordProblems(text, { max }).map((p) => `${where}: ${p}`));
}

/** Each issue's card in a JSON value (the values under a key `card` that issueCardOf takes), with its place. */
export function cardsIn(value, at = '') {
  if (Array.isArray(value)) return value.flatMap((v, i) => cardsIn(v, `${at}[${i}]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => {
    const where = at ? `${at}.${k}` : k;
    const card = k === 'card' ? issueCardOf(v) : null;
    return card ? [{ where, card }] : cardsIn(v, where);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const naive = process.argv[2] === '--naive';
  const [file, ...fields] = process.argv.slice(naive ? 3 : 2);
  if (!file) {
    console.error('usage: node scripts/card-words.mjs <file.json> [field ...]\n       node scripts/card-words.mjs --naive <file.json>');
    process.exit(2);
  }
  if (naive) {
    // The prompt for a naive reader of each card in the file (each value under a key `card`): give each one, as
    // it is, to a new worker. With more than one card, a line "===== <where> =====" comes before each prompt.
    let cards = [];
    try { cards = cardsIn(JSON.parse(readFileSync(file, 'utf8'))); } catch { /* said below */ }
    if (!cards.length) {
      console.error(`${file} has no card: a card needs about and 2 to 6 events (docs/card-words.md)`);
      process.exit(1);
    }
    for (const { where, card } of cards) console.log(`${cards.length > 1 ? `===== ${where} =====\n` : ''}${naivePrompt(card)}\n`);
    process.exit(0);
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
