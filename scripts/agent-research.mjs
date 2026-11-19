#!/usr/bin/env node
// The agent team's research, around Claude (.github/workflows/user-issues.yml job
// `research`, docs/agent-team.md "The research team"). Plain Node, no packages.
//
// One time each day a lead (Claude) reads what the team fixed and what is open,
// and starts scouts that look in the code for the same mistake in other places.
// It presents each thing found to the developers on the ops dashboard.
//
//   node scripts/agent-research.mjs facts <dir>    what the lead reads (facts.json), from the app's Worker:
//                                                  the watch's issues and the record of each fix, in Claude's
//                                                  own words, and the items of earlier runs; writes work=<0|1>
//                                                  to GITHUB_OUTPUT (0: nothing to start from, or the team is off)
//   node scripts/agent-research.mjs report <dir>   report.json, as the lead wrote it, checked: each place must
//                                                  be a file of main; a Linear issue for each recommended item
//                                                  that has none; then tells the Worker, for the dashboard
//
// The lead never reads what a person wrote: facts.json holds the team's own
// words only, and the lead has no network. So nothing of a person's can reach
// its report, a Linear issue it files or this public repository's logs.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEAM_KEY } from './linear-sync.mjs';
import { runUrl } from './tutorial-review.mjs';
import { modeHere } from './agent-team.mjs';
import { call, linearClient, redact, stepsOf } from './user-issues.mjs';

export const DECISIONS = ['recommend', 'watch', 'reject'];
export const ACTIONS = ['fix', 'ask', 'none'];
export const LIMITS = { items: 30, title: 200, found: 600, why: 600, places: 8 };
export const TITLE_PREFIX = 'Research: ';
const TAG = /^[a-z0-9][a-z0-9-]{2,59}$/;
const PLACE = /^([A-Za-z0-9_@.()[\]/-]{1,200}?)(:[0-9]{1,6})?$/;
const ISSUE_ID = new RegExp(`^${TEAM_KEY}-[0-9]{1,7}$`);

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const said = (v, max) => redact(typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * The lead's report, checked. `context` is what it read (facts.json) and `isFile` says whether a
 * path is a file of main. An item keeps only the places that are; a recommended item with no place
 * left is not proven, so it becomes `watch`. An item of an earlier run keeps its issue. Returns the
 * items to keep and why each other one was dropped.
 */
export function checkReport(raw, context, isFile) {
  const out = { items: [], dropped: [] };
  const known = new Map((Array.isArray(context?.items) ? context.items : []).filter(isObj).map((i) => [i.tag, i]));
  const issues = new Set((Array.isArray(context?.issues) ? context.issues : []).filter(isObj).map((i) => i.issue));
  const seen = new Set();
  for (const [n, r] of (Array.isArray(raw?.items) ? raw.items : []).entries()) {
    const where = `items[${n}]`;
    if (out.items.length >= LIMITS.items) {
      out.dropped.push(`${where}: more than ${LIMITS.items} items`);
      continue;
    }
    if (!isObj(r) || typeof r.tag !== 'string' || !TAG.test(r.tag) || seen.has(r.tag)) {
      out.dropped.push(`${where}: no tag (small letters, digits and -), or the tag of another item`);
      continue;
    }
    const title = said(r.title, LIMITS.title), found = said(r.found, LIMITS.found), why = said(r.why, LIMITS.why);
    if (!title || !found || !why || !DECISIONS.includes(r.decision)) {
      out.dropped.push(`${where} ${r.tag}: needs title, found, why and a decision (${DECISIONS.join(', ')})`);
      continue;
    }
    seen.add(r.tag);
    const places = [...new Set((Array.isArray(r.places) ? r.places : []).filter((p) => {
      const m = typeof p === 'string' && !p.includes('..') ? PLACE.exec(p) : null;
      return m !== null && isFile(m[1]);
    }))].slice(0, LIMITS.places);
    let decision = r.decision;
    let action = decision === 'recommend' && ACTIONS.includes(r.action) && r.action !== 'none' ? r.action : decision === 'recommend' ? 'ask' : 'none';
    if (decision === 'recommend' && !places.length) {
      out.dropped.push(`${where} ${r.tag}: recommended with no place that is a file of main; kept as watch`);
      decision = 'watch';
      action = 'none';
    }
    const before = known.get(r.tag);
    const issue = typeof before?.issue === 'string' && ISSUE_ID.test(before.issue) ? before.issue : null;
    out.items.push({ tag: r.tag, title, like: typeof r.like === 'string' && issues.has(r.like) ? r.like : null, found, why, places, steps: stepsOf(r.steps), decision, action, issue });
  }
  return out;
}

/** The Linear issue of a recommended item: Claude's words about the code, nothing a person wrote. */
export function itemDescription(item, run) {
  return [
    `Found by the agent team's research (docs/agent-team.md)${item.like ? `: the same mistake as ${item.like}, in another place` : ''}.`,
    '',
    `**What:** ${item.found}`,
    '',
    `**Why it matters:** ${item.why}`,
    '',
    '**Where:**',
    ...item.places.map((p) => `- \`${p}\``),
    '',
    `**Recommended:** ${item.action === 'fix' ? 'the fix team writes the change. The same rule decides whether it merges without a person or waits for a developer.' : 'a developer decides what to do first.'}`,
    '',
    `[The run that found it](${run})`
  ].join('\n');
}

function output(values) {
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`);
  else console.log(lines);
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

async function facts(dir) {
  mkdirSync(dir, { recursive: true });
  if (modeHere() === 'off') {
    console.log('the agent team is off: no research');
    output({ work: 0 });
    return;
  }
  const context = await call('GET', undefined, '?research=1');
  const issues = Array.isArray(context?.issues) ? context.issues : [];
  const items = Array.isArray(context?.items) ? context.items : [];
  writeFileSync(join(dir, 'facts.json'), JSON.stringify({ issues, items }, null, 2));
  console.log(`research: ${issues.length} issues of the last 30 days to start from, ${items.length} items of earlier runs`);
  output({ work: issues.length ? 1 : 0 });
}

async function report(dir) {
  const path = join(dir, 'report.json');
  if (!existsSync(path)) throw new Error('Claude wrote no report.json; research runs again tomorrow.');
  const context = JSON.parse(readFileSync(join(dir, 'facts.json'), 'utf8'));
  // A file of main as checked out before Claude (GIT_DIR is the copy): Claude can write in the checkout.
  const isFile = (file) => {
    try {
      return git(['cat-file', '-t', `HEAD:${file}`]) === 'blob';
    } catch {
      return false;
    }
  };
  const checked = checkReport(JSON.parse(readFileSync(path, 'utf8')), context, isFile);
  for (const d of checked.dropped) console.log(`::warning::report.json ${d}`);
  const run = runUrl(process.env);
  const key = process.env.LINEAR_API_KEY;
  const toFile = checked.items.filter((i) => i.decision === 'recommend' && !i.issue);
  if (toFile.length && !key) throw new Error('No LINEAR_API_KEY: the research cannot file what it recommends.');
  const api = toFile.length ? linearClient(key) : null;
  const team = api ? await api.team() : null;
  const urls = new Map();
  let failed = 0;
  for (const item of toFile) {
    try {
      const issue = await api.create({ teamId: team.teamId, title: `${TITLE_PREFIX}${item.title}`.slice(0, 250), description: itemDescription(item, run), priority: 4 });
      item.issue = issue.identifier;
      urls.set(issue.identifier, issue.url);
      console.log(`filed ${issue.identifier} for ${item.tag} (${item.action})`);
    } catch (e) {
      failed += 1;
      console.log(`::error::could not file ${item.tag}: ${e instanceof Error ? e.message : e}`);
    }
  }
  // An item whose issue has no address here keeps the one the database has: it sends neither.
  const research = checked.items.map((i) => (i.issue && urls.has(i.issue) ? { ...i, issueUrl: urls.get(i.issue) } : { ...i, issue: null, issueUrl: null }));
  if (research.length) {
    const done = await call('POST', { sha: git(['rev-parse', 'HEAD']), runUrl: run, looked: [], grew: [], states: [], research });
    console.log(`told the Worker: ${done.research ?? 0} items`);
  }
  const count = (d) => checked.items.filter((i) => i.decision === d).length;
  console.log(`research: ${count('recommend')} recommended, ${count('watch')} to watch, ${count('reject')} rejected`);
  if (failed) throw new Error(`${failed} Linear calls failed; those items are filed by the next run`);
}

const COMMANDS = { facts, report };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, dir] = process.argv.slice(2);
  if (!dir || !Object.hasOwn(COMMANDS, command)) {
    console.error(`usage: node scripts/agent-research.mjs <${Object.keys(COMMANDS).join('|')}> <dir>`);
    process.exit(2);
  }
  try {
    await COMMANDS[command](dir);
  } catch (e) {
    console.error(`::error::${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
