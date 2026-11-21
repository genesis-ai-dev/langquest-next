#!/usr/bin/env node
// The research team, around Claude (.github/workflows/user-issues.yml job
// `research`, docs/research-team.md). Plain Node, no packages.
//
// One time each day two leads (Claude) work, one after the other:
// - the search for the same mistake in other places (docs/agent-team.md "The research team"): a lead reads
//   what the team fixed and what is open, and starts scouts that look in the code for the same mistake;
// - the team that looks ahead (scripts/research-team.mjs): a lead and its scouts look at known security holes,
//   new versions and one more subject each weekday, and write the day's report.
// The script presents what both found to the developers on the ops dashboard's Research page.
//
//   node scripts/agent-research.mjs facts <dir>    what each lead reads, from the app's Worker (the watch's issues
//                                                  and the record of each fix, in Claude's own words, and the items
//                                                  of earlier runs) and from code (team/facts.md); writes work=<0|1>
//                                                  (the twins search) and team=<0|1>, beats=<ids> to GITHUB_OUTPUT
//   node scripts/agent-research.mjs report <dir>   both reports as the leads wrote them, checked: each place must be
//                                                  a file of main; a Linear issue for each recommended item that has
//                                                  none; then tells the Worker, for the dashboard
//
// The twins lead never reads what a person wrote and has no network. The team that looks ahead reads public web
// pages, and so it gets neither the watch's issues nor a shell: only its own items of earlier runs, the code and
// the facts. So nothing of a person's can reach its report, a Linear issue it files or this public repository's logs.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEAM_KEY } from './linear-sync.mjs';
import { runUrl } from './tutorial-review.mjs';
import { modeHere } from './agent-team.mjs';
import { call, linearClient, redact, stepsOf } from './user-issues.mjs';
import { beatsFor, beatsMarkdown, BEATS, checkTeamReport, contextMarkdown, counts, factsMarkdown, gatherFacts, PRIORITY, reportFromScouts, sessionOf, teamItemDescription, TWINS } from './research-team.mjs';

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
  // Without its own Claude token (AGENT_TEAM_CLAUDE_TOKEN, docs/agent-team.md) the team does nothing, as when off.
  if (modeHere() === 'off' || process.env.HAS_TEAM_TOKEN !== 'true') {
    console.log(modeHere() === 'off' ? 'the agent team is off: no research' : 'the agent team has no AGENT_TEAM_CLAUDE_TOKEN: no research');
    output({ work: 0, team: 0 });
    return;
  }
  const context = await call('GET', undefined, '?research=1');
  const issues = Array.isArray(context?.issues) ? context.issues : [];
  const items = Array.isArray(context?.items) ? context.items : [];
  writeFileSync(join(dir, 'facts.json'), JSON.stringify({ issues, items }, null, 2));
  console.log(`research: ${issues.length} issues of the last 30 days to start from, ${items.length} items of earlier runs`);
  // The team that looks ahead: today's beats, the facts code finds, and what the team knows (its own items only).
  const team = join(dir, 'team');
  let beats = [];
  try {
    beats = beatsFor(new Date(), process.env.RESEARCH_BEATS || '');
    const found = await gatherFacts({ root: process.cwd(), githubToken: process.env.GITHUB_TOKEN || '', log: (t) => console.log(t) });
    mkdirSync(join(team, 'scouts'), { recursive: true });
    writeFileSync(join(team, 'facts.md'), factsMarkdown(found));
    writeFileSync(join(team, 'context.md'), contextMarkdown({ items, last: context?.last ?? null }));
    writeFileSync(join(team, 'beats.md'), beatsMarkdown(beats));
    writeFileSync(join(team, 'run.json'), JSON.stringify({ beats, startedAt: Date.now(), facts: { packages: found.lockfile, advisories: (found.audit?.length ?? 0) + (found.osv?.length ?? 0), outdated: found.outdated.length, actions: found.actions.length } }));
    for (const n of found.notes) console.log(`::warning::facts: ${n}`);
    console.log(`research team: today's scouts ${beats.map((b) => `${b} (${BEATS[b].model})`).join(', ')}`);
  } catch (e) {
    console.log(`::warning::the research team cannot start today: ${e instanceof Error ? e.message : e}`);
    beats = [];
  }
  output({ work: issues.length ? 1 : 0, team: beats.length ? 1 : 0, beats: beats.join(',') });
}

/** A file the agents wrote: JSON, or null (missing, a link, too big, not JSON). */
function readJson(path) {
  try {
    if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).size > 2_000_000) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The day's report for the Worker: the team's headline, summary and one line for each scout, the twins search's
 * line, the counts over both, the agents' time and the facts' numbers. Null when the team that looks ahead did
 * not run (a twins search alone has no headline).
 */
export function dayReport(team, twins, { day, run, session }) {
  if (!team) return null;
  const all = [...team.items, ...(twins?.items ?? [])];
  const twinsLine = twins ? [{ id: TWINS.id, title: TWINS.title, model: TWINS.model, checked: twins.checked, result: twins.result, note: null }] : [];
  return {
    day, headline: team.headline, summary: team.summary, beats: [...team.beats, ...twinsLine], lead: team.lead,
    minutes: session.minutes, turns: session.turns, counts: counts(all), facts: run?.facts ?? null
  };
}

async function report(dir) {
  const context = readJson(join(dir, 'facts.json')) ?? { issues: [], items: [] };
  // A file of main as checked out before Claude (GIT_DIR is the copy): Claude can write in the checkout.
  const isFile = (file) => {
    try {
      return git(['cat-file', '-t', `HEAD:${file}`]) === 'blob';
    } catch {
      return false;
    }
  };
  const known = new Map((Array.isArray(context.items) ? context.items : []).filter((i) => i && typeof i.tag === 'string').map((i) => [i.tag, i]));

  // The search for the same mistake in other places.
  let twins = null;
  if (process.env.TWINS === '1') {
    const raw = readJson(join(dir, 'report.json'));
    if (!raw) console.log('::warning::the twins lead wrote no report.json; it runs again tomorrow');
    const checked = raw ? checkReport(raw, context, isFile) : { items: [], dropped: [] };
    for (const d of checked.dropped) console.log(`::warning::report.json ${d}`);
    const n = (Array.isArray(context.issues) ? context.issues : []).length;
    twins = { items: checked.items, checked: `Started from ${n} ${n === 1 ? 'issue' : 'issues'} of the last 30 days.`, result: !raw ? 'failed' : checked.items.length ? 'found' : 'clear' };
  }

  // The team that looks ahead.
  let team = null;
  if (process.env.TEAM === '1') {
    const run = readJson(join(dir, 'team', 'run.json'));
    const beats = Array.isArray(run?.beats) ? run.beats.filter((b) => Object.hasOwn(BEATS, b)) : [];
    const checked = checkTeamReport(readJson(join(dir, 'team', 'report.json')), { beats, isFile, known });
    const notes = beats.map((b) => [b, readJson(join(dir, 'team', 'scouts', `${b}.json`))]);
    if (checked) team = { ...checked, lead: 'ok', run };
    else if (notes.some(([, n]) => n)) {
      console.log('::warning::the research lead gave no report: the scouts\' notes are the report');
      team = { ...reportFromScouts(notes, { isFile, known }), lead: 'failed', run };
    } else console.log('::warning::the research team left no report and no notes; the dashboard keeps the last report');
    for (const d of team?.dropped ?? []) console.log(`::warning::team/report.json ${d}`);
  }

  const run = runUrl(process.env);
  const key = process.env.LINEAR_API_KEY;
  const toFile = [...(twins?.items ?? []), ...(team?.items ?? [])].filter((i) => i.decision === 'recommend' && !i.issue);
  if (toFile.length && !key) throw new Error('No LINEAR_API_KEY: the research cannot file what it recommends.');
  const api = toFile.length ? linearClient(key) : null;
  const linearTeam = api ? await api.team() : null;
  const urls = new Map();
  let failed = 0;
  for (const item of toFile) {
    try {
      const looksAhead = Boolean(item.beat);
      const issue = await api.create({
        teamId: linearTeam.teamId, title: `${TITLE_PREFIX}${item.title}`.slice(0, 250),
        description: looksAhead ? teamItemDescription(item, run) : itemDescription(item, run), priority: looksAhead ? PRIORITY[item.severity] ?? 4 : 4
      });
      item.issue = issue.identifier;
      urls.set(issue.identifier, issue.url);
      console.log(`filed ${issue.identifier} for ${item.tag} (${item.action})`);
    } catch (e) {
      failed += 1;
      console.log(`::error::could not file ${item.tag}: ${e instanceof Error ? e.message : e}`);
    }
  }
  // An item whose issue has no address here keeps the one the database has: it sends neither.
  const send = (i) => (i.issue && urls.has(i.issue) ? { ...i, issueUrl: urls.get(i.issue) } : { ...i, issue: null, issueUrl: null });
  const research = [...(twins?.items ?? []), ...(team?.items ?? [])].map(send);
  const session = sessionOf(process.env.TEAM_EXECUTION_FILE && existsSync(process.env.TEAM_EXECUTION_FILE) ? readFileSync(process.env.TEAM_EXECUTION_FILE, 'utf8') : '');
  const day = new Date(team?.run?.startedAt ?? Date.now()).toISOString().slice(0, 10);
  const reportOut = dayReport(team, twins, { day, run: team?.run, session });
  if (research.length || reportOut) {
    const done = await call('POST', { sha: git(['rev-parse', 'HEAD']), runUrl: run, looked: [], grew: [], states: [], research, ...(reportOut ? { report: reportOut } : {}) });
    console.log(`told the Worker: ${done.research ?? 0} items${reportOut ? ', and the day\'s report' : ''}`);
  }
  // Only counts reach this public log: the words go to the Worker and to Linear.
  const all = [...(twins?.items ?? []), ...(team?.items ?? [])];
  const c = counts(all);
  console.log(`research: ${c.recommended} recommended (${c.toFix} for the fix team, ${c.toAsk} for a developer), ${c.watching} to watch, ${c.rejected} rejected`);
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
