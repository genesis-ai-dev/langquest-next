import { describe, expect, it } from 'vitest';
import { handleRead, READ_MAX_ROWS, READ_RULES, refusal, sha256, whoReads, type ReadDeps } from '../src/read';
import type { OidcRule } from '../../web/worker/githubOidc';

/** The read gate (src/read.ts, docs/production-reads.md). */

const TOKEN = 'a'.repeat(48);
const AGENT_JWT = 'header.claims.signature';

async function deps(over: Partial<ReadDeps> = {}): Promise<ReadDeps & { logs: string[]; ran: { url: string; sql: string; params: unknown[] }[] }> {
  const logs: string[] = [];
  const ran: { url: string; sql: string; params: unknown[] }[] = [];
  return {
    logs, ran,
    tokenSha256: await sha256(TOKEN),
    verify: async (token: string, rule: OidcRule) => (token === AGENT_JWT && rule === READ_RULES[0]
      ? { repository: 'genesis-ai-dev/langquest-next', workflowRef: rule.workflowRef, runId: '77', runAttempt: '1', eventName: 'schedule' }
      : null),
    connection: (login) => `postgresql://${login}@x.hyperdrive.local:5432/postgres`,
    run: async (url, sql, params) => { ran.push({ url, sql, params }); return { columns: ['n'], rows: [[1]], truncated: false }; },
    allowed: async () => true,
    log: (line) => logs.push(line),
    now: () => 1000,
    ...over
  };
}

const post = (body: unknown, token?: string) => new Request('https://app.langquest.org/ops/api/read', {
  method: 'POST',
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body: typeof body === 'string' ? body : JSON.stringify(body)
});

describe('who reads', () => {
  it('lets the token in as claude_reader and an agent team run as agent_reader, and nothing else', async () => {
    const d = await deps();
    expect(await whoReads(TOKEN, d)).toEqual({ login: 'claude_reader', who: 'CLAUDE_READ_TOKEN' });
    expect(await whoReads(AGENT_JWT, d)).toEqual({ login: 'agent_reader', who: 'user-issues.yml run 77' });
    expect(await whoReads('b'.repeat(48), d)).toBeNull();
    expect(await whoReads('other.jwt.token', d)).toBeNull();
    expect(await whoReads('short', d)).toBeNull();
  });

  it('lets no token in when the Worker has no hash of one', async () => {
    expect(await whoReads(TOKEN, await deps({ tokenSha256: undefined }))).toBeNull();
  });

  it('lets in only workflows on main of this repository', () => {
    for (const rule of READ_RULES) expect(rule.workflowRef).toMatch(/^genesis-ai-dev\/langquest-next\/\.github\/workflows\/[a-z-]+\.yml@refs\/heads\/main$/);
  });
});

describe('what the gate refuses before the database', () => {
  it('takes a reading statement, after comments', () => {
    for (const sql of ['select 1', '  WITH x as (select 1) select * from x', '-- why\nselect 1', '/* a */ explain select 1', 'show statement_timeout', 'values (1)', 'table public.languages']) {
      expect(refusal(sql)).toBeNull();
    }
  });

  it('refuses a statement that does not start by reading, or that changes its settings', () => {
    for (const sql of ['', 'insert into x values (1)', 'set statement_timeout = 0', 'begin', 'commit', 'reset role', 'call p()', 'do $$ begin end $$', 'copy x to stdout',
      "select set_config('transaction_read_only', 'off', false)"]) {
      expect(refusal(sql)).not.toBeNull();
    }
    expect(refusal(`select '${'x'.repeat(20_001)}'`)).toMatch(/at most/);
  });
});

describe('the gate', () => {
  it('runs the statement as the caller\'s login and logs it', async () => {
    const d = await deps();
    const res = await handleRead(post({ sql: 'select $1::int as n', params: [1] }, TOKEN), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ login: 'claude_reader', columns: ['n'], rows: [[1]], truncated: false, ms: 0 });
    expect(d.ran).toEqual([{ url: 'postgresql://claude_reader@x.hyperdrive.local:5432/postgres', sql: 'select $1::int as n', params: [1] }]);
    expect(JSON.parse(d.logs[0]!)).toMatchObject({ read: 'claude_reader', who: 'CLAUDE_READ_TOKEN', outcome: 'ok', rows: 1, sql: 'select $1::int as n' });

    const agent = await deps();
    await handleRead(post({ sql: 'select 1' }, AGENT_JWT), agent);
    expect(agent.ran[0]!.url).toContain('agent_reader@');
  });

  it('refuses without a good bearer token, before reading the body', async () => {
    const d = await deps();
    expect((await handleRead(post({ sql: 'select 1' }), d)).status).toBe(401);
    expect((await handleRead(post({ sql: 'select 1' }, 'c'.repeat(48)), d)).status).toBe(401);
    expect(d.ran).toEqual([]);
  });

  it('refuses GET, bad JSON, writes and bad params, and says what to send', async () => {
    const d = await deps();
    expect((await handleRead(new Request('https://app.langquest.org/ops/api/read'), d)).status).toBe(405);
    expect((await handleRead(post('select 1', TOKEN), d)).status).toBe(400);
    const write = await handleRead(post({ sql: 'delete from public.events' }, TOKEN), d);
    expect(write.status).toBe(400);
    expect(((await write.json()) as { error: string }).error).toMatch(/Only reading/);
    expect((await handleRead(post({ sql: 'select 1', params: [{ a: 1 }] }, TOKEN), d)).status).toBe(400);
    expect(d.ran).toEqual([]);
  });

  it('says when a login is not set up, or the minute is used up', async () => {
    expect((await handleRead(post({ sql: 'select 1' }, TOKEN), await deps({ connection: () => null }))).status).toBe(503);
    expect((await handleRead(post({ sql: 'select 1' }, TOKEN), await deps({ allowed: async () => false }))).status).toBe(429);
  });

  it('answers the database\'s message when the statement fails, and logs the failure', async () => {
    const d = await deps({ run: async () => { throw Object.assign(new Error('permission denied for table sign_in_codes'), { code: '42501' }); } });
    const res = await handleRead(post({ sql: 'select * from public.sign_in_codes' }, TOKEN), d);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'permission denied for table sign_in_codes (42501)' });
    expect(JSON.parse(d.logs[0]!)).toMatchObject({ outcome: 'error' });
  });

  it('caps an answer at a thousand rows', () => {
    expect(READ_MAX_ROWS).toBe(1000);
  });
});
