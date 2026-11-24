import postgres from 'postgres';
import { githubOidc, type GithubRun, type OidcRule } from '../../web/worker/githubOidc';
import { plainConnection } from './db';

/**
 * The read gate (docs/production-reads.md,
 * docs/decisions/2026-11-21-claude-reads-production-through-a-gate.md):
 * `POST /ops/api/read` on app.langquest.org runs one read-only SQL statement
 * on the production database for Claude, and answers its rows.
 *
 * Who gets in, and as which login:
 * - Claude's cloud threads and a developer's laptop, with CLAUDE_READ_TOKEN
 *   as a bearer token (the Worker keeps only its SHA-256), read as
 *   claude_reader: everything but secrets and emails.
 * - The agent teams' workflows on main, with the GitHub OIDC token their job
 *   gets (githubOidc.ts, decision 186), read as agent_reader: everything
 *   claude_reader reads but personal data, and what people typed through
 *   the views of `masked` (migration 20261124223000). No key is stored in
 *   GitHub.
 *
 * The database holds both logins to reading (migration
 * 20261121194800_claude_readers.sql): neither has a grant to write. This
 * Worker adds: a read-only transaction for every statement, one statement
 * only (the extended protocol refuses a second), 15 s, at most READ_MAX_ROWS
 * rows back, a rate limit, and a log line for each statement.
 */

export const READ_PATH = '/ops/api/read';
export const READ_AUDIENCE = 'https://app.langquest.org/ops/api/read';
/**
 * The agent teams: these workflows, run from main, read as agent_reader. card-questions.yml answers an
 * admin's question from a card of the ops dashboard (docs/decisions/2026-11-23-ask-claude-from-every-dashboard-card.md).
 */
export const READ_WORKFLOWS = ['user-issues.yml', 'card-questions.yml'] as const;
export const READ_RULES: OidcRule[] = READ_WORKFLOWS.map((file) => ({
  audience: READ_AUDIENCE,
  workflowRef: `genesis-ai-dev/langquest-next/.github/workflows/${file}@refs/heads/main`
}));
export const READ_MAX_SQL = 20_000;
export const READ_MAX_ROWS = 1_000;
export const READ_MAX_PARAMS = 50;
/** Longest one statement may run; the logins' own statement_timeout is the same. */
export const READ_TIMEOUT_S = 15;

export type ReadLogin = 'claude_reader' | 'agent_reader';
export type ReadAnswer = { columns: string[]; rows: unknown[][]; truncated: boolean };

export interface ReadDeps {
  /** SHA-256 of CLAUDE_READ_TOKEN, hex; without it no token gets in. */
  tokenSha256: string | undefined;
  verify(token: string, rule: OidcRule): Promise<GithubRun | null>;
  /** The login's connection string (its Hyperdrive binding), or null when it is not set up here. */
  connection(login: ReadLogin): string | null;
  run(url: string, sql: string, params: (string | number | null)[]): Promise<ReadAnswer>;
  /** False when the caller has used its share of the minute. */
  allowed(key: string): Promise<boolean>;
  log(line: string): void;
  now(): number;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async (text: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

/** Equal strings, compared in the same time whatever they hold. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Which login a bearer token reads as, and who it is for the log; null when it is neither. */
export async function whoReads(token: string, deps: Pick<ReadDeps, 'tokenSha256' | 'verify'>): Promise<{ login: ReadLogin; who: string } | null> {
  if (token.split('.').length === 3) {
    for (const rule of READ_RULES) {
      const run = await deps.verify(token, rule).catch(() => null);
      if (run) return { login: 'agent_reader', who: `${/workflows\/([^@]+)@/.exec(run.workflowRef)?.[1] ?? run.workflowRef} run ${run.runId}` };
    }
    return null;
  }
  if (!deps.tokenSha256 || token.length < 32) return null;
  return same(await sha256(token), deps.tokenSha256.toLowerCase()) ? { login: 'claude_reader', who: 'CLAUDE_READ_TOKEN' } : null;
}

/** The statement's first word, after leading space and comments, in lower case. */
export const firstWord = (sql: string): string =>
  /^[a-z]+/i.exec(sql.replace(/^(\s+|--[^\n]*\n?|\/\*[\s\S]*?\*\/)*/, ''))?.[0]?.toLowerCase() ?? '';

const FIRST_WORDS = ['select', 'with', 'explain', 'values', 'table', 'show'];

/**
 * Why the gate refuses a statement before the database sees it, or null.
 * The database refuses writes on its own; this keeps a statement from
 * changing the transaction it runs in.
 */
export function refusal(sql: string): string | null {
  if (!sql.trim()) return 'Send one SQL statement, as {"sql": "select ..."}.';
  if (sql.length > READ_MAX_SQL) return `A statement is at most ${READ_MAX_SQL} characters.`;
  const first = firstWord(sql);
  if (!FIRST_WORDS.includes(first)) return `Only reading: a statement starts with ${FIRST_WORDS.join(', ')}.`;
  if (/\bset_config\b/i.test(sql)) return 'set_config is refused: a statement may not change its settings.';
  return null;
}

function paramsOf(value: unknown): (string | number | null)[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > READ_MAX_PARAMS) return null;
  return value.every((v) => v === null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) ? value as (string | number | null)[] : null;
}

/** Postgres's message, which says what was wrong with the statement; never anything else from the error. */
const pgMessage = (e: unknown): string => {
  const err = e as { message?: unknown; code?: unknown };
  return typeof err?.message === 'string' ? `${err.message}${typeof err.code === 'string' ? ` (${err.code})` : ''}` : 'the statement failed';
};

export async function handleRead(request: Request, deps: ReadDeps): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'POST {"sql": "select ...", "params": []}' }, 405);
  const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  const reader = token ? await whoReads(token, deps) : null;
  if (!reader) return json({ error: 'Send CLAUDE_READ_TOKEN, or a GitHub OIDC token of an agent team workflow on main, as a bearer token (docs/production-reads.md).' }, 401);
  if (!(await deps.allowed(reader.login))) return json({ error: 'Too many statements; wait a minute.' }, 429);

  const text = await request.text();
  if (text.length > READ_MAX_SQL * 2) return json({ error: 'Too large' }, 413);
  let body: { sql?: unknown; params?: unknown };
  try { body = JSON.parse(text) as typeof body; } catch { return json({ error: 'Not JSON: send {"sql": "select ...", "params": []}' }, 400); }
  const sql = typeof body?.sql === 'string' ? body.sql : '';
  const refused = refusal(sql);
  if (refused) return json({ error: refused }, 400);
  const params = paramsOf(body.params);
  if (!params) return json({ error: `params is a list of at most ${READ_MAX_PARAMS} strings, numbers or nulls` }, 400);
  const url = deps.connection(reader.login);
  if (!url) return json({ error: `${reader.login} is not set up here (docs/production-reads.md, setup).` }, 503);

  const started = deps.now();
  const logLine = (outcome: string, rows: number) => deps.log(JSON.stringify({
    read: reader.login, who: reader.who, outcome, rows, ms: deps.now() - started, sql: sql.slice(0, 500)
  }));
  try {
    const answer = await deps.run(url, sql, params);
    logLine('ok', answer.rows.length);
    return json({ login: reader.login, ...answer, ms: deps.now() - started });
  } catch (e) {
    logLine('error', 0);
    return json({ error: pgMessage(e) }, 400);
  }
}

/**
 * One statement as the login, over its own connection: a read-only
 * transaction with a 15 s limit, set before the statement so the statement
 * cannot change either (Postgres refuses read-write once a query has run),
 * and the extended protocol, which takes one statement only. A cursor stops
 * after READ_MAX_ROWS + 1 rows, so a large answer is never held whole.
 */
/** The extended protocol, which postgres.js uses for unsafe() only with parameters unless told: it takes one statement. */
const EXTENDED = { simple: false } as postgres.UnsafeQueryOptions;

export async function runRead(url: string, sql: string, params: (string | number | null)[]): Promise<ReadAnswer> {
  const plain = plainConnection(url);
  const db = postgres(url, {
    max: 1, prepare: false, fetch_types: false, connect_timeout: 10, idle_timeout: 5,
    ssl: plain ? false : 'require',
    types: { timestamps: { to: 1184, from: [1082, 1114, 1184], serialize: (x: string) => x, parse: (x: string) => x } }
  });
  try {
    return await db.begin('read only', async (tx) => {
      await tx.unsafe(`select set_config('statement_timeout', '${READ_TIMEOUT_S}s', true)`, [], EXTENDED);
      let columns: string[] = [];
      const rows: unknown[][] = [];
      let truncated = false;
      const query = tx.unsafe(sql, params as postgres.ParameterOrJSON<never>[], EXTENDED);
      const take = (batch: readonly postgres.Row[] & { columns?: readonly { name: string }[] }) => {
        columns = (batch.columns ?? []).map((c) => c.name);
        for (const row of batch) rows.push(columns.map((c) => (row as Record<string, unknown>)[c]));
        if (rows.length > READ_MAX_ROWS) { truncated = true; rows.length = READ_MAX_ROWS; }
      };
      // SHOW and EXPLAIN answer nothing through a cursor, and their answers are small.
      if (/^(show|explain)$/.test(firstWord(sql))) take(await query);
      else for await (const batch of query.cursor(READ_MAX_ROWS + 1)) { take(batch); break; }
      return { columns, rows, truncated };
    });
  } finally {
    await db.end({ timeout: 1 });
  }
}

let verifier: ReturnType<typeof githubOidc> | null = null;
/** GitHub's keys, kept per isolate. */
export const githubVerify = (token: string, rule: OidcRule) => (verifier ??= githubOidc((u, i) => fetch(u, i)))(token, rule);
