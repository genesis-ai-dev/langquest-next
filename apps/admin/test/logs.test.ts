import { describe, expect, it } from 'vitest';
import { handleLogs, LOGS_MAX_LINES, redact, tail, type LogsDeps } from '../src/logs';
import { READ_RULES, sha256 } from '../src/read';
import type { OidcRule } from '../../web/worker/githubOidc';

/** The log gate (src/logs.ts, docs/production-reads.md, "Logs"). */

const TOKEN = 'a'.repeat(48);
const AGENT_JWT = 'header.claims.signature';
const BUILD = '0f1e2d3c-4b5a-4968-8776-655443322110';

type Call = { url: string; init?: RequestInit };

async function deps(answer: (url: string, init?: RequestInit) => unknown, over: Partial<LogsDeps['env']> = {}): Promise<LogsDeps & { calls: Call[]; logs: string[] }> {
  const calls: Call[] = [];
  const logs: string[] = [];
  return {
    calls, logs,
    env: {
      CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_WORKERS: 'langquest-next,langquest-next-admin', SUPABASE_PROJECTS: 'ref1:Next',
      EXPO_PROJECT_ID: 'app1', GITHUB_REPO: 'o/r',
      ADMIN_CLOUDFLARE_TOKEN: 'cf', ADMIN_CLOUDFLARE_LOGS_TOKEN: 'cflogs', ADMIN_SUPABASE_TOKEN: 'sb', ADMIN_EXPO_TOKEN: 'ex', ADMIN_GITHUB_TOKEN: 'gh',
      ...over
    },
    fetcher: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const body = answer(url, init);
      return typeof body === 'string' ? new Response(body) : Response.json(body);
    }) as typeof fetch,
    tokenSha256: await sha256(TOKEN),
    verify: async (token: string, rule: OidcRule) => (token === AGENT_JWT && rule === READ_RULES[0]
      ? { repository: 'genesis-ai-dev/langquest-next', workflowRef: rule.workflowRef, runId: '77', runAttempt: '1', eventName: 'schedule' }
      : null),
    allowed: async () => true,
    log: (line) => logs.push(line),
    now: () => Date.parse('2026-11-22T12:00:00Z')
  };
}

const post = (body: unknown, token?: string) => new Request('https://app.langquest.org/ops/api/read/logs', {
  method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body)
});

describe('who reads logs', () => {
  it('takes the read gate\'s tokens and nothing else', async () => {
    const d = await deps(() => ({}));
    expect((await handleLogs(post({ source: 'worker-builds' }), d)).status).toBe(401);
    expect((await handleLogs(post({ source: 'worker-builds' }, 'b'.repeat(48)), d)).status).toBe(401);
    expect(d.calls).toHaveLength(0);
  });

  it('names the sources when none is given, and refuses one it does not know', async () => {
    const d = await deps(() => ({}));
    for (const source of [undefined, 'x', '__proto__', 'constructor']) {
      const res = await handleLogs(post({ source }, TOKEN), d);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ sources: expect.objectContaining({ 'worker-build-log': expect.any(String) }) });
    }
  });

  it('says which key the Worker lacks', async () => {
    const d = await deps(() => ({}), { ADMIN_CLOUDFLARE_LOGS_TOKEN: undefined });
    const res = await handleLogs(post({ source: 'worker-logs' }, TOKEN), d);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain('ADMIN_CLOUDFLARE_LOGS_TOKEN');
  });
});

describe('Workers Builds', () => {
  it('lists each Worker\'s builds by its tag, and reads one build\'s log page by page', async () => {
    const d = await deps((url) => {
      if (url.endsWith('/workers/scripts')) return { result: [{ id: 'langquest-next', tag: 'tag1' }, { id: 'other', tag: 'tag9' }] };
      if (url.includes('/builds/workers/tag1/builds')) return { result: [{ build_uuid: BUILD, created_on: '2026-11-19T10:00:00Z', build_outcome: 'fail', build_trigger_metadata: { branch: 'main', commit_hash: 'abcdef1234567890', commit_message: 'Fix it\nmore' } }] };
      if (url.endsWith(`/builds/builds/${BUILD}/logs`)) return { result: { lines: [[1763546400000, 'npm ci'], [1763546401000, 'Error: budget']], cursor: 'c2', truncated: true } };
      if (url.includes('cursor=c2')) return { result: { lines: [[1763546402000, 'exit 1']], truncated: false } };
      throw new Error(url);
    });
    const list = await (await handleLogs(post({ source: 'worker-builds' }, AGENT_JWT), d)).json();
    expect(list.login).toBe('agent_reader');
    expect(list.lines[1]).toBe(`langquest-next\t2026-11-19T10:00:00Z\tfail\tmain\tabcdef123456\t${BUILD}\tFix it`);
    expect(d.calls.some((c) => c.url.includes('tag9'))).toBe(false);

    const log = await (await handleLogs(post({ source: 'worker-build-log', build: BUILD }, AGENT_JWT), d)).json();
    expect(log.lines.map((l: string) => l.split('\t')[1])).toEqual(['npm ci', 'Error: budget', 'exit 1']);
    expect(d.calls.every((c) => (c.init?.headers as Record<string, string>)?.authorization === 'Bearer cf' || !c.url.includes('cloudflare'))).toBe(true);
    expect(JSON.parse(d.logs.at(-1)!)).toMatchObject({ logs: 'worker-build-log', read: 'agent_reader', outcome: 'ok', lines: 3 });
  });

  it('refuses a build id that is not one, and a Worker it does not report on', async () => {
    const d = await deps(() => ({}));
    expect((await handleLogs(post({ source: 'worker-build-log', build: '../x' }, TOKEN), d)).status).toBe(400);
    expect((await handleLogs(post({ source: 'worker-builds', worker: 'someone-else' }, TOKEN), d)).status).toBe(400);
    expect(d.calls).toHaveLength(0);
  });
});

describe('Workers Logs', () => {
  const events = { result: { events: { events: [
    { timestamp: 1763812800000, $metadata: { level: 'error', message: 'sign-in failed for ann@example.org with token=abc123', url: 'https://app.langquest.org/x?code=9' }, $workers: { scriptName: 'langquest-next', outcome: 'exception' } }
  ] } } };

  it('gives the agent teams warnings and errors only, with what could name a person taken out', async () => {
    const d = await deps(() => events);
    const answer = await (await handleLogs(post({ source: 'worker-logs', level: 'info', minutes: 99999 }, AGENT_JWT), d)).json();
    const sent = JSON.parse(String(d.calls[0]!.init!.body));
    expect(sent.parameters.filters).toEqual([{ kind: 'group', filterCombination: 'or', filters: [
      { key: '$metadata.level', operation: 'eq', type: 'string', value: 'warn' }, { key: '$metadata.level', operation: 'eq', type: 'string', value: 'error' }] }]);
    expect(sent.timeframe.to - sent.timeframe.from).toBe(24 * 3_600_000);
    expect(sent.view).toBe('events');
    expect(sent.parameters).not.toHaveProperty('view');
    expect((d.calls[0]!.init!.headers as Record<string, string>).authorization).toBe('Bearer cflogs');
    expect(answer.lines[1]).toContain('[email]');
    expect(answer.lines[1]).toContain('token=[hidden]');
    expect(answer.lines[1]).not.toContain('code=9');
  });

  it('gives claude_reader the whole line, at the level it asks', async () => {
    const d = await deps(() => events);
    const answer = await (await handleLogs(post({ source: 'worker-logs', worker: 'langquest-next', level: 'info' }, TOKEN), d)).json();
    expect(JSON.parse(String(d.calls[0]!.init!.body)).parameters.filters).toHaveLength(2);
    expect(answer.lines[1]).toContain('ann@example.org');
  });
});

describe('Supabase logs', () => {
  it('lets the agent teams run only the dashboard\'s grouped queries', async () => {
    const d = await deps(() => ({ result: [{ code: '57014', n: 3 }] }));
    expect((await handleLogs(post({ source: 'supabase-logs', sql: 'select event_message from logs' }, AGENT_JWT), d)).status).toBe(400);
    const answer = await (await handleLogs(post({ source: 'supabase-logs', query: 'postgres-errors' }, AGENT_JWT), d)).json();
    expect(answer.lines).toEqual(['code\tn', '57014\t3']);
    expect(decodeURIComponent(d.calls[0]!.url)).toContain("'postgres_logs'");
  });

  it('runs claude_reader\'s own SQL', async () => {
    const d = await deps(() => ({ result: [{ event_message: 'boot error' }] }));
    const answer = await (await handleLogs(post({ source: 'supabase-logs', sql: 'select event_message from function_logs limit 5' }, TOKEN), d)).json();
    expect(answer.lines).toEqual(['event_message', 'boot error']);
    expect(d.calls[0]!.url).toContain('/projects/ref1/analytics/endpoints/logs?sql=');
  });
});

describe('EAS and GitHub', () => {
  it('reads an EAS build\'s log files as lines', async () => {
    const d = await deps((url) => url.includes('graphql')
      ? { data: { builds: { byId: { status: 'ERRORED', logFiles: ['https://logs.expo.dev/a', 'https://evil.example/b'], error: { errorCode: 'X', message: 'pod install failed' } } } } }
      : '{"time":"t1","phase":"INSTALL_PODS","msg":"[!] CocoaPods could not find"}\nplain line\n');
    const answer = await (await handleLogs(post({ source: 'eas-build-log', build: BUILD }, AGENT_JWT), d)).json();
    expect(answer.lines).toEqual(['t1\tINSTALL_PODS\t[!] CocoaPods could not find', 'plain line']);
    expect(answer.note).toContain('pod install failed');
    expect(d.calls.some((c) => c.url.includes('evil'))).toBe(false);
  });

  it('reads a job\'s log in this repository only', async () => {
    const d = await deps(() => 'step 1\nstep 2');
    expect((await handleLogs(post({ source: 'github-job-log', job: '../../x' }, TOKEN), d)).status).toBe(400);
    const answer = await (await handleLogs(post({ source: 'github-job-log', job: '123' }, TOKEN), d)).json();
    expect(answer.lines).toEqual(['step 1', 'step 2']);
    expect(d.calls[0]!.url).toBe('https://api.github.com/repos/o/r/actions/jobs/123/logs');
  });
});

describe('redact and tail', () => {
  it('keeps ids, codes and times, and takes out what could name a person or open something', () => {
    expect(redact('install 0f1e2d3c-4b5a-4968-8776-655443322110 E-7K2Q01 at 2026-11-22T10:00:00Z size 5292797'))
      .toBe('install 0f1e2d3c-4b5a-4968-8776-655443322110 E-7K2Q01 at 2026-11-22T10:00:00Z size 5292797');
    expect(redact('Bearer abc.def password: "hunter2" eyJhbGciOi.eyJzdWIi.sig call +1 555 123 4567 key=Zx9'))
      .toBe('Bearer [hidden] password: "[hidden]" [jwt] call [number] key=[hidden]');
    expect(redact('sig a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8 end')).toBe('sig [long value] end');
    expect(redact('key not found in node_modules/expo-router/build/fork/useLinking')).toBe('key not found in node_modules/expo-router/build/fork/useLinking');
  });

  it('keeps the newest lines', () => {
    const lines = Array.from({ length: LOGS_MAX_LINES + 5 }, (_, i) => String(i));
    const t = tail(lines);
    expect(t.truncated).toBe(true);
    expect(t.lines[0]).toBe('5');
  });
});
