#!/usr/bin/env node
// After a merge into main, Claude reads what it changed and every open issue
// of the LangQuest Next team in Linear, and says which issues the merge fixes
// and which it is part of, though no commit names them
// (docs/decisions/2026-11-24-a-merge-closes-the-issues-it-fixes.md). Linear
// is where an issue's state lives; the watch for user issues reads it from
// there for the ops dashboard's cards. Run by .github/workflows/linear-sync.yml:
//
//   context <dir> --from <sha> --to <sha>   the pull requests a push merged, and the open issues,
//                                           into <dir>/merges.json and <dir>/issues.json; n=<merges> to GITHUB_OUTPUT
//   context <dir> --days <n> [--skip LAN-1,LAN-2]
//                                           the sweep: every pull request merged in the last n days
//                                           (not the last 2 hours: the run of their own push checks those),
//                                           by number, commit, time and title only
//   apply <dir> --from-copy <dir2> [--to <sha>] [--dry-run]
//                                           Claude's <dir>/decisions.json, checked against the copy of
//                                           merges.json and issues.json made before Claude, to Linear
//
// Claude writes <dir>/decisions.json (the merge-issues skill,
// .agents/skills/merge-issues/SKILL.md):
//   { "decisions": [{ "issue": "LAN-12", "pr": 674, "verdict": "fixed" | "part", "why": "..." }] }
//
// fixed: the issue moves as if the pull request had named it (scripts/linear-sync.mjs):
// to Deploying with the lanes the merge reaches, or Live when it reaches none. A
// merge of the sweep shipped before the check, so its issue goes Live. It gets the
// pull request as a link, so the watch names it as the fix. part: a comment only. A comment carries a mark (MARK below), and an
// issue is never told twice about the same pull request: a developer who moves
// it back keeps it there.
//
// What the issues say stays off this public repository's log: the log names
// only issue ids, pull request numbers and verdicts.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deployingComment, dryApi, lanesFor, linearApi, move, TEAM_KEY } from './linear-sync.mjs';

/** Linear states that mean the change already merged: the issue is not open for this check. */
export const MERGED_STATES = ['Deploying', 'Verifying'];
/** How much of each issue's description Claude gets: enough to know what it asks. */
export const DESCRIPTION_MAX = 1500;
export const BODY_MAX = 3000;
export const FILES_MAX = 200;
export const WHY_MAX = 500;
/** More fixes than this from one pull request is a misreading, not a fix: none of them is applied. */
export const FIXED_PER_PR = 8;
/** The sweep leaves the newest merges to the run of their own push, whose lanes may still be out. */
export const SWEEP_SKIP_MS = 2 * 3600_000;
const ISSUE = new RegExp(`^${TEAM_KEY}-\\d{1,7}$`);
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const URL_RE = /https?:\/\/\S+/g;

/** The mark on each comment, by which a later run knows the issue heard of this pull request. */
export const mark = (pr) => `merge-issues · PR ${pr}`;

/**
 * Merges into main from `git log --first-parent --merges --format=%H%x1f%cI%x1f%s%x1f%b%x1e`:
 * each pull request's number, its merge commit, when it merged and its title (the body's first line).
 */
export function mergesOf(log) {
  return log.split('\x1e').map((e) => e.trim()).filter(Boolean).flatMap((e) => {
    const [sha, at, subject, body = ''] = e.split('\x1f');
    const m = /^Merge pull request #(\d+) from /.exec(subject ?? '');
    if (!m || !sha) return [];
    return [{ pr: Number(m[1]), sha: sha.trim(), mergedAt: at, title: body.trim().split('\n')[0].slice(0, 300) }];
  });
}

/** The open issues Claude judges: not done, not already merged, not skipped. Words cut, nothing else kept. */
export function openForCheck(issues, skip = []) {
  return issues
    .filter((i) => ISSUE.test(i.identifier) && !MERGED_STATES.includes(i.state) && !skip.includes(i.identifier))
    .map((i) => ({
      issue: i.identifier, title: String(i.title ?? '').slice(0, 300), state: i.state, labels: i.labels ?? [], createdAt: i.createdAt,
      description: String(i.description ?? '').slice(0, DESCRIPTION_MAX),
      prs: [...new Set((i.links ?? []).map((u) => Number(/\/pull\/(\d+)/.exec(u ?? '')?.[1])).filter((n) => n > 0))]
    }));
}

/** Claude's reason, as Linear shows it: one paragraph, no address, no link. */
export function cleanWhy(v) {
  if (typeof v !== 'string') return null;
  const t = v.replace(URL_RE, '').replace(EMAIL, '').replace(/\s+/g, ' ').trim();
  return t.length >= 10 ? t.slice(0, WHY_MAX) : null;
}

/**
 * Claude's decisions, kept only when each names an open issue of the copy made
 * before Claude, a pull request of this run, a known verdict and a reason. One
 * per issue: a fix wins over a part, then the newest pull request. A pull
 * request that claims more than FIXED_PER_PR fixes keeps none of them.
 */
export function cleanDecisions(raw, issues, merges) {
  const open = new Set(issues.map((i) => i.issue));
  const prs = new Map(merges.map((m) => [m.pr, m]));
  const list = Array.isArray(raw?.decisions) ? raw.decisions : [];
  const refused = [];
  const kept = [];
  for (const d of list.slice(0, 500)) {
    const issue = String(d?.issue ?? '').toUpperCase();
    const pr = Number(d?.pr);
    const why = cleanWhy(d?.why);
    if (!open.has(issue)) refused.push(`${issue || '?'}: not an open issue`);
    else if (!prs.has(pr)) refused.push(`${issue}: PR ${d?.pr} is not a merge of this run`);
    else if (d?.verdict !== 'fixed' && d?.verdict !== 'part') refused.push(`${issue}: no verdict`);
    else if (!why) refused.push(`${issue}: no reason`);
    else kept.push({ issue, pr, verdict: d.verdict, why });
  }
  const fixedBy = new Map();
  for (const d of kept) if (d.verdict === 'fixed') fixedBy.set(d.pr, (fixedBy.get(d.pr) ?? 0) + 1);
  const tooMany = new Set([...fixedBy].filter(([, n]) => n > FIXED_PER_PR).map(([pr]) => pr));
  for (const pr of tooMany) refused.push(`PR ${pr}: claims ${fixedBy.get(pr)} fixes, more than ${FIXED_PER_PR}`);
  const byIssue = new Map();
  const rank = (d) => (d.verdict === 'fixed' ? 1e9 : 0) + d.pr;
  for (const d of kept) {
    if (d.verdict === 'fixed' && tooMany.has(d.pr)) continue;
    const had = byIssue.get(d.issue);
    if (!had || rank(d) > rank(had)) byIssue.set(d.issue, d);
  }
  return { decisions: [...byIssue.values()], refused };
}

const day = (iso) => String(iso ?? '').slice(0, 10);

/** The comment for one decision. Linear is private to the team; the reason is Claude's. */
export function commentFor(d, merge, repo) {
  // "PR 674", never "#674": Linear links a bare number to another repository.
  const pr = `[PR ${d.pr}](https://github.com/${repo}/pull/${d.pr})`;
  const head = d.verdict === 'fixed' ? `**Fixed by ${pr}**` : `**Part of the work: ${pr}**`;
  return [
    `${head} (${merge.title}), merged ${day(merge.mergedAt)}.`,
    '',
    d.why,
    '',
    d.verdict === 'fixed'
      ? `Claude checked this merge against the team's open issues. Not right? Move the issue back: this check never moves it again for PR ${d.pr}.`
      : `Claude checked this merge against the team's open issues. The issue stays open.`,
    '',
    `${mark(d.pr)} · ${d.verdict}`
  ].join('\n');
}

/**
 * Where a fixed issue goes: as linear-sync's `deploying` does for an issue a
 * commit names, Deploying with the lanes the merge reaches (they report against
 * the push's head, `head`), or Live when it reaches none. The sweep's merges
 * shipped before it ran: Live.
 */
export function targetFor(files, head, sweep) {
  const lanes = sweep ? [] : lanesFor(files);
  return lanes.length ? { state: 'Deploying', line: deployingComment(head, lanes) } : { state: 'Live', line: sweep ? 'Live · it merged before this check' : `Live ${head.slice(0, 7)} · no deploy lane touched` };
}

/** Each decision to Linear. Returns the lines for the log: ids, numbers and verdicts only. */
export async function apply(api, decisions, merges, { head, sweep, repo }) {
  const byPr = new Map(merges.map((m) => [m.pr, m]));
  const out = [];
  for (const d of decisions) {
    const merge = byPr.get(d.pr);
    const issue = await api.getIssue(d.issue);
    if (!issue) {
      out.push(`${d.issue} not found`);
      continue;
    }
    if ((issue.comments ?? []).some((c) => c.includes(mark(d.pr)))) {
      out.push(`${d.issue} already heard of PR ${d.pr}`);
      continue;
    }
    const body = commentFor(d, merge, repo);
    // A part gets no link: Linear's GitHub integration may close an issue that a merged pull request is linked to.
    if (d.verdict === 'part') {
      await api.comment(issue.id, body);
      out.push(`${d.issue} part of PR ${d.pr}`);
      continue;
    }
    // The link first, then the move: the state this check sets is the last one.
    await api.link(issue.id, `https://github.com/${repo}/pull/${d.pr}`, merge.title || `PR ${d.pr}`);
    const to = targetFor(merge.files ?? [], sweep ? merge.sha : head, sweep);
    out.push(`${await move(api, issue, to.state, `${body}\n\n${to.line}`)} (fixed by PR ${d.pr})`);
  }
  return out;
}

// --- CLI --------------------------------------------------------------------

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const ZEROS = /^0+$/;
const FORMAT = '--format=%H%x1f%cI%x1f%s%x1f%b%x1e';

function flags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const name = argv[i].slice(2);
    out[name] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

function output(values) {
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`);
  else console.log(lines);
}

/** A pull request's description, from GitHub; empty when it cannot be read (Claude still has the change). */
async function bodyOf(pr) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  if (!repo) return '';
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${pr}`, {
      headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) }
    });
    if (!res.ok) return '';
    return String((await res.json()).body ?? '').slice(0, BODY_MAX);
  } catch {
    return '';
  }
}

async function context(dir, opt, api) {
  let merges;
  if (opt.days) {
    const days = Math.min(Math.max(Number(opt.days) || 0, 1), 120);
    const cut = Date.now() - SWEEP_SKIP_MS;
    merges = mergesOf(git('log', '--first-parent', '--merges', `--since=${days} days ago`, FORMAT, 'HEAD')).filter((m) => Date.parse(m.mergedAt) < cut);
  } else {
    const range = opt.from && !ZEROS.test(opt.from) ? [`${opt.from}..${opt.to}`] : ['-1', opt.to];
    merges = mergesOf(git('log', '--first-parent', '--merges', FORMAT, ...range));
  }
  // The sweep reads hundreds of merges: number, commit, time and title only, and Claude runs git show on
  // the ones an issue points to. A push's merges come whole: what each changed, and its description.
  if (!opt.days) {
    for (const m of merges) {
      m.files = git('diff', '--name-only', `${m.sha}^1`, m.sha).split('\n').map((f) => f.trim()).filter(Boolean).slice(0, FILES_MAX);
      m.body = await bodyOf(m.pr);
    }
  }
  const skip = (typeof opt.skip === 'string' ? opt.skip : '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const issues = merges.length ? openForCheck(await api.openIssues(), skip) : [];
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'merges.json'), JSON.stringify(merges, null, 2));
  writeFileSync(join(dir, 'issues.json'), JSON.stringify(issues, null, 2));
  console.log(`${merges.length} merges (${merges.map((m) => `PR ${m.pr}`).join(', ') || 'none'}), ${issues.length} open issues`);
  output({ n: merges.length && issues.length ? merges.length : 0 });
}

async function main() {
  const [command, dir, ...rest] = process.argv.slice(2);
  const opt = flags(rest);
  const key = process.env.LINEAR_API_KEY;
  if (!dir || !['context', 'apply'].includes(command)) {
    console.error('usage: merge-issues.mjs context <dir> (--from <sha> --to <sha> | --days <n>) | apply <dir> --from-copy <dir> [--to <sha>] [--dry-run]');
    process.exit(2);
  }
  if (!opt['dry-run'] && !key) {
    console.error('::error::Add the LINEAR_API_KEY secret; the issues a merge fixed cannot be closed without it.');
    process.exit(1);
  }
  const api = opt['dry-run'] && command === 'apply' ? dryApi() : linearApi(key);
  if (command === 'context') return context(dir, opt, api);
  // The copy made before Claude: Claude could write in <dir>.
  const copy = opt['from-copy'] ?? dir;
  const merges = JSON.parse(readFileSync(join(copy, 'merges.json'), 'utf8'));
  const issues = JSON.parse(readFileSync(join(copy, 'issues.json'), 'utf8'));
  let raw;
  try {
    raw = JSON.parse(readFileSync(join(dir, 'decisions.json'), 'utf8'));
  } catch {
    console.error('::error::Claude wrote no decisions.json: no issue was checked against this merge.');
    process.exit(1);
  }
  const { decisions, refused } = cleanDecisions(raw, issues, merges);
  for (const r of refused) console.log(`refused: ${r}`);
  const lines = await apply(api, decisions, merges, { head: String(opt.to ?? merges.at(-1)?.sha ?? ''), sweep: !!opt.sweep, repo: process.env.GITHUB_REPOSITORY ?? 'genesis-ai-dev/langquest-next' });
  for (const line of lines) console.log(line);
  if (!lines.length) console.log('no open issue is fixed or moved forward by these merges');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
