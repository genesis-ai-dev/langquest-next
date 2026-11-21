#!/usr/bin/env node
// One read-only SQL statement on the production database, through the read
// gate (apps/admin/src/read.ts, docs/production-reads.md).
//
//   npm run prod:read -- "select type, count(*) from public.events group by 1"
//   npm run prod:read -- "select * from diag.records where install_id = \$1 limit 5" <install id>
//   npm run prod:read -- --json "select ..."      the gate's answer as JSON
//
// Who it reads as comes from where it runs:
// - CLAUDE_READ_TOKEN set (a Claude cloud thread, or a laptop that exported
//   it): claude_reader, everything but secrets and emails.
// - In a GitHub Actions job with `id-token: write`: the job's OIDC token, and
//   agent_reader if the workflow is one the gate lets in from main.
// Nothing here can write: the database refuses it to both logins.
//
// What it prints is production data. Never paste it into a pull request,
// commit, issue or public log (docs/production-reads.md, "Where answers go").
import { pathToFileURL } from 'node:url';

export const READ_URL = process.env.PROD_READ_URL ?? 'https://app.langquest.org/ops/api/read';
export const READ_AUDIENCE = 'https://app.langquest.org/ops/api/read';

/** `[--json] <sql> [param ...]`. */
export function parseArgs(argv) {
  const json = argv.includes('--json');
  const rest = argv.filter((a) => a !== '--json');
  const [sql, ...params] = rest;
  return { json, sql: sql ?? '', params };
}

/** The bearer token for this place: CLAUDE_READ_TOKEN, or the GitHub job's OIDC token. */
export async function bearer(env = process.env, fetcher = fetch) {
  if (env.CLAUDE_READ_TOKEN) return env.CLAUDE_READ_TOKEN;
  if (env.ACTIONS_ID_TOKEN_REQUEST_URL && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    const url = `${env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${encodeURIComponent(READ_AUDIENCE)}`;
    const res = await fetcher(url, { headers: { authorization: `bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } });
    if (!res.ok) throw new Error(`GitHub gave no OIDC token (${res.status}); the job needs permissions: id-token: write`);
    return (await res.json()).value;
  }
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
  if (!args.sql) {
    console.error('usage: npm run prod:read -- [--json] "select ..." [param ...]');
    process.exit(2);
  }
  const res = await fetch(READ_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${await bearer()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sql: args.sql, params: args.params })
  });
  const body = await res.json().catch(() => ({ error: `the gate answered ${res.status} without JSON` }));
  if (!res.ok) {
    console.error(`x ${body.error ?? res.status}`);
    process.exit(1);
  }
  console.log(args.json ? JSON.stringify(body) : asText(body));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`x ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
