#!/usr/bin/env node
// The watch for user issues, around Claude (.github/workflows/user-issues.yml,
// docs/diagnostics.md "The watch for user issues", decisions.md 202). Plain
// Node, no packages, so the workflow needs no `npm ci`.
//
//   node scripts/user-issues.mjs fetch <dir>   what is new (watch.json) and the team's issues in Linear
//                                              (linear.json); writes look=<n> and grew=<n> to GITHUB_OUTPUT
//   node scripts/user-issues.mjs file <dir>    decisions.json, as Claude wrote it: a Linear issue for each new
//                                              problem, assigned to USER_ISSUES_ASSIGNEE, and a comment on each
//                                              issue the team already had and on each that more people hit since;
//                                              then tells the Worker what was done, so nothing is filed twice
//
// The Worker lets in this workflow on main, and nothing else, by the OpenID
// Connect token GitHub gives the job (apps/web/worker/userIssues.ts).
// LINEAR_API_KEY files in Linear. The repository is public and so are its
// Actions logs: this prints counts, kinds' keys and issue ids, never what a
// person wrote.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEAM_KEY } from './linear-sync.mjs';
import { runUrl } from './tutorial-review.mjs';

export const API = process.env.USER_ISSUES_API ?? 'https://next.langquest.org/api/user-issues';
/** What the Worker expects the token to be for (apps/web/worker/userIssues.ts USER_ISSUES_RULE). */
export const AUDIENCE = 'https://next.langquest.org/api/user-issues';
/** server/userIssues.ts FAMILIES (scripts/userIssues.test.ts holds them equal). */
export const FAMILIES = ['error', 'sync', 'transfer', 'auth', 'expected', 'audio', 'fill', 'device', 'job', 'worker', 'feedback'];
export const KEY = new RegExp(`^(${FAMILIES.join('|')}):[A-Za-z0-9 _.:()/#@-]{1,290}$`);
/** server/userIssues.ts ISSUE_LABEL and ISSUE_PREFIX. */
export const LABEL = 'User issue';
export const PREFIX = 'User issue: ';
/** How much of what Claude writes goes on; the rest is cut. */
export const LIMITS = { title: 100, summary: 4000, cause: 6000, comment: 3000, note: 300, keys: 20 };
/** Linear issues handed to Claude: every open one, and any changed in this many days. */
export const LINEAR_DAYS = 90;
const LINEAR_MAX = 300;
const DESCRIPTION_MAX = 600;
const OPS = 'https://next.langquest.org/ops-dashboard';
const ISSUE_ID = new RegExp(`^${TEAM_KEY}-[0-9]{1,7}$`);
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
  for (const m of String(description ?? '').matchAll(/^- `([^`\n]{3,300})`$/gm)) if (KEY.test(m[1])) keys.push(m[1]);
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
      `**Sent from help mode** on ${when(f.at)}${f.screen ? `, from the screen \`${f.screen}\`` : ''} · ${f.os ?? '?'} · app ${f.app ?? '?'}${f.uiLanguage ? ` · app language ${f.uiLanguage}` : ''}`,
      '',
      words || '> (no words)',
      ...(media.length ? ['', `With ${media.join(' and ')}: [ops dashboard](${OPS}), Feedback.`] : [])
    ].join('\n');
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
  return [
    `**\`${kind.key}\`** · ${plural(kind.people, 'person', 'people')} in 7 days (${kind.peopleDay} in the last day) · ${plural(kind.installs, 'install')} · ${plural(kind.count, 'time')}`,
    `${byCount(kind.platforms).map(([p, n]) => `${p} ${n}`).join(', ') || '?'} · app ${apps || '?'} · first ${when(kind.firstAt)}, last ${when(kind.lastAt)}`
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
  const out = { file: [], known: [], noise: [], dropped: [], undecided: [] };
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
    out.file.push({ keys, title: cut(text(f.title).replace(/\s+/g, ' ').replace(/^User issue:\s*/i, ''), LIMITS.title), priority, summary: text(f.summary), cause: text(f.cause) });
  });
  (Array.isArray(d.known) ? d.known : []).forEach((k, n) => {
    const where = `known[${n}]`;
    if (!isObj(k) || !ISSUE_ID.test(text(k.issue))) return out.dropped.push(`${where}: needs keys and an issue (${TEAM_KEY}-12)`);
    const keys = take(k.keys, where);
    if (keys) out.known.push({ keys, issue: k.issue, comment: text(k.comment) });
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

/** What the Worker is told about a kind: its verdict, its issue, and the counts it was judged at. */
export function lookedOf(kind, verdict, issue, note = null) {
  return { key: kind.key, verdict, issue: issue?.identifier ?? null, issueUrl: issue?.url ?? null, people: kind.people, count: kind.count, note };
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

async function call(method, body) {
  const res = await fetch(API, {
    method,
    headers: { authorization: `Bearer ${await oidcToken()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const answer = await res.text();
  // The Worker's errors are fixed words; never a person's.
  if (!res.ok) throw new Error(`${method} ${API}: HTTP ${res.status} ${answer.slice(0, 300)}`);
  return JSON.parse(answer);
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

async function fetchWatch(dir) {
  mkdirSync(dir, { recursive: true });
  const watch = await call('GET');
  writeFileSync(join(dir, 'watch.json'), JSON.stringify(watch, null, 2));
  const busy = watch.look.length > 0 || watch.grew.length > 0;
  const issues = busy ? await linearClient(linearKey()).issues(new Date(Date.now() - LINEAR_DAYS * 86_400_000).toISOString()) : [];
  writeFileSync(join(dir, 'linear.json'), JSON.stringify({ issues }, null, 2));
  output({ look: watch.look.length, grew: watch.grew.length });
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
      for (const k of kinds) looked.push(lookedOf(k, 'filed', issue));
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
      for (const kind of kinds) looked.push(lookedOf(kind, 'known', issue));
      console.log(`known ${issue.identifier}: ${k.keys.join(', ')}`);
    } catch (e) {
      failed += 1;
      console.log(`::error::could not comment on ${k.issue}: ${e instanceof Error ? e.message : e}`);
    }
  }

  for (const x of plan.noise) looked.push(lookedOf(kindOf.get(x.key), 'noise', null, x.note));
  if (plan.noise.length) console.log(`noise: ${plan.noise.map((x) => x.key).join(', ')}`);

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

  // What was done goes back even when some of it failed, so it is not done twice.
  if (looked.length || grew.length) {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const done = await call('POST', { sha, runUrl: run, looked, grew });
    console.log(`told the Worker: ${done.looked} kinds looked at, ${done.grew} grown`);
  }
  if (failed) throw new Error(`${failed} Linear calls failed; their kinds come back next run`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, dir] = process.argv.slice(2);
  if (!dir || (command !== 'fetch' && command !== 'file')) {
    console.error('usage: node scripts/user-issues.mjs <fetch|file> <dir>');
    process.exit(2);
  }
  try {
    await (command === 'fetch' ? fetchWatch(dir) : file(dir));
  } catch (e) {
    console.error(`::error::${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
