#!/usr/bin/env node
// One read-only SQL statement on the production database, through the read
// gate (apps/admin/src/read.ts, docs/production-reads.md).
//
//   npm run prod:read -- "select type, count(*) from public.events group by 1"
//   npm run prod:read -- "select * from diag.records where install_id = \$1 limit 5" <install id>
//   npm run prod:read -- --json "select ..."      the gate's answer as JSON
//
// Logs, through the same gate (apps/admin/src/logs.ts, docs/production-reads.md, "Logs"):
//
//   npm run prod:read -- --logs worker-builds worker=langquest-next
//   npm run prod:read -- --logs worker-build-log build=<build id>
//   npm run prod:read -- --logs worker-logs worker=langquest-next minutes=120 level=error search="E-7K2Q"
//   npm run prod:read -- --logs supabase-logs query=postgres-errors      (agent teams)
//   npm run prod:read -- --logs supabase-logs sql="select ... from logs ..."  (claude_reader)
//   npm run prod:read -- --logs eas-builds
//   npm run prod:read -- --logs eas-build-log build=<build id>
//   npm run prod:read -- --logs github-job-log job=<job id>
//
// Who it reads as comes from where it runs:
// - CLAUDE_READ_TOKEN set (a laptop that exported it, or a cloud environment
//   that keeps it as a variable): claude_reader, everything but secrets and
//   emails.
// - A Claude cloud thread whose environment keeps the token as a network
//   secret for app.langquest.org: the same, with a stand-in the proxy
//   replaces, so the thread never holds the token itself.
// - In a GitHub Actions job with `id-token: write`: the job's OIDC token, and
//   agent_reader if the workflow is one the gate lets in from main.
// Nothing here can write: the database refuses it to both logins.
//
// What it prints is production data. Never paste it into a pull request,
// commit, issue or public log (docs/production-reads.md, "Where answers go").
import { pathToFileURL } from 'node:url';

export const READ_URL = process.env.PROD_READ_URL ?? 'https://app.langquest.org/ops/api/read';
export const LOGS_URL = `${READ_URL}/logs`;
export const READ_AUDIENCE = 'https://app.langquest.org/ops/api/read';

/** `[--json] <sql> [param ...]`, or `[--json] --logs <source> [name=value ...]`. */
export function parseArgs(argv) {
  const json = argv.includes('--json');
  const rest = argv.filter((a) => a !== '--json');
  if (rest[0] === '--logs') {
    const [, source, ...pairs] = rest;
    const logs = { source: source ?? '' };
    for (const pair of pairs) {
      const at = pair.indexOf('=');
      if (at < 1) throw new Error(`"${pair}" is not name=value`);
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);
      logs[name] = ['minutes', 'limit'].includes(name) && /^\d+$/.test(value) ? Number(value) : value;
    }
    return { json, logs, sql: '', params: [] };
  }
  const [sql, ...params] = rest;
  return { json, sql: sql ?? '', params };
}

/** A log answer as its lines, then one line that says what it holds. */
export function logsAsText(answer) {
  const lines = [...answer.lines];
  lines.push(`(${answer.lines.length} line${answer.lines.length === 1 ? '' : 's'}${answer.truncated ? ', the newest only' : ''}, ${answer.ms} ms, as ${answer.login}${answer.note ? `. ${answer.note}` : ''})`);
  return lines.join('\n');
}

/** What a cloud thread sends when its proxy adds the token (a network secret): too short for the gate to take as one. */
export const PROXY_STAND_IN = 'from-the-proxy';

/** The bearer token for this place: CLAUDE_READ_TOKEN, the GitHub job's OIDC token, or the proxy's stand-in. */
export async function bearer(env = process.env, fetcher = fetch) {
  if (env.CLAUDE_READ_TOKEN) return env.CLAUDE_READ_TOKEN;
  if (env.ACTIONS_ID_TOKEN_REQUEST_URL && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    const url = `${env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${encodeURIComponent(READ_AUDIENCE)}`;
    const res = await fetcher(url, { headers: { authorization: `bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } });
    if (!res.ok) throw new Error(`GitHub gave no OIDC token (${res.status}); the job needs permissions: id-token: write`);
    return (await res.json()).value;
  }
  if (env.CLAUDE_CODE_REMOTE === 'true') return PROXY_STAND_IN;
  throw new Error('No CLAUDE_READ_TOKEN, and not in a GitHub Actions job with id-token: write (docs/production-reads.md).');
}

/** Rows as tab-separated lines under their column names: easy to read, easy to cut. */
export function asText(answer) {
  const cell = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)).replace(/[\t\n]/g, ' ');
  const lines = [answer.columns.join('\t'), ...answer.rows.map((r) => r.map(cell).join('\t'))];
  lines.push(`(${answer.rows.length} row${answer.rows.length === 1 ? '' : 's'}${answer.truncated ? ', cut at 1000: add a limit or a where' : ''}, ${answer.ms} ms, as ${answer.login})`);
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.sql && !args.logs) {
    console.error('usage: npm run prod:read -- [--json] "select ..." [param ...]\n       npm run prod:read -- [--json] --logs <source> [name=value ...]');
    process.exit(2);
  }
  const token = await bearer();
  const res = await fetch(args.logs ? LOGS_URL : READ_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(args.logs ?? { sql: args.sql, params: args.params })
  });
  const body = await res.json().catch(() => ({ error: `the gate answered ${res.status} without JSON` }));
  if (res.status === 401 && token === PROXY_STAND_IN) {
    console.error('x The cloud environment has no CLAUDE_READ_TOKEN for app.langquest.org, as a network secret or a variable (docs/production-reads.md, setup step 4).');
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`x ${body.error ?? res.status}`);
    if (body.sources) for (const [name, what] of Object.entries(body.sources)) console.error(`  ${name}: ${what}`);
    process.exit(1);
  }
  console.log(args.json ? JSON.stringify(body) : args.logs ? logsAsText(body) : asText(body));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`x ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
