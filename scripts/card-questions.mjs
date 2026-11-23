#!/usr/bin/env node
// Questions an admin asks Claude from any card or page of the ops dashboard
// (docs/decisions/2026-11-23-ask-claude-from-every-dashboard-card.md), run by
// .github/workflows/card-questions.yml every 5 minutes:
//
//   node scripts/card-questions.mjs fetch <dir>   the questions that wait, into <dir>/questions.json;
//                                                 tells the Worker the run took them; n=<count> to GITHUB_OUTPUT
//   node scripts/card-questions.mjs web <dir>     the questions whose answer needs public web pages, from
//                                                 <dir>/answers.json into <dir>/web.json; web=1 or 0 to GITHUB_OUTPUT
//   node scripts/card-questions.mjs report <dir>  each answer, checked, to the Worker
//
// The Worker's door (apps/web/worker/cardQuestions.ts) lets in only this
// workflow on main, by the OIDC token GitHub gives the job. Claude writes
// <dir>/answers.json: [{ "id", "answer", "web" }], where web is null or what
// to look up on public web pages. A second Claude, with the web and no shell,
// reads <dir>/web.json (the question and the first answer, never the card's
// words) and writes <dir>/web-answers.json: [{ "id", "answer" }].
//
// What admins asked and what Claude answered never go to this public
// repository's log: the log says only how many.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const API = process.env.CARD_QUESTIONS_URL ?? 'https://next.langquest.org/api/card-questions';
export const AUDIENCE = 'https://next.langquest.org/api/card-questions';
/** As server/cardQuestions.ts QUESTION_MAX.answer. */
export const ANSWER_MAX = 8000;
/** No address may ride along in an answer (server/userIssues.ts EMAIL). */
export const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function oidcToken() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) throw new Error('No GitHub OIDC token here: this runs only in card-questions.yml, with id-token: write.');
  const res = await fetch(`${url}&audience=${encodeURIComponent(AUDIENCE)}`, { headers: { authorization: `bearer ${bearer}` } });
  if (!res.ok) throw new Error(`GitHub OIDC token: HTTP ${res.status}`);
  return (await res.json()).value;
}

async function call(method, body) {
  const res = await fetch(API, {
    method,
    headers: { authorization: `Bearer ${await oidcToken()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const answer = await res.text();
  // The Worker's errors are fixed words; never an admin's.
  if (!res.ok) throw new Error(`${method} ${API}: HTTP ${res.status} ${answer.slice(0, 300)}`);
  return JSON.parse(answer);
}

function output(values) {
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`);
}

const runUrl = () => `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;

const readJson = (path, fallback) => {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
};

/** Claude's answer as the Worker takes it, or null: a string of 1 to ANSWER_MAX characters with no address. */
export function cleanAnswer(v) {
  if (typeof v !== 'string') return null;
  const text = v.trim();
  if (!text || EMAIL.test(text)) return null;
  return text.length > ANSWER_MAX ? text.slice(0, ANSWER_MAX - 1) + '…' : text;
}

/** The questions whose answer needs public web pages, as the web step gets them: never the card's words. */
export function webAsks(questions, answers) {
  const byId = new Map((Array.isArray(answers) ? answers : []).filter((a) => a && typeof a === 'object').map((a) => [a.id, a]));
  return questions.flatMap((q) => {
    const a = byId.get(q.id);
    const web = a && typeof a.web === 'string' ? a.web.trim().slice(0, 2000) : '';
    return web ? [{ id: q.id, title: q.title, question: q.text, lookUp: web, draft: typeof a.answer === 'string' ? a.answer.slice(0, ANSWER_MAX) : '' }] : [];
  });
}

/**
 * What the run did with each question it took: the web step's answer when there is one, else Claude's
 * first answer; `none` for a question with neither. answers null: Claude wrote no file at all (it
 * stopped), so the questions are left for the next run.
 */
export function finalAnswers(questions, answers, webAnswers) {
  if (!Array.isArray(answers)) return [];
  const first = new Map(answers.filter((a) => a && typeof a === 'object').map((a) => [a.id, a]));
  const web = new Map((Array.isArray(webAnswers) ? webAnswers : []).filter((a) => a && typeof a === 'object').map((a) => [a.id, a]));
  return questions.filter((q) => UUID.test(q.id)).map((q) => {
    const answer = cleanAnswer(web.get(q.id)?.answer) ?? cleanAnswer(first.get(q.id)?.answer);
    return answer ? { id: q.id, taken: false, result: 'answered', answer } : { id: q.id, taken: false, result: 'none' };
  });
}

async function main([step, dir]) {
  if (!dir) throw new Error('usage: node scripts/card-questions.mjs fetch|web|report <dir>');
  mkdirSync(dir, { recursive: true });
  if (step === 'fetch') {
    const questions = await call('GET');
    writeFileSync(join(dir, 'questions.json'), JSON.stringify(questions, null, 2));
    if (questions.length) await call('POST', { runUrl: runUrl(), questions: questions.map((q) => ({ id: q.id, taken: true })) });
    console.log(`${questions.length} question${questions.length === 1 ? '' : 's'} to answer.`);
    output({ n: questions.length });
    return;
  }
  const questions = readJson(join(dir, 'questions.json'), []);
  if (step === 'web') {
    const asks = webAsks(questions, readJson(join(dir, 'answers.json'), []));
    writeFileSync(join(dir, 'web.json'), JSON.stringify(asks, null, 2));
    console.log(`${asks.length} answer${asks.length === 1 ? '' : 's'} need public web pages.`);
    output({ web: asks.length ? 1 : 0 });
    return;
  }
  if (step === 'report') {
    const done = finalAnswers(questions, readJson(join(dir, 'answers.json'), null), readJson(join(dir, 'web-answers.json'), []));
    if (!done.length) { console.log('No answers file: the questions wait for the next run.'); return; }
    const kept = await call('POST', { runUrl: runUrl(), questions: done });
    console.log(`${kept.answered} answered, ${done.filter((d) => d.result === 'none').length} without an answer.`);
    return;
  }
  throw new Error(`no step ${step}: fetch, web or report`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`x ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
