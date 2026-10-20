// Files the nightly guardrails jobs' failures in Linear (decisions.md 102),
// so a red night is seen without anyone opening Actions. One issue per
// failing web UI test, one per nightly job that fails on its own, left
// unassigned for triage. As in linear-sync.mjs the state lives in the issues:
// an issue's title names what failed, and its comments say how it went since,
// one comment each time it turns:
//
//   Nightly passed · abc1234 · https://...
//   Nightly failed · abc1234 · https://...
//
// A test that keeps failing adds nothing; one that passes again says so once.
// The reporter never closes an issue: a fix names it in its commit (LAN-12),
// and linear-sync moves it as it ships. A test that fails again after its
// issue is closed opens a new one, which names the old.
//
//   ui  --status <job.status> --sha <sha> --url <run> [--report <file>]
//                         the web UI suite: an issue per failing test, or one
//                         for the run when it broke as a whole (no report, or
//                         more than MANY tests failing, which is one cause)
//   job --name <job> --status <job.status> --sha <sha> --url <run>
//                         any other nightly job (fleet, mutation)
//
// Add --dry-run to print what would be filed without calling Linear.
// LINEAR_API_KEY is required otherwise; missing, the script fails.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TEAM_KEY } from './linear-sync.mjs';

export const PREFIX = 'Nightly: ';
/** More failing tests than this in one run is one cause (the stack down), filed once. */
export const MANY = 15;
export const UI_RUN = 'the nightly web UI suite';
const ARTIFACT = 'ui-web-nightly-results';

const short = (sha) => sha.slice(0, 7);
export const turnComment = (verdict, sha, url) => `Nightly ${verdict} · ${short(sha)} · ${url}`;
export const jobKey = (name) => `the ${name} job`;
/** A job's status (success, failure, cancelled) as words. */
const ended = (status) => (status === 'failure' ? 'failed' : status === 'cancelled' ? 'was cancelled' : `ended ${status}`);

/** How an issue's thing stands from its comments (oldest first). It was opened failing. */
export function lastVerdict(comments) {
  let verdict = 'failed';
  for (const body of comments) {
    const turn = body.match(/^Nightly (failed|passed) · /m);
    if (turn) verdict = turn[1];
  }
  return verdict;
}

const plain = (text) => text.replace(/\x1b\[[0-9;]*m/g, '');
function excerpt(text, lines = 30, chars = 2500) {
  const cut = plain(text).split('\n').slice(0, lines).join('\n');
  return cut.length > chars ? `${cut.slice(0, chars)}…` : cut;
}

/** Each test that ran in a Playwright JSON report: its key, where it is, and how it went. */
export function testsOf(report) {
  const out = [];
  function walk(suite) {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const ran = (t.results ?? []).filter((r) => r.status !== 'skipped');
        if (!ran.length) continue;
        const failed = ran.find((r) => r.status !== 'passed');
        out.push({
          key: `${spec.title}${t.projectName ? ` [${t.projectName}]` : ''}`,
          title: spec.title,
          file: spec.file,
          line: spec.line,
          passed: !failed,
          error: failed ? excerpt(failed.error?.message ?? failed.errors?.[0]?.message ?? failed.status) : null
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  }
  for (const suite of report.suites ?? []) walk(suite);
  return out;
}

const NEXT = 'Fix it and name this issue in the commit, or, if it fails without a product cause, ' +
  'tag the test `@quarantine` and name this issue beside the tag (docs/testing.md).';

function testBody(test, sha, url) {
  const id = test.title.split(' ')[0];
  return [
    `\`e2e/ui/${test.file}:${test.line}\` failed in the nightly run at ${short(sha)}: ${url}`,
    '',
    '```',
    test.error,
    '```',
    '',
    `Screenshots and error context are in the run's \`${ARTIFACT}\` artifact. Here: \`npm run test:ui:web -- e2e/ui/${test.file} -g "${id}"\``,
    '',
    NEXT
  ].join('\n');
}

/**
 * What one run of the web UI suite says, as outcomes for `plan`. `report` is
 * the parsed report.json, or null when the suite left none; `status` the
 * job's status (success, failure, cancelled).
 */
export function uiOutcomes(report, status, sha, url) {
  const tests = report ? testsOf(report) : null;
  const failing = tests?.filter((t) => !t.passed) ?? [];
  let broke = null;
  if (!tests) broke = `The job ${ended(status)} and left no report: the suite did not run to the end.`;
  else if (failing.length > MANY) {
    broke = [`${failing.length} tests failed, which is one cause rather than ${failing.length}. The first error:`, '',
      '```', failing[0].error, '```', '', ...failing.map((t) => `- ${t.key}`)].join('\n');
  } else if (status !== 'success' && !failing.length) broke = `The job ${ended(status)} with every test that ran passing: a step around the tests broke.`;
  const out = [];
  if (broke) out.push({ key: UI_RUN, passed: false, body: `${broke}\n\nRun: ${url}` });
  else if (status === 'success') out.push({ key: UI_RUN, passed: true });
  for (const t of tests ?? []) {
    if (t.passed) out.push({ key: t.key, passed: true });
    else if (failing.length <= MANY) out.push({ key: t.key, passed: false, body: testBody(t, sha, url) });
  }
  return out;
}

/** A nightly job other than the UI suite, by its status. */
export function jobOutcomes(name, status, url) {
  const passed = status === 'success';
  return [{ key: jobKey(name), passed, body: passed ? undefined : `The ${name} job ${ended(status)} in the nightly run: ${url}\n\nIts log says why.` }];
}

const isOpen = (issue) => !['completed', 'canceled'].includes(issue.stateType);

/**
 * What to tell Linear. `issues` are every issue titled with PREFIX, open or
 * not, each { id, identifier, title, stateType, createdAt, comments }.
 * Returns [{ create: { title, description } } | { comment: { issue, body } }].
 */
export function plan(issues, outcomes, sha, url) {
  const newest = (list) => [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const actions = [];
  for (const o of outcomes) {
    const title = `${PREFIX}${o.key}`;
    const named = issues.filter((i) => i.title === title);
    const open = newest(named.filter(isOpen));
    if (open) {
      const verdict = o.passed ? 'passed' : 'failed';
      if (lastVerdict(open.comments) !== verdict) actions.push({ comment: { issue: open, body: turnComment(verdict, sha, url) } });
    } else if (!o.passed) {
      const before = newest(named);
      const description = before ? `${o.body}\n\nIt failed before in ${before.identifier}.` : o.body;
      actions.push({ create: { title, description } });
    }
  }
  return actions;
}

/** Carry out a plan, and say what was done. */
export async function apply(api, actions) {
  const out = [];
  for (const a of actions) {
    if (a.create) out.push(`opened ${await api.create(a.create.title, a.create.description)}: ${a.create.title}`);
    else {
      await api.comment(a.comment.issue.id, a.comment.body);
      out.push(`${a.comment.issue.identifier}: ${a.comment.body.split(' · ')[0]}`);
    }
  }
  if (!out.length) out.push('nothing new to tell Linear');
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
  let teamId;
  return {
    async issues() {
      const data = await gql(
        `query($key: String!, $prefix: String!) { issues(first: 250, filter: {
           team: { key: { eq: $key } }, title: { startsWith: $prefix } }) {
           nodes { id identifier title description createdAt state { type }
             comments(first: 100) { nodes { body createdAt } } } } }`,
        { key: TEAM_KEY, prefix: PREFIX }
      );
      return data.issues.nodes.map((n) => ({
        id: n.id,
        identifier: n.identifier,
        title: n.title,
        description: n.description ?? '',
        createdAt: n.createdAt,
        stateType: n.state.type,
        comments: [...n.comments.nodes].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((c) => c.body)
      }));
    },
    async create(title, description) {
      teamId ??= (await gql(`query($key: String!) { teams(filter: { key: { eq: $key } }) { nodes { id } } }`, { key: TEAM_KEY }))
        .teams.nodes[0]?.id;
      if (!teamId) throw new Error(`Linear has no team ${TEAM_KEY}`);
      const data = await gql(`mutation($input: IssueCreateInput!) {
        issueCreate(input: $input) { issue { identifier } } }`, { input: { teamId, title, description } });
      return data.issueCreate.issue.identifier;
    },
    async comment(issueId, body) {
      await gql(`mutation($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) { success } }`, { issueId, body });
    }
  };
}

/** Prints instead of calling Linear, as if no nightly issue were open. */
export function dryApi() {
  let n = 0;
  return {
    issues: async () => [],
    create: async (title, description) => {
      console.log(`[dry-run] open "${title}"\n${description.replace(/^/gm, '  | ')}`);
      return `NEW-${++n}`;
    },
    comment: async (id, body) => console.log('[dry-run] comment on', id, '|', body)
  };
}

// --- CLI --------------------------------------------------------------------

export function flags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const name = argv[i].slice(2);
    out[name] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const opt = flags(rest);
  const { status, sha, url } = opt;
  if (!['ui', 'job'].includes(command) || !status || !sha || !url || (command === 'job' && !opt.name)) {
    console.error('usage: nightly-report.mjs ui|job [--name <job>] --status <job.status> --sha <sha> --url <run> [--report <file>] [--dry-run]');
    process.exit(2);
  }
  const key = process.env.LINEAR_API_KEY;
  if (!opt['dry-run'] && !key) {
    console.error('::error::Add the LINEAR_API_KEY secret; the nightly failures cannot be filed without it.');
    process.exit(1);
  }
  let outcomes;
  if (command === 'ui') {
    const file = opt.report ?? 'e2e/results/ui/report.json';
    outcomes = uiOutcomes(existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null, status, sha, url);
  } else {
    outcomes = jobOutcomes(opt.name, status, url);
  }
  const api = opt['dry-run'] ? dryApi() : linearApi(key);
  for (const line of await apply(api, plan(await api.issues(), outcomes, sha, url))) console.log(line);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
