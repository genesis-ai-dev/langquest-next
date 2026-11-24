import { describe, expect, it } from 'vitest';
import { RUN_REPO, startRun, type RunWorkflow } from '../worker/startRun';

describe('a message to Claude starts its workflow at once (docs/decisions/2026-11-24-a-message-to-claude-starts-its-run-at-once.md)', () => {
  it('asks GitHub to run the workflow on main, with the token, and nothing else', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(null, { status: 204 }); };
    expect(await startRun('tok', 'user-issues.yml', fetcher)).toBe('started');
    expect(await startRun('tok', 'card-questions.yml', fetcher)).toBe('started');
    expect(calls.map((c) => c.url)).toEqual([
      `https://api.github.com/repos/${RUN_REPO}/actions/workflows/user-issues.yml/dispatches`,
      `https://api.github.com/repos/${RUN_REPO}/actions/workflows/card-questions.yml/dispatches`
    ]);
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ ref: 'main' });
    expect((calls[0]!.init.headers as Record<string, string>)['authorization']).toBe('Bearer tok');
  });

  it('starts nothing without a token, and no other workflow', async () => {
    let called = 0;
    const fetcher = async () => { called++; return new Response(null, { status: 204 }); };
    expect(await startRun(undefined, 'user-issues.yml', fetcher)).toBe('no_token');
    expect(await startRun('', 'user-issues.yml', fetcher)).toBe('no_token');
    expect(await startRun('tok', 'tutorials.yml' as RunWorkflow, fetcher)).toBe('refused_400');
    expect(called).toBe(0);
  });

  it('says GitHub\'s refusal or no answer, and never throws', async () => {
    expect(await startRun('tok', 'user-issues.yml', async () => new Response('{}', { status: 403 }))).toBe('refused_403');
    expect(await startRun('tok', 'user-issues.yml', async () => { throw new Error('down'); })).toBe('error');
  });
});
