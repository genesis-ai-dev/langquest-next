#!/usr/bin/env node
// The watch for user issues, around Claude (.github/workflows/user-issues.yml,
// docs/diagnostics.md "The watch for user issues", decisions.md 202). Plain
// Node, no packages, so the workflow needs no `npm ci`.
//
//   node scripts/user-issues.mjs fetch <dir>   first tells the Worker which of its issues closed or opened again
//                                              in Linear (with the pull request that fixed each, when named);
//                                              then what is new (watch.json), with what came with it in
//                                              <dir>/evidence (each problem's screenshot and picture, its phones'
//                                              records), and the team's issues in Linear (linear.json); writes
//                                              look=<n> and grew=<n> to GITHUB_OUTPUT
//   node scripts/user-issues.mjs file <dir>    decisions.json, as Claude wrote it: a Linear issue for each new
//                                              problem, assigned to USER_ISSUES_ASSIGNEE, and a comment on each
//                                              issue the team already had (reopened when it was closed) and on
//                                              each that more people hit since; then tells the Worker what was
//                                              done, so nothing is filed twice; writes fixes=<the new issues' ids,
//                                              then the issues an admin left an instruction on, as JSON> to
//                                              GITHUB_OUTPUT, at most FIX_MAX
//   node scripts/user-issues.mjs fix-context <dir> <issue>
//                                              the Linear issue Claude writes a draft fix for (issue.json), with
//                                              its pictures and phones' records in <dir>/evidence, and the ids and
//                                              words of what was sent in FIX_PRIVATE; with an admin's instructions
//                                              from the ops dashboard, also those, and the issue's draft fix applied
//                                              on the checkout (their ids in FIX_NOTES)
//   node scripts/user-issues.mjs fix-patch <dir>
//                                              after Claude: its change as a patch and its fix.json, checked, in <dir>/out;
//                                              none when they carry what FIX_PRIVATE names
//   node scripts/user-issues.mjs fix-paths <patch>
//                                              refuses a patch that changes what a draft fix may not
//   node scripts/user-issues.mjs fix-open <dir> <issue>
//                                              asks the gate (scripts/agent-team.mjs) what happens to the change,
//                                              then pushes it to user-issue/<issue>: as a pull request that merges
//                                              without a person, or as a draft that waits for a developer, linked
//                                              on the issue; or says on the issue why there is none; with an
//                                              admin's instructions, changes the draft fix that is there, or
//                                              merges it when the admin said so; tells the Worker what was done
//                                              (the record on the ops dashboard) and Claude's answer
//
// The Worker lets in this workflow on main, and nothing else, by the OpenID
// Connect token GitHub gives the job (apps/web/worker/userIssues.ts).
// LINEAR_API_KEY files in Linear. The repository is public and so are its
// Actions logs: this prints counts, kinds' keys and issue ids, never what a
// person wrote.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEAM_KEY } from './linear-sync.mjs';
import { oldPathsOf, pathsOf, runUrl } from './tutorial-review.mjs';
import { decisionLines, gate, gateInput, github as githubAs, graphql, LABELS, modeHere, PICTURES, pictureOf, planOf, saysMerge, toDraft, verdictOf } from './agent-team.mjs';

/** The steps to the screen of a display fix, as the manager writes them beside fix.json (never part of the change). */
export const PICTURE_SPEC = 'picture.spec.ts';

export { oldPathsOf, pathsOf };

export const API = process.env.USER_ISSUES_API ?? 'https://next.langquest.org/api/user-issues';
/** What the Worker expects the token to be for (apps/web/worker/userIssues.ts USER_ISSUES_RULE). */
export const AUDIENCE = 'https://next.langquest.org/api/user-issues';
/** server/userIssues.ts FAMILIES (scripts/userIssues.test.ts holds them equal). */
export const FAMILIES = ['error', 'sync', 'transfer', 'auth', 'expected', 'audio', 'fill', 'device', 'job', 'worker', 'feedback', 'ops'];
export const KEY = new RegExp(`^(${FAMILIES.join('|')}):[A-Za-z0-9 _.:()/#@-]{1,290}$`);
/** server/userIssues.ts ISSUE_LABEL and ISSUE_PREFIX. */
export const LABEL = 'User issue';
export const PREFIX = 'User issue: ';
/** How much of what Claude writes goes on; the rest is cut. */
export const LIMITS = { title: 100, summary: 4000, cause: 6000, comment: 3000, note: 300, keys: 20, line: 300 };
/** Linear issues handed to Claude: every open one, and any changed in this many days. */
export const LINEAR_DAYS = 90;
const LINEAR_MAX = 300;
const DESCRIPTION_MAX = 600;
const OPS = 'https://next.langquest.org/ops-dashboard';
const ISSUE_ID = new RegExp(`^${TEAM_KEY}-[0-9]{1,7}$`);
/** A pull request of this repository, as Linear links it. */
const PR_URL = /^https:\/\/github\.com\/genesis-ai-dev\/langquest-next\/pull\/([0-9]{1,8})(?:[/?#].*)?$/;
const EMAIL = /[^\s@<>()[\]`,;:"']+@[^\s@<>()[\]`,;:"']+\.[A-Za-z]{2,}/g;

// ---- what goes into Linear -----------------------------------------------------------------------

/** No address ever goes into an issue, whoever wrote it. */
export const redact = (text) => String(text ?? '').replace(EMAIL, '[address]');

const cut = (text, max) => {
  const t = redact(text).trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** The kinds an issue says it is about: its "Kinds" lines, as issueDescription writes them. */
export function keysIn(description) {
  const keys = [];
  for (const m of String(description ?? '').matchAll(/^[-*] `([^`\n]{3,300})`$/gm)) if (KEY.test(m[1])) keys.push(m[1]);
  return [...new Set(keys)];
}

/** A time as the team reads it: Pacific (the team's own time zone). */
const PACIFIC = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const when = (iso) => (iso && !Number.isNaN(Date.parse(iso)) ? `${PACIFIC.format(new Date(iso))} PT` : '?');
const byCount = (o) => Object.entries(o ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the watch counted about one kind, in a few lines for a person. Written here, never by Claude. */
export function factsOf(kind) {
  if (kind.feedback) {
    const f = kind.feedback;
    const words = cut(f.body, 2000).split('\n').map((line) => `> ${line}`).join('\n');
    const media = [f.screenshot && 'a screenshot', f.picture && 'a picture', f.voiceMs !== null && f.voiceMs !== undefined && `a voice note (${Math.round(f.voiceMs / 1000)} s)`].filter(Boolean);
    return [
      `**Sent from help mode** on ${when(f.at)}${f.screen ? `, from the screen \`${f.screen}\`` : ''} · ${f.app ?? f.os ?? '?'}${f.uiLanguage ? ` · app language ${f.uiLanguage}` : ''}`,
      '',
      words || '> (no words)',
      ...(media.length ? ['', `With ${media.join(' and ')}: [ops dashboard](${OPS}), Feedback.`] : []),
      ...(kind.phoneFacts?.length ? ['', '**That phone in the half hour before**', '', ...kind.phoneFacts.map((l) => `- ${cut(l, 300)}`)] : [])
    ].join('\n');
  }
  if (kind.server?.line) {
    const l = kind.server.line;
    const level = { urgent: 'Act now', problem: 'Fix soon', watch: 'Watch' }[l.level] ?? l.level ?? '?';
    return [
      `**The ops dashboard shows: ${cut(l.title ?? kind.key, 120)}** · ${level} · in ${l.part ?? '?'} · [ops dashboard](${OPS})`,
      `> ${cut(l.text, 600)}`,
      ...(l.link ? [`Its page: ${l.link}`] : [])
    ].join('\n\n');
  }
  if (kind.server) {
    const s = kind.server;
    if (kind.family === 'worker') return `**The app's Worker answered ${s.answers5xxLastDay ?? kind.count} times with a server error** in the last day, on its \`${s.route ?? '?'}\` requests.`;
    return [
      `**The server job \`${s.job ?? kind.key}\` ${kind.key.endsWith(':stopped') ? 'stopped running' : `failed ${plural(s.streak ?? kind.count, 'time')} running`}** · runs ${s.every ? `every ${s.every}` : 'when asked'}, on ${s.runsOn ?? '?'}`,
      `Last run ${when(s.lastAt)} (${s.lastOutcome ?? '?'}${s.lastErrorClass ? `, ${s.lastErrorClass}` : ''}) · last good run ${when(s.lastOkAt)}`
    ].join('\n\n');
  }
  const apps = (kind.apps ?? []).map((a) => `${a.app} (${a.installs})`).join(', ');
  const fix = kind.before?.verdict === 'fixed' && kind.peopleAfterFix !== null && kind.peopleAfterFix !== undefined
    ? [`**Again after the fix** (${kind.before.fixedBy ? `PR ${kind.before.fixedBy}, merged` : 'issue closed'} ${when(kind.before.fixedAt)}): ${plural(kind.peopleAfterFix, 'person', 'people')} more than a day after it; the platforms and builds below are theirs.`]
    : [];
  return [
    `**\`${kind.key}\`** · ${plural(kind.people, 'person', 'people')} in 7 days (${kind.peopleDay} in the last day) · ${plural(kind.installs, 'install')} · ${plural(kind.count, 'time')}`,
    ...fix,
    `${byCount(kind.platforms).map(([p, n]) => `${p} ${n}`).join(', ') || '?'} · builds ${apps || '?'} · first ${when(kind.firstAt)}, last ${when(kind.lastAt)}`
  ].join('\n\n');
}

/** The part for agents: the kinds (how later runs find this issue), the phones, the stack, and what Claude found in the code. */
function agentNotes(kinds, cause, run) {
  const installs = [...new Set(kinds.flatMap((k) => (k.feedback ? [k.feedback.installId] : k.installIds ?? [])))].slice(0, 8);
  const stack = kinds.find((k) => k.stack)?.stack;
  return [
    '+++ Agent notes',
    '',
    'Kinds (the watch matches later records to this issue by these lines; keep them):',
    ...kinds.map((k) => `- \`${k.key}\``),
    ...(installs.length ? ['', 'Phones that hit it, for `npm run diag -- --hosted timeline <installId> --days 3`:', ...installs.map((i) => `- ${i}`)] : []),
    ...(stack ? ['', 'Newest stack (frames only):', '```', stack.slice(0, 3000), '```'] : []),
    ...(cause ? ['', cut(cause, LIMITS.cause)] : []),
    '',
    `Filed by the watch for user issues (docs/diagnostics.md): ${run}`,
    '',
    '+++'
  ].join('\n');
}

/** A new issue's description: Claude's summary, the watch's facts, then the agent notes. */
export function issueDescription(entry, kinds, run) {
  return [cut(entry.summary, LIMITS.summary), '', '**What the watch saw**', '', kinds.map(factsOf).join('\n\n'), '', agentNotes(kinds, entry.cause, run)].join('\n');
}

/** A comment on an issue the team already had, for kinds it covers that were not on it yet. */
export function knownComment(entry, kinds, run) {
  return [cut(entry.comment, LIMITS.comment) || 'The watch for user issues saw this again.', '', kinds.map(factsOf).join('\n\n'), '', agentNotes(kinds, '', run)].join('\n');
}

/** A comment on an issue whose kinds more people hit since it was filed. */
export function grewComment(grown, state, run) {
  const lines = grown.map((g) =>
    `- \`${g.key}\`: ${plural(g.people, 'person', 'people')} in 7 days (${g.peopleBefore} when last counted) · ${plural(g.installs, 'install')} · ${plural(g.count, 'time')} · ${byCount(g.platforms).map(([p, n]) => `${p} ${n}`).join(', ') || '?'} · last ${when(g.lastAt)}`);
  const done = state && /^(completed|canceled)$/.test(state.type);
  return [`**More people are hitting this${done ? ` although it is ${state.name}` : ''}.**`, '', ...lines, '', `The watch for user issues: ${run}`].join('\n');
}

// ---- Claude's decisions, checked -------------------------------------------------------------------

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v) => (typeof v === 'string' ? v : '');

/**
 * decisions.json as Claude wrote it, against what it was handed. Each kind it
 * was handed gets at most one verdict; a kind it invents, names twice or
 * leaves out is dropped and comes back next run. A new issue whose kinds are
 * all on an issue already (a run that filed but could not tell the Worker)
 * becomes a comment on that issue.
 */
export function checkDecisions(decisions, watch, linear) {
  const handed = new Map((watch.look ?? []).map((k) => [k.key, k]));
  const filedBy = new Map();
  for (const i of linear.issues ?? []) for (const k of i.keys ?? []) if (!filedBy.has(k)) filedBy.set(k, i.identifier);
  const taken = new Set();
  const out = { file: [], known: [], noise: [], fixed: [], dropped: [], undecided: [] };
  const take = (keys, where) => {
    const list = Array.isArray(keys) ? keys : [];
    const bad = list.find((k) => typeof k !== 'string' || !handed.has(k) || taken.has(k));
    if (!list.length || list.length > LIMITS.keys || bad !== undefined || new Set(list).size !== list.length) {
      out.dropped.push(`${where}: ${!list.length || list.length > LIMITS.keys ? `1 to ${LIMITS.keys} keys` : `${typeof bad === 'string' && KEY.test(bad) ? bad : 'a key'} was not handed over, or is named twice`}`);
      return null;
    }
    for (const k of list) taken.add(k);
    return list;
  };
  const d = isObj(decisions) ? decisions : {};
  (Array.isArray(d.file) ? d.file : []).forEach((f, n) => {
    const where = `file[${n}]`;
    if (!isObj(f) || !text(f.title).trim() || !text(f.summary).trim()) return out.dropped.push(`${where}: needs keys, a title and a summary`);
    const keys = take(f.keys, where);
    if (!keys) return;
    const already = [...new Set(keys.map((k) => filedBy.get(k)))];
    if (already.length === 1 && already[0]) {
      out.known.push({ keys, issue: already[0], comment: text(f.summary) });
      return;
    }
    const priority = [1, 2, 3, 4].includes(f.priority) ? f.priority : 3;
    // The coordinator chooses the model and effort of the issue's manager (docs/agent-team.md).
    out.file.push({ keys, title: cut(text(f.title).replace(/\s+/g, ' ').replace(/^User issue:\s*/i, ''), LIMITS.title), priority, summary: text(f.summary), cause: text(f.cause), ...linesOf(f), manager: planOf(f.manager) });
  });
  (Array.isArray(d.known) ? d.known : []).forEach((k, n) => {
    const where = `known[${n}]`;
    if (!isObj(k) || !ISSUE_ID.test(text(k.issue))) return out.dropped.push(`${where}: needs keys and an issue (${TEAM_KEY}-12)`);
    const keys = take(k.keys, where);
    if (keys) out.known.push({ keys, issue: k.issue, comment: text(k.comment) });
  });
  (Array.isArray(d.fixed) ? d.fixed : []).forEach((x, n) => {
    const where = `fixed[${n}]`;
    if (!isObj(x) || !Number.isInteger(x.pr) || x.pr < 1 || x.pr > 100_000_000) return out.dropped.push(`${where}: needs keys and pr, the number of the pull request on main that fixed it`);
    const keys = take(x.keys, where);
    if (keys) out.fixed.push({ keys, pr: x.pr, title: cut(text(x.title).replace(/\s+/g, ' ').replace(/^User issue:\s*/i, ''), LIMITS.title) || null, note: cut(text(x.note), LIMITS.note) || null });
  });
  (Array.isArray(d.noise) ? d.noise : []).forEach((x, n) => {
    const where = `noise[${n}]`;
    if (!isObj(x)) return out.dropped.push(`${where}: an object with a key and a note`);
    const keys = take([x.key], where);
    if (keys) out.noise.push({ key: keys[0], note: cut(text(x.note), LIMITS.note) || null });
  });
  out.undecided = [...handed.keys()].filter((k) => !taken.has(k));
  return out;
}

/**
 * An issue in three lines for its card on the ops dashboard (decisions.md 202, amended 2026-11-18):
 * `context`, `problem` and `solution`, each one line, cut to its limit, addresses out. Null where
 * Claude wrote none.
 */
export function linesOf(entry) {
  const line = (v) => cut(redact(text(v)).replace(/\s+/g, ' ').trim(), LIMITS.line) || null;
  return { context: line(entry.context), problem: line(entry.problem), solution: line(entry.solution) };
}

/**
 * What the Worker is told about a kind: its verdict, its issue, and the counts
 * it was judged at. A kind found fixed is counted from the fix: the people who
 * hit it since (none for one just found fixed), so it comes back only when
 * twice as many hit it after the fix.
 */
export function lookedOf(kind, verdict, issue, note = null, extra = {}) {
  return {
    key: kind.key, verdict, issue: issue?.identifier ?? null, issueUrl: issue?.url ?? null,
    people: verdict === 'fixed' ? kind.peopleAfterFix ?? 0 : kind.people, count: kind.count, note,
    title: extra.title ?? null, context: extra.context ?? null, problem: extra.problem ?? null, solution: extra.solution ?? null,
    fixedBy: extra.fixedBy ?? null, fixedAt: extra.fixedAt ?? null
  };
}

// ---- closed in Linear, and the pull requests on main -------------------------------------------

/**
 * Closed for the watch: done (Live), canceled or a duplicate. Not Outage:
 * linear-sync moves an issue there when its deploy failed, so nothing is fixed.
 */
export const isClosed = (state) => state?.type === 'completed' || ((state?.type === 'canceled' || state?.type === 'duplicate') && state?.name !== 'Outage');

/**
 * The merges into main the checkout holds (`git log --merges`), newest first:
 * each pull request's number, when it merged, and its message (where a LAN id
 * the pull request names appears).
 */
export function mergesOf(log) {
  const out = [];
  for (const entry of String(log).split('\x1e')) {
    const [at, subject, body = ''] = entry.trim().split('\x1f');
    const pr = /^Merge pull request #([0-9]{1,8}) /.exec(subject ?? '')?.[1];
    if (pr && at && !Number.isNaN(Date.parse(at))) out.push({ pr: Number(pr), at: new Date(at).toISOString(), text: `${subject}\n${body}` });
  }
  return {
    /** When pull request `pr` merged into main, or null when this checkout does not hold it. */
    at: (pr) => out.find((m) => m.pr === pr)?.at ?? null,
    /** The newest merged pull request whose message names `issue` (LAN-12). */
    naming: (issue) => out.find((m) => new RegExp(`\\b${issue}\\b`).test(m.text))?.pr ?? null
  };
}

function gitMerges() {
  try {
    return mergesOf(execFileSync('git', ['log', '--merges', '--first-parent', '--format=%cI%x1f%s%x1f%b%x1e', 'HEAD'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  } catch {
    return mergesOf('');
  }
}

/**
 * Which of the watch's issues changed in Linear since it last read them: each
 * closed one with when it closed and the pull request that fixed it (the
 * newest one Linear links, else the newest merge into main that names it) and
 * when that merged; each open again; each whose state's name changed.
 */
export function statesToSend(known, issues, merges) {
  const byId = new Map(issues.map((i) => [i.identifier, i]));
  const out = [];
  for (const k of known) {
    const i = byId.get(k.issue);
    if (!i) continue;
    const closed = isClosed(i.state);
    if (closed === Boolean(k.closed) && i.state.name === k.state) continue;
    // Its title in Linear, for the ops dashboard: the team may rename it, and older rows have none.
    const title = cut(String(i.title ?? '').replace(PREFIX, ''), 200) || null;
    if (!closed) {
      out.push({ issue: k.issue, state: i.state.name, closed: false, closedAt: null, fixedBy: null, fixedAt: null, title });
      continue;
    }
    const linked = (i.attachments ?? []).map((a) => Number(PR_URL.exec(a.url ?? '')?.[1])).filter((n) => n > 0);
    const fixedBy = linked.length ? Math.max(...linked) : merges.naming(k.issue);
    const closedAt = i.completedAt ?? i.canceledAt ?? null;
    out.push({ issue: k.issue, state: i.state.name, closed: true, closedAt, fixedBy: fixedBy ?? null, fixedAt: (fixedBy && merges.at(fixedBy)) || closedAt, title });
  }
  return out;
}

// ---- draft fixes (decisions.md 202, amended) ----------------------------------------------------
//
// Each new issue gets a draft pull request with Claude's fix, written in three jobs that trust
// each other less as they go (.github/workflows/user-issues.yml): Claude edits a checkout with
// no key and no shell; a job with no key applies the patch and runs the checks; a job that runs
// nothing of the patch pushes it and opens the pull request. Its checks run when a person marks
// it Ready for review, since what people wrote shaped the code.

/** At most this many new issues get a draft fix in one run; the rest are only filed. */
export const FIX_MAX = 3;
/**
 * What a draft fix may never change: how the repository builds, tests and deploys, its packages,
 * its secrets, its agents' instructions, and the watch itself; nor may it add a picture or a recording.
 */
export const FIX_REFUSED = [
  /^\.github\//, /^\.githooks\//, /(^|\/)\.env/, /(^|\/)package(-lock)?\.json$/, /(^|\/)\.npmrc$/,
  /^\.(agents|claude|hermes)\//, /^(AGENTS|CLAUDE)\.md$/, /^scripts\/(user-issues|agent-team|linear-sync|tutorial-review)\.mjs$/, /^\.user-issues\//,
  /(^|\/)\.git(\/|$)/,
  // No pictures or recordings: a screenshot or voice note a person sent must never reach this public repository.
  /\.(jpe?g|png|webp|gif|heic|m4a|wav|mp3|mp4|mov)$/i
];
export const FIX_LIMITS = { files: 30, bytes: 300_000, summary: 3000, tests: 1000, noFix: 1000, answer: 1000 };
/** The checks the job with no key ran, as it may say them; anything else is "not run". */
const CHECK_RESULTS = ['passed', 'failed', 'none'];
const REPO = 'genesis-ai-dev/langquest-next';
const FIX_BOT = { name: 'github-actions[bot]', email: '41898282+github-actions[bot]@users.noreply.github.com' };

/** The branch a draft fix goes on, and the issue of such a branch (null for any other). */
export const fixBranch = (issue) => `user-issue/${issue.toLowerCase()}`;
export const ISSUE_OF_BRANCH = (ref) => {
  const id = /^user-issue\/([a-z]{1,10}-[0-9]{1,7})$/.exec(String(ref ?? ''))?.[1]?.toUpperCase() ?? '';
  return ISSUE_ID.test(id) ? id : null;
};

// pathsOf and oldPathsOf are tutorial-review.mjs's, whose fix jobs read patches the same way.

/** Why a draft fix may not go on, or null: a path it may never change, or too much to review. */
export function fixRefusal(paths, bytes) {
  if (!paths.length) return 'it changes nothing';
  const odd = (p) => p.startsWith('/') || /["\\\x00-\x1f]/.test(p) || p.split('/').includes('..');
  const bad = paths.find((p) => odd(p) || FIX_REFUSED.some((r) => r.test(p)));
  if (bad !== undefined) return `it changes ${bad}, which a draft fix may not`;
  if (paths.length > FIX_LIMITS.files) return `it changes ${paths.length} files, more than ${FIX_LIMITS.files}`;
  if (bytes > FIX_LIMITS.bytes) return `it is ${Math.round(bytes / 1000)} KB, more than ${FIX_LIMITS.bytes / 1000}`;
  return null;
}

/**
 * fix.json as Claude wrote it: what the change does and how it is tested, or why there is no
 * fix. It goes into a public pull request, so addresses are taken out.
 */
export function checkFix(raw) {
  const o = isObj(raw) ? raw : {};
  const noFix = cut(text(o.noFix), FIX_LIMITS.noFix);
  const summary = cut(text(o.summary), FIX_LIMITS.summary);
  // The manager's verdict and reasoning (scripts/agent-team.mjs verdictOf), addresses out.
  const v = verdictOf(o);
  const team = { verdict: v.verdict, cause: redact(v.cause), proof: redact(v.proof), why: redact(v.why), twins: redact(v.twins), display: v.display };
  return { summary, tests: cut(text(o.tests), FIX_LIMITS.tests), noFix: noFix || (summary ? '' : 'Claude wrote no summary of a change.'), answer: cut(text(o.answer).replace(/\s+/g, ' '), FIX_LIMITS.answer), ...team };
}

/** check.json from the job with no key: only its fixed words, since the patch's own code ran there. */
export function checkResults(raw) {
  const o = isObj(raw) ? raw : {};
  const one = (v) => (CHECK_RESULTS.includes(v) ? v : 'not run');
  return { typecheck: one(o.typecheck), tests: one(o.tests) };
}

const said = (r, what) => ({ passed: `${what} passed`, failed: `${what} **failed**`, none: `no ${what} near the change`, 'not run': `${what} did not run` })[r];

/**
 * The pull request's body: what happens to it and why (the gate's words), then Claude's words about
 * the code and the team's reasoning, never what people wrote (they stay in Linear).
 */
export function fixBody(issue, fix, checks, run, team = null) {
  const merge = team?.decision?.merge === true;
  return [
    ...(team?.decision ? [...decisionLines(team.decision), ''] : []),
    `A ${merge ? 'fix' : 'draft fix'} for [${issue.identifier}](${issue.url}), written by Claude for the watch for user issues (docs/agent-team.md, decisions.md 202). What people reported is on the issue in Linear.`,
    '',
    fix.summary,
    ...(fix.cause ? ['', `**Cause:** ${fix.cause}`] : []),
    ...(fix.proof ? ['', `**Proof:** ${fix.proof}`] : []),
    ...(fix.tests ? ['', `**Tests:** ${fix.tests}`] : []),
    ...(fix.twins ? ['', `**The same mistake in other places:** ${fix.twins}`] : []),
    '',
    `**In the workflow:** ${said(checks.typecheck, 'typecheck')}; ${said(checks.tests, 'tests')} ([run](${run})).`,
    ...(team?.vet ? ['', `**The reviewer** (a second Claude that read only this change): ${team.vet.why}`] : []),
    ...(merge ? [] : ['', 'CI runs when a person marks this pull request Ready for review. Read the change first: it was written from what people reported.'])
  ].join('\n');
}

/** What the issue is told: the fix, its checks and what happens next; or why there is none. */
export function fixComment(pr, checks, decision = null) {
  const next = decision?.merge
    ? 'It merges without a person when its checks pass (docs/agent-team.md). To stop it, make the pull request a draft.'
    : `${decision?.why ? `It waits for a developer. ${decision.why} ` : ''}Review it, then mark it Ready for review on GitHub to run CI and merge it.`;
  return [`**Claude wrote a ${decision?.merge ? 'fix' : 'draft fix'}:** [PR ${pr.number}](${pr.url}).`, '', `${said(checks.typecheck, 'Typecheck')}; ${said(checks.tests, 'tests')}.`, '', next].join('\n');
}
export function noFixComment(reason, run) {
  return [`**Claude looked for a fix and wrote none.** ${reason}`, '', `The watch for user issues: ${run}`].join('\n');
}
export function branchComment(branch, run) {
  return [`**Claude wrote a draft fix**, on the branch \`${branch}\`, but GitHub did not let the workflow open its pull request.`, '', `[Open it](https://github.com/${REPO}/compare/main...${branch}?expand=1) as a draft, or turn on Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests" (\`npm run github:rules -- --apply\`).`, '', `The watch for user issues: ${run}`].join('\n');
}

export function updateComment(pr, checks) {
  return [`**Claude changed the draft fix** ([PR ${pr.number}](${pr.url})) after an instruction from the ops dashboard.`, '', `${said(checks.typecheck, 'Typecheck')}; ${said(checks.tests, 'tests')}.`, '', 'Review it, then mark it Ready for review on GitHub to run CI and merge it.'].join('\n');
}

// ---- an admin's instructions (docs/decisions/2026-11-18-an-admin-tells-claude-what-to-do-with-a-user-issue.md) ----
//
// An issue's card on the ops dashboard has a box, "Tell Claude what to do". The watch hands what an
// admin wrote there to the same three jobs that write a draft fix: Claude starts from the draft fix
// the issue has, answers, and may change it. The answer goes back to the card through the Worker.

const NOTE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** As the Worker reads an address (server/userIssues.ts EMAIL): wider than `redact`. */
const ANY_ADDRESS = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** The ids in a list of instructions' ids, as the script wrote them; anything else is left out. */
/**
 * The agent team's record of an issue's fix for the Worker (server/userIssues.ts FixRecord): the gate's
 * decision, and the reasoning in Claude's words, each cut to what the Worker takes.
 */
export function fixRecord(issue, { decision, reason = null, why = null, pr = null }, fix = {}, plan = {}, vet = null, pictures = null) {
  const word = (v, max) => cut(String(v ?? '').replace(/\s+/g, ' '), max).replace(ANY_ADDRESS, '[address]') || null;
  return {
    // The screen without the change and with it (base64 JPEG), when the picture job made both.
    ...(pictures?.before && pictures?.after ? { before: pictures.before.toString('base64'), after: pictures.after.toString('base64') } : {}),
    issue, decision, reason, why: word(why, 600), pr, verdict: fix.verdict ?? null, model: plan.model ?? null, effort: plan.effort ?? null,
    summary: word(fix.summary, 1000), cause: word(fix.cause, 600), proof: word(fix.proof, 400), review: word(vet?.why, 1000), twins: word(fix.twins, 1000)
  };
}

export const noteIdsOf = (raw) => (Array.isArray(raw?.ids) ? [...new Set(raw.ids.filter((i) => typeof i === 'string' && NOTE_ID.test(i)))].slice(0, 20) : []);

/**
 * Which issues with an admin's instruction get a run of the fix jobs: after the new issues, the
 * oldest instruction first, while FIX_MAX has room. Returns the issues to run and the ids of the
 * instructions those runs take; the rest wait for the next run.
 */
export function notesToTake(notes, fixes) {
  const out = { fixes: [...fixes], taken: [] };
  for (const n of Array.isArray(notes) ? notes : []) {
    if (!isObj(n) || !ISSUE_ID.test(text(n.issue)) || out.fixes.includes(n.issue)) continue;
    const ids = noteIdsOf(n);
    if (!ids.length || out.fixes.length >= FIX_MAX) continue;
    out.fixes.push(n.issue);
    out.taken.push(...ids);
  }
  return out;
}

/**
 * What the card shows under the admin's words: Claude's answer, or fixed words when it wrote none,
 * then what the workflow adds (why a change did not go on). At most the Worker's limit, no address.
 */
export function noteAnswer(fix, result, extra = '') {
  const own = fix.answer || (result === 'changed' ? 'Claude changed the draft fix.' : result === 'answered' ? 'Claude changed nothing.' : '');
  const all = cut([own, redact(extra).replace(/\s+/g, ' ').trim()].filter(Boolean).join(' '), FIX_LIMITS.answer);
  return ANY_ADDRESS.test(all) ? all.replace(/@/g, ' at ') : all;
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// ---- what Claude looks at besides the counts --------------------------------------------------------

// A problem sent from help mode can come with a screenshot and a picture, and every phone records
// how long its downloads, opens and syncs took (decisions.md 202, amended 2026-11-04). Before Claude
// judges or fixes, the step before it asks the Worker for both and keeps them in <dir>/evidence: on
// the runner only, never in a log, an artifact or a pull request.

/** At most this many phones' records in one run, and this many for a kind that is not a problem sent from help mode. */
export const EVIDENCE_PHONES = 12;
export const PHONES_PER_KIND = 2;
const FEEDBACK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INSTALL_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const JPEG = [0xff, 0xd8, 0xff];

/** What to ask for: each problem's pictures and phone first, then a few phones of every other kind. */
export function evidencePlan(kinds) {
  const media = [];
  const phones = new Map();
  const phone = (installId, at) => {
    if (INSTALL_ID.test(installId ?? '') && !phones.has(installId) && phones.size < EVIDENCE_PHONES) phones.set(installId, at ?? null);
  };
  for (const k of kinds) {
    const f = k.feedback;
    if (!f) continue;
    if ((f.screenshot || f.picture) && FEEDBACK_ID.test(f.id ?? '')) media.push(f.id);
    phone(f.installId, f.at);
  }
  for (const k of kinds) if (!k.feedback) for (const i of (k.installIds ?? []).slice(0, PHONES_PER_KIND)) phone(i, k.lastAt);
  return { media, phones: [...phones].map(([installId, at]) => ({ installId, at })) };
}

const sum = (records, field) => records.reduce((n, r) => n + (Number(r.n?.[field]) || 0), 0);
const secs = (ms) => (ms >= 10_000 ? `${Math.round(ms / 1000)} s` : `${(ms / 1000).toFixed(1)} s`);
const mb = (bytes) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const FAILS = ['failOffline', 'failHttp4xx', 'failHttp5xx', 'failHash', 'failDisk', 'failOther', 'failAuth', 'failNotFound', 'failTooLarge', 'failBadDigest', 'failGone'];
const AUDIO = ['plays', 'playFail', 'playNotHere', 'streamFail', 'takes', 'startFail', 'stopFail', 'saveFail', 'encodeFail', 'interrupted'];

/**
 * A phone's records in the half hour before a time, in a few lines for a person: the phone, its
 * build, its downloads and uploads (how many, how big, how long each took), plays and recordings,
 * opens and syncs, its disk. Numbers from the records only: written here, never by Claude.
 */
export function phoneFacts(phone, at) {
  const end = Date.parse(at ?? '') || Date.parse(phone.to);
  const recent = (phone.records ?? []).filter((r) => {
    const t = Date.parse(r.at);
    return t <= end + 60_000 && t > end - 30 * 60_000;
  });
  const p = phone.phone ?? {};
  const lines = [`${[p.model, p.os && `${p.os}${p.osVersion ? ` ${p.osVersion}` : ''}`].filter(Boolean).join(', ') || 'phone ?'} · ${phone.build}`];
  const transfers = new Map();
  for (const r of recent.filter((r) => r.kind === 'transfer')) {
    const key = `${r.t?.dir === 'up' ? 'up' : 'down'} ${r.t?.src ?? '?'}`;
    transfers.set(key, [...(transfers.get(key) ?? []), r]);
  }
  for (const [key, rs] of transfers) {
    const [dir, src] = key.split(' ');
    const count = sum(rs, 'count');
    const failed = FAILS.reduce((n, f) => n + sum(rs, f), 0);
    const done = count - failed;
    const ms = sum(rs, 'ms');
    const max = Math.max(0, ...rs.map((r) => Number(r.n?.maxMs) || 0));
    lines.push(`${dir === 'up' ? 'Uploads' : 'Downloads'} (${src}): ${plural(count, 'file')}${done > 0 ? `, ${mb(sum(rs, 'bytes'))}` : ''}${count ? `, ${secs(ms / count)} each on average, slowest ${secs(max)}` : ''}${failed ? `, ${failed} failed (${FAILS.filter((f) => sum(rs, f)).map((f) => `${f} ${sum(rs, f)}`).join(', ')})` : ''}`);
  }
  const audio = recent.filter((r) => r.kind === 'audio');
  const counts = AUDIO.filter((f) => sum(audio, f)).map((f) => `${f} ${sum(audio, f)}`);
  if (counts.length) lines.push(`Audio: ${counts.join(', ')}`);
  // How long plays waited for their first sound (decisions.md 182, amended 2026-11-04).
  const waits = sum(audio, 'waits');
  if (waits) lines.push(`Plays waited for sound: ${secs(sum(audio, 'waitMs') / waits)} on average, longest ${secs(Math.max(0, ...audio.map((r) => Number(r.n?.maxWaitMs) || 0)))} (${plural(waits, 'play')})`);
  for (const kind of ['open', 'sync', 'snapshot', 'checkpoint', 'fill']) {
    const rs = recent.filter((r) => r.kind === kind && Number.isFinite(Number(r.n?.ms)));
    if (rs.length) lines.push(`${kind[0].toUpperCase()}${kind.slice(1)}: ${plural(rs.length, 'time')}, slowest ${secs(Math.max(...rs.map((r) => Number(r.n.ms))))}`);
  }
  const errors = recent.filter((r) => r.kind === 'error' || r.kind === 'expected').length;
  if (errors) lines.push(`Errors: ${errors}`);
  const device = (phone.records ?? []).find((r) => r.kind === 'device' && Date.parse(r.at) <= end + 60_000);
  if (device) {
    const n = device.n ?? {};
    const parts = [n.freeDiskMb !== undefined && `${n.freeDiskMb} MB free${n.totalDiskMb ? ` of ${n.totalDiskMb} MB` : ''}`, n.blobsWanted !== undefined && `${n.blobsWanted} files wanted`,
      n.dbMb !== undefined && `database ${n.dbMb} MB`, n.uploadsWaiting && `${n.uploadsWaiting} uploads waiting`].filter(Boolean);
    if (parts.length) lines.push(`Disk, ${when(device.at)}: ${parts.join(', ')}`);
  }
  if (lines.length === 1) lines.push('No downloads, plays, opens, syncs or errors recorded in the half hour before it.');
  return lines;
}

/** The ids and words of what was sent, which a draft fix in this public repository must never carry. */
export function privateOf(description) {
  const text = String(description ?? '');
  const feedback = keysIn(text).filter((k) => k.startsWith('feedback:')).map((k) => k.slice('feedback:'.length)).filter((i) => FEEDBACK_ID.test(i));
  const installs = new Set();
  let inPhones = false;
  for (const line of text.split('\n')) {
    if (/Phones that hit it/.test(line)) { inPhones = true; continue; }
    const m = /^[-*] ([A-Za-z0-9_.-]{8,64})$/.exec(line.trim());
    if (inPhones && m) installs.add(m[1]);
    else if (inPhones && line.trim()) inPhones = false;
  }
  const words = text.split('\n').filter((l) => l.startsWith('> ')).map((l) => l.slice(2).trim()).filter((l) => l.length >= 20);
  return { feedback, installs: [...installs], ids: [...new Set([...feedback, ...installs])], words };
}

/** Whether some text carries an id or six words in a row of what was sent (case and spacing aside). */
export function leaks(text, priv) {
  const flat = (s) => String(s).toLowerCase().replace(/\s+/g, ' ');
  const t = flat(text);
  if ((priv.ids ?? []).some((id) => t.includes(id.toLowerCase()))) return true;
  for (const line of priv.words ?? []) {
    const w = flat(line).split(' ').filter(Boolean);
    for (let i = 0; i + 6 <= w.length; i += 1) {
      const run = w.slice(i, i + 6).join(' ');
      if (run.length >= 25 && t.includes(run)) return true;
    }
    if (w.length < 6 && t.includes(flat(line).trim())) return true;
  }
  return false;
}

// ---- Linear -----------------------------------------------------------------------------------------

/** A Linear call that failed, by its code and a short message: never what was sent. */
export class LinearError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LinearError';
  }
}

export function linearClient(key, fetchImpl = fetch) {
  async function gql(query, variables = {}) {
    const res = await fetchImpl('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: key },
      body: JSON.stringify({ query, variables })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.errors || !json.data) {
      const e = json.errors?.[0];
      throw new LinearError(`Linear ${e?.extensions?.code ?? res.status}: ${String(e?.message ?? '').slice(0, 200)}`);
    }
    return json.data;
  }
  return {
    /** The team's id and the User issue label's, made when missing. */
    async team() {
      const data = await gql(`query($key: String!, $label: String!) {
        teams(filter: { key: { eq: $key } }) { nodes { id } }
        issueLabels(filter: { name: { eq: $label } }) { nodes { id team { key } } } }`, { key: TEAM_KEY, label: LABEL });
      const teamId = data.teams.nodes[0]?.id;
      if (!teamId) throw new LinearError(`Linear: no team ${TEAM_KEY}`);
      let labelId = data.issueLabels.nodes.find((l) => !l.team || l.team.key === TEAM_KEY)?.id;
      if (!labelId) {
        const made = await gql(`mutation($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { issueLabel { id } } }`, {
          input: { teamId, name: LABEL, color: '#EB5757', description: 'Filed by the watch for user issues (docs/diagnostics.md)' }
        });
        labelId = made.issueLabelCreate.issueLabel.id;
      }
      return { teamId, labelId };
    },
    /** Every open issue of the team, and every one changed since `since`, newest first, with the kinds each names. */
    async issues(since) {
      const out = [];
      let after = null;
      do {
        const data = await gql(`query($key: String!, $since: DateTimeOrDuration!, $after: String) {
          issues(first: 100, after: $after, orderBy: updatedAt, filter: { team: { key: { eq: $key } },
            or: [{ state: { type: { nin: ["completed", "canceled"] } } }, { updatedAt: { gt: $since } }] }) {
            nodes { identifier title url description createdAt state { name type } labels { nodes { name } } }
            pageInfo { hasNextPage endCursor } } }`, { key: TEAM_KEY, since, after });
        for (const i of data.issues.nodes) {
          out.push({
            identifier: i.identifier, title: i.title, url: i.url, createdAt: i.createdAt, state: i.state.name, stateType: i.state.type,
            labels: i.labels.nodes.map((l) => l.name), keys: keysIn(i.description), description: String(i.description ?? '').slice(0, DESCRIPTION_MAX)
          });
        }
        after = data.issues.pageInfo.hasNextPage ? data.issues.pageInfo.endCursor : null;
      } while (after && out.length < LINEAR_MAX);
      return out;
    },
    /** The watch's issues by their ids (LAN-12): state, when closed, and the links on each (pull requests). */
    async states(identifiers) {
      const numbers = identifiers.map((id) => Number(id.split('-')[1])).filter((n) => Number.isInteger(n) && n > 0);
      if (!numbers.length) return [];
      const data = await gql(`query($key: String!, $numbers: [Float!]) {
        issues(first: 100, filter: { team: { key: { eq: $key } }, number: { in: $numbers } }) {
          nodes { identifier title state { name type } completedAt canceledAt attachments { nodes { url } } } } }`, { key: TEAM_KEY, numbers: numbers.slice(0, 100) });
      return data.issues.nodes.map((i) => ({ identifier: i.identifier, title: i.title, state: i.state, completedAt: i.completedAt, canceledAt: i.canceledAt, attachments: i.attachments.nodes }));
    },
    /** Opens a closed issue again: the team's first not-started state (Todo). */
    async reopen(issueId) {
      const data = await gql(`query($key: String!) { workflowStates(filter: { team: { key: { eq: $key } }, type: { eq: "unstarted" } }) { nodes { id position } } }`, { key: TEAM_KEY });
      const state = [...data.workflowStates.nodes].sort((a, b) => a.position - b.position)[0];
      if (!state) throw new LinearError(`Linear: no not-started state in ${TEAM_KEY}`);
      await gql(`mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`, { id: issueId, input: { stateId: state.id } });
    },
    /** One issue by its id (LAN-12), or null when Linear has none. */
    async issue(identifier) {
      try {
        const data = await gql(`query($id: String!) { issue(id: $id) { id identifier url state { name type } } }`, { id: identifier });
        return data.issue ? { id: data.issue.id, identifier: data.issue.identifier, url: data.issue.url, state: data.issue.state } : null;
      } catch (e) {
        if (e instanceof LinearError && /not found|ENTITY_NOT_FOUND|INVALID_INPUT/i.test(e.message)) return null;
        throw e;
      }
    },
    /** One issue's title and description, for Claude to write a draft fix from. */
    async full(identifier) {
      const data = await gql(`query($id: String!) { issue(id: $id) { id identifier url title description } }`, { id: identifier });
      return data.issue;
    },
    /** A link on an issue (a draft fix's pull request), shown with its title. */
    async attach(issueId, url, title) {
      await gql(`mutation($input: AttachmentCreateInput!) { attachmentCreate(input: $input) { success } }`, { input: { issueId, url, title } });
    },
    async create(input) {
      const data = await gql(`mutation($input: IssueCreateInput!) { issueCreate(input: $input) { issue { id identifier url } } }`, { input });
      return data.issueCreate.issue;
    },
    async comment(issueId, body) {
      await gql(`mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`, { input: { issueId, body } });
    }
  };
}

// ---- the two steps ------------------------------------------------------------------------------

async function oidcToken() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) throw new Error('No GitHub OIDC token here: this runs only in user-issues.yml, with id-token: write.');
  const res = await fetch(`${url}&audience=${encodeURIComponent(AUDIENCE)}`, { headers: { authorization: `bearer ${bearer}` } });
  if (!res.ok) throw new Error(`GitHub OIDC token: HTTP ${res.status}`);
  return (await res.json()).value;
}

export async function call(method, body, query = '') {
  const res = await fetch(`${API}${query}`, {
    method,
    headers: { authorization: `Bearer ${await oidcToken()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const answer = await res.text();
  // The Worker's errors are fixed words; never a person's.
  if (!res.ok) throw new Error(`${method} ${API}: HTTP ${res.status} ${answer.slice(0, 300)}`);
  return JSON.parse(answer);
}

/** One thing to look at, or null when the Worker has none (404). */
async function ask(query) {
  try {
    return await call('GET', undefined, query);
  } catch (e) {
    if (/HTTP 404/.test(e instanceof Error ? e.message : '')) return null;
    throw e;
  }
}

/**
 * Asks the Worker for what the plan names and keeps it in <dir>/evidence, where Claude reads it:
 * the pictures as JPEG files, each phone's build and records as JSON. What could not be had is
 * left out and said in the log by its kind only. Returns where each went.
 */
export async function fetchEvidence(dir, plan, at = ask) {
  const out = join(dir, 'evidence');
  mkdirSync(out, { recursive: true });
  const media = {};
  for (const id of plan.media) {
    media[id] = { screenshot: null, picture: null };
    try {
      const m = await at(`?media=${id}`);
      for (const part of ['screenshot', 'picture']) {
        const bytes = m?.[part] ? Buffer.from(m[part], 'base64') : null;
        if (!bytes || bytes.length < 3 || JPEG.some((b, i) => bytes[i] !== b)) continue;
        const path = join(out, `${id}-${part}.jpg`);
        writeFileSync(path, bytes);
        media[id][part] = path;
      }
    } catch (e) {
      console.log(`evidence: no pictures for a problem sent from help mode (${String(e instanceof Error ? e.message : e).slice(0, 80)})`);
    }
  }
  const phones = {};
  for (const { installId, at: time } of plan.phones) {
    try {
      const phone = await at(`?phone=${encodeURIComponent(installId)}${time ? `&at=${encodeURIComponent(time)}` : ''}`);
      if (!phone) continue;
      const path = join(out, `phone-${installId}.json`);
      writeFileSync(path, JSON.stringify(phone, null, 2));
      phones[installId] = { path, phone };
    } catch (e) {
      console.log(`evidence: no records for a phone (${String(e instanceof Error ? e.message : e).slice(0, 80)})`);
    }
  }
  const pictures = Object.values(media).filter((m) => m.screenshot || m.picture).length;
  console.log(`evidence: pictures for ${pictures} of ${plan.media.length} problems, records for ${Object.keys(phones).length} of ${plan.phones.length} phones`);
  return { media, phones };
}

/** Each kind with where its pictures and phones' records are, and the phone's numbers for a problem sent from help mode. */
export function withEvidence(kinds, got) {
  return kinds.map((k) => {
    const installs = k.feedback ? [k.feedback.installId] : (k.installIds ?? []).slice(0, PHONES_PER_KIND);
    const phones = installs.filter((i) => got.phones[i]).map((i) => got.phones[i].path);
    const m = k.feedback ? got.media[k.feedback.id] : null;
    const evidence = { screenshot: m?.screenshot ?? null, picture: m?.picture ?? null, phones };
    const facts = k.feedback && got.phones[k.feedback.installId] ? phoneFacts(got.phones[k.feedback.installId].phone, k.feedback.at) : null;
    return { ...k, evidence, ...(facts ? { phoneFacts: facts } : {}) };
  });
}

function linearKey() {
  const key = process.env.LINEAR_API_KEY;
  if (!key) throw new Error('No LINEAR_API_KEY: the watch cannot tell anyone. It is a repository secret (docs/diagnostics.md "The watch for user issues").');
  return key;
}

function output(values) {
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`);
  else console.log(lines);
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const headSha = () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

async function fetchWatch(dir) {
  mkdirSync(dir, { recursive: true });
  let watch = await call('GET');
  // Issues closed in Linear are closed for the watch before anything is looked at, so a fixed
  // problem is neither commented on as grown nor handed to Claude.
  if (watch.issues?.length) {
    const states = statesToSend(watch.issues, await linearClient(linearKey()).states(watch.issues.map((i) => i.issue)), gitMerges());
    if (states.length) {
      const done = await call('POST', { sha: headSha(), runUrl: runUrl(process.env), looked: [], grew: [], states });
      for (const s of states) console.log(`${s.issue} is ${s.state} in Linear: ${s.closed ? `closed for the watch${s.fixedBy ? `, fixed by PR ${s.fixedBy}` : ''}` : 'open'}`);
      console.log(`told the Worker: ${done.closed} closed, ${done.reopened} open again`);
      watch = await call('GET');
    }
  }
  if (watch.look.length) watch = { ...watch, look: withEvidence(watch.look, await fetchEvidence(dir, evidencePlan(watch.look))) };
  writeFileSync(join(dir, 'watch.json'), JSON.stringify(watch, null, 2));
  const busy = watch.look.length > 0 || watch.grew.length > 0;
  const issues = busy ? await linearClient(linearKey()).issues(new Date(Date.now() - LINEAR_DAYS * 86_400_000).toISOString()) : [];
  writeFileSync(join(dir, 'linear.json'), JSON.stringify({ issues }, null, 2));
  const notes = Array.isArray(watch.notes) ? watch.notes.length : 0;
  output({ look: watch.look.length, grew: watch.grew.length, notes });
  if (notes) console.log(`watch: ${notes} issues have an admin's instruction from the ops dashboard`);
  const sent = watch.look.filter((k) => k.family === 'feedback').length;
  console.log(`watch: ${watch.active} kinds seen in 7 days; ${watch.look.length} to look at (${sent} sent from help mode), ${watch.grew.length} filed ones grew${busy ? `; ${issues.length} issues from Linear` : ''}`);
}

async function file(dir) {
  const watch = readJson(join(dir, 'watch.json'));
  const linear = readJson(join(dir, 'linear.json'));
  const path = join(dir, 'decisions.json');
  if (watch.look.length && !existsSync(path)) throw new Error('Claude wrote no decisions.json; the kinds come back next run.');
  const plan = checkDecisions(watch.look.length ? readJson(path) : {}, watch, linear);
  for (const d of plan.dropped) console.log(`::warning::decisions.json ${d}`);
  if (plan.undecided.length) console.log(`::warning::${plan.undecided.length} kinds got no verdict and come back next run`);

  const api = linearClient(linearKey());
  const run = runUrl(process.env);
  const kindOf = new Map(watch.look.map((k) => [k.key, k]));
  const looked = [];
  const grew = [];
  let failed = 0;
  const assigneeId = process.env.USER_ISSUES_ASSIGNEE || undefined;
  const team = plan.file.length ? await api.team() : null;
  const merges = plan.fixed.length ? gitMerges() : null;
  const fixes = [];
  const plans = {};

  for (const f of plan.file) {
    const kinds = f.keys.map((k) => kindOf.get(k));
    const input = { teamId: team.teamId, labelIds: [team.labelId], title: `${PREFIX}${f.title}`, description: issueDescription(f, kinds, run), priority: f.priority };
    try {
      let issue;
      try {
        issue = await api.create({ ...input, ...(assigneeId ? { assigneeId } : {}) });
      } catch (e) {
        if (!assigneeId) throw e;
        // A wrong assignee must not stop the alert: filed unassigned, and said.
        console.log(`::warning::could not assign to USER_ISSUES_ASSIGNEE (${e instanceof Error ? e.message : e}); filing unassigned`);
        issue = await api.create(input);
      }
      for (const k of kinds) looked.push(lookedOf(k, 'filed', issue, null, { title: f.title, context: f.context, problem: f.problem, solution: f.solution }));
      if (fixes.length < FIX_MAX) fixes.push(issue.identifier);
      plans[issue.identifier] = f.manager;
      console.log(`filed ${issue.identifier}, priority ${f.priority}: ${f.keys.join(', ')}`);
    } catch (e) {
      failed += 1;
      console.log(`::error::could not file ${f.keys.join(', ')}: ${e instanceof Error ? e.message : e}`);
    }
  }

  for (const k of plan.known) {
    const kinds = k.keys.map((key) => kindOf.get(key));
    try {
      const issue = await api.issue(k.issue);
      if (!issue) {
        console.log(`::warning::${k.issue} is not in Linear; ${k.keys.join(', ')} come back next run`);
        continue;
      }
      await api.comment(issue.id, knownComment(k, kinds, run));
      // Pointed to again after it closed: the fix did not hold, so it is open again.
      const reopen = isClosed(issue.state);
      if (reopen) await api.reopen(issue.id);
      for (const kind of kinds) looked.push(lookedOf(kind, 'known', issue));
      console.log(`known ${issue.identifier}${reopen ? ', reopened' : ''}: ${k.keys.join(', ')}`);
    } catch (e) {
      failed += 1;
      console.log(`::error::could not comment on ${k.issue}: ${e instanceof Error ? e.message : e}`);
    }
  }

  for (const x of plan.noise) looked.push(lookedOf(kindOf.get(x.key), 'noise', null, x.note));
  if (plan.noise.length) console.log(`noise: ${plan.noise.map((x) => x.key).join(', ')}`);

  // Already fixed by a pull request on main: nothing filed. A closed issue's kind keeps its issue.
  for (const x of plan.fixed) {
    const fixedAt = merges.at(x.pr);
    if (!fixedAt) {
      console.log(`::warning::PR ${x.pr} is not a merge into main in this checkout; ${x.keys.join(', ')} come back next run`);
      continue;
    }
    for (const key of x.keys) {
      const kind = kindOf.get(key);
      const closed = kind.before?.verdict === 'fixed' && kind.before.issue ? { identifier: kind.before.issue, url: kind.before.issueUrl } : null;
      looked.push(lookedOf(kind, 'fixed', closed, x.note, { title: x.title, fixedBy: x.pr, fixedAt }));
    }
    console.log(`fixed by PR ${x.pr}: ${x.keys.join(', ')}`);
  }

  const byIssue = new Map();
  for (const g of watch.grew) byIssue.set(g.issue, [...(byIssue.get(g.issue) ?? []), g]);
  for (const [id, grown] of byIssue) {
    try {
      const issue = await api.issue(id);
      if (!issue) {
        console.log(`::warning::${id} is not in Linear any more`);
        continue;
      }
      await api.comment(issue.id, grewComment(grown, issue.state, run));
      for (const g of grown) grew.push({ key: g.key, people: g.people, count: g.count });
      console.log(`grew ${id}: ${grown.map((g) => `${g.key} ${g.peopleBefore} -> ${g.people} people`).join(', ')}`);
    } catch (e) {
      failed += 1;
      console.log(`::error::could not comment on ${id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // The issues an admin left an instruction on go to the fix jobs too, after the new issues.
  // In mode off the team writes no fix and reads no instruction (scripts/agent-team.mjs MODES).
  const off = modeHere() === 'off';
  if (off) console.log('the agent team is off: no fix is written');
  const noted = off ? { fixes: [], taken: [] } : notesToTake(watch.notes, fixes);
  // What was done goes back even when some of it failed, so it is not done twice.
  if (looked.length || grew.length || noted.taken.length) {
    const done = await call('POST', { sha: headSha(), runUrl: run, looked, grew, states: [], notes: noted.taken.map((n) => ({ id: n, taken: true })) });
    console.log(`told the Worker: ${done.looked} kinds looked at, ${done.grew} grown${noted.taken.length ? `, ${done.taken ?? 0} instructions taken` : ''}`);
  }
  // The new issues Claude writes a draft fix for, and the issues with an instruction, in the jobs after this one.
  output({ fixes: JSON.stringify(noted.fixes), plans: JSON.stringify(Object.fromEntries(noted.fixes.map((id) => [id, planOf(plans[id])]))) });
  if (failed) throw new Error(`${failed} Linear calls failed; their kinds come back next run`);
}

const git = (args, input) => execFileSync('git', args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });

/** The issue Claude writes a draft fix for: its title and description (what people wrote, addresses out). */
async function fixContext(dir, id) {
  if (!ISSUE_ID.test(id ?? '')) throw new Error(`not an issue: ${id}`);
  mkdirSync(dir, { recursive: true });
  const issue = await linearClient(linearKey()).full(id);
  if (!issue) throw new Error(`${id} is not in Linear`);
  // What was sent, for the patch step to keep out of this public repository: kept where Claude does not write.
  const priv = privateOf(issue.description);
  if (process.env.FIX_PRIVATE) writeFileSync(process.env.FIX_PRIVATE, JSON.stringify(priv));
  const plan = { media: priv.feedback, phones: priv.installs.slice(0, EVIDENCE_PHONES).map((installId) => ({ installId, at: null })) };
  const got = await fetchEvidence(dir, plan);
  const evidence = {
    pictures: Object.values(got.media).flatMap((m) => [m.screenshot, m.picture]).filter(Boolean),
    phones: Object.values(got.phones).map((p) => p.path)
  };
  // What an admin told Claude to do with it from the ops dashboard, and the draft fix it has, to start from.
  const notes = await ask(`?notes=${id}`).catch((e) => {
    console.log(`${id}: no instructions read (${String(e instanceof Error ? e.message : e).slice(0, 80)})`);
    return null;
  });
  const waiting = Array.isArray(notes?.waiting) ? notes.waiting.filter((n) => isObj(n) && NOTE_ID.test(text(n.id)) && text(n.text).trim()) : [];
  const instructed = waiting.length ? {
    instructions: waiting.map((n) => ({ at: n.at, text: redact(n.text) })),
    before: (Array.isArray(notes.before) ? notes.before : []).map((n) => ({ at: n.at, text: redact(n.text), answer: n.answer ?? null })),
    draft: draftOnto(dir, fixBranch(id))
  } : {};
  if (waiting.length) {
    // The change as it is before Claude (staged, so `git diff` shows only what Claude adds), to say after
    // it whether Claude changed anything: kept where Claude does not write.
    const before = instructed.draft.applied ? worktreeHash(dir) : null;
    // Whether the admin's own words can mean "merge it as it is": read here, where Claude cannot write.
    if (process.env.FIX_NOTES) writeFileSync(process.env.FIX_NOTES, JSON.stringify({ ids: waiting.map((n) => n.id), draft: before, saysMerge: saysMerge(waiting.map((n) => n.text)) }));
  }
  writeFileSync(join(dir, 'issue.json'), JSON.stringify({ identifier: issue.identifier, url: issue.url, title: issue.title, description: redact(issue.description), evidence, ...instructed }, null, 2));
  console.log(`${id}: handed to Claude for a draft fix${waiting.length ? `, with ${plural(waiting.length, 'instruction')} from the ops dashboard${instructed.draft.branch ? ` and its draft fix (${instructed.draft.applied ? 'applied' : 'not applied'})` : ''}` : ''}`);
}

/** Everything changed in the checkout against main, but <dir>, as one patch. */
function worktreePatch(dir) {
  git(['add', '-A', '--', '.', `:(exclude)${dir}`]);
  return git(['diff', '--cached', '--binary']);
}

/** That change's hash, the same in any copy of the repository (full object names). */
function worktreeHash(dir) {
  git(['add', '-A', '--', '.', `:(exclude)${dir}`]);
  return sha256(git(['diff', '--cached', '--binary', '--full-index']));
}

/**
 * The draft fix an issue has already (its branch user-issue/<issue>), applied on this checkout of
 * main, so Claude starts from it. `applied` false: there is none, or it no longer applies to main;
 * then its patch, when it could be read, is in <dir>/draft.patch for Claude to read. Runs nothing of it.
 */
function draftOnto(dir, branch) {
  const none = { branch: null, applied: false, patch: null };
  try {
    if (!git(['ls-remote', '--heads', 'origin', branch]).trim()) return none;
    const ref = `refs/remotes/origin/${branch}`;
    git(['fetch', '-q', '--depth=600', 'origin', `+refs/heads/${branch}:${ref}`]);
    const base = git(['merge-base', 'HEAD', ref]).trim();
    const path = join(dir, 'draft.patch');
    writeFileSync(path, git(['diff', '--binary', base, ref]));
    try {
      git(['apply', path]);
      return { branch, applied: true, patch: path };
    } catch {
      return { branch, applied: false, patch: path };
    }
  } catch (e) {
    console.log(`the draft fix on ${branch} could not be read (${String(e instanceof Error ? e.message : e).split('\n')[0].slice(0, 120)})`);
    return { ...none, branch };
  }
}

/**
 * After Claude: what it changed, as a patch, and its fix.json, checked, in FIX_OUT. Runs nothing
 * of the change. The workflow runs it from a copy made before Claude, with GIT_DIR a copy of the
 * repository made then too, so nothing Claude wrote in the checkout (its .git included) runs here.
 */
function fixPatch(dir) {
  const out = process.env.FIX_OUT || join(dir, 'out');
  mkdirSync(out, { recursive: true });
  const path = join(dir, 'fix.json');
  const small = existsSync(path) && readFileSync(path).length < 100_000;
  const fix = checkFix(small ? (() => { try { return readJson(path); } catch { return {}; } })() : { noFix: 'Claude wrote no fix.json.' });
  let patch = worktreePatch(dir);
  if (!fix.noFix && !patch) fix.noFix = 'Claude changed no file.';
  // With an admin's instructions: their ids, and whether Claude changed the draft fix it started from.
  const notesPath = process.env.FIX_NOTES;
  const notes = notesPath && existsSync(notesPath) ? readJson(notesPath) : null;
  const noteIds = noteIdsOf(notes);
  const changed = Boolean(patch) && (typeof notes?.draft !== 'string' || notes.draft !== worktreeHash(dir));
  // This repository is public: a change or fix.json that carries what was sent is not kept.
  const privPath = process.env.FIX_PRIVATE;
  const priv = privPath && existsSync(privPath) ? readJson(privPath) : null;
  if (priv && leaks([patch, fix.summary, fix.tests, fix.noFix, fix.answer, fix.cause, fix.proof, fix.why, fix.twins].join('\n'), priv)) {
    fix.noFix = 'Claude\'s change carried part of what was sent (the person\'s words or an id), and this repository is public, so it was not kept.';
    fix.summary = '';
    fix.tests = '';
    fix.answer = '';
    Object.assign(fix, { verdict: 'review', cause: '', proof: '', why: '', twins: '' });
    patch = '';
  }
  // A verdict that means "no change" with a change, or "approved" without the admin's word, is a change a developer reads.
  if (patch && ['not_a_bug', 'unconfirmed'].includes(fix.verdict)) fix.verdict = 'review';
  // "Merge it as it is": the admin's words say so, the manager's verdict is `approved`, and the draft fix is as it was.
  const approved = noteIds.length > 0 && notes?.saysMerge === true && fix.verdict === 'approved' && Boolean(patch) && !changed;
  if (fix.verdict === 'approved' && !approved) fix.verdict = 'review';
  // A display fix: the steps to the screen, which the picture job runs without the change and with it.
  // They are not part of the change. Like the change, they may carry nothing of what was sent.
  const specPath = join(dir, PICTURE_SPEC);
  if (patch && fix.display && existsSync(specPath) && readFileSync(specPath).length < 20_000) {
    const spec = readFileSync(specPath, 'utf8');
    if (!priv || !leaks(spec, priv)) writeFileSync(join(out, PICTURE_SPEC), spec);
  }
  if (noteIds.length) writeFileSync(join(out, 'notes.json'), JSON.stringify({ ids: noteIds, changed: changed && Boolean(patch), approved }));
  // The manager's model and effort, as the workflow set them for this job.
  writeFileSync(join(out, 'plan.json'), JSON.stringify(planOf({ model: process.env.FIX_MODEL, effort: process.env.FIX_EFFORT })));
  writeFileSync(join(out, 'fix.json'), JSON.stringify(fix, null, 2));
  if (!fix.noFix) writeFileSync(join(out, 'fix.patch'), patch);
  console.log(fix.noFix ? 'no draft fix' : `a draft fix: ${patch.length} bytes`);
}

/** Refuses a patch that changes what a draft fix may not: the paths as git reads them, before it is applied. */
function fixPaths(patchPath) {
  const patch = readFileSync(patchPath);
  const paths = [...new Set([...pathsOf(git(['apply', '--numstat', '-z', patchPath])), ...oldPathsOf(patch.toString('utf8'))])];
  const reason = fixRefusal(paths, patch.length);
  if (reason) throw new Error(`refused the draft fix: ${reason}`);
  git(['apply', '--check', patchPath]);
  console.log('the draft fix changes only what it may');
}

const github = (method, path, body, token) => githubAs(method, path, body, token ?? process.env.GITHUB_TOKEN);

/** The labels of the team's pull requests (.github/labels.json): the one it has now, and not the other. Best effort. */
async function label(pr, merge) {
  try {
    await github('POST', `/issues/${pr}/labels`, { labels: [merge ? LABELS.merge : LABELS.waits] });
    await github('DELETE', `/issues/${pr}/labels/${merge ? LABELS.waits : LABELS.merge}`);
  } catch {
    console.log(`::warning::PR ${pr}: its label was not set`);
  }
}

/** Auto-merge through the merge queue, as LangQuest's GitHub App (tutorial-review.mjs does the same). False when GitHub refused. */
function autoMerge(pr) {
  try {
    execFileSync('gh', ['pr', 'merge', String(pr), '--auto', '-R', REPO], { env: { ...process.env, GH_TOKEN: process.env.PR_TOKEN }, stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

/**
 * The fix, from the job that runs nothing of it. The gate (scripts/agent-team.mjs) says what happens:
 * a pull request that merges without a person (opened by LangQuest's GitHub App, so its checks start,
 * with auto-merge on), or a draft that waits for a developer; or the issue says why there is none.
 * The Worker is told each time, for the record on the ops dashboard. Never runs npm or the patch's
 * code, and git runs no hook here (no npm install set one).
 */
async function fixOpen(dir, id) {
  if (!ISSUE_ID.test(id ?? '')) throw new Error(`not an issue: ${id}`);
  if (!process.env.GITHUB_TOKEN) throw new Error('No GITHUB_TOKEN: the job that opens the draft fix needs it.');
  const api = linearClient(linearKey());
  const run = runUrl(process.env);
  const issue = await api.full(id);
  if (!issue) throw new Error(`${id} is not in Linear`);
  const fixPath = join(dir, 'fix', 'fix.json');
  const fix = existsSync(fixPath) ? checkFix(readJson(fixPath)) : { ...checkFix({}), noFix: 'The job that writes it failed.', summary: '', tests: '' };
  // The manager's own patch, from the job that took it. The copy from the checks' job (with what the hooks
  // rebuild) goes only on a draft a developer reads: the patch's code ran in that job.
  const ownPath = join(dir, 'fix', 'fix.patch');
  const checkedPath = join(dir, 'check', 'fix.patch');
  const checkPath = join(dir, 'check', 'check.json');
  const checks = checkResults(existsSync(checkPath) ? readJson(checkPath) : {});
  const planPath = join(dir, 'fix', 'plan.json');
  const plan = existsSync(planPath) ? planOf(readJson(planPath)) : {};
  // An admin's instructions this run has (the fix job names them): the Worker is told what was done with them.
  const notesPath = join(dir, 'fix', 'notes.json');
  const notes = existsSync(notesPath) ? readJson(notesPath) : null;
  const noteIds = noteIdsOf(notes);
  const input = gateInput(dir);
  const shots = { before: pictureOf(join(dir, 'picture', PICTURES.before)), after: pictureOf(join(dir, 'picture', PICTURES.after)) };
  const decision = gate({ mode: modeHere(), ...input, app: Boolean(process.env.PR_TOKEN) });
  const team = { decision, vet: input.vet };
  /** One message to the Worker: the record of the fix, and Claude's answer to the instructions. */
  const tell = async ({ record = null, result = null, pr = null, extra = '' }) => {
    const answers = noteIds.length && result ? noteIds.map((n) => ({ id: n, result, answer: noteAnswer(fix, result, extra) || null, pr })) : [];
    if (!record && !answers.length) return;
    const done = await call('POST', { sha: headSha(), runUrl: run, looked: [], grew: [], states: [], notes: answers, fixes: record ? [record] : [] });
    console.log(`${id}: told the Worker${record ? ` the fix ${record.decision === 'merge' ? 'merges without a person' : record.decision === 'waits' ? `waits (${record.reason})` : `has no change (${record.reason})`}` : ''}${answers.length ? `${record ? ' and' : ''} Claude's answer to ${plural(done.answered ?? 0, 'instruction')} (${result})` : ''}`);
  };
  const waits = (pr, d = decision) => fixRecord(id, { decision: 'waits', reason: d.reason ?? 'review', why: d.why, pr }, fix, plan, input.vet, shots);

  let reason = fix.noFix || (existsSync(ownPath) ? null : 'Its patch is missing.');
  if (!reason) {
    try {
      fixPaths(ownPath);
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
    }
  }
  if (reason) {
    // An instruction's answer goes to its card; a new issue's missing fix is said in Linear and on its card.
    if (noteIds.length) await tell({ result: fix.answer || fix.noFix ? 'answered' : 'none', extra: fix.answer && fix.noFix ? '' : reason });
    else {
      await api.comment(issue.id, noFixComment(reason, run));
      const why = input.changes.length ? reason : decision.why || reason;
      await tell({ record: fixRecord(id, { decision: 'none', reason: input.changes.length ? 'paths' : decision.reason ?? 'unconfirmed', why }, fix, plan, input.vet, shots) });
    }
    console.log(`${id}: no fix (${reason.slice(0, 200)})`);
    return;
  }
  const branch = fixBranch(id);
  const title = `${id}: ${String(issue.title ?? '').replace(PREFIX, '').slice(0, 120)}`;
  const message = `${title}

${fix.summary}

A fix Claude wrote for the watch for user issues: ${run}
`;
  const author = ['-c', `user.name=${FIX_BOT.name}`, '-c', `user.email=${FIX_BOT.email}`];
  if (git(['ls-remote', '--heads', 'origin', branch]).trim()) {
    if (!noteIds.length) {
      console.log(`${id}: ${branch} is there already; nothing done`);
      return;
    }
    const open = await github('GET', `/pulls?head=${REPO.split('/')[0]}:${branch}&state=open&per_page=1`);
    const found = Array.isArray(open.json) ? open.json[0] : null;
    const pr = found ? { number: found.number, url: found.html_url } : null;
    // "Merge it": the draft fix the admin read, as it is, by the admin's own word.
    if (notes.approved === true && pr) {
      if (!decision.merge) {
        await tell({ record: waits(pr.number), result: 'answered', pr: pr.number, extra: `The draft fix did not merge. ${decision.why}` });
        console.log(`${id}: the admin said to merge PR ${pr.number}, and the gate says it waits (${decision.reason})`);
        return;
      }
      await github('PATCH', `/pulls/${pr.number}`, { body: fixBody(issue, fix, checks, run, team) });
      // LangQuest's GitHub App marks it ready, so its checks start, and turns on auto-merge.
      const ready = found.draft !== true || (await graphql('mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }', { id: found.node_id }, process.env.PR_TOKEN))?.markPullRequestReadyForReview?.pullRequest?.isDraft === false;
      const merging = ready && autoMerge(pr.number);
      if (!merging) {
        await tell({ record: waits(pr.number, { reason: 'app', why: 'GitHub did not let the App make the pull request ready and turn on auto-merge.' }), result: 'answered', pr: pr.number, extra: 'GitHub did not let the workflow merge the draft fix. Mark it Ready for review and merge it on GitHub.' });
        return;
      }
      await label(pr.number, true);
      await api.comment(issue.id, fixComment(pr, checks, decision));
      await tell({ record: fixRecord(id, { decision: 'merge', why: decision.why, pr: pr.number }, fix, plan, input.vet, shots), result: 'answered', pr: pr.number, extra: 'The draft fix merges when its checks pass.' });
      console.log(`${id}: PR ${pr.number} merges without a person, as an admin said`);
      return;
    }
    if (notes.changed !== true) {
      await tell({ result: 'answered' });
      console.log(`${id}: Claude answered and left the draft fix as it is`);
      return;
    }
    if (!pr) {
      await tell({ result: 'answered', extra: 'The pull request of the draft fix is not open, so the draft fix did not change.' });
      console.log(`${id}: ${branch} has no open pull request; nothing pushed`);
      return;
    }
    const patchPath = existsSync(checkedPath) ? checkedPath : ownPath;
    try {
      // One commit on the branch with the change as it is now on main: the branch's head and main are its parents.
      const ref = `refs/remotes/origin/${branch}`;
      git(['fetch', '-q', '--depth=1', 'origin', `+refs/heads/${branch}:${ref}`]);
      git(['apply', '--index', patchPath]);
      const commit = git([...author, 'commit-tree', git(['write-tree']).trim(), '-p', git(['rev-parse', ref]).trim(), '-p', 'HEAD', '-F', '-'], message).trim();
      git(['push', '-q', 'origin', `${commit}:refs/heads/${branch}`]);
    } catch (e) {
      await tell({ result: 'none', pr: pr.number, extra: 'The workflow could not put the change on the draft fix (see the run).' });
      throw e;
    }
    // A change after an instruction waits for the developer who sent it.
    const d = decision.merge ? { reason: 'instruction', why: 'It follows an instruction from the ops dashboard. The developer who sent it reads the change.' } : decision;
    await github('PATCH', `/pulls/${pr.number}`, { body: fixBody(issue, fix, checks, run, { decision: { merge: false, ...d }, vet: input.vet }) });
    // The built-in token's push starts no checks. A draft's checks run when a person marks it Ready for review.
    const draft = found.draft === true || (await toDraft(found.node_id));
    await label(pr.number, false);
    await api.comment(issue.id, updateComment(pr, checks));
    await tell({ record: waits(pr.number, d), result: 'changed', pr: pr.number, extra: draft ? '' : 'The pull request is not a draft, so its checks did not run on this change. Push to it or open it again to run them.' });
    console.log(`${id}: draft fix PR ${pr.number} changed after an instruction`);
    return;
  }
  // A new fix. One that merges without a person is the manager's own patch, opened by the App.
  const patchPath = decision.merge || !existsSync(checkedPath) ? ownPath : checkedPath;
  git(['checkout', '-b', branch]);
  git(['apply', '--index', patchPath]);
  git([...author, 'commit', '--no-verify', '-q', '-F', '-'], message);
  git(['push', '-q', 'origin', `HEAD:refs/heads/${branch}`]);
  const made = await github('POST', '/pulls', { title, head: branch, base: 'main', body: fixBody(issue, fix, checks, run, team), draft: !decision.merge }, decision.merge ? process.env.PR_TOKEN : undefined);
  if (made.status !== 201) {
    console.log(`::error title=Needs you%3A pull requests from Actions::GitHub answered ${made.status} (${String(made.json.message ?? '').slice(0, 200)}) to the fix for ${id}; the branch ${branch} is pushed. ${decision.merge ? 'LangQuest\'s GitHub App needs Pull requests write on this repository.' : 'Turn on "Allow GitHub Actions to create and approve pull requests" with npm run github:rules -- --apply.'}`);
    await api.comment(issue.id, branchComment(branch, run));
    await tell({ result: 'changed', extra: `The fix is on the branch ${branch}. GitHub did not let the workflow open its pull request.` });
    return;
  }
  const pr = { number: made.json.number, url: made.json.html_url };
  let final = decision;
  if (decision.merge && !autoMerge(pr.number)) {
    // Without auto-merge nothing merges it: it waits, as a draft, and says so.
    final = { merge: false, reason: 'app', why: 'GitHub did not turn on auto-merge for the pull request.' };
    await toDraft(made.json.node_id, process.env.PR_TOKEN);
    await github('PATCH', `/pulls/${pr.number}`, { body: fixBody(issue, fix, checks, run, { decision: final, vet: input.vet }) });
  }
  await label(pr.number, final.merge);
  await api.attach(issue.id, pr.url, `PR ${pr.number}: ${final.merge ? 'fix' : 'draft fix'} by Claude`);
  await api.comment(issue.id, fixComment(pr, checks, final));
  await tell({ record: final.merge ? fixRecord(id, { decision: 'merge', why: final.why, pr: pr.number }, fix, plan, input.vet, shots) : waits(pr.number, final), result: 'changed', pr: pr.number });
  console.log(`${id}: PR ${pr.number} ${final.merge ? 'merges without a person' : `waits for a developer (${final.reason})`}`);
}

const COMMANDS = { fetch: fetchWatch, file, 'fix-context': fixContext, 'fix-patch': fixPatch, 'fix-paths': fixPaths, 'fix-open': fixOpen };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, dir, id] = process.argv.slice(2);
  if (!dir || !Object.hasOwn(COMMANDS, command)) {
    console.error(`usage: node scripts/user-issues.mjs <${Object.keys(COMMANDS).join('|')}> <dir or patch> [issue]`);
    process.exit(2);
  }
  try {
    await COMMANDS[command](dir, id);
  } catch (e) {
    console.error(`::error::${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
