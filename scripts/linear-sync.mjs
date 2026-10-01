// Moves Linear issues through Deploying, Live and Outage as a push to main
// ships (decisions.md 53). Issues are the ones named in commit messages
// (`LAN-12`). The state lives in the issue itself, as three kinds of comment,
// so no store is needed and the issue shows progress as it happens:
//
//   Deploying abc1234 · lanes: ios, android
//   Lane ios ok · abc1234
//   Lane ios failed · abc1234 · https://...
//
//   deploying --from <sha> --to <sha>   push landed: every named issue moves
//                                       to Deploying, listing the lanes the
//                                       changed files reach. No lane: Live.
//   lane --name <lane> --sha <sha> --status ok|failed [--url <url>]
//                                       a lane reports. All lanes ok: Live.
//                                       Any failed: Outage.
//
// Add --dry-run to print what would change without calling Linear.
// LINEAR_API_KEY is required otherwise; missing, the script fails rather
// than skipping, as a deploy that could not report is never silent.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const TEAM_KEY = 'LAN';

// What the EAS workflow (apps/mobile/.eas/workflows/deploy-to-testers.yml)
// builds from. Keep in step with its `paths` filter.
const APP = ['apps/mobile/**', 'packages/**', 'package.json', 'package-lock.json'];
const APP_NOT = ['apps/mobile/.eas/**', '**/*.md'];

const TERMINAL = ['Canceled', 'Duplicate'];

/** Issue IDs named in a commit message, upper-cased, in order, without repeats. */
export function issueIds(message, key = TEAM_KEY) {
  const found = message.match(new RegExp(`\\b${key}-\\d+\\b`, 'gi')) ?? [];
  return [...new Set(found.map((id) => id.toUpperCase()))];
}

/** A revert names the issue it undoes; that work is no longer live. */
export function isRevert(message) {
  return /^revert\b/i.test(message.trim());
}

/**
 * The deploy lanes a set of changed files reaches. Empty: nothing ships.
 * Only the app lanes report: Cloudflare and Supabase deploy through their own
 * integrations and cannot tell us, so a change to them alone is not tracked.
 */
export function lanesFor(files) {
  const list = files.map((file) => file.trim()).filter(Boolean);
  const app = list.some((file) => globMatch(APP, file) && !globMatch(APP_NOT, file));
  return app ? ['ios', 'android'] : [];
}

function globMatch(patterns, file) {
  return patterns.some((pattern) => {
    let source = '';
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === '*' && pattern[i + 1] === '*') {
        source += '.*';
        i++;
      } else if (c === '*') source += '[^/]*';
      else source += /[\\.^$+{}()|[\]?]/.test(c) ? `\\${c}` : c;
    }
    return new RegExp(`^${source}$`).test(file);
  });
}

/** Whether an issue in `from` may move to `to`. Never reopens or skips back. */
export function mayMove(from, to) {
  if (TERMINAL.includes(from) || from === to) return false;
  if (to === 'Outage') return from === 'Deploying' || from === 'Live';
  return true; // Deploying and Live are reachable from any open state, Outage included
}

const short = (sha) => sha.slice(0, 7);

export const deployingComment = (sha, lanes) =>
  `Deploying ${short(sha)} · lanes: ${lanes.join(', ')}`;
export const laneComment = (name, status, sha, url) =>
  [`Lane ${name} ${status}`, short(sha), url].filter(Boolean).join(' · ');

/** From an issue's comments: the lanes a push waits on, and how each reported. */
export function progress(comments, sha) {
  const at = short(sha);
  let lanes = null;
  const reported = {};
  for (const body of comments) {
    const deploy = body.match(/^Deploying (\w+) · lanes: (.+)$/m);
    if (deploy && deploy[1] === at) lanes = deploy[2].split(', ');
    const lane = body.match(/^Lane (\w+) (ok|failed) · (\w+)/m);
    if (lane && lane[3] === at) reported[lane[1]] = lane[2];
  }
  return { lanes, reported };
}

/** What a report decides: still waiting, live, or outage. */
export function verdict({ lanes, reported }) {
  if (!lanes) return 'unknown';
  if (Object.values(reported).includes('failed')) return 'Outage'; // any lane, or a gate such as checks
  if (lanes.every((lane) => reported[lane] === 'ok')) return 'Live';
  return 'waiting';
}

/** Move one issue, and say so. `api` is the Linear client (or a fake). */
async function move(api, issue, target, comment) {
  if (comment) await api.comment(issue.id, comment);
  if (!mayMove(issue.state, target)) return `${issue.identifier} stays ${issue.state}`;
  await api.setState(issue, target);
  return `${issue.identifier} ${issue.state} → ${target}`;
}

/** The push landed. `commits` is [{ sha, message }]; `files` the paths it changed. */
export async function deploying(api, commits, files) {
  const head = commits[commits.length - 1];
  const lanes = lanesFor(files);
  const out = [];
  const reverted = new Set();
  const named = new Set();
  for (const { message } of commits) {
    for (const id of issueIds(message)) (isRevert(message) ? reverted : named).add(id);
  }
  for (const id of reverted) {
    const issue = await api.getIssue(id);
    if (issue) out.push(await move(api, issue, 'Outage', `Reverted in ${short(head.sha)}`));
  }
  for (const id of named) {
    if (reverted.has(id)) continue;
    const issue = await api.getIssue(id);
    if (!issue) {
      out.push(`${id} not found`);
      continue;
    }
    if (lanes.length === 0) {
      out.push(await move(api, issue, 'Live', `Live ${short(head.sha)} · no deploy lane touched`));
    } else {
      out.push(await move(api, issue, 'Deploying', deployingComment(head.sha, lanes)));
    }
  }
  return out;
}

/** A lane reports for the push `sha`. */
export async function reportLane(api, { name, sha, status, url }) {
  const out = [];
  for (const issue of await api.listDeploying()) {
    if (!progress(issue.comments, sha).lanes) continue;
    const body = laneComment(name, status, sha, url);
    await api.comment(issue.id, body);
    // Read after writing: of two lanes finishing together, the later sees both.
    const decided = verdict(progress([...issue.comments, body, ...(await api.comments(issue.id))], sha));
    if (decided === 'Live' || decided === 'Outage') out.push(await move(api, issue, decided));
    else out.push(`${issue.identifier} waiting`);
  }
  if (out.length === 0) out.push(`no Deploying issue is waiting on ${short(sha)}`);
  return out;
}

// --- Linear -----------------------------------------------------------------

export function linearApi(key, fetchImpl = fetch) {
  async function gql(query, variables) {
    const res = await fetchImpl('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: key },
      body: JSON.stringify({ query, variables })
    });
    const json = await res.json();
    if (!res.ok || json.errors) throw new Error(`Linear: ${JSON.stringify(json.errors ?? res.status)}`);
    return json.data;
  }
  const ISSUE = `id identifier state { name } team { states { nodes { id name } } }
    comments(first: 100) { nodes { body } }`;
  const shape = (node) => ({
    id: node.id,
    identifier: node.identifier,
    state: node.state.name,
    states: Object.fromEntries(node.team.states.nodes.map((s) => [s.name, s.id])),
    comments: node.comments.nodes.map((c) => c.body)
  });
  return {
    async getIssue(id) {
      try {
        return shape((await gql(`query($id: String!) { issue(id: $id) { ${ISSUE} } }`, { id })).issue);
      } catch (err) {
        if (/not found/i.test(String(err))) return null;
        throw err;
      }
    },
    async listDeploying() {
      const data = await gql(
        `query($key: String!) { issues(first: 50, filter: {
           team: { key: { eq: $key } }, state: { name: { eq: "Deploying" } } }) {
           nodes { ${ISSUE} } } }`,
        { key: TEAM_KEY }
      );
      return data.issues.nodes.map(shape);
    },
    async comments(issueId) {
      const data = await gql(
        `query($id: String!) { issue(id: $id) { comments(first: 100) { nodes { body } } } }`,
        { id: issueId }
      );
      return data.issue.comments.nodes.map((c) => c.body);
    },
    async comment(issueId, body) {
      await gql(`mutation($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) { success } }`, { issueId, body });
    },
    async setState(issue, name) {
      const stateId = issue.states[name];
      if (!stateId) throw new Error(`${issue.identifier}: team has no status named ${name}`);
      await gql(`mutation($id: String!, $stateId: String!) {
        issueUpdate(id: $id, input: { stateId: $stateId }) { success } }`, { id: issue.id, stateId });
    }
  };
}

/** Prints instead of calling Linear; an issue is whatever the IDs say. */
function dryApi() {
  const say = (...parts) => console.log('[dry-run]', ...parts);
  return {
    getIssue: async (id) => ({ id, identifier: id, state: 'In Progress', states: {}, comments: [] }),
    listDeploying: async () => [],
    comments: async () => [],
    comment: async (id, body) => say('comment on', id, '|', body),
    setState: async (issue, name) => say('move', issue.identifier, 'to', name)
  };
}

// --- CLI --------------------------------------------------------------------

function flags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const name = argv[i].slice(2);
    out[name] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const ZEROS = /^0+$/;

/** The commits and changed files of a push. No usable `from`: just the head. */
function pushed(from, to) {
  const range = from && !ZEROS.test(from) ? `${from}..${to}` : `-1 ${to}`;
  const log = git('log', '--reverse', '--format=%H%x1f%B%x1e', ...range.split(' '));
  const commits = log.split('\x1e').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const [sha, message] = entry.split('\x1f');
    return { sha, message };
  });
  const files = from && !ZEROS.test(from)
    ? git('diff', '--name-only', from, to)
    : git('show', '--name-only', '--format=', to);
  return { commits, files: files.split('\n') };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const opt = flags(rest);
  const key = process.env.LINEAR_API_KEY;
  if (!opt['dry-run'] && !key) {
    console.error('::error::Add the LINEAR_API_KEY secret; Linear cannot be told about this deploy without it.');
    process.exit(1);
  }
  const api = opt['dry-run'] ? dryApi() : linearApi(key);
  let lines;
  if (command === 'deploying') {
    const { commits, files } = pushed(opt.from, opt.to ?? 'HEAD');
    lines = await deploying(api, commits, files);
  } else if (command === 'lane') {
    const { name, sha, status } = opt;
    if (!name || !sha || !['ok', 'failed'].includes(status)) {
      console.error('usage: lane --name <lane> --sha <sha> --status ok|failed [--url <url>]');
      process.exit(2);
    }
    lines = await reportLane(api, { name, sha, status, url: opt.url });
  } else {
    console.error('usage: linear-sync.mjs deploying|lane ...');
    process.exit(2);
  }
  for (const line of lines) console.log(line);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
